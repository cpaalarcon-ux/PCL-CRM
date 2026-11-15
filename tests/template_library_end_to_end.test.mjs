import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {payrollRegisterAction}=await import('../supabase/functions/staff-workspace-v12/payroll-register-actions.ts');
const {templateLibraryAction,templateInForce}=await import('../supabase/functions/staff-workspace-v12/template-library-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const reg=(role,p)=>as(role,a=>payrollRegisterAction(tx,a,{project_id:P,...p})),lib=(role,p)=>as(role,a=>templateLibraryAction(tx,a,p));
test('template library: upload as draft, a different person publishes, a newer version replaces the old, published versions are never edited, imports find the version in force',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const emp=(name,n,gross,x={})=>({name,employee_id:'E'+n,pin:'A00000000'+n+'Z',gross,source_row:Number(n)+1,...x});
 const calc=(gross,paye,nssf,shif,ahl)=>({gross,paye,employee_nssf:nssf,shif,employee_ahl:ahl,other_deductions:0,employer_nssf:nssf,employer_ahl:ahl,nita:50,net_pay:Math.round((gross-paye-nssf-shif-ahl)*100)/100});
 const month=(start,end,rows,calcRows,status='Submitted',extra={})=>({import_id:id(),start,end,rows,calcRows,status,...extra});
 const b64=Buffer.from('Month,Sales category,Net sales\nJan,General,100').toString('base64');
 const make=(role,x={})=>lib(role,{action:'template_library_create',template_key:'SALES',name:'Sales upload (net only)',importer_profile:'SALES-NET-ONLY-v1',required_columns:'Month | required | Jan 2026\nSales category | required | General\nNet sales | required | 100000\nNotes | optional |',effective_from:'2026-01-01',file_name:'sales.xlsx',file_base64:b64,...x});
 await assert.rejects(async()=>lib('INTERN',{action:'template_library_list'}),/client access/);
 await assert.rejects(async()=>make('ASSISTANT'),/Manager or Partner/);
 await assert.rejects(async()=>make('MANAGER',{file_name:'sales.exe'}),/Excel or CSV/);
 await assert.rejects(async()=>make('MANAGER',{required_columns:'Month | maybe'}),/required or optional/);
 await assert.rejects(async()=>make('MANAGER',{required_columns:'Month | required\nmonth | required'}),/twice/);
 await assert.rejects(async()=>make('MANAGER',{required_columns:'Month | optional'}),/at least one column must be required/i);
 await assert.rejects(async()=>make('MANAGER',{effective_to:'2025-12-31'}),/last day/);
 const v1=await make('MANAGER');assert.equal(v1.version,1);
 // A draft is seen by Managers and Partners only.
 assert.equal((await lib('ASSISTANT',{action:'template_library_list'})).templates.length,0);assert.equal((await lib('PARTNER',{action:'template_library_list'})).templates.length,1);
 await assert.rejects(async()=>lib('ASSISTANT',{action:'template_library_download',template_id:v1.template_id}),/unavailable|Managers and Partners/);
 const rev=async id=>(await lib('PARTNER',{action:'template_library_list'})).templates.find(t=>t.template_id===id).revision;
 // The uploader cannot publish; someone else cannot revise the draft; the uploader can.
 await assert.rejects(async()=>lib('MANAGER',{action:'template_library_publish',template_id:v1.template_id,revision:await rev(v1.template_id)}),/different Manager or Partner|only Partner/);
 await assert.rejects(async()=>lib('PARTNER',{action:'template_library_revise',template_id:v1.template_id,revision:await rev(v1.template_id),name:'Renamed by someone else',required_columns:'Month | required',effective_from:'2026-01-01'}),/uploaded a draft/);
 await lib('MANAGER',{action:'template_library_revise',template_id:v1.template_id,revision:await rev(v1.template_id),name:'Sales upload (net only) v1',required_columns:'Month | required\nSales category | required\nNet sales | required',effective_from:'2026-01-01'});
 // Nothing is in force until it is published.
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'SALES','2026-06-30')),null);
 const pub=await lib('PARTNER',{action:'template_library_publish',template_id:v1.template_id,revision:await rev(v1.template_id)});assert.deepEqual([pub.ok,pub.replaced,pub.sole_partner_publish],[true,false,false]);
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'SALES','2026-06-30')),v1.template_id);
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'SALES','2025-12-31')),null,'before it starts');
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'PAYROLL','2026-06-30')),null,'no payroll template published');
 // A published version is never edited, even directly in the database.
 await assert.rejects(async()=>as('PARTNER',()=>tx`update erp_private.import_templates set name='Changed' where template_id=${v1.template_id}`),/never edited/);
 await assert.rejects(async()=>as('PARTNER',()=>tx`delete from erp_private.import_templates where template_id=${v1.template_id}`),/./);
 await assert.rejects(async()=>lib('MANAGER',{action:'template_library_revise',template_id:v1.template_id,revision:await rev(v1.template_id),name:'x y z',required_columns:'A | required',effective_from:'2026-01-01'}),/never edited/);
 // Download: any staff member gets a published file, the hash matches, and it is logged.
 const dl=await lib('ASSISTANT',{action:'template_library_download',template_id:v1.template_id});assert.equal(dl.base64,b64);assert.match(dl.sha256,/^[0-9a-f]{64}$/);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='TEMPLATE_DOWNLOADED' and record_key=${String(v1.template_id)}`)[0].n,1);
 // Version 2: the only Partner may publish their own upload (recorded); version 1 is retired by that.
 const v2=await make('PARTNER',{name:'Sales upload (net only) v2',effective_from:'2026-07-01'});assert.equal(v2.version,2);
 const p2=await lib('PARTNER',{action:'template_library_publish',template_id:v2.template_id,revision:await rev(v2.template_id)});assert.deepEqual([p2.replaced,p2.sole_partner_publish],[true,true]);
 const all=(await lib('MANAGER',{action:'template_library_list'})).templates;
 assert.deepEqual(all.map(t=>[t.version,t.status]),[[2,'Published'],[1,'Retired']]);assert.match(all[1].retired_reason,/Replaced by version 2/);assert.equal(all[0].sole_partner_publish,true);
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'SALES','2026-08-01')),v2.template_id);
 // Retiring needs a reason; a retired version stays as it was.
 await assert.rejects(async()=>lib('MANAGER',{action:'template_library_retire',template_id:v2.template_id,revision:await rev(v2.template_id),reason:'no'}),/Say why/);
 await lib('MANAGER',{action:'template_library_retire',template_id:v2.template_id,revision:await rev(v2.template_id),reason:'Layout changed, replacement being prepared'});
 assert.equal(await as('PARTNER',()=>templateInForce(tx,'SALES','2026-08-01')),null,'a retired version is not in force');
 await assert.rejects(async()=>as('PARTNER',()=>tx`update erp_private.import_templates set retired_reason='Changed my mind later' where template_id=${v2.template_id}`),/stays as it was/);
 // Imports and bank batches carry the version column.
 const cols=(await tx`select table_name from information_schema.columns where column_name='template_id' and table_name in('period_imports','bank_total_batches') order by 1`).map(r=>r.table_name);assert.deepEqual(cols,['bank_total_batches','period_imports']);
});
