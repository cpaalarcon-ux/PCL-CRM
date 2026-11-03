import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {confirmPeriodImport,summarySalesRows,effectiveImports}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('a submitted replacement hides the import it replaces, so nothing is counted twice',()=>{
 const rows=[{import_id:'x',status:'Confirmed',replaces_ids:[]},{import_id:'y',status:'Submitted',replaces_ids:['x']},{import_id:'z',status:'Confirmed',replaces_ids:[]}];
 assert.deepEqual(effectiveImports(rows).map(r=>r.import_id),['y','z']);
});

// Option A: the first independent review that uses a submitted summary confirms it. The tax computation
// review can confirm a summary even though its own case is the submitted tax work for that period.
test('the tax computation review confirms the submitted sales summary it uses',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'TAXA','Fictional tax option A firm')`;
 for(const role of ['MANAGER','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional tax option A client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional VAT project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors))await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},'Import Sources','Fictional_sales.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const summary=(net,vat,replaces=[])=>tx`insert into erp_private.period_imports(project_id,client_id,document_id,kind,starts_on,ends_on,payload,source_hash,replaces_ids,prepared_by) values(${P},${C},${D},'Sales','2026-09-01','2026-09-30',${tx.json({groups:[{vat_category:'16%',net,vat}]})},${id()},${tx.array(replaces)}::uuid[],${actors.ASSISTANT.staff_id}) returning import_id`;
 const original=(await summary(1000,160))[0].import_id;
 await tx`update erp_private.period_imports set status='Submitted' where import_id=${original}`;
 await tx`update erp_private.period_imports set status='Confirmed',reviewed_by=${actors.MANAGER.staff_id},review_note='Fictional earlier confirmation' where import_id=${original}`;
 const replacement=(await summary(2000,320,[original]))[0].import_id;
 await tx`update erp_private.period_imports set status='Submitted' where import_id=${replacement}`;
 assert.equal((await summarySalesRows(tx,P,'2026-09-01','2026-09-30'))[0].normalized.amount,1000,'ledger and reconciliation reads still use confirmed summaries only');
 const taxRows=await summarySalesRows(tx,P,'2026-09-01','2026-09-30',{includeSubmitted:true});
 assert.equal(taxRows.length,1);assert.equal(taxRows[0].normalized.amount,2000,'the tax computation uses the submitted replacement, not both');
 const taxCase=(await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,prepared_by,status) values(${P},'VAT','2026-09-01','2026-09-30',${actors.ASSISTANT.staff_id},'Submitted') returning case_id`)[0].case_id;
 const project={project_id:P,client_id:C},row=async()=>(await tx`select * from erp_private.period_imports where import_id=${replacement}`)[0];
 await assert.rejects(async()=>{const r=await row();await as('MANAGER',a=>confirmPeriodImport(tx,a,project,r,'Fictional review'))},/submitted or locked/,'outside the tax review the submitted case still protects the period');
 await assert.rejects(async()=>{const r=await row();await as('ASSISTANT',a=>confirmPeriodImport(tx,a,project,r,'Self review',{exceptCaseId:taxCase}))},/different Supervisor, Manager or Partner/);
 const r=await row();await as('MANAGER',a=>confirmPeriodImport(tx,a,project,r,'Confirmed with the VAT computation review',{exceptCaseId:taxCase}));
 const after=await tx`select import_id,status,reviewed_by from erp_private.period_imports order by created_at`;
 assert.deepEqual(after.map(x=>x.status),['Superseded','Confirmed']);assert.equal(after[1].reviewed_by,actors.MANAGER.staff_id);
});
