# EasyCRM

A small personal CRM backed by Supabase. Store contacts, relationships, freeform information, and a dated history of notes, calls, emails, and meetings. The first interface is a Python CLI that returns JSON, so an AI agent can call it as a shell command.

## Web app

The Astro frontend lives in [`web/app/`](web/app/) and runs at `https://crm.kerryhatcher.com`. It signs in with the existing Supabase Auth account and uses the publishable key in the browser. Row-level security remains responsible for record access. The app supports contact and organization search, creation, editing, links, profile images, and contact activity. History entries are append-only. The main menu’s **Connections** page provides copyable CardDAV server, address book, and MCP URLs with sign-in guidance.

```sh
cd web/app
npm install
npm run dev
npm run check
npm run build
npm run deploy
```

`npm run deploy` builds the site and deploys its static assets plus a small image API Worker using `wrangler.jsonc`. Wrangler must be authenticated to the Cloudflare account that owns `kerryhatcher.com`. The `easycrm-media` R2 bucket is private and bound to the Worker as `MEDIA`. Profile images are keyed by record type and ID, are limited to 5 MB JPEG, PNG, or WebP files, and are fetched through the same-origin API with the user's Supabase access token. The Worker checks the record through Supabase row-level security before reading or changing its image. No service-role secret is used. To create the bucket in a new account, run `npx wrangler r2 bucket create easycrm-media` before deployment. Supabase email-code sign-in uses the existing user account; password sign-in is also available. The current OAuth consent page remains at its existing GitHub Pages URL.

## Get started

The database schema is already installed in the **EasyCRM** Supabase project. It is also saved in [`sql/`](sql/) for reference. The CLI uses Typer and runs in a uv-managed Python environment. The project pins Python 3.14 and locks its Python packages in `uv.lock`.

1. Install [uv](https://docs.astral.sh/uv/), then run `uv python install 3.14` and `uv sync --locked` in this directory. uv creates `.venv` and installs the locked packages.
2. Set the project URL and publishable key from `.env.example`, plus the email of your Supabase Auth user:

   ```sh
   export SUPABASE_URL=https://wgfpbkwjrejnlliznfdu.supabase.co
   export SUPABASE_PUBLISHABLE_KEY=sb_publishable_fzbWR-ofh2QQPdv8-o_W_w__rrMIP3d
   export EASYCRM_EMAIL=you@example.com
   ```

3. Create the user in the project's **Authentication → Users** page if needed, or run `uv run python easycrm.py signup` with the variables above. If sign-up asks for email confirmation, confirm the message before using the other commands.
4. Run a command. The CLI prompts for the password when used in a terminal. For noninteractive agents, supply `EASYCRM_PASSWORD` through the agent's secret or environment configuration. Do not pass a password as a CLI argument or commit it to the repository.

   ```sh
   uv run python easycrm.py add --name "Ada Lovelace" --email ada@example.com --company "Analytical Engines" --info "Met at conference"
   uv run python easycrm.py list --search Ada
   uv run python easycrm.py show CONTACT_UUID
   uv run python easycrm.py update CONTACT_UUID --phone "+1 555 0100"
   uv run python easycrm.py note CONTACT_UUID --body "Interested in a follow-up"
   uv run python easycrm.py log CONTACT_UUID --kind call --body "Discussed next steps"
   uv run python easycrm.py history CONTACT_UUID
   uv run python easycrm.py relate FATHER_UUID SON_UUID --as father --inverse son
   uv run python easycrm.py relate SPOUSE_A_UUID SPOUSE_B_UUID --as married
   uv run python easycrm.py relations CONTACT_UUID
   uv run python easycrm.py unrelate RELATIONSHIP_UUID
   ```

`relate` stores one link with a label from each person's point of view. In the first example, the father's `relations` output says `father`; the son's says `son`. Use `--inverse` for a specific label. Common symmetric labels such as `married`, `spouse`, `friend`, and `sibling` default to themselves. Generic family labels also have defaults (`father` → `child`, `son` → `parent`); other labels require `--inverse`. Both contacts must have the same owner. `--notes` adds optional context to the link. `show` includes relationships and the latest 100 history entries.

`--at` on `note` and `log` records an earlier event time in ISO 8601 with a timezone. `list` and `history` support `--limit` (1–100) and `--offset` for paging. Run `uv run python easycrm.py --help` or a subcommand's `--help` for all options.

## Organizations

Organizations have their own name, type (`--kind`), email, phone, website, address, and freeform `info`. The type is freeform, so it can be `business`, `department`, `agency`, `club`, or something else. The existing contact `company` field remains free text; use a contact–organization link when you want a structured relationship.

```sh
uv run python easycrm.py org-add --name "Example Agency" --kind agency --email hello@example.org --phone "+1 555 0100" --website https://example.org --address "10 Main St" --info "Regional office"
uv run python easycrm.py org-list --search Example
uv run python easycrm.py org-show ORGANIZATION_UUID
uv run python easycrm.py org-update ORGANIZATION_UUID --phone "+1 555 0101"

uv run python easycrm.py org-relate DEPARTMENT_UUID AGENCY_UUID --as "part of" --inverse "has department"
uv run python easycrm.py org-relations DEPARTMENT_UUID
uv run python easycrm.py org-unrelate RELATIONSHIP_UUID

uv run python easycrm.py org-link-contact AGENCY_UUID CONTACT_UUID --as employs --inverse employee
uv run python easycrm.py org-contacts AGENCY_UUID
uv run python easycrm.py contact-orgs CONTACT_UUID
uv run python easycrm.py org-unlink-contact LINK_UUID
```

`org-show` includes its related organizations and contacts; contact `show` includes its organizations. The `--as` label is from the first record's point of view, and `--inverse` is from the other record's point of view. Both records in a link must have the same owner. `org-relate` defaults the inverse for `partner`, `affiliate`, and `peer`; other organization labels need `--inverse`. Links can carry optional `--notes`. Organizations may be shared by many contacts, and contacts may link to many organizations.

## Agent use

For an agent with shell access, give it the path to `easycrm.py`, the environment variables above, and permission to run `uv run python easycrm.py` commands. Each successful command prints one JSON value; CRM errors print a JSON object to stderr and exit nonzero.

The publishable key is safe to distribute. The Auth password and access token are secrets. Every command signs in as the user. Supabase row-level security limits regular users to their own records. A user with `app_metadata.crm_role = "admin"` can read and update all contacts and organizations, add or read history, and manage relationships for any owner's records. Only a trusted Supabase administrator should assign this role; a fresh sign-in is needed after changing it. The CLI never uses a service-role key. History entries are append-only through the CLI; there is no delete command.

## Web MCP endpoint

The remote MCP URL is:

`https://crm-api.kerryhatcher.com/functions/v1/crm-mcp`

Add this as an HTTP MCP server in a client that supports OAuth. The endpoint returns an OAuth challenge and protected resource metadata so the client can discover Supabase Auth automatically. Sign in in the browser with your CRM email and a one-time email code (or your password if email is unavailable), then approve the client on the [EasyCRM consent page](https://kerryhatcher.github.io/EasyCRM/consent.html). The client stores OAuth tokens instead of your account password. The OAuth server uses authorization code with PKCE; the function validates bearer tokens and makes all database calls as the signed-in user, so existing row-level security applies. No service-role key is used.

The MCP server supports listing, reading, creating, and updating contacts and organizations; listing and adding contact history; and listing, linking, and unlinking person and organization relationships. The function source is in [`supabase/functions/crm-mcp/`](supabase/functions/crm-mcp/). The static consent page source is [`web/consent.html`](web/consent.html), published from the repository's `gh-pages` branch. Supabase Edge Functions cannot render HTML on the shared project domain, so the browser page is on GitHub Pages while the MCP API and OAuth issuer remain on Supabase.

The Supabase project's OAuth Server is enabled with authorization path `/EasyCRM/consent.html`, Site URL `https://kerryhatcher.github.io`, and a passwordless redirect allowlist entry for `https://kerryhatcher.github.io/EasyCRM/consent.html?authorization_id=*`. Public dynamic client registration is disabled. Register each trusted MCP client in **Authentication → OAuth Apps** with its exact callback URL. Use a public PKCE client for Codex desktop, with no client secret. Then add the returned client ID to Codex's MCP configuration before signing in.

This Codex desktop installation is configured as the public OAuth app `Codex desktop — EasyCRM` with client ID `a2e7f395-924f-45c9-8efd-03456f1ab2dd`. Its registered callback is `http://127.0.0.1:43395/callback/pkXYiXPM-AKr`; Codex uses that fixed local port for login. To reconnect, run `codex mcp login easycrm --scopes openid,email,offline_access`. Other MCP clients need their own OAuth app and exact callback registration.

## API domain hosting

`crm-api.kerryhatcher.com` is the native Supabase custom domain for project `wgfpbkwjrejnlliznfdu`, using Supabase's Custom Domain add-on ($10/month, billed hourly). Cloudflare hosts a DNS-only CNAME pointing to `wgfpbkwjrejnlliznfdu.supabase.co`; proxying is disabled. Supabase manages TLS and serves the API directly, with no Cloudflare Worker in the request path. Keep the `_acme-challenge.crm-api.kerryhatcher.com` TXT validation record for certificate management. The original Supabase URLs remain available.

The MCP function explicitly advertises `https://wgfpbkwjrejnlliznfdu.supabase.co/auth/v1` as its OAuth issuer so discovery matches Supabase Auth on both API hostnames. Its resource URL follows the hostname used by the client. Verify with `DENO_DIR=.deno deno test --allow-env --config supabase/functions/crm-mcp/deno.json supabase/functions/crm-mcp/mcp_test.ts`.

## CardDAV phone sync

The deployed CardDAV endpoint is:

`https://crm-api.kerryhatcher.com/functions/v1/carddav/`

In a CardDAV client, use that **full HTTPS URL**, the Supabase Auth user's email as the username, and that user's password. If the client asks for the address book URL, use:

`https://crm-api.kerryhatcher.com/functions/v1/carddav/addressbooks/default/`

The endpoint supports CardDAV discovery, vCard 3.0/4.0, contact reads and writes, ETags, and soft deletion. It syncs **your own contacts** even when your CRM account is an admin. Name, email, phone, company, title, and info map to vCard fields; extra fields uploaded by the phone are retained in the vCard. CRM history, organizations, and relationship links are not part of the phone address book. Deleting a contact on the phone hides it from the CLI and CardDAV while retaining its database row, history, and relationships.

The phone stores your Supabase account password for HTTP Basic authentication. Use only an HTTPS CardDAV client you trust. Use the full `/functions/v1/carddav/` account URL. The native Supabase domain does not redirect the domain root or `/.well-known/carddav`; clients that insist on root discovery need an advanced setting for the full URL.

You can check the endpoint without sending credentials:

```sh
curl -i -X OPTIONS https://crm-api.kerryhatcher.com/functions/v1/carddav/
```

The function source is in [`supabase/functions/carddav/`](supabase/functions/carddav/). Its tests run with `deno test --config supabase/functions/carddav/deno.json supabase/functions/carddav/carddav_test.ts`.

## Development checks

Ruff is a uv development dependency. Run these from the project directory:

```sh
uv run ruff format --check .
uv run ruff check .
uv run python -m unittest discover -s tests
```
