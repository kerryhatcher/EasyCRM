import { createAuditPage } from './audit';
import { effectiveContactDetails } from '../../../supabase/functions/_shared/vcard-details';
import { contactDetailFields, contactDetailsForm, readContactDetails, addContactValue, type ContactDetails } from './contact-fields';
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  'https://wgfpbkwjrejnlliznfdu.supabase.co',
  'sb_publishable_fzbWR-ofh2QQPdv8-o_W_w__rrMIP3d',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

type View = 'contacts' | 'organizations';
type Contact = { carddav_vcard?: string | null; details?: ContactDetails; id: string; owner_id: string; name: string; email: string | null; phone: string | null; company: string | null; title: string | null; info: string | null; created_at: string; updated_at: string };
type Organization = { id: string; owner_id: string; name: string; kind: string; email: string | null; phone: string | null; website: string | null; address: string | null; info: string | null; created_at: string; updated_at: string };
type History = { id: string; kind: string; body: string; happened_at: string };
type Link = { id: string; name: string; label: string; target_id: string; notes: string | null };
type RecordRow = Contact | Organization;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0] || '').join('').toUpperCase();
const humanDate = (value: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const show = (el: HTMLElement, visible: boolean) => { el.hidden = !visible; };
const optional = (value: FormDataEntryValue | null) => String(value ?? '').trim() || null;
const requireData = <T>(result: { data: T | null; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error('Record not found or inaccessible.');
  return result.data;
};

let view: View = 'contacts';
let connectionsOpen = false;
let auditOpen = false;
const auditPage = createAuditPage(db, document.querySelector<HTMLElement>('#audit-page')!);
let records: RecordRow[] = [];
let selectedId: string | null = null;
let selected: RecordRow | null = null;
let offset = 0;
let total = 0;
let search = '';
let listRequest = 0;
let detailRequest = 0;
let creating = false;
let composerOpen = false;
let linkForm: 'person' | 'organization' | null = null;
let historyFilter = 'all';
let historyLimit = 100;
let linkSearchRequest = 0;
let toastTimer: number | undefined;
let currentUserId: string | null = null;
const imageCache = new Map<string, Promise<string | null>>();

function avatarMarkup(row: RecordRow, size: 'small' | 'large') {
  return `<span class="avatar ${size}" data-avatar-kind="${view}" data-avatar-id="${esc(row.id)}" data-initials="${esc(initials(row.name))}">${esc(initials(row.name))}</span>`;
}

function clearImageCache() {
  for (const image of imageCache.values()) void image.then((url) => { if (url) URL.revokeObjectURL(url); });
  imageCache.clear();
}

function forgetImage(kind: View, id: string) {
  const key = `${kind}:${id}`;
  const image = imageCache.get(key);
  if (image) void image.then((url) => { if (url) URL.revokeObjectURL(url); });
  imageCache.delete(key);
}

async function imageToken() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) throw new Error('Sign in to manage images.');
  return session.access_token;
}

