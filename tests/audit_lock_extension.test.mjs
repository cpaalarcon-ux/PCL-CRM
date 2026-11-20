// Audit build S8.1: a Partner can extend the assembly deadline, with a reason; every extension is kept and cannot be changed.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('S8.1: assembly deadline extension, log, lock, setting',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 await db.exec('alter table erp_private.projects disable trigger projects_guard;alter table erp_private.projects disable trigger entity_activation');
 const M=actors.MANAGER.staff_id;
 await tx`insert into erp_private.clients(client_id,company_name,owner_staff_id) values(${C},'UAT Fictional Extension Ltd',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${C},${F})`;
 const mk=async(name,fileType)=>{const p=id(),f=id();
  await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) values(${p},${C},${F},${name},'AUD-STAT',${M})`;
  for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT'])await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${actors[role].staff_id},${F},${actors[role].category_code})`;
  await tx`insert into erp_private.audit_files(audit_file_id,project_id,client_id,handling_firm_id,starts_on,ends_on,file_type,reporting_framework,created_by) values(${f},${p},${C},${F},'2025-01-01','2025-12-31',${fileType},'IFRS for SMEs',${M})`;return {p,f};};
 const A=await mk('Fictional audit A','First-year'),B=await mk('Fictional audit B','Subsequent-year'),S=await mk('Fictional audit S','Subsequent-year');
 for(const r of await tx`select tgname from pg_trigger where tgrelid='erp_private.audit_files'::regclass and not tgisinternal and tgname not in('milestone_auto','archive_gate','a_assembly_lock') and tgname ~ 'gate|guard|check|sasra|eqcr|invoice|billing'`)await db.exec(`alter table erp_private.audit_files disable trigger ${r.tgname}`);
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const ws=async(role,f)=>j((await q(role,'select erp_private.audit_assembly_workspace($1) w',[f]))[0].w);
 const ext=(role,f,days,reason)=>q(role,'select erp_private.audit_lock_extend($1,$2,$3) r',[f,days,reason]);
 const setReport=(f,offset)=>db.query(`update erp_private.audit_files set audit_report_date=(now() at time zone 'Africa/Nairobi')::date+$2::int where audit_file_id=$1`,[f,offset]);
 const addDays=async(offset)=>(await db.query(`select ((now() at time zone 'Africa/Nairobi')::date+$1::int)::text d`,[offset])).rows[0].d;
 const REASON='Client accounts arrived late, so the file cannot be assembled in time';

 // ---- 1. Defaults: 60 days from the audit report date, extension allowed but not yet confirmed -------------------------------------------
 let w=await ws('MANAGER',A.f);
 assert.equal(w.lock.days,60);assert.equal(w.lock.anchor,'REPORT_DATE');assert.equal(w.lock.extra_days,0);assert.equal(w.lock.extension_allowed,true);
 const pol=w.policy.find(x=>x.key==='AUDIT_LOCK_EXTENSION_ALLOWED');assert.equal(pol.value,'true');assert.equal(pol.confirmed,false,'a Partner has not confirmed it');
 assert.equal(w.lock.deadline,null,'no report date, so no deadline');assert.deepEqual(w.extensions,[]);

 // ---- 2. Who may extend, and the checks ----------------------------------------------------------------------------------------------
 await assert.rejects(()=>ext('MANAGER',A.f,14,REASON),/Only a Partner extends/);
 await assert.rejects(()=>ext('SUPERVISOR',A.f,14,REASON),/Only a Partner extends/);
 await assert.rejects(()=>ext('PARTNER',A.f,14,REASON),/not known yet/);
 await setReport(A.f,-10);
 const base=await addDays(50);                 // report date 10 days ago + 60 days
 w=await ws('MANAGER',A.f);assert.equal(w.lock.deadline,base);assert.equal(w.lock.base_deadline,base);
 for(const bad of [0,-5,366,null])await assert.rejects(()=>ext('PARTNER',A.f,bad,REASON),/from 1 to 365/);
 await assert.rejects(()=>ext('PARTNER',A.f,14,'Too short'),/at least 20 characters/);
 await assert.rejects(()=>ext('PARTNER',A.f,14,'                         '),/at least 20 characters/);
 assert.equal((await ws('MANAGER',A.f)).extensions.length,0,'nothing was saved by the refused attempts');

 // ---- 3. Extensions add up, and each one is kept with the old and new deadline -----------------------------------------------------------
 const r1=(await ext('PARTNER',A.f,14,REASON))[0].r;assert.equal(r1.old_deadline,base);assert.equal(r1.new_deadline,await addDays(64));
 const r2=(await ext('PARTNER2',A.f,30,'A second extension: the group audit instructions are still outstanding'))[0].r;assert.equal(r2.old_deadline,await addDays(64));assert.equal(r2.new_deadline,await addDays(94));
 w=await ws('MANAGER',A.f);
 assert.equal(w.lock.deadline,await addDays(94));assert.equal(w.lock.base_deadline,base,'the 60 days itself is not changed');assert.equal(w.lock.extra_days,44);assert.equal(w.lock.extensions,2);assert.equal(w.lock.days,60);
 assert.deepEqual(w.extensions.map(x=>[x.seq,x.extra_days,x.old_deadline,x.new_deadline,x.extended_by_name]),[[1,14,base,await addDays(64),'Fictional PARTNER'],[2,30,await addDays(64),await addDays(94),'Fictional PARTNER2']]);
 assert.equal(w.extensions[0].reason,REASON);
 assert.equal((await db.query(`select to_char(audit_report_date,'YYYY-MM-DD') d from erp_private.audit_files where audit_file_id=$1`,[A.f])).rows[0].d,await addDays(-10),'the audit report date itself did not move');
 assert.equal((await db.query(`select count(*)::int n from erp_private.audit_events where table_name='audit_lock_extensions' and record_key=$1::text`,[w.extensions[0].extension_id])).rows[0].n,1,'the change is also in the firm change log');

 // ---- 4. The log cannot be changed or removed; interns cannot read it -------------------------------------------------------------------------
 await assert.rejects(()=>db.query(`update erp_private.audit_lock_extensions set reason='Rewritten afterwards by someone with access' where extension_id=$1`,[w.extensions[0].extension_id]),/cannot be changed/);
 await assert.rejects(()=>db.query(`update erp_private.audit_lock_extensions set new_deadline=new_deadline+1,extra_days=extra_days+1 where extension_id=$1`,[w.extensions[0].extension_id]),/cannot be changed/);
 await assert.rejects(()=>db.query(`delete from erp_private.audit_lock_extensions where extension_id=$1`,[w.extensions[0].extension_id]),/./);
 assert.equal((await q('INTERN','select erp_private.audit_assembly_workspace($1) w',[A.f]))[0].w,null);
 assert.equal((await q('INTERN','select count(*)::int n from erp_private.audit_lock_extensions',[]))[0].n,0);
 assert.ok((await q('MANAGER','select count(*)::int n from erp_private.audit_lock_extensions',[]))[0].n>=2);
 await assert.rejects(()=>q('PARTNER','insert into erp_private.audit_lock_extensions(audit_file_id,project_id,handling_firm_id,seq,extra_days,old_deadline,new_deadline,reason,extended_by) values($1,$2,$3,9,5,current_date,current_date+5,$4,$5)',[A.f,A.p,F,REASON,actors.PARTNER.staff_id]),/permission denied|row-level security/,'writes go only through the function');

 // ---- 5. The deadline lock uses the extended deadline --------------------------------------------------------------------------------------
 await setReport(B.f,-100);                       // base deadline = 40 days ago
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_DEADLINE_LOCK_ENFORCED','true','Lock files after the deadline']);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_FILE_LOCK_DAYS','60','Sixty days from the report date']);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_FILE_LOCK_ANCHOR','REPORT_DATE','Runs from the report date']);
 w=await ws('MANAGER',B.f);assert.equal(w.lock.enforced,true);assert.equal(w.lock.past_deadline,true);assert.equal(w.lock.locked,true);assert.equal(w.lock.locked_by,'Assembly deadline');
 const riskSql=(file,proj)=>tx`insert into erp_private.audit_risks(audit_file_id,project_id,handling_firm_id,risk_seq,risk_ref,description,audit_area,assertion,risk_level,planned_response,created_by) values(${file},${proj},${F},1,'R-001','Risk raised after the deadline','Revenue','Occurrence','High','Test sales cut-off properly',${M})`;
 await assert.rejects(()=>riskSql(B.f,B.p),/locked after assembly/);
 await assert.rejects(()=>ext('PARTNER',B.f,14,REASON),/would already have passed/,'14 days from 40 days ago is still in the past');
 assert.equal((await ws('MANAGER',B.f)).extensions.length,0);
 const r3=(await ext('PARTNER',B.f,60,REASON))[0].r;assert.equal(r3.new_deadline,await addDays(20));
 w=await ws('MANAGER',B.f);assert.equal(w.lock.locked,false,'an extension past today unlocks the file');assert.equal(w.lock.past_deadline,false);assert.equal(w.lock.deadline,await addDays(20));
 await riskSql(B.f,B.p);
 assert.equal((await ws('MANAGER',B.f)).lock.locked,false);
 // Extending does not make the file complete, seal it or open a late change.
 assert.equal(w.lock.sealed,false);assert.equal(w.lock.amendment_open,false);assert.equal(w.milestones.length,0,'no milestone is taken by an extension');

 // ---- 6. A sealed or archived file cannot be extended; a late change is the way ---------------------------------------------------------------
 await db.query(`update erp_private.audit_files set file_status='Completion' where audit_file_id=$1`,[S.f]);await setReport(S.f,-5);
 await ext('PARTNER',S.f,7,REASON);
 await q('PARTNER','select erp_private.audit_assembly_seal($1,$2)',[S.f,'Checked every record is on the file']);
 await assert.rejects(()=>ext('PARTNER',S.f,7,REASON),/already recorded as complete/);
 await q('PARTNER',`update erp_private.audit_files set file_status='Archived',archived_by=$2,archived_at=now() where audit_file_id=$1`,[S.f,actors.PARTNER.staff_id]);
 await assert.rejects(()=>ext('PARTNER',S.f,7,REASON),/archived/);
 assert.equal((await ws('MANAGER',S.f)).extensions.length,1,'the earlier extension stays in the log');

 // ---- 7. Whether a Partner may extend is a firm setting, set by a Partner with a reason --------------------------------------------------------
 await assert.rejects(()=>q('MANAGER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_LOCK_EXTENSION_ALLOWED','false','A manager cannot']),/Only a Partner/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_LOCK_EXTENSION_ALLOWED','maybe','Not a yes or no']),/yes or no/);
 await assert.rejects(()=>q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_LOCK_EXTENSION_ALLOWED','false','short']),/at least 10/);
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_LOCK_EXTENSION_ALLOWED','false','The firm does not allow extensions']);
 w=await ws('MANAGER',A.f);assert.equal(w.lock.extension_allowed,false);assert.equal(w.policy.find(x=>x.key==='AUDIT_LOCK_EXTENSION_ALLOWED').confirmed,true);
 await assert.rejects(()=>ext('PARTNER',A.f,14,REASON),/switched off/);
 assert.equal(w.lock.deadline,await addDays(94),'extensions already made still count when new ones are switched off');
 await q('PARTNER','select erp_private.audit_policy_save($1,$2,$3)',['AUDIT_LOCK_EXTENSION_ALLOWED','true','Extensions allowed again']);
 await ext('PARTNER',A.f,5,'Allowed again, so a further extension is recorded');
 assert.equal((await ws('MANAGER',A.f)).lock.extra_days,49);

 // ---- 8. Nothing here touches a statutory date or any table other than the extension log ---------------------------------------------------------
 const sql=fs.readFileSync(root+'/supabase/migrations/20261109257000_audit_lock_extension.sql','utf8');
 const fn=sql.slice(sql.indexOf('CREATE FUNCTION erp_private.audit_lock_extend'));
 assert.doesNotMatch(fn,/UPDATE\s+erp_private\.(audit_files|projects|tax|vat|paye|filing)/i);
 assert.match(fn,/INSERT INTO erp_private\.audit_lock_extensions/);
});
