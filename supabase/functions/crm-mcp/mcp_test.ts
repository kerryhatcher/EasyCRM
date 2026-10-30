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
  assert.match(body, /list_audit_events/);
  assert.match(body, /rollback_audit_event/);
  assert.match(body, /transaction_id/);
  assert.match(body, /link_contact_organization/);
});

Deno.test("rich contact tool schemas reject invalid payloads and expose patch semantics", async () => {
  const { contactDetailsSchema } = await import("./contact-schema.ts");
  assert.equal(
    contactDetailsSchema.safeParse({ emails: "not an array" }).success,
    false,
  );
  assert.equal(
    contactDetailsSchema.safeParse({ owner_id: "injected" }).success,
    false,
  );
  assert.equal(
    contactDetailsSchema.safeParse({
      emails: [{ value: "a", preferred: true }, {
        value: "b",
        preferred: true,
      }],
    }).success,
    false,
  );
  assert.equal(
    contactDetailsSchema.safeParse({
      first_name: "Pat",
      emails: [{ value: "pat@example.test", label: "Home" }],
      addresses: [{ street: "Main St" }],
      birthday: "--02-29",
    }).success,
    true,
  );
});

Deno.test("audit tools apply transaction filters and surface rollback conflicts", async () => {
  const calls: unknown[] = [];
  const query = Object.assign(Promise.resolve({ data: [], error: null }), {
    select(value: string) {
      calls.push(["select", value]);
      return this;
    },
    order(...args: unknown[]) {
      calls.push(["order", ...args]);
      return this;
    },
    range(...args: unknown[]) {
      calls.push(["range", ...args]);
      return this;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", ...args]);
      return this;
    },
  });
  const client = {
    from(name: string) {
      calls.push(["from", name]);
      return query;
    },
    rpc(name: string, args: unknown) {
      calls.push(["rpc", name, args]);
      return Promise.resolve({
        data: null,
        error: { message: "Newer changes exist. Roll them back first." },
      });
    },
  } as unknown as SupabaseClient<Database>;
  const handler = createMcpHandler(() => buildServer(client));
  async function call(name: string, args: unknown) {
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
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    assert.equal(response.status, 200);
    return await response.text();
  }
  await call("list_audit_events", {
    transaction_id: "123",
    limit: 10,
    offset: 20,
  });
  assert.ok(calls.some((c) => JSON.stringify(c) === '["from","audit_events"]'));
  assert.ok(
    calls.some((c) => JSON.stringify(c) === '["eq","transaction_id",123]'),
  );
  assert.ok(calls.some((c) => JSON.stringify(c) === '["range",20,29]'));
  const event = "30000000-0000-4000-8000-000000000001";
  const result = await call("rollback_audit_event", {
    event_id: event,
    reason: "Fix accidental edit",
  });
  assert.match(result, /Newer changes exist/);
  assert.match(result, /"isError":true/);
  assert.deepEqual(calls.at(-1), ["rpc", "rollback_audit_event", {
    event_id: event,
    reason: "Fix accidental edit",
  }]);
});

Deno.test("callsign lists validate without imposing a particular radio service format", async () => {
  const { contactDetailsSchema } = await import("./contact-schema.ts");
  assert(
    contactDetailsSchema.safeParse({ callsigns: ["W1GUU", "W1GUU/P"] }).success,
  );
  assert(!contactDetailsSchema.safeParse({ callsigns: "W1GUU" }).success);
  assert(!contactDetailsSchema.safeParse({ callsigns: [""] }).success);
  assert(!contactDetailsSchema.safeParse({ callsigns: [42] }).success);
});
