import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {mapAllAccounts,readyForLedger,checkJournal} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {periodImportAction}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const {legacySalesAction}=await import('../supabase/functions/staff-workspace-v12/legacy-sales-actions.ts');
const {recordedCreditBasis,creditBasisIssue}=await import('../supabase/functions/staff-workspace-v12/legacy-sales-lock.ts');
const {bankDepositCheck,BANK_WARN_PERCENT}=await import('../supabase/functions/staff-workspace-v12/sales-bank-check.mjs');
const root=path.resolve(import.meta.dirname,'..');

test('Bank-deposit check: pending, agrees, and a yellow warning either side of the tolerance',()=>{
 assert.equal(bankDepositCheck({salesGross:1000,deposits:0,depositRows:false}).status,'Bank pending');
 assert.equal(bankDepositCheck({salesGross:1000,deposits:1040,depositRows:true}).status,'Agrees');
 const low=bankDepositCheck({salesGross:1000,deposits:900,depositRows:true});assert.equal(low.status,'Warning');assert.match(low.message,/10% below/);assert.match(low.message,/You can continue/);
 const high=bankDepositCheck({salesGross:1000,deposits:1200,depositRows:true});assert.equal(high.status,'Warning');assert.match(high.message,/above/);
 assert.equal(bankDepositCheck({salesGross:0,deposits:50,depositRows:true}).percent,100);assert.equal(BANK_WARN_PERCENT,5);
 assert.equal(creditBasisIssue('After credit notes','Before credit notes').includes('After credit notes'),true);assert.equal(creditBasisIssue(null,'Before credit notes'),null);assert.equal(creditBasisIssue('After credit notes','After credit notes'),null);
});
test('Sales slice: replace old sales (counts, draft reversal, archive), credit-note lock and the bank-deposit prompt',async t=>{
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
 const legacy=(role,p)=>as(role,a=>legacySalesAction(tx,a,{project_id:P,starts_on:'2026-01-01',ends_on:'2026-12-31',...p},null));
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await db.exec('alter table erp_private.projects disable trigger user');await tx`update erp_private.projects set status='Active' where project_id=${P}`;await db.exec('alter table erp_private.projects enable trigger user');
 const PERIOD=id(),J=id(),B1=id(),B2=id();
 const codes=(await tx`select code from erp_private.account_catalog where status='Active' and not is_legacy order by code limit 2`).map(r=>r.code);
 await tx`insert into erp_private.ledger_periods(period_id,project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${PERIOD},${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional verified incorporation',${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B1},${P},${D},'Sales Q1',1,'Sales','2026-01-01','2026-03-31','{}',3,3,0,0,${actors.ASSISTANT.staff_id})`;
 const rowIds=[];
 for(const [n,[inv,net,vat]] of [['INV-1',1000,160],['INV-2',2000,320],['INV-3',500,0]].entries())rowIds.push((await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B1},${P},${C},'Sales',${n+2},${'S-'+inv},'{}',${tx.json({date:'2026-02-1'+n,invoice:inv,amount:net,vat,gross:net+vat})}) returning row_id`)[0].row_id);
 for(const t of ['ledger_journals','ledger_lines'])await db.exec(`alter table erp_private.${t} disable trigger user`);
 await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,description,status,generated,prepared_by,last_prepared_by,reviewed_by,posted_at) values(${J},${PERIOD},${P},'Sales','2026-03-31','GL-SALES-Q1','Fictional sales journal','Posted',true,${actors.ASSISTANT.staff_id},${actors.ASSISTANT.staff_id},${actors.MANAGER.staff_id},now())`;
 await tx`insert into erp_private.ledger_lines(journal_id,project_id,line_no,account_code,debit,credit) values(${J},${P},1,${codes[0]},3980,0),(${J},${P},2,${codes[1]},0,3980)`;
 for(const t of ['ledger_journals','ledger_lines'])await db.exec(`alter table erp_private.${t} enable trigger user`);
 for(const r of rowIds.slice(0,2))await tx`insert into erp_private.ledger_sources(source_kind,source_key,journal_id,project_id,source_revision) values('Workbook row',${r},${J},${P},1)`;

 await t.test('read: counts, the posted journal without a reversal, and the next step',async()=>{
  const v=await legacy('MANAGER',{action:'sales_legacy_read'});
  assert.equal(v.step,'prepare');assert.equal(v.totals.rows,3);assert.equal(v.totals.net,3500);assert.equal(v.totals.vat,480);assert.equal(v.totals.gross,3980);
  assert.equal(v.batches.length,1);assert.equal(v.journals.length,1);assert.equal(v.journals[0].status,'Posted');assert.equal(v.journals[0].reversal_id,null);assert.deepEqual(v.issues,[]);
  await assert.rejects(()=>legacy('INTERN',{action:'sales_legacy_read'}),/Interns/);
  const narrow=await legacy('MANAGER',{action:'sales_legacy_read',starts_on:'2026-02-01',ends_on:'2026-03-31'});
  assert.equal(narrow.step,'blocked');assert.match(narrow.issues[0],/covers 2026-01-01 to 2026-03-31/);
  assert.equal((await legacy('MANAGER',{action:'sales_legacy_read',starts_on:'2025-01-01',ends_on:'2025-12-31'})).step,'none');
 });
 await t.test('prepare: Manager or Partner only, credit-note answer first, counts confirmed, then a draft reversal appears',async()=>{
  const good={action:'sales_legacy_prepare',credit_basis:'After credit notes',reason:'Category totals replace the old invoice list',expected_rows:3,confirm:true};
  await assert.rejects(()=>legacy('ASSISTANT',good),/Manager or Partner/);
  await assert.rejects(()=>legacy('MANAGER',{...good,credit_basis:''}),/valid option/);
  await assert.rejects(()=>legacy('MANAGER',{...good,reason:'short'}),/at least 10/);
  await assert.rejects(()=>legacy('MANAGER',{...good,expected_rows:2}),/number of old rows changed/);
  await assert.rejects(()=>legacy('MANAGER',{...good,confirm:false}),/Confirm that you checked/);
  assert.equal((await tx`select count(*)::int n from erp_private.legacy_sales_replacements`)[0].n,0,'refusals record nothing');
  const r=await legacy('MANAGER',good);
  assert.equal(r.reversals.length,1);assert.match(r.next,/different Manager or Partner/);
  const rev=(await tx`select * from erp_private.ledger_journals where journal_id=${r.reversals[0].reversal_id}`)[0];
  assert.equal(rev.kind,'Reversal');assert.equal(rev.status,'Draft');assert.equal(rev.reversal_of,J);assert.equal(rev.prepared_by,actors.MANAGER.staff_id);
  const lines=await tx`select account_code,debit,credit from erp_private.ledger_lines where journal_id=${rev.journal_id} order by line_no`;
  assert.deepEqual(lines.map(l=>[l.account_code,Number(l.debit),Number(l.credit)]),[[codes[0],0,3980],[codes[1],3980,0]],'debits and credits are swapped');
  const rec=(await tx`select * from erp_private.legacy_sales_replacements`)[0];assert.equal(rec.status,'Open');assert.equal(rec.row_count,3);assert.equal(Number(rec.gross),3980);assert.equal(rec.credit_basis,'After credit notes');
  await assert.rejects(()=>legacy('MANAGER',good),/already in progress/);
  assert.equal((await legacy('MANAGER',{action:'sales_legacy_read'})).step,'waiting');
  await assert.rejects(()=>legacy('MANAGER',{action:'sales_legacy_complete'}),/not posted yet/);
  await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.legacy_sales_replacements set row_count=1`),/cannot change/);
  assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='SALES_REPLACEMENT_PREPARED'`)[0].n,1);
 });
 await t.test('the reversal is reviewed by someone other than its preparer in the normal journal flow',async()=>{
  const rev=(await tx`select journal_id from erp_private.ledger_journals where reversal_of=${J}`)[0].journal_id;
  await assert.rejects(()=>as('MANAGER',a=>ledgerAction(tx,a,{action:'ledger_journal_review',project_id:P,period_id:PERIOD,journal_id:rev,revision:1,status:'Posted',review_note:'Reviewed by the same person'},null)),/different Manager or Partner|must be submitted|Submit/i);
  // Posting by a reviewer is simulated here; the review rule itself is covered by the journal tests.
  await db.exec('alter table erp_private.ledger_journals disable trigger user');await tx`update erp_private.ledger_journals set status='Posted',reviewed_by=${actors.PARTNER.staff_id},posted_at=now() where journal_id=${rev}`;await db.exec('alter table erp_private.ledger_journals enable trigger user');
  const v=await legacy('MANAGER',{action:'sales_legacy_read'});assert.equal(v.step,'archive');assert.equal(v.journals[0].reversal_status,'Posted');
 });
 await t.test('complete: archives the old batches, keeps the rows, and closes the record',async()=>{
  await assert.rejects(()=>legacy('ASSISTANT',{action:'sales_legacy_complete'}),/Manager or Partner/);
  const r=await legacy('PARTNER',{action:'sales_legacy_complete'});assert.equal(r.archived_batches,1);assert.equal(r.rows,3);assert.equal(r.credit_basis,'After credit notes');
  const b=(await tx`select archived_at,archived_by,archive_reason from erp_private.workbook_batches where batch_id=${B1}`)[0];assert.ok(b.archived_at);assert.equal(b.archived_by,actors.PARTNER.staff_id);assert.match(b.archive_reason,/Replaced by category totals/);
  assert.equal((await tx`select count(*)::int n from erp_private.workbook_rows where batch_id=${B1}`)[0].n,3,'rows are kept');
  const rec=(await tx`select * from erp_private.legacy_sales_replacements`)[0];assert.equal(rec.status,'Complete');assert.equal(rec.completed_by,actors.PARTNER.staff_id);
  await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.legacy_sales_replacements set reason='Changed after the fact'`),/cannot be changed/);
  assert.equal((await legacy('MANAGER',{action:'sales_legacy_read'})).step,'none');
  const unchanged=async fn=>{try{return (await as('PARTNER',fn)).length===0;}catch{return true;}};
  assert.ok(await unchanged(()=>tx`update erp_private.workbook_batches set archive_reason='Edited later' where batch_id=${B1} returning batch_id`),'an archived batch is frozen');
  const B3=id();await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B3},${P},${D},'Live batch',1,'Bank','2027-01-01','2027-01-31','{}',0,0,0,0,${actors.ASSISTANT.staff_id})`;
  assert.ok(await unchanged(()=>tx`update erp_private.workbook_batches set sheet_name='Edited' where batch_id=${B3} returning batch_id`),'a live batch cannot be edited by staff');
  await assert.rejects(()=>db.query(`update erp_private.workbook_batches set sheet_name='Edited' where batch_id=$1`,[B3]),/cannot be edited/,'the database guard itself refuses an edit');
  await db.query(`update erp_private.workbook_batches set archived_at=now(),archived_by=$1,archive_reason='Guard allows archiving' where batch_id=$2`,[actors.PARTNER.staff_id,B3]);
  await assert.rejects(()=>legacy('PARTNER',{action:'sales_legacy_complete'}),/Prepare the replacement first/);
 });
 await t.test('new totals: the credit-note answer must match, the legacy gate has cleared, and the bank prompt is shown without blocking',async()=>{
  assert.equal(await as('ASSISTANT',()=>recordedCreditBasis(tx,P,'2026-01-01','2026-03-31')),'After credit notes');
  assert.equal(await as('ASSISTANT',()=>recordedCreditBasis(tx,P,'2027-01-01','2027-03-31')),null);
  const src=await doc('Sales-totals.csv','Sales category,Net sales,Output VAT\n16%,3000,480\n8%,0,0\n0%,0,0\nExempt,500,0');
  const base={action:'period_import_preview',kind:'Sales',document_id:src,starts_on:'2026-01-01',ends_on:'2026-03-31',notes:'Fictional totals'};
  const wrong=await imp('ASSISTANT',{...base,credit_basis:'Before credit notes',credits:{'16%':{net:0,vat:0},'8%':{net:0,vat:0},'0%':{net:0,vat:0},Exempt:{net:0,vat:0}}});
  assert.ok(wrong.payload.issues.some(x=>/same answer/.test(x)),'a different answer is refused');
  const pending=await imp('ASSISTANT',{...base,credit_basis:'After credit notes'});
  assert.deepEqual(pending.payload.issues,[]);assert.equal(pending.bank_check.status,'Bank pending');
  await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B2},${P},${D},'Bank Q1',1,'Bank','2026-01-01','2026-03-31','{}',2,2,0,0,${actors.ASSISTANT.staff_id})`;
  await tx`insert into erp_private.workbook_rows(batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${B2},${P},${C},'Bank',2,'B-1','{}',${tx.json({date:'2026-02-10',credit:2000,debit:0,reference:'DEP-1'})}),(${B2},${P},${C},'Bank',3,'B-2','{}',${tx.json({date:'2026-03-10',credit:1500,debit:0,reference:'DEP-2'})})`;
  const warn=await imp('ASSISTANT',{...base,credit_basis:'After credit notes'});
  assert.equal(warn.bank_check.status,'Warning');assert.equal(warn.bank_check.sales_gross,3980);assert.equal(warn.bank_check.deposits,3500);assert.equal(warn.bank_check.difference,-480);assert.deepEqual(warn.payload.issues,[],'the prompt never blocks');
  assert.equal(warn.source_hash,pending.source_hash,'the prompt is not part of the saved hash');
  const saved=await imp('ASSISTANT',{...base,credit_basis:'After credit notes',action:'period_import_save',preview_hash:warn.source_hash,confirmed_client_id:C,replaces_ids:[]});
  assert.ok(saved.import_id);
 });
 await t.test('wiring: rights, screens and the credit-note question first',()=>{
  const cat=fs.readFileSync(root+'/staff-rights-catalog.mjs','utf8');assert.match(cat,/acct\.sales_replace[\s\S]*sales_legacy_complete/);
  assert.equal(cat,fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/staff-rights-catalog.mjs','utf8'));
  const imports=fs.readFileSync(root+'/staff-period-imports.mjs','utf8');
  assert.ok(imports.indexOf("'credit_basis'")<imports.indexOf("'document_id'"),'the credit-note answer comes before the file');
  assert.match(imports,/credit_basis\.required=true/);assert.match(imports,/Replace old sales/);assert.match(imports,/x\.bank_check/);assert.match(imports,/yellow-note/);
  const ui=fs.readFileSync(root+'/staff-sales-replace.mjs','utf8');for(const k of ['sales_legacy_read','sales_legacy_prepare','sales_legacy_complete','expected_rows','credit_basis'])assert.match(ui,new RegExp(k));
  assert.match(fs.readFileSync(root+'/staff-pilot.css','utf8'),/\.yellow-note\.is-warning/);
 });
});
