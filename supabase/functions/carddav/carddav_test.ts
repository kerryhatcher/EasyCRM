import { handle, type Environment } from "./carddav.ts";

const BASE = "https://example.supabase.co/functions/v1/carddav";
const USER = "ae0e3c43-f3db-446e-83d7-f1291349ae84";
const env: Environment = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "public-test-key" };
const basic = "Basic " + btoa("test@example.com:correct-password");

function fixture(base = BASE) {
  const contacts: Record<string, unknown>[] = [];
  let revision = 0;
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/token") {
      const credentials = JSON.parse(String(init?.body));
      return credentials.password === "correct-password" ?
        Response.json({ access_token: "test-jwt", user: { id: USER }, expires_in: 3600 }) :
        Response.json({ error: "bad credentials" }, { status: 400 });
    }
    if (url.pathname !== "/rest/v1/contacts" || init?.headers &&
      (init.headers as Record<string, string>).Authorization !== "Bearer test-jwt") {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const params = url.searchParams;
    const matching = () => contacts.filter((row) =>
      row.owner_id === params.get("owner_id")?.slice(3) &&
      (!params.has("carddav_href") || row.carddav_href === params.get("carddav_href")?.slice(3)) &&
      (!params.has("id") || row.id === params.get("id")?.slice(3)) &&
      (!params.has("updated_at") || row.updated_at === params.get("updated_at")?.slice(3)) &&
      (!params.has("deleted_at") || row.deleted_at === null));
    if (init?.method === "GET") {
      const rows = matching().sort((a, b) => String(a.id).localeCompare(String(b.id)));
      return Response.json(rows.slice(Number(params.get("offset") || 0),
        Number(params.get("offset") || 0) + Number(params.get("limit") || 1000)));
    }
    const values = JSON.parse(String(init?.body));
    if (init?.method === "POST") {
      const row = { id: "11111111-1111-4111-8111-111111111111", updated_at: new Date(++revision * 1000).toISOString(), ...values };
      contacts.push(row);
      return Response.json([row], { status: 201 });
    }
    if (init?.method === "PATCH") {
      const rows = matching();
      for (const row of rows) Object.assign(row, values, { updated_at: new Date(++revision * 1000).toISOString() });
      return Response.json(rows);
    }
    return Response.json({ error: "method" }, { status: 405 });
  }) as typeof fetch;
  const send = (path: string, method: string, body?: string, headers: Record<string, string> = {}) =>
    handle(new Request(base + path, { method, headers: { Authorization: basic, ...headers }, body }), env, fetcher);
  return { send, contacts };
}

Deno.test("requires Basic authentication and advertises DAV methods", async () => {
  const options = await handle(new Request(BASE, { method: "OPTIONS" }), env);
  if (options.status !== 200 || !options.headers.get("DAV")?.includes("addressbook")) throw new Error("missing DAV support");
  const unauthorized = await handle(new Request(BASE, { method: "PROPFIND" }), env);
  if (unauthorized.status !== 401 || !unauthorized.headers.get("WWW-Authenticate")) throw new Error("missing Basic challenge");
});

Deno.test("discovery behind the Supabase gateway advertises public function paths", async () => {
  const { send } = fixture("http://edge-runtime/carddav");
  const principal = await send("/", "PROPFIND", undefined, { Depth: "0" });
  const body = await principal.text();
  if (principal.status !== 207 || !body.includes('<D:href>/functions/v1/carddav/</D:href>') ||
      !body.includes('<D:href>/functions/v1/carddav/addressbooks/</D:href>')) {
    throw new Error(`Gateway discovery returned unreachable URLs: ${body}`);
  }
  const home = await send("/addressbooks/", "PROPFIND", undefined, { Depth: "1" });
  if (!(await home.text()).includes('<D:href>/functions/v1/carddav/addressbooks/default/</D:href>')) {
    throw new Error("Gateway address book discovery returned an internal URL");
  }
  await send("/addressbooks/default/gateway.vcf", "PUT",
    "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:gateway-test\r\nFN:Gateway Test\r\nEND:VCARD\r\n");
  for (const [origin, expected] of [["https://crm-api.kerryhatcher.com", "Gateway Test"],
    ["https://unrelated.example", "404 Not Found"]]) {
    const report = await send("/addressbooks/default/", "REPORT",
      `<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:"><D:href>${origin}/functions/v1/carddav/addressbooks/default/gateway.vcf</D:href></C:addressbook-multiget>`);
    if (report.status !== 207 || !(await report.text()).includes(expected)) {
      throw new Error(`Unexpected multiget response for ${origin}`);
    }
  }
});

Deno.test("discovers an address book and round trips a vCard", async () => {
  const { send, contacts } = fixture();
  const principal = await send("/", "PROPFIND", undefined, { Depth: "0" });
  if (principal.status !== 207 || !(await principal.text()).includes("addressbook-home-set")) throw new Error("principal discovery failed");
  const input = "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:alice-1\r\nN:Example;Alice;;;\r\nFN:Alice Example\r\nEMAIL:alice@example.com\r\nTEL:+1 555 0101\r\nTEL;TYPE=WORK:+1 555 0102\r\nX-EXTRA:keep me\r\nEND:VCARD\r\n";
  const put = await send("/addressbooks/default/alice.vcf", "PUT", input, { "If-None-Match": "*" });
  if (put.status !== 201 || !put.headers.get("ETag")) throw new Error(`PUT failed: ${put.status}`);
  const get = await send("/addressbooks/default/alice.vcf", "GET");
  const output = await get.text();
  if (get.status !== 200 || !output.includes("TEL;TYPE=WORK:+1 555 0102") || !output.includes("X-EXTRA:keep me")) {
    throw new Error("vCard fields were lost");
  }
  const query = await send("/addressbooks/default/", "REPORT",
    '<?xml version="1.0"?><C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav"/>', { Depth: "1" });
  if (query.status !== 207 || !(await query.text()).includes("alice.vcf")) throw new Error("REPORT failed");
  const multiget = await send("/addressbooks/default/", "REPORT",
    '<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:"><D:href>/functions/v1/carddav/addressbooks/default/alice.vcf</D:href></C:addressbook-multiget>',
    { Depth: "0" });
  if (multiget.status !== 207 || !(await multiget.text()).includes("Alice Example")) throw new Error("multiget failed");
  contacts[0].name = "Alice Changed";
  const merged = await send("/addressbooks/default/alice.vcf", "GET");
  const mergedBody = await merged.text();
  if (!mergedBody.includes("FN:Alice Changed") || !mergedBody.includes("X-EXTRA:keep me")) {
    throw new Error("CRM edit lost vCard data");
  }
  const stale = await send("/addressbooks/default/alice.vcf", "PUT", input, { "If-Match": '"stale"' });
  if (stale.status !== 412) throw new Error("stale update was accepted");
  const deleted = await send("/addressbooks/default/alice.vcf", "DELETE", undefined, { "If-Match": merged.headers.get("ETag")! });
  if (deleted.status !== 204) throw new Error("DELETE failed");
  const missing = await send("/addressbooks/default/alice.vcf", "GET");
  if (missing.status !== 404) throw new Error("deleted vCard remained visible");
});
