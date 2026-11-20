import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {auditAction}=await import('../supabase/functions/staff-workspace-v12/audit-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('build 2868: an optional Category column is kept on each source row and the review groups rows under it',async t=>{
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
 await t.test('the Category column is read when mapped, trimmed and cut to 80 characters, and absent when not mapped',async()=>{
  const long='X'.repeat(120);
  const d=await doc(PT,'Opening_cat.xlsx',[[...head,'Category'],['B1','Bank','7,000.00','','Current assets'],['P1','Petty cash',1000,'','  Current assets  '],['C1','Share capital','',8000,long]]);
  const made=await ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d,column_map:{...base.column_map,source_category:5},account_overrides:{2:'10020',3:'10010',4:'30000'},mapping_confirmations:{2:true,3:true,4:true}});
  const read=await ledger2('PREP',{action:'ledger_journal_read',period_id:year.period_id,journal_id:made.journal_id});
  const rows=read.journal.source_snapshot.source_rows;assert.equal(rows.length,3);
  assert.equal(rows[0].source_category,'Current assets');assert.equal(rows[1].source_category,'Current assets','spaces are trimmed');assert.equal(rows[2].source_category.length,80);
  const d2=await doc(PT,'Opening_nocat.xlsx',[head,['B1','Bank','7,000.00',''],['C1','Share capital','',7000]]);
  const plain=await ledger2('PREP',{...base,action:'ledger_import_commit',document_id:d2,account_overrides:{2:'10020',3:'30000'},mapping_confirmations:{2:true,3:true}});
  const read2=await ledger2('PREP',{action:'ledger_journal_read',period_id:year.period_id,journal_id:plain.journal_id});
  assert.ok(read2.journal.source_snapshot.source_rows.every(x=>!('source_category' in x)),'no category key when the column is not mapped');
 });
 await t.test('the screen offers the column, guesses it from the header and groups the review rows',()=>{
  const ui=fs.readFileSync(path.join(root,'staff-ledger.mjs'),'utf8');
  assert.match(ui,/source_category:\['category','account category','group','account group','class','account class'\]/);
  assert.match(ui,/const keys=isOpening\?\[\.\.\.openingKeys,'source_category'\]:allKeys;/);
  assert.match(ui,/Category or group \(optional; groups the rows for review\)/);assert.match(ui,/__heading/);assert.match(ui,/No category/);
  assert.match(ui,/standardHeaders=\['source account code'/,'the standard six-column template check is unchanged');
 });
});
