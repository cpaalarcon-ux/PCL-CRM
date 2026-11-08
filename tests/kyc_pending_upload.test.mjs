// Build .107c: Assistants propose KYC files; only Managers and Partners can open them; approval moves the file into the Permanent File.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {createProposal,proposalAction,proposalsRead,proposalSummary}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const {policyAction}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const propose=(role,p)=>as(role,a=>createProposal(tx,a,p)),act=(role,p,replay)=>as(role,a=>proposalAction(tx,a,p,replay||(async q=>{await tx`update erp_private.clients set company_name=${q.company_name} where client_id=${q.client_id}`;return {ok:true,client_id:q.client_id};}))),
 row=async pid=>(await tx`select * from erp_private.change_proposals where proposal_id=${pid}`)[0],name=async()=>(await tx`select company_name from erp_private.clients where client_id=${C}`)[0].company_name;
test("proposed KYC files stay hidden and become evidence only on approval",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of ['ASSISTANT','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));// Assistants may propose only after the Partner has signed
 const {engagementAction}=await import('../supabase/functions/staff-workspace-v12/engagement-actions.ts');
 const rejects=(fn,re)=>assert.rejects(fn,re);
 const FILE=id();
 const docRow=async()=>(await tx`select category,is_locked,uploaded_by from erp_private.documents where document_id=${FILE}`)[0];
 const putDoc=(role,cat)=>as(role,()=>tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${FILE},${C},${F},${cat},'cert-of-incorporation.pdf','k/'||${FILE}::text,100,${'a'.repeat(64)},'application/pdf',${actors[role].staff_id})`);
 // 1. Who may put a file in the pending category.
 await rejects(()=>putDoc('ASSISTANT','Permanent File'),/row-level security/);
 await putDoc('ASSISTANT','KYC Pending');
 assert.equal((await docRow()).category,'KYC Pending');
 // 2. Who can see it: the uploader cannot read it back; Managers and Partners can.
 assert.equal((await as('ASSISTANT',()=>tx`select document_id from erp_private.documents where document_id=${FILE}`)).length,0,'the uploader cannot open the file');
 assert.equal((await as('SUPERVISOR',()=>tx`select document_id from erp_private.documents where document_id=${FILE}`)).length,0,'a Supervisor cannot open it either');
 assert.equal((await as('MANAGER',()=>tx`select document_id from erp_private.documents where document_id=${FILE}`)).length,1);
 assert.equal((await as('PARTNER',()=>tx`select document_id from erp_private.documents where document_id=${FILE}`)).length,1);
 // 3. Proposing it: own file, upload form only; someone else's file or a bad form is refused.
 const ev={action:'compliance_evidence_save',client_id:C,document_type:'REGISTRATION_IDENTITY',evidence_form:'upload',document_id:FILE,evidence_date:new Date().toISOString().slice(0,10)};
 await rejects(()=>propose('ASSISTANT',{...ev,evidence_form:'physical'}),/uploading it/);
 await rejects(()=>propose('SUPERVISOR',ev),/Upload the KYC file first/);
 await rejects(()=>propose('ASSISTANT',{...ev,document_id:id()}),/Upload the KYC file first/);
 const pr=await propose('ASSISTANT',ev);assert.equal(pr.proposed,true);
 const stored=await row(pr.proposal_id);assert.equal(stored.summary,'Add KYC file: REGISTRATION_IDENTITY (cert-of-incorporation.pdf)');assert.equal(stored.payload.file_name,undefined);assert.equal(stored.payload.document_id,FILE);
 assert.equal((await docRow()).category,'KYC Pending','proposing changes nothing');
 // 4. A leader cannot attach the pending file straight away, and approval needs the proposal route.
 await tx`insert into erp_private.client_compliance(client_id,conflict_checked,sanctions_date,sanctions_result,review_due) values(${C},true,(now() at time zone 'UTC')::date,'Fictional clear screening',((now() at time zone 'UTC')::date+365))`;
 await rejects(()=>as('MANAGER',a=>engagementAction(tx,a,ev)),/Approve the proposal/);
 // 5. Check, then a different Manager approves; the approver's account records the evidence and the file joins the Permanent File.
 await act('SUPERVISOR',{action:'client_proposal_check',proposal_id:pr.proposal_id,note:'File matches the certificate number'});
 await rejects(()=>act('ASSISTANT',{action:'client_proposal_approve',proposal_id:pr.proposal_id,note:'Approving my own file'}),/Manager or Partner can approve/);
 const replay=q=>engagementAction(tx,actors.MANAGER,q);
 await act('MANAGER',{action:'client_proposal_approve',proposal_id:pr.proposal_id,note:'Approved after sighting the certificate'},replay);
 const after=await docRow();assert.equal(after.category,'Permanent File');assert.equal(after.is_locked,true,'the file is now locked evidence');
 const evid=(await tx`select recorded_by,document_id,evidence_form from erp_private.client_kyc_evidence where client_id=${C} and deleted_at is null`);
 assert.equal(evid.length,1);assert.equal(evid[0].recorded_by,actors.MANAGER.staff_id,'the approver is the recorder');assert.equal(evid[0].document_id,FILE);
 assert.equal((await as('ASSISTANT',()=>tx`select document_id from erp_private.documents where document_id=${FILE}`)).length,0,'the Assistant still cannot open the permanent file');
 // 6. A leader who uploaded a file cannot approve it as evidence through the promote function.
 const F2=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${F2},${C},${F},'KYC Pending','other.pdf','k/'||${F2}::text,100,${'b'.repeat(64)},'application/pdf',${actors.MANAGER.staff_id})`;
 await rejects(()=>as('MANAGER',()=>tx`select erp_private.kyc_promote_document(${F2}::uuid,${C}::uuid)`),/uploaded this file/);
 await rejects(()=>as('ASSISTANT',()=>tx`select erp_private.kyc_promote_document(${F2}::uuid,${C}::uuid)`),/Only a Manager or Partner/);
});
