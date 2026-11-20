import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {withdrawAction}=await import('../supabase/functions/staff-workspace-v12/withdraw-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('Withdraw from review: only the preparer, only before anyone has acted',async t=>{
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
 // A blocked update either raises or changes no row (row-level security hides it).
 const blocked=async(role,fn)=>{let changed=0;try{changed=(await as(role,fn)).length;}catch{return;}assert.equal(changed,0,'the update must not change anything');};
 await mapAllAccounts(tx,as,C);await readyForLedger(tx,C);
 const setup=await as('MANAGER',a=>ledgerAction(tx,a,{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'})),base={project_id:P,period_id:setup.period_id};
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{...base,...p},{download:async()=>({data:new Blob([''])})}));
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional source statement'});
 const make=async(role,ref)=>(await ledger(role,{action:'ledger_journal_save',kind:'Adjustment',reference:ref,journal_date:'2026-01-31',evidence:'Fictional supporting schedule',lines:[entry('10000',500,0),entry('30000',0,500)]})).journal_id;
 const read=(role,jid)=>ledger(role,{action:'ledger_journal_read',journal_id:jid});
 const submit=async(role,jid)=>ledger(role,{action:'ledger_journal_submit',journal_id:jid,revision:(await read(role,jid)).journal.revision});
 const withdraw=(role,kind,record_id,revision,reason='Fictional wrong amount')=>as(role,a=>withdrawAction(tx,a,{action:'work_withdraw',kind,record_id,revision,reason}));
 const notes=async()=>(await tx`select message from erp_private.notifications where message like 'No review needed for now%'`).map(r=>r.message);

 await t.test('journal: the preparer pulls it back, the reviewer is told, and it can be resubmitted',async()=>{
  const j=await make('ASSISTANT','WD-1');await submit('ASSISTANT',j);
  let rec=(await read('ASSISTANT',j)).journal;assert.equal(rec.status,'Submitted');
  await assert.rejects(()=>withdraw('MANAGER','journal',j,rec.revision),/Only the person who prepared/);
  await assert.rejects(()=>withdraw('ASSISTANT','journal',j,rec.revision,'x'),/Say briefly why/);
  await assert.rejects(()=>withdraw('ASSISTANT','journal',j,Number(rec.revision)+9),/changed/);
  // Without the server action the database still refuses to move a submitted journal back.
  await blocked('ASSISTANT',()=>tx`update erp_private.ledger_journals set status='Draft' where journal_id=${j} returning journal_id`);
  const before=(await notes()).length;
  const out=await withdraw('ASSISTANT','journal',j,rec.revision);assert.equal(out.status,'Draft');
  rec=(await read('ASSISTANT',j)).journal;assert.equal(rec.status,'Draft');
  assert.ok((await notes()).length>before,'reviewers are notified');
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='WITHDRAWN_FROM_REVIEW' and record_key=${j}`)[0].n,1);
  await assert.rejects(()=>withdraw('ASSISTANT','journal',j,rec.revision),/Only work that is waiting for review/);
  await submit('ASSISTANT',j);assert.equal((await read('ASSISTANT',j)).journal.status,'Submitted','it can be resubmitted');
 });

 await t.test('journal: once a reviewer has checked it, it can no longer be withdrawn',async()=>{
  const j=await make('ASSISTANT','WD-2');await submit('ASSISTANT',j);
  await ledger('SUPERVISOR',{action:'ledger_journal_check',journal_id:j,revision:(await read('SUPERVISOR',j)).journal.revision,outcome:'Checked',check_note:'Fictional check against the source schedule.'});
  const rec=(await read('ASSISTANT',j)).journal;
  await assert.rejects(()=>withdraw('ASSISTANT','journal',j,rec.revision),/already started/);
  await blocked('ASSISTANT',async()=>{await tx`select set_config('erp.withdraw','journal',true)`;return await tx`update erp_private.ledger_journals set status='Draft' where journal_id=${j} returning journal_id`;});
  assert.equal((await read('ASSISTANT',j)).journal.status,'Submitted','still waiting for review even with the flag set by hand');
 });

 await t.test('a posted journal cannot be withdrawn',async()=>{
  const j=await make('MANAGER','WD-3');await submit('MANAGER',j);
  await ledger('MANAGER2',{action:'ledger_journal_review',journal_id:j,revision:(await read('MANAGER2',j)).journal.revision,status:'Posted',review_note:'Fictional independent review conclusion.'});
  {const rv=(await read('MANAGER',j)).journal.revision;await assert.rejects(()=>withdraw('MANAGER','journal',j,rv),/Only work that is waiting for review/);}
 });

 await t.test('period import: the preparer withdraws a submitted summary until it is confirmed',async()=>{
  const D=id(),T=id();
  await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${sid('ASSISTANT')},'Fictional capture')`;
  await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Import Sources','Fictional.csv',${'qa/'+D},100,${'b'.repeat(64)},'text/csv',${sid('ASSISTANT')})`);
  const imp=await as('ASSISTANT',a=>tx`insert into erp_private.period_imports(project_id,client_id,document_id,kind,starts_on,ends_on,payload,source_hash,prepared_by) values(${P},${C},${D},'Sales','2026-09-01','2026-09-30',${tx.json({groups:[{vat_category:'16%',net:1000,vat:160}]})},${id()},${a.staff_id}) returning import_id,revision`).then(r=>r[0]);
  await as('ASSISTANT',()=>tx`update erp_private.period_imports set status='Submitted' where import_id=${imp.import_id}`);
  const rev=(await tx`select revision from erp_private.period_imports where import_id=${imp.import_id}`)[0].revision;
  await assert.rejects(()=>withdraw('SUPERVISOR','period_import',imp.import_id,rev),/Only the person who prepared/);
  await blocked('ASSISTANT',()=>tx`update erp_private.period_imports set status='Draft' where import_id=${imp.import_id} returning import_id`);
  assert.equal((await tx`select status from erp_private.period_imports where import_id=${imp.import_id}`)[0].status,'Submitted');
  await withdraw('ASSISTANT','period_import',imp.import_id,rev);
  assert.equal((await tx`select status from erp_private.period_imports where import_id=${imp.import_id}`)[0].status,'Draft');
  await as('ASSISTANT',()=>tx`update erp_private.period_imports set status='Submitted' where import_id=${imp.import_id}`);
  await as('SUPERVISOR',a=>tx`update erp_private.period_imports set status='Confirmed',reviewed_by=${a.staff_id},review_note='Fictional independent review conclusion.' where import_id=${imp.import_id}`);
  {const rv2=(await tx`select revision from erp_private.period_imports where import_id=${imp.import_id}`)[0].revision;await assert.rejects(()=>withdraw('ASSISTANT','period_import',imp.import_id,rv2),/Only work that is waiting for review/);}
 });

 await t.test('sales reconciliation: withdrawn by its preparer only, never after review',async()=>{
  const rec=await as('ASSISTANT',a=>tx`insert into erp_private.sales_reconciliations(project_id,review_type,starts_on,ends_on,prepared_by) values(${P},'Monthly','2026-10-01','2026-10-31',${a.staff_id}) returning reconciliation_id`).then(r=>r[0].reconciliation_id);
  await as('ASSISTANT',()=>tx`update erp_private.sales_reconciliations set status='Submitted' where reconciliation_id=${rec}`);
  const revOf=async()=>(await tx`select revision from erp_private.sales_reconciliations where reconciliation_id=${rec}`)[0].revision;
  await blocked('ASSISTANT',()=>tx`update erp_private.sales_reconciliations set status='Draft' where reconciliation_id=${rec} returning reconciliation_id`);
  assert.equal((await tx`select status from erp_private.sales_reconciliations where reconciliation_id=${rec}`)[0].status,'Submitted');
  {const r1=await revOf();await assert.rejects(()=>withdraw('SUPERVISOR','sales_recon',rec,r1),/Only the person who prepared/);}
  await withdraw('ASSISTANT','sales_recon',rec,await revOf());
  assert.equal((await tx`select status from erp_private.sales_reconciliations where reconciliation_id=${rec}`)[0].status,'Draft');
  await as('ASSISTANT',()=>tx`update erp_private.sales_reconciliations set status='Submitted' where reconciliation_id=${rec}`);
  await as('SUPERVISOR',a=>tx`update erp_private.sales_reconciliations set status='Locked',reviewed_by=${a.staff_id},review_note='Fictional independent review conclusion.' where reconciliation_id=${rec}`);
  {const r2=await revOf();await assert.rejects(()=>withdraw('ASSISTANT','sales_recon',rec,r2),/Only work that is waiting for review/);}
 });

 await t.test('screens and server are wired',()=>{
  const ui=fs.readFileSync(root+'/staff-withdraw.mjs','utf8'),led=fs.readFileSync(root+'/staff-ledger.mjs','utf8'),acc=fs.readFileSync(root+'/staff-accounting.mjs','utf8'),imp=fs.readFileSync(root+'/staff-period-imports.mjs','utf8'),idx=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/index.ts','utf8');
  assert.match(ui,/Withdraw from review/);assert.match(ui,/work_withdraw/);
  for(const src of [led,acc,imp])assert.match(src,/withdrawButton\(/);
  assert.match(idx,/withdrawAction\(tx,a,p\)/);
  for(const f of ['staff-period-imports.mjs','staff-accounting.mjs']){const s=fs.readFileSync(root+'/'+f,'utf8');assert.match(s,/staff-guide-text\.mjs/);}
 });
});
