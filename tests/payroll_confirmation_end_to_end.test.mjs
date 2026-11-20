import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const {payrollConfirmationAction}=await import('../supabase/functions/staff-workspace-v12/payroll-confirmation-actions.ts');
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const {setPdfLib}=await import('../supabase/functions/staff-workspace-v12/suite-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p})),cf=(role,p)=>as(role,a=>payrollConfirmationAction(tx,a,{project_id:P,...p})),imp=(role,p)=>as(role,a=>periodImportAction(tx,a,{project_id:P,...p},{download:async()=>({data:new Blob([''])})}));
test('payroll client confirmation: report issued as versions, the client answer recorded with evidence, changes need a new version, a stale confirmation blocks review',async t=>{
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
let PDFLib;try{PDFLib=require('pdf-lib');}catch{PDFLib=require(path.resolve(import.meta.dirname,'..','supabase/functions/staff-workspace-v6/node_modules/pdf-lib'));}
setPdfLib(PDFLib);
 const sep=month('2026-09-01','2026-09-30',[emp('Wanjiru','1',110000),emp('Kamau','3',60000)],[calc(110000,23000,2160,3025,1650),calc(60000,8000,2160,1650,900)],'Draft');
 await addImport(sep);
 const sub=async x=>imp('ASSISTANT',{action:'period_import_submit',import_id:x,revision:String((await tx`select revision from erp_private.period_imports where import_id=${x}`)[0].revision)});
 const edit=async(rows,calcRows)=>{await db.exec('set session_replication_role=replica');try{await tx`update erp_private.period_imports set payload=${tx.json({employees:rows,calculated:calcRows,issues:[],differences:[]})} where import_id=${sep.import_id}`;}finally{await db.exec('set session_replication_role=origin');}};
 // No report issued: the run goes for review as before, and the review summary says no client confirmation was requested.
 const r0=await cf('ASSISTANT',{action:'payroll_confirmation_read',import_id:sep.import_id});assert.equal(r0.gate.state,'Not requested');assert.equal(r0.gate.blocks,false);assert.equal(r0.can_issue,true);
 await assert.rejects(()=>cf('INTERN',{action:'payroll_confirmation_read',import_id:sep.import_id}),/client access/);
 // Issue version 1. Issuing twice with the same figures is refused.
 const v1=await cf('ASSISTANT',{action:'payroll_confirmation_issue',import_id:sep.import_id});assert.equal(v1.version,1);assert.match(v1.digest,/^[0-9a-f]{64}$/);
 await assert.rejects(()=>cf('ASSISTANT',{action:'payroll_confirmation_issue',import_id:sep.import_id}),/waiting for the client/);
 // The report itself: a PDF with the people and the totals; the same version gives the same bytes.
 const pdf=await cf('ASSISTANT',{action:'payroll_confirmation_pdf',import_id:sep.import_id,confirmation_id:v1.confirmation_id});assert.equal(pdf.mime_type,'application/pdf');assert.match(pdf.file_name,/2026-09_v1\.pdf$/);
 const bytes=Buffer.from(pdf.base64,'base64');assert.equal(bytes.subarray(0,4).toString(),'%PDF');
 assert.equal((await cf('ASSISTANT',{action:'payroll_confirmation_pdf',import_id:sep.import_id,confirmation_id:v1.confirmation_id})).sha256,pdf.sha256,'same version, same bytes');
 // Waiting for the client blocks submission.
 await assert.rejects(()=>sub(sep.import_id),/Client confirmation is not complete.*has not answered/);
 // Recording the answer: who, when, and evidence are all needed.
 const rec=(x)=>cf('ASSISTANT',{action:'payroll_confirmation_record',import_id:sep.import_id,confirmation_id:v1.confirmation_id,...x});
 await assert.rejects(()=>rec({decision:'Confirmed',responder_name:'Jo',responded_on:'2026-10-02',note:'Email 2 Oct from the finance manager'}),/who at the client/);
 await assert.rejects(()=>rec({decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2099-01-01',note:'Email 2 Oct from the finance manager'}),/future/);
 await assert.rejects(()=>rec({decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2026-10-02',note:'ok'}),/Attach the client reply/);
 await assert.rejects(()=>rec({decision:'Changes requested',responder_name:'Grace Achieng',responded_on:'2026-10-02',note:''}),/changes the client asked for/);
 await assert.rejects(()=>rec({decision:'Maybe',responder_name:'Grace Achieng',responded_on:'2026-10-02',note:'whatever you like'}),/Maybe|choose|Choose/i);
 // The client asks for a change; the run is still blocked and says so.
 await rec({decision:'Changes requested',responder_name:'Grace Achieng',responded_on:'2026-10-02',note:'Kamau should be on 65,000 not 60,000'});
 await assert.rejects(()=>rec({decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2026-10-02',note:'Email 2 Oct from the finance manager'}),/already recorded/);
 await assert.rejects(()=>sub(sep.import_id),/asked for changes/);
 // Amend the run, issue version 2 (version 1 is superseded and stays), the client confirms with the reply attached.
 await edit([emp('Wanjiru','1',110000),emp('Kamau','3',65000)],[calc(110000,23000,2160,3025,1650),calc(65000,9000,2160,1800,975)]);
 const v2=await cf('ASSISTANT',{action:'payroll_confirmation_issue',import_id:sep.import_id});assert.equal(v2.version,2);assert.notEqual(v2.digest,v1.digest);
 const list=(await cf('ASSISTANT',{action:'payroll_confirmation_read',import_id:sep.import_id}));assert.deepEqual(list.versions.map(x=>[x.version,x.status]),[[2,'Issued'],[1,'Superseded']]);
 await assert.rejects(()=>cf('ASSISTANT',{action:'payroll_confirmation_record',import_id:sep.import_id,confirmation_id:v1.confirmation_id,decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2026-10-03',note:'Email 3 Oct from the finance manager'}),/replaced by a newer one/);
 await cf('ASSISTANT',{action:'payroll_confirmation_record',import_id:sep.import_id,confirmation_id:v2.confirmation_id,decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2026-10-03',evidence_document_id:D});
 const done=await cf('ASSISTANT',{action:'payroll_confirmation_read',import_id:sep.import_id});assert.equal(done.gate.state,'Confirmed');assert.equal(done.versions[0].evidence_file_name,'Fictional.xlsx');assert.equal(done.versions[0].recorded_by_name.length>0,true);
 // Another colleague sees every version and the names (a join on staff records would hide rows written by someone else).
 {const sv=await cf('SUPERVISOR',{action:'payroll_confirmation_read',import_id:sep.import_id});assert.equal(sv.versions.length,2);assert.ok(sv.versions.every(x=>x.issued_by_name),'issuer name shown to a colleague');}
 // A change after the client confirmed makes the confirmation out of date. The database also refuses editing an issued version.
 await edit([emp('Wanjiru','1',110000),emp('Kamau','3',66000)],[calc(110000,23000,2160,3025,1650),calc(66000,9500,2160,1900,990)]);
 assert.equal((await cf('ASSISTANT',{action:'payroll_confirmation_read',import_id:sep.import_id})).gate.state,'Out of date');
 await assert.rejects(()=>sub(sep.import_id),/changed after the client confirmed/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.payroll_client_confirmations set digest=${'0'.repeat(64)} where confirmation_id=${v2.confirmation_id}`),/never edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.payroll_client_confirmations where confirmation_id=${v2.confirmation_id}`),/./);
 // Version 3 for the final figures, confirmed; then the run submits and the review summary shows the confirmation.
 const v3=await cf('ASSISTANT',{action:'payroll_confirmation_issue',import_id:sep.import_id});assert.equal(v3.version,3);
 await cf('ASSISTANT',{action:'payroll_confirmation_record',import_id:sep.import_id,confirmation_id:v3.confirmation_id,decision:'Confirmed',responder_name:'Grace Achieng',responded_on:'2026-10-04',note:'WhatsApp 4 Oct, screenshot saved to the client file'});
 assert.deepEqual(await sub(sep.import_id),{ok:true});
 await assert.rejects(()=>cf('ASSISTANT',{action:'payroll_confirmation_issue',import_id:sep.import_id}),/still being prepared/);
 // A second run for another month with no report is unaffected.
 const oct=month('2026-10-01','2026-10-31',[emp('Wanjiru','1',110000)],[calc(110000,23000,2160,3025,1650)],'Draft');await addImport(oct);
 assert.deepEqual(await sub(oct.import_id),{ok:true},'no report issued, no gate');
});
