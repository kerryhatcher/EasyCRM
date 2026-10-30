import { createMcpHandler } from "@modelcontextprotocol/server";
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";

import type { Database } from "./database.types.ts";
import { buildServer } from "./tools.ts";

export const handle = pipeline(
  [
    withOAuthProtectedResource({
      // Supabase Auth retains this issuer when a custom API domain is active.
      authorizationServer: "https://wgfpbkwjrejnlliznfdu.supabase.co/auth/v1",
    }),
    withSupabase<Database>({ auth: "user" }),
  ],
  (request, { supabase }) =>
    createMcpHandler(() => buildServer(supabase)).fetch(request),
);

if (import.meta.main) Deno.serve(handle);
