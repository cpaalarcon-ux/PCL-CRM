// The list of tax periods waiting for a confirmed KRA due date (build 2773).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
globalThis.Deno=globalThis.Deno||{env:{get:k=>k==='SUPABASE_URL'?'https://yfjiculexbzpkvtapudk.supabase.co':''}};
const {taxConfigAction}=await import('../supabase/functions/staff-workspace-v12/tax-config-actions.ts');
const {taxAction}=await import('../supabase/functions/staff-workspace-v12/tax-review-actions.ts');
const {staffRightsAction}=await import('../supabase/functions/staff-workspace-v12/staff-rights-actions.ts');
const {dueDateAction}=await import('../supabase/functions/staff-workspace-v12/due-date-actions.ts');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>"{"+x.join(",")+"}";
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('the due-date backlog lists existing periods and shrinks as dates are confirmed',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Backlog One Ltd','A400000040Z'),PJ=await proj(Z,'TAX-KRA');
 const dd=(role,p)=>as(role,a=>dueDateAction(tx,a,p));
 const Z2=await mk('UAT Fictional Backlog Two Ltd','A400000041Z'),PJ2=await proj(Z2,'TAX-KRA');
 const ins=async(proj,kind,from,to,status='Draft')=>(await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by,inputs,result) values(${proj},${kind},${from},${to},${status},${M},'{}','{}') returning case_id`)[0].case_id;
 const cV=await ins(PJ,'VAT','2026-09-01','2026-09-30'),cP=await ins(PJ,'PAYE','2026-09-01','2026-09-30'),cC=await ins(PJ,'Company','2025-07-01','2026-06-30'),cW=await ins(PJ2,'WHT','2026-09-01','2026-09-30');
 await db.exec('alter table erp_private.tax_cases disable trigger user');
 await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,status,prepared_by,inputs,result,amends_case_id,amendment_no,amendment_reason) values(${PJ},'VAT','2026-09-01','2026-09-30','Draft',${M},'{}','{}',${cV},1,'Fictional amendment of the September return')`;
 // who may read the list
 await assert.rejects(dd('SUPERVISOR',{action:'due_date_backlog'}),/Managers and Partners/);
 await assert.rejects(dd('ASSISTANT',{action:'due_date_backlog'}),/Managers and Partners/);
 const all=(await dd('PARTNER',{action:'due_date_backlog'})).items;
 assert.equal(all.length,4,'four periods; the amendment is not listed and a period is listed once');
 assert.ok(all.every(r=>r.due_status==='MISSING'),'nothing is confirmed yet');
 const by=k=>all.find(r=>r.kind===k);
 assert.equal(by('VAT').suggested_due_date,'2026-10-20');assert.equal(by('PAYE').suggested_due_date,'2026-10-09');
 assert.equal(by('Company').suggested_due_date,'2026-12-31','a 30 June year end: the last day of the sixth month after');
 assert.equal(by('WHT').suggested_due_date,null,'no date is suggested for other returns');
 assert.equal(by('VAT').filing_class,'VAT');
 // a Manager sees the same list; only the confirm and fallback actions change anything
 assert.equal((await dd('MANAGER',{action:'due_date_backlog'})).items.length,4);
 const key=(r,more={})=>({project_id:r.project_id,starts_on:r.starts_on.slice(0,10),ends_on:r.ends_on.slice(0,10),kind:r.kind,...more});
 await assert.rejects(dd('MANAGER',{action:'due_date_confirm',...key(by('VAT'),{kra_due_date:'2026-10-20',itax_confirmed:false})}),/Tick the box/);
 await dd('MANAGER',{action:'due_date_confirm',...key(by('VAT'),{kra_due_date:'2026-10-20',itax_confirmed:'on'})});
 await assert.rejects(dd('PARTNER',{action:'due_date_fallback',...key(by('PAYE'),{fallback_reason:'short'})}),/at least 10/);
 await dd('PARTNER',{action:'due_date_fallback',...key(by('PAYE'),{fallback_reason:'The KRA calendar is not yet published for this period'})});
 const after=(await dd('PARTNER',{action:'due_date_backlog'})).items,st=k=>after.find(r=>r.kind===k).due_status;
 assert.deepEqual([st('VAT'),st('PAYE'),st('Company'),st('WHT')],['CONFIRMED','TASK_DATE_FALLBACK','MISSING','MISSING']);
 assert.equal(after.find(r=>r.kind==='VAT').kra_due_date,'2026-10-20');
 assert.deepEqual(after.slice(0,2).map(r=>r.due_status),['MISSING','MISSING'],'waiting periods are listed first');
 // the database function is not open to the public roles, and it shows nothing to a Supervisor even if called directly
 const priv=(await tx`select has_function_privilege('anon','erp_private.period_due_backlog()','execute') a,has_function_privilege('authenticated','erp_private.period_due_backlog()','execute') b,has_function_privilege('erp_api','erp_private.period_due_backlog()','execute') c`)[0];
 assert.deepEqual([priv.a,priv.b,priv.c],[false,false,true]);
 assert.equal(JSON.stringify((await q('SUPERVISOR',`select erp_private.period_due_backlog() as r`))[0].r),'[]');
 assert.equal((await tx`select count(*)::int n from erp_private.period_due_dates`)[0].n,2,'only the two choices made above were recorded');
});
