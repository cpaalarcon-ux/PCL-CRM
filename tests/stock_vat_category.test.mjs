import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {improvementAction:improvementActionV12}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction:accountingActionV12}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {taxAction:taxActionV12}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {workbookAction:workbookActionV12}=await import('../supabase/functions/staff-workspace-v12/workbook-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),callV12=(role,p)=>as(role,a=>improvementActionV12(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p));

const {stockGateIssues}=await import('../supabase/functions/staff-workspace-v12/stock-vat.ts');
const {vatGateIssues,vatCategoriesInput}=await import('../supabase/functions/staff-workspace-v12/improvement-rules.mjs');
const gate=()=>as('MANAGER',()=>stockGateIssues(tx,P,'2026-09-01','2026-09-30'));

test('gate rules: every sold category needs an approved roll; unsold categories are flagged',()=>{
 const none=vatGateIssues({sold:null,controls:[]});assert.deepEqual(none,[]);
 const r=vatGateIssues({sold:['16%','8%'],controls:[{vat_category:'16%',status:'Approved',result:{closing_value:10}},{vat_category:'8%',status:'Approved',result:{closing_value:-1}}],resale:{'0%':2},sales:{'Exempt':50}});
 assert.equal(r.length,3);assert.match(r[0],/8%.*negative/);assert.match(r.join(' '),/Sales are recorded in Exempt/);assert.match(r.join(' '),/2 purchase line\(s\) in 0%/);
 assert.match(vatGateIssues({sold:['16%','Exempt'],controls:[{vat_category:'16%',status:'Submitted',result:{}}]}).join(' | '),/16% stock roll is Submitted.*No Exempt stock roll/);
 assert.deepEqual(vatCategoriesInput(['0%','16%','16%']),['16%','0%']);assert.throws(()=>vatCategoriesInput([]),/at least one/);assert.throws(()=>vatCategoriesInput(['5%']),/./);
});

test('stock rolls by VAT category: sold categories, sources by rate, sales from confirmed imports, approval gate',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mlima Traders',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 const W=id();await tx`insert into erp_private.client_activities(activity_id,client_id,activity_code,is_primary,pack_code,activity_name,income_stream,effective_from,evidence,created_by) values(${W},${C},'wholesale',true,'Wholesale','Wholesale trade','Business','2026-01-01','Fictional evidence',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await call('MANAGER',{action:'v3_stock_policy_add',client_id:C,activity_id:W,inventory_method:'Periodic',effective_from:'2026-01-02',count_frequency:'Monthly'});
 const rowsIn=[['16%',1000],['16%',500],['8%',300],['0%',600]];
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',4,4,0,0,${actors.ASSISTANT.staff_id})`;
 for(const [n,[cat,amount]] of rowsIn.entries())await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${n+2},${'MT-'+n},'{}',${tx.json({date:'2026-09-10',amount,vat:0,invoice:'MT-'+n,party:'Fictional supplier',party_pin:'P000000001A',description:'Goods',vat_category:cat})})`;
 const row=cat=>as('ASSISTANT',()=>tx`select row_id,revision from erp_private.workbook_rows where project_id=${P} and normalized->>'vat_category'=${cat} order by source_row`);
 const mapRow=(r,extra={})=>map('ASSISTANT',{action:'workbook_map',project_id:P,row_id:r.row_id,revision:r.revision,route:1,account_code:'50000',activity_id:W,stock_class:'Merchandise',...extra});

 await assert.rejects(()=>call('MANAGER',{action:'v3_stock_create_vat',project_id:P,activity_id:W,starts_on:'2026-09-01',ends_on:'2026-09-30'}),/Record the VAT categories/);
 const c0=(await call('MANAGER',{action:'v3_client_read',client_id:C})).client;
 await assert.rejects(()=>call('ASSISTANT',{action:'v3_vat_categories_save',client_id:C,revision:c0.revision,vat_categories_sold:['16%']}),/Partner or Manager/);
 await assert.rejects(()=>call('MANAGER',{action:'v3_vat_categories_save',client_id:C,revision:c0.revision,vat_categories_sold:[]}),/at least one/);
 assert.deepEqual((await call('MANAGER',{action:'v3_vat_categories_save',client_id:C,revision:c0.revision,vat_categories_sold:['0%','16%']})).vat_categories_sold,['16%','0%']);
 assert.deepEqual((await call('MANAGER',{action:'v3_project_read',project_id:P})).vat_categories_sold,['16%','0%']);

 await assert.rejects(()=>call('ASSISTANT',{action:'v3_stock_create',project_id:P,activity_id:W,vat_category:'8%',starts_on:'2026-09-01',ends_on:'2026-09-30'}),/does not sell 8% goods/);
 const [r8]=await row('8%');
 await assert.rejects(()=>mapRow(r8),/Client does not sell 8% goods/);
 await mapRow(r8,{resale_reason:'Fictional own-use fuel bought on a resale invoice, reviewed with the owner'});
 assert.match((await tx`select review_details->>'resale_reason' r from erp_private.workbook_rows where row_id=${r8.row_id}`)[0].r,/own-use fuel/);
 for(const r of [...await row('16%'),...await row('0%')])await mapRow(r);

 const made=await call('ASSISTANT',{action:'v3_stock_create_vat',project_id:P,activity_id:W,starts_on:'2026-09-01',ends_on:'2026-09-30'});
 assert.deepEqual(made.created,['16%','0%']);
 assert.deepEqual((await call('ASSISTANT',{action:'v3_stock_create_vat',project_id:P,activity_id:W,starts_on:'2026-09-01',ends_on:'2026-09-30'})).created,[],'running it again creates nothing new');
 const ctl=await tx`select control_id,vat_category from erp_private.stock_controls where project_id=${P} order by vat_category`,by=Object.fromEntries(ctl.map(x=>[x.vat_category,x.control_id]));
 assert.deepEqual(Object.keys(by).sort(),['0%','16%']);

 const doc=await tx`select document_id from erp_private.documents limit 1`;
 await tx`insert into erp_private.period_imports(project_id,client_id,document_id,kind,starts_on,ends_on,payload,source_hash,status,prepared_by,reviewed_by) values(${P},${C},${D},'Sales','2026-09-01','2026-09-30',${tx.json({groups:[{vat_category:'16%',net:4000,vat:640,credit_net:0},{vat_category:'8%',net:0,vat:0,credit_net:0},{vat_category:'0%',net:500,vat:0,credit_net:0},{vat_category:'Exempt',net:0,vat:0,credit_net:0}],issues:[]})},${'f'.repeat(64)},'Confirmed',${actors.ASSISTANT.staff_id},${actors.MANAGER.staff_id})`;

 const save=async(cat,inputs)=>{const x=await call('ASSISTANT',{action:'v3_stock_read',project_id:P,control_id:by[cat]});await call('ASSISTANT',{action:'v3_stock_save',project_id:P,control_id:by[cat],revision:x.record.revision,inputs});return call('ASSISTANT',{action:'v3_stock_read',project_id:P,control_id:by[cat]});};
 const base={cost_basis:'Provisional margin estimate',evidence_reference:'Fictional opening stock list and supplier invoices',reconciliation_note:'Fictional tie-out of purchases and sales.'};
 let s16=await save('16%',{...base,opening_value:2000,net_sales:999,margin_percentage:20});
 assert.equal(s16.source.selected_count,2);assert.equal(s16.source.resale_purchases,1500,'only 16% purchase lines feed the 16% roll');assert.equal(s16.source.net_sales,4000);
 assert.equal(s16.result.net_sales,4000,'net sales come from the confirmed sales import, not typed input');assert.equal(s16.result.cost_of_sales,3200);assert.equal(s16.result.closing_value,300);assert.equal(s16.result.provisional,true);
 let s0=await save('0%',{...base,opening_value:1000,margin_percentage:10});
 assert.equal(s0.source.resale_purchases,600);assert.equal(s0.result.cost_of_sales,450);assert.equal(s0.result.closing_value,1150);

 const before=await gate();
 assert.ok(before.some(x=>/16% stock roll is Draft/.test(x))&&before.some(x=>/0% stock roll is Draft/.test(x)),'unapproved rolls block the month');
 assert.ok(before.some(x=>/1 purchase line\(s\) in 8%/.test(x)),'a resale line in a category the client does not sell is flagged');

 await tx`insert into erp_private.tax_row_reviews(row_id,project_id,source_revision,decision,deductible_percentage,reason,reviewed_by) select row_id,project_id,revision,'Eligible',100,'Fictional independent source review',${actors.SUPERVISOR.staff_id} from erp_private.workbook_rows where project_id=${P}`;
 for(const cat of ['16%','0%']){const x=await call('ASSISTANT',{action:'v3_stock_read',project_id:P,control_id:by[cat]});await call('ASSISTANT',{action:'v3_stock_submit',project_id:P,control_id:by[cat],revision:x.record.revision});
  const y=await call('ASSISTANT',{action:'v3_stock_read',project_id:P,control_id:by[cat]});
  await assert.rejects(()=>call('ASSISTANT',{action:'v3_stock_review',project_id:P,control_id:by[cat],revision:y.record.revision,status:'Approved',review_note:'Attempted self review of stock'}),/review/);
  await call('MANAGER',{action:'v3_stock_review',project_id:P,control_id:by[cat],revision:y.record.revision,status:'Approved',review_note:'Independently reviewed, provisional margin kept.'});}
 const after=await gate();
 assert.equal(after.length,1,'only the 8% resale flag remains once both rolls are approved');assert.match(after[0],/8%/);
});
