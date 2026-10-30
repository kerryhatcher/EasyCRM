import {
  type ContactDetails,
  emptyContactDetails,
  type LabeledValue,
  nameKeys,
  type PostalAddress,
  primaryValue,
  type VCardProperty,
} from "./contact-details.ts";
export function cardLines(raw: string): string[] {
  return raw.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "").split("\n")
    .filter(Boolean);
}
export function decodeValue(s: string): string {
  return s.replace(
    /\\([nN,;\\])/g,
    (_, c) => c.toLowerCase() === "n" ? "\n" : c,
  );
}
export function encodeValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(
    /;/g,
    "\\;",
  ).replace(/,/g, "\\,");
}
function splitEscaped(s: string, delimiter: string): string[] {
  const result: string[] = [];
  let part = "";
  let escaped = false;
  for (const c of s) {
    if (c === delimiter && !escaped) {
      result.push(part);
      part = "";
    } else part += c;
    if (c === "\\" && !escaped) escaped = true;
    else escaped = false;
  }
  result.push(part);
  return result;
}
export function readProperty(line: string): VCardProperty | null {
  // Parameter values can contain quoted colons and semicolons.
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon < 0) return null;
  const head = line.slice(0, colon).match(/(?:[^;" ]|"[^"]*")+|(?<=;)(?=;)/g) ??
    [];
  const full = head.shift() ?? "";
  const dot = full.lastIndexOf(".");
  const parameters: Record<string, string[]> = {};
  for (const item of head) {
    const eq = item.indexOf("=");
    if (eq < 0) continue;
    const key = item.slice(0, eq).toUpperCase();
    const value = item.slice(eq + 1);
    parameters[key] = [
      ...(parameters[key] ?? []),
      ...(value.match(/"[^"]*"|[^,]+/g) ?? []).map((v) =>
        v.replace(/^"|"$/g, "").replace(/\^n/gi, "\n").replace(/\^'/g, '"')
          .replace(/\^\^/g, "^")
      ),
    ];
  }
  return {
    name: full.slice(dot + 1).toUpperCase(),
    ...(dot < 0 ? {} : { group: full.slice(0, dot) }),
    parameters,
    value: line.slice(colon + 1),
  };
}
export function cardCompany(raw: string): string | null {
  const prop = cardLines(raw).map(readProperty).find((p) => p?.name === "ORG");
  return prop ? decodeValue(splitEscaped(prop.value, ";")[0]) || null : null;
}
const mapping = {
  EMAIL: "emails",
  TEL: "phones",
  URL: "websites",
  "X-SOCIALPROFILE": "social_profiles",
  IMPP: "instant_messages",
  "X-ABRELATEDNAMES": "related_names",
  "X-ABDATE": "dates",
} as const;
const managed = new Set([
  "BEGIN",
  "END",
  "VERSION",
  "UID",
  "FN",
  "N",
  "ORG",
  "TITLE",
  "NOTE",
  "NICKNAME",
  "BDAY",
  "CATEGORIES",
  "X-RADIO-CALLSIGN",
  "X-ABSHOWAS",
  ...Object.keys(mapping),
  "ADR",
  "X-ABLABEL",
]);
function labelData(
  p: VCardProperty,
  labels: Map<string, string>,
): Omit<LabeledValue, "value"> {
  const types = p.parameters?.TYPE ?? [];
  const preferred = types.some((t) => t.toLowerCase() === "pref") ||
    p.parameters?.PREF?.[0] === "1";
  return {
    ...(labels.has(p.group ?? "") ? { label: labels.get(p.group ?? "") } : {}),
    ...(types.length ? { types } : {}),
    ...(preferred ? { preferred: true } : {}),
    ...(Object.keys(p.parameters ?? {}).length
      ? { parameters: p.parameters }
      : {}),
  };
}
export function readCardDetails(raw: string): ContactDetails {
  const props = cardLines(raw).map(readProperty).filter((
    p,
  ): p is VCardProperty => !!p);
  const d: ContactDetails = emptyContactDetails();
  const labels = new Map(
    props.filter((p) => p.name === "X-ABLABEL").map(
      (p) => [p.group ?? "", decodeValue(p.value)],
    ),
  );
  const first = (key: string) => props.find((p) => p.name === key);
  const n = first("N");
  if (n) {
    splitEscaped(n.value, ";").slice(0, 5).forEach((v, i) => {
      d[nameKeys[i]] = decodeValue(v);
    });
  }
  d.kind = first("X-ABSHOWAS")?.value.toUpperCase() === "COMPANY"
    ? "organization"
    : "person";
  const org = first("ORG");
  if (org) {
    const parts = splitEscaped(org.value, ";");
    if (parts.length > 1) {
      d.department = parts.slice(1).map(decodeValue).join(";");
    }
  }
  if (first("NICKNAME")) {
    d.nicknames = splitEscaped(first("NICKNAME")!.value, ",").map(decodeValue);
  }
  d.callsigns = props.filter((p) => p.name === "X-RADIO-CALLSIGN").flatMap(
    (p) => splitEscaped(p.value, ",").map(decodeValue),
  );
  if (first("BDAY")) d.birthday = decodeValue(first("BDAY")!.value);
  if (first("CATEGORIES")) {
    d.categories = props.filter((p) => p.name === "CATEGORIES").flatMap((p) =>
      splitEscaped(p.value, ",").map(decodeValue)
    );
  }
  for (const [prop, key] of Object.entries(mapping)) {
    const entries = props.filter((p) => p.name === prop).map((p) => ({
      value: decodeValue(p.value).replace(prop === "TEL" ? /^tel:/i : /^$/, ""),
      ...labelData(p, labels),
    }));
    // Some exports mark several values preferred. Keep their original parameters but choose one primary.
    let chosen = false;
    for (const v of entries) {
      if (v.preferred) {
        if (chosen) delete v.preferred;
        chosen = true;
      }
    }
    if (entries.length) {
      d[key as typeof mapping[keyof typeof mapping]] = entries;
    }
  }
  const addresses = props.filter((p) => p.name === "ADR").map((p) => {
    const a: PostalAddress = labelData(p, labels);
    const keys = [
      "po_box",
      "extended",
      "street",
      "locality",
      "region",
      "postal_code",
      "country",
    ] as const;
    splitEscaped(p.value, ";").slice(0, 7).forEach((v, i) => {
      a[keys[i]] = decodeValue(v);
    });
    return a;
  });
  if (addresses.length) d.addresses = addresses;
  d.extra_properties = props.filter((p) => !managed.has(p.name));
  return d;
}
function parameterText(params: Record<string, string[]>): string {
  return Object.entries(params).map(([k, vs]) =>
    `;${k}=${
      vs.map((v) =>
        '"' +
        v.replace(/\^/g, "^^").replace(/\r\n|\r|\n/g, "^n").replace(
          /"/g,
          "^'",
        ) + '"'
      ).join(",")
    }`
  ).join("");
}
function valueLines(
  prop: string,
  list: (LabeledValue | PostalAddress)[],
  groupPrefix: string,
  version: string,
): string[] {
  return list.flatMap((v, i) => {
    const params = { ...v.parameters };
    if (v.types?.length) params.TYPE = v.types;
    if (v.preferred) {
      if (version === "3.0") {
        delete params.PREF;
        params.TYPE = [
          ...(params.TYPE ?? []).filter((t) => t.toLowerCase() !== "pref"),
          "PREF",
        ];
      } else params.PREF = ["1"];
    } else {
      delete params.PREF;
      if (params.TYPE) {
        params.TYPE = params.TYPE.filter((t) => t.toLowerCase() !== "pref");
      }
    }
    const group = v.label ? `${groupPrefix}${i}.` : "";
    let value = prop === "ADR"
      ? [
        "po_box",
        "extended",
        "street",
        "locality",
        "region",
        "postal_code",
        "country",
      ].map((k) =>
        encodeValue((v as Record<string, unknown>)[k] as string ?? "")
      ).join(";")
      : encodeValue((v as LabeledValue).value);
    if (
      prop === "TEL" &&
      (params.VALUE?.[0]?.toLowerCase() === "uri" ||
        (version === "4.0" && params.VALUE?.[0]?.toLowerCase() !== "text"))
    ) {
      value = "tel:" +
        (v as LabeledValue).value.replace(/^tel:/i, "").replace(
          /\r\n|\r|\n/g,
          "%0A",
        );
    }
    return [
      `${group}${prop}${parameterText(params)}:${value}`,
      ...(v.label ? [`${group}X-ABLabel:${encodeValue(v.label)}`] : []),
    ];
  });
}
function aliasValues(
  list: LabeledValue[] | undefined,
  alias: string | null,
): LabeledValue[] {
  const values = (list ?? []).map((v) => ({ ...v }));
  if (primaryValue(values) === alias) return values;
  const i = Math.max(0, values.findIndex((v) => v.preferred));
  if (alias === null) values.splice(i, 1);
  else if (values.length) values[i].value = alias;
  else values.push({ value: alias });
  return values;
}
export type CardContact = {
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  info: string | null;
  carddav_uid?: string | null;
  id: string;
  carddav_vcard: string | null;
  details?: ContactDetails;
};
export function effectiveContactDetails(
  c: Pick<CardContact, "details" | "carddav_vcard" | "email" | "phone">,
): ContactDetails {
  const d: ContactDetails = {
    ...(c.carddav_vcard ? readCardDetails(c.carddav_vcard) : {}),
    ...c.details,
  };
  d.emails = aliasValues(d.emails, c.email);
  d.phones = aliasValues(d.phones, c.phone);
  return d;
}
/** Rewrite only changed properties; untouched lines (including opaque Apple metadata) survive verbatim. */
export function renderContactCard(c: CardContact): string {
  const original = c.carddav_vcard;
  const baseline = original ? readCardDetails(original) : {};
  const d = effectiveContactDetails(c);
  const oldProps = original
    ? cardLines(original).map(readProperty).filter((p): p is VCardProperty =>
      !!p
    )
    : [];
  const old = (key: string) =>
    decodeValue(oldProps.find((p) => p.name === key)?.value ?? "") || null;
  const updates = new Map<string, string[]>();
  const plain = (prop: string, value: string | null) => {
    if (!original || value !== old(prop)) {
      updates.set(prop, value ? [`${prop}:${encodeValue(value)}`] : []);
    }
  };
  plain("UID", c.carddav_uid || c.id);
  plain("FN", c.name);
  plain("TITLE", c.title);
  plain("NOTE", c.info);
  const structured = nameKeys.some((k) => k in d);
  const baseStructured = nameKeys.some((k) => k in baseline);
  if (!original || nameKeys.some((k) => d[k] !== baseline[k])) {
    const n = structured
      ? nameKeys.map((k) => encodeValue(d[k] ?? "")).join(";")
      : ["", c.name, "", "", ""].map(encodeValue).join(";");
    updates.set("N", [`N:${n}`]);
  } else if (!baseStructured && !oldProps.some((p) => p.name === "N")) {
    updates.set("N", [`N:;${encodeValue(c.name)};;;`]);
  }
  if (
    !original ||
    c.company !== (oldProps.find((p) => p.name === "ORG")
        ? decodeValue(
          splitEscaped(oldProps.find((p) => p.name === "ORG")!.value, ";")[0],
        )
        : null) ||
    d.department !== baseline.department
  ) {
    updates.set(
      "ORG",
      c.company || d.department
        ? [
          `ORG:${encodeValue(c.company ?? "")}${
            d.department
              ? ";" + splitEscaped(d.department, ";").map(encodeValue).join(";")
              : ""
          }`,
        ]
        : [],
    );
  }
  const arrayFields = { ...mapping, ADR: "addresses" } as const;
  for (const [prop, key] of Object.entries(arrayFields)) {
    if (
      !original ||
      JSON.stringify(d[key as keyof ContactDetails] ?? []) !==
        JSON.stringify(baseline[key as keyof ContactDetails] ?? [])
    ) {
      updates.set(
        prop,
        valueLines(
          prop,
          (d[key as keyof ContactDetails] ?? []) as (
            | LabeledValue
            | PostalAddress
          )[],
          `crm${prop.toLowerCase()}`,
          old("VERSION") ?? "3.0",
        ),
      );
    }
  }
  if (!original || d.kind !== baseline.kind) {
    updates.set(
      "X-ABSHOWAS",
      d.kind === "organization" ? ["X-ABShowAs:COMPANY"] : [],
    );
  }
  if (!original || d.birthday !== baseline.birthday) {
    updates.set("BDAY", d.birthday ? [`BDAY:${encodeValue(d.birthday)}`] : []);
  }
  for (
    const [prop, key] of [["NICKNAME", "nicknames"], [
      "X-RADIO-CALLSIGN",
      "callsigns",
    ], [
      "CATEGORIES",
      "categories",
    ]] as const
  ) {
    if (
      !original ||
      JSON.stringify(d[key] ?? []) !== JSON.stringify(baseline[key] ?? [])
    ) {
      updates.set(
        prop,
        d[key]?.length ? [`${prop}:${d[key]!.map(encodeValue).join(",")}`] : [],
      );
    }
  }
  const extrasChanged = JSON.stringify(d.extra_properties ?? []) !==
    JSON.stringify(baseline.extra_properties ?? []);
  const replaced = new Set<string>();
  const output: string[] = [];
  const changedGroups = new Set(
    oldProps.filter((p) => updates.has(p.name)).map((p) => p.group).filter(
      Boolean,
    ),
  );
  for (
    const line of original
      ? cardLines(original)
      : ["BEGIN:VCARD", "VERSION:3.0", "END:VCARD"]
  ) {
    const p = readProperty(line);
    if (!p) continue;
    if (p.name === "X-ABLABEL" && changedGroups.has(p.group)) continue;
    if (extrasChanged && !managed.has(p.name)) continue;
    if (p.name === "END") {
      for (const [key, lines] of updates) {
        if (!replaced.has(key)) output.push(...lines);
      }
      if (extrasChanged || !original) {
        for (const x of d.extra_properties ?? []) {
          if (!managed.has(x.name.toUpperCase())) {
            output.push(
              `${x.group ? x.group + "." : ""}${x.name}${
                parameterText(x.parameters ?? {})
              }:${x.value.replace(/\r\n|\r|\n/g, "\\n")}`,
            );
          }
        }
      }
    }
    if (updates.has(p.name)) {
      if (!replaced.has(p.name)) {
        output.push(...updates.get(p.name)!);
        replaced.add(p.name);
      }
    } else output.push(line);
  }
  // Fold at 75 UTF-8 octets, never splitting a code point.
  return output.map((line) => {
    let parts = "";
    let width = 0;
    for (const ch of line) {
      const n = new TextEncoder().encode(ch).length;
      if (width + n > 75) {
        parts += "\r\n ";
        width = 1;
      }
      parts += ch;
      width += n;
    }
    return parts;
  }).join("\r\n") + "\r\n";
}
