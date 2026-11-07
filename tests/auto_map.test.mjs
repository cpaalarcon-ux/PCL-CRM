import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
import {approveChart} from './helpers/chart-and-posting.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {autoMapAction,AUTO_METHOD}=await import('../supabase/functions/staff-workspace-v12/auto-map.ts');
const {assertSupportedPeriod}=await import('../supabase/functions/staff-workspace-v12/supported-period.ts');
const {loadCrosswalk,revenueAccount}=await import('../supabase/functions/staff-workspace-v12/sales-crosswalk.ts');
const {firstSupportedStart}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p)),auto=(role,p)=>as(role,a=>autoMapAction(tx,a,{project_id:P,...p}));

test('exact routing + TB code pairs are mapped automatically; a Manager can remove them; periods start at the first supported year; sales use the crosswalk',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await approveChart(tx,{C,prepared:actors.MANAGER.staff_id,reviewed:actors.PARTNER.staff_id});
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id();await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await call('MANAGER',{action:'v3_stock_policy_add',client_id:C,activity_id:W,inventory_method:'Periodic',effective_from:'2026-01-02',count_frequency:'Monthly'});
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;
 const ppe=(await tx`select code,category_code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy order by code limit 1`)[0];
 const rows=[
  ['EXPENSE',{route:2,category_code:'EXP08',account_code:'62500',confirmed:false}],
  ['STOCK',{route:1,category_code:'STOCK',account_code:'50000',confirmed:false}],
  ['PPE',{route:3,category_code:ppe.category_code,account_code:ppe.code,confirmed:false}],
  ['PLAIN',null],
  ['MANUAL',{route:2,category_code:'EXP08',account_code:'62500',confirmed:false}]];
 for(const [n,[key,hint]] of rows.entries())await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${n+2},${'AM-'+key},'{}',${tx.json({date:'2026-09-10',amount:1000,vat:160,invoice:'AM-'+key,party:'Fictional supplier',party_pin:'P000000001A',description:'Fictional goods',vat_category:'16%',...(hint?{mapping_suggestion:hint}:{})})})`;
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'AM-'+key}`.then(r=>r[0]);

 const first=await auto('ASSISTANT',{action:'workbook_auto_map'});
 assert.equal(first.mapped,3,'expenditure, stock and manual-test rows map; PPE needs first-use details');
 assert.equal(first.left_for_staff,2,'PPE and the row without codes or history stay with staff');
 const exp=await get('EXPENSE');assert.equal(exp.account_code,'62500');assert.equal(exp.route,2);assert.equal(exp.review_details.mapping_confirmation.method,AUTO_METHOD);assert.equal(exp.review_details.mapping_confirmation.routing_code,'EXP08');
 const stock=await get('STOCK');assert.equal(stock.account_code,'50000');assert.equal(stock.review_details.activity_id,W);
 assert.equal((await get('PPE')).account_code,null,'PPE stays with staff');assert.equal((await get('PLAIN')).account_code,null);
 assert.deepEqual(exp.normalized.mapping_suggestion,{route:2,category_code:'EXP08',account_code:'62500',confirmed:false},'the uploaded codes are kept');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='AUTO_MAPPING'`)[0].n,1);
 assert.equal((await auto('ASSISTANT',{action:'workbook_auto_map'})).mapped,0,'running it again changes nothing');

 // Remove: Manager or Partner, with a reason; the row is never mapped automatically again.
 const ids=[exp.row_id];
 await assert.rejects(()=>auto('ASSISTANT',{action:'workbook_mapping_remove',row_ids:ids,reason:'Wrong account for this supplier'}),/Only a Manager or Partner/);
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_mapping_remove',row_ids:ids,reason:'short'}),/reason/);
 assert.equal((await auto('MANAGER',{action:'workbook_mapping_remove',row_ids:ids,reason:'Bank fees were really a loan charge'})).removed,1);
 const gone=await get('EXPENSE');assert.equal(gone.account_code,null);assert.equal(gone.route,null);assert.equal(gone.review_details.auto_map_blocked,true);assert.equal(gone.review_details.mapping_confirmation,undefined);
 assert.equal(gone.review_details.mapping_history.length,1);assert.equal(gone.review_details.mapping_history[0].reason,'Bank fees were really a loan charge');assert.equal(gone.review_details.mapping_history[0].previous.account_code,'62500');
 assert.equal(gone.normalized.mapping_suggestion.account_code,'62500','the original upload is retained');
 assert.equal((await auto('MANAGER',{action:'workbook_auto_map'})).mapped,0,'a removed row is not mapped again');
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='MAPPING_REMOVED'`)[0].n,1);
 // A mapping made by staff in the mapping screen is corrected there, not removed here.
 const manual=await get('MANUAL');await auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[manual.row_id],reason:'Remove then map by hand instead'});
 const again=await get('MANUAL');await map('ASSISTANT',{action:'workbook_map',project_id:P,row_id:again.row_id,revision:again.revision,route:2,account_code:'62500'});
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[again.row_id],reason:'Try removing a hand mapping'}),/mapped by staff/);
 // A submitted period is not frozen: removing a mapping cancels the review and returns the case to its preparer.
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by) values(${P},'VAT','2026-09-01','2026-09-30','Submitted',${actors.ASSISTANT.staff_id})`;
 const back=await auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[stock.row_id],reason:'Period is already submitted'});
 assert.equal(back.removed,1);assert.equal(back.returned_cases,1);
 const vatCase=(await tx`select status,review_note,reviewed_by from erp_private.tax_cases where project_id=${P} and kind='VAT'`)[0];
 assert.equal(vatCase.status,'Returned');assert.match(vatCase.review_note,/Review cancelled.*Period is already submitted/);assert.equal(vatCase.reviewed_by,actors.MANAGER.staff_id);
 assert.equal((await get('STOCK')).account_code,null);
 // A locked or filed period is corrected only through a controlled adjustment.
 await tx`update erp_private.workbook_rows set route=2,category_code='EXP08',account_code='62500',review_details=${tx.json({mapping_confirmation:{method:AUTO_METHOD}})} where row_key='AM-PLAIN'`;
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by,reviewed_by,review_snapshot) values(${P},'PAYE','2026-09-01','2026-09-30','Locked',${actors.ASSISTANT.staff_id},${actors.MANAGER.staff_id},'{}')`;
 const plain=await get('PLAIN');
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[plain.row_id],reason:'Period is locked now'}),/locked or filed/);

 // Periods: nothing may start before the client's first financial year that ends on or after 31 Dec 2025.
 assert.equal(firstSupportedStart(12,31),'2025-01-01');assert.equal(firstSupportedStart(6,30),'2025-07-01');
 await as('MANAGER',()=>assertSupportedPeriod(tx,C,'2025-01-01'));
 await assert.rejects(()=>as('MANAGER',()=>assertSupportedPeriod(tx,C,'2024-12-31')),/periods ending 31 December 2025 onwards.*2025-01-01/);
 await tx`update erp_private.clients set year_end_month=6,year_end_day=30 where client_id=${C}`;
 await assert.rejects(()=>as('MANAGER',()=>assertSupportedPeriod(tx,C,'2025-06-30')),/first supported date is 2025-07-01/);
 await as('MANAGER',()=>assertSupportedPeriod(tx,C,'2025-07-01'));
 await tx`update erp_private.clients set year_end_month=12,year_end_day=31 where client_id=${C}`;

 // Sales: the revenue account comes from the approved, dated crosswalk and is checked against the REV chart accounts. It cannot be edited through the app.
 const cross=await as('MANAGER',()=>loadCrosswalk(tx));
 assert.deepEqual(['16%','8%','0%','Exempt'].map(k=>revenueAccount(cross,{vat_category:k},'2026-03-01')),['40000','40010','40020','40030']);
 assert.equal(revenueAccount(cross,{rate_key:'KE_VAT_PETROLEUM_8'},'2026-03-01'),'40010');
 assert.equal(revenueAccount(cross,{vat_category:'16%'},'2024-12-31'),null,'no rule before 2025');
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.sales_revenue_crosswalk set revenue_account='40020' where vat_category='16%'`),/permission denied/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.sales_revenue_crosswalk`),/permission denied|archived/);
});
