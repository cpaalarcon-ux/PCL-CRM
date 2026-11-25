import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientOnboardingAllocationAction}=await import('../supabase/functions/staff-workspace-v12/client-onboarding-allocation-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),C1=id(),C2=id(),C3=id(),C4=id(),C5=id(),C6=id(),P2=id(),P3=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>clientOnboardingAllocationAction(tx,a,p));
const rows=(role,sql,params=[])=>as(role,()=>db.query(sql,params).then(r=>r.rows));
const sees=async(role,c)=>(await rows(role,'select count(*)::int n from erp_private.clients where client_id=$1',[c]))[0].n===1;
const allowed=async(role,c)=>(await rows(role,'select erp_private.client_allowed($1::uuid) ok',[c]))[0].ok===true;
test('record scope by category: who reaches which client, project and task, and who can change them',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${G},'V3QB','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','SUPERVISOR2','ASSISTANT','ASSISTANT2','INTERN','ADMIN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 for(const [c,name,firm] of [[C1,'RS Fictional Owned',F],[C2,'RS Fictional Assigned',F],[C3,'RS Fictional Allocated',F],[C4,'RS Fictional Firm Only',F],[C5,'RS Fictional Other Firm',G],[C6,'RS Fictional Unlinked',F]]){await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type,owner_staff_id) values(${c},${name},'Limited company',${c===C1?actors.ASSISTANT.staff_id:null})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;}
 const S=actors.SUPERVISOR.staff_id,A=actors.ASSISTANT.staff_id,M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C2},${F},'RS assigned project','TAX-COMP',${M})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P2},${S},${F},'SUPERVISOR'),(${P2},${A},${F},'ASSISTANT'),(${P2},${M},${F},'MANAGER')`;
 const T2=(await tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${P2},${A},'RS assistant task') returning task_id`)[0].task_id;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P3},${C4},${F},'RS firm-only project','TAX-COMP',${M})`;
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P3},${M},${F},'MANAGER'),(${P3},${actors.ASSISTANT2.staff_id},${F},'ASSISTANT')`;
 await tx`insert into erp_private.tasks(project_id,assigned_to,task_name) values(${P3},${actors.ASSISTANT2.staff_id},'RS second assistant task')`;
 await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:S,client_ids:[C3],note:'Fictional RS allocation'});
 const ids={C1,C2,C3,C4,C5,C6};
 const reach=async role=>{const out={};for(const [k,c] of Object.entries(ids))out[k]=await sees(role,c);return out;};
 const projects=async role=>(await rows(role,'select project_id from erp_private.projects')).map(r=>r.project_id);
 const tasks=async role=>(await rows(role,'select task_id from erp_private.tasks')).length;

 // Partner: every client and project, in every firm.
 assert.deepEqual(await reach('PARTNER'),{C1:true,C2:true,C3:true,C4:true,C5:true,C6:true});
 assert.equal((await projects('PARTNER')).length,2);
 // Manager: every client and project of the firms they work in; nothing in another firm.
 assert.deepEqual(await reach('MANAGER'),{C1:true,C2:true,C3:true,C4:true,C5:false,C6:true});
 assert.equal((await projects('MANAGER')).length,2);
 // Supervisor: every project and task in the firms they work in (they review; Assistants do the work), plus the clients of those projects and onboarding allocations. Nothing in another firm.
 assert.deepEqual(await reach('SUPERVISOR'),{C1:false,C2:true,C3:true,C4:true,C5:false,C6:false},'a Supervisor reaches the clients of every project in their firm and allocated clients');
 assert.deepEqual((await projects('SUPERVISOR')).sort(),[P2,P3].sort(),'a Supervisor reaches every project in their firm, not the other firm');
 assert.equal(await tasks('SUPERVISOR'),2,'and every task inside those projects');
 assert.equal(await allowed('SUPERVISOR',C4),true);
 // A second Supervisor works in the same firm, so they see the same projects and tasks.
 assert.deepEqual((await projects('SUPERVISOR2')).sort(),[P2,P3].sort());
 assert.equal(await tasks('SUPERVISOR2'),2);
 // Assistant: the client they own and the project they are assigned to; never the rest of the firm.
 assert.deepEqual(await reach('ASSISTANT'),{C1:true,C2:true,C3:false,C4:false,C5:false,C6:false});
 assert.deepEqual(await projects('ASSISTANT'),[P2]);
 assert.equal(await tasks('ASSISTANT'),1);
 // Intern: no client or project record at all.
 assert.deepEqual(await reach('INTERN'),{C1:false,C2:false,C3:false,C4:false,C5:false,C6:false});
 assert.deepEqual(await projects('INTERN'),[]);
 // System Administrator: no client, project or task record.
 assert.deepEqual(await reach('ADMIN'),{C1:false,C2:false,C3:false,C4:false,C5:false,C6:false});
 assert.deepEqual(await projects('ADMIN'),[]);
 assert.equal(await tasks('ADMIN'),0);

 // Restricted actions at the database: a Supervisor still cannot change a client or a project directly.
 for(const role of ['SUPERVISOR','ASSISTANT','INTERN','ADMIN']){
  const upd=await rows(role,`update erp_private.clients set company_name='Fictional Changed' where client_id=$1 returning client_id`,[C2]);assert.equal(upd.length,0,`${role} cannot edit a client directly`);
 }
 assert.equal((await tx`select company_name from erp_private.clients where client_id=${C2}`)[0].company_name,'RS Fictional Assigned');
 // Supervisors can be allocated and unallocated, and the reach follows.
 await ax('MANAGER',{action:'client_onboarding_alloc_remove',staff_id:S,client_ids:[C3],reason:'Fictional RS end of allocation'});
 assert.equal(await sees('SUPERVISOR',C3),false,'ending the allocation ends the Supervisor access');
 assert.equal(await sees('SUPERVISOR',C2),true,'the project assignment is untouched');
 await tx`update erp_private.project_assignments set deleted_at=now() where project_id=${P2} and staff_id=${S}`;
 assert.deepEqual(await reach('SUPERVISOR'),{C1:false,C2:true,C3:false,C4:true,C5:false,C6:false},'with no assignment and no allocation a Supervisor still reaches the clients of every project in their firm, and nothing else');
 assert.deepEqual((await projects('SUPERVISOR')).sort(),[P2,P3].sort());
 await ax('PARTNER',{action:'client_onboarding_alloc_assign',staff_id:S,client_ids:[C4,C6],note:'Fictional RS reallocation'});
 assert.deepEqual(await reach('SUPERVISOR'),{C1:false,C2:true,C3:false,C4:true,C5:false,C6:true});
});
