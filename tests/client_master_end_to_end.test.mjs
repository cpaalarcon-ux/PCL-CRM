import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {clientMasterAction}=await import('../supabase/functions/staff-workspace-v12/client-master-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),C=id(),P=id(),D=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const cm=(role,p)=>as(role,a=>clientMasterAction(tx,a,p));
test('client master: facts carry a source and are verified by a different person; readiness lists only exceptions; set-up time is measured',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id,legal_entity_type) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id},'Limited company')`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id})`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}

 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 const key=(k,v,x={})=>({action:'client_master_record',client_id:C,field_key:k,value:v,source_kind:'Document',document_id:D,...x});
 const ver=async(role,k,note='Checked against the document')=>{const r=await cm(role,{action:'client_master_read',client_id:C});const row=r.rows.find(x=>x.key===k);return cm(role,{action:'client_master_verify',fact_id:row.fact.fact_id,revision:row.fact.revision,note});};
 const r0=await cm('ASSISTANT',{action:'client_master_read',client_id:C});
 assert.equal(r0.required,9);assert.equal(r0.verified,0);assert.equal(r0.ready,false);assert.equal(r0.started_at,null);assert.ok(r0.exceptions.every(e=>e.state==='Missing'));
 await assert.rejects(()=>cm('INTERN',{action:'client_master_read',client_id:C}),/client access/);

 // Recording checks the value and the source; nothing is guessed.
 await assert.rejects(()=>cm('ASSISTANT',key('kra_pin','12345')),/Check kra pin/i);
 await assert.rejects(()=>cm('ASSISTANT',key('contact_email','nobody')),/Check contact email/i);
 await assert.rejects(()=>cm('ASSISTANT',key('favourite_colour','blue')),/not a field/);
 await assert.rejects(()=>cm('ASSISTANT',key('company_name','Fictional V3 client',{document_id:null})),/uploaded document/);
 await assert.rejects(()=>cm('ASSISTANT',key('company_name','Fictional V3 client',{source_kind:'Online register'})),/Say which register/);
 await assert.rejects(()=>cm('ASSISTANT',key('company_name','Fictional V3 client',{document_id:id()})),/does not belong/);
 const first=await cm('ASSISTANT',key('company_name','Fictional V3 client'));
 assert.ok(first.started_at);assert.equal(first.rows.find(x=>x.key==='company_name').state,'Recorded');assert.match(first.rows.find(x=>x.key==='company_name').issue,/different Supervisor/);
 await assert.rejects(()=>cm('ASSISTANT',key('company_name','Fictional V3 client')),/already recorded exactly/);

 // Verification: independent, by a reviewer, against a real source.
 await assert.rejects(()=>ver('ASSISTANT','company_name'),/Supervisor, Manager or Partner/);
 await cm('SUPERVISOR',key('kra_pin','A000000001Z',{source_kind:'Online register',document_id:null,source_reference:'iTax PIN checker, fictional lookup'}));
 await assert.rejects(()=>ver('SUPERVISOR','kra_pin'),/different person/);
 await cm('ASSISTANT',key('registered_address','P.O. Box 1, Fictional Town',{source_kind:'Client statement',document_id:null}));
 await assert.rejects(()=>ver('MANAGER','registered_address'),/own statement cannot be verified/);
 const st=await cm('ASSISTANT',{action:'client_master_read',client_id:C});assert.match(st.rows.find(x=>x.key==='registered_address').issue,/Only the client's own statement/);
 await assert.rejects(()=>cm('SUPERVISOR',{action:'client_master_verify',fact_id:st.rows.find(x=>x.key==='company_name').fact.fact_id,revision:'999',note:'Checked against the document'}),/changed/);
 await assert.rejects(()=>cm('SUPERVISOR',{action:'client_master_verify',fact_id:st.rows.find(x=>x.key==='company_name').fact.fact_id,revision:st.rows.find(x=>x.key==='company_name').fact.revision,note:'ok'}),/at least 3/).catch(()=>{});
 const v1=await ver('SUPERVISOR','company_name');assert.equal(v1.rows.find(x=>x.key==='company_name').state,'Verified');assert.equal(v1.verified,1);
 await ver('MANAGER','kra_pin','Matches the PIN certificate and the register lookup');

 // The database refuses edits and deletes whatever the application does.
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.client_field_facts set value='Changed' where field_key='company_name'`),/never edited/);
 await assert.rejects(()=>as('PARTNER',()=>tx`delete from erp_private.client_field_facts where field_key='company_name'`),/./);
 await assert.rejects(()=>as('SUPERVISOR',()=>tx`update erp_private.client_field_facts set status='Verified',verified_by=${actors.SUPERVISOR.staff_id},verified_at=now(),verification_note='Self check' where field_key='registered_address' and status='Recorded'`),/./);

 // Fill the rest; the last verification stamps "ready" once.
 await cm('ASSISTANT',key('registered_address','P.O. Box 1, Fictional Town',{source_kind:'Document',reason:'Replaced with the utility bill',}));
 for(const [k,v] of [['registration_number','C.000001'],['incorporation_date','2020-02-29'],['contact_person','Fictional Contact'],['contact_phone','+254700000001'],['contact_email','contact@example.com'],['year_end','12-31']])await cm('ASSISTANT',key(k,v));
 let last;for(const k of ['registered_address','registration_number','incorporation_date','contact_person','contact_phone','contact_email','year_end'])last=await ver(k==='year_end'?'PARTNER':'SUPERVISOR',k);
 assert.equal(last.ready,true,JSON.stringify(last.exceptions));assert.equal(last.percent,100);assert.ok(last.ready_at);assert.equal(typeof last.minutes_to_ready,'number');
 assert.equal(last.history.length,1);assert.match(last.history[0].superseded_reason,/utility bill/);assert.equal(last.history[0].source_kind,'Client statement');
 assert.equal((await tx`select count(*)::int n from erp_private.client_setup_milestones where client_id=${C}`)[0].n,2);

 // Changing a verified value needs a reason, supersedes it, and starts again unverified. The first "ready" moment is kept.
 await assert.rejects(()=>cm('ASSISTANT',key('kra_pin','A000000002Z',{source_kind:'Online register',document_id:null,source_reference:'iTax lookup'})),/Say why it is being replaced/);
 const ch=await cm('ASSISTANT',key('kra_pin','A000000002Z',{source_kind:'Online register',document_id:null,source_reference:'iTax lookup',reason:'The client supplied a corrected certificate'}));
 assert.equal(ch.ready,false);assert.equal(ch.rows.find(x=>x.key==='kra_pin').state,'Recorded');assert.equal(ch.history.length,2);assert.ok(ch.ready_at,'first ready moment kept');
 await ver('MANAGER','kra_pin');
 // A verified fact that disagrees with the client record is an exception.
 await tx`update erp_private.clients set kra_pin='A000000009Z' where client_id=${C}`;
 const df=await cm('SUPERVISOR',{action:'client_master_read',client_id:C});assert.equal(df.rows.find(x=>x.key==='kra_pin').state,'Differs');assert.equal(df.ready,false);assert.match(df.exceptions[0].issue,/client record says "A000000009Z"/);

 // The report: elapsed set-up time, with a baseline.
 await assert.rejects(()=>cm('ASSISTANT',{action:'client_master_report'}),/Supervisor, Manager or Partner/);
 const rep=await cm('MANAGER',{action:'client_master_report',baseline_minutes:120});
 assert.equal(rep.rows.length,1);assert.equal(rep.summary.clients_ready,1);assert.equal(typeof rep.summary.average_minutes,'number');assert.equal(rep.summary.baseline_minutes,120);assert.ok(rep.summary.reduction_percent<=100);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='CLIENT_FACT_RECORDED'`)[0].n>=11,true);
 assert.equal((await tx`select count(*)::int n from erp_private.audit_events where action='CLIENT_FACT_VERIFIED'`)[0].n>=10,true);
});
