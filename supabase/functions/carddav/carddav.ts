import { XMLParser, XMLValidator } from "fast-xml-parser";

type Contact = {
  id: string;
  owner_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  info: string | null;
  carddav_href: string;
  carddav_uid: string | null;
  carddav_vcard: string | null;
  updated_at: string;
  deleted_at: string | null;
};

type Context = {
  url: string;
  key: string;
  token: string;
  userId: string;
  email: string;
  fetcher: typeof fetch;
};

export type Environment = {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEYS?: string;
  SUPABASE_ANON_KEY?: string;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true,
  parseTagValue: false, ignoreDeclaration: true });
const authCache = new Map<string, { token: string; userId: string; until: number }>();
const SELECT = "id,owner_id,name,email,phone,company,title,info,carddav_href,carddav_uid,carddav_vcard,updated_at,deleted_at";
const DAV_HEADERS = { "DAV": "1, 3, addressbook", "Allow": "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE" };
const PUBLIC_BASE = "/functions/v1/carddav";
const PUBLIC_ORIGIN = "https://crm-api.kerryhatcher.com";

function response(body: string | null, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function xml(body: string): Response {
  return response(body, 207, { "Content-Type": "application/xml; charset=utf-8", ...DAV_HEADERS });
}

function escapeXml(value: unknown): string {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function multi(responses: string[]): Response {
  return xml(`<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">${responses.join("")}</D:multistatus>`);
}

function item(href: string, properties: string, status = 200): string {
  if (status === 404) return `<D:response><D:href>${escapeXml(href)}</D:href><D:status>HTTP/1.1 404 Not Found</D:status></D:response>`;
  return `<D:response><D:href>${escapeXml(href)}</D:href><D:propstat><D:prop>${properties}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function parseXml(body: string): Record<string, unknown> {
  if (!body.trim()) return {};
  if (/<!DOCTYPE|<!ENTITY/i.test(body) || XMLValidator.validate(body) !== true) {
    throw new HttpError(400, "Invalid XML");
  }
  return parser.parse(body) as Record<string, unknown>;
}

async function readBody(request: Request, maxBytes: number): Promise<string> {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBytes) throw new HttpError(413, "Request body too large");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new HttpError(400, "Request body must be UTF-8"); }
}

function publishableKey(env: Environment): string {
  let key = env.SUPABASE_ANON_KEY || "";
  if (env.SUPABASE_PUBLISHABLE_KEYS) {
    try { key = JSON.parse(env.SUPABASE_PUBLISHABLE_KEYS).default || key; } catch { /* fallback */ }
  }
  if (!key) throw new HttpError(503, "CardDAV configuration is incomplete");
  return key;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function authenticate(request: Request, env: Environment, fetcher: typeof fetch): Promise<Context> {
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) throw new HttpError(401, "Basic authentication required");
  let credential: string;
  try {
    const bytes = Uint8Array.from(atob(header.slice(6)), (char) => char.charCodeAt(0));
    credential = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { throw new HttpError(401, "Invalid Basic credentials"); }
  const separator = credential.indexOf(":");
  if (separator < 1 || !credential.slice(separator + 1)) throw new HttpError(401, "Invalid Basic credentials");
  const email = credential.slice(0, separator);
  const password = credential.slice(separator + 1);
  const url = env.SUPABASE_URL.replace(/\/$/, "");
  const key = publishableKey(env);
  const cacheKey = await sha256(header);
  const cached = authCache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    return { url, key, token: cached.token, userId: cached.userId, email, fetcher };
  }
  const auth = await fetcher(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!auth.ok) throw new HttpError(401, "Invalid CardDAV username or password");
  const data = await auth.json();
  if (!data.access_token || !data.user?.id) throw new HttpError(401, "Invalid CardDAV session");
  if (authCache.size > 64) authCache.clear();
  authCache.set(cacheKey, { token: data.access_token, userId: data.user.id,
    until: Date.now() + Math.min(300, Math.max(30, (data.expires_in || 3600) - 60)) * 1000 });
  return { url, key, token: data.access_token, userId: data.user.id, email, fetcher };
}

async function db(ctx: Context, method: string, query: URLSearchParams, body?: unknown): Promise<Contact[]> {
  const headers: Record<string, string> = {
    apikey: ctx.key, Authorization: `Bearer ${ctx.token}`, Accept: "application/json",
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  const result = await ctx.fetcher(`${ctx.url}/rest/v1/contacts?${query}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!result.ok) {
    if (result.status === 409) throw new HttpError(409, "Duplicate CardDAV resource or UID");
    throw new HttpError(502, "Contact database request failed");
  }
  return await result.json() as Contact[];
}

function query(ctx: Context, extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({ owner_id: `eq.${ctx.userId}`, select: SELECT, ...extra });
}

async function find(ctx: Context, href: string): Promise<Contact | null> {
  const rows = await db(ctx, "GET", query(ctx, { carddav_href: `eq.${href}`, limit: "1" }));
  return rows[0] || null;
}

async function all(ctx: Context): Promise<Contact[]> {
  const rows: Contact[] = [];
  for (let offset = 0; ; offset += 1000) {
    const batch = await db(ctx, "GET", query(ctx, { deleted_at: "is.null", limit: "1000", offset: String(offset), order: "id.asc" }));
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

function unescapeV(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, char: string) => char.toLowerCase() === "n" ? "\n" : char);
}

function escapeV(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .replaceAll("\n", "\\n").replaceAll(";", "\\;").replaceAll(",", "\\,");
}

function linesOf(card: string): string[] {
  const result: string[] = [];
  for (const line of card.replace(/\r\n|\r/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && result.length) result[result.length - 1] += line.slice(1);
    else if (line) result.push(line);
  }
  return result;
}

function property(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon).split(";")[0].split(".").pop()!.toUpperCase();
  return { name: head, value: line.slice(colon + 1) };
}

