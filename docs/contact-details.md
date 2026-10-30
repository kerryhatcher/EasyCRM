# Rich contact data

Apply `sql/008_contact_details.sql` after the existing SQL files, before deploying the updated MCP, CardDAV, and website. This additive migration keeps existing contact IDs, owners, history, relationships, primary fields, and authorization policies. It enables Supabase's `pg_jsonschema` extension to enforce the details schema on all writes, including direct REST requests. It does not import any external records.

## Contact fields

`name` is the required display name. It is independent of the structured name parts; changing it does not guess or overwrite first/last names. `company`, `title`, and `info` retain their existing meaning. Contacts representing businesses use `details.kind: "organization"`. That address-book designation does not automatically create or link an EasyCRM organization.

`details` is a validated JSON object available through the Supabase REST contacts resource and the MCP `create_contact`, `update_contact`, `get_contact`, and `list_contacts` tools. Its keys are:

| Key | Value |
| --- | --- |
| `kind` | `person` or `organization` |
| `first_name`, `last_name`, `middle_name`, `name_prefix`, `name_suffix` | Strings; no automatic splitting of display names |
| `department` | Organization unit/department string |
| `nicknames`, `categories` | String arrays (categories display as tags) |
| `birthday` | vCard full/partial date, date-time, or text; `null` clears it |
| `emails`, `phones`, `websites` | Arrays of labeled values |
| `social_profiles`, `instant_messages`, `related_names`, `dates` | Arrays of labeled values |
| `addresses` | Array of structured postal addresses |
| `extra_properties` | Unrecognized vCard properties, retained without interpreting them as instructions |

A labeled value is `{ "value": "...", "label": "Work", "types": ["WORK"], "preferred": true, "parameters": { "TYPE": ["WORK"] } }`. Only `value` is required. At most one entry per collection may be preferred. `types` and `parameters` retain vCard metadata; a custom `label` retains Apple address-book labels. Labels need not be home/work: imported custom labels are supported.

An address has the same optional label/type/preference/parameter fields, with `po_box`, `extended`, `street`, `locality`, `region`, `postal_code`, and `country` strings instead of `value`. Unknown properties have `name`, raw encoded `value`, optional `group`, and optional `parameters` (a map of parameter names to string arrays). Use `extra_properties` only for unmanaged vCard properties; use the named fields for names, phones, email, addresses, and other supported properties.

The existing `carddav_vcard` stores the full source card including unrecognized Apple/vendor properties, photo data when present, and original parameter values. Untouched vCard properties survive round trips. The current original card is available on detailed reads; it is not included in paginated MCP list responses. Raw CardDAV data on legacy records is projected for the detailed MCP read and website without needing an import/backfill process.

## Update semantics and compatibility

`details` updates patch its top-level keys. Omitted keys survive. A provided array replaces that entire array; fetch the current contact before editing to retain its other entries and metadata. Use `[]` to clear a list, `""` to clear a name component, and `null` to clear a birthday. `details` itself cannot be null.

`email` and `phone` remain backward-compatible aliases for the preferred entry, or the first entry if none is preferred. Changing one alias updates that entry while retaining its label, metadata, and other entries. Setting an alias to null removes that primary entry and promotes the next available value; use `details.emails: []` or `details.phones: []` to clear the whole collection. When an array and an alias are both supplied, a changed canonical array takes precedence. This consistency is enforced in a database trigger, including for older clients.

CardDAV PUT is a whole-card replacement and therefore explicitly clears supported properties missing from the new card. CardDAV GET reflects structured edits, preserves unrelated source properties, and folds UTF-8 lines safely. Updating a display name preserves stored structured name components. Updating a labeled collection retains custom labels and parameters. The endpoint still accepts one vCard per PUT and requires UID and a nonblank FN; a bulk importer is outside this change.

### MCP example

```json
{
  "id": "CONTACT_UUID",
  "details": {
    "first_name": "Pat",
    "last_name": "Example",
    "emails": [
      { "value": "pat@example.com", "label": "Work", "types": ["WORK"], "preferred": true },
      { "value": "pat@example.net", "label": "Personal", "types": ["HOME"] }
    ],
    "addresses": [{ "street": "12 Main St", "locality": "Macon", "region": "GA", "country": "US", "label": "Home" }],
    "birthday": "--03-15",
    "categories": ["Friends"]
  }
}
```

For REST, send the same changes without `id` to `PATCH /rest/v1/contacts?id=eq.CONTACT_UUID` using the existing authenticated user session and public API key. Ownership and row-level security remain unchanged. Unknown keys, invalid shapes, multiple preferred entries, and oversized details are rejected. The maximum stored details size is 1 MiB.

The CLI accepts `--details '{...}'` on `add` and `update`; its JSON output includes stored details. The website shows each value and label, structured names, birthdays, tags and additional metadata. Edit details supports adding/removing labeled entries and changing name components; opaque vendor metadata is displayed read-only and retained on save.

## Verification

- Deno tests in `supabase/functions/_shared/vcard-details_test.ts`, `carddav/carddav_test.ts`, and `crm-mcp/mcp_test.ts` cover compatibility, field preservation, explicit clearing, schema validation, discovery, and Unicode folding.
- `tests/contact_details.sql` exercises real Postgres trigger behavior and schema enforcement inside a rolled-back transaction. Run it after the migration in a database that has a contact owner.
- No VCF importer or duplicate-resolution workflow is included.

The MCP schema is defined in `supabase/functions/crm-mcp/contact-schema.ts`. When changing it, run `deno run --allow-read --allow-write --config supabase/functions/crm-mcp/deno.json scripts/sync_contact_schema.ts` to synchronize the SQL check schema before applying a new migration. After this migration has shipped, use a new migration to change the deployed constraint.

## Radio callsigns

Apply `supabase/migrations/20261030220624_contact_callsigns.sql` after the initial rich-details migration. `details.callsigns` is an optional list of up to 100 nonblank radio callsigns (64 characters each), for example `{"details":{"callsigns":["W1GUU","W1GUU/P"]}}`. It is separate from display name, name prefix, and nicknames. The website shows all callsigns and edits one per line; form entries are trimmed, uppercased and deduplicated. The MCP and REST endpoints accept the same list; `[]` clears it. No licensing, ownership, or radio service is inferred from a callsign. CardDAV exchanges these as the custom text property `X-RADIO-CALLSIGN`, preserving escaped list values. Changing a person's name does not change their callsigns.

For future schema changes, pass a new migration path to `scripts/sync_contact_schema.ts`; do not rewrite an already applied migration.
