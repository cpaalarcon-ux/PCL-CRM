// Audit build D: draft financial statements, management letter points, letters and completion memorandum.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {createReportsUI,reportTitle} from '../staff-audit-reports.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('screen by role',()=>{
 let me={staff_id:'a1',category_code:'ASSISTANT'};
 const fsBody={entity:'Acme <Ltd>',framework:'IFRS for SMEs',framework_status:'Pending review',period_end:'2025-12-31',balances:true,sections:[{line:'Assets',total:2000000,comparative_total:null,items:[{account_code:'1000',account_name:'Cash <b>',current:2000000,comparative:null}]}],totals:{revenue:1000000,profit_for_the_year:1000000,total_assets:2000000,total_liabilities:1000000,total_equity:0,difference:0},note:'Draft note'};
 const snap={file:{audit_file_id:'f1',file_status:'Prepared'},report_status:[{kind:'Financial statements',required:true,approved_report_id:null,current:false},{kind:'Management letter',required:false,open_points:1},{kind:'Representation letter',required:true},{kind:'Completion memorandum',required:true}],
  reports:[{report_id:'r1',kind:'Financial statements',version_number:1,status:'Submitted',prepared_by:'a1',prepared_by_name:'Asha',body:fsBody,current:true},{report_id:'r2',kind:'Completion memorandum',version_number:1,status:'Submitted',prepared_by:'a1',prepared_by_name:'Asha',current:true,body:{flagged_matters:['Open risk R-001: stock <b>'],materiality:null,risks:[],workpapers:{},lead_schedules:[],completion_items:[],misstatements:{accumulated:0}}}],
  mgmt_points:[{point_id:'p1',point_ref:'MP-001',title:'Late <accrual>',observation:'Found late',rating:'High',status:'Open',source_kind:'Adjustment'}]};
 const ui=()=>createReportsUI({esc,field:()=>'',select:()=>'',form:x=>x,modal(){},request(){},notice(){},shortDate:String,data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().panel(snap.file,snap);
 assert.match(html,/Acme &lt;Ltd&gt;/);assert.match(html,/Cash &lt;b&gt;/);assert.match(html,/data-audit-report-draft="Financial statements"/);assert.match(html,/Late &lt;accrual&gt;/);assert.match(html,/Pending review/);
 assert.doesNotMatch(html,/data-audit-report-review="r1"/,'a preparer does not review');assert.doesNotMatch(html,/data-audit-point-decide/,'an Assistant does not decide points');assert.match(html,/Open risk R-001: stock &lt;b&gt;/);
 me={staff_id:'m1',category_code:'MANAGER'};html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-report-review="r2"/);assert.doesNotMatch(html,/data-audit-report-review="r1"/,'only a Partner reviews the financial statements');assert.match(html,/data-audit-point-decide="p1"/);
 me={staff_id:'p1',category_code:'PARTNER'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-report-review="r1"/);
 me={staff_id:'i1',category_code:'INTERN'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-report-draft|data-audit-point-new/);
 me={staff_id:'p1',category_code:'PARTNER'};snap.file.file_status='Approved';html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-report-draft|data-audit-point-new|data-audit-report-review/);
 assert.equal(reportTitle({kind:'Management letter',version_number:3}),'Management letter · version 3');
});
test('wiring',()=>{
 for(const a of ['audit_report_draft','audit_report_review','audit_mgmt_points_suggest','audit_mgmt_point_decide'])assert.match(rd(fx+'audit-actions.ts'),new RegExp(a));
 assert.match(rd('staff-audit.mjs'),/reports\.handle\(b/);assert.match(rd('staff-audit.mjs'),/'Reports'/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('reports are built from the adjusted TB, reviewed by the right people and gate the file',async t=>{
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
 const draft=(role,kind,prm={})=>as(role,()=>tx`select erp_private.audit_report_draft(${FILE}::uuid,${kind},${JSON.stringify(prm)}::jsonb) id`).then(r=>r[0].id);
 const rsubmit=(role,i)=>as(role,()=>tx`select erp_private.audit_report_submit(${i}::uuid)`);
 const rreview=(role,i,dec='Approve',note='Agreed to the underlying records')=>as(role,()=>tx`select erp_private.audit_report_review(${i}::uuid,${dec},${note})`);
 const rstat=async()=>Object.fromEntries((await as('MANAGER',()=>tx`select erp_private.audit_report_status(${FILE}::uuid) s`))[0].s.map(x=>[x.kind,x]));
 const adj=async(d,lines,basis)=>{const e=await save('ASSISTANT',{d,lines,b:basis});await submit('ASSISTANT',e);await review('MANAGER',e);return e;};
 await assert.rejects(()=>draft('INTERN','Financial statements'),/Not allowed/);
 await assert.rejects(()=>draft('ASSISTANT','Balance sheet'),/Choose a report/);
 // Financial statements from the adjusted TB: cash 2m, payables 1m Cr, sales 1m Cr. Profit 1m.
 const fs1=await draft('ASSISTANT','Financial statements');
 let b=(await tx`select body from erp_private.audit_reports where report_id=${fs1}`)[0].body;
 assert.equal(Number(b.totals.total_assets),2000000);assert.equal(Number(b.totals.total_liabilities),1000000);assert.equal(Number(b.totals.profit_for_the_year),1000000);assert.equal(b.balances,true);assert.equal(b.entity,'UAT Fictional Audit Entries Ltd');assert.equal(b.framework,'IFRS for SMEs');
 // A saved report cannot be edited.
 await assert.rejects(()=>tx`update erp_private.audit_reports set body='{}'::jsonb where report_id=${fs1}`,/cannot be edited/);
 // Review rules: the financial statements are a Partner decision; the preparer cannot review.
 await rsubmit('ASSISTANT',fs1);
 await assert.rejects(()=>rreview('MANAGER',fs1),/Only a Partner approves/);
 await assert.rejects(()=>rreview('SUPERVISOR',fs1),/Manager or Partner reviews/);
 await assert.rejects(()=>rreview('PARTNER',fs1,'Approve','short'),/at least 10 characters/);
 await rreview('PARTNER',fs1);
 assert.equal((await rstat())['Financial statements'].current,true);
 await assert.rejects(()=>tx`update erp_private.audit_reports set status='Draft' where report_id=${fs1}`,/superseded/);
 // An approved adjusting entry makes the approved statements out of date.
 await adj('Accrue the audit fee for the year',J('exp','pay',50000),'Engagement letter dated January');
 assert.equal((await rstat())['Financial statements'].current,false);
 const fs2=await draft('SUPERVISOR','Financial statements');
 b=(await tx`select body from erp_private.audit_reports where report_id=${fs2}`)[0].body;assert.equal(Number(b.totals.profit_for_the_year),950000);assert.equal(Number(b.totals.total_liabilities),1050000);assert.equal(b.balances,true);
 // The earlier draft is untouched because it was already approved; a new submission is needed.
 await rsubmit('SUPERVISOR',fs2);await rreview('PARTNER2',fs2);
 const st=await rstat();assert.equal(st['Financial statements'].current,true);assert.equal(st['Financial statements'].approved_version,2);
 assert.equal((await tx`select status from erp_private.audit_reports where report_id=${fs1}`)[0].status,'Superseded');
 // A report is also stale if the figures change between draft and submission.
 const fs3=await draft('SUPERVISOR','Financial statements');
 await adj('Correct a sales cut-off error found',J('cash','rev',7000),'Cut-off test on invoices');
 await assert.rejects(()=>rsubmit('SUPERVISOR',fs3),/have changed/);
 const fs4=await draft('SUPERVISOR','Financial statements');
 assert.equal((await tx`select status from erp_private.audit_reports where report_id=${fs3}`)[0].status,'Superseded');
 await rsubmit('SUPERVISOR',fs4);await rreview('PARTNER2',fs4);
 // Management letter: suggested points come from the file, each once, and every point must be decided.
 await assert.rejects(()=>as('INTERN',()=>tx`select erp_private.audit_mgmt_points_suggest(${FILE}::uuid)`),/Not allowed/);
 assert.equal((await as('SUPERVISOR',()=>tx`select erp_private.audit_mgmt_points_suggest(${FILE}::uuid) n`))[0].n,2);
 assert.equal((await as('SUPERVISOR',()=>tx`select erp_private.audit_mgmt_points_suggest(${FILE}::uuid) n`))[0].n,0,'suggesting twice adds nothing');
 const pts=await tx`select point_id,point_ref,title,status from erp_private.audit_management_points order by point_seq`;assert.deepEqual(pts.map(p=>[p.point_ref,p.status]),[['MP-001','Open'],['MP-002','Open']]);
 const manual=await as('ASSISTANT',()=>tx`select erp_private.audit_mgmt_point_save(${FILE}::uuid,${null}::uuid,'Fixed asset register not kept','No register of fixed assets was available at the year end.','Depreciation cannot be checked.','Keep a register and reconcile it yearly.','High','Management agrees') id`).then(r=>r[0].id);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.audit_mgmt_point_decide(${manual}::uuid,'Include','')`),/Manager or Partner decides/);
 await assert.rejects(()=>draft('SUPERVISOR','Management letter'),/Decide every management-letter point/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_mgmt_point_decide(${pts[0].point_id}::uuid,'Drop','short')`),/why the point is dropped/);
 await as('MANAGER',()=>tx`select erp_private.audit_mgmt_point_decide(${pts[0].point_id}::uuid,'Drop','Trivial and corrected before the draft accounts were issued')`);
 await as('MANAGER',()=>tx`select erp_private.audit_mgmt_point_decide(${pts[1].point_id}::uuid,'Include','')`);
 await as('MANAGER',()=>tx`select erp_private.audit_mgmt_point_decide(${manual}::uuid,'Include','')`);
 // File gate: nothing is approved yet except the statements. Planning and lead gates are covered by their own tests.
 await db.exec(`alter table erp_private.audit_files disable trigger planning_guard;alter table erp_private.audit_files disable trigger lead_guard`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await db.exec(`alter table erp_private.audit_workpapers disable trigger all`);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/Approve a current version of: management letter, representation letter, completion memorandum/);
 const ml=await draft('SUPERVISOR','Management letter');
 b=(await tx`select body from erp_private.audit_reports where report_id=${ml}`)[0].body;assert.equal(b.points.length,2);assert.equal(b.points[0].rating,'High','High-rated points come first');
 // The representation letter needs the person signing for management.
 await assert.rejects(()=>draft('SUPERVISOR','Representation letter',{signatory_name:'A'}),/name and title/);
 const rl=await draft('SUPERVISOR','Representation letter',{signatory_name:'Jane Wanjiru',signatory_title:'Finance Director',letter_date:'2026-03-31'});
 b=(await tx`select body from erp_private.audit_reports where report_id=${rl}`)[0].body;assert.equal(b.signatory_name,'Jane Wanjiru');assert.match(b.paragraphs[0],/IFRS for SMEs/);assert.match(b.paragraphs.at(-1),/not aware of any uncorrected misstatements/);
 const cm=await draft('SUPERVISOR','Completion memorandum',{overall_conclusion:'Opinion to follow the Partner review'});
 b=(await tx`select body from erp_private.audit_reports where report_id=${cm}`)[0].body;assert.equal(b.audit_adjustments.approved,2);assert.equal(Number(b.audit_adjustments.net_profit_effect),-43000);assert.equal(b.lead_schedules.length,0+b.lead_schedules.length);assert.ok(Array.isArray(b.flagged_matters));assert.equal(b.overall_conclusion,'Opinion to follow the Partner review');
 for(const [i,role] of [[ml,'MANAGER'],[rl,'PARTNER'],[cm,'MANAGER2']]){await rsubmit('SUPERVISOR',i);await rreview(role,i);}
 // Changing a point after the letter was approved makes the letter out of date.
 await as('ASSISTANT',()=>tx`select erp_private.audit_mgmt_point_save(${FILE}::uuid,${manual}::uuid,'Fixed asset register not kept','No register of fixed assets was available at year end.','Depreciation cannot be checked.','Keep a register and reconcile it yearly.','High','Management agrees') id`);
 assert.equal((await rstat())['Management letter'].current,false);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/management letter/);
 const ml2=await draft('SUPERVISOR','Management letter');await rsubmit('SUPERVISOR',ml2);await rreview('MANAGER',ml2);
 // An open point blocks approval even if the reports are current.
 const late=await as('ASSISTANT',()=>tx`select erp_private.audit_mgmt_point_save(${FILE}::uuid,${null}::uuid,'Late payroll filing','Payroll returns were filed after the due date twice.','Penalties.','File on time.','Medium','') id`).then(r=>r[0].id);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/Decide every management-letter point/);
 await as('MANAGER',()=>tx`select erp_private.audit_mgmt_point_decide(${late}::uuid,'Drop','Immaterial and already penalised and paid by client')`);
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 assert.equal((await tx`select file_status from erp_private.audit_files where audit_file_id=${FILE}`)[0].file_status,'Approved');
 await assert.rejects(()=>draft('SUPERVISOR','Financial statements'),/closed to new report versions/);
});
