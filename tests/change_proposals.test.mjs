// Propose-and-approve: an Assistant or Supervisor's client entry waits as a proposal; the approver's own account applies it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {createProposal,proposalAction,proposalsRead,proposalSummary}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const propose=(role,p)=>as(role,a=>createProposal(tx,a,p)),act=(role,p,replay)=>as(role,a=>proposalAction(tx,a,p,replay||(async q=>{await tx`update erp_private.clients set company_name=${q.company_name} where client_id=${q.client_id}`;return {ok:true,client_id:q.client_id};}))),
 row=async pid=>(await tx`select * from erp_private.change_proposals where proposal_id=${pid}`)[0],name=async()=>(await tx`select company_name from erp_private.clients where client_id=${C}`)[0].company_name;
test('proposals: the right people check and approve, nobody approves their own work, and the approver applies it',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of ['ASSISTANT','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const entry={client_id:C,company_name:'UAT Fictional New Name Ltd',revision:1,proposal_reason:'Name on the certificate of incorporation'};
 // 1. An Assistant's entry is stored as typed; nothing on the client changes.
 const a1=await propose('ASSISTANT',{action:'client_save',...entry});assert.equal(a1.proposed,true);assert.equal(await name(),'UAT Fictional Old Name Ltd');
 let r=await row(a1.proposal_id);assert.equal(r.status,'Proposed');assert.equal(r.proposed_role,'ASSISTANT');assert.equal(r.payload.company_name,'UAT Fictional New Name Ltd');assert.equal(r.payload.action,undefined,'the stored request holds no action of its own');assert.match(r.summary,/Change client details: UAT Fictional New Name Ltd/);
 await assert.rejects(()=>propose('ASSISTANT',{action:'client_save',...entry,tax_setup:{frequency:'Monthly'}}),/Manager or Partner/);
 await assert.rejects(()=>propose('MANAGER',{action:'client_save',...entry}),/access/);
 await assert.rejects(()=>propose('ASSISTANT',{action:'compliance_verify',client_id:C}),/access/,'verification actions are never proposable');
 // 2. Approval comes only after a check, and not from the people who prepared or may not approve.
 await assert.rejects(()=>act('ASSISTANT',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/Manager or Partner can approve/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/Manager or Partner can approve/);
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/check this Assistant proposal first/);
 await assert.rejects(()=>act('ASSISTANT',{action:'client_proposal_check',proposal_id:a1.proposal_id}),/Supervisor, Manager or Partner|access/);
 await act('SUPERVISOR',{action:'client_proposal_check',proposal_id:a1.proposal_id,note:'Matches the certificate'});r=await row(a1.proposal_id);assert.equal(r.status,'Checked');assert.equal(r.checked_by,actors.SUPERVISOR.staff_id);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_check',proposal_id:a1.proposal_id}),/not been checked/);
 // 3. A failing replay changes nothing and leaves the proposal waiting.
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a1.proposal_id},async()=>{throw new Error('Client changed or is unavailable. Refresh before editing.');}),/Client changed/);
 assert.equal((await row(a1.proposal_id)).status,'Checked');
 // 4. The approver applies it under their own name.
 const done=await act('PARTNER',{action:'client_proposal_approve',proposal_id:a1.proposal_id,note:'Approved'});assert.equal(done.status,'Approved');assert.equal(await name(),'UAT Fictional New Name Ltd');
 r=await row(a1.proposal_id);assert.equal(r.status,'Approved');assert.equal(r.decided_by,actors.PARTNER.staff_id);assert.notEqual(r.decided_by,r.proposed_by);assert.equal(r.result.ok,true);
 await assert.rejects(()=>act('PARTNER',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/already closed/);
 // 5. Whoever checked cannot also approve.
 const a2=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Contact',role_in_decision:'Decision Maker'});
 await act('MANAGER',{action:'client_proposal_check',proposal_id:a2.proposal_id});
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a2.proposal_id}),/another Manager or Partner must approve/);
 await act('MANAGER2',{action:'client_proposal_approve',proposal_id:a2.proposal_id,note:'Fictional approval'},async q=>({ok:true,saw:q.action}));assert.equal((await row(a2.proposal_id)).decided_by,actors.MANAGER2.staff_id);
 // 6. A Supervisor's proposal skips the check; only a Manager or Partner approves it.
 const s1=await propose('SUPERVISOR',{action:'owner_add',client_id:C,full_name:'Fictional Owner',identity_reference:'ID-FICT-1',ownership_percentage:40});
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_check',proposal_id:s1.proposal_id}),/not been checked|Assistant proposal/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_approve',proposal_id:s1.proposal_id}),/Manager or Partner can approve/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_return',proposal_id:s1.proposal_id,note:'No'}),/cannot return your own/);
 await act('MANAGER',{action:'client_proposal_approve',proposal_id:s1.proposal_id},async q=>({ok:true,saw:q.action}));assert.equal((await row(s1.proposal_id)).status,'Approved');
 // 7. Return needs a reason and closes it; only the proposer withdraws.
 const a3=await propose('ASSISTANT',{action:'owner_add',client_id:C,full_name:'Fictional Owner Two',identity_reference:'ID-FICT-2',ownership_percentage:10});
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_return',proposal_id:a3.proposal_id,note:''}),/Say what needs to change/);
 await act('SUPERVISOR',{action:'client_proposal_return',proposal_id:a3.proposal_id,note:'Identity reference is missing a digit'});assert.equal((await row(a3.proposal_id)).status,'Returned');
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a3.proposal_id}),/already closed/);
 const a4=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Withdrawn Contact'});
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_withdraw',proposal_id:a4.proposal_id}),/access/);
 await act('ASSISTANT',{action:'client_proposal_withdraw',proposal_id:a4.proposal_id});assert.equal((await row(a4.proposal_id)).status,'Withdrawn');
 // 8. The database refuses shortcuts even if the server were bypassed.
 const a5=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Shortcut Contact'});
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.change_proposals set status='Approved' where proposal_id=${a5.proposal_id}`),/Manager or Partner|neither proposed/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.change_proposals set payload='{}'::jsonb where proposal_id=${a5.proposal_id}`),/cannot be edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.change_proposals set status='Approved' where proposal_id=${a5.proposal_id}`),/check/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.change_proposals where proposal_id=${a5.proposal_id}`),/delet|permission denied/i);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.change_proposals(action,summary,payload,proposed_by,proposed_role) values('client_save','Forged',${'{}'},${actors.MANAGER.staff_id},'ASSISTANT')`),/row-level security/);
 // 9. Visibility: an Assistant sees only their own; a Supervisor and the leaders see every proposal.
 const mine=await as('ASSISTANT',()=>proposalsRead(tx)),all=await as('SUPERVISOR',()=>proposalsRead(tx));
 assert.ok(mine.length>=1&&mine.every(p=>p.proposed_by===actors.ASSISTANT.staff_id));assert.ok(all.some(p=>p.proposed_role==='SUPERVISOR')&&all.length>mine.length);
 assert.equal(proposalSummary('owner_add',{full_name:'Jane'}),'Add owner or controller: Jane');
});
