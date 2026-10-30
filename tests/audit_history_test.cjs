// NODE_PATH=/tmp/easycrm-audit-tests/node_modules node tests/audit_history_test.cjs
// Install test runtime: npm install --prefix /tmp/easycrm-audit-tests @electric-sql/pglite@0.3.14
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '..');
const owner = '10000000-0000-0000-0000-000000000001';
const other = '10000000-0000-0000-0000-000000000002';
const id = '20000000-0000-0000-0000-000000000001';
const org = '20000000-0000-0000-0000-000000000002';
const db = new PGlite();
let assertions = 0;
async function query(sql, params=[]) { return (await db.query(sql,params)).rows; }
async function scalar(sql, params=[]) { return Object.values((await query(sql,params))[0])[0]; }
async function check(sql, expected, params=[]) { assert.deepEqual(await scalar(sql,params),expected); assertions++; }
async function fails(sql, pattern, params=[]) { await assert.rejects(query(sql,params),pattern); assertions++; }
async function event(table, record) { return scalar('select id from public.audit_events where table_name=$1 and record_id=$2 order by sequence desc limit 1',[table, record]); }
async function rollback(eventId) { return scalar('select public.rollback_audit_event($1, $2)', [eventId, 'Correct test change']); }
async function asUser(user=owner, admin=false) {
  await db.exec('reset role');
  await query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)", [user,JSON.stringify({app_metadata:{crm_role:admin?'admin':'user'}})]);
  await db.exec('set role authenticated');
}
(async()=>{
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    grant usage on schema auth to authenticated;
    grant execute on all functions in schema auth to authenticated;
    -- pg_jsonschema is unavailable in PGlite. Schema validation is tested separately.
    create function extensions.jsonb_matches_schema(json,jsonb) returns boolean language sql immutable as $$select true$$;
    insert into auth.users values('${owner}'),('${other}');`);
  for (const file of ['001_initial','003_admin_access','004_carddav','005_carddav_uid','006_contact_relationships','007_organizations','008_contact_details']) {
    await db.exec(readFileSync(resolve(root,`sql/${file}.sql`),'utf8').replace('create extension if not exists pg_jsonschema with schema extensions;',''));
  }
  await db.exec(readFileSync(resolve(root,'supabase/migrations/20261030215720_audit_history.sql'),'utf8'));
  await asUser();
  await query('insert into contacts(id,name) values($1,$2)',[id,'Original']);
  const created = await event('contacts',id);
  await check('select actor_id from audit_events where id=$1',owner,[created]);
  await check('select before_data is null and after_data->>\'name\'=\'Original\' from audit_events where id=$1',true,[created]);
  await query(`update contacts set name='Edited', details='{"first_name":"Pat","emails":[{"value":"pat@example.test"}]}' where id=$1`,[id]);
  const edited = await event('contacts',id);
  await check('select before_data->>\'name\' from audit_events where id=$1','Original',[edited]);
  await rollback(edited);
  await check('select name from contacts where id=$1','Original',[id]);
  await check("select details ? 'first_name' from contacts where id=$1",false,[id]);
  await check('select email is null from contacts where id=$1',true,[id]);
  await check('select reason from audit_events where record_id=$1 order by sequence desc limit 1','Correct test change',[id]);
  await check('select reverts_transaction_id=(select transaction_id from audit_events where id=$1) from audit_events where record_id=$2 order by sequence desc limit 1',true,[edited,id]);
  await fails('select rollback_audit_event($1,$2)',/already been rolled back/,[edited,'Again']);
  // Undoing a rollback is permitted and keeps an unbroken chain of evidence.
  await rollback(await event('contacts',id));
  await check('select name from contacts where id=$1','Edited',[id]);
  await fails('select rollback_audit_event($1,$2)',/Newer changes|Record has changed/,[created,'Stale']);
  await fails('select rollback_audit_event($1,$2)',/reason/,[created,'   ']);
  await fails('insert into audit_events(table_name,record_id,owner_id,operation,after_data) values(\'contacts\',$1,$2,\'INSERT\',\'{}\')',/permission denied/,[id,owner]);
  await fails('update audit_events set reason=\'tampered\'',/permission denied/);
  await fails('delete from audit_events',/permission denied/);
  await fails('select crm_private.rollback_audit($1,$2)',/permission denied/,[edited,'Forged']);
  await fails('update contacts set owner_id=$1 where id=$2',/permission denied/,[other,id]);
  await asUser(other);
  await check('select count(*)::int from audit_events',0);
  await fails('select rollback_audit_event($1,$2)',/inaccessible/,[edited,'Not mine']);
  await asUser(other,true);
  await check('select count(*)::int > 0 from audit_events',true);
  await rollback(await event('contacts',id));
  await check('select actor_id from audit_events order by sequence desc limit 1',other);
  await asUser();
  await db.exec(`begin;
    insert into organizations(id,name) values('${org}','Example');
    insert into contact_organization_relationships(contact_id,organization_id,contact_relationship,organization_relationship)
      values('${id}','${org}','member','has member');
    commit;`);
  // Parent and link were created atomically: the link must be removed first.
  const orgCreated = await event('organizations',org);
  assert.equal((await rollback(orgCreated)).reverted_events,2); assertions++;
  await check('select count(*)::int from organizations where id=$1',0,[org]);
  await check('select count(*)::int from contact_organization_relationships',0);
  // A later child must prevent undoing a parent create (even with no later parent edit).
  await query('insert into organizations(id,name) values($1,$2)',[org,'Example']);
  const parentCreated = await event('organizations',org);
  await query('insert into contact_organization_relationships(contact_id,organization_id,contact_relationship,organization_relationship) values($1,$2,\'member\',\'has member\')',[id,org]);
  const linkId = await scalar('select id from contact_organization_relationships limit 1');
  await fails('select rollback_audit_event($1,$2)',/Dependent records/,[parentCreated,'Unsafe cascade']);
  await check('select count(*)::int from contact_organization_relationships',1);
  await query('delete from contact_organization_relationships where id=$1',[linkId]);
  const deletedLink = await event('contact_organization_relationships',linkId);
  await rollback(deletedLink);
  await check('select count(*)::int from contact_organization_relationships',1);
  // Soft deletion and structured details are restored exactly (except new updated_at).
  await query('update contacts set deleted_at=now() where id=$1',[id]);
  await rollback(await event('contacts',id));
  await check('select deleted_at is null from contacts where id=$1',true,[id]);
  await query('insert into history(contact_id,kind,body) values($1,\'note\',\'Retain me\')',[id]);
  await query(`insert into contacts(name) values('Related')`);
  const related = await scalar("select id from contacts where name='Related'");
  await query("insert into contact_relationships(contact_id,related_contact_id,relationship,inverse_relationship) values($1,$2,'friend','friend')",[id,related]);
  await query("insert into organizations(name) values('Peer')");
  const peer = await scalar("select id from organizations where name='Peer'");
  await query("insert into organization_relationships(organization_id,related_organization_id,relationship,inverse_relationship) values($1,$2,'peer','peer')",[org,peer]);
  const orgLink = await scalar('select id from organization_relationships limit 1');
  await query('delete from organization_relationships where id=$1',[orgLink]);
  await rollback(await event('organization_relationships',orgLink));
  await check('select count(*)::int from organization_relationships',1);
  await query("update organizations set name='Renamed' where id=$1",[org]);
  await rollback(await event('organizations',org));
  await check('select name from organizations where id=$1','Example',[org]);
  // Hard deletes through trusted SQL cascade. Audit snapshots survive and restore all children.
  await db.exec('reset role');
  await query('delete from contacts where id=$1',[id]);
  const hardDeleted = await event('contacts',id);
  await asUser();
  assert.equal((await rollback(hardDeleted)).reverted_events,4); assertions++;
  await check("select c.updated_at > (e.before_data->>'updated_at')::timestamptz from contacts c join audit_events e on e.id=$1 where c.id=$2",true,[hardDeleted,id]);
  await check('select count(*)::int from history where contact_id=$1',1,[id]);
  await check('select count(*)::int from contact_relationships where contact_id=$1',1,[id]);
  await check('select count(*)::int from contact_organization_relationships where contact_id=$1',1,[id]);
  // Reversing an activity insert is authorized only through the audited rollback RPC.
  await query('insert into history(contact_id,kind,body) values($1,\'note\',\'Mistake\')',[id]);
  const note = await scalar("select id from history where body='Mistake'");
  await rollback(await event('history',note));
  await check("select count(*)::int from history where body='Mistake'",0);
  // Successive undos can walk backward through versions; timestamps do not block them.
  await query("insert into contacts(name) values('Version 0')");
  const versioned = await scalar("select id from contacts where name='Version 0'");
  await query("update contacts set name='Version 1' where id=$1",[versioned]);
  const version1 = await event('contacts',versioned);
  await query("update contacts set name='Version 2' where id=$1",[versioned]);
  const version2 = await event('contacts',versioned);
  await fails('select rollback_audit_event($1,$2)',/Newer changes/,[version1,'Too early']);
  await rollback(version2);
  await rollback(version1);
  await check('select name from contacts where id=$1','Version 0',[versioned]);
  // Multiple writes to the same row in one transaction reverse in row order.
  await db.exec(`begin; update contacts set name='Middle' where id='${versioned}';
    update contacts set name='Final' where id='${versioned}'; commit;`);
  assert.equal((await rollback(await event('contacts',versioned))).reverted_events,2); assertions++;
  await check('select name from contacts where id=$1','Version 0',[versioned]);
  // Unsuccessful transactions leave neither a mutation nor an audit event.
  const before = await scalar('select count(*)::int from audit_events');
  await db.exec('begin');
  await query("update contacts set name='Never committed' where id=$1",[id]);
  await db.exec('rollback');
  await check('select count(*)::int from audit_events',before);
  // One owner cannot undo the visible portion of an administrator's multi-owner batch.
  await db.exec('reset role');
  await db.exec(`begin;
    insert into organizations(owner_id,name) values('${owner}','Batch own');
    insert into organizations(owner_id,name) values('${other}','Batch other');
    commit;`);
  const batch = await scalar("select id from audit_events where after_data->>'name'='Batch own'");
  await asUser();
  await fails('select rollback_audit_event($1,$2)',/includes records you cannot/,[batch,'Partial rollback']);
  await asUser(owner,true);
  assert.equal((await rollback(batch)).reverted_events,2); assertions++;
  // Trusted identity updates are also rejected by the capture trigger.
  await db.exec('reset role');
  await fails('update contacts set owner_id=$1 where id=$2',/identity and ownership/,[other,versioned]);
  // Anonymous callers cannot see audit records or invoke rollback.
  await db.exec('reset role; set role anon');
  await fails('select * from audit_events',/permission denied/);
  await fails('select rollback_audit_event($1,$2)',/permission denied/,[created,'Anonymous']);
  console.log(`Audit history: ${assertions} PostgreSQL assertions passed`);
  await db.close();
})().catch(async error=>{console.error(error); await db.close(); process.exitCode=1;});
