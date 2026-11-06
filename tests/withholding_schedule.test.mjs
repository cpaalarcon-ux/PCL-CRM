import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {purchaseLedgerAction}=await import('../supabase/functions/staff-workspace-v12/purchase-ledger-actions.ts');
const {accountingAction}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {taxSummary}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {workbookAction}=await import('../supabase/functions/staff-workspace-v12/workbook-actions.ts');
const {periodImportAction,summarySalesRows}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const {workspaceAction}=await import('../supabase/functions/staff-workspace-v12/workspace-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {reconSource}=await import('../supabase/functions/staff-workspace-v12/accounting-actions.ts');
const {inventoryDetails}=await import('../supabase/functions/staff-workspace-v12/accounting-rules.mjs');
const {purchaseUploadHeaders}=await import('../supabase/functions/staff-workspace-v12/purchase-upload.mjs');
const root=path.resolve(import.meta.dirname,'..');
test('Withholding tax: purchase rows, schedule, return and journal',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 assert.equal((await tx`select to_regclass('erp_private.purchase_ledger_items') as name`)[0].name,'erp_private.purchase_ledger_items');
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PLQA','Fictional ledger firm'),(${F2},'PLHIDDEN','Fictional hidden firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional purchase ledger client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional purchase project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await mapAllAccounts(tx,as,C);
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional purchase capture')`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic accounting policy',${actors.MANAGER.staff_id})`;
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 const call=(role,p)=>as(role,a=>purchaseLedgerAction(tx,a,{action:'purchase_ledger_read',project_id:P,...p}));
 await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Import Sources','Fictional.csv',${'qa/'+D},100,${'b'.repeat(64)},'text/csv',${actors.ASSISTANT.staff_id})`);
 assert.equal((await as('INTERN',()=>tx`select document_id from erp_private.documents where document_id=${D}`)).length,0);

 const sources=new Map();const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function doc(name,body){const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body))).toString('hex'),idd=id(),key='qa/'+idd;sources.set(key,body);await as('ASSISTANT',()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${idd},${C},${F},${P},${T},'Import Sources',${name},${key},${body.length},${digest},'text/csv',${actors.ASSISTANT.staff_id})`);return idd;}
 const imp=(role,p)=>as(role,a=>periodImportAction(tx,a,{project_id:P,...p},storage));
 for(const rule of JSON.parse(fs.readFileSync(root+'/supabase/functions/staff-workspace-v6/kenya-tax-catalog.json'))){await tx`insert into erp_private.tax_rates(rate_key,label,tax_type,effective_from,effective_to,parameters,source_url,source_note,status,created_by) values(${rule.rate_key},${rule.label},${rule.tax_type},${rule.effective_from},${rule.effective_to},${tx.json(rule.parameters)},${rule.source_url},${rule.source_note},'Testing',${actors.PARTNER.staff_id})`;}
 const blocked=async fn=>{let changed=0;try{changed=(await as('ASSISTANT',fn)).length;}catch{return;}assert.equal(changed,0,'the update must not change anything');};
 const {withholdingAction}=await import('../supabase/functions/staff-workspace-v12/withholding-actions.ts');
 const wht=(role,p)=>as(role,a=>withholdingAction(tx,a,{project_id:P,...p}));
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{project_id:P,...p},storage));
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional legal company evidence',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-10-01','2026-10-31','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;
 let n=1;
 const put=async(key,{route=2,account='62500',amount=100000,date='2026-10-10',party='Fictional Consultants',pin='A000000031A',dataset='Purchases',mapped=true}={})=>{n++;await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized,route,category_code,account_code) values(${B},${P},${C},${dataset},${n},${'WH-'+key},'{}',${tx.json({date,amount,vat:0,invoice:'INV-'+key,party,party_pin:pin,description:'Professional fees',vat_category:'Exempt'})},${mapped?route:null},${mapped?(route===2?'EXP08':'STOCK'):null},${mapped?account:null})`;return (await tx`select row_id from erp_private.workbook_rows where row_key=${'WH-'+key}`)[0].row_id;};
 const prof=await put('PROF'),unmapped=await put('UNM',{mapped:false}),stock=await put('STK',{route:1,account:'50000'}),credit=await put('CRN',{amount:-500});
 const base={payment_code:'KE_WHT_PROF_RES',payee_residency:'Resident',evidence_reference:'eTIMS invoice INV-PROF and engagement letter',eligibility_confirmed:true};
 const lines=async()=>tx`select * from erp_private.withholding_lines where project_id=${P} and status='Active' order by created_at`;

 await t.test('purchase row: tax is calculated from the approved rate on the invoice net, once per row',async()=>{
  const out=await wht('ASSISTANT',{action:'wht_row_set',row_ids:[prof],...base});
  assert.equal(out.count,1);assert.equal(out.tax_withheld,5000);
  let l=(await lines());assert.equal(l.length,1);assert.equal(Number(l[0].taxable_amount),100000);assert.equal(Number(l[0].rate),5);assert.equal(l[0].source,'Purchase row');assert.equal(l[0].rate_status,'Testing');assert.equal(l[0].counter_account,'20000');
  // Setting it again replaces the line instead of adding another.
  assert.equal((await wht('ASSISTANT',{action:'wht_row_set',row_ids:[prof],...base,payment_code:'KE_WHT_CONTRACT_RES'})).tax_withheld,3000);
  l=(await lines());assert.equal(l.length,1);assert.equal(l[0].payment_code,'KE_WHT_CONTRACT_RES');
  await wht('ASSISTANT',{action:'wht_row_set',row_ids:[prof],...base});
  assert.equal(Number((await lines())[0].tax_withheld),5000);
 });

 await t.test('purchase row: refusals',async()=>{
  const set=(ids,extra={})=>wht('ASSISTANT',{action:'wht_row_set',row_ids:ids,...base,...extra});
  await assert.rejects(()=>set([unmapped]),/map the row to an expense/);
  await assert.rejects(()=>set([stock]),/map the row to an expense/);
  await assert.rejects(()=>set([credit]),/positive invoice amount/);
  await assert.rejects(()=>set([prof],{payee_residency:'Non-resident'}),/applies to a resident payee/);
  await assert.rejects(()=>set([prof],{eligibility_confirmed:false}),/Confirm the payee/);
  await assert.rejects(()=>set([prof],{evidence_reference:'x'}),/evidence reference/);
  await assert.rejects(()=>set([prof],{payment_code:'KE_PAYE_MONTHLY'}),/withholding|rate missing/i);
  await assert.rejects(()=>wht('INTERN',{action:'wht_row_set',row_ids:[prof],...base}),/Assigned/);
  assert.equal((await lines()).length,1,'nothing else was recorded');
 });

 await t.test('schedule: payments that are not purchases, including a non-resident payee',async()=>{
  const add=(extra={})=>wht('ASSISTANT',{action:'wht_line_add',payee_name:'Fictional Landlord',payee_pin:'a000000032b',payee_residency:'Resident',payment_date:'2026-10-15',payment_code:'KE_WHT_ROYALTY_RES',taxable_amount:40000,evidence_reference:'Royalty agreement and payment advice',eligibility_confirmed:true,counter_account:'20140',...extra});
  const r=await add();assert.equal(r.tax_withheld,2000);assert.equal(r.rate,5);
  const nr=await add({payee_name:'Fictional Overseas Lender',payee_residency:'Non-resident',payment_code:'KE_WHT_INTEREST_NONRES',taxable_amount:10000,counter_account:'20140'});assert.equal(nr.tax_withheld,1500);
  await assert.rejects(()=>add({payee_residency:'Non-resident'}),/resident payee/);
  await assert.rejects(()=>add({taxable_amount:0}),/amount subject/);
  await assert.rejects(()=>add({counter_account:'99999'}),/active account/);
  const sch=(await lines()).find(l=>l.source==='Schedule'&&l.payee_name==='Fictional Landlord');assert.equal(sch.payee_pin,'A000000032B');
  const list=await wht('ASSISTANT',{action:'wht_list',from:'2026-10-01',to:'2026-10-31'});
  assert.equal(list.totals.lines,3);assert.equal(list.totals.tax_withheld,8500);assert.equal(list.totals.taxable_amount,150000);assert.equal(list.totals.uncertificated,3);
  assert.ok(list.groups.some(g=>g.payment_code==='KE_WHT_PROF_RES'&&g.tax_withheld===5000));
  assert.ok(list.rates.some(x=>x.rate_key==='KE_WHT_PROF_RES'&&x.rate===5));
  await wht('ASSISTANT',{action:'wht_certificate',line_id:sch.line_id,issued:true});
  assert.equal((await wht('ASSISTANT',{action:'wht_list',from:'2026-10-01',to:'2026-10-31'})).totals.uncertificated,2);
 });

 await t.test('the withholding return reads the schedule',async()=>{
  const oldDeno=globalThis.Deno;globalThis.Deno={env:{get:()=>'https://yfjiculexbzpkvtapudk.supabase.co'}};
  try{
   const sum=await as('ASSISTANT',()=>taxSummary(tx,{case_id:id(),project_id:P,kind:'WHT',status:'Draft',starts_on:'2026-10-01',ends_on:'2026-10-31',inputs:{use_schedule:true}}));
   assert.deepEqual(sum.issues.filter(i=>/rate|WHT|withholding/i.test(i)),[],JSON.stringify(sum.issues));assert.equal(sum.result.from_schedule,true);assert.equal(sum.result.lines,3);assert.equal(sum.result.gross_tax,8500);assert.equal(sum.result.taxable_payment,150000);assert.equal(sum.result.groups.length,3);assert.equal(sum.result.without_certificate,2);
   const empty=await as('ASSISTANT',()=>taxSummary(tx,{case_id:id(),project_id:P,kind:'WHT',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30',inputs:{use_schedule:true}}));
   assert.match(empty.issues.join(' '),/No withholding lines are recorded/);
  }finally{globalThis.Deno=oldDeno;}
 });

 await t.test('journal: one entry per month, debit the payee balances, credit withholding payable',async()=>{
  const l=await ledger('MANAGER',{action:'ledger_period_create',starts_on:'2026-01-01',ends_on:'2026-12-31'});
  await assert.rejects(()=>ledger('ASSISTANT',{action:'ledger_withholding_create',period_id:l.period_id,month:'2027-02-01'}),/within this financial year/);
  const made=await ledger('ASSISTANT',{action:'ledger_withholding_create',period_id:l.period_id,month:'2026-10-01'});
  assert.equal(made.lines,3);assert.equal(made.tax_withheld,8500);
  const read=await ledger('ASSISTANT',{action:'ledger_journal_read',period_id:l.period_id,journal_id:made.journal_id});
  const by=Object.fromEntries(read.lines.map(x=>[x.account_code,x]));
  assert.equal(Number(by['20000'].debit),5000);assert.equal(Number(by['20140'].debit),3500);assert.equal(Number(by['21606'].credit),8500);
  assert.ok((await lines()).every(x=>x.journal_id===made.journal_id));
  await assert.rejects(()=>ledger('ASSISTANT',{action:'ledger_withholding_create',period_id:l.period_id,month:'2026-10-01'}),/not already in a journal/);
  const first=(await lines())[0];
  await assert.rejects(()=>wht('MANAGER',{action:'wht_line_void',line_id:first.line_id,reason:'Trying to remove a posted line'}),/in a journal/);
  await assert.rejects(()=>wht('ASSISTANT',{action:'wht_row_set',row_ids:[prof],...base,payment_code:'KE_WHT_CONTRACT_RES'}),/already in a journal/);
  await blocked(()=>tx`update erp_private.withholding_lines set tax_withheld=1 where line_id=${first.line_id} returning line_id`);
 });

 await t.test('removing a line: preparer or a leader, with a reason, and not once the month is submitted',async()=>{
  await wht('ASSISTANT',{action:'wht_line_add',payee_name:'Fictional Agent',payee_residency:'Resident',payment_date:'2026-11-05',payment_code:'KE_WHT_MARKETING_RES',taxable_amount:20000,evidence_reference:'Agency invoice and payment advice',eligibility_confirmed:true,counter_account:'20000'});
  const agentId=(await lines()).find(x=>x.payee_name==='Fictional Agent').line_id;
  await assert.rejects(()=>wht('SUPERVISOR',{action:'wht_line_void',line_id:agentId,reason:'Supervisor is not the preparer'}),/preparer, a Manager or a Partner/);
  await assert.rejects(()=>wht('ASSISTANT',{action:'wht_line_void',line_id:agentId,reason:'short'}),/at least 10/);
  await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by) values(${P},'WHT','2026-11-01','2026-11-30','Submitted',${actors.ASSISTANT.staff_id})`;
  await assert.rejects(()=>wht('ASSISTANT',{action:'wht_line_void',line_id:agentId,reason:'The month is already submitted'}),/submitted or locked/);
  await tx`update erp_private.tax_cases set status='Returned' where project_id=${P} and kind='WHT'`;
  await wht('MANAGER',{action:'wht_line_void',line_id:agentId,reason:'Entered against the wrong client'});
  assert.equal((await lines()).some(x=>x.payee_name==='Fictional Agent'),false);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='WITHHOLDING_LINE_REMOVED'`)[0].n,1);
 });
});

test('the purchases screen and the schedule screen are wired to the withholding actions',()=>{
 const acc=fs.readFileSync(root+'/staff-accounting.mjs','utf8'),sch=fs.readFileSync(root+'/staff-withholding.mjs','utf8'),suite=fs.readFileSync(root+'/staff-suite.mjs','utf8'),guide=fs.readFileSync(root+'/staff-guide-text.mjs','utf8');
 assert.match(acc,/wht_row_set/);assert.match(acc,/Withhold tax/);
 for(const a of ['wht_list','wht_line_add','wht_line_void','wht_certificate','ledger_withholding_create'])assert.match(sch,new RegExp(a));
 assert.match(suite,/use_schedule/);assert.match(guide,/withholding/i);
});
