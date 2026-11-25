import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
import {clientVaultAction, clientVaultAccess} from '../supabase/functions/staff-workspace-v12/client-vault-actions.ts';
import {openClientPassword, sealClientPassword} from '../supabase/functions/staff-workspace-v12/credential-vault-crypto.mjs';
import {workloadAction} from '../supabase/functions/staff-workspace-v12/workload-actions.ts';
import {openWorkload, workloadShell} from '../staff-workload.mjs';
import {mountClientVault} from '../staff-client-vault.mjs';

const fakeKey = '8a'.repeat(32);
const fakePassword = '\uFEFF  Only a fictional test ☃  ';
const id = () => crypto.randomUUID();

test('vault encryption authenticates client, portal and key version and preserves the exact password',async () => {
 const client = id(), type = 'KRA_ITAX', ver = 'V1';
 const entry = await sealClientPassword(fakeKey,client,type,ver,fakePassword);
 const another = await sealClientPassword(fakeKey,client,type,ver,fakePassword);
 assert.notEqual(entry.nonce, another.nonce);
 assert.notEqual(entry.ciphertext, another.ciphertext);
 assert.equal(await openClientPassword(fakeKey,client,type,ver,entry),fakePassword);
 await assert.rejects(openClientPassword(fakeKey,id(),type,ver,entry));
 await assert.rejects(openClientPassword(fakeKey,client,'KRA_ETIMS',ver,entry));
 await assert.rejects(openClientPassword(fakeKey,client,type,'V2',entry));
 await assert.rejects(openClientPassword(fakeKey,client,type,ver,{...entry,ciphertext:'A'.repeat(entry.ciphertext.length)}));
 await assert.rejects(openClientPassword('invalid',client,type,ver,entry));
});

