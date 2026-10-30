-- CLI-created contacts also need a unique vCard UID.
update public.contacts set carddav_uid = id::text where carddav_uid is null;

create or replace function public.contacts_default_carddav_uid()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if new.carddav_uid is null then
    new.carddav_uid = new.id::text;
  end if;
  return new;
end;
$$;

create trigger contacts_default_carddav_uid
before insert on public.contacts
for each row execute function public.contacts_default_carddav_uid();

alter table public.contacts alter column carddav_uid set not null;
revoke execute on function public.contacts_default_carddav_uid() from public, anon, authenticated;
