// Frozen source totals and numbered computation snapshots (build 2730): immutable snapshots at submission and lock; a changed source stops the lock.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {sourceTotals,rulesStatus,rowFingerprint,appliedRateSummary} from '../supabase/functions/staff-workspace-v12/snapshot-rules.mjs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Computation snapshots: numbered, immutable, required to submit and lock, source fingerprint, unconfirmed rules cannot be filed',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Snapshot Client Ltd','A400000050Z'),PJ=await proj(Z,'TAX-KRA'),AST=actors.ASSISTANT.staff_id;
 const H1='a'.repeat(64),H2='b'.repeat(64);
 const snap=(c,stage,hash=H1,rules='CONFIRMED',n=3)=>db.query(`insert into erp_private.tax_computation_snapshots(case_id,project_id,stage,taken_by,inputs,result,rules_status,source_row_count,source_hash,source_totals) values($1,$2,$3,$4,'{"x":1}','{"vat":10}',$5,$6,$7,'[{"dataset":"Sales","rows":3,"net":100,"vat":16,"gross":116}]')`,[c,PJ,stage,M,rules,n,hash]);
 const mkCase=async(kind,s,e,status='Draft')=>{const c=id();await db.query(`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[c,PJ,kind,s,e,AST,status==='Draft'?null:M,status==='Draft'?null:'{}',status]);return c;};
 const nos=async c=>(await tx`select snapshot_no,stage from erp_private.tax_computation_snapshots where case_id=${c} order by snapshot_no`).map(r=>r.snapshot_no+r.stage[0]);
 const lock=c=>tx`update erp_private.tax_cases set status='Locked',reviewed_by=${M},review_snapshot='{"a":1}',review_note='Reviewed and agreed to the sources' where case_id=${c}`;
 const ret=c=>tx`update erp_private.tax_cases set status='Returned',reviewed_by=${M},review_note='Please correct the sales source and resubmit' where case_id=${c}`;
 // ---- 1. A return is submitted only with the snapshot taken in the same step --------------------------------------------------------------------------------
 const C=await mkCase('VAT','2026-09-01','2026-09-30');
 await assert.rejects(()=>tx`update erp_private.tax_cases set status='Submitted' where case_id=${C}`,/Record the computation snapshot/,'no snapshot, no submission');
 await assert.rejects(snap(C,'LOCKED'),/submitted return|Submit the return/,'a lock snapshot cannot be the first');
 await snap(C,'SUBMITTED');assert.deepEqual(await nos(C),['1S']);
 const s1=(await tx`select * from erp_private.tax_computation_snapshots where case_id=${C}`)[0];
 assert.deepEqual([s1.client_id===Z,s1.taken_by===M,s1.rules_status,s1.source_row_count,s1.result.vat],[true,true,'CONFIRMED',3,10]);
 await tx`update erp_private.tax_cases set status='Submitted' where case_id=${C}`;
 await assert.rejects(snap(C,'SUBMITTED'),/draft or returned/,'a second submission snapshot only after the case is returned');
 // ---- 2. The lock must see the same sources as the submission -----------------------------------------------------------------------------------------------
 await assert.rejects(snap(C,'LOCKED',H2),/source rows changed/,'a changed source stops the lock');
 await assert.rejects(()=>lock(C),/Record the computation snapshot/,'and so does having no lock snapshot');
 await snap(C,'LOCKED',H1);assert.deepEqual(await nos(C),['1S','2L'],'numbers run in order across stages');
 await lock(C);assert.equal((await tx`select status from erp_private.tax_cases where case_id=${C}`)[0].status,'Locked');
 // ---- 3. A returned case is resubmitted with a fresh snapshot --------------------------------------------------------------------------------------------------
 const R=await mkCase('PAYE','2026-09-01','2026-09-30');
 await snap(R,'SUBMITTED');await tx`update erp_private.tax_cases set status='Submitted' where case_id=${R}`;
 await ret(R);await assert.rejects(()=>tx`update erp_private.tax_cases set status='Submitted' where case_id=${R}`,/Record the computation snapshot/,'the earlier snapshot does not cover a resubmission');
 await snap(R,'SUBMITTED',H2);await tx`update erp_private.tax_cases set status='Submitted' where case_id=${R}`;
 assert.deepEqual(await nos(R),['1S','2S']);
 await assert.rejects(snap(R,'LOCKED',H1),/source rows changed/,'the lock is compared with the latest submission, not the first');
 await snap(R,'LOCKED',H2);await lock(R);assert.deepEqual(await nos(R),['1S','2S','3L']);
 // ---- 4. Snapshots are immutable -------------------------------------------------------------------------------------------------------------------------------------
 await assert.rejects(()=>tx`update erp_private.tax_computation_snapshots set result='{"vat":0}' where case_id=${R}`,/archived, not deleted/);
 await assert.rejects(()=>tx`delete from erp_private.tax_computation_snapshots where case_id=${R}`,/archived, not deleted/);
 await assert.rejects(q('MANAGER',`insert into erp_private.tax_computation_snapshots(case_id,project_id,stage,taken_by,inputs,result,rules_status,source_row_count,source_hash) values($1,$2,'SUBMITTED',$3,'{}','{}','CONFIRMED',0,$4)`,[C,PJ,M2,H1]),/row-level security|submitted return|draft or returned/i,'a snapshot is taken in the name of the signed-in person');
 const D0=await mkCase('NSSF','2026-09-01','2026-09-30');
 await assert.rejects(snap(D0,'SUBMITTED','not-a-hash'),/check|constraint/i,'the fingerprint is a SHA-256');
 // ---- 5. Rates and rules not confirmed by the Tax Lead cannot be recorded as filed ------------------------------------------------------------------------------
 const doc=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${doc},${Z},${F},${PJ},'Tax Returns','ack.pdf',${'qa/'+doc},10,${'a'.repeat(64)},'application/pdf',${AST})`;
 const file=(c)=>q('MANAGER2',`insert into erp_private.tax_filings(case_id,project_id,filed_on,itax_reference,prn,acknowledgement_status,acknowledgement_document_id,recorded_by) values($1,$2,'2026-10-05','KRA2610050001','PRN1','ACKNOWLEDGEMENT_RECEIVED',$3,$4)`,[c,PJ,doc,M2]);
 const U=await mkCase('TOT','2026-09-01','2026-09-30');
 await snap(U,'SUBMITTED',H1,'UNCONFIRMED');await tx`update erp_private.tax_cases set status='Submitted' where case_id=${U}`;
 await snap(U,'LOCKED',H1,'UNCONFIRMED');await lock(U);
 await assert.rejects(file(U),/not confirmed by the Tax Lead/,'unconfirmed rules: the filing record is refused');
 const T=await mkCase('MRI','2026-09-01','2026-09-30');
 await snap(T,'SUBMITTED',H1,'TESTING');await tx`update erp_private.tax_cases set status='Submitted' where case_id=${T}`;await snap(T,'LOCKED',H1,'TESTING');await lock(T);
 await file(T);assert.equal((await tx`select count(*)::int n from erp_private.tax_filings where case_id=${T}`)[0].n,1,'a test (simulation) return is governed by its own simulated-filing confirmation in the task workspace');
 await file(C);assert.equal((await tx`select count(*)::int n from erp_private.tax_filings where case_id=${C}`)[0].n,1,'confirmed rules: the filing record is accepted');
 // ---- 6. Access ------------------------------------------------------------------------------------------------------------------------------------------------------------
 assert.equal((await q('INTERN',`select * from erp_private.tax_computation_snapshots`)).length,0,'interns see no snapshots');
 assert.ok((await q('MANAGER',`select * from erp_private.tax_computation_snapshots where project_id=$1`,[PJ])).length>=7);
 for(const role of ['anon','authenticated']){await db.exec('begin');await db.exec(`set local role ${role}`);await assert.rejects(()=>db.query('select 1 from erp_private.tax_computation_snapshots'),/permission denied/);await db.exec('rollback');}
 for(const fn of ['tax_snapshot_guard()','tax_snapshot_case_gate()']){const g=await tx`select has_function_privilege('anon',${'erp_private.'+fn},'execute') a,has_function_privilege('authenticated',${'erp_private.'+fn},'execute') b`;assert.deepEqual([g[0].a,g[0].b],[false,false],fn);}
 // ---- 7. The pure helpers ---------------------------------------------------------------------------------------------------------------------------------------------------
 const rows=[{row_id:'b',dataset:'Sales',normalized:{amount:'100.50',vat:'16.08'}},{row_id:'a',dataset:'Sales',normalized:{net:200,vat:32,gross:232}},{row_id:'c',dataset:'Purchases',normalized:{amount:50}},{row_id:'d',dataset:'Purchases',normalized:{vat:''}}];
 assert.deepEqual(sourceTotals(rows),[{dataset:'Purchases',rows:2,net:50,vat:0,gross:0},{dataset:'Sales',rows:2,net:300.5,vat:48.08,gross:232}],'totals by dataset; a blank figure is skipped, not counted as a value');
 assert.deepEqual(sourceTotals([]),[]);
 assert.deepEqual(rowFingerprint(rows).map(r=>r.id),['a','b','c','d'],'a fixed order, whatever order the rows arrive in');
 assert.deepEqual(rowFingerprint([{row_id:'a',normalized:{x:1},decision:'Eligible'}]),rowFingerprint([{decision:'Eligible',normalized:{x:1},row_id:'a'}]));
 assert.notDeepEqual(rowFingerprint([{row_id:'a',normalized:{x:1},decision:'Eligible'}]),rowFingerprint([{row_id:'a',normalized:{x:1},decision:'Excluded'}]),'a changed decision changes the fingerprint');
 assert.equal(rulesStatus([],{}),'CONFIRMED');
 assert.equal(rulesStatus([{status:'Approved',legal_review_status:'Confirmed'}],{}),'CONFIRMED');
 assert.equal(rulesStatus([{status:'Approved',legal_review_status:null}],{}),'CONFIRMED');
 assert.equal(rulesStatus([{status:'Testing',legal_review_status:'Pending'}],{}),'UNCONFIRMED');
 assert.equal(rulesStatus([{status:'Approved',legal_review_status:'Pending'}],{}),'UNCONFIRMED');
 assert.equal(rulesStatus([{status:'Approved'},{status:'Draft'}],{}),'UNCONFIRMED','one unconfirmed rate is enough');
 assert.equal(rulesStatus([{status:'Approved',approval_scope:'Testing'}],{}),'TESTING');assert.equal(rulesStatus([{status:'Approved'}],{testing_only:true}),'TESTING');
 assert.deepEqual(appliedRateSummary([{rate_id:'r',rate_key:'KE_VAT',tax_type:'VAT',status:'Approved',parameters:{rate:0.16},extra:1}]),[{rate_id:'r',rate_key:'KE_VAT',tax_type:'VAT',status:'Approved',legal_review_status:null,effective_from:undefined,effective_to:undefined,approval_scope:null}],'only the identity and approval of each rate are kept, never its figures');
 // ---- 8. Server and screen ---------------------------------------------------------------------------------------------------------------------------------------------------
 const read=f=>fs.readFileSync(path.join(root,f),'utf8'),srv=read('supabase/functions/staff-workspace-v12/tax-review-actions.ts');
 assert.match(srv,/takeSnapshot\(tx,a,c,s,'SUBMITTED'\)/);assert.match(srv,/status==='Locked'\)await takeSnapshot\(tx,a,c,s,'LOCKED'\)/);
 assert.ok(srv.indexOf("takeSnapshot(tx,a,c,s,'SUBMITTED')")<srv.indexOf("set status='Submitted'"),'the snapshot is taken before the status changes');
 assert.match(srv,/snapshots:await tx`select snapshot_id,snapshot_no/);
 for(const f of ['supabase/migrations/20261110274000_computation_snapshots.sql','supabase/functions/staff-workspace-v12/snapshot-rules.mjs'])assert.ok(!/ISRS\s*4000/i.test(read(f)));
});
