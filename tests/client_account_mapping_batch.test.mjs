import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ExcelJS from 'exceljs';

const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {improvementAction}=await import('../supabase/functions/staff-workspace-v12/improvement-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),DOC=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const storage={download:async key=>key===`qa/${DOC}`?{data:new Blob([workbookBytes]),error:null}:{data:null,error:new Error('missing')}};
let workbookBytes;
const call=(role,p)=>as(role,a=>improvementAction(tx,a,p,storage));

test('TB mappings are previewed, checked, drafted together and independently approved as a batch',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'MAPQA','Fictional mapping QA firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional Mapping Client',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const account=(await tx`select code,name,category_code from erp_private.account_catalog where code='10000' and status='Active' and not is_legacy`)[0];assert.ok(account);
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Opening TB');
 sheet.addRow(['Source account code','Source account name','ERP routing code','ERP TB item code','Debit (KES)','Credit (KES)']);
 sheet.addRow(['CASH-OPEN','Cash at bank',account.category_code,account.code,1000,0]);
 sheet.addRow(['BAD-ROUTE','Misrouted account','WRONG',account.code,0,100]);
 sheet.addRow(['BAD-CODE','Inactive account',account.category_code,'99999',0,100]);
 workbookBytes=new Uint8Array(await book.xlsx.writeBuffer());
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,import_purpose,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${DOC},${C},${F},'Import Sources','Opening TB','Fictional_Opening_TB.xlsx',${'qa/'+DOC},${workbookBytes.length},${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;

 const preview=await call('MANAGER',{action:'v3_client_account_mapping_tb_preview',client_id:C,document_id:DOC,effective_from:'2026-01-01'});
 assert.equal(preview.ready_count,1);assert.equal(preview.exception_count,2);assert.equal(preview.proposals.find(x=>x.source_account_code==='BAD-ROUTE').state,'Exception');assert.equal(preview.proposals.find(x=>x.source_account_code==='BAD-CODE').state,'Exception');
 await assert.rejects(()=>call('MANAGER',{action:'v3_client_account_mapping_tb_save',client_id:C,document_id:DOC,effective_from:'2026-01-01',source_rows:['3'],preview_fingerprint:preview.preview_fingerprint}),/Only valid, unmapped TB rows/);
 const saved=await call('MANAGER',{action:'v3_client_account_mapping_tb_save',client_id:C,document_id:DOC,effective_from:'2026-01-01',source_rows:['2'],preview_fingerprint:preview.preview_fingerprint});assert.equal(saved.draft_count,1);
 await assert.rejects(()=>call('MANAGER',{action:'v3_client_account_mapping_tb_save',client_id:C,document_id:DOC,effective_from:'2026-01-01',source_rows:['2'],preview_fingerprint:preview.preview_fingerprint}),/changed after preview/);
 await call('MANAGER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'BANK-2',source_account_name:'Second bank account',erp_account_code:account.code,effective_from:'2026-01-01'});
 await call('PARTNER',{action:'v3_client_account_mapping_add',client_id:C,source_account_code:'PARTNER-DRAFT',source_account_name:'Partner-created draft',erp_account_code:account.code,effective_from:'2026-01-01'});
 const drafts=await tx`select mapping_id,revision,created_by,status from erp_private.client_account_mappings where client_id=${C} order by source_account_code`;
 assert.equal(drafts.length,3);assert.ok(drafts.every(x=>x.status==='Draft'));
 const batch=drafts.map(x=>({mapping_id:x.mapping_id,revision:x.revision}));
 await assert.rejects(()=>call('MANAGER',{action:'v3_client_account_mapping_approve_batch',client_id:C,items:batch}),/different Manager or Partner/);
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C} and status='Active'`)[0].n,0,'failed batch approval must be atomic');
 const managerDrafts=drafts.filter(x=>x.created_by===actors.MANAGER.staff_id).map(x=>({mapping_id:x.mapping_id,revision:x.revision}));
 const approved=await call('PARTNER',{action:'v3_client_account_mapping_approve_batch',client_id:C,items:managerDrafts});assert.equal(approved.approved_count,2);
 assert.equal((await tx`select count(*)::int as n from erp_private.client_account_mappings where client_id=${C} and status='Active'`)[0].n,2);
 assert.equal(Number((await tx`select count(*)::int as n from erp_private.audit_events where table_name='client_account_mappings'`)[0].n),5,'draft creation and both approvals should remain in the audit trail');
});
