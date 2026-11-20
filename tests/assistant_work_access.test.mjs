import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const ExcelJS=require(require.resolve('exceljs',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {auditAction}=await import('../supabase/functions/staff-workspace-v12/audit-actions.ts');
const root=path.resolve(import.meta.dirname,'..');

test('an Audit Assistant sees and prepares assigned work but cannot change client details or approve',async t=>{
 const db=new PGlite();t.after(()=>db.close());const id=()=>crypto.randomUUID(),F=id(),C=id(),PA=id(),actors={},sources=new Map();
 const tx=async(parts,...v)=>(await db.query(parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),''),v)).rows;tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
 const storage={download:async key=>({data:new Blob([sources.get(key)])})};
 async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort())await db.exec(fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,''));
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'ASQ','Fictional assistant firm')`;
 for(const [role,cat] of [['PARTNER','PARTNER'],['MGR','MANAGER'],['ASST','ASSISTANT']]){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2030-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id,is_uat_fixture) values(${C},'UAT FICTIONAL ASSISTANT TEST LIMITED','P051000009A','Wholesale & Retail','Nairobi','Limited company','CR-FICTIONAL-9',10,31,${actors.MGR.staff_id},true)`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.client_contacts(client_id,full_name,role_in_decision) values(${C},'Fictional Contact','Decision Maker')`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${PA},${C},${F},'Fictional audit','AUD-STAT',${actors.MGR.staff_id})`;
 for(const r of ['MGR','ASST'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${PA},${actors[r].staff_id},${F},${actors[r].category_code})`;
 const task=(await tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${PA},${actors.ASST.staff_id},'Prepare audit trial balances') returning task_id`)[0].task_id;

 await t.test('assigned client and work are visible; client details cannot be changed',async()=>{
  assert.equal((await as('ASST',()=>tx`select client_id from erp_private.clients where client_id=${C}`)).length,1,'sees the assigned client');
  assert.equal((await as('ASST',()=>tx`select task_id from erp_private.tasks where task_id=${task}`)).length,1,'sees the assigned task');
  assert.equal((await as('ASST',()=>tx`select contact_id from erp_private.client_contacts where client_id=${C}`)).length,1,'sees contacts');
  assert.equal((await as('ASST',()=>tx`update erp_private.clients set company_name='UAT FICTIONAL CHANGED' where client_id=${C} returning client_id`)).length,0,'cannot rename the client');
  assert.equal((await as('ASST',()=>tx`update erp_private.client_contacts set full_name='Changed' where client_id=${C} returning contact_id`)).length,0,'cannot change a contact');
  await assert.rejects(()=>as('ASST',()=>tx`insert into erp_private.client_contacts(client_id,full_name) values(${C},'Another')`),/policy|violates/);
  await assert.rejects(()=>as('ASST',()=>tx`insert into erp_private.beneficial_owners(client_id,full_name,ownership_percentage) values(${C},'Owner',10)`),/policy|violates/);
  assert.equal((await as('MGR',()=>tx`update erp_private.clients set company_name='UAT FICTIONAL ASSISTANT TEST LTD' where client_id=${C} returning client_id`)).length,1,'a Manager can');
 });
 await t.test('the Assistant imports and maps the audit trial balance; a Manager confirms',async()=>{
  const file=await as('MGR',a=>auditAction(tx,a,{action:'audit_file_save',project_id:PA,starts_on:'2025-11-01',ends_on:'2026-10-31',file_type:'First-year',reporting_framework:'IFRS for SMEs'},storage));
  await as('PARTNER',async a=>auditAction(tx,a,{action:'audit_framework_approve',audit_file_id:file.audit_file_id,revision:(await tx`select revision from erp_private.audit_files where audit_file_id=${file.audit_file_id}`)[0].revision},storage));
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('Sheet1');[['Account code','Account name','Debit','Credit'],['1010','Bank',500,0],['3000','Share capital',0,500]].forEach(r=>s.addRow(r));
  const bytes=Buffer.from(await w.xlsx.writeBuffer()),d=id(),key='qa/'+d,sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');sources.set(key,bytes);
  await assert.rejects(()=>as('ASST',a=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${id()},${C},${F},${PA},'Import Sources','x.xlsx','qa/x',1,${'c'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${a.staff_id})`),/policy|violates/,'an upload needs a task assigned to the Assistant');
  await as('ASST',a=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${C},${F},${PA},${task},'Import Sources','TB.xlsx',${key},${bytes.length},${sha},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${a.staff_id})`);
  const cfg={audit_file_id:file.audit_file_id,source_document_id:d,header_row:1,first_data_row:2,legacy_account_code:1,legacy_account_name:2,debit:3,credit:4,period_kind:'Current'};
  assert.equal((await as('ASST',a=>auditAction(tx,a,{action:'audit_tb_preview',...cfg},storage))).balanced,true);
  const imp=await as('ASST',a=>auditAction(tx,a,{action:'audit_tb_import',...cfg,confirmed:true},storage));assert.equal(imp.row_count,2);
  const rev=()=>tx`select revision from erp_private.audit_tb_imports where audit_tb_import_id=${imp.audit_tb_import_id}`.then(r=>r[0].revision);
  for(const l of await tx`select audit_tb_line_id,legacy_account_code from erp_private.audit_tb_lines where audit_tb_import_id=${imp.audit_tb_import_id}`)await as('ASST',async a=>auditAction(tx,a,{action:'audit_tb_map',audit_tb_line_id:l.audit_tb_line_id,revision:await rev(),audit_area:l.legacy_account_code==='1010'?'Cash and bank':'Equity',financial_statement_line:l.legacy_account_code==='1010'?'Assets':'Equity'},storage));
  await assert.rejects(()=>as('ASST',async a=>auditAction(tx,a,{action:'audit_tb_confirm',audit_tb_import_id:imp.audit_tb_import_id,revision:await rev()},storage)),/Manager or Engagement Partner/);
  await as('MGR',async a=>auditAction(tx,a,{action:'audit_tb_confirm',audit_tb_import_id:imp.audit_tb_import_id,revision:await rev()},storage));
  assert.equal((await tx`select status from erp_private.audit_tb_imports where audit_tb_import_id=${imp.audit_tb_import_id}`)[0].status,'Confirmed');
 });
});
