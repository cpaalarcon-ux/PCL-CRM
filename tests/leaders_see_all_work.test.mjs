import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),C2=id(),C3=id(),P=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}

test('Partners and Managers see and manage every client and project in their firms; Supervisors see them read-only',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'VSQA','Fictional visibility firm'),(${F2},'VSQB','Fictional second firm')`;
 const staff=async(role,cat,firm)=>{const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${firm},'Assigned')`;};
 await staff('PARTNER','PARTNER',F);await staff('MANAGER','MANAGER',F);await staff('MANAGER2','MANAGER',F);await staff('OTHERFIRM','MANAGER',F2);await staff('SUPERVISOR','SUPERVISOR',F);await staff('ASSISTANT','ASSISTANT',F);await staff('INTERN','INTERN',F);
 // MANAGER created everything. C is linked to F with a project; C2 has no firm link yet; C3 belongs to the second firm only.
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Mlima Traders',${actors.MANAGER.staff_id}),(${C2},'Pwani Fresh',${actors.MANAGER.staff_id}),(${C3},'Bonde Foods',${actors.OTHERFIRM.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C3},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Mlima Traders accounts','TAX-COMP',${actors.MANAGER.staff_id})`;
 const names=(role,table,col)=>as(role,async()=>(await tx(['select '+col+' n from erp_private.'+table+' order by 1'])).map(x=>x.n));
 const clients=role=>names(role,'clients','company_name'),projects=role=>names(role,'projects','project_name');

 assert.deepEqual(await clients('PARTNER'),['Bonde Foods','Mlima Traders','Pwani Fresh'],'a Partner sees everything');
 assert.deepEqual(await clients('MANAGER'),['Mlima Traders','Pwani Fresh'],'the creator sees their own, not another firm');
 assert.deepEqual(await clients('MANAGER2'),['Mlima Traders','Pwani Fresh'],'another Manager sees every client of the firm, including one with no firm link yet, though they did not create it or work on it');
 assert.deepEqual(await projects('MANAGER2'),['Mlima Traders accounts']);
 assert.deepEqual(await clients('OTHERFIRM'),['Bonde Foods','Pwani Fresh'],'a Manager of another firm does not see this firm\'s client, but does see an unlinked new one');
 assert.deepEqual(await projects('OTHERFIRM'),[]);
 assert.deepEqual(await clients('SUPERVISOR'),['Mlima Traders','Pwani Fresh'],'a Supervisor sees the firm\'s clients');
 assert.deepEqual(await projects('SUPERVISOR'),['Mlima Traders accounts'],'and its projects');
 assert.equal((await as('SUPERVISOR',()=>tx`select count(*)::int n from erp_private.client_firm_links`))[0].n,1,'and the firm link, so the client list can place them');
 for(const role of ['ASSISTANT','INTERN']){assert.deepEqual(await clients(role),[],role+' sees nothing that is not assigned');assert.deepEqual(await projects(role),[]);}

 // Overall rights: a Manager who did not create the work can change the client and the project.
 await as('MANAGER2',async()=>{await tx`update erp_private.clients set company_name='Mlima Traders Limited' where client_id=${C}`;await tx`update erp_private.projects set project_name='Mlima Traders annual accounts' where project_id=${P}`;});
 assert.equal((await db.query(`select company_name from erp_private.clients where client_id=$1`,[C])).rows[0].company_name,'Mlima Traders Limited');
 assert.equal((await db.query(`select project_name from erp_private.projects where project_id=$1`,[P])).rows[0].project_name,'Mlima Traders annual accounts');
 // A Supervisor can look but not change what is not theirs.
 await as('SUPERVISOR',async()=>{await tx`update erp_private.clients set company_name='Changed by a Supervisor' where client_id=${C}`;await tx`update erp_private.projects set project_name='Changed by a Supervisor' where project_id=${P}`;});
 assert.equal((await db.query(`select company_name from erp_private.clients where client_id=$1`,[C])).rows[0].company_name,'Mlima Traders Limited','a Supervisor has no edit rights over a client they only see');
 assert.equal((await db.query(`select project_name from erp_private.projects where project_id=$1`,[P])).rows[0].project_name,'Mlima Traders annual accounts');
 // Reviewers: a Manager of the firm and every Partner, never the person acting.
 const reviewers=async role=>(await as(role,()=>tx`select full_name from erp_private.review_candidates(${C})`)).map(x=>x.full_name).sort();
 assert.deepEqual(await reviewers('MANAGER'),['Fictional MANAGER2','Fictional PARTNER']);
 assert.deepEqual(await reviewers('MANAGER2'),['Fictional MANAGER','Fictional PARTNER']);
});
