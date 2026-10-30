import type { SupabaseClient } from '@supabase/supabase-js';

type AuditEvent = {
  id: string; sequence: number; transaction_id: number; table_name: string;
  record_id: string; actor_id: string | null; operation: string; occurred_at: string;
  before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null;
  reverts_transaction_id: number | null; reason: string | null;
};
const tables = ['contacts', 'organizations', 'history', 'contact_relationships', 'organization_relationships', 'contact_organization_relationships'];
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const label = (v: string) => v.replaceAll('_', ' ');
const value = (v: unknown) => v === undefined ? '(absent)' : JSON.stringify(v, null, 2);
function differences(row: AuditEvent) {
  const before = row.before_data ?? {};
  const after = row.after_data ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => value(before[k]) !== value(after[k]));
  return `<div class="audit-diff"><table><thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>${keys.map(k => `<tr><th scope="row">${esc(label(k))}</th><td><pre>${esc(value(before[k]))}</pre></td><td><pre>${esc(value(after[k]))}</pre></td></tr>`).join('')}</tbody></table></div>`;
}
function summary(row: AuditEvent) {
  const data = row.after_data ?? row.before_data;
  return `${row.operation} · ${label(row.table_name)} · ${data?.name || data?.kind || row.record_id}`;
}

export function createAuditPage(db: SupabaseClient, root: HTMLElement) {
  let request = 0;
  let offset = 0;
  let table = '';
  let record = '';
  let reviewing: AuditEvent | null = null;
  let rows: AuditEvent[] = [];
  const message = (s: string) => { root.querySelector<HTMLElement>('#audit-status')!.textContent = s; };
  async function load() {
    const token = ++request;
    reviewing = null;
    rows = [];
    root.querySelector('#audit-results')!.replaceChildren();
    root.querySelector<HTMLButtonElement>('#audit-prev')!.disabled = true;
    root.querySelector<HTMLButtonElement>('#audit-next')!.disabled = true;
    root.querySelector('#audit-review')!.replaceChildren();
    message('Loading change history…');
    try {
      let query = db.from('audit_events').select('*').order('sequence', { ascending: false }).range(offset, offset + 49);
      if (table) query = query.eq('table_name', table);
      if (record) query = query.eq('record_id', record);
      const { data, error } = await query;
      if (token !== request) return;
      if (error) throw new Error(error.message);
      rows = data as AuditEvent[];
      root.querySelector('#audit-results')!.innerHTML = rows.map(row => `<article class="audit-entry"><h2>${esc(summary(row))}</h2><p><time datetime="${esc(row.occurred_at)}">${esc(new Date(row.occurred_at).toLocaleString())}</time> · Actor: ${esc(row.actor_id || 'Database/system')}</p><p class="quiet">Record: ${esc(row.record_id)} · Transaction: ${esc(row.transaction_id)}</p>${row.reason ? `<p>Rollback reason: ${esc(row.reason)} (undoes transaction ${esc(row.reverts_transaction_id)})</p>` : ''}<details><summary>Before and after values</summary>${differences(row)}</details><button class="button outline" type="button" data-review-audit="${esc(row.id)}">Review rollback</button></article>`).join('');
      root.querySelector<HTMLButtonElement>('#audit-prev')!.disabled = offset === 0;
      root.querySelector<HTMLButtonElement>('#audit-next')!.disabled = rows.length < 50;
      message(rows.length ? `Showing changes ${offset + 1}–${offset + rows.length}.` : 'No changes recorded for these filters.');
    } catch (error) {
      if (token === request) { root.querySelector('#audit-results')!.replaceChildren(); message(`Could not load history: ${(error as Error).message}`); }
    }
  }
  async function review(id: string) {
    const event = rows.find(row => row.id === id);
    if (!event) return;
    const token = ++request;
    message('Loading all changes in this transaction…');
    try {
      const transaction: AuditEvent[] = [];
      // Explicit pagination avoids silently omitting changes from a large transaction.
      for (let start = 0; ; start += 100) {
        const { data, error } = await db.from('audit_events').select('*').eq('transaction_id', event.transaction_id).order('sequence').range(start, start + 99);
        if (token !== request) return;
        if (error) throw new Error(error.message);
        transaction.push(...data as AuditEvent[]);
        if (data.length < 100) break;
      }
      reviewing = event;
      const slot = root.querySelector<HTMLElement>('#audit-review')!;
      slot.innerHTML = `<section class="audit-review" aria-labelledby="rollback-heading"><h2 id="rollback-heading" tabindex="-1">Review rollback</h2><p>This will undo all ${transaction.length} changes in transaction ${esc(event.transaction_id)}, including related records. Newer edits or dependent records may prevent rollback.</p>${transaction.map(row => `<details><summary>${esc(summary(row))}</summary>${differences(row)}</details>`).join('')}<form id="audit-rollback-form"><label for="rollback-reason">Reason for rollback</label><textarea id="rollback-reason" name="reason" required maxlength="2000" rows="3"></textarea><div class="form-actions"><button class="button primary" type="submit">Undo these changes</button><button class="button subtle" type="button" data-cancel-audit>Cancel</button></div></form></section>`;
      message('Review the changes before undoing this transaction.');
      slot.querySelector<HTMLElement>('h2')!.focus();
    } catch (error) { if (token === request) message((error as Error).message); }
  }
  root.addEventListener('click', async event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.reviewAudit) await review(button.dataset.reviewAudit);
    else if (button.hasAttribute('data-cancel-audit')) { request++; reviewing = null; root.querySelector('#audit-review')!.replaceChildren(); }
    else if (button.id === 'audit-prev' || button.id === 'audit-next') { offset += button.id === 'audit-next' ? 50 : -50; await load(); }
  });
  root.addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    if (form.id === 'audit-filter') {
      table = String(new FormData(form).get('table') || '');
      record = String(new FormData(form).get('record') || '').trim();
      offset = 0;
      await load();
    } else if (form.id === 'audit-rollback-form' && reviewing) {
      const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
      const eventId = reviewing.id;
      const reason = String(new FormData(form).get('reason') || '').trim();
      if (!reason) { message('Enter a reason for rollback.'); return; }
      button.disabled = true;
      const token = ++request;
      try {
        const { error } = await db.rpc('rollback_audit_event', { event_id: eventId, reason });
        if (token !== request) return;
        if (error) throw new Error(error.message);
        offset = 0;
        await load();
        message('Changes undone. The rollback has been recorded in the audit history.');
      } catch (error) { if (token === request) { message(`Rollback failed: ${(error as Error).message}`); button.disabled = false; } }
    }
  });
  return {
    async open(initialTable = '', initialRecord = '') {
      table = initialTable; record = initialRecord; offset = 0;
      root.innerHTML = `<div class="integration-content"><header class="integration-heading"><h1 id="audit-title" tabindex="-1">Audit & history</h1><p>Review saved changes and undo a transaction when needed. History starts when auditing is enabled.</p></header><form id="audit-filter" class="audit-filter"><label>Record type<select name="table"><option value="">All record types</option>${tables.map(t => `<option value="${t}" ${t === table ? 'selected' : ''}>${esc(label(t))}</option>`).join('')}</select></label><label>Record ID (optional)<input name="record" value="${esc(record)}" pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" placeholder="UUID" /></label><button class="button outline" type="submit">Apply filters</button></form><p id="audit-status" role="status"></p><div id="audit-review"></div><div id="audit-results"></div><div class="form-actions"><button class="button subtle" id="audit-prev" type="button" disabled>Previous</button><button class="button subtle" id="audit-next" type="button" disabled>Next</button></div></div>`;
      root.querySelector<HTMLElement>('#audit-title')!.focus();
      await load();
    },
    close() { request++; reviewing = null; rows = []; root.replaceChildren(); },
  };
}
