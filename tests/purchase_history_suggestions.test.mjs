import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
import {approveChart,postRows} from './helpers/chart-and-posting.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {autoMapAction}=await import('../supabase/functions/staff-workspace-v12/auto-map.ts');
const {suggestionsFor,pickFromHistory,descKey,HISTORY_METHOD,groupSuggestions}=await import('../supabase/functions/staff-workspace-v12/purchase-history.ts');
const {assertSupportedPeriod}=await import('../supabase/functions/staff-workspace-v12/supported-period.ts');
const {loadCrosswalk,revenueAccount}=await import('../supabase/functions/staff-workspace-v12/sales-crosswalk.ts');
const {firstSupportedStart}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p)),map=(role,p)=>as(role,a=>accountingAction(tx,a,p)),auto=(role,p)=>as(role,a=>autoMapAction(tx,a,{project_id:P,...p}));

test('purchase mapping suggestions come from the client\'s own supplier history',async t=>{
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
 const hist=await tx`select code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and category_code='EXP08' order by code`;
 const other=(await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and category_code='EXP01' order by code limit 1`)[0];
 const A=hist[0].code;assert.ok(other&&A,'two expense accounts exist');
 let n=100;
 const put=async(key,pin,descr,date,mapped,dataset='Purchases')=>{n++;await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,account_code) values(${B},${P},${C},${dataset},${n},${'PH-'+key},'{}',${tx.json({date,amount:1000,vat:160,invoice:'PH-'+key,party:'Fictional '+pin,party_pin:pin,description:descr,vat_category:'16%'})},${mapped?.route??null},${mapped?.category??null},${mapped?.code??null})`;};
 const exp={route:2,category:'EXP08',code:A},exp2={route:2,category:other.category_code,code:other.code},stockMap={route:1,category:'STOCK',code:'50000'};
 // Earlier mapped history (within 12 months of today, 6 Nov 2026).
 for(const i of [1,2,3])await put('A'+i,'P000000011A','Monthly security guarding',`2026-0${i+3}-10`,exp);          // consistent 3 → automatic
 const ctx={P,C,F,preparer:actors.MANAGER.staff_id,reviewer:actors.PARTNER.staff_id};
 await postRows(tx,ctx,(await tx`select row_id from erp_private.workbook_rows where row_key like 'PH-A%'`).map(r=>r.row_id),{account:A});
 for(const i of [1,2])await put('B'+i,'P000000012B','Office stationery supplies',`2026-0${i+3}-10`,exp);            // consistent 2 → suggestion only
 for(const i of [1,2])await put('C'+i,'P000000013C','Mixed services',`2026-0${i+3}-10`,exp);await put('C3','P000000013C','Mixed services','2026-07-10',exp2);await put('C4','P000000013C','Mixed services','2026-08-10',exp2); // mixed → nothing
 for(const i of [1,2,3])await put('D'+i,'P000000014D','Hardware for resale',`2026-0${i+3}-10`,stockMap);          // stock → suggested, never automatic
 for(const i of [1,2,3])await put('E'+i,'P000000015E','Old supplier cost',`2025-0${i}-10`,exp);                    // older than 12 months → nothing
 // Unmapped rows for September.
 await put('NA','P000000011A','Something else','2026-09-10',null);
 await put('NAN','P000000011A','Cash purchase receipt','2026-09-11',null,'Non-eTIMS');
 await put('NB','P000000012B','Something else','2026-09-10',null);
 await put('NC','P000000013C','Something else','2026-09-10',null);
 await put('ND','P000000014D','Something else','2026-09-10',null);
 await put('NE','P000000015E','Something else','2026-09-10',null);
 await put('NX','P000000099X','Unknown supplier text','2026-09-10',null);
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'PH-'+key}`.then(r=>r[0]);
 const unmapped=()=>tx`select r.*,b.period_start from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${P} and r.account_code is null and r.row_key like 'PH-N%' order by r.source_row`;
 const sug=async()=>as('ASSISTANT',async()=>suggestionsFor(tx,{client_id:C,project_id:P},await unmapped()));

 await t.test('suggestions: consistent history suggests; mixed, old or unknown history does not',async()=>{
  const s=await sug();const byKey=async k=>s.get((await get(k)).row_id);
  const a=await byKey('NA');assert.equal(a.account_code,A);assert.equal(a.count,3);assert.equal(a.strength,'Strong');assert.equal(a.basis,'supplier');assert.equal(a.auto,true);
  const b=await byKey('NB');assert.equal(b.account_code,A);assert.equal(b.strength,'Likely');assert.equal(b.auto,false,'two earlier invoices only suggest');
  assert.equal(await byKey('NC'),undefined,'mixed history gives no suggestion');
  const d=await byKey('ND');assert.equal(d.route,1);assert.equal(d.auto,false,'stock is never applied automatically');
  assert.equal(await byKey('NE'),undefined,'history older than 12 months is ignored');
  assert.equal(await byKey('NX'),undefined,'an unknown supplier has no suggestion');
  const nonEtims=await byKey('NAN');assert.ok(nonEtims,'a Non-eTIMS row can be suggested');assert.equal(nonEtims.auto,false,'but is not applied automatically');
  const groups=groupSuggestions(await unmapped(),s);
  const g=groups.find(x=>x.account_code===A&&x.route===2);assert.equal(g.rows,3,'A, A (Non-eTIMS) and B are one group for the screen');assert.ok(g.strong>=1);
 });

 await t.test('automatic mapping: only a perfectly consistent expense supplier with 3 or more eTIMS invoices',async()=>{
  const out=await as('ASSISTANT',a=>autoMapAction(tx,a,{project_id:P,action:'workbook_auto_map'}));
  assert.equal(out.mapped,1);
  const done=await get('NA');assert.equal(done.account_code,A);assert.equal(done.route,2);assert.equal(done.review_details.mapping_confirmation.method,HISTORY_METHOD);
  for(const k of ['NAN','NB','NC','ND','NE','NX'])assert.equal((await get(k)).account_code,null,k+' stays with staff');
  const ev=(await tx`select after_values from erp_private.audit_events where action='AUTO_MAPPING' order by occurred_at desc limit 1`)[0];assert.equal(ev.after_values.via_supplier_history,1);
  // Automatic mappings do not feed further suggestions: the supplier still has exactly 3 earlier invoices.
  const again=await sug();const nan=again.get((await get('NAN')).row_id);assert.equal(nan.count,3);
  // A Manager can remove it, and it is not mapped again.
  assert.equal((await as('MANAGER',a=>autoMapAction(tx,a,{project_id:P,action:'workbook_mapping_remove',row_ids:[done.row_id],reason:'Guarding was really a stock purchase'}))).removed,1);
  assert.equal((await as('MANAGER',a=>autoMapAction(tx,a,{project_id:P,action:'workbook_auto_map'}))).mapped,0);
 });

 await t.test('a suggestion needs the account in the client account mappings for the invoice date',async()=>{
  const A2=hist[1].code;
  for(const i of [1,2])await put('F'+i,'P000000016F','Courier charges',`2026-0${i+3}-10`,{route:2,category:'EXP08',code:A2});
  await put('NF','P000000016F','Something else','2026-09-10',null);
  const before=await sug();assert.ok(before.get((await get('NF')).row_id),'suggested while the account is mapped for the client');
  await tx`update erp_private.client_account_mappings set effective_to='2026-06-30' where client_id=${C} and erp_account_code=${A2}`;
  const after=await sug();assert.equal(after.get((await get('NF')).row_id),undefined,'no mapping cover in September, no suggestion');
 });

 await t.test('history_hint selects only the rows the server itself suggests',async()=>{
  const filters={action:'v3_mapping_select',project_id:P,search:'',mapping:'Unmapped',dataset:'Costs',vat_category:'All'};
  const sel=await call('ASSISTANT',{...filters,history_hint:{route:1,category_code:'STOCK',account_code:'50000'}});
  assert.equal(sel.count,1,'only the stock-suggested row');
  await assert.rejects(()=>call('ASSISTANT',{...filters,history_hint:{route:2,category_code:'EXP08',account_code:'99999'}}),/no longer available/);
  await assert.rejects(()=>call('ASSISTANT',{...filters,history_hint:{route:2,category_code:'EXP01',account_code:other.code}}),/no longer available/);
 });

 await t.test('history that was never posted, or was reversed, only suggests; a dated supplier rule stops even the suggestion',async()=>{
  const G='P000000017G',H='P000000018H',ids=async like=>(await tx`select row_id from erp_private.workbook_rows where row_key like ${like} order by row_key`).map(r=>r.row_id);
  for(const i of [1,2,3])await put('G'+i,G,'Weekly cleaning',`2026-0${i+3}-10`,exp);   // mapped by staff, never posted
  for(const i of [1,2,3])await put('H'+i,H,'Weekly repairs',`2026-0${i+3}-10`,exp);
  const h=await ids('PH-H%');await postRows(tx,ctx,h.slice(0,2),{account:A,date:'2026-05-10'});await postRows(tx,ctx,h.slice(2),{account:A,date:'2026-06-10',reverse:true});
  await put('NG',G,'Something else','2026-09-10',null);await put('NH',H,'Something else','2026-09-10',null);
  const s=await sug(),g=s.get((await get('NG')).row_id),hh=s.get((await get('NH')).row_id);
  assert.equal(g.account_code,A);assert.equal(g.count,3);assert.equal(g.posted,0);assert.equal(g.auto,false,'three mapped but unposted invoices only suggest');
  assert.equal(hh.count,3);assert.equal(hh.posted,2);assert.equal(hh.auto,false,'a reversed posting does not count towards learning');
  // The Manager records a dated supplier rule for supplier 11A and account A: invoices on or after the date are neither mapped nor suggested for it.
  await put('NA2','P000000011A','Something else','2026-09-12',null);
  assert.equal((await sug()).get((await get('NA2')).row_id).auto,true,'before the rule');
  await as('MANAGER',a=>tx`insert into erp_private.supplier_mapping_blocks(client_id,party_pin,account_code,effective_from,reason,created_by) values(${C},'P000000011A',${A},'2026-09-01','Fictional: guarding is really a stock purchase',${a.staff_id})`);
  assert.equal((await sug()).get((await get('NA2')).row_id),undefined,'after the rule');
  const early=await put('NA3','P000000011A','Something else','2026-08-12',null);assert.equal((await sug()).get((await get('NA3')).row_id).auto,true,'an invoice dated before the rule date is unaffected');
 });

 await t.test('pure helpers',()=>{
  assert.equal(descKey('Fuel 2026-09 #123 Shell'),'fuel shell');
  const h={byPin:new Map(),byDesc:new Map([['monthly rent',[{account_code:'1',route:2,category_code:'EXP01',n:1,posted:0}]]])};
  assert.equal(pickFromHistory(h,{normalized:{description:'Monthly rent'}}),null,'one earlier row by description is not enough');
 });
});

test('the purchases screen shows suggestions, never maps without a click, and the guide explains them',()=>{
 const ui=fs.readFileSync(root+'/staff-accounting.mjs','utf8'),guide=fs.readFileSync(root+'/staff-guide-text.mjs','utf8'),css=fs.readFileSync(root+'/staff-pilot.css','utf8');
 assert.match(ui,/history_groups/);assert.match(ui,/data-history-map/);assert.match(ui,/history_hint:hint/);assert.match(ui,/Suggested from history/);assert.match(ui,/Yellow means a suggestion only/);
 assert.match(ui,/Auto-mapped — supplier history/);assert.match(css,/\.suggested\{/);assert.match(guide,/yellow panel suggests/);
});
