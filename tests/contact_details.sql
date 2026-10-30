-- Run after sql/008_contact_details.sql on a database with a contact owner.
-- No fixture data is committed.
begin;
do $$ declare fixture_id uuid; own uuid; d jsonb; e text; begin
select owner_id into own from public.contacts limit 1;
insert into public.contacts(owner_id,name,email,phone) values(own,'Rich contact test','old@example.test','111') returning contacts.id into fixture_id;
update public.contacts set details='{"first_name":"Pat","last_name":"Example","emails":[{"value":"first@example.test","label":"Home"},{"value":"second@example.test","label":"Work","preferred":true}],"phones":[{"value":"111","label":"Mobile"},{"value":"222","label":"Work"}]}' where contacts.id=fixture_id;
select details,email into d,e from public.contacts where contacts.id=fixture_id;
if e<>'second@example.test' then raise exception 'preferred alias mismatch'; end if;
update public.contacts set email='changed@example.test' where contacts.id=fixture_id;
select details into d from public.contacts where contacts.id=fixture_id;
if d#>>'{emails,1,value}'<>'changed@example.test' or d#>>'{emails,1,label}'<>'Work' or jsonb_array_length(d->'emails')<>2 then raise exception 'legacy update lost labeled values'; end if;
update public.contacts set details='{"categories":["Friends"]}' where contacts.id=fixture_id;
select details into d from public.contacts where contacts.id=fixture_id;
if d->>'first_name'<>'Pat' then raise exception 'patch lost name'; end if;
begin update public.contacts set details='{"emails":[{"value":"x","preferred":true},{"value":"y","preferred":true}]}' where contacts.id=fixture_id; raise exception 'accepted two preferred emails'; exception when raise_exception then if sqlerrm='accepted two preferred emails' then raise; end if; end;
begin update public.contacts set details='{"phones":"bad"}' where contacts.id=fixture_id; raise exception 'accepted invalid array'; exception when others then if sqlerrm='accepted invalid array' then raise; end if; end;
end $$;
select count(*) as checked_contact_count from public.contacts;
rollback;
