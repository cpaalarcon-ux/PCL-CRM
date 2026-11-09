// Audit build S8: milestones with compare, assembly seal, late changes, the deadline lock and the archive gate.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('S8: milestones and compare, assembly seal, late changes, deadline lock, archive gate',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Assembly Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P},${C},${F},'Fictional statutory audit','AUD-STAT',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors[role].staff_id},${F},${actors[role].category_code})`;
 const FILE=id(),FILE2=id(),P2=id();
 await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${P2},${C},${F},'Fictional prior-year audit','AUD-STAT',${M})`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P2},${actors[role].staff_id},${F},${actors[role].category_code})`;
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE},${P},${C},${F},'2025-01-01','2025-12-31','First-year','IFRS for SMEs',${M})`;
 await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${FILE2},${P2},${C},${F},'2024-01-01','2024-12-31','Subsequent-year','IFRS for SMEs',${M})`;
 // The other file gates (planning, populations, reports) are tested in their own files; only the assembly triggers stay on.
 for(const r of await tx`select tgname from pg_trigger where tgrelid='erp_private.audit_files'::regclass and not tgisinternal and tgname not in('milestone_auto','archive_gate','a_assembly_lock') and tgname ~ 'gate|guard|check|sasra|eqcr|invoice|billing'`)await db.exec(`alter table erp_private.audit_files disable trigger ${r.tgname}`);
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const ws=async(role='MANAGER',f=FILE)=>j((await q(role,'select erp_private.audit_assembly_workspace($1) w',[f]))[0].w);
 const cmp=async(a,b,f=FILE)=>j((await q('MANAGER','select erp_private.audit_milestone_compare($1,$2,$3) c',[f,a,b]))[0].c);
 const comp=(c,key)=>c.components.find(x=>x.key===key);
 const risk=(role,d='Revenue may be recognised before delivery')=>q(role,'select erp_private.audit_risk_save($1,null::uuid,$2,$3,$4,$5,$6,$7,$8) i',[FILE,d,'Revenue','Occurrence','High',true,false,'Test sales cut-off around year end']);

 // ---- 1. Milestones: who may take one, which kinds, append-only --------------------------------------------------------------------
 assert.equal((await ws()).milestones.length,0);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Planning complete','Planning done','x']),/Only a Manager or Partner/);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Approved','Not by hand','x']),/Choose a milestone/);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Other','x','x']),/Name the milestone/);
 await q('MANAGER','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Planning complete','Planning complete','Risks and materiality agreed']);
 assert.equal((await q('INTERN','select erp_private.audit_assembly_workspace($1) w',[FILE]))[0].w,null);
 let w=await ws();const m1=w.milestones[0].milestone_id;assert.equal(w.milestones.length,1);assert.equal(w.milestones[0].kind,'Planning complete');
 await assert.rejects(()=>db.query(`update erp_private.audit_milestones set label='Renamed' where milestone_id=$1`,[m1]),/cannot be changed/);
 await assert.rejects(()=>db.query(`delete from erp_private.audit_milestones where milestone_id=$1`,[m1]),/./);
 assert.equal((await cmp(m1,null)).same,true,'nothing has changed since the first milestone');

 // ---- 2. Compare shows what was added, removed and changed ------------------------------------------------------------------------
 const r1=(await risk('SUPERVISOR'))[0].i;
 let c=await cmp(m1,null);assert.equal(c.same,false);assert.equal(comp(c,'risks').n_added,1);assert.deepEqual(comp(c,'risks').added,['R-001']);assert.equal(comp(c,'risks').before,0);assert.equal(comp(c,'risks').after,1);
 assert.equal(comp(c,'workpapers').changed,false,'a part of the file that did not change is not reported');
 await q('PARTNER','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Fieldwork complete','Fieldwork complete','All procedures done']);
 const m2=(await ws()).milestones[1].milestone_id;
 c=await cmp(m1,m2);assert.equal(comp(c,'risks').n_added,1);assert.equal(c.b.label,'Fieldwork complete');
 assert.equal((await cmp(m2,null)).same,true);
 await tx`update erp_private.audit_risks set planned_response='Test sales cut-off and credit notes after year end' where risk_id=${r1}`;
 c=await cmp(m2,null);assert.deepEqual(comp(c,'risks').edited,['R-001']);assert.equal(comp(c,'risks').n_added,0);assert.equal(comp(c,'risks').n_removed,0);
 c=await cmp(null?m1:m2,m1);assert.deepEqual(comp(c,'risks').removed,['R-001'],'comparing backwards shows it as removed');
 await assert.rejects(()=>cmp(id(),null),/Choose a milestone to compare from/);
 await assert.rejects(()=>cmp(m1,id()),/Choose a milestone to compare with/);
 await assert.rejects(()=>cmp(m1,null,FILE2).then(x=>x),/Choose a milestone to compare from/,'a milestone of another file cannot be used');

 // ---- 3. The file takes its own milestones ---------------------------------------------------------------------------------------
 await tx`update erp_private.audit_files set file_status='Prepared' where audit_file_id=${FILE}`;
 await tx`update erp_private.audit_files set file_status='In Review' where audit_file_id=${FILE}`;
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 await tx`update erp_private.audit_files set file_status='Completion' where audit_file_id=${FILE}`;
 w=await ws();assert.deepEqual(w.milestones.map(x=>x.kind),['Planning complete','Fieldwork complete','Sent for review','Approved','Completion']);
 assert.ok(w.milestones.slice(2).every(x=>/automatically/i.test(x.note)));

 // ---- 4. Archiving needs assembly recorded as complete ------------------------------------------------------------------------------
 assert.equal(w.lock.locked,false);assert.deepEqual(w.archive_issues,['A Partner has not recorded that assembly of the file is complete.']);
 await assert.rejects(()=>q('PARTNER',`update erp_private.audit_files set file_status='Archived',archived_by=$2,archived_at=now() where audit_file_id=$1`,[FILE,actors.PARTNER.staff_id]),/not recorded that assembly of the file is complete/);

 // ---- 5. Recording assembly complete -----------------------------------------------------------------------------------------------
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'Checked the file is complete']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'Checked the file is complete']),/Set the audit report date/);
 await q('PARTNER','select erp_private.audit_report_date_save($1,$2::date,$3)',[FILE,'2026-03-20','']);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'short']),/at least 10/);
 await tx`update erp_private.audit_files set file_status='Approved' where audit_file_id=${FILE}`;
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'Checked the file is complete']),/must be in completion/);
 await tx`update erp_private.audit_files set file_status='Completion' where audit_file_id=${FILE}`;
 await q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'Checked the file is complete and nothing is outstanding']);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[FILE,'Checked the file is complete again']),/already recorded/);
 w=await ws();assert.equal(w.lock.sealed,true);assert.equal(w.lock.locked,true);assert.equal(w.lock.locked_by,'Assembly complete');assert.equal(w.seal.sealed_by_name,'Fictional PARTNER');
 assert.equal(w.milestones.at(-1).kind,'Assembly complete');assert.equal(w.seal_check.same,true);assert.deepEqual(w.archive_issues,[]);

 // ---- 6. A locked file takes no change ---------------------------------------------------------------------------------------------------
 await assert.rejects(()=>risk('SUPERVISOR','Another risk raised after the file was sealed'),/closed to planning changes/,'the screen rule still applies first');
 await assert.rejects(()=>tx`insert into erp_private.audit_risks(audit_file_id,project_id,handling_firm_id,risk_seq,risk_ref,description,audit_area,assertion,risk_level,planned_response,created_by) values(${FILE},${P},${F},9,'R-009','Risk written straight to the table','Revenue','Occurrence','High','Test sales cut-off properly',${M})`,/locked after assembly/);
 await assert.rejects(()=>tx`update erp_private.audit_risks set planned_response='Edited after the file was sealed by someone' where risk_id=${r1}`,/locked after assembly/);
 await assert.rejects(()=>tx`delete from erp_private.audit_risks where risk_id=${r1}`,/./);
 await assert.rejects(()=>tx`update erp_private.audit_files set audit_report_date='2026-06-30' where audit_file_id=${FILE}`,/locked after assembly/);
 await assert.rejects(()=>tx`update erp_private.audit_files set reporting_framework='Full IFRS' where audit_file_id=${FILE}`,/locked after assembly/);
 await q('MANAGER','select erp_private.audit_milestone_take($1,$2,$3,$4)',[FILE,'Other','A note about the file','Taking a milestone is not a change to the file']);

 // ---- 7. Late changes -----------------------------------------------------------------------------------------------------------------------
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_amend_open($1,$2)',[FILE,'The auditor needs to add a missing risk after assembly']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE,'Too short']),/at least 20/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE2,'The file is not locked so this should be refused']),/not locked/);
 await q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE,'The auditor needs to add a missing risk after assembly']);
 w=await ws();assert.equal(w.lock.locked,false);assert.equal(w.lock.amendment_open,true);assert.equal(w.amendments.length,1);assert.equal(w.amendments[0].status,'Open');
 assert.equal(w.milestones.at(-1).kind,'Before late change');assert.equal(w.archive_issues.length,1);assert.match(w.archive_issues[0],/late change is still open/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE,'A second late change while the first is open']),/not locked/);
 await assert.rejects(()=>q('PARTNER',`update erp_private.audit_files set file_status='Archived',archived_by=$2,archived_at=now() where audit_file_id=$1`,[FILE,actors.PARTNER.staff_id]),/late change is still open/);
 await risk('SUPERVISOR','A risk added during the late change');
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_amend_close($1,$2)',[FILE,'Reviewed the added risk and agreed to the response']),/who opened the late change cannot/);
 await assert.rejects(()=>q('ASSISTANT','select erp_private.audit_amend_close($1,$2)',[FILE,'Reviewed the added risk and agreed to the response']),/Only a Manager or Partner/);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_amend_close($1,$2)',[FILE,'Too short']),/at least 20/);
 await q('MANAGER','select erp_private.audit_amend_close($1,$2)',[FILE,'Reviewed the added risk and agreed to the response']);
 w=await ws();const am=w.amendments[0];assert.equal(am.status,'Closed');assert.equal(am.closed_by_name,'Fictional MANAGER');assert.deepEqual(am.changes.map(x=>x.key),['risks']);assert.deepEqual(am.changes[0].added,['R-002']);
 assert.equal(w.lock.locked,true,'locked again');assert.equal(w.seal_check.same,false);assert.deepEqual(w.seal_check.changed,['Risks'],'the seal check shows the file differs from the sealed picture');
 await assert.rejects(()=>risk('SUPERVISOR','Added after the late change was closed'),/closed to planning changes/);
 await assert.rejects(()=>db.query(`update erp_private.audit_amendments set close_note='Rewritten afterwards by someone with access' where amendment_id=$1`,[am.amendment_id]),/closed late change cannot be changed/);
 await assert.rejects(()=>db.query(`delete from erp_private.audit_amendments where amendment_id=$1`,[am.amendment_id]),/./);
 await q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE,'A second late change to correct a wording error']);
 assert.equal((await ws()).amendments.length,2);
 await q('MANAGER2','select erp_private.audit_amend_close($1,$2)',[FILE,'Nothing was changed after all, so closing without edits']);
 assert.deepEqual((await ws()).amendments[1].changes,[]);

 // ---- 8. Archive after assembly ---------------------------------------------------------------------------------------------------------------
 await q('PARTNER',`update erp_private.audit_files set file_status='Archived',archived_by=$2,archived_at=now() where audit_file_id=$1`,[FILE,actors.PARTNER.staff_id]);
 w=await ws();assert.equal(w.milestones.at(-1).kind,'Archived');
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE,'Trying to reopen an archived file after the fact']),/archived/);

 // ---- 9. The deadline lock: off by default, and only once a Partner has confirmed every part ------------------------------------------
 await tx`update erp_private.audit_files set file_status='Completion',audit_report_date='2025-02-01' where audit_file_id=${FILE2}`;
 let l=(await ws('MANAGER',FILE2)).lock;assert.equal(l.enforced,false);assert.match(l.not_enforced_because,/switched off/);assert.equal(l.locked,false);
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_DEADLINE_LOCK_ENFORCED','true','A manager cannot']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_DEADLINE_LOCK_ENFORCED','maybe','Not a yes or no']),/yes or no/);
 // Switching it on is not enough: the days and what they run from must each be confirmed by a Partner.
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_DEADLINE_LOCK_ENFORCED','true','Lock files after the deadline']);
 l=(await ws('MANAGER',FILE2)).lock;assert.equal(l.enforced,false);assert.match(l.not_enforced_because,/number of lock days/);assert.equal(l.locked,false);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_FILE_LOCK_DAYS','1','Short for the test']);
 l=(await ws('MANAGER',FILE2)).lock;assert.equal(l.enforced,false);assert.match(l.not_enforced_because,/lock days run from/);assert.equal(l.locked,false);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_FILE_LOCK_ANCHOR','REPORT_DATE','Runs from the report date']);
 l=(await ws('MANAGER',FILE2)).lock;assert.equal(l.enforced,true);assert.equal(l.past_deadline,true);assert.equal(l.locked,true);assert.equal(l.locked_by,'Assembly deadline');assert.equal(l.deadline,'2025-02-02');
 await assert.rejects(()=>tx`insert into erp_private.audit_risks(audit_file_id,project_id,handling_firm_id,risk_seq,risk_ref,description,audit_area,assertion,risk_level,planned_response,created_by) values(${FILE2},${P2},${F},9,'R-009','Risk raised after the deadline passed','Revenue','Occurrence','High','Test sales cut-off properly',${M})`,/locked after assembly/);
 await q('PARTNER','select erp_private.audit_amend_open($1,$2)',[FILE2,'The deadline passed before the missing risk was found']);
 assert.equal((await ws('MANAGER',FILE2)).lock.locked,false);
 await q('MANAGER','select erp_private.audit_amend_close($1,$2)',[FILE2,'No change was made; the late change is closed again']);
 assert.equal((await ws('MANAGER',FILE2)).lock.locked,true,'past the deadline again');
 // A later report date moves the deadline; a Partner turning the setting off unlocks.
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_DEADLINE_LOCK_ENFORCED','false','Switched off again for the test']);
 assert.equal((await ws('MANAGER',FILE2)).lock.locked,false);
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_files where file_status='Archived'`)).rows[0].n,1);
});
