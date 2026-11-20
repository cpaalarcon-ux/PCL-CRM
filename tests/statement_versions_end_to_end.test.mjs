import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {statementVersionAction}=await import('../supabase/functions/staff-workspace-v12/statement-version-actions.ts');
const root=path.resolve(import.meta.dirname,'..'),db=new PGlite(),id=()=>crypto.randomUUID(),F=id(),F2=id(),C=id(),P=id(),P2=id(),D=id(),B=id(),T=id(),actors={};
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};tx.json=x=>JSON.stringify(x);tx.array=x=>'{'+x.join(',')+'}';
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
let L,amount=1000;const SNAP=()=>({profit_or_loss:{rows:[{label:'Revenue',kind:'line',current:amount},{label:'Expenses',kind:'line',current:400},{label:'Section',kind:'heading'}]},financial_position:{rows:[{label:'Cash',kind:'line',current:amount-400}]}});
let ready=true;const cap=async asOf=>({client:{name:'Fictional'},reporting:{rounding:'Whole shillings'},statements:SNAP(),gate_status:'x',ready,problems:['Fictional check failing.']});const act=(role,p)=>as(role,a=>statementVersionAction(tx,a,p,L,cap));
test("statement versions: three linked locked versions with links",async t=>{
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
 const M=actors.MANAGER.staff_id,SUP=actors.SUPERVISOR.staff_id;
 const PER=id(),P3=id(),FILE=id();
 await tx`insert into erp_private.ledger_periods(period_id,project_id,client_id,handling_firm_id,starts_on,ends_on,entity_type,entity_evidence,created_by) values(${PER},${P},${C},${F},'2026-01-01','2026-12-31','Limited company','Fictional evidence',${M})`;
 L=(await tx`select * from erp_private.ledger_periods where period_id=${PER}`)[0];
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P3},${C},${F},'Fictional audit engagement','AUD-STAT',${M})`;
 for(const role of ['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P3},${actors[role].staff_id},${F},${role})`;
 await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P3},${C},${F},'2026-01-01','2026-12-31','First-year','IFRS for SMEs',${M})`;
 await db.exec('set session_replication_role=origin');
 const J=id(),JD=id();await db.exec('set session_replication_role=replica');
 await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,description,status,generated,prepared_by,last_prepared_by,reviewed_by,posted_at) values(${J},${PER},${P},'Adjustment','2026-12-31','ADJ-1','Fictional audit adjustment','Posted',false,${SUP},${SUP},${M},now())`;
 await tx`insert into erp_private.ledger_journals(journal_id,period_id,project_id,kind,journal_date,reference,description,status,generated,prepared_by,last_prepared_by) values(${JD},${PER},${P},'Adjustment','2026-12-31','ADJ-2','Fictional unposted','Draft',false,${SUP},${SUP})`;
 await db.exec('set session_replication_role=origin');
 const KC=(await tx`insert into erp_private.kra_cases(client_id,handling_firm_id,notice_reference,notice_type,tax_head,period_start,period_end,notice_date,received_on,deadline_date,summary,logged_by) values(${C},${F},'KRA-NOTICE-1','Audit notice','VAT','2026-01-01','2026-12-31',current_date,current_date,current_date+30,'Fictional audit notice for the year.',${M}) returning case_id`)[0].case_id;
 const prep=(role,o)=>act(role,{action:'ledger_fsver_prepare',project_id:P,period_id:PER,...o});
 const lock=(role,id)=>act(role,{action:'ledger_fsver_lock',project_id:P,period_id:PER,version_id:id});
 const link=(role,id,kind,target,note)=>act(role,{action:'ledger_fsver_link',project_id:P,period_id:PER,version_id:id,link_kind:kind,target_id:target,note});
 const rd=()=>act('ASSISTANT',{action:'ledger_fsver_read',project_id:P,period_id:PER});

 // Nothing to start from: only the draft can be prepared.
 let r=await rd();assert.deepEqual(r.next_steps.map(s=>[s.kind,s.allowed]),[['Draft',true],['Audit/Review Adjusted',false],['Final Signed',false]]);
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Final Signed',basis_note:'Fictional signed basis.',signed_on:'2027-03-01',signer_name:'Fictional Partner',report_reference:'REP-1'}),/no Audit\/Review Adjusted version yet/);
 await assert.rejects(()=>prep('ASSISTANT',{kind:'Draft',basis_note:'Fictional draft basis.'}),/Supervisor, Manager or Partner/);
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Draft',basis_note:'short'}),/at least 10 characters/);
 const d1=await prep('SUPERVISOR',{kind:'Draft',basis_note:'Prepared from the client ledger as at year end.'});
 assert.equal(d1.seq,1);assert.match(d1.snapshot_digest,/^[0-9a-f]{64}$/);
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Audit/Review Adjusted',basis_note:'Fictional adjusted basis.',no_adjustments:true}),/must be locked/);
 // Lock: a Manager or Partner who is not the preparer; nothing is edited afterwards.
 await assert.rejects(()=>lock('SUPERVISOR',d1.version_id),/Manager or Partner locks|different Manager/);
 await assert.rejects(()=>tx`update erp_private.statement_versions set basis_note='Edited after the fact, fictional.' where version_id=${d1.version_id}`,/never edited/);
 await lock('MANAGER',d1.version_id);
 await assert.rejects(()=>lock('MANAGER',d1.version_id),/already locked/);
 await assert.rejects(()=>tx`update erp_private.statement_versions set snapshot='{}' where version_id=${d1.version_id}`,/never edited|final/);
 // The adjusted version is built on the locked draft, only when the statements are ready, and cannot be locked without its links.
 amount=1250;ready=false;
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Audit/Review Adjusted',basis_note:'Fictional adjusted basis.'}),/statements are not ready/);
 ready=true;
 const a1=await prep('SUPERVISOR',{kind:'Audit/Review Adjusted',basis_note:'After the audit adjustment journals were posted.'});
 await assert.rejects(()=>lock('MANAGER',a1.version_id),/Link the audit file or the review engagement/);
 await assert.rejects(()=>link('SUPERVISOR',d1.version_id,'Audit file',FILE),/locked version keeps|linked to the adjusted/);
 await link('SUPERVISOR',a1.version_id,'Audit file',FILE,'Fictional audit file');
 await assert.rejects(()=>link('SUPERVISOR',a1.version_id,'Audit file',FILE),/already linked/);
 await assert.rejects(()=>lock('MANAGER',a1.version_id),/adjustment journals, or record that there were no adjustments/);
 await assert.rejects(()=>link('SUPERVISOR',a1.version_id,'Adjustment journal',JD),/posted journal/);
 await link('SUPERVISOR',a1.version_id,'Adjustment journal',J);
 r=await rd();const adj=r.versions.find(v=>v.version_id===a1.version_id);
 assert.deepEqual(adj.changes_from_base.filter(c=>c.label==='Revenue').map(c=>[c.before,c.after,c.difference]),[[1000,1250,250]],'what the adjustments changed is shown line by line');
 assert.equal(adj.links.length,2);
 await lock('MANAGER',a1.version_id);
 // The signed version: signing details, a Partner to lock it, and an approved audit file.
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Final Signed',basis_note:'Fictional signed basis.'}),/./);
 const f1=await prep('SUPERVISOR',{kind:'Final Signed',basis_note:'Signed audit report on the adjusted statements.',signed_on:'2027-03-01',signer_name:'Fictional Engagement Partner',report_reference:'AUD-REP-2026-01'});
 await link('SUPERVISOR',f1.version_id,'Audit file',FILE);
 await assert.rejects(()=>lock('MANAGER',f1.version_id),/locked by a Partner/);
 await assert.rejects(()=>lock('PARTNER',f1.version_id),/approved audit file or a review engagement/);
 await db.exec('set session_replication_role=replica');await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;await db.exec('set session_replication_role=origin');
 await lock('PARTNER',f1.version_id);
 // After locking, a KRA notice can still be noted against the version; the records it was locked with cannot change.
 await link('SUPERVISOR',f1.version_id,'KRA notice',KC,'Notice received after signing, fictional');
 await assert.rejects(()=>link('SUPERVISOR',f1.version_id,'Review engagement',P3),/locked version keeps/);
 const sl=(await rd()).versions.find(v=>v.version_id===f1.version_id);
 assert.deepEqual(sl.links.filter(x=>x.link_kind==='KRA notice').map(x=>[x.notice_reference,x.notice_type,x.notice_status]),[['KRA-NOTICE-1','Audit notice','Open']],'type, date, deadline and response status come from the KRA notice record');
 await assert.rejects(()=>act('SUPERVISOR',{action:'ledger_fsver_unlink',project_id:P,period_id:PER,version_id:f1.version_id,link_id:sl.links[0].link_id,reason:'No longer relevant, fictional.'}),/keeps its links/);
 // A correction supersedes the old draft with a reason, and what was built on it is shown as out of date. Nothing is deleted.
 await assert.rejects(()=>prep('SUPERVISOR',{kind:'Draft',basis_note:'Fictional corrected draft basis.'}),/why this version replaces/);
 amount=1300;
 const d2=await prep('SUPERVISOR',{kind:'Draft',basis_note:'Corrected draft after a late invoice.',supersede_reason:'A late supplier invoice was posted.'});
 assert.equal(d2.seq,2);
 r=await rd();
 assert.equal(r.versions.find(v=>v.version_id===d1.version_id).superseded,true);assert.equal(r.versions.find(v=>v.version_id===a1.version_id).stale,true);
 assert.deepEqual(r.next_steps.map(s=>s.allowed),[true,false,false]);
 assert.equal((await tx`select count(*)::int n from erp_private.statement_versions`)[0].n,4);
 for(const tbl of ['statement_versions','statement_version_links'])assert.deepEqual((await tx`select relrowsecurity,relforcerowsecurity from pg_class where oid=('erp_private.'||${tbl})::regclass`)[0],{relrowsecurity:true,relforcerowsecurity:true});
 await assert.rejects(()=>tx`delete from erp_private.statement_versions`,/./);
});
