// Audit build E: analytics on the client's posted journals, risk alerts and clearing.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {alertSummary,createAnalyticsUI} from '../staff-audit-analytics.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('summary and screen by role',()=>{
 assert.deepEqual(alertSummary([{status:'Open',severity:'High'},{status:'Open',severity:'Low'},{status:'Cleared',severity:'High'}]),{open:2,high:1,cleared:1});
 let me={staff_id:'a1',category_code:'ASSISTANT'};
 const snap={file:{audit_file_id:'f1',file_status:'Prepared'},analytics_runs:[{run_at:'2025-05-01T10:00:00Z',population_journals:80,tests:{Duplicate:{ran:true,found:1,added:1},Benford:{ran:false,reason:'Only 12 amounts'}}}],
  analytics_alerts:[{alert_id:'al1',test_kind:'Duplicate',severity:'High',title:'Possible duplicate <b>',status:'Open',detail:{}},{alert_id:'al2',test_kind:'Sequence gap',severity:'Medium',title:'Missing numbers',status:'Cleared',clear_note:'Voided at source, confirmed with client',cleared_by_name:'Mary',detail:{missing_sample:[17]}}]};
 const ui=()=>createAnalyticsUI({esc,field:()=>'',form:x=>x,modal(){},request(){},notice(){},data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-analytics-run/);assert.doesNotMatch(html,/data-audit-alert-clear/,'an Assistant runs tests but does not clear alerts');assert.match(html,/Possible duplicate &lt;b&gt;/);assert.match(html,/Only 12 amounts/);assert.match(html,/Voided at source/);
 me={staff_id:'s1',category_code:'SUPERVISOR'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-alert-clear="al1"/);assert.doesNotMatch(html,/data-audit-alert-clear="al2"/);
 me={staff_id:'i1',category_code:'INTERN'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-analytics-run|data-audit-alert-clear/);
 me={staff_id:'p1',category_code:'PARTNER'};snap.file.file_status='Approved';html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-analytics-run|data-audit-alert-clear/);
});
test('wiring',()=>{
 for(const a of ['audit_analytics_run','audit_analytic_clear'])assert.match(rd(fx+'audit-actions.ts'),new RegExp(a));
 assert.match(rd('staff-audit.mjs'),/analytics\.handle\(b/);assert.match(rd('staff-audit.mjs'),/'Analytics'/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('analytics tests, alerts and the review gate are enforced by the database',async t=>{
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

 const run=(role,prm={})=>as(role,()=>tx`select erp_private.audit_analytics_run(${FILE}::uuid,${JSON.stringify(prm)}::jsonb) id`).then(r=>r[0].id);
 const lastRun=async()=>(await tx`select * from erp_private.audit_analytic_runs order by run_at desc,run_id limit 1`)[0];
 await assert.rejects(()=>run('INTERN'),/Not allowed/);
 // No journals yet: the run is recorded and says why nothing was tested.
 await run('ASSISTANT');let r=await lastRun();assert.equal(r.population_lines,0);assert.match(r.tests.population.reason,/No posted journals/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_analytic_alerts`)[0].n,0);
 // A year of posted journals. Two kinds of fixture: sales INV-001..INV-040 with INV-017 missing, and everything else as set out below.
 const PER=id(),codes=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code limit 2`).map(x=>x.code);
 await tx`insert into erp_private.ledger_periods(period_id,project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${PER},${P},${C},${F},'2025-01-01','2025-12-31','Limited company','Fictional evidence',${M})`;
 await tx`insert into erp_private.public_holidays(holiday_date,name) values('2025-12-25','Christmas Day') on conflict do nothing`;
 for(const t of ['ledger_journals','ledger_lines'])await db.exec(`alter table erp_private.${t} disable trigger user`);
 let seq=0;
 const post=async(ref,amt,date,posted,by,kind='Sales',acct=codes)=>{const J=id();seq++;await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,description,status,generated,prepared_by,last_prepared_by,reviewed_by,posted_at) values(${J},${PER},${P},${kind},${date},${ref},'Fictional journal','Posted',false,${by},${by},${actors.MANAGER.staff_id},${posted})`;await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${J},${P},1,${acct[0]},${amt},0),(${J},${P},2,${acct[1]},0,${amt})`;return J;};
 const A=actors.ASSISTANT.staff_id,S=actors.SUPERVISOR.staff_id;
 for(let i=1;i<=40;i++){if(i===17)continue;await post('INV-'+String(i).padStart(3,'0'),5000+i*37.5,`2025-02-${String(1+(i%27)).padStart(2,'0')}`,'2025-04-01T10:00:00+03:00',A);}
 // Duplicate: same account, amount and date in two journals.
 await post('PUR-001',15000,'2025-06-10','2025-06-11T10:00:00+03:00',A,'Purchases');await post('PUR-002',15000,'2025-06-10','2025-06-11T11:00:00+03:00',A,'Purchases');
 // Round amounts: many multiples of 1,000 of 10,000 or more.
 for(let i=1;i<=12;i++)await post('PAY-'+String(i).padStart(3,'0'),10000+i*1000,'2025-07-'+String(i+1).padStart(2,'0'),'2025-07-21T09:00:00+03:00',A,'Payroll');
 // Weekend posting (Saturday 15 March 2025) and holiday posting (25 December 2025).
 await post('ADJ-001',30000.5,'2025-03-14','2025-03-15T10:00:00+03:00',A,'Adjustment');await post('ADJ-002',41000.5,'2025-12-24','2025-12-25T09:00:00+03:00',A,'Adjustment');
 // Just under a 100,000 threshold, and one journal by a person who prepared almost nothing.
 await post('PUR-003',98000.5,'2025-08-05','2025-08-06T10:00:00+03:00',S,'Purchases');
 for(const t of ['ledger_journals','ledger_lines'])await db.exec(`alter table erp_private.${t} enable trigger user`);
 const before=(await tx`select count(*)::int n from erp_private.ledger_journals`)[0].n;
 await run('ASSISTANT',{thresholds:['100000']});r=await lastRun();
 assert.equal(r.population_journals,before);assert.equal(r.population_lines,before*2);
 const kinds=(await tx`select test_kind,count(*)::int n from erp_private.audit_analytic_alerts group by 1 order by 1`).reduce((o,x)=>(o[x.test_kind]=x.n,o),{});
 assert.equal(kinds['Duplicate'],1);assert.equal(kinds['Sequence gap'],1);assert.equal(kinds['Weekend or holiday posting'],2);assert.equal(kinds['Just under threshold'],1);assert.equal(kinds['Unusual preparer'],1);assert.equal(kinds['Round amounts'],1);
 const gap=(await tx`select detail from erp_private.audit_analytic_alerts where test_kind='Sequence gap'`)[0].detail;assert.deepEqual(gap.missing_sample,[17]);assert.equal(gap.prefix,'INV-');
 const hol=(await tx`select detail from erp_private.audit_analytic_alerts where test_kind='Weekend or holiday posting' order by detail->>'posted_on'`);assert.equal(hol[0].detail.weekend,true);assert.equal(hol[1].detail.holiday,'Christmas Day');
 assert.equal((await tx`select severity from erp_private.audit_analytic_alerts where test_kind='Just under threshold'`)[0].severity,'High');
 assert.equal((await tx`select detail->>'journals' j from erp_private.audit_analytic_alerts where test_kind='Unusual preparer'`)[0].j,'1');
 assert.equal(r.tests.Benford.ran,true,'enough amounts for the Benford test');assert.ok(Number(r.tests.Benford.chi_square)>0);
 // The same data run again adds nothing; the saved parameters identify the run.
 const added=r.alerts_added;assert.ok(added>=7);
 await run('SUPERVISOR',{thresholds:['100000']});assert.equal((await lastRun()).alerts_added,0);
 assert.match(r.params_sha256,/^[a-f0-9]{64}$/);assert.deepEqual(r.params.thresholds,[100000]);
 // An alert cannot be edited. Clearing needs a Supervisor or above and a real note.
 const al=(await tx`select alert_id from erp_private.audit_analytic_alerts where test_kind='Duplicate'`)[0].alert_id;
 await assert.rejects(()=>tx`update erp_private.audit_analytic_alerts set title='Changed' where alert_id=${al}`,/cannot be edited/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.audit_analytic_clear(${al}::uuid,'Checked and it was a genuine second payment')`),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.audit_analytic_clear(${al}::uuid,'ok')`),/at least 20 characters/);
 // File gate: open alerts block review.
 await db.exec(`alter table erp_private.audit_files disable trigger planning_guard;alter table erp_private.audit_files disable trigger lead_guard`);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/Clear every analytics alert with a note first \(\d+ open\)/);
 await as('SUPERVISOR',()=>tx`select erp_private.audit_analytic_clear(${al}::uuid,'Checked to bank: two genuine payments to the same supplier')`);
 const c=(await tx`select status,cleared_by from erp_private.audit_analytic_alerts where alert_id=${al}`)[0];assert.deepEqual([c.status,c.cleared_by],['Cleared',S]);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.audit_analytic_clear(${al}::uuid,'Clearing it a second time for no reason')`),/already cleared/);
 await assert.rejects(()=>tx`update erp_private.audit_analytic_alerts set status='Open' where alert_id=${al}`,/cannot be changed/);
 for(const x of await tx`select alert_id from erp_private.audit_analytic_alerts where status='Open'`)await as('MANAGER',()=>tx`select erp_private.audit_analytic_clear(${x.alert_id}::uuid,'Reviewed the underlying records and explained to my satisfaction')`);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 // A cleared alert stays cleared when the same test finds the same item again.
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 await run('SUPERVISOR',{thresholds:['100000']});assert.equal((await tx`select count(*)::int n from erp_private.audit_analytic_alerts where status='Open'`)[0].n,0);
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`.catch(()=>{});
 await db.exec(`alter table erp_private.audit_files disable trigger report_guard`).catch(()=>{});
});
