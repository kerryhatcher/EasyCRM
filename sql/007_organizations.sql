create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind text not null default 'other' check (length(trim(kind)) between 1 and 80),
  email text,
  phone text,
  website text,
  address text,
  info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create index organizations_owner_name_idx on public.organizations(owner_id, name);
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated;
grant select, insert on public.organizations to authenticated;
grant update (name, kind, email, phone, website, address, info, updated_at)
  on public.organizations to authenticated;

create policy "Owners and admins can read organizations"
  on public.organizations for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
create policy "Owners and admins can add organizations"
  on public.organizations for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
create policy "Owners and admins can update organizations"
  on public.organizations for update to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  )
  with check (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );

create table public.organization_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  organization_id uuid not null,
  related_organization_id uuid not null,
  relationship text not null check (length(trim(relationship)) between 1 and 80),
  inverse_relationship text not null check (length(trim(inverse_relationship)) between 1 and 80),
  notes text,
  created_at timestamptz not null default now(),
  check (organization_id <> related_organization_id),
  foreign key (organization_id, owner_id)
    references public.organizations(id, owner_id) on delete cascade,
  foreign key (related_organization_id, owner_id)
    references public.organizations(id, owner_id) on delete cascade
);

create unique index organization_relationships_unique_link
  on public.organization_relationships (
    owner_id,
    least(organization_id, related_organization_id),
    greatest(organization_id, related_organization_id),
    (case when organization_id < related_organization_id
      then relationship else inverse_relationship end),
    (case when organization_id < related_organization_id
      then inverse_relationship else relationship end)
  );
create index organization_relationships_org_idx
  on public.organization_relationships(owner_id, organization_id);
create index organization_relationships_related_idx
  on public.organization_relationships(owner_id, related_organization_id);

alter table public.organization_relationships enable row level security;
revoke all on public.organization_relationships from anon, authenticated;
grant select, insert, delete on public.organization_relationships to authenticated;

create policy "Owners and admins can read organization relationships"
  on public.organization_relationships for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
create policy "Owners and admins can add organization relationships"
  on public.organization_relationships for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
create policy "Owners and admins can remove organization relationships"
  on public.organization_relationships for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );

create table public.contact_organization_relationships (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  contact_id uuid not null,
  organization_id uuid not null,
  contact_relationship text not null
    check (length(trim(contact_relationship)) between 1 and 80),
  organization_relationship text not null
    check (length(trim(organization_relationship)) between 1 and 80),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (contact_id, owner_id)
    references public.contacts(id, owner_id) on delete cascade,
  foreign key (organization_id, owner_id)
    references public.organizations(id, owner_id) on delete cascade,
  unique (owner_id, contact_id, organization_id,
    contact_relationship, organization_relationship)
);

create index contact_organization_relationships_contact_idx
  on public.contact_organization_relationships(owner_id, contact_id);
create index contact_organization_relationships_org_idx
  on public.contact_organization_relationships(owner_id, organization_id);

alter table public.contact_organization_relationships enable row level security;
revoke all on public.contact_organization_relationships from anon, authenticated;
grant select, insert, delete on public.contact_organization_relationships to authenticated;

create policy "Owners and admins can read contact organization relationships"
  on public.contact_organization_relationships for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
create policy "Owners and admins can add contact organization relationships"
  on public.contact_organization_relationships for insert to authenticated
  with check (
    (owner_id = (select auth.uid())
      or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin')
    and exists (
      select 1 from public.contacts c
      where c.id = contact_organization_relationships.contact_id
        and c.owner_id = contact_organization_relationships.owner_id
        and c.deleted_at is null
    )
  );
create policy "Owners and admins can remove contact organization relationships"
  on public.contact_organization_relationships for delete to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );
