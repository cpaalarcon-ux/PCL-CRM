// Document review state, expiring access grants and the evidence-scan stub (build 2740).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Document review, access grants and scan stub',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Review Client Ltd','A400000050Z'),PJ=await proj(Z,'TAX-KRA'),SUP=actors.SUPERVISOR.staff_id,AST=actors.ASSISTANT.staff_id;
 const sha=c=>c.repeat(64);
 const doc=async(by,cat='Tax Returns',h='a')=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${Z},${F},${PJ},${cat},${'file-'+d.slice(0,4)+'.pdf'},${'qa/'+d},10,${sha(h)},'application/pdf',${by})`;return d;};
 const D1=await doc(SUP);
 const review=(role,d,decision='APPROVED',comment='Agreed to the signed return and the working papers.')=>q(role,`insert into erp_private.document_reviews(document_id,reviewed_sha256,decision,comment,reviewer_id) values($1,$2,$3,$4,$5) returning review_id`,[d,sha('z'),decision,comment,actors[role].staff_id]);
 // ---- 1. Review state --------------------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(review('SUPERVISOR',D1),/uploaded a document cannot review/,'the uploader cannot review their own file');
 await assert.rejects(review('ASSISTANT',D1),/Only a Supervisor, Manager or Partner|row-level security/,'an Assistant does not review');
 await assert.rejects(review('INTERN',D1),/Only a Supervisor|row-level security/);
 await assert.rejects(review('MANAGER',D1,'APPROVED','ok'),/check|constraint/i,'a written comment of at least 10 characters');
 await assert.rejects(review('MANAGER',D1,'MAYBE'),/check|constraint/i);
 {const f=(await q('MANAGER',`insert into erp_private.document_reviews(document_id,reviewed_sha256,decision,comment,reviewer_id) values($1,$2,'CHANGES_REQUESTED','Forged name should be replaced.',$3) returning reviewer_id`,[D1,sha('a'),actors.MANAGER2.staff_id]))[0];assert.equal(f.reviewer_id,M,'a reviewer name supplied by the caller is replaced by the signed-in person');}
 const r1=(await review('MANAGER',D1))[0].review_id;
 let row=(await tx`select * from erp_private.document_reviews where review_id=${r1}`)[0];
 assert.deepEqual([row.reviewed_sha256===sha('a'),row.reviewer_id===M,row.decision],[true,true,'APPROVED'],'the hash is taken from the stored file, not from the caller');
 await assert.rejects(()=>tx`update erp_private.document_reviews set comment='changed after the fact' where review_id=${r1}`,/append-only/);
 await assert.rejects(()=>tx`delete from erp_private.document_reviews where review_id=${r1}`,/append-only/);
 await review('PARTNER',D1,'CHANGES_REQUESTED','Please attach the iTax acknowledgement page.');
 assert.equal((await q('SUPERVISOR',`select * from erp_private.document_reviews where document_id=$1`,[D1])).length,3,'history keeps every review');
 assert.equal((await q('INTERN',`select * from erp_private.document_reviews`)).length,0,'interns do not read review history');
 // ---- 2. Access grants ---------------------------------------------------------------------------------------------------------------------------------------
 assert.equal((await q('ASSISTANT',`select * from erp_private.documents where document_id=$1`,[D1])).length,0,'an Assistant cannot open a Tax Returns file');
 const soon=n=>new Date(Date.now()+n*86400000).toISOString();
 const grant=(role,d,to,days=7,reason='Needed to prepare the response to the KRA query.')=>q(role,`insert into erp_private.document_access_grants(document_id,grantee_id,granted_by,reason,expires_at) values($1,$2,$3,$4,$5) returning grant_id`,[d,to,actors[role].staff_id,reason,soon(days)]);
 await assert.rejects(grant('SUPERVISOR',D1,AST),/Only a Manager or Partner|row-level security/,'a Supervisor cannot grant');
 await assert.rejects(grant('MANAGER',D1,M),/yourself|check|constraint/i,'not to yourself');
 await assert.rejects(grant('MANAGER',D1,actors.INTERN.staff_id),/Manager, Supervisor or Assistant/,'not to an Intern');
 await assert.rejects(grant('MANAGER',D1,AST,31),/within 30 days/,'at most 30 days');
 await assert.rejects(grant('MANAGER',D1,AST,-1),/within 30 days/,'not in the past');
 await assert.rejects(grant('MANAGER',D1,AST,7,'short'),/check|constraint/i,'a written reason');
 const g1=(await grant('MANAGER',D1,AST))[0].grant_id;
 assert.equal((await q('ASSISTANT',`select * from erp_private.documents where document_id=$1`,[D1])).length,1,'the grantee can now open that one document');
 const D2=await doc(SUP,'Tax Returns','b');
 assert.equal((await q('ASSISTANT',`select * from erp_private.documents where document_id=$1`,[D2])).length,0,'but not any other document');
 await assert.rejects(grant('MANAGER2',D1,AST),/duplicate|unique/i,'one live grant per person and document');
 assert.equal((await q('ASSISTANT',`select * from erp_private.document_access_grants`)).length,1,'the grantee sees their own grant');
 assert.ok((await tx`select 1 from erp_private.notifications where event_key like ${'document-grant:'+g1+'%'}`).length>0,'Partners are alerted');
 await assert.rejects(()=>tx`delete from erp_private.document_access_grants where grant_id=${g1}`,/archived, not deleted|Historical/);
 await assert.rejects(q('MANAGER',`update erp_private.document_access_grants set expires_at=$2 where grant_id=$1`,[g1,soon(20)]),/cannot be edited/,'a grant is not extended in place');
 await q('ASSISTANT',`update erp_private.document_access_grants set revoked_at=now() where grant_id=$1`,[g1]);assert.equal((await tx`select revoked_at from erp_private.document_access_grants where grant_id=${g1}`)[0].revoked_at,null,'the grantee cannot withdraw or change a grant');
 await assert.rejects(q('MANAGER',`update erp_private.document_access_grants set revoked_at=now(),revoked_by=$2,revoke_reason='x' where grant_id=$1`,[g1,M]),/check|constraint/i,'withdrawing needs a reason');
 await q('MANAGER',`update erp_private.document_access_grants set revoked_at=now(),revoked_by=$2,revoke_reason='Query closed, access no longer needed.' where grant_id=$1`,[g1,M]);
 assert.equal((await q('ASSISTANT',`select * from erp_private.documents where document_id=$1`,[D1])).length,0,'a withdrawn grant stops working at once');
 await assert.rejects(q('MANAGER',`update erp_private.document_access_grants set revoke_reason='Another reason entered later.' where grant_id=$1`,[g1]),/already withdrawn/);
 // expiry: a grant whose end has passed is dead (simulate by moving time back on a fresh grant)
 const g2=(await grant('PARTNER',D1,AST,1))[0].grant_id;
 assert.equal((await q('ASSISTANT',`select 1 from erp_private.documents where document_id=$1`,[D1])).length,1);
 await db.exec('alter table erp_private.document_access_grants disable trigger user');
 await tx`update erp_private.document_access_grants set expires_at=now()-interval '1 minute',granted_at=now()-interval '2 days' where grant_id=${g2}`;
 await db.exec('alter table erp_private.document_access_grants enable trigger user');
 assert.equal((await q('ASSISTANT',`select 1 from erp_private.documents where document_id=$1`,[D1])).length,0,'an expired grant stops working');
 // a grant never opens a Restricted file to someone who may not see it
 const D3=await doc(SUP,'Tax Returns','c');await db.exec('alter table erp_private.documents disable trigger user');await tx`update erp_private.documents set confidentiality='Restricted' where document_id=${D3}`;await db.exec('alter table erp_private.documents enable trigger user');
 await grant('MANAGER',D3,AST);
 assert.equal((await q('ASSISTANT',`select 1 from erp_private.documents where document_id=$1`,[D3])).length,0,'a grant does not open a Restricted file');
 // grantee must work for the firm that holds the document
 const F2=id();await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F2},'OTH','Fictional other firm')`;
 const ST=id(),STU=id();await tx`insert into auth.users(id) values(${STU})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status) values(${ST},${STU},'X1','x.nofirm','Fictional No-Firm Assistant','ASSISTANT','Permanent','2027-12-31','Active')`;
 await assert.rejects(grant('MANAGER',D1,ST),/firm that holds this document/,'the grantee needs firm access first');
 // ---- 3. The scan stub -------------------------------------------------------------------------------------------------------------------------------------
 const scan=(role,d)=>q(role,`insert into erp_private.document_scan_results(document_id,sha256,status,provider,requested_by) values($1,$2,'PENDING_MANUAL_REVIEW',null,$3) returning *`,[d,sha('q'),actors[role].staff_id]);
 const s=(await scan('SUPERVISOR',D1))[0];
 assert.deepEqual([s.status,s.provider,s.sha256===sha('a')],['PENDING_MANUAL_REVIEW',null,true],'the stub always answers pending manual review, with the file\'s real hash');
 await assert.rejects(q('SUPERVISOR',`insert into erp_private.document_scan_results(document_id,sha256,status,requested_by) values($1,$2,'CLEAN',$3)`,[D1,sha('a'),SUP]),/No scan provider is connected/,'no clean result can be written until a provider is connected');
 await assert.rejects(scan('INTERN',D1),/Your role cannot|row-level security/);
 await assert.rejects(()=>tx`update erp_private.document_scan_results set status='PENDING_MANUAL_REVIEW' where scan_id=${s.scan_id}`,/append-only/);
 // ---- 4. Hardening ---------------------------------------------------------------------------------------------------------------------------------------------------
 for(const fn of ['document_granted(uuid)','document_review_guard()','document_grant_guard()','document_scan_guard()','document_grant_alert()']){
  const r=(await tx`select p.prosecdef,p.proconfig::text cfg,has_function_privilege('anon',p.oid,'execute') anon from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname=${fn.split('(')[0]}`)[0];
  assert.deepEqual([r.prosecdef,/search_path=/.test(r.cfg),r.anon],[true,true,false],fn);
 }
});
