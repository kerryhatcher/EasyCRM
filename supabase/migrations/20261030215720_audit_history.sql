-- Apply after sql/001 through sql/008. Capture all CRM writes, including cascades.
create schema if not exists crm_private;
revoke all on schema crm_private from public, anon, authenticated;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  sequence bigint generated always as identity unique,
  transaction_id bigint not null default txid_current(),
  table_name text not null check (table_name in (
    'contacts', 'organizations', 'history', 'contact_relationships',
    'organization_relationships', 'contact_organization_relationships')),
  record_id uuid not null,
  owner_id uuid not null,
  actor_id uuid,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  reverts_transaction_id bigint,
  reason text,
  check ((operation = 'INSERT' and before_data is null and after_data is not null)
    or (operation = 'UPDATE' and before_data is not null and after_data is not null)
    or (operation = 'DELETE' and before_data is not null and after_data is null))
);
-- Deliberately no foreign keys to CRM rows or auth.users: deletions retain evidence.
create index audit_events_owner_sequence on public.audit_events(owner_id, sequence desc);
create index audit_events_record_sequence on public.audit_events(table_name, record_id, sequence desc);
create index audit_events_transaction on public.audit_events(transaction_id, sequence desc);
create index audit_events_reverts on public.audit_events(reverts_transaction_id)
  where reverts_transaction_id is not null;
alter table public.audit_events enable row level security;
revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;
revoke all on sequence public.audit_events_sequence_seq from public, anon, authenticated;
create policy "Owners and admins can read audit events" on public.audit_events
  for select to authenticated using (
    owner_id = (select auth.uid())
    or (select auth.jwt() -> 'app_metadata' ->> 'crm_role') = 'admin'
  );

-- Definer privileges allow only the trigger to append, never API callers.
create function crm_private.capture_audit_event() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare
  previous jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  current_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(current_row, previous);
begin
  if tg_op = 'UPDATE' and (previous->>'id' is distinct from current_row->>'id'
    or previous->>'owner_id' is distinct from current_row->>'owner_id') then
    raise exception 'Record identity and ownership cannot be changed';
  end if;
  insert into public.audit_events(table_name, record_id, owner_id, actor_id,
    operation, before_data, after_data, reverts_transaction_id, reason)
  values(tg_table_name, (row_data->>'id')::uuid, (row_data->>'owner_id')::uuid,
    auth.uid(), tg_op, previous, current_row,
    nullif(current_setting('easycrm.reverts_transaction_id', true), '')::bigint,
    nullif(current_setting('easycrm.rollback_reason', true), ''));
  return null;
end $$;
revoke all on function crm_private.capture_audit_event() from public, anon, authenticated;

