import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {readyForLedger} from './helpers/client-mappings.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {auditAction}=await import('../supabase/functions/staff-workspace-v12/audit-actions.ts');
const {ledgerAction}=await import('../supabase/functions/staff-workspace-v12/ledger-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('audit TB staging (import, map, confirm, comparative) and opening TB account choices work end to end',async t=>{
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

 await t.test('audit TB: current and comparative import, mapping and confirmation by a different leader',async()=>{
  const file=await audit('PREP',{action:'audit_file_save',project_id:PA,starts_on:'2025-11-01',ends_on:'2026-10-31',file_type:'First-year',reporting_framework:'IFRS for SMEs'});
  await audit('PARTNER',{action:'audit_framework_approve',audit_file_id:file.audit_file_id,revision:(await tx`select revision from erp_private.audit_files where audit_file_id=${file.audit_file_id}`)[0].revision});
  for(const [kind,rows] of [['Current',[['1010','Bank',500,0],['3000','Share capital',0,500]]],['Comparative',[['1010','Bank',400,0],['3000','Share capital',0,400]]]]){
   const d=await doc(PA,`TB_${kind}.xlsx`,[['Account code','Account name','Debit','Credit'],...rows]),cfg={audit_file_id:file.audit_file_id,source_document_id:d,header_row:1,first_data_row:2,legacy_account_code:1,legacy_account_name:2,debit:3,credit:4,period_kind:kind};
   assert.equal((await audit('PREP',{action:'audit_tb_preview',...cfg})).balanced,true);
   const imp=await audit('PREP',{action:'audit_tb_import',...cfg,confirmed:true});assert.equal(imp.row_count,2);
   const lines=await tx`select audit_tb_line_id,legacy_account_code,audit_account_id from erp_private.audit_tb_lines where audit_tb_import_id=${imp.audit_tb_import_id}`;
   const revision=()=>tx`select revision from erp_private.audit_tb_imports where audit_tb_import_id=${imp.audit_tb_import_id}`.then(r=>r[0].revision);
   for(const l of lines.filter(x=>!x.audit_account_id))await audit('PREP',{action:'audit_tb_map',audit_tb_line_id:l.audit_tb_line_id,revision:await revision(),audit_area:l.legacy_account_code==='1010'?'Cash and bank':'Equity',financial_statement_line:l.legacy_account_code==='1010'?'Assets':'Equity'});
   await audit('REV',{action:'audit_tb_confirm',audit_tb_import_id:imp.audit_tb_import_id,revision:await revision()});
   assert.equal((await tx`select status from erp_private.audit_tb_imports where audit_tb_import_id=${imp.audit_tb_import_id}`)[0].status,'Confirmed');
  }
  const w=await audit('REV',{action:'audit_workspace',project_id:PA});assert.equal(w.readiness.current_tb_confirmed,true);assert.equal(w.readiness.all_lines_mapped,true);
 });

 await t.test('opening TB: the ERP account chosen on the import screen is applied, and income/expense lines are named',async()=>{
  const chart=await as('PREP',a=>tx`select 1`);void chart;
  const year=await ledger('PREP',{action:'ledger_period_create',starts_on:'2026-09-01',ends_on:'2026-10-31'});
  const rows=[['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)'],['B1','Bank','ASSET','10020',1000,0],['C1','Capital','EQUITY','30000',0,1000]];
  const base={period_id:year.period_id,sheet_name:'Sheet1',header_row:1,kind:'Opening',reference:'OPEN',journal_date:'2026-09-01',column_map:{legacy_code:1,source_name:2,routing_code:3,tb_item_code:4,debit:5,credit:6},evidence:'Fictional approved TB',confirm_opening_source:true};
  const bad=await doc(PT,'Opening_bad.xlsx',[...rows,['S1','Sales','REV','40000',0,50],['E1','Rent','EXP01','61000',50,0]]);
  await assert.rejects(()=>ledger('PREP',{...base,action:'ledger_import_commit',document_id:bad,account_overrides:{2:'10020',3:'30000',4:'40000',5:'61000'},mapping_confirmations:{2:true,3:true,4:true,5:true}}),/2 line\(s\) use an income or expense account: line 3 \(S1 Sales → ERP 40000\); line 4 \(E1 Rent → ERP 61000\)/);
  const good=await doc(PT,'Opening_good.xlsx',rows);
  const unconfirmed=await ledger('PREP',{...base,action:'ledger_import_preview',document_id:good});assert.equal(unconfirmed.headers.length,6);
  const made=await ledger('PREP',{...base,action:'ledger_import_commit',document_id:good,account_overrides:{2:'10020',3:'30000'},mapping_confirmations:{2:true,3:true}});
  const j=async()=>(await ledger('PREP',{action:'ledger_journal_read',period_id:year.period_id,journal_id:made.journal_id}));
  let read=await j();assert.deepEqual(read.lines.map(x=>x.account_code).sort(),['10020','30000']);assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C} and status='Draft'`)[0].n,2);
  await ledger('PREP',{action:'ledger_journal_submit',period_id:year.period_id,journal_id:made.journal_id,revision:read.journal.revision});read=await j();
  await assert.rejects(()=>ledger('PREP',{action:'ledger_journal_review',period_id:year.period_id,journal_id:made.journal_id,revision:read.journal.revision,status:'Posted',review_note:'Self approval attempt'}),/different|independent|prepared/i);
  await ledger('REV',{action:'ledger_journal_review',period_id:year.period_id,journal_id:made.journal_id,revision:read.journal.revision,status:'Posted',review_note:'Fictional independent check of the opening TB'});
  assert.equal((await tx`select count(*)::int n from erp_private.client_account_mappings where client_id=${C} and status='Active' and source_account_code in ('B1','C1')`)[0].n,2,'the mappings become Active when a different leader posts');
 });
});
