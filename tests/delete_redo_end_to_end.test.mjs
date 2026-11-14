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
test('delete and redo: plan and apply by stage and role; confirmed payroll is amended, not deleted; history is kept',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const emp=(name,n,gross,x={})=>({name,employee_id:'E'+n,pin:'A00000000'+n+'Z',gross,source_row:Number(n)+1,...x});
 const calc=(gross,paye,nssf,shif,ahl)=>({gross,paye,employee_nssf:nssf,shif,employee_ahl:ahl,other_deductions:0,employer_nssf:nssf,employer_ahl:ahl,nita:50,net_pay:Math.round((gross-paye-nssf-shif-ahl)*100)/100});
 const month=(start,end,rows,calcRows,status='Submitted',extra={})=>({import_id:id(),start,end,rows,calcRows,status,...extra});
 async function addImport(m){await db.exec('set session_replication_role=replica');try{await tx`insert into erp_private.period_imports(import_id,project_id,client_id,document_id,kind,source_type,coverage_mode,starts_on,ends_on,payload,source_hash,status,prepared_by) values(${m.import_id},${P},${C},${D},'Payroll','PAYROLL','PAYROLL_MONTHLY',${m.start},${m.end},${tx.json({employees:m.rows,calculated:m.calcRows,issues:m.issues||[],differences:m.differences||[]})},${'h'+m.import_id},${m.status},${actors.ASSISTANT.staff_id})`;}finally{await db.exec('set session_replication_role=origin');}}
 const st=async x=>(await tx`select status,discard_reason,review_note from erp_private.period_imports where import_id=${x}`)[0];
 const rows=[emp('Wanjiru','1',100000)],cal=[calc(100000,20000,2160,2000,1500)];
 const mk=async(start,end,status)=>{const m=month(start,end,rows,cal,status);await addImport(m);return m.import_id;};
 const revOf=async x=>String((await tx`select revision from erp_private.period_imports where import_id=${x}`)[0].revision);

 // 1. A draft: its preparer, or a Manager, can delete and redo; an intern and a stranger to the work cannot, and a reason is required.
 const d1=await mk('2026-03-01','2026-03-31','Draft');
 const p1=await redo('ASSISTANT',{action:'delete_redo_plan',import_id:d1});assert.equal(p1.plan.apply,'discard');assert.equal(p1.plan.can_apply,true);assert.match(p1.plan.redo,/payroll register/);
 await assert.rejects(()=>redo('INTERN',{action:'delete_redo_plan',import_id:d1}),/Assigned accounting staff/);
 await assert.rejects(()=>redo('ASSISTANT',{action:'delete_redo_apply',import_id:d1,revision:p1.revision,reason:'no'}),/at least 5/);
 await assert.rejects(()=>redo('ASSISTANT',{action:'delete_redo_apply',import_id:d1,revision:'999',reason:'Wrong month prepared'}),/changed/);
 const a1=await redo('ASSISTANT',{action:'delete_redo_apply',import_id:d1,revision:p1.revision,reason:'Wrong month prepared'});
 assert.deepEqual(a1.steps,['Discarded']);assert.equal((await st(d1)).status,'Discarded');assert.equal((await st(d1)).discard_reason,'Wrong month prepared');
 const again=await redo('ASSISTANT',{action:'delete_redo_plan',import_id:d1});assert.equal(again.plan.can_apply,false);assert.equal(again.history.reason,'Wrong month prepared');
 assert.equal((await tx`select count(*)::int n from erp_private.period_imports where import_id=${d1}`)[0].n,1,'the record stays');
 // With the draft discarded the month can be prepared again from the register.
 await reg('ASSISTANT',{action:'payroll_register_add',person:{name:'Wanjiru',kra_pin:'A000000001Z',national_id:'E1',relationship:'Employee',employment_type:'Permanent',started_on:'2026-01-01'},pay:{gross:100000,effective_from:'2026-01-01',reason:'Contract signed January 2026'}});
 const dr=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-03'});assert.equal(dr.existing_run,null);

 // 2. Submitted, by its preparer: withdraw then discard in one step. A different Assistant cannot.
 const s2=await mk('2026-04-01','2026-04-30','Submitted');
 const p2=await redo('ASSISTANT',{action:'delete_redo_plan',import_id:s2});assert.equal(p2.plan.apply,'withdraw_discard');
 const stranger=await redo('MANAGER',{action:'delete_redo_plan',import_id:s2});assert.equal(stranger.plan.apply,'return_discard');
 const a2=await redo('ASSISTANT',{action:'delete_redo_apply',import_id:s2,revision:p2.revision,reason:'Totals were typed wrongly'});assert.deepEqual(a2.steps,['Withdrawn from review','Discarded']);assert.equal((await st(s2)).status,'Discarded');

 // 3. Submitted: a Supervisor can only return it; the Manager then deletes it.
 const s3=await mk('2026-05-01','2026-05-31','Submitted');
 const p3=await redo('SUPERVISOR',{action:'delete_redo_plan',import_id:s3});assert.equal(p3.plan.apply,'return');
 const a3=await redo('SUPERVISOR',{action:'delete_redo_apply',import_id:s3,revision:p3.revision,reason:'Wrong month in the file'});assert.deepEqual(a3.steps,['Returned to the preparer']);assert.equal(a3.status,'Returned');
 const row3=await st(s3);assert.equal(row3.status,'Returned');assert.match(row3.review_note,/Returned for removal: Wrong month in the file/);
 const p3b=await redo('MANAGER',{action:'delete_redo_plan',import_id:s3});assert.equal(p3b.plan.apply,'discard');
 await redo('MANAGER',{action:'delete_redo_apply',import_id:s3,revision:p3b.revision,reason:'Wrong month in the file'});assert.equal((await st(s3)).status,'Discarded');

 // 4. Submitted: a Manager who did not prepare it returns and deletes it in one step.
 const s4=await mk('2026-06-01','2026-06-30','Submitted');
 const p4=await redo('PARTNER',{action:'delete_redo_plan',import_id:s4});assert.equal(p4.plan.apply,'return_discard');
 const a4=await redo('PARTNER',{action:'delete_redo_apply',import_id:s4,revision:p4.revision,reason:'Prepared for the wrong client'});assert.deepEqual(a4.steps,['Returned to the preparer','Discarded']);assert.equal((await st(s4)).status,'Discarded');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='DELETE_AND_REDO_APPLIED'`)[0].n,5);

 // 5. Confirmed payroll is never deleted: the plan routes to an amendment and apply refuses.
 const c5=await mk('2026-07-01','2026-07-31','Confirmed');
 const p5=await redo('MANAGER',{action:'delete_redo_plan',import_id:c5});assert.equal(p5.plan.route,'amendment');assert.equal(p5.plan.can_apply,false);
 await assert.rejects(()=>redo('MANAGER',{action:'delete_redo_apply',import_id:c5,revision:p5.revision,reason:'Typed wrongly in July'}),/Confirmed work is not deleted/);

 // 6. Payroll amendment: ask, a different leader approves, nothing posted so it is ready at once; the register can then draft the month again.
 const rd0=await amend('ASSISTANT',{action:'sales_amend_read',import_id:c5});assert.equal(rd0.can_request,true);assert.equal(rd0.kind,'Payroll');
 const rq=await amend('ASSISTANT',{action:'sales_amend_request',import_id:c5,outcome:'Replace',reason_type:'Wrong amounts',reason:'A salary change was left out of the July run'});
 assert.equal(rq.amendment.kind,'Payroll');assert.equal(rq.amendment.original_totals.employees,1);assert.equal(rq.amendment.original_totals.gross,100000);assert.equal(rq.summary.totals.net,cal[0].net_pay);
 const pl=await redo('MANAGER',{action:'delete_redo_plan',import_id:c5});assert.match(pl.plan.steps[0],/already open/);
 await assert.rejects(()=>amend('ASSISTANT',{action:'sales_amend_decide',amendment_id:rq.amendment.amendment_id,revision:rq.amendment.revision,decision:'Approved',note:'I approve my own request'}),/Manager or Partner/);
 const dec=await amend('MANAGER',{action:'sales_amend_decide',amendment_id:rq.amendment.amendment_id,revision:rq.amendment.revision,decision:'Approved',note:'Agreed, the pay change is documented'});assert.equal(dec.amendment.status,'Approved');
 const prep=await amend('PARTNER',{action:'sales_amend_prepare',amendment_id:rq.amendment.amendment_id,revision:dec.amendment.revision});assert.equal(prep.amendment.status,'Ready');assert.match(prep.next,/payroll register/);
 const redone=await reg('ASSISTANT',{action:'payroll_register_draft',month:'2026-07'});assert.equal(redone.existing_run,null);assert.equal(redone.replacing_run.status,'Confirmed');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action like 'PAYROLL_AMENDMENT_%'`)[0].n>=3,true);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action like 'SALES_AMENDMENT_%'`)[0].n,0);
 // A second payroll amendment with the Withdraw outcome completes and sets the run aside.
 const c6=await mk('2026-08-01','2026-08-31','Confirmed');
 const rq2=await amend('ASSISTANT',{action:'sales_amend_request',import_id:c6,outcome:'Withdraw',reason_type:'Wrong month',reason:'This is the September run entered as August'});
 const dc=await amend('MANAGER',{action:'sales_amend_decide',amendment_id:rq2.amendment.amendment_id,revision:rq2.amendment.revision,decision:'Approved',note:'Agreed, wrong month confirmed'});
 const pr2=await amend('PARTNER',{action:'sales_amend_prepare',amendment_id:rq2.amendment.amendment_id,revision:dc.amendment.revision});
 await amend('PARTNER',{action:'sales_amend_complete',amendment_id:rq2.amendment.amendment_id,revision:pr2.amendment.revision});assert.equal((await st(c6)).status,'Superseded');

 // 7. An upload: the plan names what protects it. Nothing is mapped, so its uploader and a Manager may remove it.
 const up=await redo('ASSISTANT',{action:'delete_redo_plan',document_id:D});assert.equal(up.target,'upload');assert.equal(typeof up.plan.can_apply,'boolean');
});
