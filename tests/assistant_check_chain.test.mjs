import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {reviewQueueAction}=await import('../supabase/functions/staff-workspace-v12/review-queue.ts');
const root=path.resolve(import.meta.dirname,'..');

test('Assistant prepares, a Supervisor checks, a different Manager approves',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHK','Fictional check firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['MANAGER','MANAGER'],['MANAGER2','MANAGER'],['SUPERVISOR','SUPERVISOR'],['ASSISTANT','ASSISTANT']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2030-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL CHECK TEST LIMITED','Limited company','Fictional verified incorporation',12,31,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional accounting','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const r of ['MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[r].staff_id},${F},${actors[r].category_code})`;
 const rejects=(role,fn,re)=>assert.rejects(()=>as(role,fn),re);
 const sid=r=>actors[r].staff_id;

 await t.test('chart of accounts: an Assistant proposes, the check is required, the checker cannot approve',async()=>{
  const propose=(role,from)=>as(role,a=>tx`insert into erp_private.client_chart_versions(client_id,effective_from,entity_type,packs,accounts,prepared_by) values(${C},${from},'Limited company',${'{Wholesale}'},${'{10000,30000}'},${a.staff_id}) returning version_id`).then(r=>r[0].version_id);
  const decide=(role,v,status)=>as(role,a=>tx`update erp_private.client_chart_versions set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note='Fictional review conclusion' where version_id=${v} returning status`);
  const check=(role,v)=>as(role,a=>tx`update erp_private.client_chart_versions set checked_by=${a.staff_id},checked_at=now(),check_note='Fictional check conclusion' where version_id=${v} returning version_id`);
  const v1=await propose('ASSISTANT','2026-01-01');
  await assert.rejects(()=>decide('MANAGER',v1,'Approved'),/must check a chart prepared by an Assistant|must check/);
  assert.equal((await as('ASSISTANT',a=>tx`update erp_private.client_chart_versions set checked_by=${a.staff_id},checked_at=now(),check_note='Fictional self check' where version_id=${v1} returning version_id`)).length,0,'the preparer cannot check');
  assert.equal((await check('SUPERVISOR',v1)).length,1,'a Supervisor can record a check');
  await rejects('SUPERVISOR',()=>tx`update erp_private.client_chart_versions set status='Approved',reviewed_by=${sid('SUPERVISOR')},reviewed_at=now(),review_note='Fictional review conclusion' where version_id=${v1}`,/different Manager or Partner/);
  assert.equal((await decide('MANAGER',v1,'Approved'))[0].status,'Approved','a Manager approves the checked chart');
  const v2=await propose('ASSISTANT','2027-01-01');
  assert.equal((await check('MANAGER',v2)).length,1,'a Manager may check too');
  await assert.rejects(()=>decide('MANAGER',v2,'Approved'),/cannot also approve/);
  assert.equal((await decide('MANAGER2',v2,'Approved'))[0].status,'Approved','a different Manager approves');
  const v3=await propose('SUPERVISOR','2028-01-01');
  assert.equal((await decide('MANAGER',v3,'Approved'))[0].status,'Approved','a Supervisor-prepared chart needs no separate check');
  const v4=await propose('ASSISTANT','2029-01-01');
  assert.equal((await decide('SUPERVISOR',v4,'Returned'))[0].status,'Returned','a Supervisor can return an Assistant chart');
 });

 await t.test('client account mappings: Assistants and Supervisors only create their own Drafts',async()=>{
  const m=await as('ASSISTANT',a=>tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by) values(${C},'ASSISTANT-1000','Fictional bank','10000','2026-01-01',${a.staff_id}) returning mapping_id`).then(r=>r[0].mapping_id);
  await rejects('ASSISTANT',a=>tx`insert into erp_private.client_account_mappings(client_id,source_account_code,source_account_name,erp_account_code,effective_from,created_by,status,approved_by,approved_at) values(${C},'ASSISTANT-ACTIVE','Fictional','10000','2026-01-01',${a.staff_id},'Active',${a.staff_id},now())`,/policy|violates|different Manager|Create a draft account mapping/);
  await rejects('ASSISTANT',()=>tx`update erp_private.client_account_mappings set status='Active',approved_by=${sid('ASSISTANT')},approved_at=now() where mapping_id=${m}`,/policy|violates|different Manager|Create a draft account mapping/);
  assert.equal((await as('SUPERVISOR',()=>tx`update erp_private.client_account_mappings set erp_account_code='10000' where mapping_id=${m} returning mapping_id`)).length,0,'a Supervisor cannot change an Assistant draft');
  assert.equal((await as('ASSISTANT',()=>tx`update erp_private.client_account_mappings set source_account_name='Fictional bank account' where mapping_id=${m} returning mapping_id`)).length,1,'the creator can retarget their own draft');
  await as('MANAGER',a=>tx`update erp_private.client_account_mappings set status='Active',approved_by=${a.staff_id},approved_at=now() where mapping_id=${m}`);
  assert.equal((await tx`select status from erp_private.client_account_mappings where mapping_id=${m}`)[0].status,'Active','a Manager activates it');
  assert.equal((await as('ASSISTANT',()=>tx`update erp_private.client_account_mappings set source_account_name='Changed after approval' where mapping_id=${m} returning mapping_id`)).length,0,'an approved mapping stays out of the Assistant\'s reach');
 });

 await t.test('journals: Assistant work is checked first and posted by a different Manager',async()=>{
  await mapAllAccounts(tx,as,C);await readyForLedger(tx,C);
  const setup=await as('MANAGER',a=>ledgerAction(tx,a,{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'})),base={project_id:P,period_id:setup.period_id};
  const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{...base,...p},{download:async()=>({data:new Blob([''])})}));
  const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional source statement'});
  const make=async(role,ref,date='2026-01-31')=>{const j=await ledger(role,{action:'ledger_journal_save',kind:'Adjustment',reference:ref,journal_date:date,evidence:'Fictional supporting schedule',lines:[entry('10000',500,0),entry('30000',0,500)]});return j.journal_id;};
  const read=async(role,jid)=>ledger(role,{action:'ledger_journal_read',journal_id:jid});
  const submit=async(role,jid)=>ledger(role,{action:'ledger_journal_submit',journal_id:jid,revision:(await read(role,jid)).journal.revision});
  const post=async(role,jid,status='Posted')=>ledger(role,{action:'ledger_journal_review',journal_id:jid,revision:(await read(role,jid)).journal.revision,status,review_note:'Fictional independent review conclusion.'});
  const chk=async(role,jid,outcome='Checked')=>ledger(role,{action:'ledger_journal_check',journal_id:jid,revision:(await read(role,jid)).journal.revision,outcome,check_note:'Fictional check against the source schedule.'});

  const j1=await make('ASSISTANT','ADJ-1');await submit('ASSISTANT',j1);
  assert.equal((await read('MANAGER',j1)).check.needed,true);
  await assert.rejects(()=>post('MANAGER',j1),/must check it before/);
  await rejects('MANAGER',()=>tx`update erp_private.ledger_journals set status='Posted',reviewed_by=${sid('MANAGER')},review_note='Fictional independent review conclusion.' where journal_id=${j1}`,/must check this entry/);
  await assert.rejects(()=>chk('ASSISTANT',j1),/Supervisor, Manager or Partner must check/);
  await chk('SUPERVISOR',j1);
  const checked=await read('MANAGER',j1);assert.equal(checked.check.checked_by,sid('SUPERVISOR'));assert.equal(checked.journal.status,'Submitted');
  await assert.rejects(()=>chk('MANAGER',j1),/already been checked/);
  await assert.rejects(()=>post('SUPERVISOR',j1),/Manager or Partner must approve/);
  await post('MANAGER',j1);assert.equal((await read('MANAGER',j1)).journal.status,'Posted');

  const j2=await make('ASSISTANT','ADJ-2');await submit('ASSISTANT',j2);await chk('MANAGER',j2);
  await assert.rejects(()=>post('MANAGER',j2),/You checked this entry/);
  await rejects('MANAGER',()=>tx`update erp_private.ledger_journals set status='Posted',reviewed_by=${sid('MANAGER')},review_note='Fictional independent review conclusion.' where journal_id=${j2}`,/cannot also approve/);
  await post('MANAGER2',j2);assert.equal((await read('MANAGER',j2)).journal.status,'Posted');

  const j3=await make('ASSISTANT','ADJ-3');await submit('ASSISTANT',j3);
  const returned=await chk('SUPERVISOR',j3,'Returned');assert.equal(returned.status,'Returned');
  assert.equal((await read('ASSISTANT',j3)).journal.status,'Returned');
  await submit('ASSISTANT',j3);const again=await read('MANAGER',j3);assert.equal(again.check.checked_by,null,'a new submission needs a new check');

  const j4=await make('MANAGER','ADJ-4');await submit('MANAGER',j4);
  assert.equal((await read('MANAGER2',j4)).check.needed,false);
  await post('MANAGER2',j4);assert.equal((await read('MANAGER2',j4)).journal.status,'Posted','Manager work needs no separate check');

  const j5=await make('ASSISTANT','ADJ-5');await submit('ASSISTANT',j5);
  const supQueue=await as('SUPERVISOR',a=>reviewQueueAction(tx,a,{action:'v3_review_queue'})),mgrQueue=await as('MANAGER',a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}));
  assert.ok(supQueue.items.some(x=>x.kind==='journal'&&x.id===j5&&x.action==='check'),'the Supervisor sees it as awaiting check');
  assert.ok(mgrQueue.items.some(x=>x.kind==='journal'&&x.id===j5&&x.stage==='Awaiting check'),'the Manager sees that it is not ready yet');
  await chk('SUPERVISOR',j5);
  assert.equal((await as('SUPERVISOR',a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}))).items.some(x=>x.id===j5),false,'a checked entry leaves the Supervisor list');
  assert.match((await as('MANAGER',a=>reviewQueueAction(tx,a,{action:'v3_review_queue'}))).items.find(x=>x.id===j5).stage,/Checked by/);
 });
});
