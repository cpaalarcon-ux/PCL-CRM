import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {workQueueAction}=await import('../supabase/functions/staff-workspace-v12/work-queue-actions.ts');
const {formDraftAction}=await import('../supabase/functions/staff-workspace-v12/form-draft-actions.ts');
const rules=await import('../supabase/functions/staff-workspace-v12/form-draft-rules.mjs');
const root=path.resolve(import.meta.dirname,'..');

test('build 2903 rules: only known forms are kept, secrets and oversize drafts are refused, the audit shape holds no contents',()=>{
 assert.equal(rules.kindLabel('ledger_journal'),'Journal entry');assert.equal(rules.kindLabel('made_up'),'');
 assert.deepEqual(rules.draftIssues({kind:'made_up',subject_key:'x',title:'t'}),['This form cannot be saved as a draft.']);
 assert.match(rules.draftIssues({kind:'ledger_journal',subject_key:'bad key!',title:'t'}).join(' '),/valid subject key/);
 assert.equal(rules.cleanPayload({fields:{reference:'J1'},lines:[{debit:5}]}).ok,true);
 for(const name of ['password','new_password','api_key','apiKey','access_token','client_secret','Authorization','otp'])assert.equal(rules.cleanPayload({fields:{[name]:'x'}}).ok,false,name+' is refused');
 assert.equal(rules.cleanPayload({fields:{kra_pin:'A000000000Z'}}).ok,true,'a KRA PIN is a tax identifier, not a secret');
 assert.equal(rules.cleanPayload({a:'x'.repeat(70000)}).ok,false);assert.equal(rules.cleanPayload([1]).ok,false);assert.equal(rules.cleanPayload(null).ok,false);
 assert.equal(rules.draftTitle('ledger_journal','   '),'Journal entry');
 assert.deepEqual(Object.keys(rules.auditShape('ledger_journal','k','T',{secretish:'typed text'})).sort(),['form_kind','size_chars','subject_key','title']);
 assert.equal(rules.ledgerSubject('P','Q','',"Adjustment"),'ledger:P:Q:new-adjustment');
});

