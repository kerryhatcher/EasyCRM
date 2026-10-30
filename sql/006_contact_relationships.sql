create table public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  related_contact_id uuid not null,
  relationship text not null check (length(trim(relationship)) between 1 and 80),
  inverse_relationship text not null check (length(trim(inverse_relationship)) between 1 and 80),
  notes text,
  created_at timestamptz not null default now(),
  check (contact_id <> related_contact_id),
  foreign key (contact_id, owner_id)
    references public.contacts(id, owner_id) on delete cascade,
  foreign key (related_contact_id, owner_id)
    references public.contacts(id, owner_id) on delete cascade
);

-- Treat A->B (father/son) and B->A (son/father) as the same link.
create unique index contact_relationships_unique_link on public.contact_relationships (
  owner_id,
  least(contact_id, related_contact_id),
  greatest(contact_id, related_contact_id),
  (case when contact_id < related_contact_id then relationship else inverse_relationship end),
  (case when contact_id < related_contact_id then inverse_relationship else relationship end)
);
create index contact_relationships_contact_idx
  on public.contact_relationships(owner_id, contact_id);
create index contact_relationships_related_idx
  on public.contact_relationships(owner_id, related_contact_id);

alter table public.contact_relationships enable row level security;
revoke all on public.contact_relationships from anon, authenticated;
grant select, insert, delete on public.contact_relationships to authenticated;

create policy "Owners and admins can read relationships"
  on public.contact_relationships for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );

create policy "Owners and admins can add relationships"
  on public.contact_relationships for insert to authenticated
  with check (
    (owner_id = (select auth.uid())
      or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin')
    and exists (
      select 1 from public.contacts c
      where c.id = contact_relationships.contact_id
        and c.owner_id = contact_relationships.owner_id
        and c.deleted_at is null
    )
    and exists (
      select 1 from public.contacts c
      where c.id = contact_relationships.related_contact_id
        and c.owner_id = contact_relationships.owner_id
        and c.deleted_at is null
    )
  );

create policy "Owners and admins can remove relationships"
  on public.contact_relationships for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
