// Build .107b: client lifecycle (pause, resume, cancel, archive, restore) and contact routing.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test("client lifecycle and contact routing",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;


 for(const role of ['ASSISTANT','SUPERVISOR','PARTNER','MANAGER2'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const rejects=(fn,re)=>assert.rejects(fn,re);
 const row=async()=>(await tx`select service_status s,record_status r,lifecycle_reason lr,archive_reason ar,accepts_new_engagements acc,archived_from_status af from erp_private.clients where client_id=${C}`)[0];
 const life=(role,act,why)=>as(role,()=>tx`select erp_private.client_lifecycle(${C}::uuid,${act},${why})`);
 // 1. Direct edits to the lifecycle columns are refused; the function is the only way.
 await rejects(()=>as('MANAGER',()=>tx`update erp_private.clients set service_status='Paused' where client_id=${C}`),/Use Pause, Resume/);
 await rejects(()=>as('MANAGER',()=>tx`update erp_private.clients set record_status='Archived' where client_id=${C}`),/Use Pause, Resume/);
 await rejects(()=>tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,service_status) values(${id()},'UAT Fictional Born Paused',${actors.MANAGER.staff_id},'Paused')`,/starts Active/);
 // 2. Who may do what.
 await rejects(()=>life('ASSISTANT','Pause','Client asked us to stop for now'),/Only a Manager or Partner/);
 await rejects(()=>life('SUPERVISOR','Pause','Client asked us to stop for now'),/Only a Manager or Partner/);
 await rejects(()=>life('MANAGER','Pause','too short'),/at least 10/);
 await rejects(()=>life('MANAGER','Resume','Client is back with us'),/already Active/);
 await rejects(()=>life('MANAGER','Archive','Closing the file for good'),/Only a Partner can make a client Dormant/);
 await life('MANAGER','Pause','Client asked us to stop for now');
 assert.deepEqual(await row().then(x=>[x.s,x.r,x.lr]),['Paused','Lead','Client asked us to stop for now']);
 await rejects(()=>life('MANAGER','Pause','Pausing a second time now'),/already Inactive/);
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger zz_opening_gate');// the KYC and engagement-letter gate has its own tests
 // 3. A paused client cannot receive newly activated projects.
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Certificate of incorporation seen',year_end_month=12,year_end_day=31 where client_id=${C}`;
 await rejects(()=>tx`update erp_private.projects set status='Active' where project_id=${P}`,/inactive; set it Active/);
 await life('MANAGER','Resume','Client is back and fees are paid');
 assert.equal((await row()).s,'Active');
 await tx`update erp_private.projects set status='Active' where project_id=${P}`;
 // 4. Cancel is retired: Inactive and Dormant cover it.
 await rejects(()=>life('MANAGER','Cancel','Client moved to another firm'),/no longer used/);
 // 5. Dormant (archive): Partner only, no longer blocked by active projects, nothing is deleted, Partners are told.
 await rejects(()=>life('PARTNER','Archive','short'),/at least 10/);
 await life('PARTNER','Archive','Dormant for three years now');
 let r=await row();assert.deepEqual([r.r,r.ar,r.acc,r.af],['Archived','Dormant for three years now',false,'Lead']);
 assert.equal((await tx`select count(*)::int n from erp_private.notifications where event_key like ${'client-status:%'}`)[0].n,2,'both Partners are told when a client is made Dormant');
 assert.equal((await tx`select client_hold h from erp_private.projects where project_id=${P}`)[0].h,'Dormant','the active project is archived with the client');
 await rejects(()=>life('PARTNER','Pause','Pausing an archived client'),/comes back as Active/);
 await rejects(()=>tx`update erp_private.projects set status='Draft' where project_id=${P}`.then(()=>tx`update erp_private.projects set status='Active' where project_id=${P}`),/dormant; a Partner must set it Active/);
 assert.equal((await tx`select count(*)::int n from erp_private.clients where client_id=${C}`)[0].n,1,'the record is kept');
 await rejects(()=>tx`delete from erp_private.clients where client_id=${C}`,/./);
 await rejects(()=>life('MANAGER','Restore','Client came back to us'),/Only a Partner can make a client Dormant or bring a Dormant client back/);
 await life('PARTNER','Restore','Client came back to us');
 r=await row();assert.deepEqual([r.r,r.ar],['Lead','']);
 assert.equal((await tx`select client_hold h from erp_private.projects where project_id=${P}`)[0].h,null);
 assert.ok((await tx`select count(*)::int n from erp_private.audit_events where record_key=${C}::text`)[0].n>=4,'every change is in the audit trail');
 assert.deepEqual((await tx`select from_status f,to_status t from erp_private.client_status_changes where client_id=${C} order by changed_at`).map(x=>x.f+'>'+x.t),['Active>Inactive','Inactive>Active','Active>Dormant','Dormant>Active']);
 // 6. The scheduler skips clients that are not Active.
 const def=(await tx`select pg_get_functiondef('erp_private.run_workspace_scheduler()'::regprocedure) d`)[0].d;
 assert.match(def,/cl\.service_status='Active' AND cl\.record_status<>'Archived'/);
 // 7. Contact routing.
 const K1=id(),K2=id(),OTHER=id();
 await tx`insert into erp_private.client_contacts(contact_id,client_id,full_name) values(${K1},${C},'Fictional Doc Contact'),(${K2},${C},'Fictional Report Contact')`;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${OTHER},'UAT Fictional Other Ltd',${actors.MANAGER.staff_id})`;
 const K3=id();await tx`insert into erp_private.client_contacts(contact_id,client_id,full_name) values(${K3},${OTHER},'Fictional Stranger')`;
 await rejects(()=>as('ASSISTANT',()=>tx`select erp_private.client_routing_save(${C}::uuid,${K1}::uuid,${K2}::uuid)`),/Only a Manager or Partner/);
 await rejects(()=>as('MANAGER',()=>tx`select erp_private.client_routing_save(${C}::uuid,${K3}::uuid,${K2}::uuid)`),/saved contact of this client/);
 await as('MANAGER',()=>tx`select erp_private.client_routing_save(${C}::uuid,${K1}::uuid,${K2}::uuid)`);
 const rt=(await tx`select doc_request_contact_id d,report_delivery_contact_id p from erp_private.clients where client_id=${C}`)[0];
 assert.deepEqual([rt.d,rt.p],[K1,K2]);
});
