// Propose-and-approve: an Assistant or Supervisor's client entry waits as a proposal; the approver's own account applies it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {createProposal,proposalAction,proposalsRead,proposalSummary}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const {handlingFirmIds,readClientEntry}=await import('../supabase/functions/staff-workspace-v12/client-entry.ts');
const {applyLegalStructure}=await import('../supabase/functions/staff-workspace-v12/legal-structure-actions.ts');
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
 const newClient={action:'client_save',company_name:'UAT Fictional New Client Ltd',kra_pin:'A123456789Z',branch_location:'Kisii',legal_structure:'Limited Company',legal_subtype:'Private Limited Company',firm_ids:[F]};
 await assert.rejects(()=>propose('ASSISTANT',newClient),/locked|authorization/i);
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));// Assistants may propose only after the Partner has signed
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
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/must check this proposal first/);
 await assert.rejects(()=>act('ASSISTANT',{action:'client_proposal_check',proposal_id:a1.proposal_id}),/Supervisor, Manager or Partner|access/);
 await act('SUPERVISOR',{action:'client_proposal_check',proposal_id:a1.proposal_id,note:'Matches the certificate of incorporation'});r=await row(a1.proposal_id);assert.equal(r.status,'Checked');assert.equal(r.checked_by,actors.SUPERVISOR.staff_id);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_check',proposal_id:a1.proposal_id,note:'Checked again by mistake'}),/not been checked/);
 // 3. A failing replay changes nothing and leaves the proposal waiting.
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a1.proposal_id,note:'Approved after the check'},async()=>{throw new Error('Client changed or is unavailable. Refresh before editing.');}),/Client changed/);
 assert.equal((await row(a1.proposal_id)).status,'Checked');
 // 4. The approver applies it under their own name.
 const done=await act('PARTNER',{action:'client_proposal_approve',proposal_id:a1.proposal_id,note:'Approved after the check'});assert.equal(done.status,'Approved');assert.equal(await name(),'UAT Fictional New Name Ltd');
 r=await row(a1.proposal_id);assert.equal(r.status,'Approved');assert.equal(r.decided_by,actors.PARTNER.staff_id);assert.notEqual(r.decided_by,r.proposed_by);assert.equal(r.result.ok,true);
 await assert.rejects(()=>act('PARTNER',{action:'client_proposal_approve',proposal_id:a1.proposal_id}),/already closed/);
 // 5. Whoever checked cannot also approve.
 const a2=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Contact',role_in_decision:'Decision Maker'});
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_check',proposal_id:a2.proposal_id}),/at least 10 characters/);
 await act('MANAGER',{action:'client_proposal_check',proposal_id:a2.proposal_id,note:'Contact details match the ID copy'});
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a2.proposal_id,note:'Approved by the checker'}),/another Manager or Partner must approve/);
 await act('MANAGER2',{action:'client_proposal_approve',proposal_id:a2.proposal_id,note:'Fictional approval by Manager 2'},async q=>({ok:true,saw:q.action}));assert.equal((await row(a2.proposal_id)).decided_by,actors.MANAGER2.staff_id);
 // 5b. A change proposed on an existing client is applied to the live record: the version number and any field the proposer left out come from the client as it is now.
 await tx`update erp_private.clients set branch_location='Bungoma' where client_id=${C}`;
 const liveRev=(await tx`select revision from erp_private.clients where client_id=${C}`)[0].revision;
 const a2b=await propose('ASSISTANT',{action:'client_save',client_id:C,company_name:'UAT Fictional New Name Ltd',firm_ids:[F],proposal_reason:'Live record test'});
 await act('MANAGER',{action:'client_proposal_check',proposal_id:a2b.proposal_id,note:'Checked against the certificate'});
 let seen=null;await act('MANAGER2',{action:'client_proposal_approve',proposal_id:a2b.proposal_id,note:'Approved on the live record'},async q=>{seen=q;return {ok:true};});
 assert.equal(String(seen.revision),String(liveRev));assert.equal(seen.branch_location,'Bungoma');
 // 6. A Supervisor's proposal is checked by someone else too, then approved by a Manager or Partner who neither proposed nor checked it.
 const s1=await propose('SUPERVISOR',{action:'owner_add',client_id:C,full_name:'Fictional Owner',identity_reference:'ID-FICT-1',ownership_percentage:40});
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:s1.proposal_id,note:'Approving without any check'}),/must check this proposal first/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_check',proposal_id:s1.proposal_id,note:'Checking my own proposal'}),/cannot check your own/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_approve',proposal_id:s1.proposal_id,note:'A Supervisor cannot approve'}),/Manager or Partner can approve/);
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_return',proposal_id:s1.proposal_id,note:'No'}),/cannot return your own|10 characters/);
 await act('MANAGER',{action:'client_proposal_check',proposal_id:s1.proposal_id,note:'Fallback check by a Manager: no other Supervisor'});
 await assert.rejects(()=>act('MANAGER2',{action:'client_proposal_approve',proposal_id:s1.proposal_id,note:'ok'}),/at least 10 characters/);
 await act('MANAGER2',{action:'client_proposal_approve',proposal_id:s1.proposal_id,note:'Approved after the Manager check'},async q=>({ok:true,saw:q.action}));assert.equal((await row(s1.proposal_id)).status,'Approved');
 // 7. Return needs a reason and closes it; only the proposer withdraws.
 const a3=await propose('ASSISTANT',{action:'owner_add',client_id:C,full_name:'Fictional Owner Two',identity_reference:'ID-FICT-2',ownership_percentage:10});
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_return',proposal_id:a3.proposal_id,note:'short'}),/at least 10 characters/);
 await act('SUPERVISOR',{action:'client_proposal_return',proposal_id:a3.proposal_id,note:'Identity reference is missing a digit'});assert.equal((await row(a3.proposal_id)).status,'Returned');
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:a3.proposal_id,note:'Approving a closed one'}),/already closed/);
 const a4=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Withdrawn Contact'});
 await assert.rejects(()=>act('SUPERVISOR',{action:'client_proposal_withdraw',proposal_id:a4.proposal_id}),/access/);
 await act('ASSISTANT',{action:'client_proposal_withdraw',proposal_id:a4.proposal_id});assert.equal((await row(a4.proposal_id)).status,'Withdrawn');
 // 8. The database refuses shortcuts even if the server were bypassed.
 const a5=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Shortcut Contact'});
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.change_proposals set status='Approved' where proposal_id=${a5.proposal_id}`),/Manager or Partner|neither proposed/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`update erp_private.change_proposals set payload='{}'::jsonb where proposal_id=${a5.proposal_id}`),/cannot be edited/);
 await assert.rejects(()=>as('MANAGER',()=>tx`update erp_private.change_proposals set status='Approved' where proposal_id=${a5.proposal_id}`),/check/);
 // The database also refuses a check or decision without a real note, whatever endpoint is used.
 const a6=await propose('ASSISTANT',{action:'contact_save',client_id:C,full_name:'Fictional Note Contact'});
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.change_proposals set status='Checked',check_note='ok' where proposal_id=${a6.proposal_id}`),/at least 10 characters/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.change_proposals set status='Checked' where proposal_id=${a6.proposal_id}`),/at least 10 characters/);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.change_proposals set status='Checked',check_note='          ' where proposal_id=${a6.proposal_id}`),/at least 10 characters/);
 await assert.rejects(()=>as('MANAGER',()=>tx`delete from erp_private.change_proposals where proposal_id=${a5.proposal_id}`),/delet|permission denied/i);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`insert into erp_private.change_proposals(action,summary,payload,proposed_by,proposed_role) values('client_save','Forged',${'{}'},${actors.MANAGER.staff_id},'ASSISTANT')`),/row-level security/);
 // 9. Visibility: an Assistant sees only their own; a Supervisor and the leaders see every proposal.
 const mine=await as('ASSISTANT',()=>proposalsRead(tx)),all=await as('SUPERVISOR',()=>proposalsRead(tx));
 assert.ok(mine.length>=1&&mine.every(p=>p.proposed_by===actors.ASSISTANT.staff_id));assert.ok(all.some(p=>p.proposed_role==='SUPERVISOR')&&all.length>mine.length);
 assert.equal(proposalSummary('owner_add',{full_name:'Jane'}),'Add owner or controller: Jane');

 // A new client does not need a pre-existing assignment. The proposer still needs firm access.
 const otherFirm=id(),newClientRows=()=>tx`select client_id from erp_private.clients where company_name=${newClient.company_name}`;
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${otherFirm},'PRQAX','Out-of-scope proposals firm')`;
 await assert.rejects(()=>propose('ASSISTANT',{...newClient,firm_ids:[otherFirm]}),/handling firm that your account can access/);
 await assert.rejects(()=>propose('ASSISTANT',{...newClient,firm_ids:[]}),/Select at least one handling firm/);
 await assert.rejects(()=>propose('ASSISTANT',{...newClient,kra_pin:'INVALID'}),/Check the KRA PIN format/);
 await assert.rejects(()=>propose('ASSISTANT',{...newClient,legal_structure:'',legal_subtype:''}),/Choose the client’s Legal structure and Subcategory/);
 await assert.rejects(()=>propose('ASSISTANT',{...newClient,legal_subtype:'Public Body'}),/subcategory does not belong/);
 const draft=await propose('ASSISTANT',newClient),draftRow=await row(draft.proposal_id);
 assert.equal(draftRow.client_id,null);
 assert.equal(draftRow.status,'Proposed');
 assert.equal(draftRow.payload.company_name,newClient.company_name);
 assert.deepEqual(await newClientRows(),[]);
 await assert.rejects(()=>act('MANAGER',{action:'client_proposal_approve',proposal_id:draft.proposal_id,note:'Approval before the check'}),/must check this proposal first/);
 await act('SUPERVISOR',{action:'client_proposal_check',proposal_id:draft.proposal_id,note:'Checked client identity and firm'});
 assert.deepEqual(await newClientRows(),[]);
 const created=await act('MANAGER',{action:'client_proposal_approve',proposal_id:draft.proposal_id,note:'Approved after independent review'},async q=>{
  assert.equal(q.action,'client_save');assert.equal(q.client_id,undefined);
  const {name,pin,branch,cat}=await readClientEntry(tx,q),cid=id();
  await tx`insert into erp_private.clients(client_id,company_name,kra_pin,branch_location,client_category,owner_staff_id)
   values(${cid},${name},${pin},${branch},${cat},${actors.MANAGER.staff_id})`;
  await applyLegalStructure(tx,actors.MANAGER,cid,q,true);
  for(const firm of handlingFirmIds(q))await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${cid},${firm})`;
  return {ok:true,client_id:cid};
 });
 assert.deepEqual(await newClientRows(),[{client_id:created.applied.client_id}]);
 assert.equal((await tx`select legal_subtype from erp_private.clients where client_id=${created.applied.client_id}`)[0].legal_subtype,newClient.legal_subtype);
 assert.equal((await tx`select firm_id from erp_private.client_firm_links where client_id=${created.applied.client_id}`)[0].firm_id,F);
});