do $$ declare t text; begin
  foreach t in array array['contacts','organizations','history','contact_relationships',
    'organization_relationships','contact_organization_relationships'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I
      for each row execute function crm_private.capture_audit_event()', t);
  end loop;
end $$;

create function crm_private.rollback_audit(event_id uuid, rollback_reason text)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  target public.audit_events;
  e public.audit_events;
  latest public.audit_events;
  live jsonb;
  restore_data jsonb;
  columns_sql text;
  assignments text;
  dependency record;
  has_children boolean;
  affected integer := 0;
  pending uuid[];
  progressed boolean;
  blocked boolean;
  caller uuid := auth.uid();
  admin boolean := coalesce(auth.jwt()->'app_metadata'->>'crm_role' = 'admin', false);
begin
  if caller is null then raise exception 'Sign in to roll back changes' using errcode='42501'; end if;
  if length(trim(coalesce(rollback_reason, ''))) not between 1 and 2000 then
    raise exception 'Provide a rollback reason (1–2000 characters)';
  end if;
  -- A rollback is rare. Serialize it against writes across the six small CRM tables.
  -- The fixed order and table locks also protect absent rows and cascading dependencies.
  lock table public.contacts, public.organizations, public.history,
    public.contact_relationships, public.organization_relationships,
    public.contact_organization_relationships in share row exclusive mode;
  select * into target from public.audit_events where id = event_id;
  if not found or (target.owner_id <> caller and not admin) then
    raise exception 'Audit event not found or inaccessible' using errcode='42501';
  end if;
  if exists(select 1 from public.audit_events where transaction_id=target.transaction_id
    and owner_id<>caller and not admin) then
    raise exception 'The transaction includes records you cannot roll back' using errcode='42501';
  end if;
  if target.transaction_id = txid_current() then
    raise exception 'Cannot roll back an uncommitted transaction';
  end if;
  if exists(select 1 from public.audit_events where reverts_transaction_id=target.transaction_id) then
    raise exception 'This transaction has already been rolled back';
  end if;
  -- Validate the final state of each record before changing anything (including ABA edits).
  for e in select distinct on (table_name, record_id) * from public.audit_events
    where transaction_id=target.transaction_id order by table_name, record_id, sequence desc loop
    select * into latest from public.audit_events a where a.table_name=e.table_name
      and a.record_id=e.record_id order by sequence desc limit 1;
    if latest.sequence>e.sequence and latest.reverts_transaction_id is null then
      raise exception 'Newer changes exist. Roll them back first.' using errcode='40001';
    end if;
    execute format('select to_jsonb(r) from public.%I r where id=$1',e.table_name)
      into live using e.record_id;
    -- A previous undo may have restored this version with a fresh sync timestamp.
    if (live - 'updated_at') is distinct from (e.after_data - 'updated_at') then
      raise exception 'Record has changed since this audit event' using errcode='40001';
    end if;
  end loop;
  perform set_config('easycrm.reverts_transaction_id', target.transaction_id::text, true);
  perform set_config('easycrm.rollback_reason', trim(rollback_reason), true);
  -- Reverse each row's events in order, retrying foreign-key dependencies until
  -- parents are restored / children removed. Cascade trigger order is not assumed.
  select array_agg(id order by sequence desc) into pending from public.audit_events
    where transaction_id=target.transaction_id;
  while cardinality(pending)>0 loop
    progressed := false;
    for e in select * from public.audit_events where id=any(pending) order by sequence desc loop
      if exists(select 1 from public.audit_events a where a.id=any(pending)
        and a.table_name=e.table_name and a.record_id=e.record_id and a.sequence>e.sequence) then
        continue;
      end if;
      blocked := false;
      begin
        if e.operation='INSERT' then
          -- Never silently cascade-delete dependent records added by a later transaction.
          for dependency in
            select c.conrelid::regclass as relation, a.attname as column_name
            from pg_constraint c join pg_attribute a
              on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
            where c.contype='f' and c.confrelid=format('public.%I', e.table_name)::regclass
          loop
            execute format('select exists(select 1 from %s where %I=$1)',
              dependency.relation, dependency.column_name) into has_children using e.record_id;
            if has_children then blocked := true; exit; end if;
          end loop;
          if blocked then continue; end if;
          execute format('delete from public.%I where id=$1', e.table_name) using e.record_id;
        else
          restore_data := e.before_data;
          if e.table_name in ('contacts', 'organizations') then
            restore_data := jsonb_set(restore_data, '{updated_at}', to_jsonb(clock_timestamp()));
          end if;
          select string_agg(format('%I', a.attname), ', ' order by a.attnum),
            string_agg(format('%1$I = restored.%1$I', a.attname), ', ' order by a.attnum)
          into columns_sql, assignments from pg_attribute a
          where a.attrelid=format('public.%I', e.table_name)::regclass
            and a.attnum>0 and not a.attisdropped and a.attgenerated='';
          if e.operation='DELETE' then
            execute format('insert into public.%1$I (%2$s) select %2$s
              from jsonb_populate_record(null::public.%1$I, $1)', e.table_name, columns_sql)
              using restore_data;
          else
            execute format('update public.%1$I as live set %2$s
              from jsonb_populate_record(null::public.%1$I, $1) restored where live.id=$2',
              e.table_name, assignments) using restore_data, e.record_id;
          end if;
        end if;
      exception when foreign_key_violation then
        continue;
      end;
      affected := affected + 1;
      pending := array_remove(pending, e.id);
      progressed := true;
    end loop;
    if not progressed then
      raise exception 'Dependent records exist or a required parent is missing. Roll back their changes first.' using errcode='40001';
    end if;
  end loop;
  perform set_config('easycrm.reverts_transaction_id', '', true);
  perform set_config('easycrm.rollback_reason', '', true);
  return jsonb_build_object('reverted_transaction_id', target.transaction_id::text,
    'transaction_id', txid_current()::text, 'reverted_events', affected);
end $$;
revoke all on function crm_private.rollback_audit(uuid,text) from public, anon, authenticated;

-- Only this narrowly scoped, authenticated wrapper is exposed as an RPC.
create function public.rollback_audit_event(event_id uuid, reason text) returns jsonb
language sql security definer set search_path = pg_catalog as $$
  select crm_private.rollback_audit(event_id, reason);
$$;
revoke all on function public.rollback_audit_event(uuid,text) from public, anon, authenticated;
grant execute on function public.rollback_audit_event(uuid,text) to authenticated;

create or replace function public.contacts_sync_details()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  field text; alias text; values_json jsonb; selected integer; preferred integer; old_alias text; new_alias text;
begin
  -- Only the privileged rollback RPC may restore an exact snapshot, including
  -- removing detail keys that were absent before a change. Constraints still run.
  if nullif(current_setting('easycrm.reverts_transaction_id', true), '') is not null
    and current_user = pg_get_userbyid((select p.proowner from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='crm_private' and p.proname='rollback_audit')) then
    return new;
  end if;
  if tg_op='UPDATE' then new.details := old.details || new.details; end if;
  foreach field in array array['emails','phones','websites','social_profiles','instant_messages','related_names','dates','addresses'] loop
    if jsonb_typeof(new.details->field)='array' then
      select count(*) into preferred from jsonb_array_elements(new.details->field) where value->'preferred'='true'::jsonb;
      if preferred>1 then raise exception 'Choose at most one preferred %',field; end if;
    end if;
  end loop;
  foreach field in array array['emails','phones'] loop
    alias := case field when 'emails' then 'email' else 'phone' end;
    new_alias := to_jsonb(new)->>alias;
    old_alias := case when tg_op='UPDATE' then to_jsonb(old)->>alias else null end;
    values_json := new.details->field;
    -- Legacy raw cards remain authoritative until a structured array is explicitly supplied.
    if values_json is null and new.carddav_vcard is not null then continue; end if;
    -- Changed canonical arrays win; [] explicitly clears a collection.
    if (tg_op='INSERT' and values_json is not null) or
       (tg_op='UPDATE' and (new.details->field) is distinct from (old.details->field)) then
      if jsonb_typeof(values_json) <> 'array' then raise exception 'Invalid contact %', field; end if;
    elsif new_alias is distinct from old_alias or tg_op='INSERT' then
      values_json := coalesce(values_json, '[]'::jsonb);
      select coalesce((select (ordinality-1)::integer from jsonb_array_elements(values_json) with ordinality
        where value->'preferred'='true'::jsonb limit 1),0) into selected;
      if new_alias is null then
        values_json := values_json - selected;
      elsif jsonb_array_length(values_json)=0 then
        values_json := jsonb_build_array(jsonb_build_object('value',new_alias));
      else
        values_json := jsonb_set(values_json,array[selected::text,'value'],to_jsonb(new_alias));
      end if;
      new.details := jsonb_set(new.details,array[field],values_json);
    end if;
    values_json := coalesce(new.details->field,'[]'::jsonb);
    select count(*) into preferred from jsonb_array_elements(values_json) where value->'preferred'='true'::jsonb;
    if preferred>1 then raise exception 'Choose at most one preferred %',field; end if;
    select value->>'value' into new_alias from jsonb_array_elements(values_json) with ordinality
      order by (value->'preferred'='true'::jsonb) desc nulls last, ordinality limit 1;
    if field='emails' then new.email:=new_alias; else new.phone:=new_alias; end if;
  end loop;
  return new;
end $$;

revoke all on function public.contacts_sync_details() from public, anon, authenticated;
