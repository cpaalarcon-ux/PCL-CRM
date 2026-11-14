import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts} from './helpers/client-mappings.mjs';
import {approveChart} from './helpers/chart-and-posting.mjs';
import {openingTbMappingMatches} from '../supabase/functions/staff-workspace-v12/opening-tb-mapping.mjs';
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

test('auto-mapping boundaries: approved chart required, every exception has a reason, supplier rules, opening TB source codes',async t=>{
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
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-09-01','2026-09-30','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;

 const route2=(await tx`select code,category_code from erp_private.account_catalog where route=2 and status='Active' and not is_legacy and category_code='EXP08' order by code`);
 const OKC=route2[0],NOT_IN=route2[1].code,OTHER=route2[2];assert.ok(OKC&&NOT_IN&&OTHER);
 const chartCodes=await approveChart(tx,{C,prepared:actors.MANAGER.staff_id,reviewed:actors.PARTNER.staff_id,exclude:[NOT_IN]});
 assert(chartCodes.includes(OKC.code)&&!chartCodes.includes(NOT_IN));
 let n=1;const put=async(key,hint,{date='2026-09-10',pin='P000000021A'}={})=>{n++;await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${n},${'BD-'+key},'{}',${tx.json({date,amount:1000,vat:160,invoice:'BD-'+key,party:'Fictional supplier',party_pin:pin,description:'Fictional goods',vat_category:'16%',...(hint?{mapping_suggestion:{confirmed:false,...hint}}:{})})})`;};
 const get=key=>tx`select * from erp_private.workbook_rows where row_key=${'BD-'+key}`.then(r=>r[0]);
 const good={route:2,category_code:OKC.category_code,account_code:OKC.code};
 const legacy=(await tx`select code from erp_private.account_catalog where is_legacy limit 1`)[0];
 const draftAcct=(await tx`select code from erp_private.account_catalog where status<>'Active' and not is_legacy limit 1`)[0];
 await put('GOOD',good);
 await put('ROUTE',{...good,route:1});
 await put('CATEGORY',{...good,category_code:'EXP01'});
 await put('UNKNOWN',{...good,account_code:'99999'});
 await put('BLANK',{route:2,category_code:'EXP08',account_code:''});
 await put('NOTCHART',{route:2,category_code:'EXP08',account_code:NOT_IN});
 await put('NOCHART',good,{date:'2025-12-15'});
 await put('NOCODES',null);
 if(legacy)await put('LEGACY',{route:2,category_code:'EXP08',account_code:legacy.code});
 if(draftAcct)await put('INACTIVE',{route:2,category_code:'EXP08',account_code:draftAcct.code});
 const out=await auto('ASSISTANT',{action:'workbook_auto_map'});
 assert.equal(out.mapped,1,'only the correct pair inside the approved chart maps');
 const why=async k=>(await get(k)).review_details?.auto_map_note?.code;
 assert.equal((await get('GOOD')).account_code,OKC.code);assert.equal(await why('GOOD'),undefined);
 const expected={ROUTE:'ROUTE_DIFFERS',CATEGORY:'CATEGORY_DIFFERS',UNKNOWN:'TB_CODE_UNKNOWN',BLANK:'TB_CODE_UNKNOWN',NOTCHART:'NOT_IN_CHART',NOCHART:'NO_APPROVED_CHART',NOCODES:'NO_CODES',...(legacy?{LEGACY:'TB_CODE_LEGACY'}:{}),...(draftAcct?{INACTIVE:'TB_CODE_INACTIVE'}:{})};
 for(const [k,code] of Object.entries(expected)){assert.equal(await why(k),code,k);assert.equal((await get(k)).account_code,null,k+' stays with staff');assert.ok((await get(k)).review_details.auto_map_note.reason.length>15,k+' has a readable reason');}
 assert.equal(out.exceptions.length,Object.keys(expected).length);assert.equal(out.reasons.NO_CODES,1);assert.equal(out.reasons.NOT_IN_CHART,1);
 assert.equal(out.exceptions.find(e=>e.code==='NOT_IN_CHART').source_row,(await get('NOTCHART')).source_row);
 // Running it again changes nothing and does not rewrite unchanged notes.
 const before=(await get('ROUTE')).revision;await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal((await get('ROUTE')).revision,before,'unchanged reasons are not rewritten');

 // Supplier rule: removal with block_supplier records a dated rule; the same supplier and account are not mapped again from that date.
 const goodRow=await get('GOOD');
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[goodRow.row_id],reason:'Wrong account for this supplier',block_supplier:true}).then(async()=>{await put('NOPIN',good,{pin:''});await auto('ASSISTANT',{action:'workbook_auto_map'});const r=await get('NOPIN');return auto('MANAGER',{action:'workbook_mapping_remove',row_ids:[r.row_id],reason:'Wrong account for this supplier',block_supplier:true});}),/no supplier PIN/);
 const rules=(await auto('MANAGER',{action:'workbook_supplier_blocks'})).blocks;assert.equal(rules.length,1);assert.equal(rules[0].party_pin,'P000000021A');assert.equal(rules[0].account_code,OKC.code);assert.equal(new Date(rules[0].effective_from).toISOString().slice(0,10),'2026-09-10');
 await put('LATER',good,{date:'2026-09-20'});await put('EARLIER',good,{date:'2026-09-01'});await put('OTHERACCT',{route:2,category_code:'EXP08',account_code:OTHER.code},{date:'2026-09-20'});await put('OTHERPIN',good,{date:'2026-09-20',pin:'P000000022B'});
 const o2=await auto('ASSISTANT',{action:'workbook_auto_map'});
 assert.equal(await why('LATER'),'SUPPLIER_BLOCKED');assert.equal((await get('LATER')).account_code,null);
 assert.equal((await get('EARLIER')).account_code,OKC.code,'an invoice dated before the rule is unaffected');
 assert.equal((await get('OTHERACCT')).account_code,OTHER.code,'a different account for the same supplier still maps');
 assert.equal((await get('OTHERPIN')).account_code,OKC.code,'another supplier is unaffected');
 assert.equal(o2.reasons.SUPPLIER_BLOCKED,1);
 // Only a Manager or Partner records or ends a rule; rules are ended, never edited or deleted.
 await assert.rejects(()=>auto('ASSISTANT',{action:'workbook_supplier_block_end',block_id:rules[0].block_id,reason:'Trying to lift the rule'}),/Only a Manager or Partner/);
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_supplier_block_end',block_id:rules[0].block_id,reason:'short'}),/reason/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.supplier_mapping_blocks set reason='A different reason entirely' where block_id=${rules[0].block_id}`),/cannot be edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.supplier_mapping_blocks`),/permission denied|delete/i);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.supplier_mapping_blocks(client_id,party_pin,account_code,effective_from,reason,created_by) values(${C},'P000000023C',${OKC.code},'2026-09-01','Assistant tries to add a rule',${actors.ASSISTANT.staff_id})`),/row-level security|policy/i);
 assert.equal((await auto('MANAGER',{action:'workbook_supplier_block_end',block_id:rules[0].block_id,reason:'The supplier now sells this item'})).ended,1);
 await assert.rejects(()=>auto('MANAGER',{action:'workbook_supplier_block_end',block_id:rules[0].block_id,reason:'Ending it a second time'}),/already ended/);
 await tx`update erp_private.workbook_rows set review_details=review_details-'auto_map_note' where row_key='BD-LATER'`;
 await auto('ASSISTANT',{action:'workbook_auto_map'});assert.equal((await get('LATER')).account_code,OKC.code,'maps again once the rule has ended');

 // Opening TB: the source account code decides; names never stand in for a coded mapping and similar names never match.
 const maps=[{mapping_id:1,source_account_code:'1010',source_account_name:'Cash at bank',erp_account_code:'10000'},{mapping_id:2,source_account_code:'',source_account_name:'Petty cash',erp_account_code:'10010'}];
 assert.deepEqual(openingTbMappingMatches(maps,'1010','Something else entirely').map(m=>m.mapping_id),[1],'exact source code wins');
 assert.deepEqual(openingTbMappingMatches(maps,'1011','Cash at bank'),[],'a different source code never matches a coded mapping by name');
 assert.deepEqual(openingTbMappingMatches(maps,'','Cash at Bank'),[],'a coded mapping is not matched by name');
 assert.deepEqual(openingTbMappingMatches(maps,'','petty cash').map(m=>m.mapping_id),[2],'only a mapping saved without a source code matches by exact name');
 assert.deepEqual(openingTbMappingMatches(maps,'','Petty cash box'),[],'a similar name does not match');
});

test('the screens show why a row was not mapped, offer a supplier rule on removal, and list and end rules',()=>{
 const acc=fs.readFileSync(root+'/staff-accounting.mjs','utf8'),imp=fs.readFileSync(root+'/staff-standard-purchases.mjs','utf8'),wb=fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/workbook-actions.ts','utf8');
 assert.match(acc,/rowReasonLabel/);assert.match(acc,/Not mapped automatically:/);assert.match(acc,/name="block_supplier"/);assert.match(acc,/block_supplier:f\.has\('block_supplier'\)/);
 assert.match(acc,/workbook_supplier_blocks/);assert.match(acc,/workbook_supplier_block_end/);assert.match(acc,/supplier-rules/);
 assert.match(imp,/Why some rows were not mapped automatically/);assert.match(imp,/NO_APPROVED_CHART/);assert.match(wb,/auto_reasons/);
});
