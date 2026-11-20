// Audit build C: lead schedules built from the mapped trial balance, tie-out and the approval gates.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {parseBalance,tieTone,createLeadsUI} from '../staff-audit-leads.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('balance parsing and tones',()=>{
 assert.equal(parseBalance('1,250.50'),1250.5);assert.equal(parseBalance('(1,000)'),-1000);assert.equal(parseBalance('-5'),-5);assert.equal(parseBalance(''),null);assert.equal(parseBalance('abc'),null);
 assert.equal(tieTone('Ties'),'ok');assert.equal(tieTone('Difference'),'warn');assert.equal(tieTone('Not stated'),'warn');assert.equal(tieTone('Reconciled with note'),'');
});
test('screen by role',()=>{
 let me={staff_id:'a1',category_code:'ASSISTANT'};
 const area=(lead)=>({audit_area:'Cash and bank',accounts:1,active:true,tb_net:'100',adjustment_net:'-10',adjusted_net:'90',detail:[{account_code:'1000',account_name:'Cash <b>',tb_net:'100',adjustment_net:'-10',adjusted_net:'90'}],lead});
 const snap={file:{file_status:'Prepared'},workpapers:[{audit_workpaper_id:'w1',prepared_by:'a1'}],lead_schedule:[area(null)]};
 const ui=()=>createLeadsUI({esc,field:()=>'',form:x=>x,modal(){},request(){},notice(){},data:()=>({me}),snapshot:()=>snap,refresh(){}});
 let html=ui().panel(snap.file,snap);
 assert.match(html,/data-audit-lead-create="Cash and bank"/);assert.match(html,/No lead schedule/);assert.match(html,/Cash &lt;b&gt;/);
 snap.lead_schedule=[area({audit_workpaper_id:'w1',workpaper_ref:'LS-01',status:'Draft',supported_balance:'80',reconciling_note:'',tie:'Difference',difference:'-10'})];
 html=ui().panel(snap.file,snap);assert.match(html,/data-audit-lead-tie="w1"/);assert.match(html,/difference \(10\.00\)/);assert.doesNotMatch(html,/data-audit-lead-create/);
 me={staff_id:'a2',category_code:'ASSISTANT'};html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-lead-tie/,'only the preparer or a Supervisor and above records the tie-out');
 me={staff_id:'s1',category_code:'SUPERVISOR'};html=ui().panel(snap.file,snap);assert.match(html,/data-audit-lead-tie="w1"/);
 me={staff_id:'i1',category_code:'INTERN'};snap.lead_schedule=[area(null)];html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-lead-create/);
 me={staff_id:'p1',category_code:'PARTNER'};snap.file.file_status='Approved';html=ui().panel(snap.file,snap);assert.doesNotMatch(html,/data-audit-lead-create/);
});
test('wiring',()=>{
 assert.match(rd(fx+'audit-actions.ts'),/audit_lead_tieout_save/);assert.match(rd(fx+'audit-actions.ts'),/lead_schedule/);assert.match(rd('staff-audit.mjs'),/leads\.handle\(b/);assert.match(rd('staff-audit.mjs'),/'Lead schedules'/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('lead schedules from the mapped TB, tie-out and gates are enforced by the database',async t=>{
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
 const area=async()=>JSON.parse(JSON.stringify((await as('MANAGER',()=>tx`select erp_private.audit_lead_schedule(${FILE}::uuid) s`))[0].s));
 let sch=await area();
 assert.deepEqual(sch.map(a=>[a.audit_area,Number(a.adjusted_net),a.active]),[['Cash and bank',2000000,true],['Revenue',-1000000,true],['Trade payables',-1000000,true]]);
 assert.ok(sch.every(a=>a.lead==null));
 assert.equal((await as('INTERN',()=>tx`select erp_private.audit_lead_schedule(${FILE}::uuid) s`))[0].s.length,0,'Interns see nothing');
 // Creating: roles, unknown areas and idempotence.
 await assert.rejects(()=>as('INTERN',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Cash and bank')`),/Not allowed/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Inventory')`),/No mapped trial-balance accounts/);
 const cash=await as('ASSISTANT',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Cash and bank') id`).then(r=>r[0].id);
 assert.equal((await as('ASSISTANT',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Cash and bank') id`))[0].id,cash,'a second call returns the same lead');
 const w=(await tx`select workpaper_ref,is_lead,status from erp_private.audit_workpapers where audit_workpaper_id=${cash}`)[0];
 assert.deepEqual([w.workpaper_ref,w.is_lead,w.status],['LS-01',true,'Draft']);
 // File gate: review needs a lead schedule for every active area.
 await db.exec(`alter table erp_private.audit_files disable trigger planning_guard`);
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/Missing: Revenue, Trade payables/);
 const rev=await as('SUPERVISOR',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Revenue') id`).then(r=>r[0].id);
 const pay=await as('SUPERVISOR',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Trade payables') id`).then(r=>r[0].id);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await tx`update erp_private.audit_files set file_status='Returned' where audit_file_id=${FILE}`;
 // Tie-out roles and the approval gate.
 const tie=(role,i,v,n='')=>as(role,()=>tx`select erp_private.audit_lead_tieout_save(${i}::uuid,${v}::numeric,${n})`);
 const approve=i=>tx`update erp_private.audit_workpapers set status='Approved',submitted_at=coalesce(submitted_at,now()),reviewer_id=${actors.MANAGER.staff_id},reviewed_at=now() where audit_workpaper_id=${i}`;
 await assert.rejects(()=>tie('INTERN',cash,2000000),/unavailable/);
 await assert.rejects(()=>tie('ASSISTANT',rev,-1000000),/Only the preparer or a Supervisor/);
 await assert.rejects(()=>tie('ASSISTANT',cash,null),/Enter the balance/);
 await assert.rejects(()=>approve(cash),/Record the balance this lead schedule supports/,'not stated');
 await tie('ASSISTANT',cash,1990000);
 await assert.rejects(()=>approve(cash),/differs from the adjusted trial balance/,'difference without a note');
 await tie('ASSISTANT',cash,1990000,'Too short');
 await assert.rejects(()=>approve(cash),/differs/,'a short note does not count');
 await tie('ASSISTANT',cash,1990000,'Bank statement shows 10,000 of cheques not yet presented at year end');
 sch=await area();const lc=sch.find(a=>a.audit_area==='Cash and bank').lead;assert.equal(lc.tie,'Reconciled with note');assert.equal(Number(lc.difference),-10000);
 await approve(cash);
 // An exact tie needs no note.
 await tie('SUPERVISOR',rev,-1000000);assert.equal((await area()).find(a=>a.audit_area==='Revenue').lead.tie,'Ties');await approve(rev);
 // The tie-out is locked once approved.
 await assert.rejects(()=>tie('SUPERVISOR',rev,-999),/draft or returned/);
 await assert.rejects(()=>tx`update erp_private.audit_workpapers set supported_balance=1 where audit_workpaper_id=${rev}`,/cannot change after/);
 // An approved adjusting entry moves the adjusted balance, so the lead no longer ties and cannot be approved.
 const J=(a,b,d)=>[{audit_account_id:acct[a],debit:d,credit:0},{audit_account_id:acct[b],debit:0,credit:d}];
 const adj=async(d,lines,basis)=>{const e=await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_save(${FILE}::uuid,${null}::uuid,'Adjusting',${d},${basis},${null},'',${null}::uuid,${JSON.stringify(lines)}::jsonb) id`).then(r=>r[0].id);await as('ASSISTANT',()=>tx`select erp_private.audit_adjustment_submit(${e}::uuid)`);await as('MANAGER',()=>tx`select erp_private.audit_adjustment_review(${e}::uuid,'Approve','Agreed to the supporting evidence')`);};
 await tie('SUPERVISOR',pay,-1000000);
 await adj('Accrue the audit fee for the year',J('exp','pay',50000),'Engagement letter dated January');
 const lp=(await area()).find(a=>a.audit_area==='Trade payables').lead;assert.equal(lp.tie,'Difference');assert.equal(Number(lp.difference),50000);
 await assert.rejects(()=>approve(pay),/differs/);
 await tie('SUPERVISOR',pay,-1050000);await approve(pay);
 // The new expense balance is a new active area. The file cannot go to review without a lead for it.
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`,/Missing: Payroll and expenses/);
 const exp=await as('ASSISTANT',()=>tx`select erp_private.audit_lead_create(${FILE}::uuid,'Payroll and expenses') id`).then(r=>r[0].id);
 await tie('ASSISTANT',exp,50000);await approve(exp);
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 // A later adjustment makes an approved lead stale; the file cannot be approved until the lead is dealt with.
 await adj('Correct a sales cut-off error found',J('cash','rev',7000),'Cut-off test on invoices');
 await assert.rejects(()=>tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`,/no longer tie to the adjusted trial balance: Revenue/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_workpapers where is_lead`)[0].n,4);
});