async function imageUrl(kind: View, id: string): Promise<string | null> {
  const key = `${kind}:${id}`;
  if (!imageCache.has(key)) {
    imageCache.set(key, (async () => {
      const token = await imageToken();
      const response = await fetch(`/api/profile-images/${kind}/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Could not load image.');
      return URL.createObjectURL(await response.blob());
    })().catch(() => { imageCache.delete(key); return null; }));
  }
  return imageCache.get(key)!;
}

async function hydrateAvatars(root: HTMLElement) {
  const avatars = root.querySelectorAll<HTMLElement>('[data-avatar-id]');
  await Promise.all(Array.from(avatars, async (avatar) => {
    const kind = avatar.dataset.avatarKind as View;
    const id = avatar.dataset.avatarId!;
    const url = await imageUrl(kind, id);
    if (!avatar.isConnected || avatar.dataset.avatarId !== id) return;
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      avatar.replaceChildren(img);
      avatar.classList.add('has-image');
    } else {
      avatar.textContent = avatar.dataset.initials || '';
      avatar.classList.remove('has-image');
    }
    if (avatar.classList.contains('large')) {
      const remove = root.querySelector<HTMLButtonElement>('[data-action="remove-photo"]');
      if (remove) show(remove, Boolean(url));
    }
  }));
}

async function changeProfileImage(file?: File) {
  if (!selected || !selectedId) return;
  if (file && (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024)) {
    throw new Error('Choose a JPEG, PNG, or WebP image no larger than 5 MB.');
  }
  const kind = view;
  const id = selectedId;
  const response = await fetch(`/api/profile-images/${kind}/${id}`, {
    method: file ? 'PUT' : 'DELETE',
    headers: { Authorization: `Bearer ${await imageToken()}`, ...(file ? { 'Content-Type': file.type } : {}) },
    body: file,
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || 'Could not save image.');
  }
  forgetImage(kind, id);
  await Promise.all([hydrateAvatars($('#record-list')), hydrateAvatars($('#detail-panel'))]);
  toast(file ? 'Profile image saved.' : 'Profile image removed.');
}

function toast(message: string, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  show(node, true);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => show(node, false), 4500);
}

function renderList() {
  const list = $('#record-list');
  if (!records.length) {
    list.innerHTML = `<div class="list-empty"><h2>${search ? 'No matches found' : `No ${view} yet`}</h2><p>${search ? 'Try a different name.' : `Add your first ${view === 'contacts' ? 'contact' : 'organization'} to get started.`}</p></div>`;
  } else {
    list.innerHTML = records.map((row) => {
      const subtitle = view === 'contacts'
        ? [((row as Contact).title), ((row as Contact).company)].filter(Boolean).join(' · ')
        : [(row as Organization).kind, (row as Organization).email].filter(Boolean).join(' · ');
      return `<button class="record-row ${selectedId === row.id ? 'selected' : ''}" type="button" data-id="${esc(row.id)}" aria-current="${selectedId === row.id ? 'true' : 'false'}">${avatarMarkup(row, 'small')}<span class="record-copy"><strong>${esc(row.name)}</strong><span>${esc(subtitle || (view === 'contacts' ? 'Contact' : 'Organization'))}</span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg></button>`;
    }).join('');
  }
  $('#record-count').textContent = `${total} ${view === 'contacts' ? (total === 1 ? 'contact' : 'contacts') : (total === 1 ? 'organization' : 'organizations')}`;
  show($('#load-more'), records.length < total);
  void hydrateAvatars(list);
}

async function loadList(append = false) {
  const request = ++listRequest;
  if (!append) { offset = 0; records = []; $('#record-list').innerHTML = '<div class="list-loading"><span></span><span></span><span></span><span></span></div>'; }
  const term = search.replace(/[%_,()]/g, '').trim();
  let query = db.from(view).select('*', { count: 'exact' }).order('name').range(offset, offset + 49);
  if (view === 'contacts') query = query.is('deleted_at', null);
  if (term) query = query.ilike('name', `%${term}%`);
  const { data, error, count } = await query;
  if (request !== listRequest) return;
  if (error) { $('#record-list').innerHTML = `<div class="list-empty"><h2>Could not load records</h2><p>${esc(error.message)}</p><button class="button subtle" id="retry-list" type="button">Try again</button></div>`; return; }
  records = append ? [...records, ...(data as RecordRow[])] : (data as RecordRow[]);
  total = count ?? records.length;
  offset = records.length;
  renderList();
  if (!append && !selectedId && records.length) selectRecord(records[0].id);
  if (!append && !records.length) renderBlankDetail();
}

function renderBlankDetail() {
  selected = null;
  selectedId = null;
  $('#detail-panel').innerHTML = `<div class="detail-empty"><h2>${view === 'contacts' ? 'Every connection starts somewhere.' : 'Keep the organizations around your people in view.'}</h2><p>${view === 'contacts' ? 'Choose a contact from the list or add someone new.' : 'Choose an organization from the list or add one now.'}</p></div>`;
}

async function selectRecord(id: string) {
  selectedId = id;
  creating = false;
  composerOpen = false;
  linkForm = null;
  historyFilter = 'all';
  historyLimit = 100;
  renderList();
  $('#detail-panel').innerHTML = '<div class="detail-loading"><span class="avatar"></span><span></span><span></span><span></span></div>';
  const request = ++detailRequest;
  try {
    const row = requireData(await db.from(view).select('*').eq('id', id).single()) as RecordRow;
    if (request !== detailRequest) return;
    if (view === 'contacts') { const c = row as Contact; c.details = effectiveContactDetails({ ...c, carddav_vcard: c.carddav_vcard ?? null }); }
    selected = row;
    if (view === 'contacts') await renderContact(row as Contact, request);
    else await renderOrganization(row as Organization, request);
    $('#detail-panel').classList.add('mobile-active');
  } catch (error) {
    if (request === detailRequest) $('#detail-panel').innerHTML = `<div class="detail-empty"><h2>Could not open this record</h2><p>${esc((error as Error).message)}</p></div>`;
  }
}

async function contactLinks(contact: Contact) {
  const [peopleResult, orgResult] = await Promise.all([
    db.from('contact_relationships').select('id,contact_id,related_contact_id,relationship,inverse_relationship,notes').eq('owner_id', contact.owner_id).or(`contact_id.eq.${contact.id},related_contact_id.eq.${contact.id}`),
    db.from('contact_organization_relationships').select('id,organization_id,contact_relationship,notes').eq('contact_id', contact.id),
  ]);
  const peopleRows = requireData(peopleResult);
  const orgRows = requireData(orgResult);
  const peopleIds = peopleRows.map((link) => link.contact_id === contact.id ? link.related_contact_id : link.contact_id);
  const orgIds = orgRows.map((link) => link.organization_id);
  const [peopleNames, orgNames] = await Promise.all([
    peopleIds.length ? db.from('contacts').select('id,name').in('id', peopleIds) : Promise.resolve({ data: [], error: null }),
    orgIds.length ? db.from('organizations').select('id,name').in('id', orgIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const peopleMap = new Map(requireData(peopleNames).map((row) => [row.id, row.name]));
  const orgMap = new Map(requireData(orgNames).map((row) => [row.id, row.name]));
  return {
    people: peopleRows.map((link): Link => { const forward = link.contact_id === contact.id; const target_id = forward ? link.related_contact_id : link.contact_id; return { id: link.id, target_id, name: peopleMap.get(target_id) || 'Former contact', label: forward ? link.relationship : link.inverse_relationship, notes: link.notes }; }),
    organizations: orgRows.map((link): Link => ({ id: link.id, target_id: link.organization_id, name: orgMap.get(link.organization_id) || 'Organization', label: link.contact_relationship, notes: link.notes })),
  };
}

function detailHeader(row: RecordRow, subtitle: string) {
  return `<div class="detail-header"><button class="back-button" type="button" data-action="back">Back to ${view === 'contacts' ? 'contacts' : 'organizations'}</button><div class="photo-control">${avatarMarkup(row, 'large')}<button class="photo-button" type="button" data-action="choose-photo" aria-label="Upload profile image for ${esc(row.name)}" title="Upload profile image"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l1.5-2h5L16 7h4v12H4z"/><circle cx="12" cy="13" r="3"/></svg></button></div><input id="profile-image-input" type="file" accept="image/jpeg,image/png,image/webp" hidden /><div class="identity"><h2>${esc(row.name)}</h2><p>${esc(subtitle)}</p><button class="remove-photo text-button" type="button" data-action="remove-photo" hidden>Remove photo</button></div><div class="record-actions"><button class="button outline" type="button" data-action="audit">Change history</button><button class="button outline" type="button" data-action="edit">Edit details</button></div></div>`;
}

function detailField(label: string, value: string | null, type?: 'email' | 'phone' | 'url') {
  let display = `<span class="muted-value">Not added</span>`;
  if (value) {
    const href = type === 'email' ? `mailto:${encodeURIComponent(value)}` : type === 'phone' ? `tel:${encodeURIComponent(value)}` : type === 'url' && /^https?:\/\//i.test(value) ? value : null;
    display = href ? `<a href="${esc(href)}" ${type === 'url' ? 'target="_blank" rel="noopener noreferrer"' : ''}>${esc(value)}</a>` : esc(value);
  }
  return `<div class="detail-field"><dt>${esc(label)}</dt><dd>${display}</dd></div>`;
}

function linkList(links: Link[], kind: 'person' | 'organization') {
  if (!links.length) return `<p class="quiet">No ${kind === 'person' ? 'people' : 'organizations'} linked yet.</p>`;
  return `<ul class="link-list">${links.map((link) => `<li><button type="button" class="link-name" data-action="open-link" data-kind="${kind}" data-id="${esc(link.target_id)}">${esc(link.name)}</button><span>${esc(link.label)}</span><button type="button" class="remove-link" aria-label="Remove link to ${esc(link.name)}" title="Remove link" data-action="unlink" data-kind="${kind}" data-id="${esc(link.id)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></li>`).join('')}</ul>`;
}

async function renderContact(contact: Contact, request = detailRequest) {
  let historyQuery = db.from('history').select('id,kind,body,happened_at', { count: 'exact' }).eq('contact_id', contact.id).order('happened_at', { ascending: false }).range(0, historyLimit - 1);
  if (historyFilter !== 'all') historyQuery = historyQuery.eq('kind', historyFilter);
  const [historyResult, links] = await Promise.all([
    historyQuery,
    contactLinks(contact),
  ]);
  if (request !== detailRequest) return;
  const history = requireData(historyResult) as History[];
  const historyCount = historyResult.count ?? history.length;
  $('#detail-panel').innerHTML = `${detailHeader(contact, [contact.title, contact.company].filter(Boolean).join(' · ') || 'Contact')}
    <div class="detail-content"><div class="overview-grid"><section class="about-section"><div class="section-heading"><h3>About</h3></div><dl class="field-grid">${detailField('Company', contact.company)}${detailField('Title', contact.title)}</dl>${contactDetailFields(contact.details, contact.email, contact.phone)}${contact.info ? `<div class="info-block"><span>Notes about ${esc(contact.name.split(' ')[0])}</span><p>${esc(contact.info)}</p></div>` : ''}</section>
    <aside class="connections"><section><div class="section-heading"><h3>People</h3><button type="button" class="text-button" data-action="link-person">Add</button></div>${linkList(links.people, 'person')}</section><section><div class="section-heading"><h3>Organizations</h3><button type="button" class="text-button" data-action="link-organization">Add</button></div>${linkList(links.organizations, 'organization')}</section></aside></div>
    <section class="activity-section"><div class="section-heading activity-heading"><h3>Activity</h3><button class="button primary" type="button" data-action="compose"><svg class="plus-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add activity</button></div><div class="activity-tabs" role="group" aria-label="Filter activity">${['all','note','call','email','meeting','other'].map((kind) => `<button type="button" data-action="filter-history" data-kind="${kind}" class="${historyFilter === kind ? 'active' : ''}">${kind === 'all' ? 'All' : kind[0].toUpperCase() + kind.slice(1) + 's'}</button>`).join('')}</div><div id="compose-slot">${composerOpen ? composeForm() : ''}</div><div class="timeline">${history.length ? history.map((entry) => `<article class="activity-entry"><time datetime="${esc(entry.happened_at)}">${esc(humanDate(entry.happened_at))}</time><div class="event-dot"></div><div><strong>${esc(entry.kind[0].toUpperCase() + entry.kind.slice(1))}</strong><p>${esc(entry.body)}</p></div></article>`).join('') : `<p class="quiet timeline-empty">${historyFilter !== 'all' ? 'No activity of this type yet.' : 'No activity yet. Add a note, call, email, or meeting to start the record.'}</p>`}</div>${history.length < historyCount ? `<button class="button subtle history-more" type="button" data-action="more-history">Load more activity</button>` : ''}</section></div>`;
  void hydrateAvatars($('#detail-panel'));
}

async function organizationLinks(org: Organization) {
  const [peopleResult, orgResult] = await Promise.all([
    db.from('contact_organization_relationships').select('id,contact_id,organization_relationship,notes').eq('organization_id', org.id),
    db.from('organization_relationships').select('id,organization_id,related_organization_id,relationship,inverse_relationship,notes').eq('owner_id', org.owner_id).or(`organization_id.eq.${org.id},related_organization_id.eq.${org.id}`),
  ]);
  const peopleRows = requireData(peopleResult);
  const orgRows = requireData(orgResult);
  const peopleIds = peopleRows.map((link) => link.contact_id);
  const orgIds = orgRows.map((link) => link.organization_id === org.id ? link.related_organization_id : link.organization_id);
  const [peopleNames, orgNames] = await Promise.all([
    peopleIds.length ? db.from('contacts').select('id,name').in('id', peopleIds).is('deleted_at', null) : Promise.resolve({ data: [], error: null }),
    orgIds.length ? db.from('organizations').select('id,name').in('id', orgIds) : Promise.resolve({ data: [], error: null }),
  ]);
  const peopleMap = new Map(requireData(peopleNames).map((row) => [row.id, row.name]));
  const orgMap = new Map(requireData(orgNames).map((row) => [row.id, row.name]));
  return {
    people: peopleRows.map((link): Link => ({ id: link.id, target_id: link.contact_id, name: peopleMap.get(link.contact_id) || 'Former contact', label: link.organization_relationship, notes: link.notes })),
    organizations: orgRows.map((link): Link => { const forward = link.organization_id === org.id; const target_id = forward ? link.related_organization_id : link.organization_id; return { id: link.id, target_id, name: orgMap.get(target_id) || 'Organization', label: forward ? link.relationship : link.inverse_relationship, notes: link.notes }; }),
  };
}

async function renderOrganization(org: Organization, request = detailRequest) {
  const links = await organizationLinks(org);
  if (request !== detailRequest) return;
  $('#detail-panel').innerHTML = `${detailHeader(org, org.kind)}<div class="detail-content"><div class="overview-grid"><section class="about-section"><div class="section-heading"><h3>About</h3></div><dl class="field-grid">${detailField('Type', org.kind)}${detailField('Email', org.email, 'email')}${detailField('Phone', org.phone, 'phone')}${detailField('Website', org.website, 'url')}${detailField('Address', org.address)}</dl>${org.info ? `<div class="info-block"><span>Additional information</span><p>${esc(org.info)}</p></div>` : ''}</section><aside class="connections"><section><div class="section-heading"><h3>People</h3><button type="button" class="text-button" data-action="link-person">Add</button></div>${linkList(links.people, 'person')}</section><section><div class="section-heading"><h3>Related organizations</h3><button type="button" class="text-button" data-action="link-organization">Add</button></div>${linkList(links.organizations, 'organization')}</section></aside></div></div>`;
  void hydrateAvatars($('#detail-panel'));
}

function input(name: string, label: string, value: string | null = '', type = 'text', required = false) {
  return `<label class="form-field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${required ? 'required' : ''} /></label>`;
}

function recordForm(row?: RecordRow) {
  const isOrg = view === 'organizations';
  const contact = row as Contact | undefined;
  const org = row as Organization | undefined;
  return `<div class="form-page"><div class="form-heading"><button type="button" class="text-button" data-action="cancel">Back to details</button><h2>${row ? `Edit ${isOrg ? 'organization' : 'contact'}` : `New ${isOrg ? 'organization' : 'contact'}`}</h2><p>${isOrg ? 'Keep the details of this organization together.' : 'Keep the details you need for the next conversation.'}</p></div><form id="record-form" class="record-form"><div class="form-grid">${input('name', 'Name', row?.name, 'text', true)}${isOrg ? input('kind', 'Type', org?.kind || 'other', 'text', true) : input('title', 'Title', contact?.title)}${isOrg ? input('website', 'Website', org?.website, 'url') : input('company', 'Company', contact?.company)}${isOrg ? `${input('email', 'Email', row?.email, 'email')}${input('phone', 'Phone', row?.phone, 'tel')}` : ''}${isOrg ? input('address', 'Address', org?.address) : ''}</div>${!isOrg ? contactDetailsForm(contact?.details,contact?.email,contact?.phone) : ''}<label class="form-field">Information<textarea name="info" rows="5">${esc(row?.info)}</textarea></label><div class="form-actions"><button type="button" class="button outline" data-action="cancel">Cancel</button><button type="submit" class="button primary">${row ? 'Save changes' : `Add ${isOrg ? 'organization' : 'contact'}`}</button></div></form></div>`;
}

function composeForm() {
  return `<form id="activity-form" class="compose-form"><div class="compose-top"><label class="form-field">Type<select name="kind"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option><option value="other">Other</option></select></label><label class="form-field">Date and time<input name="happened_at" type="datetime-local" value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}" required /></label></div><label class="form-field">What happened?<textarea name="body" rows="3" required placeholder="Add context you will want later"></textarea></label><div class="form-actions"><button type="button" class="button outline" data-action="cancel-compose">Cancel</button><button type="submit" class="button primary">Save activity</button></div></form>`;
}

async function openLinkForm(kind: 'person' | 'organization') {
  if (!selected) return;
  linkForm = kind;
  const target = $('#detail-panel');
  target.innerHTML = `<div class="form-page"><div class="form-heading"><button type="button" class="text-button" data-action="cancel-link">Back to details</button><h2>Link ${kind === 'person' ? 'a person' : 'an organization'}</h2><p>Describe the connection from each side.</p></div><form id="link-form" class="record-form"><label class="form-field">Search ${kind === 'person' ? 'people' : 'organizations'}<input id="link-search" type="search" autocomplete="off" placeholder="Type a name to search all records" /></label><label class="form-field">${kind === 'person' ? 'Person' : 'Organization'}<select name="target_id" required><option value="">Loading…</option></select></label><p id="link-hint" class="quiet" role="status"></p>${input('relationship', `This ${view === 'contacts' ? 'contact' : 'organization'} is…`, '', 'text', true)}${input('inverse_relationship', 'From the other side…', '', 'text', true)}<label class="form-field">Context <span class="optional">optional</span><textarea name="notes" rows="3"></textarea></label><div class="form-actions"><button type="button" class="button outline" data-action="cancel-link">Cancel</button><button type="submit" class="button primary">Add link</button></div></form></div>`;
  await loadLinkChoices('');
}

async function loadLinkChoices(term: string) {
  if (!selected || !linkForm) return;
  const request = ++linkSearchRequest;
  let query = db.from(linkForm === 'person' ? 'contacts' : 'organizations').select('id,name').eq('owner_id', selected.owner_id).order('name').limit(50);
  if (linkForm === 'person') query = query.is('deleted_at', null);
  const clean = term.replace(/[%_,()]/g, '').trim();
  if (clean) query = query.ilike('name', `%${clean}%`);
  const result = await query;
  if (request !== linkSearchRequest || !linkForm) return;
  const options = requireData(result).filter((row) => row.id !== selected!.id);
  const select = $('#link-form select[name="target_id"]');
  select.innerHTML = `<option value="">${options.length ? 'Choose a record' : 'No matches found'}</option>${options.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}`;
  $('#link-hint').textContent = options.length ? 'Showing up to 50 matches. Search by name to find others.' : `No matching ${linkForm === 'person' ? 'people' : 'organizations'}.`;
}

async function saveRecord(form: HTMLFormElement) {
  const fd = new FormData(form);
  const values: Record<string, unknown> = { name: String(fd.get('name') || '').trim(), email: optional(fd.get('email')), phone: optional(fd.get('phone')), info: optional(fd.get('info')) };
  if (!values.name) throw new Error('Add a name before saving.');
  if (view === 'contacts') { delete values.email; delete values.phone; values.details = readContactDetails(form, (selected as Contact | null)?.details); values.title = optional(fd.get('title')); values.company = optional(fd.get('company')); }
  else { values.kind = String(fd.get('kind') || '').trim() || 'other'; values.website = optional(fd.get('website')); values.address = optional(fd.get('address')); }
  const result = creating
    ? await db.from(view).insert(values).select('id').single()
    : await db.from(view).update({ ...values, updated_at: new Date().toISOString() }).eq('id', selectedId!).select('id').single();
  const saved = requireData(result);
  creating = false;
  selectedId = saved.id;
  await loadList();
  await selectRecord(saved.id);
  toast(view === 'contacts' ? 'Contact saved.' : 'Organization saved.');
}

async function saveLink(form: HTMLFormElement) {
  if (!selected || !linkForm) return;
  const fd = new FormData(form);
  const target = String(fd.get('target_id'));
  const relationship = String(fd.get('relationship') || '').trim();
  const inverse = String(fd.get('inverse_relationship') || '').trim();
  if (!target || !relationship || !inverse) throw new Error('Choose a record and add both relationship labels.');
  const notes = optional(fd.get('notes'));
  if (view === 'contacts' && linkForm === 'person') requireData(await db.from('contact_relationships').insert({ owner_id: selected.owner_id, contact_id: selected.id, related_contact_id: target, relationship, inverse_relationship: inverse, notes }).select('id').single());
  else if (view === 'contacts') requireData(await db.from('contact_organization_relationships').insert({ owner_id: selected.owner_id, contact_id: selected.id, organization_id: target, contact_relationship: relationship, organization_relationship: inverse, notes }).select('id').single());
  else if (linkForm === 'person') requireData(await db.from('contact_organization_relationships').insert({ owner_id: selected.owner_id, contact_id: target, organization_id: selected.id, contact_relationship: inverse, organization_relationship: relationship, notes }).select('id').single());
  else requireData(await db.from('organization_relationships').insert({ owner_id: selected.owner_id, organization_id: selected.id, related_organization_id: target, relationship, inverse_relationship: inverse, notes }).select('id').single());
  linkForm = null;
  await selectRecord(selected.id);
  toast('Relationship added.');
}

function setView(next: View) {
  if (next === view && !connectionsOpen && !auditOpen) return;
  auditOpen = false;
  auditPage.close();
  show($('#audit-page'), false);
  connectionsOpen = false;
  show($('#connections-page'), false);
  show($('#records-workspace'), true);
  detailRequest++;
  view = next;
  selectedId = null;
  selected = null;
  linkForm = null;
  linkSearchRequest++;
  search = '';
  $('#record-search').setAttribute('placeholder', `Search ${next}`);
  $('#record-search').setAttribute('aria-label', `Search ${next}`);
  ($('#record-search') as HTMLInputElement).value = '';
  $('#view-title').textContent = next === 'contacts' ? 'Contacts' : 'Organizations';
  $('#new-label').textContent = next === 'contacts' ? 'Add contact' : 'Add organization';
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => { const active = button.dataset.view === next; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#detail-panel').classList.remove('mobile-active');
  renderBlankDetail();
  loadList();
}

function openConnections() {
  auditOpen = false;
  auditPage.close();
  show($('#audit-page'), false);
  connectionsOpen = true;
  // Ignore record responses and debounced searches after leaving that screen.
  listRequest++;
  detailRequest++;
  linkSearchRequest++;
  clearTimeout(searchTimer);
  clearTimeout(linkSearchTimer);
  show($('#records-workspace'), false);
  show($('#connections-page'), true);
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => {
    const active = button.dataset.page === 'connections';
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $('#connections-title').focus();
}

function openAudit(table = '', record = '') {
  auditOpen = true;
  connectionsOpen = false;
  listRequest++; detailRequest++; linkSearchRequest++;
  clearTimeout(searchTimer); clearTimeout(linkSearchTimer);
  show($('#records-workspace'), false);
  show($('#connections-page'), false);
  show($('#audit-page'), true);
  document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => {
    const active = button.dataset.page === 'audit';
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  void auditPage.open(table, record);
}

async function startApp() {
  const { data: { user }, error } = await db.auth.getUser();
  const signedIn = Boolean(user && !error);
  if (currentUserId !== (user?.id || null)) { clearImageCache(); currentUserId = user?.id || null; }
  show($('#app'), signedIn);
  show($('#auth-screen'), !signedIn);
  if (signedIn) { $('#account-email').textContent = user!.email || ''; if (auditOpen) await auditPage.open(); else if (!connectionsOpen) await loadList(); }
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector('button')!;
  button.disabled = true;
  $('#auth-status').textContent = 'Signing in…';
  const { error } = await db.auth.signInWithPassword({ email: ($('#auth-email') as HTMLInputElement).value.trim(), password: ($('#auth-password') as HTMLInputElement).value });
  ($('#auth-password') as HTMLInputElement).value = '';
  $('#auth-status').textContent = error ? error.message : '';
  button.disabled = false;
  if (!error) await startApp();
});

$('#code-toggle').addEventListener('click', async () => {
  const email = ($('#auth-email') as HTMLInputElement).value.trim();
  if (!email) { $('#auth-status').textContent = 'Enter your email address first.'; ($('#auth-email') as HTMLInputElement).focus(); return; }
  const button = $('#code-toggle') as HTMLButtonElement;
  button.disabled = true;
  $('#auth-status').textContent = 'Sending a code…';
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  $('#auth-status').textContent = error ? error.message : 'Check your inbox, then enter the code below.';
  show($('#code-form'), !error);
  button.disabled = false;
});

$('#code-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const { error } = await db.auth.verifyOtp({ email: ($('#auth-email') as HTMLInputElement).value.trim(), token: ($('#auth-code') as HTMLInputElement).value.trim(), type: 'email' });
  $('#auth-status').textContent = error ? error.message : '';
  if (!error) await startApp();
});

$('#sign-out').addEventListener('click', async () => { await db.auth.signOut(); auditPage.close(); if (auditOpen) { document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); }); } auditOpen = false; show($('#audit-page'), false); show($('#records-workspace'), !connectionsOpen); clearImageCache(); selectedId = null; selected = null; await startApp(); });
document.querySelectorAll<HTMLButtonElement>('.nav-item').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.page === 'audit') openAudit();
  else if (button.dataset.page === 'connections') openConnections();
  else setView(button.dataset.view as View);
}));
$('#connections-page').addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-target]');
  if (!button) return;
  const field = document.getElementById(button.dataset.copyTarget!) as HTMLTextAreaElement;
  try {
    await navigator.clipboard.writeText(field.value);
    toast(`${field.labels?.[0]?.textContent || 'URL'} copied.`);
  } catch {
    field.focus();
    field.select();
    toast('Copy unavailable. The URL is selected; use your device’s Copy command.', true);
  }
});
$('#new-record').addEventListener('click', () => { detailRequest++; linkSearchRequest++; linkForm = null; creating = true; selected = null; selectedId = null; renderList(); $('#detail-panel').innerHTML = recordForm(); $('#detail-panel').classList.add('mobile-active'); });
$('#record-list').addEventListener('click', (event) => { const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-id]'); if (button) selectRecord(button.dataset.id!); if ((event.target as HTMLElement).id === 'retry-list') loadList(); });
let searchTimer: number;
$('#record-search').addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = window.setTimeout(() => { search = (event.target as HTMLInputElement).value.trim(); selectedId = null; selected = null; loadList(); }, 220); });
$('#load-more').addEventListener('click', () => loadList(true));
let linkSearchTimer: number;
$('#detail-panel').addEventListener('input', (event) => {
  if ((event.target as HTMLElement).id !== 'link-search') return;
  clearTimeout(linkSearchTimer);
  linkSearchTimer = window.setTimeout(() => loadLinkChoices((event.target as HTMLInputElement).value).catch((error) => toast((error as Error).message, true)), 220);
});

