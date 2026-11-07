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
const {orphanCreditAction}=await import('../supabase/functions/staff-workspace-v12/orphan-credit-actions.ts');
const {ageingReport,clientRequestText}=await import('../supabase/functions/staff-workspace-v12/credit-ageing.mjs');
const {pendingPurchases}=await import('../supabase/functions/staff-workspace-v12/purchase-pending.ts');
test('Credit-note ageing counts from the credit note date and splits by bucket and supplier',()=>{
 const row=(d,g,party='Fictional Supplier')=>({rejection_id:d,normalized:{date:d,invoice:'CN-'+d,party,party_pin:'P1',amount:g,vat:0,gross:g},file_name:'f.xlsx',source_row:2});
 const r=ageingReport([row('2026-11-01',-100),row('2026-10-01',-200),row('2026-09-01',-300,'Other Supplier'),row('2026-07-01',-400),{normalized:{date:'bad',amount:-5,vat:0},file_name:'f',source_row:9}],'2026-11-06');
 assert.deepEqual(r.buckets.map(b=>[b.label,b.count]),[['0–30 days',1],['31–60 days',1],['61–90 days',1],['Over 90 days',1],['Date not readable',1]]);
 assert.equal(r.overdue.count,3);assert.equal(r.overdue.gross,-900);assert.equal(r.overdue.oldest_days,128);
 assert.equal(r.suppliers.length,3);assert.equal(r.suppliers[0].oldest_days,128);assert.equal(r.rows[0].credit_note,'CN-2026-07-01');
 assert.match(clientRequestText('Fictional Client',r.rows,'2026-11-06','Fictional Firm'),/original purchase invoice number and its date/);
 assert.throws(()=>ageingReport([],'bad'));
});
test('Orphan purchase credit notes: ageing, client request, daily alert and the VAT disclosure',async t=>{
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
 const held=async fn=>{let changed=0;try{changed=(await as('ASSISTANT',fn)).length;}catch{return true;}return changed===0;};
 const {withholdingAction}=await import('../supabase/functions/staff-workspace-v12/withholding-actions.ts');
 const wht=(role,p)=>as(role,a=>withholdingAction(tx,a,{project_id:P,...p}));
 const ledger=(role,p)=>as(role,a=>ledgerAction(tx,a,{project_id:P,...p},storage));
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional legal company evidence',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await readyForLedger(tx,C);
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${P},${D},'Purchases',1,'Purchases','2026-10-01','2026-10-31','{}',5,5,0,0,${actors.ASSISTANT.staff_id})`;
 let n=1;
 const orphan=(role,p,pr=P)=>as(role,a=>orphanCreditAction(tx,a,{project_id:pr,...p}));
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date()),ago=d=>new Date(Date.parse(today+'T00:00:00Z')-d*86400000).toISOString().slice(0,10);
 await db.exec('alter table erp_private.projects disable trigger user');await tx`update erp_private.projects set status='Active' where project_id=${P}`;await db.exec('alter table erp_private.projects enable trigger user');
 const pend=async(key,date,gross,party='Fictional Supplier')=>{n++;const row={date,invoice:'CN-'+key,party,party_pin:'A000000041A',description:'Credit note',amount:gross,vat:0,gross,vat_category:'Exempt',purchase_type:'Credit note'},match={date,invoice:'CN-'+key,party,amount:gross,gross};
  await tx`insert into erp_private.workbook_rejections(batch_id,source_row,reason,raw_values) values(${B},${n},'Pending information: original invoice',${tx.json({_pending_purchase:{key:'K-'+key,match,row}})})`;return {key:'K-'+key,match,row};};
 const c1=await pend('A',ago(5),-1000),c2=await pend('B',ago(40),-2000,'Second Supplier'),c3=await pend('C',ago(100),-3000);
 const sqlRows=async()=>tx`select project_id,credit_date,gross from erp_private.outstanding_pending_credits() where project_id=${P} order by credit_date`;

 await t.test('ageing report: buckets, suppliers and the overdue count',async()=>{
  const r=await orphan('ASSISTANT',{action:'purchase_ledger_credit_ageing'});
  assert.equal(r.total,3);assert.equal(r.gross,-6000);assert.equal(r.report.overdue.count,2);assert.equal(r.report.overdue.gross,-5000);assert.equal(r.report.overdue.oldest_days,100);
  assert.deepEqual(r.report.buckets.map(b=>b.count),[1,1,0,1]);assert.equal(r.report.suppliers.length,2);assert.equal(r.last_request,null);
  assert.match(r.disclosure,/No suspense liability/);
  await assert.rejects(()=>orphan('INTERN',{action:'purchase_ledger_credit_ageing'}),/Interns/);
  await assert.rejects(()=>orphan('ASSISTANT',{action:'purchase_ledger_credit_ageing'},P2),/unavailable/);
 });
 await t.test('client request: list and message prepared, logged once, never editable',async()=>{
  const out=await orphan('ASSISTANT',{action:'purchase_ledger_credit_request'});
  assert.equal(out.count,3);assert.match(out.message,/Fictional purchase ledger client/);assert.match(out.note,/Nothing has been sent/);
  const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook();await book.xlsx.load(Buffer.from(out.base64,'base64'));const sh=book.worksheets[0];
  assert.equal(sh.rowCount,6);assert.equal(sh.getRow(3).getCell(9).value,'Original invoice number');assert.equal(sh.getRow(4).getCell(1).value,'CN-C');
  const logged=await tx`select credit_count,gross_amount,oldest_credit_date from erp_private.credit_note_requests where project_id=${P}`;assert.equal(logged.length,1);assert.equal(Number(logged[0].gross_amount),-6000);
  assert.equal(await held(()=>tx`update erp_private.credit_note_requests set message='changed to something else entirely' where project_id=${P} returning 1`),true);
  assert.equal(await held(()=>tx`delete from erp_private.credit_note_requests where project_id=${P} returning 1`),true);
  const again=await orphan('MANAGER',{action:'purchase_ledger_credit_ageing'});assert.equal(again.last_request.credit_count,3);
  await assert.rejects(()=>orphan('INTERN',{action:'purchase_ledger_credit_request'}),/Interns/);
 });
 await t.test('the SQL scan agrees with the screen and the alert is raised once',async()=>{
  assert.equal((await sqlRows()).length,3);
  assert.equal(Number((await tx`select run_n from (select erp_private.run_orphan_credit_alerts() run_n) x`)[0].run_n),1);
  const tasks=await tx`select task_id,assigned_to,status,recurring_key,description from erp_private.tasks where project_id=${P} and recurring_key like 'orphan-credit:%'`;
  assert.equal(tasks.length,1);assert.equal(tasks[0].status,'Pending');assert.match(tasks[0].description,/2 purchase credit note/);assert.match(tasks[0].description,/more than 30 days/);
  const notes=await tx`select recipient_id from erp_private.notifications where event_key like ${'orphan-credit:'+P+'%'}`;assert.ok(notes.length>=1);assert.ok(notes.some(x=>x.recipient_id===actors.MANAGER.staff_id));
  assert.equal(Number((await tx`select run_n from (select erp_private.run_orphan_credit_alerts() run_n) x`)[0].run_n),0);
  assert.equal((await tx`select 1 from erp_private.tasks where project_id=${P} and recurring_key like 'orphan-credit:%'`).length,1);
  assert.equal((await tx`select 1 from erp_private.notifications where event_key like ${'orphan-credit:'+P+'%'}`).length,notes.length);
 });
 await t.test('a credit stops being pending once the original invoice and date are supplied',async()=>{
  n++;await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${n},${c2.key},'{}',${tx.json({...c2.row,original_invoice:'INV-ORIG-9',original_invoice_date:ago(60)})})`;
  const r=await orphan('ASSISTANT',{action:'purchase_ledger_credit_ageing'});assert.equal(r.total,2);assert.equal(r.report.overdue.count,1);
  assert.equal((await sqlRows()).length,2);
  // An original invoice with no date is not enough.
  n++;await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B},${P},${C},'Purchases',${n},${c3.key},'{}',${tx.json({...c3.row,original_invoice:'INV-ORIG-10'})})`;
  assert.equal((await orphan('ASSISTANT',{action:'purchase_ledger_credit_ageing'})).total,2);assert.equal((await sqlRows()).length,2);
  const direct=await as('ASSISTANT',()=>pendingPurchases(tx,P));assert.equal(direct.total,2);
 });
 await t.test('the VAT working says what was left out',async()=>{
  const oldDeno=globalThis.Deno;globalThis.Deno={env:{get:()=>'https://yfjiculexbzpkvtapudk.supabase.co'}};let sum;
  try{sum=await as('ASSISTANT',()=>taxSummary(tx,{case_id:id(),project_id:P,kind:'VAT',status:'Draft',starts_on:'2026-01-01',ends_on:'2026-12-31',inputs:{}}));}finally{globalThis.Deno=oldDeno;}
  assert.equal(sum.pending_information.total,2);
  const issue=sum.issues.find(x=>/Pending information/.test(x));assert.ok(issue,'a blocking issue names the pending credit notes');
  assert.match(issue,/net KES -?\d/);assert.match(issue,/gross KES -4000\.00/);assert.match(issue,/older than 30 days/);assert.match(issue,/incomplete/);
 });
 await t.test('wiring: screens, rights and the export carry the disclosure',()=>{
  const src=f=>fs.readFileSync(path.join(root,f),'utf8');
  assert.match(src('staff-purchase-ledgers.mjs'),/data-credit-age="open"/);assert.match(src('staff-accounting.mjs'),/data-credit-age="open"/);
  assert.match(src('staff-workspace-v6.mjs'),/createCreditAgeingUI\(ctx\)/);assert.match(src('supabase/functions/staff-workspace-v12/index.ts'),/orphanCreditAction\(tx,a,p\)/);
  const exp=src('supabase/functions/staff-workspace-v12/suite-export.ts');assert.match(exp,/Pending credit notes/);assert.match(exp,/no liability or suspense balance is recorded/);
  assert.match(src('staff-credit-ageing.mjs'),/purchase_ledger_credit_request/);
 });
});
test('every help panel named in the screens exists',async()=>{
 const {GUIDE}=await import('../staff-guide-text.mjs');
 for(const f of fs.readdirSync(root).filter(x=>/^staff-.*\.mjs$/.test(x))){for(const m of fs.readFileSync(path.join(root,f),'utf8').matchAll(/guideBanner\([^;]*?GUIDE\.(\w+)/g))assert.ok(Array.isArray(GUIDE[m[1]]),`${f} uses GUIDE.${m[1]}, which is missing`);}
});
