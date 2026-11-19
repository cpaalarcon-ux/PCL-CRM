import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const {payrollReviewAction}=await import('../supabase/functions/staff-workspace-v12/payroll-review-actions.ts');
const {routingMapAction}=await import('../supabase/functions/staff-workspace-v12/routing-map-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p})),rev=(role,p)=>as(role,a=>payrollReviewAction(tx,a,{project_id:P,...p})),rm=(role,p)=>as(role,a=>routingMapAction(tx,a,{client_id:C,...p}));
const {deleteRedoAction}=await import('../supabase/functions/staff-workspace-v12/delete-redo-actions.ts');
const {salesAmendAction}=await import('../supabase/functions/staff-workspace-v12/sales-amend-actions.ts');
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const redo=(role,p)=>as(role,a=>deleteRedoAction(tx,a,{project_id:P,...p})),amend=(role,p)=>as(role,a=>salesAmendAction(tx,a,{project_id:P,...p}));

const {workbookAction}=await import('../supabase/functions/staff-workspace-v12/workbook-actions.ts');
const {findRetriedUpload,bankRemovalFacts}=await import('../supabase/functions/staff-workspace-v12/upload-safety.ts');
const {retriedUpload,bankRemoval,bankRemovalMessage,RETRY_WINDOW_MINUTES}=await import('../supabase/functions/staff-workspace-v12/upload-safety-rules.mjs');
const {isConnectionDrop,connectionDropMessage,alreadyImportedNote,bankRemovalHtml,isRetrySafeAction}=await import('../staff-upload-retry.mjs');
test('interrupted uploads: a replayed or half-finished request never duplicates transactions, and a used bank statement cannot be removed',async t=>{
 t.after(()=>db.close());

 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional statement capture')`;
 const sources=new Map(),storage={download:async key=>({data:new Blob([sources.get(key)])})};
 let n=0;
 async function doc(name,csv,role='ASSISTANT'){const d=id(),key='fictional/'+d;sources.set(key,csv);n++;await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${C},${F},${P},${T},'Working Papers',${name},${key},100,${String(n).padStart(64,'a')},'text/csv',${actors[role].staff_id})`;return d;}
 const wb=(role,p)=>as(role,a=>workbookAction(tx,a,p,storage));
 const bank=d=>({document_id:d,header_row:0,first_row:1,last_row:2,dataset:'Bank',period_start:'2026-09-01',period_end:'2026-09-30',column_map:{date:1,reference:2,debit:3,credit:4,balance:5},confirmed_client_id:C,action:'workbook_commit',statement_opening:2000,statement_closing:2700});
 const count=async tbl=>(await tx`select count(*)::int n from ${tx.raw?tx.raw(tbl):tbl}`)[0]?.n;
 const rows=async()=>(await tx`select count(*)::int n from erp_private.workbook_rows`)[0].n,batches=async()=>(await tx`select count(*)::int n from erp_private.workbook_batches`)[0].n,requests=async()=>(await tx`select count(*)::int n from erp_private.workbook_import_requests`)[0].n;
 const csv='2026-09-01,DEP-1,0,1000,3000\n2026-09-02,CHQ-2,300,0,2700\n';

 // 1. The reply to a bank statement import is lost; the preparer presses Retry with the identical request.
 const d1=await doc('Statement.csv',csv);
 const first=await wb('ASSISTANT',bank(d1));assert.equal(first.new_count,2);assert.equal(await rows(),2);assert.equal(await batches(),1);
 const retry=await wb('ASSISTANT',bank(d1));
 assert.equal(retry.duplicate_upload,true);assert.equal(retry.batch_id,first.batch_id);assert.equal(retry.new_count,0);assert.equal(retry.duplicate_count,2);
 assert.equal(await rows(),2,'no second copy of any transaction');assert.equal(await batches(),1);assert.equal(await requests(),1);
 assert.match(alreadyImportedNote(retry,'workbook_commit'),/already imported earlier\. Nothing was added again/);assert.equal(alreadyImportedNote(first,'workbook_commit'),'');

 // 2. The file itself was sent twice (the first upload reply was lost), so a second document holds the same lines. Rows are matched by their own key, never added twice.
 const d2=await doc('Statement-again.csv',csv);
 const again=await wb('ASSISTANT',bank(d2));assert.equal(again.new_count,0);assert.equal(again.duplicate_count,2);assert.equal(await rows(),2);

 // 3. The request is refused part-way (statement does not balance): nothing is left behind, and the corrected retry then completes once.
 const csv2='2026-09-03,DEP-3,0,500,3200\n2026-09-04,CHQ-4,100,0,3100\n';
 const d3=await doc('Statement-2.csv',csv2),before=[await rows(),await batches(),await requests()];
 await assert.rejects(()=>wb('ASSISTANT',{...bank(d3),statement_opening:2700,statement_closing:9999}),/does not balance/);
 assert.deepEqual([await rows(),await batches(),await requests()],before,'a refused import writes nothing');
 const fixed=await wb('ASSISTANT',{...bank(d3),statement_opening:2700,statement_closing:3100,period_start:'2026-09-03'});assert.equal(fixed.new_count,2);assert.equal(await rows(),4);

 // 4. The database fails after the rows were written (the last step of the import): the whole request rolls back, then Retry completes with no duplicates.
 await db.exec(`create function erp_private.qa_fail_request() returns trigger language plpgsql as $$ begin raise exception 'Fictional failure at the last step'; end $$;create trigger qa_fail before insert on erp_private.workbook_import_requests for each row execute function erp_private.qa_fail_request()`);
 const csv3='2026-09-05,DEP-5,0,50,3150\n2026-09-06,CHQ-6,50,0,3100\n';
 const d4=await doc('Statement-3.csv',csv3),before4=[await rows(),await batches(),await requests()];
 await assert.rejects(()=>wb('ASSISTANT',{...bank(d4),statement_opening:3100,statement_closing:3100,period_start:'2026-09-05'}),/Fictional failure/);
 assert.deepEqual([await rows(),await batches(),await requests()],before4,'a failure at the last step leaves nothing half-written');
 await db.exec('drop trigger qa_fail on erp_private.workbook_import_requests');
 const done=await wb('ASSISTANT',{...bank(d4),statement_opening:3100,statement_closing:3100,period_start:'2026-09-05'});assert.equal(done.new_count,2);assert.equal(await rows(),6);
 const done2=await wb('ASSISTANT',{...bank(d4),statement_opening:3100,statement_closing:3100,period_start:'2026-09-05'});assert.equal(done2.duplicate_upload,true);assert.equal(await rows(),6);

 // 5. The same file sent to the same place by the same person within minutes is one upload. Other people, other places and old uploads are separate.
 const sha='b'.repeat(64),args={client_id:C,project_id:P,task_id:T,category:'Working Papers',sha256:sha};
 const placed=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${placed},${C},${F},${P},${T},'Working Papers','Sent.csv',${'fictional/'+placed},100,${sha},'text/csv',${actors.ASSISTANT.staff_id})`;
 assert.equal((await as('ASSISTANT',a=>findRetriedUpload(tx,a,args))).document_id,placed);
 assert.equal(await as('MANAGER',a=>findRetriedUpload(tx,a,args)),null,'another person is not a retry');
 assert.equal(await as('ASSISTANT',a=>findRetriedUpload(tx,a,{...args,task_id:null})),null,'another place is not a retry');
 assert.equal(await as('ASSISTANT',a=>findRetriedUpload(tx,a,{...args,category:'Tax Returns'})),null);
 await db.exec('set session_replication_role=replica');await tx`update erp_private.documents set uploaded_at=now()-interval '20 minutes' where document_id=${placed}`;await db.exec('set session_replication_role=origin');
 assert.equal(await as('ASSISTANT',a=>findRetriedUpload(tx,a,args)),null,'an old upload is not a retry');

 // 6. Removing a bank statement: exact wording first, refused once anything from it is used.
 const plan=await as('ASSISTANT',a=>deleteRedoAction(tx,a,{project_id:P,action:'delete_redo_plan',document_id:d1}));
 assert.equal(plan.bank.allowed,true);assert.equal(plan.bank.summary.rows,2);assert.equal(plan.bank.summary.file_name,'Statement.csv');assert.equal(plan.bank.summary.period_start.toString().slice(0,10),'2026-09-01'.slice(0,10));
 assert.match(bankRemovalHtml(plan.bank,x=>String(x)),/Statement\.csv.*2<\/b> lines/);assert.equal(plan.plan.can_apply,true);
 const target=(await tx`select r.row_id from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where b.document_id=${d1} limit 1`)[0].row_id;
 await db.exec('set session_replication_role=replica');await tx`update erp_private.workbook_rows set route=2,account_code='60010' where row_id=${target}`;await db.exec('set session_replication_role=origin');
 const used=await as('PARTNER',a=>deleteRedoAction(tx,a,{project_id:P,action:'delete_redo_plan',document_id:d1}));
 assert.equal(used.bank.allowed,false);assert.equal(used.plan.can_apply,false);assert.match(used.bank.reasons.join(' '),/mapped, reviewed or posted/);assert.match(bankRemovalMessage(used.bank),/cannot be removed.*Reverse or correct/);
 assert.match(bankRemovalHtml(used.bank,x=>String(x)),/It cannot be removed/);
 const facts=await as('ASSISTANT',a=>bankRemovalFacts(tx,d1,'Statement.csv'));assert.equal(facts.matched_rows,1);const unused=await doc('Never-imported.csv',csv);assert.equal(await as('ASSISTANT',()=>bankRemovalFacts(tx,unused,'x')),null,'a document with no bank statement has no bank facts');assert.equal((await as('ASSISTANT',()=>bankRemovalFacts(tx,d2,'x'))).statements[0].rows,0,'a repeat upload holds no lines of its own');
 const untouched=await as('ASSISTANT',a=>deleteRedoAction(tx,a,{project_id:P,action:'delete_redo_plan',document_id:d3}));assert.equal(untouched.bank.allowed,true,'a statement nothing was done with can still be removed');
});

test('upload safety rules and wording',()=>{
 const base={sha256:'c',uploaded_by:'s1',client_id:'c1',project_id:'p1',task_id:null,category:'Import Sources'},now=Date.parse('2026-11-19T12:00:00Z'),at=m=>new Date(now-m*60000).toISOString();
 const cand=(x={})=>({document_id:'d1',...base,uploaded_at:at(2),...x}),q={staff_id:'s1',sha256:'c',client_id:'c1',project_id:'p1',task_id:null,category:'Import Sources',now};
 assert.equal(retriedUpload([cand()],q).document_id,'d1');assert.equal(RETRY_WINDOW_MINUTES,15);
 for(const x of [{sha256:'z'},{uploaded_by:'s2'},{client_id:'c2'},{project_id:'p2'},{task_id:'t1'},{category:'Tax Returns'},{archived_at:'2026-11-19'},{deleted_at:'2026-11-19'},{uploaded_at:at(16)},{uploaded_at:at(-5)}])assert.equal(retriedUpload([cand(x)],q),null,JSON.stringify(x));
 assert.equal(bankRemoval({file_name:'S.csv',statements:[{period_start:'2026-09-01',period_end:'2026-09-30',rows:3}]}).allowed,true);
 const used=bankRemoval({file_name:'S.csv',statements:[{period_start:'2026-09-01',period_end:'2026-09-30',rows:3}],matched_rows:2,receipt_allocations:1,closed_periods:1,journals:1});
 assert.equal(used.allowed,false);assert.equal(used.reasons.length,4);assert.equal(used.summary.rows,3);assert.match(used.reasons[0],/2 lines have been mapped, reviewed or posted/);assert.match(used.reasons[1],/1 line is matched to customer receipts/);
 assert.equal(isConnectionDrop(new TypeError('Failed to fetch')),true);assert.equal(isConnectionDrop(Object.assign(Error('nope'),{status:400})),false);assert.equal(isConnectionDrop(Error('Choose a bank')),false);
 assert.match(connectionDropMessage('workbook_commit'),/press the same button again.*will not add the same rows twice/);assert.doesNotMatch(connectionDropMessage('project_save'),/same rows/);assert.equal(isRetrySafeAction('workbook_commit'),true);assert.equal(isRetrySafeAction('journal_post'),false);
 assert.match(alreadyImportedNote({already_uploaded:true}),/no second copy was stored/);assert.equal(alreadyImportedNote({reused:true},'ledger_period_import_create'),'');assert.match(alreadyImportedNote({reused:true},'period_import_save'),/already imported/);
});

test('wiring: retry, removal guard and screens',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),index=rd('supabase/functions/staff-workspace-v12/index.ts'),pilot=rd('staff-pilot.mjs');
 assert.match(index,/findRetriedUpload\(tx,a,\{client_id:cid,project_id:pid,task_id:tid,category:cat,sha256:digest\}\)/);
 assert.ok(index.indexOf('findRetriedUpload(tx,a')<index.indexOf("insert into erp_private.documents(document_id"),'the retry check runs before a second copy is stored');
 assert.match(index,/bankRemovalFacts\(tx,documentId,doc\.file_name\)[\s\S]{0,200}fail\(409,bankRemovalMessage\(verdict\)\)/);
 assert.ok(index.indexOf('bankRemovalMessage(verdict)')<index.indexOf("update erp_private.documents set archived_at=now()"),'the bank guard runs before anything is archived');
 assert.match(pilot,/staff-upload-retry\.mjs\?v=20261119-upload-v1/);assert.match(pilot,/isConnectionDrop\(cause\)\)throw Object\.assign\(Error\(connectionDropMessage\(action\)\)/);
 assert.match(pilot,/alreadyImportedNote\(result,action\)/);assert.match(pilot,/action:'delete_redo_plan',project_id:d\.project_id,document_id:d\.document_id/);assert.match(pilot,/This bank statement cannot be removed/);
});