$('#detail-panel').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement;
  if (input.id !== 'profile-image-input' || !input.files?.[0]) return;
  try { await changeProfileImage(input.files[0]); }
  catch (error) { toast((error as Error).message, true); }
  finally { input.value = ''; }
});

$('#detail-panel').addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'add-contact-value' || action === 'remove-contact-value') addContactValue(button);
    else if (action === 'choose-photo') { ($('#profile-image-input') as HTMLInputElement).click(); }
    else if (action === 'remove-photo') await changeProfileImage();
    else if (action === 'audit' && selected) openAudit(view, selected.id);
    else if (action === 'edit' && selected) { $('#detail-panel').innerHTML = recordForm(selected); }
    else if (action === 'cancel') { if (creating) { creating = false; if (records.length) selectRecord(records[0].id); else renderBlankDetail(); } else if (selectedId) selectRecord(selectedId); }
    else if (action === 'back') $('#detail-panel').classList.remove('mobile-active');
    else if (action === 'compose' && selected && view === 'contacts') { composerOpen = !composerOpen; await renderContact(selected as Contact); $('#activity-form textarea')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    else if (action === 'cancel-compose' && selected) { composerOpen = false; await renderContact(selected as Contact); }
    else if (action === 'filter-history' && selected) { historyFilter = button.dataset.kind!; historyLimit = 100; await renderContact(selected as Contact); }
    else if (action === 'more-history' && selected) { historyLimit += 100; await renderContact(selected as Contact); }
    else if (action === 'link-person') await openLinkForm('person');
    else if (action === 'link-organization') await openLinkForm('organization');
    else if (action === 'cancel-link' && selectedId) selectRecord(selectedId);
    else if (action === 'open-link') { const nextView = button.dataset.kind === 'person' ? 'contacts' : 'organizations'; if (nextView !== view) setView(nextView); selectRecord(button.dataset.id!); }
    else if (action === 'unlink' && selected && confirm('Remove this relationship?')) { const table = button.dataset.kind === 'person' ? (view === 'contacts' ? 'contact_relationships' : 'contact_organization_relationships') : (view === 'contacts' ? 'contact_organization_relationships' : 'organization_relationships'); requireData(await db.from(table).delete().eq('id', button.dataset.id!).select('id').single()); await selectRecord(selected.id); toast('Relationship removed.'); }
  } catch (error) { toast((error as Error).message, true); }
});

$('#detail-panel').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (button) button.disabled = true;
  try {
    if (form.id === 'record-form') await saveRecord(form);
    else if (form.id === 'link-form') await saveLink(form);
    else if (form.id === 'activity-form' && selected) {
      const fd = new FormData(form);
      requireData(await db.from('history').insert({ contact_id: selected.id, owner_id: selected.owner_id, kind: fd.get('kind'), body: String(fd.get('body') || '').trim(), happened_at: new Date(String(fd.get('happened_at'))).toISOString() }).select('id').single());
      composerOpen = false;
      historyFilter = 'all';
      await renderContact(selected as Contact);
      toast('Activity saved.');
    }
  } catch (error) { toast((error as Error).message, true); if (button) button.disabled = false; }
});

startApp().catch((error) => { show($('#auth-screen'), true); $('#auth-status').textContent = (error as Error).message; });