function first(lines: string[], name: string): string | null {
  const line = lines.map(property).find((item) => item?.name === name);
  if (!line) return null;
  const value = unescapeV(line.value);
  return name === "TEL" && value.toLowerCase().startsWith("tel:") ? value.slice(4) : value;
}

type Card = { uid: string; version: string; name: string; email: string | null; phone: string | null;
  company: string | null; title: string | null; info: string | null; raw: string };

function parseCard(body: string): Card {
  const lines = linesOf(body);
  if (lines[0]?.toUpperCase() !== "BEGIN:VCARD" || lines.at(-1)?.toUpperCase() !== "END:VCARD" ||
      lines.filter((line) => line.toUpperCase() === "BEGIN:VCARD").length !== 1 ||
      lines.filter((line) => line.toUpperCase() === "END:VCARD").length !== 1) {
    throw new HttpError(422, "Expected one vCard");
  }
  const version = first(lines, "VERSION") || "";
  if (version !== "3.0" && version !== "4.0") throw new HttpError(415, "Only vCard 3.0 and 4.0 are supported");
  const uid = first(lines, "UID");
  const name = first(lines, "FN");
  if (!uid || !name?.trim()) throw new HttpError(422, "vCard needs UID and FN");
  return { uid, version, name: name.trim(), email: first(lines, "EMAIL"),
    phone: first(lines, "TEL"), company: first(lines, "ORG"),
    title: first(lines, "TITLE"), info: first(lines, "NOTE"), raw: lines.join("\r\n") + "\r\n" };
}

function nValue(name: string): string {
  const pieces = name.trim().split(/\s+/);
  const family = pieces.length > 1 ? pieces.pop()! : "";
  return `${escapeV(family)};${escapeV(pieces.join(" "))};;;`;
}

function vcard(contact: Contact): string {
  const uid = contact.carddav_uid || contact.id;
  const fields: Record<string, string | null> = {
    UID: uid, FN: contact.name, EMAIL: contact.email, TEL: contact.phone,
    ORG: contact.company, TITLE: contact.title, NOTE: contact.info,
  };
  if (!contact.carddav_vcard) {
    const lines = ["BEGIN:VCARD", "VERSION:3.0", `UID:${escapeV(uid)}`,
      `N:${nValue(contact.name)}`, `FN:${escapeV(contact.name)}`];
    for (const key of ["EMAIL", "TEL", "ORG", "TITLE", "NOTE"]) {
      if (fields[key]) lines.push(`${key}:${escapeV(fields[key]!)}`);
    }
    return [...lines, "END:VCARD", ""].join("\r\n");
  }
  const lines = linesOf(contact.carddav_vcard);
  const original = parseCard(contact.carddav_vcard);
  const changed = new Set<string>();
  for (const [key, value] of Object.entries(fields)) {
    const previous = key === "UID" ? original.uid : key === "FN" ? original.name :
      key === "EMAIL" ? original.email : key === "TEL" ? original.phone :
      key === "ORG" ? original.company : key === "TITLE" ? original.title : original.info;
    if ((value || null) !== (previous || null)) changed.add(key);
  }
  if (!changed.size) return lines.join("\r\n") + "\r\n";
  if (changed.has("FN")) changed.add("N");
  const replaced = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const key = property(line)?.name || "";
    if (changed.has(key) && fields[key] === null && replaced.has(key)) continue;
    if (changed.has(key) && !replaced.has(key)) {
      replaced.add(key);
      const value = key === "N" ? nValue(contact.name) : fields[key];
      if (value !== null && value !== undefined) output.push(`${key}:${key === "N" ? value : escapeV(value)}`);
    } else output.push(line);
  }
  const end = output.findIndex((line) => line.toUpperCase() === "END:VCARD");
  for (const key of changed) {
    if (!replaced.has(key) && key !== "N" && fields[key]) output.splice(end, 0, `${key}:${escapeV(fields[key]!)}`);
  }
  return output.join("\r\n") + "\r\n";
}