test('KRA password is masked by default, hidden on window blur and ignored after tab navigation',async t => {
 const dom = new JSDOM('<body><main></main></body>',{pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 const host = dom.window.document.querySelector('main');
 let resolve, requests = [];
 mountClientVault(host,{clientId:id(),esc:String,shortDate:String,request:async p=>{
  requests.push(p.action);
  if (p.action==='client_vault_list') return {credentials:[{credential_type:'KRA_ITAX',username:'FICTIONAL_PIN'}],can_edit:false};
  return new Promise(done=>{resolve=done;});
 }});
 await new Promise(setImmediate);
 const reveal = host.querySelector('[data-vault-reveal]'), value = host.querySelector('code');
 assert.deepEqual(requests,['client_vault_list']);
 assert.equal(value.textContent,'••••••••••••');
 reveal.click();
 resolve({password:fakePassword});
 await new Promise(setImmediate);
 assert.equal(value.textContent,fakePassword);
 dom.window.dispatchEvent(new dom.window.Event('blur'));
 assert.equal(value.textContent,'••••••••••••');
 reveal.click();
 host.remove();
 resolve({password:fakePassword});
 await new Promise(setImmediate);
 assert.equal(value.textContent,'••••••••••••');
});

test('workload select-all skips protected rows and confirms the selected revision',async t => {
 const dom = new JSDOM('<body><dialog open>'+workloadShell+'</dialog></body>',{pretendToBeVisual:true});
 t.after(()=>dom.window.close());
 const host = dom.window.document.querySelector('#workloadPanel'), a = id(), b = id(), recipient = id();
 const requests = [];
 openWorkload({host,leader:true,mode:'tasks',esc:String,refresh:async()=>{},request:async p=>{
  requests.push(p);
  if (p.action==='task_workload_list') return {total:2,records:[
   {id:a,revision:6,task_name:'Draft work',project_name:'Test project',client_name:'Test client',status:'Pending'},
   {id:b,revision:7,task_name:'Review work',project_name:'Test project',client_name:'Test client',status:'In Review',blocker:'Return to preparer'}
  ]};
  if (p.action==='task_workload_candidates') return {people:[{staff_id:recipient,full_name:'Assigned colleague',category_code:'ASSISTANT',on_leave:true}]};
  return {count:1};
 }});
 await new Promise(setImmediate);
 assert.equal(host.querySelector('[data-toolbar]').hidden,true);
 assert.equal(host.querySelectorAll('[data-record]:disabled').length,1);
 host.querySelector('[data-select-all]').click();
 assert.equal(host.querySelector('[data-count]').textContent,'1 task selected');
 host.querySelector('[data-assign]').click();
 await new Promise(setImmediate);
 const form = host.querySelector('[data-action-form] form');
 form.elements.staff_id.value = recipient;
 form.elements.staff_id.dispatchEvent(new dom.window.Event('change'));
 assert.equal(form.elements.confirm_leave.required,true);
 form.elements.confirm_leave.checked = true;
 form.elements.reason.value = 'Rebalance this week’s work';
 form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
 await new Promise(setImmediate);
 const command = requests.find(request => request.action==='task_workload_apply');
 assert.deepEqual(command.items,[{id:a,revision:'6'}]);
 assert.equal(command.confirm_leave,true);
 assert.equal(host.querySelector('[data-feedback]').textContent,'1 task(s) updated.');
});

test('full migration replay and scoped vault and workload transactions',async t => {
 const db = new PGlite();
 t.after(()=>db.close());
 globalThis.Deno = {env:{get:key=>({PCL_CLIENT_VAULT_KEY_V1:fakeKey,PCL_CLIENT_VAULT_ACTIVE_KEY:'V1'}[key])}};
 t.after(()=>delete globalThis.Deno);
 const tx = async (parts,...values) => {
  const query = parts.reduce((sql,part,i)=>sql+part+(i<values.length?'$'+(i+1):''),'');
  return (await db.query(query,values)).rows;
 };
 tx.json = JSON.stringify;
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
  create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 const migrations = new URL('../supabase/migrations/',import.meta.url);
 for (const name of readdirSync(migrations).sort()) {
  const sql = readFileSync(new URL(name,migrations),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');
  try {await db.exec(sql);}
  catch (error) {throw Error('Migration failed: '+name+' · '+error.message,{cause:error});}
 }
 await db.exec('alter table erp_private.tasks disable trigger task_assignee_guard;alter table erp_private.project_schedules disable trigger schedule_assignee_guard;'); // fixture: this test exercises the older unassigned pool and Manager-held tasks; the assignment rule is tested in assistant_only_assignment.test.mjs. The pool screen is removed; its database functions are retired in a follow-up.
 const staff = {};
 const firm=id(), client=id(), project=id(), otherClient=id(), otherProject=id();
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${firm},'VAULTQA','Test firm')`;
 for (const [name,role] of [['partner','PARTNER'],['manager','MANAGER'],['preparer','ASSISTANT'],['recipient','ASSISTANT'],['outsider','ASSISTANT']]) {
  const a = staff[name] = {staff_id:id(),auth_user_id:id(),session:id(),category_code:role};
  await tx`insert into auth.users(id) values(${a.auth_user_id})`;
  await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;
  await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,
   contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${name},${name},${name},${role},
   'Permanent',(current_date+365),'Active',now()-interval '1 day')`;
  await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;
  await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;
 }
 async function as(name,run) {
  const staffer = staff[name];
  await db.exec('begin');
  try {
   await tx`select set_config('request.jwt.claims',${JSON.stringify({sub:staffer.auth_user_id,session_id:staffer.session})},true)`;
   await db.exec('set local role erp_api');
   const result = await run(staffer);
   await db.exec('commit');
   return result;
  } catch (error) {
   await db.exec('rollback');
   throw error;
  }
 }
 const ca = (name,p) => as(name,a=>clientVaultAction(tx,a,{client_id:client,credential_type:'KRA_ITAX',...p}));
 const wa = (name,p) => as(name,a=>workloadAction(tx,a,p));
 const manager = staff.manager.staff_id, preparer = staff.preparer.staff_id, recipient = staff.recipient.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type)
  values(${client},'Atlas client',${manager},'Limited company'),(${otherClient},'Beacon client',${manager},'Limited company')`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${client},${firm}),(${otherClient},${firm})`;
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id,status)
  values(${project},${client},${firm},'Atlas project','ADV-CTRL',${manager},'Active'),
        (${otherProject},${otherClient},${firm},'Beacon project','ADV-CTRL',${manager},'Active')`;
 await db.exec('set session_replication_role=origin');
 for (const name of ['partner','manager','preparer','recipient']) {
  const a = staff[name];
  await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
   values(${project},${a.staff_id},${firm},${a.category_code})`;
 }

 const list = {action:'client_vault_list'}, reveal = {action:'client_vault_reveal'};
 const access = (staff_id,permission,expected='Revoked') =>
  ca('partner',{action:'client_vault_permissions',staff_id,permission,expected});
 assert.deepEqual(await as('partner',()=>clientVaultAccess(tx,staff.partner.staff_id,['clients'],[])),[client]);
 await assert.rejects(ca('partner',{...list,client_id:otherClient}),/active assignment/);
 await assert.rejects(ca('manager',list),/credential permission/);
 await assert.rejects(access(staff.outsider.staff_id,'View'),/eligible/);
 await assert.rejects(access(preparer,'Edit'),/eligible/);
 await access(manager,'Edit');
 await access(preparer,'View');
 assert.equal((await ca('manager',list)).can_edit,true);
 const update = {action:'client_vault_update',username:'TEST_PIN',password:fakePassword,revision:0};
 await assert.rejects(ca('preparer',update),/credential permission/);
 assert.equal((await ca('manager',update)).revision,1);
 await assert.rejects(ca('manager',update),/Someone updated/);
 assert.equal((await ca('preparer',reveal)).password,fakePassword);
 const metadata = await ca('preparer',list);
 assert.deepEqual(Object.keys(metadata.credentials[0]).sort(),['credential_type','revision','updated_at','username']);
 assert.deepEqual((await tx`select action,actor_id from erp_private.client_credential_events order by occurred_at`).map(x=>[x.action,x.actor_id]),
  [['UPDATE',manager],['REVEAL',preparer]]);
 assert.equal(metadata.activity,null);
 assert.equal((await ca('partner',list)).activity.length,2);
 const row = (await tx`select * from erp_private.client_credentials`)[0];
 assert.equal('password' in row,false);
 assert.equal(JSON.stringify(row).includes(fakePassword),false);
 await assert.rejects(db.exec("update erp_private.client_credential_events set action='UPDATE'"),/immutable|changed|read.only|append.only/i);
 await tx`insert into erp_private.staff_right_restrictions(staff_id,right_code,reason,created_by) values(${preparer},'clientvault.view','Test restriction',${staff.partner.staff_id})`;
 await assert.rejects(ca('preparer',reveal),/credential permission/);
 await access(preparer,'Revoked','View');

 const addTask = async (name,to=null,pid=project) =>
  (await tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${pid},${to},${name}) returning task_id as id,revision`)[0];
 const pool = await addTask('Pool item');
 await addTask('Out-of-scope pool item',null,otherProject);
 const one = await addTask('Move first',preparer), two = await addTask('Move second',preparer);
 const review = await addTask('Review already started',preparer);
 await tx`update erp_private.tasks set status='In Review' where task_id=${review.id}`;
 review.revision = (await tx`select revision from erp_private.tasks where task_id=${review.id}`)[0].revision;
 const read = {action:'task_workload_list',mode:'pool',search:'item'};
 const apply = (name,operation,items,fields={}) => wa(name,{action:'task_workload_apply',operation,items,...fields});
 const reason = 'Balance the current engagement workload';
 assert.deepEqual((await wa('preparer',read)).records.map(x=>x.id),[pool.id]);
 assert.deepEqual((await wa('outsider',read)).records,[]);
 await assert.rejects(apply('outsider','claim',[pool]),/unavailable/);
 assert.equal((await apply('preparer','claim',[pool])).count,1);
 await assert.rejects(apply('preparer','claim',[pool]),/changed or was claimed/);
 const doc = id();
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,
  file_size_bytes,sha256,mime_type,uploaded_by) values(${doc},${client},${firm},${project},${one.id},'Working Papers','qa.pdf',
   ${'workload-qa/'+doc},10,${'a'.repeat(64)},'application/pdf',${preparer})`;
 await as('manager',()=>tx`insert into erp_private.document_access_grants(document_id,grantee_id,granted_by,reason,expires_at)
  values(${doc},${preparer},${manager},'Temporary access while preparing',now()+interval '7 days')`);
 assert.equal((await as('preparer',()=>tx`select document_id from erp_private.documents where document_id=${doc}`)).length,1);
 const targets = (await wa('manager',{action:'task_workload_candidates',operation:'assign',items:[one,two]})).people;
 assert.ok(targets.some(x=>x.staff_id===recipient));
 assert.ok(!targets.some(x=>x.staff_id===staff.outsider.staff_id));
 await assert.rejects(apply('manager','assign',[one,review],{staff_id:recipient,reason}),/Return in.review/);
 assert.equal((await tx`select assigned_to from erp_private.tasks where task_id=${one.id}`)[0].assigned_to,preparer);
 await tx`insert into erp_private.leave_requests(staff_id,leave_type,starts_on,ends_on,working_days,reason,status)
  values(${recipient},'Annual',(now() at time zone 'Africa/Nairobi')::date,(now() at time zone 'Africa/Nairobi')::date,1,'Test leave','Approved')`;
 await assert.rejects(apply('manager','assign',[one,two],{staff_id:recipient,reason}),/approved leave/);
 assert.equal((await apply('manager','assign',[one,two],{staff_id:recipient,reason,confirm_leave:true})).count,2);
 assert.equal((await as('preparer',()=>tx`select document_id from erp_private.documents where document_id=${doc}`)).length,0);
 assert.equal((await as('recipient',()=>tx`select document_id from erp_private.documents where document_id=${doc}`)).length,1);
 assert.equal((await tx`select revoked_by from erp_private.document_access_grants where document_id=${doc}`)[0].revoked_by,manager);
 assert.deepEqual((await tx`select distinct prepared_by from erp_private.task_procedures where task_id in(${one.id},${two.id})`).map(r=>r.prepared_by),[recipient]);
 assert.equal((await tx`select count(*)::int as n from erp_private.task_events where event_type in ('Reassigned','Claimed for preparation')`)[0].n,3);
 const [current] = await tx`select task_id as id,revision from erp_private.tasks where task_id=${one.id}`;
 const due = '2027-12-01';
 assert.equal((await apply('manager','due',[current],{due})).count,1);
 assert.equal((await tx`select (due_at at time zone 'Africa/Nairobi')::text as due_at from erp_private.tasks where task_id=${one.id}`)[0].due_at,'2027-12-01 17:00:00');
 const projects = await wa('manager',{action:'task_workload_list',mode:'projects',search:'Atlas'});
 assert.equal(projects.records.length,1);
 assert.equal((await apply('manager','project_owner',projects.records,{staff_id:staff.partner.staff_id,reason})).count,1);
 assert.equal((await tx`select owner_staff_id from erp_private.projects where project_id=${project}`)[0].owner_staff_id,staff.partner.staff_id);
});
