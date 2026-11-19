import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const X=await import('../supabase/functions/staff-workspace-v12/ppe-actions.ts');
const root=path.resolve(import.meta.dirname,'..');
const db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),CL=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
let per,MOTOR='',OTHER='';
let TB=[];const getTb=async()=>({tb:TB});
const run=(role,p,l)=>as(role,a=>X.ppeAction(tx,a,l||per,p,getTb,'2026-12-31'));
const asset=(o={})=>({action:'ledger_ppe_asset_declare',asset_name:'Fictional delivery van',asset_account:MOTOR,class_code:'MOTOR',origin:'Added in the year',acquired_on:'2026-02-10',first_use_on:'2026-03-01',cost:1000000,business_percentage:100,evidence:'Invoice INV-001 and delivery note',...o});
const tbFor=cost=>[{code:MOTOR,name:'Motor vehicles',net:cost,movement_debit:cost,movement_credit:0},{code:'15920',name:'Accumulated depreciation, motor vehicles',net:-cost/4,movement_debit:0,movement_credit:cost/4},{code:'67030',name:'Depreciation, motor vehicles',net:cost/4,movement_debit:cost/4,movement_credit:0}];

test('PPE from the opening trial balance and from purchases: completed in one step, never guessed, approved by someone else',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VCQA','Fictional stock firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${CL},'Fictional Mlima Traders',${actors.MANAGER.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${CL},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${CL},${F},'Fictional Mlima project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 per=(await tx`insert into erp_private.ledger_periods(project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${P},${CL},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${actors.MANAGER.staff_id}) returning *`)[0];
 MOTOR=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and name ilike '%motor%' and code not in('15920') order by code limit 1`)[0].code;
 assert.match(MOTOR,/^15\d{3}$/);OTHER=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and code<>${MOTOR} and code not between '15900' and '15999' order by code limit 1`)[0].code;
 const T=id(),D=id(),B=id();
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${CL},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-02-01','2026-02-28','{}',3,3,0,0,${actors.ASSISTANT.staff_id})`;
 const FURN=(await tx`select code from erp_private.account_catalog where route=3 and status='Active' and not is_legacy and code not between '15900' and '15999' and code<>${MOTOR} order by code limit 1`)[0].code;
 const row=(key,n,acct,amount,date='2026-02-10')=>tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${CL},'Purchases',${n},${'PP-'+key},'{}',${tx.json({date,amount,invoice:'INV-'+key,party:'Fictional Motors',description:'Fictional '+key,vat:0})})`.then(()=>tx`update erp_private.workbook_rows set route=3,category_code=(select category_code from erp_private.account_catalog where code=${acct}),account_code=${acct},narration=${'Fictional '+key},asset_details='Fictional asset',first_use_status='In use',first_use_date=${date} where row_key=${'PP-'+key}`);
 await row('TRUCK',1,MOTOR,1200000);await row('SECOND',2,MOTOR,300000,'2026-02-12');
 // ----- the opening trial balance: cost by account and accumulated depreciation by class account
 TB=[{code:MOTOR,name:'Motor vehicles',opening:1200000,net:1200000},{code:FURN,name:'Furniture',opening:80000,net:80000},{code:'15920',name:'Accumulated depreciation, motor vehicles',opening:-700000,net:-700000},{code:'15930',name:'Accumulated depreciation, furniture',opening:-30000,net:-30000}];
 let r=await run('ASSISTANT',{action:'ledger_ppe_read'});
 assert.equal(r.bf.as_of,'2025-12-31');assert.deepEqual(r.bf.pending.map(x=>[x.asset_account,x.cost]),[[MOTOR,1200000],[FURN,80000]].sort((x,y)=>x[0].localeCompare(y[0])));
 assert.equal(r.bf.classes.find(x=>x.class_code==='MOTOR').tb_accumulated,700000);
 assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].suggested_class,'','no class is suggested while the register has none for the account');
 const bf=(rows,extra={})=>({action:'ledger_ppe_bf_declare',evidence:'Prior-year tax computation and fixed asset schedule, year ended 31 December 2025',rows,...extra});
 const mo={asset_account:MOTOR,class_code:'MOTOR',first_use_on:'2022-03-01',tax_wdv:500000},fu={asset_account:FURN,class_code:'FURNITURE',first_use_on:'2023-01-01',tax_wdv:40000};
 // ----- nothing is guessed
 await assert.rejects(()=>run('ASSISTANT',bf([])),/Choose a class/);
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,class_code:''},fu])),/choose an asset class/);
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,tax_wdv:''},fu])),/tax written-down value from the prior-year/);
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,first_use_on:''},fu])),/first used/);
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,first_use_on:'2026-03-01'},fu])),/after the brought-forward date/);
 await assert.rejects(()=>run('ASSISTANT',bf([mo,fu],{evidence:'x'})),/at least 10/);
 await assert.rejects(()=>run('ASSISTANT',bf([mo])),/not being completed|shared/,'one account alone cannot take the whole depreciation from the trial balance');
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,asset_account:'61000'},fu])),/not waiting/);
 await assert.rejects(()=>run('ASSISTANT',bf([{...mo,accumulated_depreciation:9999999},fu])),/more than cost/);
 // ----- one declaration, cost and depreciation from the trial balance
 const out=await run('ASSISTANT',bf([mo,fu]));assert.equal(out.declared,2);
 const recs=await tx`select asset_account,class_code,origin,cost,bf_accumulated_depreciation,bf_tax_wdv,bf_as_of,status,asset_name from erp_private.ppe_assets order by asset_account`;
 const rm=recs.find(x=>x.asset_account===MOTOR);assert.deepEqual([rm.origin,Number(rm.cost),Number(rm.bf_accumulated_depreciation),Number(rm.bf_tax_wdv),rm.status],['Brought forward',1200000,700000,500000,'Draft']);
 assert.match(rm.asset_name,/^Brought forward: /);assert.equal(new Date(rm.bf_as_of).toISOString().slice(0,10),'2025-12-31');
 r=await run('ASSISTANT',{action:'ledger_ppe_read'});assert.equal(r.bf.pending.length,0,'drafts cover the opening balances');assert.equal(r.register.rows.length,0,'drafts are not in the register');
 await assert.rejects(()=>run('ASSISTANT',bf([mo,fu])),/not waiting/);
 // ----- approval is by someone else
 for(const d of recs)await assert.rejects(()=>run('ASSISTANT',{action:'ledger_ppe_asset_review',record_id:(r.assets.find(x=>x.name===d.asset_name).draft.record_id),decision:'Approved'}),/Manager or Partner/);
 for(const a of r.assets)await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:a.draft.record_id,decision:'Approved'}).then(x=>assert.equal(x.status,'Approved'));
 r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.register.totals.opening_cost,1280000);assert.equal(r.register.totals.opening_acc,730000);assert.equal(r.register.totals.tax_opening,540000);
 // ----- purchases mapped to a PPE account: one step, cost and dates from the purchase, class asked for
 assert.equal(r.candidates.length,2);assert.equal(r.candidates[0].suggested_class,'MOTOR','the class already used for that account is offered');
 const add=(rows)=>({action:'ledger_ppe_additions_declare',rows});const c0=r.candidates[0],c1=r.candidates[1];
 await assert.rejects(()=>run('ASSISTANT',add([])),/at least one/);
 await assert.rejects(()=>run('ASSISTANT',add([{source_row_id:c0.source_row_id,class_code:''}])),/asset class/);
 await assert.rejects(()=>run('ASSISTANT',add([{source_row_id:c0.source_row_id,class_code:'MOTOR'},{source_row_id:c0.source_row_id,class_code:'MOTOR'}])),/twice/);
 await assert.rejects(()=>run('ASSISTANT',add([{source_row_id:id(),class_code:'MOTOR'}])),/no longer waiting/);
 await assert.rejects(()=>run('ASSISTANT',add([{source_row_id:c0.source_row_id,class_code:'MOTOR',first_use_on:'2026-01-01'}])),/first-use date cannot be before/);
 const made=await run('ASSISTANT',add([{source_row_id:c0.source_row_id,class_code:'MOTOR',cost:1,first_use_on:'2026-03-01'},{source_row_id:c1.source_row_id,class_code:'MOTOR'}]));assert.equal(made.declared,2);
 const adds=await tx`select cost,first_use_on,acquired_on,origin,status,evidence,source_row_id from erp_private.ppe_assets where origin='Added in the year' order by acquired_on`;
 assert.deepEqual(adds.map(x=>[Number(x.cost),x.status]),[[1200000,'Draft'],[300000,'Draft']],'cost comes from the purchase, never from the request');
 assert.equal(new Date(adds[0].first_use_on).toISOString().slice(0,10),'2026-03-01');assert.equal(new Date(adds[1].first_use_on).toISOString().slice(0,10),'2026-02-12','the first-use date starts as the invoice date');
 assert.match(adds[0].evidence,/Fictional Motors, invoice INV-TRUCK/);
 r=await run('ASSISTANT',{action:'ledger_ppe_read'});assert.equal(r.candidates.length,0,'a purchase is in the register once');
 await assert.rejects(()=>run('ASSISTANT',add([{source_row_id:c0.source_row_id,class_code:'MOTOR'}])),/no longer waiting/);
 // ----- the new records need approval too, and only then do they reach the register
 assert.equal(r.register.totals.additions,0);
 for(const a of r.assets.filter(x=>x.draft&&x.draft.origin==='Added in the year'))await run('MANAGER',{action:'ledger_ppe_asset_review',record_id:a.draft.record_id,decision:'Approved'});
 r=await run('MANAGER',{action:'ledger_ppe_read'});assert.equal(r.register.totals.additions,1500000);assert.equal(r.register.totals.closing_cost,2780000);
 // ----- audit trail
 assert.ok((await tx`select 1 from erp_private.audit_events where action in ('PPE_BROUGHT_FORWARD_DECLARED','PPE_ADDITIONS_DECLARED') limit 2`).length===2);
});
