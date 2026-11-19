import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {purchaseAccountsAction}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-actions.ts');
const {taxAction}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {summariseRows}=await import('../supabase/functions/staff-workspace-v12/purchase-accounts-rules.mjs');
const {summaryFingerprint,gateApplies,gateIssue}=await import('../supabase/functions/staff-workspace-v12/upload-summary-gate-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const sum=(role,p={})=>as(role,a=>purchaseAccountsAction(tx,a,{project_id:P,action:'purchase_accounts_summary',...p}));
const submit=(role,CASE)=>as(role,async a=>taxAction(tx,a,{action:'tax_submit',case_id:CASE,revision:(await tx`select revision from erp_private.tax_cases where case_id=${CASE}`)[0].revision}));

test('the gate rules: fingerprint, which cases are held, and the message',()=>{
 const s=summariseRows([{route:2,account_code:'61000',amount:100},{account_code:null,note_code:'NO_CODES',amount:5}]);
 const f=summaryFingerprint(s);assert.match(f,/^rows:2\|net:10500\|m2:1:10000\|dNO_CODES:1:500$/);
 assert.equal(summaryFingerprint(summariseRows([{route:2,account_code:'61000',amount:100}])),'rows:1|net:10000|m2:1:10000');
 assert.notEqual(f,summaryFingerprint(summariseRows([{route:2,account_code:'61000',amount:100},{account_code:null,note_code:'NO_CODES',amount:6}])));
 assert.equal(gateApplies('VAT',3),true);assert.equal(gateApplies('VAT',0),false);assert.equal(gateApplies('PAYE',3),false);
 assert.equal(gateIssue({kind:'PAYE',costRowsInPeriod:5,fingerprint:'x',views:[]}),null);
 assert.equal(gateIssue({kind:'VAT',costRowsInPeriod:0,fingerprint:'x',views:[]}),null);
 assert.equal(gateIssue({kind:'VAT',costRowsInPeriod:5,fingerprint:'x',views:[{fingerprint:'x'}]}),null);
 assert.match(gateIssue({kind:'VAT',costRowsInPeriod:5,fingerprint:'x',views:[]}),/Open "Summary of this upload"/);
 assert.match(gateIssue({kind:'VAT',costRowsInPeriod:5,fingerprint:'y',views:[{fingerprint:'x'}]}),/changed since you last opened/);
});

test('a case cannot be sent for review until its preparer has opened the current summary',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MGQA','Fictional groups firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Groups',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional groups project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-01-01','2026-01-31','{}',8,8,0,0,${actors.ASSISTANT.staff_id})`;
 let n=0;const mk=(key,extra={})=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${++n},${'GT-'+key},'{}',${tx.json({date:'2026-01-10',amount:1000,vat:160,invoice:'GT-'+key,party:'Fictional supplier',party_pin:'P000000001A',description:'Fictional '+key,vat_category:'16%',...extra})}) returning row_id`;
 await mk('A');await mk('B');
 const CASE=id(),CASE_PAYE=id(),CASE_OUT=id();
 await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by) values(${CASE},${P},'VAT','2026-01-01','2026-01-31',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by) values(${CASE_OUT},${P},'VAT','2026-06-01','2026-06-30',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by) values(${CASE_PAYE},${P},'PAYE','2026-01-01','2026-01-31',${actors.ASSISTANT.staff_id})`;

 // 1. No view yet: refused, naming where to go. This is the server, not the screen.
 await assert.rejects(submit('ASSISTANT',CASE),/Open "Summary of this upload"/);
 // 2. Someone else opening the summary does not count for the preparer.
 const mgr=await sum('MANAGER');assert.equal(mgr.draft_rows,2);assert.ok(mgr.viewed_at);
 await assert.rejects(submit('ASSISTANT',CASE),/Open "Summary of this upload"/);
 // 3. A case whose period holds no cost rows, and a PAYE case, are not held by the gate (they may stop for other reasons, never for this one).
 for(const c of [CASE_OUT,CASE_PAYE])await assert.rejects(submit('ASSISTANT',c),e=>!/Summary of this upload/.test(e.message));
 // 4. The preparer opens the summary: the view is recorded with who and what it showed, and the gate no longer stops the case.
 const mine=await sum('ASSISTANT');assert.equal(mine.draft_rows,2);assert.ok(mine.viewed_at);
 const rec=await tx`select viewed_by,fingerprint,mapped_rows,draft_rows from erp_private.upload_summary_views where project_id=${P} and viewed_by=${actors.ASSISTANT.staff_id}`;
 assert.equal(rec.length,1);assert.equal(rec[0].draft_rows,2);assert.equal(rec[0].fingerprint,'rows:2|net:200000|dNOT_ATTEMPTED:2:200000');
 await assert.rejects(submit('ASSISTANT',CASE),e=>!/Summary of this upload/.test(e.message));
 // 5. Opening an unchanged summary again records nothing new.
 await sum('ASSISTANT');assert.equal((await tx`select count(*)::int n from erp_private.upload_summary_views where viewed_by=${actors.ASSISTANT.staff_id}`)[0].n,1);
 // 6. The upload changes (a row is added): the earlier view no longer counts, and the message says so.
 await mk('C');
 await assert.rejects(submit('ASSISTANT',CASE),/changed since you last opened/);
 await sum('ASSISTANT');
 await assert.rejects(submit('ASSISTANT',CASE),e=>!/Summary of this upload|changed since/.test(e.message));
 assert.equal((await tx`select count(*)::int n from erp_private.upload_summary_views where viewed_by=${actors.ASSISTANT.staff_id}`)[0].n,2);
 // 7. A recorded view is insert-only and an intern cannot open the summary.
 await assert.rejects(tx`update erp_private.upload_summary_views set fingerprint='x'`,/cannot be changed/);
 await assert.rejects(tx`delete from erp_private.upload_summary_views`);
 actors.INTERN={...actors.ASSISTANT,category_code:'INTERN'};
 await assert.rejects(as('INTERN',a=>purchaseAccountsAction(tx,a,{project_id:P,action:'purchase_accounts_summary'})),/Assigned accounting staff/);
 // 8. Every view left an audit record.
 assert.ok((await tx`select count(*)::int n from erp_private.audit_events where table_name='upload_summary_views'`)[0].n>=3);
});

test('the server wires the gate into the summary read and into tax_submit, and the migration keeps the record insert-only',()=>{
 const rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fn='supabase/functions/staff-workspace-v12/';
 assert.match(rd(fn+'purchase-accounts-actions.ts'),/recordSummaryView\(tx,a,project,summary\)/);
 const tax=rd(fn+'tax-review-actions.ts');assert.match(tax,/await assertSummaryViewed\(tx,c\)/);
 assert.ok(tax.indexOf('await assertSummaryViewed(tx,c)')<tax.indexOf("await takeSnapshot(tx,a,c,s,'SUBMITTED')"));
 const mig=rd('supabase/migrations/20261203100000_upload_summary_views.sql');assert.match(mig,/FORCE ROW LEVEL SECURITY/);assert.match(mig,/GRANT SELECT,INSERT ON/);assert.match(mig,/reject_delete/);
});
