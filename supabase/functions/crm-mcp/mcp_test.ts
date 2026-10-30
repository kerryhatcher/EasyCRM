import { createMcpHandler } from "@modelcontextprotocol/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strict as assert } from "node:assert";

import type { Database } from "./database.types.ts";
import { buildServer } from "./tools.ts";
import { handle } from "./index.ts";

Deno.test("custom-domain discovery retains the Supabase Auth issuer", async () => {
  const response = await handle(
    new Request(
      "http://edge-runtime/crm-mcp/oauth-protected-resource",
      {
        headers: {
          "X-Forwarded-Host": "crm-api.kerryhatcher.com",
          "X-Forwarded-Proto": "https",
        },
      },
    ),
  );
  assert.equal(response.status, 200);
  const metadata = await response.json();
  assert.equal(
    metadata.resource,
    "https://crm-api.kerryhatcher.com/functions/v1/crm-mcp",
  );
  assert.deepEqual(metadata.authorization_servers, [
    "https://wgfpbkwjrejnlliznfdu.supabase.co/auth/v1",
  ]);
});

Deno.test("registers CRM tools on the MCP HTTP transport", async () => {
  const client = null as unknown as SupabaseClient<Database>;
  const handler = createMcpHandler(() => buildServer(client));
  const response = await handler.fetch(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    }),
  );
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /list_contacts/);
  assert.match(body, /link_contact_organization/);
});
