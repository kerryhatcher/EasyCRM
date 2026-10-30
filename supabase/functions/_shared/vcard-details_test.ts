import { strict as assert } from "node:assert";
import {
  cardCompany,
  cardLines,
  readCardDetails,
  renderContactCard,
} from "./vcard-details.ts";
const raw =
  "BEGIN:VCARD\r\nVERSION:3.0\r\nUID:test-rich\r\nN:van Example;Pat;Jo;Dr.;Jr.\r\nFN:Dr. Pat Jo van Example Jr.\r\nORG:Example Inc.;Support\r\nitem1.EMAIL;TYPE=HOME:home@example.test\r\nitem1.X-ABLabel:Personal\r\nitem2.EMAIL;TYPE=WORK;PREF=1:work@example.test\r\nitem2.X-ABLabel:Office\r\nTEL;TYPE=CELL:111\r\nTEL;TYPE=WORK:222\r\nADR;TYPE=HOME:;;12 Main\\; Apt 2;Town;GA;12345;US\r\nBDAY:--03-15\r\nCATEGORIES:Friends,Work\\, old\r\nX-SOCIALPROFILE;TYPE=twitter:https://example.test/pat\r\nX-CUSTOM;TYPE=thing:opaque\\;value\r\nPHOTO;ENCODING=b:YWJj\r\nEND:VCARD\r\n";
const contact = () => ({
  id: "test-rich",
  name: "Dr. Pat Jo van Example Jr.",
  email: "work@example.test",
  phone: "111",
  company: "Example Inc.",
  title: null,
  info: null,
  carddav_vcard: raw,
  details: readCardDetails(raw),
});
Deno.test("extracts structured names, labeled multivalues, addresses, dates and unknown data", () => {
  const d = readCardDetails(raw);
  assert.equal(d.last_name, "van Example");
  assert.equal(d.middle_name, "Jo");
  assert.equal(d.emails?.[1].label, "Office");
  assert.equal(d.emails?.[1].preferred, true);
  assert.equal(d.addresses?.[0].street, "12 Main; Apt 2");
  assert.deepEqual(d.categories, ["Friends", "Work, old"]);
  assert.equal(d.birthday, "--03-15");
  assert.equal(d.department, "Support");
  assert.equal(
    d.extra_properties?.find((p) => p.name === "PHOTO")?.value,
    "YWJj",
  );
});
Deno.test("display-name and legacy primary edits preserve name parts, labels and other values", () => {
  const c = contact();
  c.name = "Pat Example";
  c.email = "updated@example.test";
  c.phone = "333";
  const out = renderContactCard(c);
  const d = readCardDetails(out);
  assert.equal(d.last_name, "van Example");
  assert.equal(d.name_prefix, "Dr.");
  assert.equal(d.emails?.length, 2);
  assert.equal(d.emails?.[1].value, "updated@example.test");
  assert.equal(d.emails?.[1].label, "Office");
  assert.equal(d.phones?.[1].value, "222");
  assert.match(out, /X-CUSTOM;TYPE=thing:opaque\\;value/);
  assert.match(out, /PHOTO;ENCODING=b:YWJj/);
});
Deno.test("structured edits and explicit clears round trip without reviving raw data", () => {
  const c = contact();
  c.details.last_name = "New Family";
  c.details.addresses = [];
  c.details.categories = [];
  c.details.birthday = null;
  c.details.extra_properties = [];
  const d = readCardDetails(renderContactCard(c));
  assert.equal(d.last_name, "New Family");
  assert.deepEqual(d.addresses, []);
  assert.equal(d.birthday, null);
  assert.deepEqual(d.categories, []);
  assert.deepEqual(d.extra_properties, []);
});
Deno.test("fresh rich cards fold Unicode safely and escape injected line breaks", () => {
  const c = {
    ...contact(),
    carddav_vcard: null,
    details: {
      ...contact().details,
      extra_properties: [{
        name: "X-TEST",
        value: "value\r\nEMAIL:injected@example.test",
      }],
    },
    name: "あ".repeat(60),
  };
  const out = renderContactCard(c);
  assert(cardLines(out).some((v) => v === "FN:" + "あ".repeat(60)));
  assert.equal(readCardDetails(out).emails?.length, 2);
  assert(!out.includes("\r\nEMAIL:injected"));
  for (const line of out.split("\r\n")) {
    assert(new TextEncoder().encode(line).length <= 75);
  }
});
Deno.test("legacy cards without structured projections retain every raw value", () => {
  const c = { ...contact(), details: {}, email: "replacement@example.test" };
  const d = readCardDetails(renderContactCard(c));
  assert.equal(d.emails?.length, 2);
  assert.equal(d.emails?.[1].label, "Office");
  assert.equal(d.last_name, "van Example");
  assert.equal(d.addresses?.length, 1);
});

Deno.test("organization names containing escaped separators remain intact", () => {
  assert.equal(
    cardCompany("BEGIN:VCARD\r\nORG:ACME\\; Partners;Support\r\nEND:VCARD"),
    "ACME; Partners",
  );
});

Deno.test("vCard versions retain compatible preference and phone URI syntax", () => {
  const c = contact();
  c.email = "new@example.test";
  const v3 = renderContactCard(c);
  assert.match(v3, /TYPE="WORK","PREF"/);
  c.carddav_vcard = c.carddav_vcard.replace("VERSION:3.0", "VERSION:4.0");
  c.phone = "+15550101";
  const v4 = renderContactCard(c);
  assert.match(v4, /TEL;TYPE="CELL":tel:\+15550101/);
  assert.match(v4, /PREF="1"/);
});

Deno.test("radio callsigns round trip separately from names and can be cleared", () => {
  const c = contact();
  c.name = "Gary Ames";
  c.details.first_name = "Gary";
  c.details.last_name = "Ames";
  c.details.name_prefix = "";
  c.details.callsigns = ["W1GUU", "W1GUU/P"];
  const rendered = renderContactCard(c);
  const parsed = readCardDetails(rendered);
  assert.deepEqual(parsed.callsigns, ["W1GUU", "W1GUU/P"]);
  assert.equal(parsed.first_name, "Gary");
  assert.equal(parsed.name_prefix, "");
  assert.match(rendered, /FN:Gary Ames/);
  assert(!parsed.extra_properties?.some((p) => p.name === "X-RADIO-CALLSIGN"));
  const cleared = renderContactCard({
    ...c,
    carddav_vcard: rendered,
    details: { ...c.details, callsigns: [] },
  });
  assert.deepEqual(readCardDetails(cleared).callsigns, []);
});
