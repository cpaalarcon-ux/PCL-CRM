import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {auditAction}=await import('../supabase/functions/staff-workspace-v12/audit-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('opening TB import reads every row, accepts brackets, reports skipped rows and refuses a bad mapping',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),PT=id(),PA=id(),actors={},sources=new Map();
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDQA','Fictional audit firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['PREP','MANAGER'],['REV','MANAGER']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL AUDIT FLOW LIMITED','P051000001A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-0001 fictional certificate',10,31,${actors.PREP.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PT},${C},${F},'Fictional books','TAX-COMP',${actors.PREP.staff_id}),(${PA},${C},${F},'Fictional audit','AUD-STAT',${actors.PREP.staff_id})`;
 for(const p of [PT,PA])for(const r of ['PREP','REV'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors[r].staff_id},${F},'MANAGER')`;
 await readyForLedger(tx,C);
 async function doc(project,name,rows){const w=new ExcelJS.Workbook(),s=w.addWorksheet('Sheet1');rows.forEach(r=>s.addRow(r));const bytes=Buffer.from(await w.xlsx.writeBuffer()),d=id(),key='qa/'+d,sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');sources.set(key,bytes);
  await as('PREP',a=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${C},${F},${project},'Import Sources',${name},${key},${bytes.length},${sha},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${a.staff_id})`);return d;}
 const audit=(r,p)=>as(r,a=>auditAction(tx,a,p,storage)),ledger=(r,p)=>as(r,a=>ledgerAction(tx,a,{project_id:PT,...p},storage));

 const ledger2=(r,p)=>as(r,a=>ledgerAction(tx,a,{project_id:PT,...p},storage));
 const year=await ledger2('PREP',{action:'ledger_period_create',starts_on:'2026-09-01',ends_on:'2026-10-31'});
 const head=['Source account code','Source account name','Debit (KES)','Credit (KES)'];
 const base={period_id:year.period_id,sheet_name:'Sheet1',header_row:1,kind:'Opening',reference:'OPEN',journal_date:'2026-09-01',column_map:{legacy_code:1,source_name:2,debit:3,credit:4},evidence:'Fictional approved TB',confirm_opening_source:true};

 await t.test('the preview is paged and counts rows by what they are',async()=>{
  const rows=[head];for(let i=1;i<=14;i++)rows.push(['A'+i,'Account '+i,i,0]);rows.push([],['', 'Total',105,0]);
  const d=await doc(PT,'Opening_many.xlsx',rows);
  const first=await ledger2('PREP',{...base,action:'ledger_import_preview',document_id:d});
  assert.equal(first.preview_total,16);assert.equal(first.preview.length,16,'a 16-row sheet is shown whole, not cut at 8');
  assert.equal(first.row_counts.blank_rows,1);assert.equal(first.row_counts.total_or_control_rows,1);assert.equal(first.row_counts.candidate_account_rows,14);
  const page=await ledger2('PREP',{...base,action:'ledger_import_preview',document_id:d,preview_from:12,preview_limit:3});
  assert.equal(page.preview.length,3);assert.equal(page.preview[0].source_row,14);assert.equal(page.preview_offset,12);
 });

 await t.test('brackets and text amounts import; totals, nil and blank rows are listed as skipped with the originals kept',async()=>{
  const d=await doc(PT,'Opening_brackets.xlsx',[head,['B1','Bank','7,000.00',''],['P1','Petty cash','','(1,000.00)'],['C1','Share capital','',8000],['','Total',8000,8000],['N1','Unused account',0,0]]);
  const made=await ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d,account_overrides:{2:'10020',3:'10010',4:'30000'},mapping_confirmations:{2:true,3:true,4:true}});
  assert.equal(made.imported_count,3);assert.equal(made.totals.difference_kes,0);
  assert.equal(made.row_report.imported,3);assert.deepEqual(made.row_report.skipped.map(x=>x.source_row),[5,6]);
  assert.match(made.row_report.skipped[0].reason,/Total/);assert.match(made.row_report.skipped[1].reason,/Nil/);
  assert.equal(made.row_report.converted.find(x=>x.source_row===3).as_debit,1000);assert.equal(made.row_report.converted.find(x=>x.source_row===3).original_credit,'(1,000.00)');
  const read=await ledger2('PREP',{action:'ledger_journal_read',period_id:year.period_id,journal_id:made.journal_id});
  const petty=read.lines.find(x=>x.account_code==='10010');assert.equal(Number(petty.debit),1000);assert.equal(Number(petty.credit),0);
  const saved=(await tx`select source_snapshot from erp_private.ledger_journals where journal_id=${made.journal_id}`)[0].source_snapshot;
  assert.equal(saved.source_rows.find(x=>x.source_row===3).original_credit_text,'(1,000.00)');
 });

 await t.test('a cell that is not a number is refused with the Excel row and column',async()=>{
  const d=await doc(PT,'Opening_text.xlsx',[head,['B1','Bank','abc',0],['C1','Share capital',0,500]]);
  await assert.rejects(()=>ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d,account_overrides:{2:'10020',3:'30000'},mapping_confirmations:{2:true,3:true}}),/Excel row 2, column C \(Debit\): "abc" is not a number/);
 });

 await t.test('profit or loss for the year cannot be mapped to revaluation surplus',async()=>{
  const d=await doc(PT,'Opening_pl.xlsx',[head,['B1','Bank',500,0],['R1','Profit/Loss for the Year',0,500]]);
  await assert.rejects(()=>ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d,account_overrides:{2:'10020',3:'33000'},mapping_confirmations:{2:true,3:true}}),/Excel row 3: "Profit\/Loss for the Year" is the profit or loss for the year, so it cannot go to 33000/);
  const ok=await ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d,account_overrides:{2:'10020',3:'32000'},mapping_confirmations:{2:true,3:true}});
  assert.equal(ok.imported_count,2);
 });
 await t.test('the purchases ledger stops showing rows once their upload is removed from active mapping',async()=>{
  const d=await doc(PT,'Purchases_remove.xlsx',[['x']]),B=id(),R=id();
  await db.exec('set session_replication_role=replica');
  await tx`insert into erp_private.workbook_batches(batch_id,project_id,document_id,sheet_name,header_row,dataset,period_start,period_end,column_map,source_count,new_count,duplicate_count,rejected_count,uploaded_by) values(${B},${PT},${d},'Sheet1',1,'Purchases','2026-09-01','2026-09-30','{}'::jsonb,1,1,0,0,${actors.PREP.staff_id})`;
  await tx`insert into erp_private.workbook_rows(row_id,batch_id,project_id,client_id,dataset,source_row,row_key,raw_values,normalized) values(${R},${B},${PT},${C},'Purchases',2,'k-remove-1','[]'::jsonb,${JSON.stringify({amount:'100',vat:'16',party:'Fictional supplier'})}::jsonb)`;
  await db.exec('set session_replication_role=origin');
  assert.equal((await tx`select count(*)::int n from erp_private.purchase_ledger_items where row_id=${R}`)[0].n,1,'visible while the upload is active');
  await db.exec('set session_replication_role=replica');await tx`update erp_private.workbook_batches set archived_at=now(),archived_by=${actors.PREP.staff_id},archive_reason='Wrong file uploaded' where batch_id=${B}`;await db.exec('set session_replication_role=origin');
  assert.equal((await tx`select count(*)::int n from erp_private.purchase_ledger_items where row_id=${R}`)[0].n,0,'hidden after the upload is removed');
  assert.equal((await tx`select count(*)::int n from erp_private.workbook_rows where row_id=${R}`)[0].n,1,'the row itself is kept for history');
 });
});
