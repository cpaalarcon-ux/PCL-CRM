// Audit build B: adjusting entries, unadjusted misstatements, adjusted trial balance and the file gates.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {collectLines,entryBalance,createAdjustmentsUI} from '../staff-audit-adjustments.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('form lines and balance helpers',()=>{
 const lines=collectLines({acct_1:'a',debit_1:'1,000',acct_2:'b',credit_2:'1000',acct_3:'',debit_3:'',memo_4:'only a note'});
 assert.equal(lines.length,3);assert.deepEqual(entryBalance(lines.slice(0,2)),{debit:1000,credit:1000,balanced:true});
 assert.equal(entryBalance([{debit:'5',credit:''},{debit:'',credit:'4'}]).balanced,false);assert.equal(entryBalance([]).balanced,false);
});
test('screen by role',()=>{
 let me={staff_id:'m2',category_code:'MANAGER'};
 const snap={file:{file_status:'Prepared'},adjustments:[{adjustment_id:'e1',adj_ref:'AJ-001',kind:'Adjusting',description:'Accrue audit fee <i>',basis:'Engagement letter',status:'Submitted',prepared_by:'a1',prepared_by_name:'Asha',profit_effect:'-5000',net_assets_effect:'-5000'},{adjustment_id:'e2',adj_ref:'UM-001',kind:'Unadjusted',misstatement_type:'Factual',description:'Cut-off error',basis:'Test of sales',status:'Draft',prepared_by:'m2',profit_effect:'1000',net_assets_effect:'1000'}],adjustment_lines:[],adjusted_tb:[{account_code:'1000',account_name:'Cash',audit_area:'Cash and bank',financial_statement_line:'Assets',tb_net:'100',adjustment_net:'-100',adjusted_net:'0'}],
  misstatements:{items:[],gross_profit_effect:600000,net_profit_effect:600000,overall_materiality:500000,performance_materiality:375000,clearly_trivial:25000,exceeds_overall:true,exceeds_performance:true,conclusion:null},planning_gate:{materiality_approved:true}};
 const ui=()=>createAdjustmentsUI({esc,field:()=>'',select:()=>'',form:x=>x,modal(){},request(){},notice(){},shortDate:String,data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-adj-review="e1"/,'a Manager reviews what an Assistant prepared');assert.match(html,/data-audit-adj-submit="e2"/);assert.doesNotMatch(html,/data-audit-adj-review="e2"/);assert.match(html,/Accrue audit fee &lt;i&gt;/);assert.match(html,/Exceeded/);assert.match(html,/must record a current conclusion/);assert.doesNotMatch(html,/data-audit-ms-conclude/,'only a Partner concludes');
 me={staff_id:'a1',category_code:'ASSISTANT'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-adj-new/);assert.doesNotMatch(html,/data-audit-adj-review/);assert.match(html,/Waiting for a different reviewer/);
 me={staff_id:'p1',category_code:'PARTNER'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-ms-conclude/);
 me={staff_id:'i1',category_code:'INTERN'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-adj-new/);
 snap.file.file_status='Archived';me={staff_id:'p1',category_code:'PARTNER'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-adj-new|data-audit-adj-submit|data-audit-ms-conclude/);
});
test('wiring',()=>{
 assert.match(rd(fx+'audit-actions.ts'),/audit_adjustment_review/);assert.match(rd(fx+'audit-actions.ts'),/audit_misstatement_conclude/);assert.match(rd('staff-audit.mjs'),/adjustments\.handle\(b/);assert.match(rd('staff-audit.mjs'),/'Adjustments'/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('entries, schedule, adjusted TB and gates are enforced by the database',async t=>{
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
 // Creating: roles and line rules.
 await assert.rejects(()=>save('INTERN'),/Not allowed/);
 await assert.rejects(()=>save('ASSISTANT',{lines:[{audit_account_id:acct.exp,debit:100,credit:0}]}),/between 2 and 40 lines/);
 await assert.rejects(()=>save('ASSISTANT',{lines:[{audit_account_id:acct.exp,debit:100,credit:100},{audit_account_id:acct.pay,debit:0,credit:100}]}),/either a debit or a credit/);
 await assert.rejects(()=>save('ASSISTANT',{kind:'Unadjusted'}),/factual, judgmental or projected/);
 const e1=await save('ASSISTANT');
 assert.equal((await tx`select adj_ref,status from erp_private.audit_adjustments where adjustment_id=${e1}`)[0].adj_ref,'AJ-001');
 // An unbalanced entry can be drafted but not submitted.
 const bad=await save('ASSISTANT',{lines:[{audit_account_id:acct.exp,debit:100,credit:0},{audit_account_id:acct.pay,debit:0,credit:90}],d:'An unbalanced draft entry'});
 await assert.rejects(()=>submit('ASSISTANT',bad),/must balance/);
 await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_withdraw(${bad}::uuid,'Drafted by mistake, not needed')`);
 // Submit and review: the preparer cannot review; an Assistant and Supervisor cannot either.
 await submit('ASSISTANT',e1);
 assert.ok((await tx`select 1 from erp_private.notifications where event_key like ${'audit-entry:'+e1+'%'}`).length>=1);
 await assert.rejects(()=>review('SUPERVISOR',e1),/Manager or Partner reviews/);
 await assert.rejects(()=>review('MANAGER',e1,'Approve','short'),/at least 10 characters/);
 await as('ASSISTANT',()=>tx`update erp_private.audit_adjustments set status='Approved' where adjustment_id=${e1}`).catch(()=>{});
 assert.equal((await tx`select status from erp_private.audit_adjustments where adjustment_id=${e1}`)[0].status,'Submitted','RLS stops a direct approval');
 // A Manager who prepared an entry cannot review it.
 const own=await save('MANAGER',{d:'Manager prepared an entry for tax',lines:J('tax','pay',10000)});await submit('MANAGER',own);
 await assert.rejects(()=>review('MANAGER',own),/cannot review an entry you prepared/);
 await review('MANAGER2',own,'Return','Tax should use the statutory rate');
 assert.equal((await tx`select status from erp_private.audit_adjustments where adjustment_id=${own}`)[0].status,'Returned');
 await as('MANAGER',()=>tx`select erp_private.audit_adjustment_withdraw(${own}::uuid,'Superseded by a new computation')`);
 await review('MANAGER',e1);
 const ap=(await tx`select status,reviewer_id from erp_private.audit_adjustments where adjustment_id=${e1}`)[0];assert.deepEqual([ap.status,ap.reviewer_id],['Approved',actors.MANAGER.staff_id]);
 // Approved entries are locked, lines included.
 await assert.rejects(()=>tx`update erp_private.audit_adjustments set description='Changed after approval ok' where adjustment_id=${e1}`,/cannot be changed/);
 await assert.rejects(()=>tx`update erp_private.audit_adjustment_lines set debit=1 where adjustment_id=${e1} and line_no=1`,/draft or returned/);
 await assert.rejects(()=>tx`delete from erp_private.audit_adjustment_lines where adjustment_id=${e1}`,/draft or returned/);
 await assert.rejects(()=>save('ASSISTANT',{id:e1}),/Only a draft or returned/);
 // Adjusted trial balance: cash 2m Dr, payables 1m Cr, sales 1m Cr, plus the accrual Dr 50k expense, Cr 50k payables.
 const tb=await as('MANAGER',()=>tx`select account_code,tb_net,adjustment_net,adjusted_net from erp_private.audit_adjusted_tb(${FILE}::uuid) order by account_code`);
 assert.deepEqual(tb.map(r=>[r.account_code,Number(r.tb_net),Number(r.adjustment_net),Number(r.adjusted_net)]),[['1000',2000000,0,2000000],['2000',-1000000,-50000,-1050000],['4000',-1000000,0,-1000000],['6000',0,50000,50000]]);
 assert.equal((await as('INTERN',()=>tx`select * from erp_private.audit_adjusted_tb(${FILE}::uuid)`)).length,0,'Interns see nothing');
 // Unadjusted misstatements need materiality for comparison. Prepare and approve it first.
 const mat=await as('SUPERVISOR',()=>tx`select erp_private.audit_materiality_save(${FILE}::uuid,'Revenue','',1000000::numeric,5::numeric,75::numeric,5::numeric,'Revenue is the stable benchmark users focus on here') id`).then(r=>r[0].id);
 await as('PARTNER',()=>tx`select erp_private.audit_materiality_approve(${mat}::uuid)`);
 // overall 50,000; performance 37,500; trivial 2,500.
 const trivial=await save('SUPERVISOR',{kind:'Unadjusted',type:'Factual',resp:'Management will not correct it',d:'Small rounding error in sales',lines:J('cash','rev',2000)});await submit('SUPERVISOR',trivial);await review('MANAGER',trivial);
 const big=await save('SUPERVISOR',{kind:'Unadjusted',type:'Judgmental',resp:'Management disagrees with the estimate',d:'Sales cut-off error at year end',lines:J('cash','rev',60000)});
 await assert.rejects(()=>save('SUPERVISOR',{kind:'Unadjusted',type:'Factual',resp:'',d:'No response from management yet',lines:J('cash','rev',100)}).then(i=>submit('SUPERVISOR',i)),/Record management's response/);
 await submit('SUPERVISOR',big);
 let ms=(await as('MANAGER',()=>tx`select erp_private.audit_misstatement_schedule(${FILE}::uuid) s`))[0].s;
 assert.equal(ms.items.length,2);assert.equal(Number(ms.gross_profit_effect),0,'only approved, non-trivial items accumulate');
 await review('MANAGER2',big);
 ms=(await as('MANAGER',()=>tx`select erp_private.audit_misstatement_schedule(${FILE}::uuid) s`))[0].s;
 assert.equal(Number(ms.gross_profit_effect),60000);assert.equal(ms.exceeds_overall,true);assert.equal(ms.exceeds_performance,true);
 assert.equal(ms.items.find(i=>/rounding/.test(i.description)).trivial,true);assert.equal(ms.items.find(i=>/cut-off error at year end/.test(i.description)).trivial,false);assert.ok(ms.items.every(i=>/^UM-/.test(i.adj_ref)));
 // The unadjusted entries do not change the adjusted TB.
 assert.equal((await as('MANAGER',()=>tx`select adjustment_net from erp_private.audit_adjusted_tb(${FILE}::uuid) where account_code='4000'`))[0].adjustment_net,'0');
 // File gates. A draft entry blocks review; an entry waiting for review blocks approval; exceeded materiality needs a current Partner conclusion.
 // The unsubmitted draft left by the missing-response check above also blocks review until it is dealt with.
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/draft and returned audit entry/);
 await tx`update erp_private.audit_adjustments set status='Withdrawn',review_note='Cleaned up after the check' where status='Draft'`;
 const draft=await save('ASSISTANT',{d:'Late draft entry for depreciation'});
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/draft and returned audit entry/);
 await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_withdraw(${draft}::uuid,'Not needed after all discussion')`);
 // Approval gate (planning gates are tested elsewhere, so set the file to In Review directly).
 await db.exec(`alter table erp_private.audit_files disable trigger planning_guard;alter table erp_private.audit_files disable trigger lead_guard;alter table erp_private.audit_files disable trigger report_guard`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/exceed overall materiality/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_misstatement_conclude(${FILE}::uuid,'A conclusion that is long enough to pass the limit')`),/Only a Partner/);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.audit_misstatement_conclude(${FILE}::uuid,'too short')`),/at least 30 characters/);
 await as('PARTNER',()=>tx`select erp_private.audit_misstatement_conclude(${FILE}::uuid,'Management declined to correct; the cut-off error is isolated and I accept it with the client informed')`);
 // A new approved misstatement after the conclusion makes it stale.
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 const more=await save('SUPERVISOR',{kind:'Unadjusted',type:'Factual',resp:'Management will not correct it',d:'Another cut-off item found later',lines:J('cash','rev',9000)});await submit('SUPERVISOR',more);await review('MANAGER',more);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/current conclusion/);
 await as('PARTNER2',()=>tx`select erp_private.audit_misstatement_conclude(${FILE}::uuid,'Reviewed again with the extra item; still isolated and accepted by me')`);
 // A submitted entry must be decided before approval.
 const wait=await save('SUPERVISOR',{d:'Late accrual still waiting for review'});await submit('SUPERVISOR',wait);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/Review every submitted audit entry/);
 await review('MANAGER',wait);
 await db.exec(`alter table erp_private.audit_workpapers disable trigger all`);
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 assert.equal((await tx`select file_status from erp_private.audit_files where audit_file_id=${FILE}`)[0].file_status,'Approved');
 await assert.rejects(()=>save('SUPERVISOR',{d:'Entry after the file was approved'}),/closed to entries/);
});
