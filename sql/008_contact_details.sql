-- Rich contacts, preserving existing primary fields and authorization policies.
create extension if not exists pg_jsonschema with schema extensions;
alter table public.contacts add column details jsonb not null default '{}'::jsonb;
alter table public.contacts add constraint contacts_details_schema check (
  octet_length(details::text) <= 1048576 and extensions.jsonb_matches_schema(
  $schema${"type": "object", "properties": {"kind": {"type": "string", "enum": ["person", "organization"]}, "first_name": {"type": "string", "maxLength": 10000}, "last_name": {"type": "string", "maxLength": 10000}, "middle_name": {"type": "string", "maxLength": 10000}, "name_prefix": {"type": "string", "maxLength": 10000}, "name_suffix": {"type": "string", "maxLength": 10000}, "department": {"type": "string", "maxLength": 10000}, "nicknames": {"maxItems": 1000, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "birthday": {"description": "vCard birthday: full or partial date, date-time, or text", "anyOf": [{"type": "string", "maxLength": 10000}, {"type": "null"}]}, "emails": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "phones": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "websites": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "addresses": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}, "po_box": {"type": "string", "maxLength": 10000}, "extended": {"type": "string", "maxLength": 10000}, "street": {"type": "string", "maxLength": 10000}, "locality": {"type": "string", "maxLength": 10000}, "region": {"type": "string", "maxLength": 10000}, "postal_code": {"type": "string", "maxLength": 10000}, "country": {"type": "string", "maxLength": 10000}}, "additionalProperties": false}}, "social_profiles": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "instant_messages": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "related_names": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "dates": {"maxItems": 1000, "type": "array", "items": {"type": "object", "properties": {"value": {"type": "string", "minLength": 1, "maxLength": 10000}, "label": {"type": "string", "maxLength": 10000}, "types": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "preferred": {"type": "boolean"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["value"], "additionalProperties": false}}, "categories": {"maxItems": 1000, "type": "array", "items": {"type": "string", "maxLength": 10000}}, "extra_properties": {"maxItems": 2000, "type": "array", "items": {"type": "object", "properties": {"name": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "value": {"type": "string", "maxLength": 1048576}, "group": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "parameters": {"type": "object", "propertyNames": {"type": "string", "pattern": "^[A-Za-z0-9-]+$"}, "additionalProperties": {"maxItems": 50, "type": "array", "items": {"type": "string", "maxLength": 10000}}}}, "required": ["name", "value"], "additionalProperties": false}}}, "additionalProperties": false}$schema$::json, details));

create or replace function public.contacts_sync_details()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
declare
  field text; alias text; values_json jsonb; selected integer; preferred integer; old_alias text; new_alias text;
begin
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
create trigger contacts_sync_details before insert or update on public.contacts
  for each row execute function public.contacts_sync_details();
revoke execute on function public.contacts_sync_details() from public,anon,authenticated;

-- Populate only known values. Do not guess name components on existing records.
update public.contacts set details = jsonb_build_object(
  'emails',case when email is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('value',email)) end,
  'phones',case when phone is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('value',phone)) end)
where carddav_vcard is null;
grant insert (details), update (details) on public.contacts to authenticated;
