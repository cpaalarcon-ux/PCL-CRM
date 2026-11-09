// Build .1092: Request Documents. Assistants use only approved templates; a Supervisor, Manager or Partner sends and records it.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {canSend,canRequest,canManageTemplates,docRequestShell,renderDocRequests} from '../staff-doc-requests.mjs';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8'),fx='supabase/functions/staff-workspace-v12/';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('screen helpers',()=>{
 assert.ok(canRequest('ASSISTANT'));assert.ok(!canRequest('INTERN'));assert.ok(canManageTemplates('MANAGER'));assert.ok(!canManageTemplates('SUPERVISOR'));
 assert.ok(canSend('SUPERVISOR','SUPERVISORS_AND_ABOVE'));assert.ok(!canSend('SUPERVISOR','MANAGERS_AND_PARTNERS'));assert.ok(!canSend('ASSISTANT','SUPERVISORS_AND_ABOVE'));assert.ok(canSend('MANAGER','MANAGERS_AND_PARTNERS'));
 assert.equal(docRequestShell('c1','INTERN',esc),'');assert.match(docRequestShell('c1','ASSISTANT',esc),/you cannot message the client yourself/);
 const req={request_id:'r1',title:'VAT',items:['Sales report <b>'],period_start:'2026-10-01',period_end:'2026-10-31',status:'Awaiting sending',requested_by:'a1',requester_name:'Asha',created_at:'2026-11-01',decided_at:null};
 const sd=v=>String(v).slice(0,10);
 const asst=renderDocRequests({requests:[req],templates:[{template_id:'t1',title:'VAT',items:['x'],status:'Approved',created_by:'m1'}],role:'ASSISTANT',level:'SUPERVISORS_AND_ABOVE',staffId:'a1',esc,shortDate:sd});
 assert.match(asst,/data-docreq="new"/);assert.doesNotMatch(asst,/data-docreq="sent"/);assert.match(asst,/Waiting for a Supervisor/);assert.match(asst,/Sales report &lt;b&gt;/);assert.doesNotMatch(asst,/tpl-new/);
 const sup=renderDocRequests({requests:[req],templates:[],role:'SUPERVISOR',level:'SUPERVISORS_AND_ABOVE',staffId:'s1',esc,shortDate:sd});assert.match(sup,/data-docreq="sent"/);assert.match(sup,/No approved request template/);
 const lock=renderDocRequests({requests:[req],templates:[],role:'SUPERVISOR',level:'MANAGERS_AND_PARTNERS',staffId:'s1',esc,shortDate:sd});assert.doesNotMatch(lock,/data-docreq="sent"/);
 const mgr=renderDocRequests({requests:[],templates:[{template_id:'t1',title:'T',items:['x'],status:'Pending',created_by:'m2'},{template_id:'t2',title:'U',items:['y'],status:'Pending',created_by:'m1'}],role:'MANAGER',level:'x',staffId:'m1',esc,shortDate:sd});
 assert.match(mgr,/data-docreq="tpl-approve" data-id="t1"/);assert.doesNotMatch(mgr,/tpl-approve" data-id="t2"/,'you cannot approve your own wording');
});
test('wiring',()=>{
 assert.match(rd(fx+'document-request-actions.ts'),/doc_request_create/);assert.match(rd(fx+'index.ts'),/documentRequestAction\(tx,a,p\)/);assert.match(rd(fx+'staff-access-control.mjs'),/doc_request_/);
 assert.match(rd('staff-client-profile.mjs'),/docRequestShell\(c\.client_id/);assert.match(rd('staff-pilot.mjs'),/paintDocRequests/);assert.match(rd('staff-pilot.mjs'),/bindDocRequests\(/);
});
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.array=x=>'{'+x.map(i=>JSON.stringify(i)).join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
test('document requests are enforced by the database',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'DRQ','Fictional document request firm')`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace('2','')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id,S=actors.SUPERVISOR.staff_id,A=actors.ASSISTANT.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Request Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional request project','TAX-COMP',${M})`;
 for(const role of ['PARTNER','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 await tx`insert into erp_private.client_contacts(client_id,full_name,role_in_decision) values(${C},'Fictional Contact','Day-to-Day Contact')`;
 const contact=(await tx`select contact_id from erp_private.client_contacts where client_id=${C}`)[0].contact_id;
 await as('MANAGER',()=>tx`select erp_private.client_routing_save(${C}::uuid,${contact}::uuid,${contact}::uuid)`);
 // Templates: three starter templates wait for approval; Assistants see none until a Manager or Partner approves.
 const list=role=>as(role,()=>tx`select template_id,title,status from erp_private.doc_request_templates order by title`);
 assert.equal((await list('MANAGER')).length,3);assert.equal((await list('ASSISTANT')).length,0,'unapproved templates are hidden from Assistants');
 const own=(await as('MANAGER',()=>tx`select erp_private.doc_request_template_save(null,'Fictional PAYE documents','Dear {client}, please send the PAYE documents for {period} listed below.',${tx.array(['Payroll summary','Payslips','P10 return'])}::text[]) id`))[0].id;
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.doc_request_template_decide(${own}::uuid,'Approve')`),/Another Manager or Partner/);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.doc_request_template_save(null,'Assistant template','Dear {client}, send everything for {period}.',${tx.array(['Anything'])}::text[])`),/Only a Manager or Partner/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.doc_request_template_save(null,'Bad','Dear {client}, send the list for {period}.',${tx.array(['ab'])}::text[])`),/3 to 120 characters/);
 await as('MANAGER2',()=>tx`select erp_private.doc_request_template_decide(${own}::uuid,'Approve')`);
 assert.deepEqual((await list('ASSISTANT')).map(x=>x.title),['Fictional PAYE documents']);
 // Editing the wording sends it back to Pending, so Assistants cannot use unreviewed wording.
 await as('MANAGER2',()=>tx`select erp_private.doc_request_template_save(${own}::uuid,'Fictional PAYE documents','Dear {client}, please send the PAYE papers for {period} below.',${tx.array(['Payroll summary','Payslips','P10 return'])}::text[])`);
 assert.equal((await list('ASSISTANT')).length,0);
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.doc_request_create(${C}::uuid,${P}::uuid,${own}::uuid,${tx.array(['Payslips'])}::text[],'2026-10-01'::date,'2026-10-31'::date)`),/approved request template/);
 await as('MANAGER',()=>tx`select erp_private.doc_request_template_decide(${own}::uuid,'Approve')`);
 // Creating a request.
 const create=(role,items,start='2026-10-01',end='2026-10-31',proj=P)=>as(role,()=>tx`select erp_private.doc_request_create(${C}::uuid,${proj}::uuid,${own}::uuid,${tx.array(items)}::text[],${start}::date,${end}::date) id`).then(r=>r[0].id);
 await assert.rejects(()=>create('INTERN',['Payslips']),/cannot request documents/);
 await assert.rejects(()=>create('ASSISTANT',[]),/Tick at least one item/);
 await assert.rejects(()=>create('ASSISTANT',['Payslips','Bank statements']),/outside the template/);
 await assert.rejects(()=>create('ASSISTANT',['Payslips'],'2026-10-31','2026-10-01'),/period/);
 const r1=await create('ASSISTANT',['P10 return','Payslips']);
 const row=(await tx`select message_text,items,contact_id,status from erp_private.document_requests where request_id=${r1}`)[0];
 assert.match(row.message_text,/UAT Fictional Request Ltd/);assert.match(row.message_text,/01 Oct 2026 to 31 Oct 2026/);assert.deepEqual(row.items,['Payslips','P10 return'],'items keep the template order');assert.equal(row.contact_id,contact);assert.equal(row.status,'Awaiting sending');
 const note=await tx`select recipient_id from erp_private.notifications where event_key like ${'doc-request:'+r1+':%'}`;
 assert.ok(note.some(x=>x.recipient_id===S),'the Supervisor on the project is told');assert.ok(note.some(x=>x.recipient_id===M),'a Manager is told');assert.ok(!note.some(x=>x.recipient_id===A),'the Assistant is not');
 // An Assistant cannot send, cancel or edit it.
 await assert.rejects(()=>as('ASSISTANT',()=>tx`select erp_private.doc_request_decide(${r1}::uuid,'Sent','Email','')`),/Only a Supervisor, Manager or Partner/);
 await as('ASSISTANT',()=>tx`update erp_private.document_requests set status='Sent' where request_id=${r1}`).catch(()=>{});
 assert.equal((await tx`select status from erp_private.document_requests where request_id=${r1}`)[0].status,'Awaiting sending');
 // A Supervisor sends it; the Assistant is told; it cannot be handled twice.
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.doc_request_decide(${r1}::uuid,'Sent','Telegram','')`),/how you sent it/);
 await as('SUPERVISOR',()=>tx`select erp_private.doc_request_decide(${r1}::uuid,'Sent','WhatsApp','Sent to the contact')`);
 const done=(await tx`select status,sent_via,decided_by from erp_private.document_requests where request_id=${r1}`)[0];assert.deepEqual([done.status,done.sent_via,done.decided_by],['Sent','WhatsApp',S]);
 assert.match((await tx`select message from erp_private.notifications where event_key=${'doc-request-sent:'+r1}`)[0].message,/sent your document request/);
 await assert.rejects(()=>as('MANAGER',()=>tx`select erp_private.doc_request_decide(${r1}::uuid,'Cancel','','A second decision on the same request')`),/already handled/);
 // Cancelling needs a reason. A client limited to Managers and Partners keeps Supervisors out of the send step.
 const r2=await create('ASSISTANT',['Payslips']);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.doc_request_decide(${r2}::uuid,'Cancel','','short')`),/at least 10 characters/);
 await as('MANAGER',()=>tx`select erp_private.client_comm_access_save(${C}::uuid,'MANAGERS_AND_PARTNERS','Sensitive dispute; Managers handle all contact')`);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`select erp_private.doc_request_decide(${r2}::uuid,'Sent','Email','')`),/limited to Managers and Partners/);
 await as('MANAGER',()=>tx`select erp_private.doc_request_decide(${r2}::uuid,'Cancel','','Client asked us to wait until next week')`);
 assert.equal((await tx`select status from erp_private.document_requests where request_id=${r2}`)[0].status,'Cancelled');
 // The Assistant still sees their own requests; another Assistant-level person would not see others' (no row for them here).
 assert.equal((await as('ASSISTANT',()=>tx`select request_id from erp_private.document_requests`)).length,2);
 // Not for clients that are not active.
 await as('PARTNER',()=>tx`select erp_private.client_lifecycle(${C}::uuid,'Pause','Fictional pause for the request test')`);
 await assert.rejects(()=>create('ASSISTANT',['Payslips']),/active client/);
});
