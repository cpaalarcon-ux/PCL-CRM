// Step 5 (joined-practice review): service profiles, references, file checklist and the billing letter check.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 5: service profiles, references, file checklist',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${M})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const A=await mk('UAT Fictional Services Ltd','A400000001Z');
 const proj=async(client,svc,status='Draft')=>{const p=id();await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${M})`;return p;};
 const list=async(role,p)=>j(await q(role,'select * from erp_private.project_file_checklist($1)',[p]));

 // ---- 1. Catalogue: 25 services, every one with a profile, references and a checklist --------------------------------------------------------
 const svc=await tx`select service_code,service_group from erp_private.services order by 1`;
 assert.equal(svc.length,25);
 assert.deepEqual(svc.filter(s=>['ADV-AUP','TAX-KRA'].includes(s.service_code)).map(s=>[s.service_code,s.service_group]),[['ADV-AUP','Advisory & Consulting'],['TAX-KRA','Tax Services']]);
 assert.equal((await tx`select count(*)::int n from erp_private.services where service_code like 'AUD-%'`)[0].n,6,'the new services do not use the AUD- prefix, which creates a statutory audit file');
 assert.equal((await tx`select count(*)::int n from erp_private.services s where not exists(select 1 from erp_private.service_profiles p where p.service_code=s.service_code)`)[0].n,0,'every service has a profile');
 assert.equal((await tx`select count(*)::int n from erp_private.services s where not exists(select 1 from erp_private.service_references r where r.service_code=s.service_code)`)[0].n,0,'every service has at least one reference');
 for(const s of svc)assert.ok((await tx`select count(*)::int n from erp_private.service_checklist_items where service_code=${s.service_code} and required`)[0].n>=5,`${s.service_code} has a checklist`);
 assert.equal((await tx`select count(*)::int n from erp_private.service_references where rule_status<>'Suggested'`)[0].n,0,'nothing is confirmed at the start');
 assert.equal((await tx`select count(*)::int n from erp_private.service_references where reference ~* 'ISRS 4000'`)[0].n,0,'no unverified standard number');
 assert.deepEqual((await tx`select engine,engine_state from erp_private.service_profiles where service_code in('ADV-FOR','ADV-AUP','TAX-KRA') order by service_code`).map(r=>r.engine+'/'+r.engine_state),['Procedures engine/Built','Restricted file/Planned','Procedures engine/Partly built']);

 // ---- 2. The checklist reads the project, not a promise -----------------------------------------------------------------------------------------
 const P=await proj(A,'ADV-PLAN');
 let items=await list('MANAGER',P);
 const byKey=k=>items.find(i=>i.item_key===k);
 assert.deepEqual(items.map(i=>i.item_key),['kyc','letter','fee','team','workpapers','deliverable']);
 assert.ok(items.every(i=>i.present===false),'a bare project has nothing');
 assert.deepEqual(await list('INTERN',P),[],'staff who cannot see the project see no checklist');
 assert.deepEqual(await list('ASSISTANT',P),[]);
 // KYC verified and current
 await tx`insert into erp_private.client_compliance(client_id,entity_type,risk_rating,conflict_checked,sanctions_date,sanctions_result,review_due,verified_by,verified_at,last_edited_by) values(${A},'Company','Low',true,current_date,'Clear',current_date+30,${actors.PARTNER.staff_id},now(),${actors.MANAGER.staff_id})`;
 items=await list('MANAGER',P);assert.equal(byKey('kyc').present,true);
 await tx`update erp_private.client_compliance set review_due=current_date-1 where client_id=${A}`;
 items=await list('MANAGER',P);assert.equal(byKey('kyc').present,false,'an out-of-date KYC review is not current');
 // fee
 await tx`insert into erp_private.project_budgets(project_id,agreed_fee,budgeted_hours,budgeted_cost,effective_from,reason,created_by) values(${P},50000,10,20000,current_date,'Fictional agreed fee',${actors.MANAGER.staff_id})`;
 items=await list('MANAGER',P);assert.equal(byKey('fee').present,true);
 // team
 await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${P},${actors.SUPERVISOR.staff_id},${F},'SUPERVISOR')`;
 items=await list('MANAGER',P);assert.equal(byKey('team').present,true);
 // documents: only the right category, not archived or deleted
 const doc=async(category,extra='')=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${A},${F},${P},${category},${category+'.pdf'},${'k/'+d},10,${'a'.repeat(64)},'application/pdf',${M})`;return d;};
 const wp=await doc('Working Papers');
 items=await list('MANAGER',P);assert.equal(byKey('workpapers').present,true);assert.equal(byKey('deliverable').present,false,'a different category does not count');
 await tx`update erp_private.documents set deleted_at=now() where document_id=${wp}`;
 items=await list('MANAGER',P);assert.equal(byKey('workpapers').present,false,'a deleted file does not count');

 // ---- 3. The letter: verified, current, and the billing lock ---------------------------------------------------------------------------------
 assert.equal((await q('MANAGER','select erp_private.project_letter_ok($1) ok',[P]))[0].ok,false);
 const letter=await doc('Signed Engagement Letters');
 await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,letter_expires_on,stage) values(${P},${letter},${actors.MANAGER.staff_id},current_date+10,'Accepted')`;
 assert.equal((await q('MANAGER','select erp_private.project_letter_ok($1) ok',[P]))[0].ok,true);
 items=await list('MANAGER',P);assert.equal(byKey('letter').present,true);
 await tx`update erp_private.engagement_controls set letter_expires_on=current_date-1 where project_id=${P}`;
 assert.equal((await q('MANAGER','select erp_private.project_letter_ok($1) ok',[P]))[0].ok,false,'an expired letter locks billing');
 await tx`update erp_private.engagement_controls set letter_expires_on=null,letter_verified_by=null where project_id=${P}`;
 assert.equal((await q('MANAGER','select erp_private.project_letter_ok($1) ok',[P]))[0].ok,false,'an unverified letter locks billing');

 // ---- 4. Gaps for the go-live checks: active projects only, Manager and Partner only ---------------------------------------------------------
 await db.exec('alter table erp_private.projects disable trigger user');
 const act=await proj(A,'ADV-FEAS','Active');
 await db.exec('alter table erp_private.projects enable trigger user');
 assert.deepEqual(j(await q('MANAGER','select * from erp_private.project_file_gaps()')).map(r=>r.project_id).sort(),[act].sort(),'draft projects are not counted');
 assert.deepEqual(await q('SUPERVISOR','select * from erp_private.project_file_gaps()'),[]);
 assert.ok(Number(j(await q('MANAGER','select * from erp_private.project_file_gaps()'))[0].missing)>=5);

 // ---- 5. References: Suggested until a Partner records the confirmation -------------------------------------------------------------------------
 const ref=(await tx`select reference_id from erp_private.service_references where service_code='TAX-KRA' limit 1`)[0].reference_id;
 const confirm=(role,status,note)=>q(role,`update erp_private.service_references set rule_status=$2,source_note=$3,confirmed_by=$4 where reference_id=$1`,[ref,status,note,actors[role].staff_id]);
 await assert.rejects(()=>confirm('MANAGER','Confirmed','Compliance Lead memo of 9 November 2026'),/Only a Partner can confirm/);
 await confirm('SUPERVISOR','Confirmed','Compliance Lead memo of 9 November 2026');// hidden by row security: nothing changes
 assert.equal((await tx`select rule_status from erp_private.service_references where reference_id=${ref}`)[0].rule_status,'Suggested');
 await assert.rejects(()=>confirm('PARTNER','Confirmed','short'),/violates check constraint/,'a source note of 10 characters is needed');
 await confirm('PARTNER','Confirmed','Compliance Lead memo of 9 November 2026');
 const done=(await tx`select rule_status,confirmed_by,confirmed_at,revision from erp_private.service_references where reference_id=${ref}`)[0];
 assert.equal(done.rule_status,'Confirmed');assert.equal(done.confirmed_by,actors.PARTNER.staff_id);assert.ok(done.confirmed_at);
 await assert.rejects(()=>q('PARTNER',`update erp_private.service_references set reference='Changed text here' where reference_id=$1`,[ref]),/cannot be edited/);
 await assert.rejects(()=>q('PARTNER',`update erp_private.service_references set confirmed_by=$2 where reference_id=$1`,[ref,actors.PARTNER2.staff_id]),/confirmation cannot be changed/,'confirmation cannot be pinned on someone else');
 await assert.rejects(()=>tx`delete from erp_private.service_references where reference_id=${ref}`,/delete|cannot/i);
 // adding
 const add=(role,text)=>q(role,`insert into erp_private.service_references(service_code,kind,reference,created_by) values('TAX-KRA','Guidance',$1,$2)`,[text,actors[role].staff_id]);
 await assert.rejects(()=>add('MANAGER','Manager trying to add a reference'),/Only a Partner|row-level security/);
 await add('PARTNER','KRA audit guidance note, to be named');
 await assert.rejects(()=>add('PARTNER','KRA audit guidance note, to be named'),/duplicate key|unique/i);
 await assert.rejects(()=>q('PARTNER',`insert into erp_private.service_references(service_code,kind,reference,rule_status,source_note,confirmed_by,confirmed_at,created_by) values('TAX-KRA','Law','Pre-confirmed text','Confirmed','Entered as confirmed at once',$1,now(),$1)`,[actors.PARTNER.staff_id]),/starts as Suggested/);
 // retiring
 await confirm('PARTNER','Retired','Replaced by the Tax Lead wording of 9 Nov');
 await assert.rejects(()=>confirm('PARTNER','Confirmed','Trying to bring back a retired one'),/stays retired/);
 assert.ok(Number((await tx`select count(*)::int n from erp_private.audit_events where table_name='service_references'`)[0].n)>=3,'changes are in the firm change log');
});
