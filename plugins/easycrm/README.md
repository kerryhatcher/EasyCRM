# EasyCRM plugin

An Agent Plugins 1.0 package connecting ChatGPT-compatible hosts to the existing
EasyCRM MCP server. The package includes the MCP connection, a CRM workflow
skill, and the existing EasyCRM icon. It creates no separate backend.

## Build and share

From the repository root:

```sh
python scripts/package_plugin.py --output /tmp/easycrm-plugin.zip
```

The ZIP contains one `easycrm/` directory. Share that archive or the source in
this directory. Install/import it using the host's plugin workflow. An account
plugin saved privately is not automatically published to the public directory.
Each user connects their own EasyCRM account; the package grants no database
access by itself.

## OAuth setup

Server: `https://crm-api.kerryhatcher.com/functions/v1/crm-mcp`

Issuer: `https://wgfpbkwjrejnlliznfdu.supabase.co/auth/v1`

The production server uses Supabase OAuth with authorization code and PKCE.
Public dynamic client registration is disabled. For a new host connection:

1. Open the host's MCP connection management page and copy its exact OAuth
   redirect URI. Do not reuse the Codex desktop client's localhost callback or
   guess ChatGPT's callback; it can be connection-specific.
2. In Supabase **Authentication → OAuth Apps**, register the host as a public
   PKCE client with that exact redirect URI and no client secret.
3. Configure the host connection with the returned client ID and token endpoint
   authentication method `none`. Request `openid email offline_access`.
4. Connect and complete EasyCRM sign-in and consent in the browser.
5. Verify a read-only search before attempting edits.

When packaging for a host that requires an explicit provided client, add the
following verified registration under the server's
`extensions.com.openai.auth` and rebuild (the public client ID is not a secret):

```json
"client": {
  "mode": "provided",
  "clientId": "YOUR_REGISTERED_PUBLIC_CLIENT_ID",
  "tokenEndpointAuthMethod": "none"
}
```

The generic shared source leaves the host-specific client configuration unset.
Do not ship passwords, access tokens, refresh tokens, or client secrets. Forks
using a different backend must update the MCP URL, OAuth registration, publisher
metadata, and skill instructions to match that backend.

## Capabilities

- Find, create, and update contacts and organizations.
- Read contact history and append notes, calls, emails, meetings, and other events.
- Read, create, and remove relationships between contacts and organizations.

History is append-only. Contact and organization deletion is not exposed through
MCP. The plugin has no email-sending or calendar-sync functionality. The source
of the tools is `supabase/functions/crm-mcp/` at the repository root.

## Validation

The packaging script checks identity, manifest fields, the connection transport,
OAuth configuration, skill frontmatter, contained icon paths, and archive
contents. It includes only the plugin files and rejects symlinks. Run
`python -m unittest discover -s tests` to run the repository tests, including
packaging checks.

This package is MIT licensed; see `LICENSE`. The icon derives from the
repository's `web/app/public/favicon.svg`.
