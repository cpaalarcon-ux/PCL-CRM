// Step 7 (joined-practice review): the KRA notice log, the verification task and the non-compliance flags.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Step 7: KRA notice log, verification task and flags',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const A=await mk('UAT Fictional Services Ltd','A400000001Z'),B=await mk('UAT Fictional Traders Ltd','A400000002Z'),E=await mk('UAT Fictional Hauliers Ltd','A400000003Z');
 const T0=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d;
 const D=n=>{const x=new Date(T0+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 let seq=0;
 const log=(role,client,o={})=>{const v={ref:'KRA/AUD/'+(++seq)+'/2026',type:'Audit notice',head:'VAT',ps:'2025-01-01',pe:'2025-12-31',nd:D(0),rc:D(0),dl:D(30),sum:'Fictional audit notice for the year 2025.',proj:null,doc:null,...o};
  return q(role,`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,notice_document_id,project_id,logged_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning case_id`,[client,F,v.ref,v.type,v.head,v.ps,v.pe,v.nd,v.rc,v.dl,v.sum,v.doc,v.proj,actors[role].staff_id]).then(r=>r[0].case_id);};
 const row=async c=>j((await tx`select * from erp_private.kra_cases where case_id=${c}`)[0]);
 const flags=async(c,status)=>j(await tx`select flag_code,severity,status,resolved_how,resolved_by from erp_private.kra_compliance_flags where case_id=${c} and (${status}::text is null or status=${status}) order by flag_code,created_at`);
 const open=async c=>(await flags(c,'Open')).map(f=>f.flag_code).join('');
 const doc=async(client=A,category='Permanent File')=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${client},${F},${category},${'KRA '+category+'.pdf'},${'k/'+d},10,${'a'.repeat(64)},'application/pdf',${M})`;return d;};

 // ---- 1. Settings are defaults until a Partner confirms them -----------------------------------------------------------------------------------
 const st=j(await tx`select setting_key,int_value,text_value,rule_status from erp_private.kra_check_settings order by setting_key`);
 assert.equal(st.length,11);assert.ok(st.every(s=>s.rule_status==='Suggested'),'nothing is confirmed at the start');
 const sv=k=>st.find(s=>s.setting_key===k);
 assert.deepEqual([sv('task_lead_days').int_value,sv('urgent_below_days').int_value,sv('urgent_task_lead_days').int_value,sv('flag_b_days').int_value,sv('flag_c_days').int_value,sv('flag_d_days').int_value],[7,7,2,3,2,14]);
 assert.deepEqual(['a','b','c','d'].map(k=>sv('severity_'+k).text_value),['HIGH','CRITICAL','CRITICAL','MEDIUM']);
 assert.equal(sv('flag_d_basis').text_value,'response');
 await q('MANAGER',`update erp_private.kra_check_settings set int_value=5 where setting_key='flag_b_days'`);
 assert.equal((await tx`select int_value from erp_private.kra_check_settings where setting_key='flag_b_days'`)[0].int_value,3,'a Manager cannot change a setting');
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set int_value=0 where setting_key='flag_b_days'`),/1 to 90/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set text_value='sometimes' where setting_key='flag_d_basis'`),/response or the deadline/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set text_value='LOW' where setting_key='severity_a'`),/HIGH, CRITICAL or MEDIUM/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set int_value=5,text_value='x' where setting_key='flag_b_days'`),/check constraint|holds/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set rule_status='Confirmed',confirmed_by=$1,source_note='short' where setting_key='flag_b_days'`,[PT]),/at least 10|check constraint/);
 await q('PARTNER',`update erp_private.kra_check_settings set rule_status='Confirmed',confirmed_by=$1,source_note='Tax Lead email of 9 Nov 2026' where setting_key='flag_b_days'`,[PT]);
 assert.equal((await tx`select rule_status from erp_private.kra_check_settings where setting_key='flag_b_days'`)[0].rule_status,'Confirmed');
 await q('PARTNER',`update erp_private.kra_check_settings set int_value=4 where setting_key='flag_b_days'`);
 assert.deepEqual(j((await tx`select rule_status,confirmed_by,source_note from erp_private.kra_check_settings where setting_key='flag_b_days'`)[0]),{rule_status:'Suggested',confirmed_by:null,source_note:null},'changing a value withdraws its confirmation');
 await q('PARTNER',`update erp_private.kra_check_settings set int_value=3 where setting_key='flag_b_days'`);
 await assert.rejects(q('PARTNER',`update erp_private.kra_check_settings set label='Another label' where setting_key='flag_b_days'`),/cannot be renamed/);

 // ---- 2. The task date rule ------------------------------------------------------------------------------------------------------------------------
 const plan=async(rc,dl,today)=>j((await q('ASSISTANT',`select * from erp_private.kra_task_plan($1,$2,$3)`,[rc,dl,today]))[0]);
 assert.deepEqual(await plan('2026-11-01','2026-11-20','2026-11-01'),{due_on:'2026-11-13',urgent:false,days_given:19},'7 days before the deadline');
 assert.deepEqual(await plan('2026-11-09','2026-11-14','2026-11-09'),{due_on:'2026-11-12',urgent:true,days_given:5},'fewer than 7 days: 2 days before, urgent');
 assert.deepEqual(await plan('2026-11-09','2026-11-16','2026-11-09'),{due_on:'2026-11-09',urgent:false,days_given:7},'exactly 7 days is not urgent in the written rule');
 assert.deepEqual(await plan('2026-11-09','2026-11-10','2026-11-09'),{due_on:'2026-11-09',urgent:true,days_given:1},'a due date is never in the past');
 assert.deepEqual(await plan('2026-11-01','2026-11-05','2026-11-09'),{due_on:'2026-11-09',urgent:true,days_given:4},'an overdue notice is due today');

 // ---- 3. Logging a notice creates the task for the Manager who owns the client's tax project ----------------------------------------------------
 const master=await proj(A,'TAX-COMP','Active',M,true);
 await tx`insert into erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on,status) values(${master},'Annually','2025-01-01','2025-12-31','Open')`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${master},${AST},${F},'ASSISTANT')`;
 const c1=await log('ASSISTANT',A,{dl:D(30)});
 let r1=await row(c1);
 assert.equal(r1.status,'Open');assert.ok(r1.verification_task_id,'the task exists');
 assert.equal(r1.task_owner_id,M);assert.equal(r1.task_basis,"Manager who owns the client's tax project");assert.equal(r1.task_due_on,D(23));assert.equal(r1.task_urgent,false);
 const tk=j((await tx`select project_id,assigned_to,task_name,status,(due_at at time zone 'Africa/Nairobi')::date::text due from erp_private.tasks where task_id=${r1.verification_task_id}`)[0]);
 assert.deepEqual(tk,{project_id:master,assigned_to:M,task_name:`Verify KRA notice ${r1.notice_reference} and tell the client`,status:'Pending',due:D(23)});
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where task_id=${r1.verification_task_id} and recipient_id=${M}`)[0].n,1,'the owner is told about the new task');
 assert.equal(await open(c1),'','a tax work period covers 2025, so flag A is not raised');
 assert.equal((await tx`select count(*)::int n from erp_private.projects where client_id=${A}`)[0].n,1,'the system never creates the KRA project');

 // Urgent notice: less than 7 days given.
 const c2=await log('MANAGER',A,{dl:D(5),ref:'KRA/URGENT/1'});const r2=await row(c2);
 assert.equal(r2.task_urgent,true);assert.equal(r2.task_due_on,D(3));
 assert.match((await tx`select task_name from erp_private.tasks where task_id=${r2.verification_task_id}`)[0].task_name,/^URGENT: Verify KRA notice KRA\/URGENT\/1/);
 assert.equal(await open(c2),'','5 days left is outside flag B');

 // Rules on logging.
 await assert.rejects(log('INTERN',A),/row-level security|Only a Partner, Manager/);
 await assert.rejects(log('ASSISTANT',A,{ref:r1.notice_reference}),/duplicate key|unique/);
 await assert.rejects(log('ASSISTANT',A,{dl:D(-5),nd:D(0)}),/check constraint/);
 await assert.rejects(log('ASSISTANT',A,{rc:D(2),nd:D(1)}),/future/);
 await assert.rejects(log('ASSISTANT',A,{nd:D(1),rc:D(0)}),/after the date received/);
 await assert.rejects(log('ASSISTANT',A,{pe:'2024-12-31'}),/check constraint/);
 await assert.rejects(log('ASSISTANT',A,{sum:'short'}),/check constraint/);
 await assert.rejects(log('ASSISTANT',A,{proj:master,doc:id()}),/violates foreign key|filed for this client/);
 await assert.rejects(log('ASSISTANT',A,{proj:await proj(B,'TAX-KRA','Draft')}),/project of this client/);
 await assert.rejects(q('ASSISTANT',`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by) values($1,$2,'KRA/FORGE/1','Audit notice','VAT','2025-01-01','2025-12-31',$3,$3,$4,'Fictional audit notice for the year 2025.',$5)`,[A,F,D(0),D(20),M]),/row-level security|signed-in user/);
 await assert.rejects(q('ASSISTANT',`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by,task_urgent) values($1,$2,'KRA/TASK/1','Audit notice','VAT','2025-01-01','2025-12-31',$3,$3,$4,'Fictional audit notice for the year 2025.',$5,true)`,[A,F,D(0),D(20),AST]),/created by the system/);
 const wrongFirm=id();await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${wrongFirm},'OTHR','Another fictional firm')`;
 await assert.rejects(q('ASSISTANT',`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by) values($1,$2,'KRA/FIRM/1','Audit notice','VAT','2025-01-01','2025-12-31',$3,$3,$4,'Fictional audit notice for the year 2025.',$5)`,[A,wrongFirm,D(0),D(20),AST]),/does not handle this client/);
 const nd=await doc(A,'Permanent File');
 const cDoc=await log('ASSISTANT',A,{doc:nd,ref:'KRA/DOC/1'});assert.equal((await row(cDoc)).notice_document_id,nd);
 assert.equal(await open(cDoc),'');
 const kycDoc=await doc(A,'KYC Pending');await assert.rejects(log('ASSISTANT',A,{doc:kycDoc,ref:'KRA/DOC/2'}),/filed for this client/);

 // ---- 4. No project: no task, flag A, partners told; linking a project creates the task and clears the flag ------------------------------------------
 const c3=await log('MANAGER',B,{dl:D(30),ref:'KRA/NOPROJECT/1'});let r3=await row(c3);
 assert.equal(r3.verification_task_id,null,'a task row needs a project');
 assert.equal(await open(c3),'A');assert.equal((await flags(c3,'Open'))[0].severity,'HIGH');
 assert.ok((await tx`select count(*)::int n from erp_private.notifications where event_key like ${'kra-notask:'+c3+':nohost:%'}`)[0].n>=2,'both Partners are told there is no task yet');
 assert.ok((await tx`select count(*)::int n from erp_private.notifications where event_key like 'kra-flag:%' and recipient_id=${PT} and message like '%KRA/NOPROJECT/1%'`)[0].n>=1,'the Partner is told about the flag');
 const kp=await proj(B,'TAX-KRA','Draft',M2);
 await assert.rejects(q('MANAGER',`update erp_private.kra_cases set project_id=$2 where case_id=$1`,[c3,await proj(A,'TAX-KRA','Draft')]),/project of this client/);
 await q('MANAGER',`update erp_private.kra_cases set project_id=$2 where case_id=$1`,[c3,kp]);r3=await row(c3);
 assert.equal(await open(c3),'','linking the project clears flag A');
 const fl=await flags(c3,'Resolved');assert.equal(fl.length,1);assert.deepEqual([fl[0].flag_code,fl[0].resolved_how,fl[0].resolved_by],['A','Action taken',M]);
 assert.ok(r3.verification_task_id,'and creates the task');assert.equal(r3.task_owner_id,M,'no tax project: the client owner');assert.equal(r3.task_basis,'Client owner');
 assert.equal((await tx`select project_id from erp_private.tasks where task_id=${r3.verification_task_id}`)[0].project_id,kp,'the task goes on the linked project');
 assert.equal((await tx`select count(*)::int n from erp_private.tasks where project_id=${kp}`)[0].n,1);

 // ---- 5. Flag B: an open case with the deadline within 3 days; responding clears it -----------------------------------------------------------------
 const c4=await log('MANAGER',A,{dl:D(3),ref:'KRA/B/1'});
 assert.equal(await open(c4),'B');assert.equal((await flags(c4,'Open'))[0].severity,'CRITICAL');
 const c4b=await log('MANAGER',A,{dl:D(4),ref:'KRA/B/2'});assert.equal(await open(c4b),'','4 days is outside flag B');
 const c4c=await log('MANAGER',A,{dl:D(-2),nd:D(-9),rc:D(-9),ref:'KRA/B/3'});assert.equal(await open(c4c),'B','an overdue open case is flagged too');
 assert.match((await flags(c4c,'Open'))[0].severity,/CRITICAL/);
 assert.match((await tx`select detail from erp_private.kra_compliance_flags where case_id=${c4c}`)[0].detail,/passed 2 day/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Responded' where case_id=$1`,[c4]),/Record the date the response/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c4,D(1)]),/between the date received and today/);
 await q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c4,D(0)]);
 let r4=await row(c4);assert.deepEqual([r4.status,r4.responded_on,r4.responded_by],['Responded',D(0),AST]);
 assert.equal(await open(c4),'','responding clears flag B');
 assert.equal((await flags(c4,'Resolved')).length,1);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set summary='Rewritten summary of the notice' where case_id=$1`,[c4]),/cannot be edited/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Open',return_note='Sent in error by mistake' where case_id=$1`,[c4]),/Only a Manager or Partner can return/);
 // The deadline moves: the task moves with it and flag B can clear.
 const c5=await log('MANAGER',A,{dl:D(2),ref:'KRA/B/4'});assert.equal(await open(c5),'B');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c5,D(30)]),/Only a Manager, a Partner or the person who logged/);
 await q('MANAGER',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c5,D(30)]);
 const r5=await row(c5);assert.equal(await open(c5),'','a corrected deadline clears flag B');
 assert.equal(r5.task_due_on,D(23));
 assert.equal((await tx`select (due_at at time zone 'Africa/Nairobi')::date::text d from erp_private.tasks where task_id=${r5.verification_task_id}`)[0].d,D(23));
 assert.equal(r5.task_urgent,false,'received today with 30 days given is not urgent');

 // ---- 6. Document requests and flag C -------------------------------------------------------------------------------------------------------------
 const c6=await log('ASSISTANT',A,{dl:D(10),ref:'KRA/C/1'});
 const rq=async(c,desc='Bank statements for the year 2025',role='ASSISTANT')=>(await q(role,`insert into erp_private.kra_case_requests(case_id,description,created_by) values($1,$2,$3) returning request_id,needed_by::text`,[c,desc,actors[role].staff_id]))[0];
 const q1=await rq(c6);assert.equal(q1.needed_by,D(10),'a request is needed by the deadline unless said otherwise');
 assert.equal(await open(c6),'','10 days left: the missing document is not flagged yet');
 await assert.rejects(rq(c6,'abc'),/check constraint/);
 await assert.rejects(q('ASSISTANT',`insert into erp_private.kra_case_requests(case_id,description,created_by,status) values($1,'Payroll records for 2025',$2,'RECEIVED')`,[c6,AST]),/starts as missing|check constraint/);
 await q('MANAGER',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c6,D(2)]);
 assert.equal(await open(c6),'BC','2 days left with a document missing: flag C, and flag B as well');
 assert.equal((await flags(c6,'Open')).find(f=>f.flag_code==='C').severity,'CRITICAL');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_requests set status='RECEIVED' where request_id=$1`,[q1.request_id]),/Attach a document/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_requests set status='RECEIVED',document_id=$2 where request_id=$1`,[q1.request_id,await doc(B)]),/filed for this client/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_requests set status='NOT_APPLICABLE',na_reason='The client holds no such records.' where request_id=$1`,[q1.request_id]),/Only a Manager or Partner/);
 await assert.rejects(q('MANAGER',`update erp_private.kra_case_requests set status='NOT_APPLICABLE',na_reason='short' where request_id=$1`,[q1.request_id]),/at least 10|check constraint/);
 const bank=await doc(A,'PBC Documents');
 await q('ASSISTANT',`update erp_private.kra_case_requests set status='RECEIVED',document_id=$2 where request_id=$1`,[q1.request_id,bank]);
 const rr=j((await tx`select status,document_id,received_on::text,received_by from erp_private.kra_case_requests where request_id=${q1.request_id}`)[0]);
 assert.deepEqual(rr,{status:'RECEIVED',document_id:bank,received_on:D(0),received_by:AST});
 assert.equal(await open(c6),'B','attaching the document clears flag C');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_requests set description='Something else entirely' where request_id=$1`,[q1.request_id]),/Return the request to missing/);
 await assert.rejects(q('MANAGER',`update erp_private.kra_case_requests set status='NOT_APPLICABLE',na_reason='The client holds no such records.' where request_id=$1`,[q1.request_id]),/Return the request to missing first/);
 await q('ASSISTANT',`update erp_private.kra_case_requests set status='MISSING' where request_id=$1`,[q1.request_id]);
 assert.equal(await open(c6),'BC','returning it to missing raises the flag again');
 assert.equal((await tx`select document_id from erp_private.kra_case_requests where request_id=${q1.request_id}`)[0].document_id,null);
 await q('MANAGER',`update erp_private.kra_case_requests set status='NOT_APPLICABLE',na_reason='The client holds no such records.' where request_id=$1`,[q1.request_id]);
 assert.equal(await open(c6),'B','a Manager marking it not applicable with a reason clears flag C');
 await q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c6,D(0)]);
 assert.equal(await open(c6),'');
 await assert.rejects(rq(c6,'More records for the year 2025'),/only while the case is open/);

 // ---- 7. Flag D, the Partner's Approve & Close, and the nightly run ----------------------------------------------------------------------------------
 const c7=await log('ASSISTANT',A,{dl:D(60),ref:'KRA/D/1'});
 await q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c7,D(0)]);
 assert.equal(await open(c7),'');
 const nightly=async(days)=>j((await tx`select erp_private.kra_run_checks((${T0}::date+${days}::int)) r`)[0].r);
 await assert.rejects(q('ASSISTANT',`select erp_private.kra_run_checks()`),/Only a Manager or Partner/);
 assert.equal(j(await q('MANAGER',`select erp_private.kra_run_checks() r`))[0].r.cases_checked>=1,true,'a Manager can run the checks on demand');
 await nightly(13);assert.equal(await open(c7),'','13 days after the response: not yet');
 const n14=await nightly(14);assert.equal(await open(c7),'D','14 days after the response');
 assert.ok(n14.cases_checked>=1&&n14.flags_raised>=1);
 assert.equal((await flags(c7,'Open'))[0].severity,'MEDIUM');
 await nightly(15);assert.equal((await tx`select count(*)::int n from erp_private.kra_compliance_flags where case_id=${c7} and flag_code='D'`)[0].n,1,'a second run does not raise a second flag');
 assert.equal(await open(c7),'D');
 assert.ok((await tx`select count(*)::int n from erp_private.notifications where message like '%KRA/D/1%' and recipient_id=${PT}`)[0].n>=1,'Partners are told');
 // Only a Partner approves and closes. The flag clears because the action was taken.
 for(const role of ['ASSISTANT','MANAGER'])await assert.rejects(q(role,`update erp_private.kra_cases set status='Closed' where case_id=$1`,[c7]),/Only a Partner can approve and close/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_cases set status='Closed' where case_id=$1`,[c1]),/not allowed/,'an open case cannot be closed; it must be responded to first');
 await q('PARTNER',`update erp_private.kra_cases set status='Closed' where case_id=$1`,[c7]);
 const r7=await row(c7);assert.deepEqual([r7.status,r7.closed_by],['Closed',PT]);assert.ok(r7.closed_at);
 assert.equal(await open(c7),'');const d7=await flags(c7,'Resolved');assert.deepEqual([d7[0].flag_code,d7[0].resolved_how,d7[0].resolved_by],['D','Action taken',PT]);
 await assert.rejects(q('PARTNER',`update erp_private.kra_cases set summary='Rewritten summary of the notice' where case_id=$1`,[c7]),/closed/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_cases set status='Open' where case_id=$1`,[c7]),/closed/);
 // Flag D can count from the deadline instead (a setting no one has confirmed).
 await q('PARTNER',`update erp_private.kra_check_settings set text_value='deadline' where setting_key='flag_d_basis'`);
 const c8=await log('ASSISTANT',A,{dl:D(10),ref:'KRA/D/2'});
 await q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c8,D(0)]);
 await nightly(14);assert.equal(await open(c8),'','counted from the deadline, 14 days after the response is only 4 days after the deadline');
 await nightly(24);assert.equal(await open(c8),'D');
 await q('PARTNER',`update erp_private.kra_check_settings set text_value='response' where setting_key='flag_d_basis'`);
 await nightly(0);assert.equal(await open(c8),'','back to the written default: not 14 days after the response yet');
 // A responded case can go back to Open (Manager or Partner, with a reason); the response is cleared.
 await assert.rejects(q('MANAGER',`update erp_private.kra_cases set status='Open' where case_id=$1`,[c8]),/Say why/);
 await q('MANAGER',`update erp_private.kra_cases set status='Open',return_note='The response was sent to the wrong office.' where case_id=$1`,[c8]);
 const r8=await row(c8);assert.deepEqual([r8.status,r8.responded_on,r8.responded_by],['Open',null,null]);
 // Cancelling a case logged in error.
 const c9=await log('ASSISTANT',A,{ref:'KRA/ERR/1',dl:D(2)});assert.equal(await open(c9),'B');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Cancelled',close_note='Logged against the wrong client.' where case_id=$1`,[c9]),/Only a Manager or Partner can cancel/);
 await assert.rejects(q('MANAGER',`update erp_private.kra_cases set status='Cancelled',close_note='short' where case_id=$1`,[c9]),/Say why/);
 await q('MANAGER',`update erp_private.kra_cases set status='Cancelled',close_note='Logged against the wrong client.' where case_id=$1`,[c9]);
 assert.equal(await open(c9),'','a cancelled case has no open flags');
 await log('ASSISTANT',A,{ref:'KRA/ERR/1'});

 // ---- 8. Flags cannot be written or dismissed by staff; nothing is deleted ---------------------------------------------------------------------------
 await assert.rejects(q('PARTNER',`insert into erp_private.kra_compliance_flags(case_id,flag_code,severity,detail,action_needed,raised_on) values($1,'A','HIGH','x','y',$2)`,[c1,D(0)]),/permission denied/);
 await assert.rejects(q('PARTNER',`update erp_private.kra_compliance_flags set status='Resolved' where status='Open'`),/permission denied/);
 for(const tbl of ['kra_cases','kra_case_requests','kra_compliance_flags','kra_check_settings'])await assert.rejects(tx([`delete from erp_private.${tbl}`]),/archived, not deleted/,tbl+' cannot be deleted');
 await assert.rejects(q('PARTNER',`update erp_private.kra_cases set task_urgent=true where case_id=$1`,[c1]),/managed by the system/);
 await assert.rejects(q('PARTNER',`select set_config('kra.system','1',true)`).then(()=>q('PARTNER',`update erp_private.kra_cases set task_urgent=true where case_id=$1`,[c1])),/managed by the system/,'a signed-in user cannot pose as the system');
 await assert.rejects(q('PARTNER',`update erp_private.kra_cases set received_on=$2 where case_id=$1`,[c1,D(-1)]),/cannot change/);

 // ---- 9. Who sees what, and the counts -----------------------------------------------------------------------------------------------------------
 assert.deepEqual(await q('INTERN',`select case_id from erp_private.kra_cases`),[],'an Intern sees no KRA cases');
 assert.equal((await q('ASSISTANT',`select case_id from erp_private.kra_cases`)).length>=5,true);
 assert.deepEqual(await q('INTERN',`select flag_id from erp_private.kra_compliance_flags`),[]);
 const c10=await log('MANAGER',A,{dl:D(1),ref:'KRA/OPEN/1'});await rq(c10,'Sales invoices for the year 2025','MANAGER');
 const c11=await log('MANAGER',E,{ref:'KRA/OPEN/2'});assert.equal(await open(c10),'BC');assert.equal(await open(c11),'A');
 const cnt=j((await q('MANAGER',`select erp_private.kra_flag_counts() c`))[0].c);
 assert.ok(cnt.open_flags>=4&&cnt.critical>=3&&cnt.critical_cases>=2&&cnt.cases_flagged>=3&&cnt.high>=1,JSON.stringify(cnt));
 const acnt=j((await q('ASSISTANT',`select erp_private.kra_flag_counts() c`))[0].c);assert.ok(acnt.cases_flagged>=2&&acnt.cases_flagged<cnt.cases_flagged,'an Assistant counts only the clients they can see');
 assert.equal(j((await q('INTERN',`select erp_private.kra_flag_counts() c`))[0].c).open_flags,0,'an Intern counts nothing');
 const list=j(await q('PARTNER',`select * from erp_private.kra_flag_list('CRITICAL')`));
 assert.ok(list.length>=2&&list.every(l=>l.severity==='CRITICAL'&&l.client_name&&l.notice_reference&&l.action_needed));
 assert.deepEqual(list.map(l=>l.days_left).filter(n=>n<0).length>=1,true,'the overdue case shows negative days');
 assert.deepEqual(j(await q('INTERN',`select * from erp_private.kra_flag_list()`)),[]);
 assert.equal(Object.values(j((await q('ASSISTANT',`select erp_private.kra_counts() c`))[0].c)).every(n=>Number(n)===0),true,'only Managers and Partners see the release counts');
 const mc=j((await q('MANAGER',`select erp_private.kra_counts() c`))[0].c);assert.ok(mc.kra_cases_open>=5&&mc.kra_flags_open>=3&&mc.kra_flags_critical>=2&&mc.kra_settings_unconfirmed>=10);
 const docs=j(await q('ASSISTANT',`select * from erp_private.kra_client_documents($1)`,[A]));assert.ok(docs.length>=2&&!docs.some(x=>x.document_id===kycDoc),'KYC files are never offered');
 assert.deepEqual(await q('INTERN',`select * from erp_private.kra_client_documents($1)`,[A]),[]);

 // ---- 9b. Client card (build 2690): open notices inside the warning window, seen only by people who may see the client ------------------------------
 const G=await mk('UAT Fictional Card Client Ltd','A400000009Z');
 const cardRows=(role,ids)=>q(role,`select client_id,kra_open,kra_days from erp_private.client_card_flags($1::uuid[])`,[ids]);
 assert.deepEqual(await cardRows('MANAGER',[G]),[{client_id:G,kra_open:0,kra_days:null}],'no notice, no warning');
 await log('MANAGER',G,{dl:D(10)});
 assert.deepEqual((await cardRows('MANAGER',[G]))[0],{client_id:G,kra_open:0,kra_days:null},'a notice 10 days away is outside the 3-day window (setting flag_b_days)');
 await log('MANAGER',G,{dl:D(2)});await log('MANAGER',G,{rc:D(-5),nd:D(-5),dl:D(-3)});
 const g1=(await cardRows('PARTNER',[G]))[0];assert.deepEqual([g1.kra_open,g1.kra_days],[2,-3],'the notice due in 2 days and the one that is 3 days past due count; the nearest is shown');
 await q('PARTNER',`update erp_private.kra_check_settings set int_value=12 where setting_key='flag_b_days'`);
 assert.equal((await cardRows('PARTNER',[G]))[0].kra_open,3,'the window follows the Partner setting');
 await q('PARTNER',`update erp_private.kra_check_settings set int_value=3 where setting_key='flag_b_days'`);
 assert.equal((await cardRows('SUPERVISOR',[G])).length,1,'a Supervisor sees the card facts for a client they may see');
 for(const role of ['ASSISTANT','INTERN'])assert.deepEqual(await cardRows(role,[G]),[],role+' gets no card facts');
 assert.deepEqual((await cardRows('MANAGER',[G,E])).map(r=>r.client_id).sort(),[E,G].sort(),'one row per client asked for');
 assert.deepEqual(await cardRows('MANAGER',[]),[]);assert.deepEqual(await cardRows('MANAGER',[id()]),[],'an unknown client returns nothing');
 await assert.rejects(cardRows('MANAGER',Array.from({length:501},()=>id())),/500 clients/);
 assert.deepEqual((await tx`select has_function_privilege('anon','erp_private.client_card_flags(uuid[])','execute') a,has_function_privilege('erp_api','erp_private.client_card_flags(uuid[])','execute') b,(select prosecdef from pg_proc where proname='client_card_flags') d,(select proconfig::text from pg_proc where proname='client_card_flags') c`).map(r=>[r.a,r.b,r.d,/search_path/.test(r.c)])[0],[false,true,true,true]);
 // ---- 10. The service profile and wording --------------------------------------------------------------------------------------------------------
 const sp=j((await tx`select engine_state,note from erp_private.service_profiles where service_code='TAX-KRA'`)[0]);
 assert.equal(sp.engine_state,'Built');assert.match(sp.note,/not confirmed/);
 assert.equal((await tx`select count(*)::int n from erp_private.kra_check_settings where label ~* 'ISRS 4000'`)[0].n,0);
 assert.equal((await tx`select count(*)::int n from pg_proc where pronamespace='erp_private'::regnamespace and proname like 'kra\\_%' and prosrc ~* 'ISRS 4000'`)[0].n,0);
});
