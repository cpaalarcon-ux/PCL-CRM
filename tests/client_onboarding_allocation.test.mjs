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
test('onboarding allocation: access before any project, limited to the allocated clients, and gone when it ends',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${G},'V3QB','Fictional other firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}

 for(const [c,name,firm] of [[C1,'ACL Fictional One',F],[C2,'ACL Fictional Two',F],[C3,'Fictional Other Firm Client',G],[C4,'ACL Fictional Four',F]]){await tx`insert into erp_private.clients(client_id,company_name,legal_entity_type) values(${c},${name},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${firm})`;}
 const A=actors.ASSISTANT.staff_id;
 // Before any allocation the Assistant has no access, and there is no project anywhere.
 assert.equal((await tx`select count(*)::int n from erp_private.projects`)[0].n,0,'no project exists');
 for(const c of [C1,C2,C3,C4])assert.equal(await sees('ASSISTANT',c),false,'nothing is visible before allocation');
 // Only a Manager or Partner allocates.
 for(const role of ['ASSISTANT','SUPERVISOR','INTERN'])await assert.rejects(ax(role,{action:'client_onboarding_alloc_read'}),/Manager or Partner/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:actors.INTERN.staff_id,client_ids:[C1]}),/active Assistant or Supervisor/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:actors.MANAGER.staff_id,client_ids:[C1]}),/active Assistant or Supervisor/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,client_ids:[]}),/at least one client/);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,client_ids:['not-a-uuid']}),/Invalid record reference/);
 // A client in a firm the preparer does not work in is not allocated.
 const mix=await ax('PARTNER',{action:'client_onboarding_alloc_assign',staff_id:A,client_ids:[C1,C3],note:'Fictional ACL batch'});
 assert.deepEqual([mix.requested,mix.allocated,mix.already_allocated,mix.not_eligible],[2,1,0,1]);
 assert.equal(await sees('ASSISTANT',C1),true,'the allocated client is visible');
 assert.equal(await allowed('ASSISTANT',C1),true);
 for(const c of [C2,C3,C4])assert.equal(await sees('ASSISTANT',c),false,'an unallocated client stays out of scope');
 assert.equal(await allowed('ASSISTANT',C2),false);
 // Allocating again changes nothing.
 const again=await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,client_ids:[C1]});assert.deepEqual([again.allocated,again.already_allocated],[0,1]);
 // Access is for the onboarding workflow only: no direct edit, no new project work.
 const edit=await rows('ASSISTANT',`update erp_private.clients set company_name='Fictional Changed' where client_id=$1 returning client_id`,[C1]);assert.equal(edit.length,0,'the Assistant cannot edit the client directly');
 assert.equal((await tx`select company_name from erp_private.clients where client_id=${C1}`)[0].company_name,'ACL Fictional One');
 assert.equal((await rows('ASSISTANT','select count(*)::int n from erp_private.client_onboarding_allocations'))[0].n,1,'the Assistant sees only their own allocation row');
 await assert.rejects(rows('ASSISTANT',`insert into erp_private.client_onboarding_allocations(client_id,staff_id,allocated_by) values($1,$2,$2)`,[C2,A]),/not available|row-level security|violates|Only an active/,'an Assistant cannot allocate themselves');
 await assert.rejects(rows('MANAGER',`delete from erp_private.client_onboarding_allocations`),/./,'allocations are never deleted');
 // Pick by search, by import file, and see who holds what.
 const list=await ax('MANAGER',{action:'client_onboarding_alloc_clients',q:'acl',staff_id:A});
 assert.equal(list.total,3);assert.equal(list.clients.find(c=>c.client_id===C1).already_this_person,true);assert.match(list.clients.find(c=>c.client_id===C1).allocated_to,/Fictional ASSISTANT/);
 const free=await ax('MANAGER',{action:'client_onboarding_alloc_clients',q:'acl',unallocated_only:true});assert.deepEqual(free.clients.map(c=>c.client_id).sort(),[C2,C4].sort());
 for(const [c,n] of [[C2,2],[C4,3]])await tx`insert into erp_private.client_field_facts(client_id,field_key,value,source_kind,source_reference,recorded_by) values(${c},'company_name','x','Import',${'acl-batch.xlsx row '+n},${actors.MANAGER.staff_id})`;
 const rd=await ax('MANAGER',{action:'client_onboarding_alloc_read',staff_id:A});
 assert.deepEqual(rd.files.map(f=>[f.file,f.clients]),[['acl-batch.xlsx',2]]);assert.equal(rd.allocations.length,1);assert.equal(rd.preparers.find(p=>p.staff_id===A).allocated,1);
 const byFile=await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,file:'acl-batch.xlsx'});assert.deepEqual([byFile.requested,byFile.allocated],[2,2]);
 assert.equal((await tx`select source from erp_private.client_onboarding_allocations where client_id=${C4} and ended_at is null`)[0].source,'Import: acl-batch.xlsx');
 for(const c of [C1,C2,C4])assert.equal(await sees('ASSISTANT',c),true);
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,file:'no-such-file.xlsx'}),/No clients were imported/);
 // Removing an allocation removes the access, keeps the history, and needs a reason.
 await assert.rejects(ax('MANAGER',{action:'client_onboarding_alloc_remove',staff_id:A,client_ids:[C1],reason:'no'}),/at least 5 characters/);
 const gone=await ax('MANAGER',{action:'client_onboarding_alloc_remove',staff_id:A,client_ids:[C1,C2],reason:'Fictional: moved to another preparer'});assert.equal(gone.ended,2);
 assert.equal(await sees('ASSISTANT',C1),false,'access ends with the allocation');assert.equal(await allowed('ASSISTANT',C2),false);assert.equal(await sees('ASSISTANT',C4),true,'other allocations are untouched');
 const hist=await tx`select ended_by,end_reason from erp_private.client_onboarding_allocations where client_id=${C1} and ended_at is not null`;assert.equal(hist.length,1);assert.equal(hist[0].ended_by,actors.MANAGER.staff_id);
 await assert.rejects(rows('MANAGER',`update erp_private.client_onboarding_allocations set ended_at=null,ended_by=null,end_reason=null where client_id=$1`,[C1]),/never edited/);
 assert.equal((await ax('MANAGER',{action:'client_onboarding_alloc_remove',staff_id:A,client_ids:[C1],reason:'Fictional: already ended'})).ended,0,'ending twice changes nothing');
 // The same client can be allocated again later.
 assert.equal((await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:A,client_ids:[C1]})).allocated,1);assert.equal(await sees('ASSISTANT',C1),true);
 // A project assignment still opens the client on its own, and an allocation does not replace it.
 // A Supervisor can be allocated too.
 const sup=await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:actors.SUPERVISOR.staff_id,client_ids:[C2]});assert.equal(sup.allocated,1);
 // Sheila's onboarding test: an allocated profile is proposed, independently checked and approved; an unallocated one stays out; removal ends it.
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));
 const propose=(role,p)=>as(role,a=>createProposal(tx,a,p));
 const decide=(role,p)=>as(role,a=>proposalAction(tx,a,p,async q=>{await tx`update erp_private.clients set company_name=${q.company_name} where client_id=${q.client_id}`;return {ok:true,client_id:q.client_id};}));
 const nameOf=async c=>(await tx`select company_name from erp_private.clients where client_id=${c}`)[0].company_name;
 const entry=c=>({action:'client_save',client_id:c,company_name:'ACL Fictional One Renamed',revision:1,proposal_reason:'Name on the certificate of incorporation'});
 await assert.rejects(propose('ASSISTANT',entry(C2)),/not available/,'an unallocated client cannot be proposed on');
 await assert.rejects(propose('ASSISTANT',entry(C3)),/not available/,'a client in another firm cannot be proposed on');
 const pr=await propose('ASSISTANT',entry(C1));assert.equal(pr.proposed,true);assert.equal(await nameOf(C1),'ACL Fictional One','nothing changes until approval');
 await assert.rejects(decide('ASSISTANT',{action:'client_proposal_approve',proposal_id:pr.proposal_id}),/Manager or Partner can approve/);
 await assert.rejects(decide('MANAGER',{action:'client_proposal_approve',proposal_id:pr.proposal_id}),/must check this proposal first/);
 await assert.rejects(decide('ASSISTANT',{action:'client_proposal_check',proposal_id:pr.proposal_id,note:'Checked by the preparer'}),/Supervisor, Manager or Partner|access/);
 await assert.rejects(decide('SUPERVISOR',{action:'client_proposal_check',proposal_id:pr.proposal_id,note:'Matches the certificate of incorporation'}),/not available/,'a Supervisor reaches only their own clients, so one who is not allocated cannot check');
 await ax('MANAGER',{action:'client_onboarding_alloc_assign',staff_id:actors.SUPERVISOR.staff_id,client_ids:[C1],note:'Fictional: independent checker'});
 await decide('SUPERVISOR',{action:'client_proposal_check',proposal_id:pr.proposal_id,note:'Matches the certificate of incorporation'});
 await decide('MANAGER',{action:'client_proposal_approve',proposal_id:pr.proposal_id,note:'Approved after the check'});
 assert.equal(await nameOf(C1),'ACL Fictional One Renamed','the approver applied the change');
 await ax('MANAGER',{action:'client_onboarding_alloc_remove',staff_id:A,client_ids:[C1],reason:'Fictional: onboarding finished'});
 await assert.rejects(propose('ASSISTANT',entry(C1)),/not available/,'with the allocation removed the profile is out of scope again');
 // The allocation changes are in the audit trail.
 assert((await tx`select count(*)::int n from erp_private.audit_events where table_name='client_onboarding_allocations'`)[0].n>=5);
});
