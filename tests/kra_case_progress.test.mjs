// KRA case upgrades, first slice: stages, submission details and the submission blocker, contact log and timeline, flag E, dashboard (build 2782).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const {kraAction}=await import('../supabase/functions/staff-workspace-v12/kra-actions.ts');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('KRA case progress: stages, submission rules, contact log, timeline, Partner alert, dashboard',async t=>{
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
 const open=async c=>(await flags(c,'Open')).map(f=>f.flag_code).filter(x=>x!=='E').join(''); // flag E (the Partner alert) has its own test in kra_case_progress.test.mjs
 const respond=async(role,c,on)=>{await q(role,`update erp_private.kra_case_progress set submitted_at=now(),submission_channel='Email',submission_reference='KRA-ACK-1' where case_id=$1`,[c]);await q(role,`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c,on]);};
 const doc=async(client=A,category='Permanent File')=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${client},${F},${category},${'KRA '+category+'.pdf'},${'k/'+d},10,${'a'.repeat(64)},'application/pdf',${M})`;return d;};
 const ka=(role,p)=>as(role,a=>kraAction(tx,a,p));
 const rd=(role,c)=>ka(role,{action:'kra_read',case_id:c});
 const evs=async c=>(await tx`select kind,summary,recorded_by from erp_private.kra_case_events where case_id=${c} order by happened_at,created_at,event_id`);
 const stageOf=async c=>(await tx`select stage from erp_private.kra_case_progress where case_id=${c}`)[0].stage;
 const pn=D=>D; 
 const master=await proj(A,'TAX-COMP','Active',M,true);
 await tx`insert into erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on,status) values(${master},'Annually','2025-01-01','2025-12-31','Open')`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${master},${AST},${F},'ASSISTANT')`;
 // ---- 1. a new case starts at Received, with a timeline entry ---------------------------------------------------------------------------------------
 const c1=await log('ASSISTANT',A,{dl:D(30),ref:'KRA/PROG/1'});
 assert.equal(await stageOf(c1),'Received');
 assert.deepEqual((await evs(c1)).map(e=>e.kind),['Status']);
 // ---- 2. flag E, the Partner alert: 7 days is the default, a Partner can change it --------------------------------------------------------------------
 assert.equal((await flags(c1,'Open')).some(f=>f.flag_code==='E'),false,'30 days left: no alert');
 await q('MANAGER',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c1,D(6)]);
 const e1=(await flags(c1,'Open')).find(f=>f.flag_code==='E');assert.ok(e1,'6 days left raises the Partner alert');assert.equal(e1.severity,'HIGH');
 const det=(await tx`select detail,action_needed from erp_private.kra_compliance_flags where case_id=${c1} and flag_code='E'`)[0];assert.match(det.detail,/in 6 day\(s\).*not been submitted to KRA/);assert.doesNotMatch(det.detail,/No one is assigned/,'the case has a task owner');assert.match(det.action_needed,/internal alert, separate from the KRA deadline/);
 assert.ok((await tx`select 1 from erp_private.notifications n join erp_private.staff_members m on m.staff_id=n.recipient_id where m.category_code='PARTNER' and n.message like '%KRA/PROG/1%(flag E)%'`).length>=1,'the Partners are told in the bell');
 await q('MANAGER',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c1,D(9)]);
 assert.equal((await flags(c1,'Open')).some(f=>f.flag_code==='E'),false,'9 days left: the alert clears');
 const sett=(await ka('PARTNER',{action:'kra_settings_read'})).settings.find(s=>s.setting_key==='escalation_days');assert.deepEqual([sett.int_value,sett.rule_status],[7,'Suggested']);
 await ka('PARTNER',{action:'kra_setting_set',setting_key:'escalation_days',value:10,revision:sett.revision});
 await q('MANAGER',`select erp_private.kra_run_checks()`);
 assert.equal((await flags(c1,'Open')).some(f=>f.flag_code==='E'),true,'with the alert at 10 days, 9 days left raises it');
 await ka('PARTNER',{action:'kra_setting_set',setting_key:'escalation_days',value:7,revision:(await ka('PARTNER',{action:'kra_settings_read'})).settings.find(s=>s.setting_key==='escalation_days').revision});
 await q('MANAGER',`select erp_private.kra_run_checks()`);
 assert.equal((await flags(c1,'Open')).some(f=>f.flag_code==='E'),false);
 await q('MANAGER',`update erp_private.kra_cases set deadline_date=$2 where case_id=$1`,[c1,D(20)]);
 // ---- 3. stages ----------------------------------------------------------------------------------------------------------------------------------------
 const rv=async()=>(await rd('MANAGER',c1)).case.revision;
 await ka('ASSISTANT',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'Triage'});assert.equal(await stageOf(c1),'Triage');
 await assert.rejects(ka('ASSISTANT',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'Approved to send'}),/Only a Manager or Partner can set the stage/);
 await assert.rejects(ka('MANAGER',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'Submitted to KRA'}),/Choose a stage from the list/);
 await assert.rejects(ka('MANAGER',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'Awaiting KRA'}),/Choose a stage from the list/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_progress set stage='Submitted to KRA' where case_id=$1`,[c1]),/submitting it to KRA does that/,'the database says the same');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_progress set stage='Approved to send' where case_id=$1`,[c1]),/Only a Manager or Partner/);
 await ka('ASSISTANT',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'In progress'});await ka('MANAGER',{action:'kra_stage',case_id:c1,revision:await rv(),stage:'Internal review'});
 assert.deepEqual((await evs(c1)).map(e=>e.summary).slice(1),['Stage: Received to Triage','Stage: Triage to In progress','Stage: In progress to Internal review']);
 await assert.rejects(ka('INTERN',{action:'kra_stage',case_id:c1,revision:1,stage:'Triage'}),/cannot use the KRA notice log/);
 await q('INTERN',`update erp_private.kra_case_progress set stage='Triage' where case_id=$1`,[c1]);assert.equal(await stageOf(c1),'Internal review','row security hides the case from an Intern: nothing changes');
 // ---- 4. submitting: documents, details, then the status follows ----------------------------------------------------------------------------
 const rqA=await ka('ASSISTANT',{action:'kra_request_add',case_id:c1,revision:await rv(),description:'Ledger for the year 2025',needed_by:D(15)});
 const submit={action:'kra_respond',case_id:c1,submission_channel:'iTax portal',submission_reference:'ITAX-ACK-99887',submitted_at:'2026-01-01T09:30'};
 await assert.rejects(ka('ASSISTANT',{...submit,revision:await rv()}),/1 requested document\(s\) are still missing \(Ledger for the year 2025\)/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c1,D(0)]),/still missing|Record the submission/,'the database repeats the blocker');
 const pending=await ka('ASSISTANT',{action:'kra_read',case_id:c1});
 await ka('MANAGER',{action:'kra_request_na',case_id:c1,request_id:pending.requests[0].request_id,revision:pending.requests[0].revision,reason:'The client has no separate ledger for 2025.'});
 await assert.rejects(ka('ASSISTANT',{...submit,revision:await rv(),submission_channel:'Pigeon'}),/Choose a valid option/);
 await assert.rejects(ka('ASSISTANT',{...submit,revision:await rv(),submission_reference:'ab'}),/at least 3 characters/);
 await assert.rejects(ka('ASSISTANT',{...submit,revision:await rv(),submitted_at:'tomorrow morning'}),/Enter the date and time/);
 await assert.rejects(ka('ASSISTANT',{...submit,revision:await rv(),submitted_at:'2999-01-01T09:30'}),/cannot be in the future|between the date received and today/);
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_cases set status='Responded',responded_on=$2 where case_id=$1`,[c1,D(0)]),/Record the submission date and time/,'no details, no submission');
 const today=T0;
 await ka('ASSISTANT',{...submit,revision:await rv(),submitted_at:`${today}T00:05`});
 let r1=await rd('MANAGER',c1);
 assert.deepEqual([r1.case.status,r1.progress.stage,r1.progress.submission_channel,r1.progress.submission_reference],['Responded','Submitted to KRA','iTax portal','ITAX-ACK-99887']);
 assert.equal((await row(c1)).responded_on,today);
 const kinds=(await evs(c1)).map(e=>e.kind);assert.deepEqual(kinds.slice(-3),['Stage','Document','Submission'],'internal review, the not-applicable mark and the submission are on the timeline');
 assert.match((await evs(c1)).at(-1).summary,/Submitted to KRA by iTax portal, reference ITAX-ACK-99887/);
 // ---- 5. after submission ----------------------------------------------------------------------------------------------------------------------------
 const rv2=async()=>(await rd('MANAGER',c1)).case.revision;
 await ka('ASSISTANT',{action:'kra_stage',case_id:c1,revision:await rv2(),stage:'Awaiting KRA'});assert.equal(await stageOf(c1),'Awaiting KRA');
 await assert.rejects(ka('ASSISTANT',{action:'kra_stage',case_id:c1,revision:await rv2(),stage:'Resolved'}),/Only a Manager or Partner can set the stage/);
 await assert.rejects(ka('MANAGER',{action:'kra_stage',case_id:c1,revision:await rv2(),stage:'Triage'}),/Choose a stage from the list/);
 await ka('MANAGER',{action:'kra_stage',case_id:c1,revision:await rv2(),stage:'Further information requested'});
 const ackOther=await doc(B),ackOk=await doc(A);
 await assert.rejects(ka('ASSISTANT',{action:'kra_ack',case_id:c1,revision:await rv2(),document_id:ackOther}),/filed for this client/);
 await ka('ASSISTANT',{action:'kra_ack',case_id:c1,revision:await rv2(),document_id:ackOk});
 r1=await rd('MANAGER',c1);assert.ok(r1.progress.ack_file_name);assert.equal((await evs(c1)).at(-1).summary,'KRA acknowledgment saved');
 await assert.rejects(q('ASSISTANT',`update erp_private.kra_case_progress set submission_reference='CHANGED-LATER' where case_id=$1`,[c1]),/Only a Manager or Partner can correct the submission details/);
 await q('MANAGER',`update erp_private.kra_case_progress set submission_reference='ITAX-ACK-99887-A' where case_id=$1`,[c1]);
 // ---- 6. the contact log --------------------------------------------------------------------------------------------------------------------------------
 const ev={action:'kra_event_add',case_id:c1,kind:'Call',participants:'KRA officer, Ms Fictional',summary:'Asked when the review of the response will finish.'};
 await ka('ASSISTANT',{...ev,revision:1,happened_at:`${today}T00:10`});
 const last=(await evs(c1)).find(e=>e.kind==='Call');assert.deepEqual([last.kind,last.recorded_by],['Call',AST]);
 await assert.rejects(ka('ASSISTANT',{...ev,revision:1,kind:'Stage'}),/Choose a valid option/);
 await assert.rejects(q('ASSISTANT',`insert into erp_private.kra_case_events(case_id,kind,summary) values($1,'Stage','Pretend')`,[c1]),/Staff add emails, calls/);
 await assert.rejects(ka('ASSISTANT',{...ev,revision:1,summary:'x'}),/at least 3 characters/);
 await assert.rejects(ka('ASSISTANT',{...ev,revision:1,happened_at:'2999-01-01T09:00'}),/cannot be in the future/);
 await assert.rejects(ka('ASSISTANT',{...ev,revision:1,document_id:ackOther}),/filed for this client/);
 await assert.rejects(()=>tx`update erp_private.kra_case_events set summary='edited' where case_id=${c1}`,/only added to/);
 await assert.rejects(()=>tx`delete from erp_private.kra_case_events where case_id=${c1}`,/only added to/);
 await assert.rejects(ka('INTERN',ev),/cannot use the KRA notice log/);
 assert.equal((await q('INTERN',`select count(*)::int n from erp_private.kra_case_events`))[0].n,0,'row security hides the timeline from an Intern');
 const tl=(await rd('ASSISTANT',c1)).events;assert.ok(tl.length>=8);assert.ok(tl.every(e=>e.recorded_by_name));assert.ok(tl.some(e=>e.kind==='Call'));
 // ---- 7. return to open, then close ----------------------------------------------------------------------------------------------------------------
 await ka('MANAGER',{action:'kra_return',case_id:c1,revision:await rv2(),note:'KRA wants a corrected schedule before it will review.'});
 assert.equal(await stageOf(c1),'In progress');assert.match((await evs(c1)).at(-1).summary,/^Returned to open: KRA wants a corrected schedule/);
 await ka('ASSISTANT',{...submit,revision:await rv2(),submission_reference:'ITAX-ACK-99999',submitted_at:`${today}T00:20`});
 await ka('PARTNER',{action:'kra_close',case_id:c1,revision:await rv2()});
 assert.equal(await stageOf(c1),'Resolved');assert.equal((await evs(c1)).at(-1).summary,'Approved and closed by a Partner');
 await assert.rejects(ka('ASSISTANT',{...ev,revision:1}),/is closed|can no longer change/);
 await assert.rejects(q('MANAGER',`update erp_private.kra_case_progress set stage='Triage' where case_id=$1`,[c1]),/can no longer change/);
 // ---- 8. the KPI cards -----------------------------------------------------------------------------------------------------------------------------------
 const cOver=await log('MANAGER',A,{dl:D(-2),rc:D(-5),nd:D(-6),ref:'KRA/DASH/OVER'}),cSoon=await log('MANAGER',A,{dl:D(3),ref:'KRA/DASH/SOON'}),cLater=await log('MANAGER',A,{dl:D(40),ref:'KRA/DASH/LATER'});
 await ka('MANAGER',{action:'kra_request_add',case_id:cSoon,revision:(await rd('MANAGER',cSoon)).case.revision,description:'Bank statements for 2025'});
 const cWait=await log('MANAGER',A,{dl:D(25),ref:'KRA/DASH/WAIT'});
 await ka('MANAGER',{...submit,case_id:cWait,revision:(await rd('MANAGER',cWait)).case.revision,submission_reference:'ITAX-ACK-00001',submitted_at:`${today}T00:15`});
 const cNoOwner=await log('MANAGER',E,{dl:D(4),ref:'KRA/DASH/NOOWNER'});
 assert.match((await tx`select detail from erp_private.kra_compliance_flags where case_id=${cNoOwner} and flag_code='E'`)[0].detail,/No one is assigned to it\./,'a case with no task owner says so');
 const dash=(await ka('MANAGER',{action:'kra_dashboard'})).dashboard;
 assert.deepEqual([dash.overdue,dash.due_soon,dash.missing_documents,dash.awaiting_kra,dash.open,dash.escalation_days],[1,2,1,1,4,7],JSON.stringify(dash));
 assert.equal(dash.unassigned,1,'only the case on the client with no tax project has no task owner');
 assert.deepEqual((await ka('MANAGER',{action:'kra_list'})).cases.find(c=>c.case_id===cWait).stage,'Submitted to KRA');
 // ---- 9. nothing was invented -----------------------------------------------------------------------------------------------------------------------
 const cols=(await tx`select column_name from information_schema.columns where table_schema='erp_private' and table_name in('kra_case_progress','kra_case_events')`).map(r=>r.column_name);
 assert.ok(!cols.some(c=>/rate|penalt|interest|days_allowed/i.test(c)),'no tax rate, penalty or statutory day count is stored');
 assert.equal((await ka('MANAGER',{action:'kra_settings_read'})).settings.find(s=>s.setting_key==='escalation_days').rule_status,'Suggested' ? 'Suggested':'x');
});
