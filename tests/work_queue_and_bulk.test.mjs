import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {workQueueAction}=await import('../supabase/functions/staff-workspace-v12/work-queue-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('build 2896: the work queue and the bulk Check, Return and Approve on journals',async t=>{
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
 await mapAllAccounts(tx,as,C);await readyForLedger(tx,C);
 const setup=await as('MANAGER',a=>ledgerAction(tx,a,{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'},{})),base={project_id:P,period_id:setup.period_id};
 const storage={download:async()=>({data:new Blob([''])})};
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{...base,...p},storage));
 const queue=role=>as(role,a=>workQueueAction(tx,a,{action:'work_queue'},storage));
 const bulk=(role,p)=>as(role,a=>workQueueAction(tx,a,{action:'work_queue_decide',...p},storage));
 const entry=(code,debit,credit)=>({account_code:code,debit,credit,source_status:'Confirmed',source_reference:'Fictional source statement'});
 const make=async(role,ref)=>(await ledger(role,{action:'ledger_journal_save',kind:'Adjustment',reference:ref,journal_date:'2026-01-31',evidence:'Fictional supporting schedule',lines:[entry('10000',500,0),entry('30000',0,500)]})).journal_id;
 const read=(role,jid)=>ledger(role,{action:'ledger_journal_read',journal_id:jid});
 const submit=async(role,jid)=>ledger(role,{action:'ledger_journal_submit',journal_id:jid,revision:(await read(role,jid)).journal.revision});
 const status=async jid=>(await tx`select status,checked_by from erp_private.ledger_journals where journal_id=${jid}`)[0];
 const NOTE='Fictional bulk note, long enough.';

 const a1=await make('ASSISTANT','BULK-A1'),a2=await make('ASSISTANT','BULK-A2'),a3=await make('ASSISTANT','BULK-A3'),m1=await make('MANAGER','BULK-M1');
 for(const j of [a1,a2,a3])await submit('ASSISTANT',j);await submit('MANAGER',m1);

 await t.test('the queue puts work in three groups and shows only what the person may decide',async()=>{
  const sup=await queue('SUPERVISOR');
  const mineTodo=sup.items.filter(x=>x.group==='To do'&&x.kind==='journal');
  assert.deepEqual(mineTodo.map(x=>x.id).sort(),[a1,a2,a3].sort(),'the Supervisor sees the Assistant journals to check');
  assert.ok(mineTodo.every(x=>x.can.includes('check')&&x.can.includes('return')&&!x.can.includes('approve')));
  assert.equal(sup.items.some(x=>x.id===m1),false,'a Manager journal needs no check, so it is not in the Supervisor list');
  const ass=await queue('ASSISTANT');
  assert.ok(ass.items.filter(x=>[a1,a2,a3].includes(x.id)).every(x=>x.group==='In progress'&&x.can.length===0),'the preparer sees them as in progress, with nothing to decide');
  assert.equal(ass.counts['In progress']>=3,true);
  actors.INTERN={...actors.ASSISTANT,category_code:'INTERN'};
  await assert.rejects(()=>as('INTERN',a=>workQueueAction(tx,a,{action:'work_queue'},storage)),/Assigned accounting staff/);
 });
 await t.test('bulk check needs a note, a person who did not prepare, and refuses whole when one is not allowed',async()=>{
  await assert.rejects(()=>bulk('SUPERVISOR',{decision:'check',journal_ids:[a1,a2],note:'short'}),/at least 10/);
  await assert.rejects(()=>bulk('ASSISTANT',{decision:'check',journal_ids:[a1],note:NOTE}),/Nothing was changed.*BULK-A1.*prepared or edited/);
  await assert.rejects(()=>bulk('SUPERVISOR',{decision:'check',journal_ids:[a1,m1],note:NOTE}),/Nothing was changed.*BULK-M1.*no separate check/);
  assert.equal((await status(a1)).checked_by,null,'the good journal was not changed when another was refused');
  const r=await bulk('SUPERVISOR',{decision:'check',journal_ids:[a1,a2],note:NOTE});
  assert.equal(r.done,2);assert.equal((await status(a1)).checked_by!==null,true);assert.equal((await status(a2)).checked_by!==null,true);
  await assert.rejects(()=>bulk('SUPERVISOR',{decision:'check',journal_ids:[a1],note:NOTE}),/already been checked/);
 });
 await t.test('bulk approve: a tick, a note, the checker cannot approve, the maker cannot approve, and it posts together',async()=>{
  await assert.rejects(()=>bulk('MANAGER',{decision:'approve',journal_ids:[a1],note:NOTE}),/Tick the box/);
  await assert.rejects(()=>bulk('MANAGER',{decision:'approve',journal_ids:[a1,m1],note:NOTE,confirm_reviewed:true}),/Nothing was changed.*BULK-M1.*you prepared or edited it/);
  assert.equal((await status(a1)).status,'Submitted');
  await assert.rejects(()=>bulk('MANAGER',{decision:'approve',journal_ids:[a1,a3],note:NOTE,confirm_reviewed:true}),/BULK-A3.*needs a check first/);
  await ledger('MANAGER',{action:'ledger_journal_check',journal_id:a3,revision:String((await read('MANAGER',a3)).journal.revision),outcome:'Checked',check_note:NOTE});
  await assert.rejects(()=>bulk('MANAGER',{decision:'approve',journal_ids:[a1,a3],note:NOTE,confirm_reviewed:true}),/BULK-A3.*you checked it/);
  await assert.rejects(()=>bulk('SUPERVISOR',{decision:'approve',journal_ids:[a1],note:NOTE,confirm_reviewed:true}),/only a Manager or Partner approves/);
  const r=await bulk('MANAGER2',{decision:'approve',journal_ids:[a1,a2,a3],note:NOTE,confirm_reviewed:true});
  assert.equal(r.done,3);for(const j of [a1,a2,a3])assert.equal((await status(j)).status,'Posted');
  assert.ok((await queue('ASSISTANT')).items.some(x=>x.id===a1&&x.group==='Done'),'a posted journal moves to Done');
  const many=Array.from({length:26},()=>crypto.randomUUID());
  await assert.rejects(()=>bulk('MANAGER2',{decision:'approve',journal_ids:many,note:NOTE,confirm_reviewed:true}),/between 1 and 25/);
 });
 await t.test('bulk return needs a reason, goes back to the preparer, and shows in their To do',async()=>{
  await assert.rejects(()=>bulk('MANAGER2',{decision:'return',journal_ids:[m1],note:''}),/reason for returning/);
  await assert.rejects(()=>bulk('MANAGER',{decision:'return',journal_ids:[m1],note:NOTE}),/you prepared or edited it/);
  const r=await bulk('MANAGER2',{decision:'return',journal_ids:[m1],note:'Fictional: support is missing for the 500.'});
  assert.equal(r.done,1);assert.equal((await status(m1)).status,'Returned');
  const mine=(await queue('MANAGER')).items.find(x=>x.id===m1);
  assert.equal(mine.group,'To do');assert.match(mine.stage,/Returned: Fictional: support is missing/);
  const a4=await make('ASSISTANT','BULK-A4');await submit('ASSISTANT',a4);
  const sup=await bulk('SUPERVISOR',{decision:'return',journal_ids:[a4],note:'Fictional: wrong period on the journal.'});
  assert.equal(sup.done,1);assert.equal((await status(a4)).status,'Returned','a Supervisor can return an Assistant journal at the check stage');
 });
 await t.test('a journal that changed since the list was opened is not decided',async()=>{
  const a5=await make('ASSISTANT','BULK-A5');await submit('ASSISTANT',a5);
  await assert.rejects(()=>bulk('SUPERVISOR',{decision:'check',journal_ids:[a5],note:NOTE,revisions:[{journal_id:a5,revision:'999'}]}),/Nothing was changed.*changed since you opened the list/);
  assert.equal((await status(a5)).checked_by,null);
  const audit=await tx`select count(*)::int n from erp_private.audit_events where action='WORK_QUEUE_BATCH_DECISION'`;assert.ok(audit[0].n>=3,'each bulk decision leaves an audit record');
 });
});

test('the work queue screen, the bulk bar and the rules are wired',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
 const idx=rd('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/workQueueAction\(tx,a,p,/);
 const ui=rd('staff-work-queue.mjs');
 assert.match(ui,/action:'work_queue'/);assert.match(ui,/action:'work_queue_decide'/);
 assert.match(ui,/To do/);assert.match(ui,/In progress/);assert.match(ui,/Done/);
 assert.match(ui,/Return with a reason|Return with reason/);assert.match(ui,/confirm_reviewed:/);
 assert.match(ui,/name="confirm_reviewed" value="yes" required/,'the approve tick starts unticked and is required');
 assert.doesNotMatch(ui,/checked(?=[^a-z_])[^>]*name="confirm_reviewed"/,'the confirmation is never ticked for the person');
});
