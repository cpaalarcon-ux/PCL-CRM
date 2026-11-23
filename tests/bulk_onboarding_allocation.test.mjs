import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientOnboardingAllocationAction}=await import('../supabase/functions/staff-workspace-v12/client-onboarding-allocation-actions.ts');
const {createProposal,proposalAction}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),G=id(),C1=id(),C2=id(),C3=id(),C4=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const ax=(role,p)=>as(role,a=>clientOnboardingAllocationAction(tx,a,p));
const rows=(role,sql,params=[])=>as(role,()=>db.query(sql,params).then(r=>r.rows));
const sees=async(role,c)=>(await rows(role,'select count(*)::int n from erp_private.clients where client_id=$1',[c]))[0].n===1;
const allowed=async(role,c)=>(await rows(role,'select erp_private.client_allowed($1::uuid) ok',[c]))[0].ok===true;
test("bulk allocation: all matching a search, and reassigning from one person to another",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${G},'V3QB','Fictional other firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 for(const [c,name,firm] of [[C1,'ACL Fictional One',F],[C2,'ACL Fictional Two',F],[C3,'Fictional Other Firm Client',G],[C4,'ACL Fictional Four',F]]){await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type) values(${c},${name},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;}
 const A=actors.ASSISTANT.staff_id;
 const S=actors.SUPERVISOR.staff_id,held=async s=>(await tx`select client_id from erp_private.client_onboarding_allocations where staff_id=${s} and ended_at is null order by client_id`).map(r=>r.client_id).sort();
 // Allocate everything a search finds, in one step.
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,match:{q:''}}),/Search for clients first/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,match:{q:'no-such-client'}}),/No clients match/);
 const bulk=await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,match:{q:'acl',unallocated_only:true},note:'Fictional bulk'});
 assert.deepEqual([bulk.requested,bulk.allocated,bulk.not_eligible],[3,3,0]);assert.deepEqual(await held(A),[C1,C2,C4].sort());
 assert.equal((await tx`select source from erp_private.client_onboarding_allocations where client_id=${C2} and ended_at is null`)[0].source,'Search');
 const rerun=await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,match:{q:'acl'}});assert.deepEqual([rerun.allocated,rerun.already_allocated],[0,3],'running it again changes nothing');
 // A firm-based match still respects who works where: the other firm's client is not allocated.
 const wide=await ax('PARTNER',{action:'client_onboarding_alloc_assign',staff_id:A,match:{q:'fictional'}});assert.equal(wide.not_eligible,1);assert.equal(await sees('ASSISTANT',C3),false);
 // Reassign selected allocations.
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:A,all:true,reason:'Fictional hand over'}),/different person/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:S,all:true,reason:'no'}),/at least 5 characters/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:actors.INTERN.staff_id,all:true,reason:'Fictional hand over'}),/active Assistant or Supervisor/);
 for(const role of ['ASSISTANT','SUPERVISOR','INTERN'])await assert.rejects(ax(role,{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:S,all:true,reason:'Fictional hand over'}),/Manager or Partner/);
 const some=await ax('MANAGER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:S,client_ids:[C1,C2],reason:'Fictional: Supervisor takes over'});
 assert.deepEqual([some.requested,some.moved,some.not_eligible],[2,2,0]);assert.deepEqual(await held(A),[C4]);assert.deepEqual(await held(S),[C1,C2].sort());
 assert.equal(await sees('ASSISTANT',C1),false,'the old person loses the access');assert.equal(await sees('SUPERVISOR',C1),true,'the new person gains it');assert.equal(await sees('ASSISTANT',C4),true);
 const ended=(await tx`select end_reason from erp_private.client_onboarding_allocations where client_id=${C1} and staff_id=${A} and ended_at is not null`)[0];assert.match(ended.end_reason,/Reassigned to .*Fictional SUPERVISOR: Fictional: Supervisor takes over/);
 // Reassign everything a person holds; ids they do not hold are ignored.
 const all=await ax('PARTNER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:S,all:true,reason:'Fictional: Assistant leaving'});assert.deepEqual([all.requested,all.moved],[1,1]);assert.deepEqual(await held(A),[]);assert.deepEqual(await held(S),[C1,C2,C4].sort());
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_move',staff_id:A,to_staff_id:S,all:true,reason:'Fictional: nothing left'}),/no matching onboarding allocations/);
 // Nothing is lost: every client always has an active holder.
 for(const c of [C1,C2,C4])assert.equal((await tx`select count(*)::int n from erp_private.client_onboarding_allocations where client_id=${c} and ended_at is null`)[0].n,1);
});
