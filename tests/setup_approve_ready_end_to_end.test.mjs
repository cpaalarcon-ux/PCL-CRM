import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
globalThis.Deno=globalThis.Deno||{env:{get:()=>''}};
const {clientSetupReviewAction}=await import('../supabase/functions/staff-workspace-v12/client-setup-review-actions.ts');
const {proposalAction}=await import('../supabase/functions/staff-workspace-v12/proposal-actions.ts');


const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const rv=(role,p)=>as(role,a=>clientSetupReviewAction(tx,a,p));

const approveProposal=(role,pid,replay)=>as(role,a=>proposalAction(tx,a,{action:'client_proposal_approve',proposal_id:pid,note:'Checked against the certificate on the physical file'},replay));
test('Approve all ready and approve once, on a real database layer',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'TSKQA','Fictional tasks firm')`;
 for(const role of ['PARTNER','MANAGER','ASSISTANT','INTERN']){const cat=role.replace('2','');const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:cat};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${cat},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const C=id(),P=id();
 await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,legal_entity_type,entity_evidence,year_end_month,year_end_day,owner_staff_id) values(${C},'UAT FICTIONAL READY LIMITED','P051000019B','Wholesale & Retail','Kisii','Limited company','CR-FICTIONAL-0019 fictional certificate',12,31,${actors.MANAGER.staff_id})`;
 await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const st=async code=>(await tx`select status,content_digest,approved_digest,reviewed_by from erp_private.client_setup_sections where client_id=${C} and section_code=${code}`)[0];
 const ready=(role,p={})=>as(role,a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_approve_ready',...p}));
 const addContact=async n=>tx`insert into erp_private.client_contacts(client_id,full_name,email_address) values(${C},${n},${n.toLowerCase().replace(/ /g,'.')+'@example.test'})`;
 await addContact('Fictional Contact One');

 // Manager sends identity, year_end, contacts. The Assistant cannot review. The Manager cannot approve what they sent.
 await as('MANAGER',a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_submit',client_id:C,sections:[{section_code:'identity',source_kind:'BRS'},{section_code:'year_end',source_kind:'KRA'},{section_code:'contacts',source_kind:'Permanent file'}]}));
 await assert.rejects(ready('ASSISTANT'),/Manager or Partner/);
 const pm=await ready('MANAGER');assert.equal(pm.dry_run,true);assert.equal(pm.ready,0);assert.equal(pm.left.length,3);assert.match(pm.left[0].reason,/You sent this/);
 assert.equal((await ready('MANAGER',{dry_run:false,note:'Approving my own work'})).approved,0,'a Manager cannot approve what they sent, even by pressing apply');
 assert.equal((await st('identity')).status,'Pending Review');

 // The Partner (the firm's only Partner) previews: a dry run changes nothing.
 const before=(await tx`select count(*)::int n from erp_private.client_setup_section_events`)[0].n;
 const pv=await ready('PARTNER');assert.equal(pv.dry_run,true);assert.equal(pv.ready,3);assert.equal(pv.clients,1);assert.equal(pv.sole_partner,true);
 assert.equal((await tx`select count(*)::int n from erp_private.client_setup_section_events`)[0].n,before,'a preview writes nothing');
 assert.equal((await st('identity')).status,'Pending Review');

 // A section edited after it was sent is left for a person, and the rest are approved.
 await addContact('Fictional Contact Two');
 const pv2=await ready('PARTNER');assert.equal(pv2.ready,2);assert.equal(pv2.left.length,1);assert.equal(pv2.left[0].section_code,'contacts');assert.match(pv2.left[0].reason,/Edited after it was sent/);
 await assert.rejects(ready('PARTNER',{dry_run:false,note:'short'}),/at least 10 characters/);
 const done=await ready('PARTNER',{dry_run:false,note:'Checked against the physical files'});assert.equal(done.approved,2);
 assert.equal((await st('identity')).status,'Approved');assert.equal((await st('year_end')).status,'Approved');assert.equal((await st('contacts')).status,'Pending Review');
 assert.equal((await st('identity')).reviewed_by,actors.PARTNER.staff_id);
 assert.ok((await tx`select 1 from erp_private.client_setup_section_events where client_id=${C} and section_code='identity' and action='Approved' and note like 'Approved in bulk%'`).length,'the history records the bulk approval');
 assert.equal((await ready('PARTNER')).ready,0,'a second run finds nothing left to approve');

 // Approve once: the Assistant proposes a contact, the Manager checks it, the Partner approves it. The pending contacts section is first re-sent,
 // then the approval of the proposal approves the section together with the change.
 await as('MANAGER',a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_submit',client_id:C,sections:[{section_code:'contacts',source_kind:'Permanent file'}]}));
 assert.equal((await st('contacts')).status,'Pending Review');
 const prop=async()=>{const pid=id();await tx`insert into erp_private.change_proposals(proposal_id,client_id,action,summary,payload,reason,status,proposed_by,proposed_role,checked_by,checked_at,check_note) values(${pid},${C},'contact_save','Add client contact: Fictional Contact Three',${tx.json({full_name:'Fictional Contact Three',client_id:C})},'Contact on the file','Checked',${actors.ASSISTANT.staff_id},'ASSISTANT',${actors.MANAGER.staff_id},now(),'Checked against the file')`;return pid;};
 const p1=await prop();
 const out=await approveProposal('PARTNER',p1,async()=>{await addContact('Fictional Contact Three');return {ok:true};});
 assert.deepEqual(out.sections_approved,['contacts']);const c1=await st('contacts');assert.equal(c1.status,'Approved');assert.equal(c1.approved_digest,c1.content_digest);

 // Approve once does nothing when another proposal for the client is still open.
 await addContact('Fictional Contact Direct');
 await as('MANAGER',a=>clientSetupReviewAction(tx,a,{action:'client_setup_section_submit',client_id:C,sections:[{section_code:'contacts',source_kind:'Permanent file'}]}));
 const p2=await prop(),p3=await prop();
 const out2=await approveProposal('PARTNER',p2,async()=>{await addContact('Fictional Contact Four');return {ok:true};});
 assert.equal((await st('contacts')).status,'Pending Review');assert.deepEqual(out2.sections_approved,[]);assert.equal((await st('contacts')).status,'Pending Review');
 void p3;
});
