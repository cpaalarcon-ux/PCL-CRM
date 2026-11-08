// Partner policy sign-off: until the Partner signs, an Assistant cannot propose client data; only a Partner signs or withdraws.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {policyAction,policiesRead,requireAssistantEntryAuthorised}=await import('../supabase/functions/staff-workspace-v12/policy-actions.ts');
const {createProposal}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');
const dom=new JSDOM('<main></main>',{url:'https://example.test/'});globalThis.document=dom.window.document;
const {policyCard,assistantLockBanner,assistantEntryOpen,policyOf,LOCKED_TEXT}=await import('../staff-policies.mjs');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('policy sign-off: Assistants are locked out until the Partner signs; only a Partner signs or withdraws; the statement cannot change',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'PRQA','Fictional proposals firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role.replace('2','')},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Old Name Ltd',${actors.MANAGER.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const P=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'UAT Fictional proposals project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of ['ASSISTANT','SUPERVISOR'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;
 const pol=()=>as('MANAGER',()=>policiesRead(tx)).then(r=>r.find(x=>x.policy_code==='ASSISTANT_DATA_ENTRY'));
 // 1. Seeded as Pending.
 let p=await pol();assert.equal(p.policy_code,'ASSISTANT_DATA_ENTRY');assert.equal(p.status,'Pending');assert.equal(p.signed_by,null);assert.match(p.statement,/I authorize Audit Assistants to enter client data/);
 // 1b. The assignment, leave and security policies are recorded as Pending too, with their own wording.
 const all=await as('MANAGER',()=>policiesRead(tx));assert.deepEqual(all.map(x=>x.policy_code).sort(),['ASSIGNMENT_POLICY','ASSISTANT_DATA_ENTRY','LEAVE_HANDOVER_POLICY','SECURITY_POLICY']);assert.ok(all.every(x=>x.status==='Pending'));assert.match(all.find(x=>x.policy_code==='SECURITY_POLICY').statement,/second factor/);
 // 2. Locked: an Assistant cannot propose client data; a Supervisor is not affected by this policy.
 const entry={action:'contact_save',client_id:C,full_name:'Fictional Contact'};
 await assert.rejects(()=>as('ASSISTANT',a=>createProposal(tx,a,entry)),/locked pending Partner authorization/);
 await assert.rejects(()=>as('ASSISTANT',a=>requireAssistantEntryAuthorised(tx,a)),/locked pending Partner authorization/);
 assert.equal((await as('SUPERVISOR',a=>createProposal(tx,a,entry))).proposed,true);
 // 3. Nobody but a Partner can sign, and a Partner must confirm.
 for(const role of ['MANAGER','SUPERVISOR','ASSISTANT'])await assert.rejects(()=>as(role,a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true})),/Only a Partner/);
 await assert.rejects(()=>as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY'})),/Confirm that you authorize/);
 await assert.rejects(()=>as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true,revision:99})),/changed/);
 // 4. The database refuses shortcuts even if the server were bypassed.
 await as('MANAGER',()=>tx`update erp_private.system_policies set status='Signed_Off' where policy_code='ASSISTANT_DATA_ENTRY'`);// row-level security hides the row from a non-Partner, so nothing changes
 assert.equal((await pol()).status,'Pending','a Manager cannot sign by writing to the table');
 await assert.rejects(()=>as('PARTNER',()=>tx`update erp_private.system_policies set statement='I authorize everything' where policy_code='ASSISTANT_DATA_ENTRY'`),/cannot be edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.system_policies where policy_code='ASSISTANT_DATA_ENTRY'`),/delet|permission denied/i);
 // 5. The Partner signs: the lock lifts, who and when are recorded, and a second signature is refused.
 const signed=await as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true}));assert.equal(signed.status,'Signed_Off');
 p=await pol();assert.equal(p.status,'Signed_Off');assert.equal(p.signed_by,actors.PARTNER.staff_id);assert.ok(p.signed_at);
 await assert.rejects(()=>as('PARTNER',a=>policyAction(tx,a,{action:'policy_sign',policy_code:'ASSISTANT_DATA_ENTRY',confirm:true})),/already signed/);
 assert.equal((await as('ASSISTANT',a=>createProposal(tx,a,entry))).proposed,true,'Assistants can propose once the Partner has signed');
 // 6. Withdrawing locks it again; the proposals already made stay.
 await assert.rejects(()=>as('MANAGER',a=>policyAction(tx,a,{action:'policy_revoke',policy_code:'ASSISTANT_DATA_ENTRY'})),/Only a Partner/);
 await as('PARTNER',a=>policyAction(tx,a,{action:'policy_revoke',policy_code:'ASSISTANT_DATA_ENTRY'}));p=await pol();assert.equal(p.status,'Pending');assert.equal(p.signed_by,null);
 await assert.rejects(()=>as('ASSISTANT',a=>createProposal(tx,a,entry)),/locked/);
 assert.equal((await tx`select count(*)::int n from erp_private.change_proposals`)[0].n,2);
 const audit=await tx`select count(*)::int n from erp_private.audit_events where table_name like '%system_policies' and action<>'INSERT'`;assert.equal(audit[0].n,2,'the signature and the withdrawal are audit-logged');
});
const me=role=>({category_code:role,staff_id:'s-'+role});
test('the Settings card and banner: Partner gets Sign / Withdraw, others read only; Assistants see the locked banner and nothing else changes',()=>{
 const pending={me:me('PARTNER'),policies:[{policy_code:'ASSISTANT_DATA_ENTRY',policy_name:'Audit Assistant Data Entry Policy',statement:'I authorize Audit Assistants to enter client data (KYC, Tax Profiles, TBs) prior to Manager/Partner review.',status:'Pending',revision:1}]};
 let html=policyCard(pending);assert.match(html,/Digitally Sign &amp; Authorize/);assert.match(html,/Pending Partner sign-off/);assert.match(html,/I authorize Audit Assistants/);
 html=policyCard({...pending,me:me('MANAGER')});assert.doesNotMatch(html,/data-policy=/);assert.match(html,/Only a Partner can sign/);
 const signed={...pending,policies:[{...pending.policies[0],status:'Signed_Off',signed_by:'s-PARTNER',signed_by_name:'P. Partner',signed_at:'2026-11-08T09:00:00Z'}]};
 html=policyCard(signed);assert.match(html,/Signed off/);assert.match(html,/P\. Partner/);assert.match(html,/data-policy="revoke"/);assert.doesNotMatch(html,/Digitally Sign/);
 assert.equal(assistantEntryOpen(pending),false);assert.equal(assistantEntryOpen(signed),true);assert.equal(policyOf({policies:[]}),undefined);assert.equal(policyCard({me:me('PARTNER'),policies:[]}),'');
 assert.match(assistantLockBanner({...pending,me:me('ASSISTANT')}),new RegExp(LOCKED_TEXT.replace(/[.]/g,'\\.')));
 assert.equal(assistantLockBanner({...signed,me:me('ASSISTANT')}),'');assert.equal(assistantLockBanner({...pending,me:me('MANAGER')}),'','only Assistants see the banner');
});
test('server wiring: sign and withdraw are Settings actions, the gate runs inside createProposal, and the read carries the policy for everyone',()=>{
 const fn=p=>fs.readFileSync(path.join(root,'supabase/functions/staff-workspace-v12',p),'utf8');
 assert.match(fn('staff-access-control.mjs'),/policy_\(\?:sign\|revoke\)/);assert.match(fn('proposal-actions.ts'),/await requireAssistantEntryAuthorised\(tx,a\)/);assert.match(fn('index.ts'),/w\.policies=await policiesRead\(tx\)/);assert.match(fn('index.ts'),/policyAction\(tx,a,p\)/);
});

test('Settings lists every other Partner policy with its own sign button, Partner only',async()=>{
 const {otherPoliciesCard}=await import('../staff-policies.mjs');
 const policies=[{policy_code:'ASSISTANT_DATA_ENTRY',policy_name:'Assistant policy',statement:'x',status:'Pending',revision:1},{policy_code:'SECURITY_POLICY',policy_name:'Security policy',statement:'Credentials are encrypted',status:'Pending',revision:1},{policy_code:'ASSIGNMENT_POLICY',policy_name:'Assignment policy',statement:'y',status:'Signed_Off',signed_by_name:'P. Partner',signed_at:'2026-11-09T01:00:00Z',revision:2}];
 let html=otherPoliciesCard({me:{category_code:'PARTNER'},policies});
 assert.doesNotMatch(html,/Assistant policy/,'the Assistant policy keeps its own card');assert.match(html,/Security policy/);assert.match(html,/data-policy="sign" data-code="SECURITY_POLICY"/);assert.match(html,/data-policy="revoke" data-code="ASSIGNMENT_POLICY"/);assert.match(html,/P\. Partner/);
 html=otherPoliciesCard({me:{category_code:'MANAGER'},policies});assert.doesNotMatch(html,/data-policy=/);assert.match(html,/Only a Partner can sign/);
 assert.equal(otherPoliciesCard({me:{category_code:'PARTNER'},policies:[policies[0]]}),'');
});

test('the Settings view actually renders both policy cards (the old firms() helper was never used)',async()=>{
 const fs=await import('node:fs');const app=fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8');
 assert.match(app,/firms:\(\)=>policyCard\(data,esc,shortDate\)\+otherPoliciesCard\(data,esc,shortDate\)\+suite\.settings\(\)/);
});
