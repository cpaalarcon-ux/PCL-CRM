// Audit build F: time and WIP, draft invoice on approval, sign-off deadline and firm tiles.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {tileSummary,createFirmUI} from '../staff-audit-firm.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('tiles and panel by role',()=>{
 assert.equal(tileSummary(null),null);
 const t={deadlines:{overdue:2,due_14_days:1,not_set:3,next:[{project_id:'p1',client:'Acme <Ltd>',due:'2026-01-01',days:-4}]},review_rate:{pct:80,reviewed:8,sent_for_review:10},stuck:{days:14,by_stage:{'In Review':2,Draft:1},files:[{project_id:'p2',client:'Beta',status:'Draft',idle_days:30}]},draft_invoices_waiting:1};
 assert.deepEqual(tileSummary(t),{overdue:2,due:1,notSet:3,rate:80,stuck:3,invoices:1});
 let me={staff_id:'m1',category_code:'MANAGER'};
 const snap={file:{audit_file_id:'f1',file_status:'Prepared',signoff_due_on:'2026-03-31'},my_tasks:[{task_id:'t1',task_name:'Audit fieldwork'}],workpapers:[],
  time_summary:{approved_hours:10,submitted_hours:2,draft_hours:1,budgeted_hours:20,hours_without_rate:1.5,money_visible:true,agreed_fee:100000,standard_value:60000,billed_net:0,wip_unbilled:60000,by_staff:[{staff_name:'Asha <A>',approved:10,submitted:2,draft:1}]},billing_link:null};
 const ui=()=>createFirmUI({esc,field:()=>'',select:()=>'',form:x=>x,modal(){},request(){},notice(){},shortDate:String,data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().tiles(t);assert.match(html,/2 overdue/);assert.match(html,/80%/);assert.match(html,/Acme &lt;Ltd&gt;/);assert.match(html,/data-audit-open="p2"/);
 me={staff_id:'a1',category_code:'ASSISTANT'};assert.equal(ui().tiles(t),'','tiles are for Managers and Partners');
 me={staff_id:'m1',category_code:'MANAGER'};html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-time-log/);assert.match(html,/data-audit-deadline/);assert.match(html,/Unbilled WIP/);assert.match(html,/Asha &lt;A&gt;/);assert.match(html,/no staff rate/);assert.match(html,/60% used/);
 snap.time_summary.money_visible=false;me={staff_id:'a1',category_code:'ASSISTANT'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/Unbilled WIP|Agreed fee/);assert.doesNotMatch(html,/data-audit-deadline/);
 snap.my_tasks=[];html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-time-log/);assert.match(html,/open task assigned to you/);
 snap.billing_link={outcome:'Draft invoice raised',note:'VAT at 16%',invoice_id:'i1',invoice_status:'Draft',net_amount:90000,vat_amount:14400};me={staff_id:'p1',category_code:'PARTNER'};html=ui().panel(snap.file,snap);assert.match(html,/Draft invoice raised/);assert.match(html,/a Partner posts it/);
 snap.file.file_status='Approved';html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-time-log|data-audit-deadline/);
});
test('wiring',()=>{
 for(const a of ['audit_deadline_save','audit_time_summary','audit_firm_tiles','audit_billing_links'])assert.match(rd(fx+'audit-actions.ts'),new RegExp(a));
 assert.match(rd('staff-audit.mjs'),/firm\.handle\(b/);assert.match(rd('staff-audit.mjs'),/'Time & billing'/);assert.match(rd('staff-audit.mjs'),/firm\.tiles/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('time, deadline, tiles and the draft invoice on approval are enforced by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit adjustments firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Audit Entries Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional statutory audit','AUD-STAT',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const FILE=id();
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P},${C},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 // Mapped accounts and a confirmed trial balance.
 const acct={};
 for(const [k,code,name,area,fs] of [['cash','1000','Cash at bank','Cash and bank','Assets'],['pay','2000','Trade payables','Trade payables','Liabilities'],['rev','4000','Sales','Revenue','Revenue'],['exp','6000','Audit fees','Payroll and expenses','Operating expenses'],['tax','7000','Income tax','Taxation','Tax expense']]){acct[k]=id();await tx`insert into erp_private.audit_account_mappings(audit_account_id,handling_firm_id,legacy_account_code,legacy_account_name,audit_area,financial_statement_line,confirmed_by) values(${acct[k]},${F},${code},${name},${area},${fs},${M})`;}
 const DOC=id(),IMP=id();
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${DOC},${C},${F},${P},'Import Sources','tb.xlsx','k/tb',1,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${M})`;
 await tx`insert into erp_private.audit_tb_imports(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_document_id,source_sha256,import_signature,sheet_name,period_ends_on,header_row,first_data_row,last_data_row,column_mapping,period_kind,status,source_row_count,total_debit,total_credit,imported_by,confirmed_by,confirmed_at) values(${IMP},${FILE},${P},${F},${DOC},${'a'.repeat(64)},${'b'.repeat(64)},'TB','2025-12-31',1,2,3,'{}','Current','Confirmed',3,2000000,2000000,${M},${M},now())`;
 for(const [i,k,d,c] of [[2,'cash',2000000,0],[3,'pay',0,1000000],[4,'rev',0,1000000]])await tx`insert into erp_private.audit_tb_lines(audit_tb_import_id,audit_file_id,project_id,handling_firm_id,source_row,legacy_account_code,legacy_account_name,source_debit,source_credit,audit_account_id,audit_area,financial_statement_line,mapping_confidence) values(${IMP},${FILE},${P},${F},${i},${'T'+i},${k},${d},${c},${acct[k]},'x','y','Confirmed')`;
 const J=(a,b,d)=>[{audit_account_id:acct[a],debit:d,credit:0},{audit_account_id:acct[b],debit:0,credit:d}];
 const save=(role,o={})=>as(role,()=>tx`select erp_private.audit_adjustment_save(${FILE}::uuid,${o.id||null}::uuid,${o.kind||'Adjusting'},${o.d||'Accrue the audit fee for the year'},${o.b||'Engagement letter dated January'},${o.type||null},${o.resp||''},${null}::uuid,${JSON.stringify(o.lines||J('exp','pay',50000))}::jsonb) id`).then(r=>r[0].id);
 const submit=(role,i)=>as(role,()=>tx`select erp_private.audit_adjustment_submit(${i}::uuid)`);
 const review=(role,i,dec='Approve',note='Agreed to the engagement letter')=>as(role,()=>tx`select erp_private.audit_adjustment_review(${i}::uuid,${dec},${note})`);

 const sum=role=>as(role,()=>tx`select erp_private.audit_time_summary(${FILE}::uuid) s`).then(r=>r[0].s);
 const A=actors.ASSISTANT.staff_id;
 // Time: a task assigned to the Assistant, a rate for the Assistant, approved and submitted hours.
 const TASK=id();
 await db.exec('alter table erp_private.tasks disable trigger user;alter table erp_private.timesheets disable trigger user');
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${TASK},${P},${A},'Audit fieldwork')`;
 await tx`insert into erp_private.staff_rates(staff_id,effective_from,effective_to,cost_rate,billable_rate,created_by) values(${A},'2025-01-01','2027-12-31',1000,4000,${M})`;
 const ts=(hours,status,date='2025-03-03')=>tx`insert into erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,billable,status,reviewed_by,reviewed_at) values(${A},${P},${TASK},${date},${hours},'Audit fieldwork',true,${status},${status==='Approved'?M:null},${status==='Approved'?new Date().toISOString():null})`;
 await ts(10,'Approved');await ts(2,'Submitted','2025-03-04');await ts(1,'Draft','2025-03-05');
 await tx`insert into erp_private.project_budgets(project_id,agreed_fee,budgeted_hours,budgeted_cost,effective_from,reason,created_by) values(${P},100000,40,20000,'2025-01-01','Engagement letter',${M})`;
 let tm=await sum('MANAGER');
 assert.equal(Number(tm.approved_hours),10);assert.equal(Number(tm.submitted_hours),2);assert.equal(Number(tm.draft_hours),1);assert.equal(Number(tm.budgeted_hours),40);
 assert.equal(tm.money_visible,true);assert.equal(Number(tm.standard_value),40000);assert.equal(Number(tm.wip_unbilled),40000,'WIP is approved billable time at the standard rate, less posted invoices');assert.equal(Number(tm.agreed_fee),100000);
 assert.equal(tm.by_staff.length,1);
 tm=await sum('ASSISTANT');assert.equal(tm.money_visible,false);assert.equal(tm.standard_value,null,'staff see hours, not money');assert.equal(Number(tm.approved_hours),10);
 assert.equal(await sum('INTERN'),null);
 // Deadline: Manager or Partner only, not before period end, not on a closed file.
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.audit_deadline_save(${FILE}::uuid,'2026-06-30')`),/Manager or Partner/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_deadline_save(${FILE}::uuid,'2025-06-30')`),/before the end of the audit period/);
 await as('MANAGER',()=>tx`select erp_private.audit_deadline_save(${FILE}::uuid,'2020-06-30'::date + 2000)`).catch(()=>{});
 await as('MANAGER',()=>tx`select erp_private.audit_deadline_save(${FILE}::uuid,'2026-01-31')`);
 assert.equal((await tx`select to_char(signoff_due_on,'YYYY-MM-DD') d from erp_private.audit_files where audit_file_id=${FILE}`)[0].d,'2026-01-31');
 // Tiles: Managers and Partners only. The file is open, past its deadline, and has no recent activity.
 assert.equal((await as('SUPERVISOR',()=>tx`select erp_private.audit_firm_tiles(14) t`))[0].t,null);
 let tl=(await as('PARTNER',()=>tx`select erp_private.audit_firm_tiles(14) t`))[0].t;
 assert.equal(tl.open_files,1);assert.equal(tl.deadlines.overdue,1);assert.equal(tl.deadlines.next[0].client,'UAT Fictional Audit Entries Ltd');assert.equal(tl.review_rate.pct,null,'no working papers at review yet');
 assert.equal(tl.stuck.days,14);
 await tx`update erp_private.audit_files set updated_at=now()-interval '30 days' where audit_file_id=${FILE}`.catch(()=>{});
 // Review rate: working papers at review or later.
 for(const [ref,st] of [['WP-1','Approved'],['WP-2','Approved'],['WP-3','Submitted'],['WP-4','Draft']])await tx`insert into erp_private.audit_workpapers(audit_file_id,project_id,handling_firm_id,workpaper_ref,audit_area,objective,assertion,linked_risk,standard_reference,planned_procedure,responsible_staff_id,prepared_by,status,submitted_at,reviewer_id,reviewed_at) values(${FILE},${P},${F},${ref},'Cash and bank','o','a','r','s','p',${A},${A},${st},${st==='Draft'?null:new Date().toISOString()},${st==='Approved'?M:null},${st==='Approved'?new Date().toISOString():null})`;
 await db.exec(`alter table erp_private.audit_files disable trigger planning_guard;alter table erp_private.audit_files disable trigger lead_guard;alter table erp_private.audit_files disable trigger report_guard;alter table erp_private.audit_files disable trigger analytics_guard`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 tl=(await as('MANAGER',()=>tx`select erp_private.audit_firm_tiles(14) t`))[0].t;assert.equal(tl.review_rate.sent_for_review,3);assert.equal(tl.review_rate.reviewed,2);assert.equal(Number(tl.review_rate.pct),66.7);
 // Approving the file raises a draft invoice for the unbilled agreed fee. A partner is told. Nothing is posted.
 await db.exec(`alter table erp_private.audit_workpapers disable trigger all`);
 const before=(await tx`select count(*)::int n from erp_private.notifications`)[0].n;
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 const link=(await tx`select l.outcome,l.amount_net,i.status,i.net_amount,i.vat_amount,i.total_amount,i.invoice_number,i.lines from erp_private.audit_billing_links l join erp_private.invoices i on i.invoice_id=l.invoice_id where l.audit_file_id=${FILE}`)[0];
 assert.deepEqual([link.outcome,link.status,Number(link.net_amount),Number(link.vat_amount),link.invoice_number],['Draft invoice raised','Draft',100000,16000,null],'a draft only, with no invoice number');
 assert.equal(link.lines[0].vat_rate,16);
 assert.ok((await tx`select count(*)::int n from erp_private.notifications`)[0].n>before,'Partners are told');
 assert.equal((await as('MANAGER',()=>tx`select count(*)::int n from erp_private.audit_billing_links`))[0].n,1);assert.equal((await as('ASSISTANT',()=>tx`select count(*)::int n from erp_private.audit_billing_links`))[0].n,0);
 // Approving again (after a return) does not raise a second draft.
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 assert.equal((await tx`select count(*)::int n from erp_private.invoices where project_id=${P}`)[0].n,1);
 await assert.rejects(()=>tx`update erp_private.audit_billing_links set note='x' where audit_file_id=${FILE}`,/./);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_deadline_save(${FILE}::uuid,'2027-01-31')`),/closed/);

 // A project with no agreed fee: the file can be approved, no draft is raised, and the link records why.
 const P2=id(),FILE2=id();
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C},${F},'Fictional second audit','AUD-STAT',${M})`;
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE2},${P2},${C},${F},'2024-01-01','2024-12-31','First-year','IFRS for SMEs',${M})`;
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE2}`;
 const nl=(await tx`select outcome,invoice_id,note from erp_private.audit_billing_links where audit_file_id=${FILE2}`)[0];assert.equal(nl.outcome,'No agreed fee on record');assert.equal(nl.invoice_id,null);assert.match(nl.note,/Raise the invoice manually/);
 assert.equal((await tx`select count(*)::int n from erp_private.invoices where project_id=${P2}`)[0].n,0);
});
