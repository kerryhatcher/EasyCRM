alter table public.contacts
  add column carddav_href text not null default (gen_random_uuid()::text || '.vcf'),
  add column carddav_uid text,
  add column carddav_vcard text,
  add column deleted_at timestamptz,
  add constraint contacts_carddav_href_format
    check (carddav_href ~ '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}\.vcf$'),
  add constraint contacts_owner_carddav_href_key unique (owner_id, carddav_href),
  add constraint contacts_owner_carddav_uid_key unique (owner_id, carddav_uid);

create or replace function public.contacts_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger contacts_touch_updated_at
before update on public.contacts
for each row execute function public.contacts_touch_updated_at();

revoke execute on function public.contacts_touch_updated_at() from public, anon, authenticated;

grant update (carddav_uid, carddav_vcard, deleted_at)
  on public.contacts to authenticated;
