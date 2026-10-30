# Audit history and rollback

EasyCRM records every successful INSERT, UPDATE, and DELETE on `contacts`,
`organizations`, `history`, `contact_relationships`, `organization_relationships`,
and `contact_organization_relationships` in `public.audit_events`. Database row
triggers cover web, CLI, MCP, CardDAV, and trusted SQL writes, including soft
contact deletion and foreign-key cascades. Failed or rolled-back transactions
leave no audit entries. Reads/searches are not audited.

Each entry retains a complete before/after row, owner, authenticated actor UUID
(or null for system SQL without user claims), time, operation, record type/UUID,
and database transaction ID. Existing contact activity (`history`) remains
separate from this change log. There is no retrospective history before the
migration is applied. Profile-image bytes in R2, authentication settings, and
schema/DDL changes are outside this record audit; images are not versioned by it.

## Use

- Web: select **Audit & history**, optionally filter by record type and UUID, and
  expand **Before and after values**. A contact or organization's **Change
  history** button filters to that row. The global audit includes activity and
  relationship changes, including deleted records.
- Select **Review rollback** to inspect all entries in the same transaction, then
  enter a reason and choose **Undo these changes**. The review loads every page
  of transaction entries even when the list is filtered to one record.
- CLI:

  ```sh
  uv run python easycrm.py audit --table contacts --record CONTACT_UUID
  uv run python easycrm.py audit --transaction TRANSACTION_ID --limit 100 --offset 0
  uv run python easycrm.py rollback AUDIT_EVENT_UUID --reason "Correct accidental edit"
  ```

- MCP: `list_audit_events` accepts optional `table_name`, `record_id`, and
  `transaction_id` filters, plus `limit`/`offset`. Review all pages for the
  transaction before calling `rollback_audit_event` with `event_id` and `reason`.

## Rollback behavior and permissions

Rollback undoes **the entire database transaction containing the selected event**.
Ordinary API calls usually change one row, but cascades and SQL batches can change
several. Restoring parents and child links happens atomically in dependency order;
multiple changes to one row reverse in order. A failure restores none of the rows.

Newer edits must be undone first. Rollback checks both the latest event and the
current values, rejects an already-undone transaction, and refuses to silently
remove dependents created later. Exact current row values must match the selected
version (apart from the synchronization timestamp). Successive undos can step back
through versions. Uniqueness/check constraints still apply; missing parents and
schema changes can prevent restoration. A failed rollback reports the conflict.

Every rollback creates new audit entries linked by `reverts_transaction_id`, with
the new actor and required reason. Original audit entries remain intact. A rollback
can itself be undone using its new event ID. Restored contacts and organizations receive a fresh
`updated_at` (including phone synchronization for contacts); original record IDs and creation times
are preserved. Existing APIs still expose their previous write permissions;
undoing an activity creation is a controlled exception to append-only activity.

Owners may read/undo only their records. Admins (`app_metadata.crm_role = admin`)
may read/undo all owners' records. An owner cannot undo a transaction spanning
another owner's records. Authenticated users have SELECT access to the audit table
with row-level security, and cannot insert, edit, or delete audit entries directly.
Anonymous users have no audit access. Private trigger/rollback helpers are not
API-callable; the public rollback RPC authenticates and authorizes every affected
owner before restoring snapshots. No service-role key is added to clients.

Database administrators remain trusted: they can disable triggers or alter tables.
This is an application audit, not an externally sealed compliance archive. Audit
snapshots retain deleted personal data; no automatic retention/purge is configured.
Rollback briefly locks the six CRM tables against concurrent writes, prioritizing
correctness for this small personal CRM.

## Deploy

1. Ensure `sql/001_initial.sql` through `sql/008_contact_details.sql` are installed.
2. Apply `supabase/migrations/20261030215720_audit_history.sql` once using the SQL
   editor or the project's migration deployment process. Existing installations
   manage the earlier schema in `sql/`; do not replay that baseline or run a blind
   `db push` against a project whose migration history has not been reconciled.
3. Deploy the updated `crm-mcp` Edge Function and web app through their usual
   deployment process. CLI changes work once the migration is installed. CardDAV
   requires no changes for capture: its database writes trigger the audit.
4. As a signed-in owner, create/edit a disposable record, open its change history,
   and undo the edit. Check the restored values and new audit entry. Repeat with
   an admin, and check that another ordinary owner cannot read/undo those events.

These source changes do not deploy themselves. Keep the migration installed if
rolling back frontend/function code; otherwise future writes would stop auditing.

## Verify locally

```sh
npm install --prefix /tmp/easycrm-audit-tests --cache /tmp/easycrm-npm-cache \
  --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
NODE_PATH=/tmp/easycrm-audit-tests/node_modules node tests/audit_history_test.cjs
uv run ruff format --check .
uv run ruff check .
uv run python -m unittest discover -s tests
DENO_DIR=.deno deno test --allow-env --config supabase/functions/crm-mcp/deno.json \
  supabase/functions/crm-mcp/mcp_test.ts
cd web/app
npm run check
npm run build
```

The PostgreSQL suite installs the real migrations into an isolated PGlite database
and exercises triggers, RLS/grants, administrator access, conflicts, exact rich
field restoration, soft/hard deletion, cascades, links, transaction grouping, and
successive undos. PGlite does not include `pg_jsonschema`; this harness stubs only
that extension's validation function. Production still uses its real constraint.
Browser checks use a local app with mocked authenticated API responses; database
semantics are verified separately by the PostgreSQL suite. Production deployment,
real OAuth sessions, and concurrent multi-connection writes need deployment smoke
tests. The rollback locks and conflict checks are implemented in PostgreSQL.
