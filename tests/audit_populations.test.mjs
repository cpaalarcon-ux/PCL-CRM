// Audit build S5: populations, reconciled live to the adjusted trial balance, with gates on lead schedules and the audit file.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('populations reconcile live to the adjusted trial balance and gate the lead schedule and the file',async t=>{
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
 const J=o=>JSON.stringify(o);
 const base={audit_area:'Trade payables',title:'Supplier ledger at year end',source_system:'Fictional ERP',report_name:'Supplier balances',parameters:'All suppliers, balance as at 31 Dec 2025',as_at:'2025-12-31',report_run_on:'2026-01-20',row_count:140,control_total:'1,000,000.00',balance_nature:'Credit',reconciling_amount:'0',reconciling_note:'',ipe_check:'',evidence_document_id:DOC};
 const save=(role,data,pid=null)=>as(role,()=>tx`select erp_private.audit_population_save(${FILE}::uuid,${pid}::uuid,${J(data)}::jsonb) id`).then(r=>r[0].id);
 const list=role=>as(role,()=>tx`select erp_private.audit_population_list(${FILE}::uuid) s`).then(r=>JSON.parse(JSON.stringify(r[0].s)));
 const one=async(role,pid)=>(await list(role)).find(x=>x.population_id===pid);
 const submit=(role,pid)=>as(role,()=>tx`select erp_private.audit_population_submit(${pid}::uuid)`);
 const review=(role,pid,d,n='Agreed to the supplier statements')=>as(role,()=>tx`select erp_private.audit_population_review(${pid}::uuid,${d},${n})`);
 // ---- Policy: nothing is required until a Partner says so.
 let pol=(await as('MANAGER',()=>tx`select erp_private.audit_population_policy() p`))[0].p;
 assert.deepEqual([pol.areas,pol.confirmed],[[],false]);
 assert.equal((await as('INTERN',()=>tx`select erp_private.audit_population_policy() p`))[0].p,null);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_population_policy_save('Trade payables','Firm decision on supplier ledgers')`),/Only a Partner/);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.audit_population_policy_save('Moon base','Firm decision on supplier ledgers')`),/Unknown audit area/);
 await assert.rejects(()=>as('PARTNER',()=>tx`select erp_private.audit_population_policy_save('Trade payables','short')`),/at least 10/);
 await as('PARTNER',()=>tx`select erp_private.audit_population_policy_save('Trade payables | Property, plant and equipment | Trade payables','Firm decision on supplier ledgers')`);
 pol=(await as('MANAGER',()=>tx`select erp_private.audit_population_policy() p`))[0].p;
 assert.deepEqual(pol.areas,['Trade payables','Property, plant and equipment']);assert.equal(pol.confirmed,true);assert.equal(pol.confirmed_by_name,'Fictional PARTNER');
 await as('PARTNER',()=>tx`select erp_private.audit_population_policy_save('Trade payables','Only supplier ledgers are required this year')`);
 // ---- Saving: roles, dates, amounts and the area must have a mapped balance.
 await assert.rejects(()=>save('INTERN',base),/Not allowed/);
 await assert.rejects(()=>save('ASSISTANT',{...base,audit_area:'Inventories'}),/No mapped trial-balance accounts belong to Inventories/);
 await assert.rejects(()=>save('ASSISTANT',{...base,as_at:'2025-11-30'}),/as at the financial year end/);
 await assert.rejects(()=>save('ASSISTANT',{...base,report_run_on:'2025-12-30'}),/cannot be before the balance date/);
 await assert.rejects(()=>save('ASSISTANT',{...base,report_run_on:'2099-01-01'}),/cannot be before the balance date or in the future/);
 await assert.rejects(()=>save('ASSISTANT',{...base,control_total:'abc'}),/real dates and plain numbers/);
 await assert.rejects(()=>save('ASSISTANT',{...base,control_total:'-5'}),/positive amount/);
 await assert.rejects(()=>save('ASSISTANT',{...base,balance_nature:''}),/debit or a credit/);
 await assert.rejects(()=>save('ASSISTANT',{...base,parameters:'x'}),/Name the population/);
 await assert.rejects(()=>save('ASSISTANT',{...base,row_count:-1}),/number of rows/);
 // ---- The firm requires a population for Trade payables, so the lead schedule cannot be approved without one.
 const tie=(role,i,v,n='')=>as(role,()=>tx`select erp_private.audit_lead_tieout_save(${i}::uuid,${v}::numeric,${n})`);
 const approveLead=i=>tx`update erp_private.audit_workpapers set status='Approved',submitted_at=coalesce(submitted_at,now()),reviewer_id=${actors.MANAGER.staff_id},reviewed_at=now() where audit_workpaper_id=${i}`;
 const payLead=await as('SUPERVISOR',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Trade payables') id`).then(r=>r[0].id);
 const revLead=await as('SUPERVISOR',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Revenue') id`).then(r=>r[0].id);
 await tie('SUPERVISOR',payLead,-1000000);await tie('SUPERVISOR',revLead,-1000000);
 await assert.rejects(()=>approveLead(payLead),/firm requires an approved, reconciled population for Trade payables/);
 await approveLead(revLead);   // Revenue is not required and has no population.
 // ---- Record the population. It ties exactly, so no reconciling items are needed.
 const pop=await save('ASSISTANT',base);
 let p=await one('ASSISTANT',pop);
 assert.deepEqual([p.pop_ref,p.status,p.state,Number(p.gl_balance),Number(p.residual),p.row_count],['POP-001','Draft','Ties',1000000,0,140]);
 await assert.rejects(()=>save('ASSISTANT',{...base,title:'Second supplier listing'}),/already a population for Trade payables/);
 assert.equal((await list('INTERN')).length,0,'Interns see nothing');
 await assert.rejects(()=>approveLead(payLead),/Population POP-001 for Trade payables is not approved yet \(draft\)/);
 // Submitting needs the completeness and accuracy check, and a reconciling population.
 await assert.rejects(()=>submit('ASSISTANT',pop),/complete and accurate/);
 await save('ASSISTANT',{...base,control_total:'990,000',ipe_check:'Re-performed the report totals and agreed 25 balances to supplier statements.'},pop);
 p=await one('ASSISTANT',pop);assert.deepEqual([p.state,Number(p.residual)],['Difference',-10000]);
 await assert.rejects(()=>submit('ASSISTANT',pop),/differs from the adjusted trial balance by -10000/);
 await save('ASSISTANT',{...base,control_total:'990,000',reconciling_amount:'10,000',reconciling_note:'Short',ipe_check:'Re-performed the report totals and agreed 25 balances to supplier statements.'},pop);
 p=await one('ASSISTANT',pop);assert.equal(p.state,'Needs note');
 await assert.rejects(()=>submit('ASSISTANT',pop),/reconciling items without a note/);
 await save('ASSISTANT',{...base,control_total:'990,000',reconciling_amount:'10,000',reconciling_note:'Invoices received in January but dated December and posted in the ledger',ipe_check:'Re-performed the report totals and agreed 25 balances to supplier statements.'},pop);
 assert.equal((await one('ASSISTANT',pop)).state,'Reconciled with note');
 await assert.rejects(()=>submit('ASSISTANT2' in actors?'ASSISTANT2':'INTERN',pop),/unavailable/);
 await submit('ASSISTANT',pop);
 p=await one('MANAGER',pop);assert.equal(p.status,'Submitted');
 // Submitted means locked.
 await assert.rejects(()=>save('ASSISTANT',{...base,control_total:'1'},pop),/Only a draft or returned/);
 await assert.rejects(()=>tx`update erp_private.audit_populations set control_total=5 where population_id=${pop}`,/cannot be edited/);
 // ---- Review: not the preparer, not an Assistant, needs a note.
 await assert.rejects(()=>review('ASSISTANT',pop,'Approve'),/Manager or Partner reviews/);
 await assert.rejects(()=>review('MANAGER',pop,'Approve','short'),/at least 10/);
 await assert.rejects(()=>review('MANAGER',pop,'Maybe'),/Approve or Return/);
 await review('MANAGER',pop,'Return','Please attach the supplier statement sample');
 p=await one('ASSISTANT',pop);assert.deepEqual([p.status,p.review_note],['Returned','Please attach the supplier statement sample']);
 await save('ASSISTANT',{...base,control_total:'990,000',reconciling_amount:'10,000',reconciling_note:'Invoices received in January but dated December and posted in the ledger',ipe_check:'Re-performed the report totals and agreed 25 balances to supplier statements; sample attached.'},pop);
 await submit('ASSISTANT',pop);
 await review('MANAGER',pop,'Approve');
 p=await one('MANAGER',pop);assert.equal(p.status,'Approved');assert.equal(p.reviewer_name,'Fictional MANAGER');
 await assert.rejects(()=>tx`update erp_private.audit_populations set row_count=1 where population_id=${pop}`,/cannot be edited/,'approved data is locked');
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.audit_population_withdraw(${pop}::uuid,'No longer needed at all')`),/draft or returned/);
 // The lead schedule can now be approved.
 await approveLead(payLead);
 // ---- The trial balance moves: an approved adjusting entry changes the payables balance, so the population no longer reconciles.
 const ADJ=await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_save(${FILE}::uuid,${null}::uuid,'Adjusting','Accrue an unrecorded supplier invoice','Found in the January payments review',${null},'',${null}::uuid,${J([{audit_account_id:acct.exp,debit:'5000',credit:'0'},{audit_account_id:acct.pay,debit:'0',credit:'5000'}])}::jsonb) id`).then(r=>r[0].id);
 await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_submit(${ADJ}::uuid)`);
 await as('MANAGER',()=>tx`select erp_private.audit_adjustment_review(${ADJ}::uuid,'Approve','Agreed to the January invoice')`);
 p=await one('MANAGER',pop);assert.deepEqual([p.state,Number(p.gl_balance),Number(p.residual)],['Difference',1005000,-5000]);
 // File gates (the other file gates are switched off so only this one is under test).
 for(const g of ['planning_guard','lead_guard','report_guard','analytics_guard','adjustment_guard'])await db.exec(`alter table erp_private.audit_files disable trigger ${g}`);
 const sasra=(await tx`select tgname from pg_trigger where tgrelid='erp_private.audit_files'::regclass and not tgisinternal and tgname like 'sasra%'`);
 for(const r of sasra)await db.exec(`alter table erp_private.audit_files disable trigger ${r.tgname}`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/POP-001 for Trade payables differs from the adjusted trial balance by -5000.*Reopen it/);
 // Reopen, update the reconciling items, resubmit, approve.
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.audit_population_reopen(${pop}::uuid,'The ledger moved after approval')`),/Manager or Partner reopens/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_population_reopen(${pop}::uuid,'short')`),/at least 10/);
 await as('MANAGER',()=>tx`select erp_private.audit_population_reopen(${pop}::uuid,'The ledger moved after approval')`);
 p=await one('ASSISTANT',pop);assert.deepEqual([p.status,p.review_note],['Returned','Reopened: The ledger moved after approval']);
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 await save('ASSISTANT',{...base,control_total:'990,000',reconciling_amount:'15,000',reconciling_note:'Invoices received in January but dated December, plus the 5,000 accrual booked by the audit',ipe_check:'Re-performed the report totals and agreed 25 balances to supplier statements; sample attached.'},pop);
 // A draft population blocks the move to review.
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/Submit or withdraw every draft and returned population first \(1 open\)/);
 await submit('ASSISTANT',pop);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/Review every submitted population first \(1 waiting\)/);
 await review('MANAGER',pop,'Approve','Agreed to the updated payables balance');
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 // A closed file takes no new population and no reopen.
 await assert.rejects(()=>save('ASSISTANT',{...base,audit_area:'Revenue',title:'Sales listing for the year',balance_nature:'Credit',control_total:'1,000,000'}),/closed to populations/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_population_reopen(${pop}::uuid,'Trying after the file closed')`),/audit file is closed/);
 // ---- A required area with a balance but no approved population stops approval.
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 await as('PARTNER',()=>tx`select erp_private.audit_population_policy_save('Trade payables|Revenue','Revenue listing is now required too')`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/firm requires an approved population for: Revenue/);
 // A withdrawn population frees the area for a new one.
 const rp=await save('ASSISTANT',{...base,audit_area:'Revenue',title:'Sales listing for the year',control_total:'1,000,000'});
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_population_withdraw(${rp}::uuid,'short')`),/at least 10/);
 await as('MANAGER',()=>tx`select erp_private.audit_population_withdraw(${rp}::uuid,'Wrong report was used for this listing')`);
 assert.equal((await one('MANAGER',rp)).state,'Withdrawn');
 await assert.rejects(()=>tx`update erp_private.audit_populations set title='Changed after withdrawal' where population_id=${rp}`,/withdrawn population cannot be changed/);
 const rp2=await save('ASSISTANT',{...base,audit_area:'Revenue',title:'Sales listing, corrected',control_total:'1,000,000',ipe_check:'Re-performed the totals and agreed a sample of invoices.'});
 assert.equal((await one('ASSISTANT',rp2)).pop_ref,'POP-003');
 // Deleting never works.
 await assert.rejects(()=>tx`delete from erp_private.audit_populations where population_id=${pop}`,/./);
});