async function etag(contact: Contact): Promise<string> {
  return `"${await sha256(vcard(contact))}"`;
}

function paths(base: string) {
  return { principal: `${base}/`, home: `${base}/addressbooks/`, book: `${base}/addressbooks/default/` };
}

function principalProps(ctx: Context, base: string): string {
  const p = paths(base);
  return `<D:resourcetype><D:principal/></D:resourcetype><D:displayname>${escapeXml(ctx.email)}</D:displayname>` +
    `<D:current-user-principal><D:href>${escapeXml(p.principal)}</D:href></D:current-user-principal>` +
    `<D:principal-URL><D:href>${escapeXml(p.principal)}</D:href></D:principal-URL>` +
    `<C:addressbook-home-set><D:href>${escapeXml(p.home)}</D:href></C:addressbook-home-set>`;
}

function homeProps(ctx: Context, base: string): string {
  return `<D:resourcetype><D:collection/></D:resourcetype><D:displayname>Address Books</D:displayname>` +
    `<D:current-user-principal><D:href>${escapeXml(paths(base).principal)}</D:href></D:current-user-principal>`;
}

function privileges(): string {
  return `<D:current-user-privilege-set><D:privilege><D:read/></D:privilege>` +
    `<D:privilege><D:write/></D:privilege><D:privilege><D:write-content/></D:privilege></D:current-user-privilege-set>`;
}

async function bookProps(ctx: Context, base: string): Promise<string> {
  const latest = await db(ctx, "GET", query(ctx, { select: "updated_at", order: "updated_at.desc", limit: "1" }));
  const ctag = latest[0]?.updated_at || "0";
  return `<D:resourcetype><D:collection/><C:addressbook/></D:resourcetype><D:displayname>EasyCRM</D:displayname>` +
    `<D:owner><D:href>${escapeXml(paths(base).principal)}</D:href></D:owner>` +
    `<D:current-user-principal><D:href>${escapeXml(paths(base).principal)}</D:href></D:current-user-principal>` +
    privileges() +
    `<CS:getctag>${escapeXml(ctag)}</CS:getctag>` +
    `<C:supported-address-data><C:address-data-type content-type="text/vcard" version="3.0"/>` +
    `<C:address-data-type content-type="text/vcard" version="4.0"/></C:supported-address-data>` +
    `<C:max-resource-size>131072</C:max-resource-size>` +
    `<D:supported-report-set><D:supported-report><D:report><C:addressbook-query/></D:report></D:supported-report>` +
    `<D:supported-report><D:report><C:addressbook-multiget/></D:report></D:supported-report></D:supported-report-set>`;
}

async function cardProps(contact: Contact, includeData = false): Promise<string> {
  const card = vcard(contact);
  return `<D:resourcetype/><D:getetag>${escapeXml(await etag(contact))}</D:getetag>` +
    `<D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>` +
    `<D:getlastmodified>${escapeXml(new Date(contact.updated_at).toUTCString())}</D:getlastmodified>` +
    (includeData ? `<C:address-data>${escapeXml(card)}</C:address-data>` : "");
}

function cardHref(base: string, contact: Contact): string {
  return paths(base).book + encodeURIComponent(contact.carddav_href);
}