test('build 2903: private resumable form drafts, saved to the server and resumed after a new sign-in',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'CHK','Fictional check firm')`;
 const newSession=async role=>{const a=actors[role],s=id();await tx`insert into auth.sessions(id,user_id) values(${s},${a.auth_user_id})`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${s},${a.staff_id},now()+interval '1 hour')`;a.session=s;};
 for(const [role,cat] of [['PARTNER','PARTNER'],['MANAGER','MANAGER'],['SUPERVISOR','SUPERVISOR'],['ASSISTANT','ASSISTANT'],['ASSISTANT2','ASSISTANT']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2030-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL DRAFT TEST LIMITED','Limited company','Fictional verified incorporation',12,31,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional accounting','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const r of ['MANAGER','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[r].staff_id},${F},${actors[r].category_code})`;
 await mapAllAccounts(tx,as,C);await readyForLedger(tx,C);
 const setup=await as('MANAGER',a=>ledgerAction(tx,a,{action:'ledger_period_create',project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31'},{})),base={project_id:P,period_id:setup.period_id};
 const storage={download:async()=>({data:new Blob([''])})};
 const draft=(role,p)=>as(role,a=>formDraftAction(tx,a,p));
 const queue=role=>as(role,a=>workQueueAction(tx,a,{action:'work_queue'},storage));
 const subject=rules.ledgerSubject(P,base.period_id,'','Adjustment');
 const MARK='FICTIONAL-MARKER-narration-never-in-audit';
 const journalForm={fields:{reference:'DRAFT-J1',journal_date:'2026-01-31',description:MARK,evidence:'Fictional supporting schedule'},lines:[{account_code:'10000',debit:'500',credit:'0'},{account_code:'30000',debit:'0',credit:'500'}],kind:'Adjustment'};
 const save=(role,extra={})=>draft(role,{action:'form_draft_save',form_kind:'ledger_journal',subject_key:subject,title:'Adjustment journal DRAFT-J1',project_id:P,payload:journalForm,...extra});
 const rows=()=>tx`select * from erp_private.staff_form_drafts order by created_at`;

 await t.test('Draft Recovery: an Assistant saves a half-filled manual journal, signs out, signs back in, finds it in the work queue and resumes it',async()=>{
  const first=await save('ASSISTANT');assert.ok(first.draft_id);assert.ok(first.saved_at);
  const journalsBefore=(await tx`select count(*)::int as n from erp_private.ledger_journals`)[0].n;
  await newSession('ASSISTANT'); // signed out, then a fresh sign-in
  const q=await queue('ASSISTANT');
  const item=q.items.find(x=>x.kind==='draft');
  assert.ok(item,'the saved draft is in the work queue');assert.equal(item.group,'To do');assert.match(item.title,/Unfinished Journal entry · Adjustment journal DRAFT-J1/);assert.equal(item.project_id,P);assert.equal(item.client_id,C);
  assert.equal(q.counts['To do']>=1,true);
  const back=await draft('ASSISTANT',{action:'form_draft_read',draft_id:item.id});
  assert.deepEqual(back.draft.payload,journalForm,'every field and line comes back as typed');
  assert.equal(back.draft.form_kind,'ledger_journal');assert.equal(back.draft.project_id,P);
  assert.equal((await tx`select count(*)::int as n from erp_private.ledger_journals`)[0].n,journalsBefore,'a draft is not a journal: nothing was created in the ledger');
  assert.equal((await tx`select count(*)::int as n from erp_private.ledger_journals where status<>'Draft'`)[0].n,0);
 });
 await t.test('saving again updates the same draft; the person submits the real journal and the draft is discarded',async()=>{
  const again=await save('ASSISTANT',{payload:{...journalForm,fields:{...journalForm.fields,reference:'DRAFT-J1b'}}});
  assert.equal((await rows()).length,1,'one draft per form and subject');
  const r=await draft('ASSISTANT',{action:'form_draft_read',form_kind:'ledger_journal',subject_key:subject});assert.equal(r.draft.payload.fields.reference,'DRAFT-J1b');
  assert.equal(r.draft.draft_id,again.draft_id);
  const saved=await as('ASSISTANT',a=>ledgerAction(tx,a,{...base,action:'ledger_journal_save',kind:'Adjustment',reference:'DRAFT-J1b',journal_date:'2026-01-31',evidence:'Fictional supporting schedule',lines:journalForm.lines.map(l=>({...l,source_status:'Confirmed',source_reference:'Fictional source'}))},storage));
  assert.ok(saved.journal_id);
  const gone=await draft('ASSISTANT',{action:'form_draft_discard',form_kind:'ledger_journal',subject_key:subject,reason:'submitted'});assert.equal(gone.discarded,true);
  assert.equal((await rows()).length,0);assert.equal((await draft('ASSISTANT',{action:'form_draft_read',form_kind:'ledger_journal',subject_key:subject})).draft,null);
  assert.equal((await draft('ASSISTANT',{action:'form_draft_discard',form_kind:'ledger_journal',subject_key:subject})).discarded,false,'discarding nothing is harmless');
  assert.equal((await queue('ASSISTANT')).items.some(x=>x.kind==='draft'),false);
 });
 await t.test('a draft is private to its owner, even from a Manager or Partner',async()=>{
  await save('ASSISTANT');
  for(const role of ['MANAGER','PARTNER','SUPERVISOR','ASSISTANT2']){
   assert.deepEqual((await draft(role,{action:'form_draft_list'})).drafts,[],role+' sees none of it in the list');
   assert.equal((await draft(role,{action:'form_draft_read',form_kind:'ledger_journal',subject_key:subject})).draft,null,role+' cannot read it');
   assert.equal((await draft(role,{action:'form_draft_discard',form_kind:'ledger_journal',subject_key:subject})).discarded,false,role+' cannot discard it');
   assert.equal((await as(role,()=>tx`select count(*)::int as n from erp_private.staff_form_drafts`))[0].n,0,role+' sees no row even by direct query');
   assert.equal((await queue(role)).items.some(x=>x.kind==='draft'),false,role+' has no draft item');
  }
  await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.staff_form_drafts set title='taken' where true returning draft_id`).then(r=>{if(!r.length)throw Error('no row');}),/no row/);
  assert.equal((await rows()).length,1,'still there');
  assert.equal((await draft('ASSISTANT',{action:'form_draft_list'})).drafts.length,1);
 });
 await t.test('only forms that can be drafted, no secrets, no oversize, a person still within scope',async()=>{
  await assert.rejects(()=>save('ASSISTANT',{form_kind:'staff_save'}),/cannot be saved as a draft/);
  await assert.rejects(()=>save('ASSISTANT',{subject_key:'bad key!'}),/valid subject key/);
  await assert.rejects(()=>save('ASSISTANT',{payload:{fields:{password:'Fictional-Not-Real-1'}}}),/password or secret/);
  await assert.rejects(()=>save('ASSISTANT',{payload:{fields:{reset_token:'x'}}}),/password or secret/);
  await assert.rejects(()=>save('ASSISTANT',{payload:{note:'x'.repeat(70000)}}),/too large|too long/);
  await assert.rejects(()=>save('ASSISTANT',{payload:'text'}),/object of field values/);
  await assert.rejects(()=>save('ASSISTANT2'),/not available to you/,'a person not assigned to the engagement cannot attach a draft to it');
  const own=await save('ASSISTANT2',{project_id:undefined,client_id:undefined,subject_key:'ledger:none:none:new-adjustment'});assert.ok(own.draft_id,'a draft with no client or project is fine');
  await assert.rejects(()=>draft('ASSISTANT',{action:'form_draft_save',form_kind:'client_edit',subject_key:'client:new',title:'',project_id:'not-a-uuid',payload:{}}),/Invalid record reference/);
  actors.ADMIN={...actors.ASSISTANT,category_code:'ADMIN'};await assert.rejects(()=>draft('ADMIN',{action:'form_draft_list'}),/for staff who prepare work/);
 });
 await t.test('the audit log records created, saved, resumed and discarded, and never the contents',async()=>{
  const ev=await tx`select action,after_values::text as v from erp_private.audit_events where table_name='staff_form_drafts' order by event_id`;
  const kinds=new Set(ev.map(x=>x.action));
  for(const k of ['FORM_DRAFT_CREATED','FORM_DRAFT_RESUMED','FORM_DRAFT_DISCARDED'])assert.ok(kinds.has(k),k+' is recorded');
  assert.equal(ev.some(x=>x.v.includes(MARK)||x.v.includes('Fictional supporting schedule')),false,'nothing typed into the form reaches the audit log');
  await save('ASSISTANT',{explicit:true,payload:{...journalForm,fields:{...journalForm.fields,description:MARK+'-2'}}});
  const after=await tx`select action,after_values::text as v from erp_private.audit_events where table_name='staff_form_drafts' and action='FORM_DRAFT_SAVED'`;
  assert.equal(after.length>=1,true,'an explicit "save and return" is recorded');assert.equal(after.some(x=>x.v.includes(MARK)),false);
  assert.equal((await tx`select count(*)::int as n from erp_private.audit_events where table_name='staff_form_drafts' and action in ('INSERT','UPDATE')`)[0].n,0,'there is no change trigger that would copy the contents');
 });
 await t.test('the database itself refuses secrets, a changed owner and a mismatched client',async()=>{
  const mine=(await rows())[0];
  await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.staff_form_drafts set payload=${tx.json({fields:{api_key:'x'}})}::jsonb where draft_id=${mine.draft_id}`),/secrets/);
  await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.staff_form_drafts set staff_id=${actors.MANAGER.staff_id} where draft_id=${mine.draft_id}`),/keeps its owner|row-level security/);
  await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.staff_form_drafts(staff_id,form_kind,subject_key,title,client_id,project_id,payload) values(${actors.ASSISTANT.staff_id},'ledger_journal','ledger:x:y:z','t',${id()},${P},'{}')`),/foreign key|same client/);
  await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.staff_form_drafts(staff_id,form_kind,subject_key,title,payload) values(${actors.MANAGER.staff_id},'ledger_journal','ledger:other','t','{}')`),/row-level security/,'a person cannot write a draft for someone else');
 });
 await t.test('a person may keep only 50 drafts',async()=>{
  for(let i=0;i<60;i++){const n=(await tx`select count(*)::int as n from erp_private.staff_form_drafts where staff_id=${actors.SUPERVISOR.staff_id}`)[0].n;
   if(n>=50){await assert.rejects(()=>draft('SUPERVISOR',{action:'form_draft_save',form_kind:'client_edit',subject_key:'client:c'+i,title:'x',payload:{}}),/already have 50/);break;}
   await draft('SUPERVISOR',{action:'form_draft_save',form_kind:'client_edit',subject_key:'client:c'+i,title:'x',payload:{}});}
  assert.equal((await tx`select count(*)::int as n from erp_private.staff_form_drafts where staff_id=${actors.SUPERVISOR.staff_id}`)[0].n,50);
 });
});
