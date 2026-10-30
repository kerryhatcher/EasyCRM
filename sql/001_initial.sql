create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  company text,
  title text,
  info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, owner_id)
);

create table public.history (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null,
  owner_id uuid not null default auth.uid(),
  kind text not null check (kind in ('note', 'call', 'email', 'meeting', 'other')),
  body text not null check (length(trim(body)) > 0),
  happened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (contact_id, owner_id) references public.contacts(id, owner_id) on delete cascade
);

create index contacts_owner_name_idx on public.contacts(owner_id, name);
create index history_contact_time_idx on public.history(contact_id, happened_at desc);

alter table public.contacts enable row level security;
alter table public.history enable row level security;

revoke all on public.contacts from anon, authenticated;
revoke all on public.history from anon, authenticated;
grant select, insert, update on public.contacts to authenticated;
grant select, insert on public.history to authenticated;

create policy "Owners can read contacts" on public.contacts
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can add contacts" on public.contacts
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owners can update contacts" on public.contacts
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Owners can read history" on public.history
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owners can add history" on public.history
  for insert to authenticated with check ((select auth.uid()) = owner_id);