async function propfind(ctx: Context, base: string, path: string, depth: string): Promise<Response> {
  if (depth !== "0" && depth !== "1") throw new HttpError(403, "Only Depth 0 and 1 are supported");
  const p = paths(base);
  const items: string[] = [];
  if (path === "/" || path === "/principal/") {
    items.push(item(p.principal, principalProps(ctx, base)));
    if (depth === "1") items.push(item(p.home, homeProps(ctx, base)));
  } else if (path === "/addressbooks/") {
    items.push(item(p.home, homeProps(ctx, base)));
    if (depth === "1") items.push(item(p.book, await bookProps(ctx, base)));
  } else if (path === "/addressbooks/default/") {
    items.push(item(p.book, await bookProps(ctx, base)));
    if (depth === "1") {
      for (const contact of await all(ctx)) items.push(item(cardHref(base, contact), await cardProps(contact)));
    }
  } else {
    const href = cardName(path);
    const contact = href && await find(ctx, href);
    if (!contact || contact.deleted_at) throw new HttpError(404, "Contact not found");
    items.push(item(cardHref(base, contact), await cardProps(contact)));
  }
  return multi(items);
}

function cardName(path: string): string | null {
  if (!path.startsWith("/addressbooks/default/")) return null;
  try {
    const name = decodeURIComponent(path.slice("/addressbooks/default/".length));
    return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\.vcf$/.test(name) ? name : null;
  } catch { return null; }
}

function queryMatches(contact: Contact, root: Record<string, unknown>): boolean {
  const filter = root.filter as Record<string, unknown> | undefined;
  if (!filter) return true;
  const fields: Record<string, string | null> = { FN: contact.name, N: contact.name, EMAIL: contact.email,
    TEL: contact.phone, ORG: contact.company, TITLE: contact.title, NOTE: contact.info,
    UID: contact.carddav_uid || contact.id };
  const tests = asArray(filter["prop-filter"] as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const outcomes = tests.map((test) => {
    const name = String(test["@_name"] || "").toUpperCase();
    if (!(name in fields)) throw new HttpError(403, "Unsupported addressbook filter");
    const value = fields[name] || "";
    if ("is-not-defined" in test) return !value;
    const match = test["text-match"] as string | Record<string, unknown> | undefined;
    if (match !== undefined) {
      const wanted = String(typeof match === "string" ? match : match["#text"] || "").toLowerCase();
      const type = typeof match === "string" ? "contains" : String(match["@_match-type"] || "contains");
      const actual = value.toLowerCase();
      return type === "equals" ? actual === wanted : type === "starts-with" ? actual.startsWith(wanted) :
        type === "ends-with" ? actual.endsWith(wanted) : actual.includes(wanted);
    }
    return !!value;
  });
  return filter["@_test"] === "anyof" ? outcomes.some(Boolean) : outcomes.every(Boolean);
}

async function report(ctx: Context, base: string, path: string, body: string): Promise<Response> {
  if (path !== "/addressbooks/default/") throw new HttpError(405, "REPORT requires the address book URL");
  const document = parseXml(body);
  const rootName = Object.keys(document)[0];
  const root = document[rootName] as Record<string, unknown>;
  const items: string[] = [];
  if (rootName === "addressbook-query") {
    for (const contact of await all(ctx)) {
      if (queryMatches(contact, root)) items.push(item(cardHref(base, contact), await cardProps(contact, true)));
    }
  } else if (rootName === "addressbook-multiget") {
    for (const requested of asArray(root.href as string | string[] | undefined)) {
      const url = new URL(String(requested), `${ctx.url}${paths(base).book}`);
      const sameService = url.origin === new URL(ctx.url).origin || url.origin === PUBLIC_ORIGIN;
      const href = sameService && url.pathname.startsWith(base + "/") && cardName(url.pathname.slice(base.length));
      const contact = href && await find(ctx, href);
      items.push(contact && !contact.deleted_at ?
        item(cardHref(base, contact), await cardProps(contact, true)) : item(String(requested), "", 404));
    }
  } else throw new HttpError(501, "Unsupported REPORT");
  return multi(items);
}

async function getCard(ctx: Context, path: string, request: Request): Promise<Response> {
  const href = cardName(path);
  if (!href) throw new HttpError(404, "Contact not found");
  const contact = await find(ctx, href);
  if (!contact || contact.deleted_at) throw new HttpError(404, "Contact not found");
  const tag = await etag(contact);
  if (request.headers.get("If-None-Match") === tag) return response(null, 304, { ETag: tag });
  return response(vcard(contact), 200, { "Content-Type": "text/vcard; charset=utf-8", ETag: tag,
    "Last-Modified": new Date(contact.updated_at).toUTCString() });
}

async function putCard(ctx: Context, path: string, request: Request): Promise<Response> {
  const href = cardName(path);
  if (!href) throw new HttpError(404, "Invalid vCard URL");
  const card = parseCard(await readBody(request, 131072));
  const old = await find(ctx, href);
  const active = old && !old.deleted_at;
  const ifMatch = request.headers.get("If-Match");
  const ifNoneMatch = request.headers.get("If-None-Match");
  if (active && ifNoneMatch === "*") throw new HttpError(412, "Contact already exists");
  if ((!active && ifMatch) || (active && ifMatch && ifMatch !== "*" && ifMatch !== await etag(old))) {
    throw new HttpError(412, "Contact has changed");
  }
  if (active && card.uid !== (old.carddav_uid || old.id)) throw new HttpError(409, "vCard UID cannot change");
  const fields = { name: card.name, email: card.email, phone: card.phone,
    company: card.company, title: card.title, info: card.info,
    carddav_uid: card.uid, carddav_vcard: card.raw, deleted_at: null };
  let saved: Contact[];
  if (old) {
    saved = await db(ctx, "PATCH", query(ctx, { id: `eq.${old.id}`, updated_at: `eq.${old.updated_at}` }), fields);
    if (!saved.length) throw new HttpError(412, "Contact changed during update");
  } else {
    saved = await db(ctx, "POST", query(ctx), { ...fields, owner_id: ctx.userId, carddav_href: href });
  }
  return response(null, active ? 204 : 201, { ETag: await etag(saved[0]) });
}

async function deleteCard(ctx: Context, path: string, request: Request): Promise<Response> {
  const href = cardName(path);
  if (!href) throw new HttpError(404, "Contact not found");
  const contact = await find(ctx, href);
  if (!contact || contact.deleted_at) throw new HttpError(404, "Contact not found");
  const ifMatch = request.headers.get("If-Match");
  if (ifMatch && ifMatch !== "*" && ifMatch !== await etag(contact)) throw new HttpError(412, "Contact has changed");
  const saved = await db(ctx, "PATCH", query(ctx, { id: `eq.${contact.id}`, updated_at: `eq.${contact.updated_at}` }),
    { deleted_at: new Date().toISOString() });
  if (!saved.length) throw new HttpError(412, "Contact changed during deletion");
  return response(null, 204);
}

export async function handle(request: Request, suppliedEnv?: Environment, fetcher: typeof fetch = fetch): Promise<Response> {
  try {
    const url = new URL(request.url);
    const marker = "/carddav";
    const index = url.pathname.indexOf(marker);
    if (index < 0) throw new HttpError(404, "CardDAV route not found");
    const routeBase = url.pathname.slice(0, index + marker.length);
    // Supabase strips /functions/v1 from the internal request URL. DAV hrefs
    // must still point at the public gateway paths clients can request.
    const base = PUBLIC_BASE;
    let path = url.pathname.slice(routeBase.length) || "/";
    if (["/addressbooks", "/addressbooks/default", "/principal"].includes(path)) path += "/";
    if (request.method === "OPTIONS") return response(null, 200, DAV_HEADERS);
    const env = suppliedEnv || {
      SUPABASE_URL: Deno.env.get("SUPABASE_URL") || "",
      SUPABASE_PUBLISHABLE_KEYS: Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"),
      SUPABASE_ANON_KEY: Deno.env.get("SUPABASE_ANON_KEY"),
    };
    const ctx = await authenticate(request, env, fetcher);
    switch (request.method) {
      case "PROPFIND": return await propfind(ctx, base, path, request.headers.get("Depth") || "0");
      case "REPORT": return await report(ctx, base, path, await readBody(request, 1048576));
      case "GET": return await getCard(ctx, path, request);
      case "PUT": return await putCard(ctx, path, request);
      case "DELETE": return await deleteCard(ctx, path, request);
      default: throw new HttpError(405, "Method not allowed");
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof HttpError ? error.message : "CardDAV request failed";
    return response(message, status, { "Content-Type": "text/plain; charset=utf-8",
      ...(status === 401 ? { "WWW-Authenticate": 'Basic realm="EasyCRM CardDAV", charset="UTF-8"' } : {}),
      ...(status === 405 ? DAV_HEADERS : {}) });
  }
}
