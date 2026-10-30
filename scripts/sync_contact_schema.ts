/** Run: deno run --allow-read --allow-write --config supabase/functions/crm-mcp/deno.json scripts/sync_contact_schema.ts */
import { z } from "zod";
import { contactDetailsSchema } from "../supabase/functions/crm-mcp/contact-schema.ts";
const schema = z.toJSONSchema(contactDetailsSchema);
delete schema.$schema;
const path = Deno.args[0]
  ? new URL(Deno.args[0], "file://" + Deno.cwd() + "/")
  : new URL("../sql/008_contact_details.sql", import.meta.url);
const sql = await Deno.readTextFile(path);
await Deno.writeTextFile(
  path,
  sql.replace(
    /\$schema\$[\s\S]*?\$schema\$::json/,
    "$schema$" + JSON.stringify(schema) + "$schema$::json",
  ),
);
