import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {eligibilityAction}=await import('../supabase/functions/staff-workspace-v12/eligibility-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const act=(role,p)=>as(role,a=>eligibilityAction(tx,a,p));
test("service eligibility: evidence, Partner verification, expiry and the activation block",async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'V3QA','Fictional V3 firm'),(${F2},'V3OTHER','Fictional other firm')`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${role},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'Fictional V3 client',${actors.ASSISTANT.staff_id})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F}),(${C},${F2})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional V3 project','TAX-COMP',${actors.MANAGER.staff_id}),(${P2},${C},${F2},'Fictional hidden project','TAX-COMP',null)`;
 for(const role of Object.keys(actors)){await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${role})`;}
 await tx`insert into erp_private.tasks(task_id,project_id,assigned_to,task_name) values(${T},${P},${actors.ASSISTANT.staff_id},'Fictional document task')`;
 await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${D},${C},${F},${P},${T},'Working Papers','Fictional.xlsx',${'qa/'+D},100,${'a'.repeat(64)},'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',${actors.ASSISTANT.staff_id})`;
 await tx`insert into erp_private.accounting_policies(client_id,inventory_method,notes,configured_by) values(${C},'Periodic','Fictional periodic policy',${actors.MANAGER.staff_id})`;
 await tx`update erp_private.clients set legal_entity_type='Limited company',entity_evidence='Fictional verified incorporation',year_end_month=12,year_end_day=31 where client_id=${C}`;
 // The client KYC, letter and opening gates have their own tests; here only the eligibility trigger is under test.
 for(const g of ['projects_guard','entity_activation','b_client_lifecycle_project_guard','zz_opening_gate'])await db.exec(`alter table erp_private.projects disable trigger ${g}`);
 const iso=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);
 const M=actors.MANAGER.staff_id,PT=actors.PARTNER.staff_id,SUP=actors.SUPERVISOR.staff_id;
 const proj=async(svc,owner,status='Draft')=>{const p=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id) values(${p},${C},${F},${'Fictional '+svc},${svc},${status},${owner})`;return p;};
 const activate=p=>tx`update erp_private.projects set status='Active' where project_id=${p}`;
 const rec=(role,o)=>act(role,{action:'eligibility_record',service_code:'ADV-VAL',kind:'Independence and conflicts',authority:'Fictional compliance lead',reference:'IND-2026-01',evidence_note:'Conflict check signed on file, fictional.',valid_from:iso(-30),expires_on:iso(300),...o});
 const read=async()=>(await act('MANAGER',{action:'eligibility_read'}));

 // The catalogue gained ten services; services that need evidence list their requirements.
 assert.equal((await tx`select count(*)::int n from erp_private.services`)[0].n,35);
 assert.deepEqual((await tx`select kind from erp_private.service_eligibility_requirements where service_code='ADV-VAL' order by kind`).map(r=>r.kind),['Independence and conflicts','Technical competence']);
 let r0=await read();assert.ok(r0.services.some(s=>s.service_code==='RST-INS'));assert.equal(r0.services.find(s=>s.service_code==='ADV-VAL').firm_readiness.can_activate,false);

 // Existing services are untouched; a draft of a restricted service is allowed but it cannot become Active without evidence.
 await activate(await proj('ADV-PLAN',M));
 const pv=await proj('ADV-VAL',M);
 await assert.rejects(()=>activate(pv),/Missing, unverified or expired: Independence and conflicts, Technical competence/);

 // Access: interns and assistants cannot record; only a Partner verifies.
 await assert.rejects(()=>rec('INTERN',{}),/for Managers and Partners/);await assert.rejects(()=>rec('ASSISTANT',{}),/Only a Manager or Partner/);
 await assert.rejects(()=>rec('MANAGER',{kind:'Firm licence'}),/does not need this kind/);
 await assert.rejects(()=>rec('MANAGER',{kind:'Technical competence'}),/Invalid record reference/,'a named practitioner is required');
 await assert.rejects(()=>rec('MANAGER',{expires_on:iso(-40)}),/after the start date/);
 const ind=await rec('MANAGER',{}),comp=await rec('MANAGER',{kind:'Technical competence',staff_id:M,reference:'CPD-2026'});
 await assert.rejects(()=>activate(pv),/Missing, unverified or expired/,'recorded is not verified');
 await assert.rejects(()=>act('MANAGER',{action:'eligibility_verify',record_id:ind.record_id,revision:'1',verification_note:'Checked the file against the register.'}),/Partner verifies/);

 // A Partner verifies evidence a Manager recorded. A named kind covers only that person.
 await act('PARTNER',{action:'eligibility_verify',record_id:ind.record_id,revision:'1',verification_note:'Checked the signed conflict form on file.'});
 await act('PARTNER',{action:'eligibility_verify',record_id:comp.record_id,revision:'1',verification_note:'Checked the CPD certificate on file.'});
 await activate(pv);
 const other=await proj('ADV-VAL',SUP);await assert.rejects(()=>activate(other),/Technical competence/,'the supervisor has no verified competence');

 // A sole Partner may verify their own entry and it is recorded as such; stale revisions are refused.
 const own=await rec('PARTNER',{reference:'IND-2026-02'});
 await assert.rejects(()=>act('PARTNER',{action:'eligibility_verify',record_id:own.record_id,revision:'7',verification_note:'Checked the signed conflict form.'}),/changed/);
 const v=await act('PARTNER',{action:'eligibility_verify',record_id:own.record_id,revision:'1',verification_note:'Checked the signed conflict form on file.'});assert.equal(v.sole_partner,true);
 assert.equal((await tx`select sole_partner_verify from erp_private.service_eligibility_records where record_id=${own.record_id}`)[0].sole_partner_verify,true);

 // Expiry blocks activation; ended entries stop counting; entries are never edited or deleted.
 const exp=await rec('MANAGER',{service_code:'RST-DER',kind:'Firm licence',valid_from:iso(-400),expires_on:iso(-10),reference:'LIC-OLD'}),compD=await rec('MANAGER',{service_code:'RST-DER',kind:'Technical competence',staff_id:M,reference:'CPD-DER'});
 for(const x of [exp,compD])await act('PARTNER',{action:'eligibility_verify',record_id:x.record_id,revision:'1',verification_note:'Checked the evidence on file.'});
 await assert.rejects(async()=>activate(await proj('RST-DER',M)),/Firm licence/,'an expired licence does not count');
 const live=await rec('MANAGER',{service_code:'RST-DER',kind:'Firm licence',reference:'LIC-NEW'});await act('PARTNER',{action:'eligibility_verify',record_id:live.record_id,revision:'1',verification_note:'Checked the renewal certificate.'});
 const pd=await proj('RST-DER',M);await activate(pd);
 await assert.rejects(()=>act('MANAGER',{action:'eligibility_end',record_id:live.record_id,revision:'2',reason:'x'}),/at least 5 characters/);
 await act('MANAGER',{action:'eligibility_end',record_id:live.record_id,revision:'2',reason:'Licence withdrawn by the authority.'});
 await assert.rejects(async()=>activate(await proj('RST-DER',M)),/Firm licence/);
 await assert.rejects(()=>tx`update erp_private.service_eligibility_records set reference='changed' where record_id=${live.record_id}`,/never edited/);
 await assert.rejects(()=>tx`delete from erp_private.service_eligibility_records`,/./);
 await assert.rejects(()=>act('MANAGER',{action:'eligibility_end',record_id:live.record_id,revision:'3',reason:'Ending twice again.'}),/already been ended/);
 r0=await read();const d=r0.services.find(s=>s.service_code==='RST-DER');assert.ok(d.records.some(x=>x.state==='Expired'));assert.ok(d.records.some(x=>x.state==='Ended'));
 for(const tbl of ['service_eligibility_records','service_eligibility_requirements'])assert.deepEqual((await tx`select relrowsecurity,relforcerowsecurity from pg_class where oid=('erp_private.'||${tbl})::regclass`)[0],{relrowsecurity:true,relforcerowsecurity:true});
});
