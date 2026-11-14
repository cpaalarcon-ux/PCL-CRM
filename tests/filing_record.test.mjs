// Filing record and acknowledgment gate (build 2720): a case becomes Filed only with an iTax acknowledgment (PDF evidence) or an exception approved by a different Manager or Partner.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v),(k,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT00:00:00\.000Z$/.test(x)?x.slice(0,10):x);
test('Filing record: acknowledgment or approved exception is required before a tax case can be Filed',async t=>{
 t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid references auth.users);create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;`);
 for(const f of fs.readdirSync(root+'/supabase/migrations').sort()){const q=fs.readFileSync(root+'/supabase/migrations/'+f,'utf8').replace('CREATE EXTENSION IF NOT EXISTS pg_cron;','').replace(/SELECT cron.schedule[^\n]+/g,'');await db.exec(q);}
 await tx`insert into erp_private.firms(firm_id,firm_code,legal_name) values(${F},'AUDB','Fictional audit assembly firm')`;
 for(const role of ['PARTNER','PARTNER2','MANAGER','MANAGER2','SUPERVISOR','ASSISTANT','INTERN']){const a=actors[role]={staff_id:id(),auth_user_id:id(),session:id(),category_code:role.replace(/\d/,'')};await tx`insert into auth.users(id) values(${a.auth_user_id})`;await tx`insert into auth.sessions(id,user_id) values(${a.session},${a.auth_user_id})`;await tx`insert into erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,contract_end_date,access_status,sessions_invalid_before) values(${a.staff_id},${a.auth_user_id},${role},${role.toLowerCase()},${'Fictional '+role},${a.category_code},'Permanent','2027-12-31','Active',now()-interval '1 day')`;await tx`insert into erp_private.pilot_sessions(session_id,staff_id,expires_at) values(${a.session},${a.staff_id},now()+interval '1 hour')`;await tx`insert into erp_private.staff_firm_access(staff_id,firm_id,scope) values(${a.staff_id},${F},'Assigned')`;}
 const M=actors.MANAGER.staff_id,M2=actors.MANAGER2.staff_id,PT=actors.PARTNER.staff_id,AST=actors.ASSISTANT.staff_id;
 const q=(role,sqlText,v=[])=>as(role,()=>db.query(sqlText,v).then(r=>r.rows));
 const mk=async(name,pin,owner=M)=>{const c=id();await tx`insert into erp_private.clients(client_id,company_name,kra_pin,primary_sector,branch_location,client_category,legal_structure,legal_subtype,legal_entity_type,owner_staff_id) values(${c},${name},${pin},'Energy','Nairobi','Corporate','Limited Company','Private Limited Company','Limited company',${owner})`;await tx`insert into erp_private.client_firm_links(client_id,firm_id) values(${c},${F})`;return c;};
 const proj=async(client,svc,status='Active',owner=M,master=false)=>{const p=id();await db.exec('alter table erp_private.projects disable trigger user');await tx`insert into erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,status,owner_staff_id,tax_master) values(${p},${client},${F},${'UAT '+svc},${svc},${status},${owner},${master})`;await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const Z=await mk('UAT Fictional Filing Client Ltd','A400000020Z'),PJ=await proj(Z,'TAX-KRA');
 const T0=(await tx`select (now() at time zone 'Africa/Nairobi')::date::text d`)[0].d;
 const D=n=>{const x=new Date(T0+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
 const pdf=async(name='ack.pdf',mime='application/pdf',project=PJ)=>{const d=id(),cl=(await tx`select client_id from erp_private.projects where project_id=${project}`)[0].client_id;await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${cl},${F},${project},'Tax Returns',${name},${'qa/'+d},10,${'a'.repeat(64)},${mime},${AST})`;return d;};
 const mkCase=async(kind,s,e,status='Locked')=>{const c=id();await tx`insert into erp_private.tax_cases(case_id,project_id,kind,starts_on,ends_on,prepared_by,reviewed_by,review_snapshot,status) values(${c},${PJ},${kind},${s},${e},${AST},${M},'{}',${status})`;return c;};
 const file=(role,c,v={})=>q(role,`insert into erp_private.tax_filings(case_id,project_id,filed_on,itax_reference,prn,no_prn_reason,acknowledgement_status,acknowledgement_document_id,exception_reason,exception_approved_by,recorded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[c,PJ,v.filed_on||'2026-10-05',v.itax??null,v.prn??'PRN123456',v.noPrn??null,v.status||'ACKNOWLEDGEMENT_RECEIVED',v.doc??null,v.reason??null,v.approver??null,actors[role].staff_id]);
 const CT=id();await tx`insert into erp_private.client_contacts(contact_id,client_id,full_name) values(${CT},${Z},'Fictional Representative')`;
 const stamp=async(c)=>{ // a task workspace at "Ready to file" with written approval, as the server would have left it
  const task=id();await db.exec('alter table erp_private.tasks disable trigger user');await tx`insert into erp_private.tasks(task_id,project_id,task_name,due_at,status) values(${task},${PJ},'Fictional filing task',now(),'In Progress')`;
  const ap=await pdf('approval.pdf');await tx`update erp_private.documents set is_locked=true where document_id=${ap}`;await db.exec('set session_replication_role=replica');await tx`insert into erp_private.task_procedures(task_id,project_id,profile,case_id,stage,approval_document_id,contact_id,details,prepared_by) values(${task},${PJ},'Tax filing',${c},'Ready to file',${ap},${CT},'{"approval":{"approved_on":"2026-10-04"}}'::jsonb,${AST})`;await db.exec('set session_replication_role=origin');return task;};
 // ---- 1. Acknowledgment path -------------------------------------------------------------------------------------------------------------------------
 const C1=await mkCase('VAT','2026-09-01','2026-09-30'),W1=await stamp(C1);
 await assert.rejects(()=>tx`update erp_private.tax_cases set status='Filed',filing_date='2026-10-05' where case_id=${C1}`,/filing record/,'no filing record: the case cannot become Filed');
 const doc=await pdf();
 await assert.rejects(file('MANAGER2',C1,{doc,itax:'ab'}),/acknowledgement_status|check/i,'an iTax number of at least 3 characters');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001'}),/PDF evidence/,'acknowledgment needs the document');
 const txt=await pdf('ack.txt','text/plain');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001',doc:txt}),/PDF/);
 const other=await mk('UAT Fictional Other Ltd','A400000021Z'),OP=await proj(other,'TAX-KRA'),foreign=await pdf('x.pdf','application/pdf',OP);
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001',doc:foreign}),/PDF evidence for this engagement/,'evidence from another engagement is refused');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001',doc,filed_on:'2026-09-15'}),/filing date/,'cannot be filed before the period ends');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001',doc,filed_on:D(3)}),/filing date/,'cannot be dated in the future');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050001',doc,prn:''}),/check|constraint/i,'a PRN or a documented no-PRN reason is needed');
 await file('MANAGER2',C1,{itax:'KRA2610050001',doc});
 const f1=(await tx`select * from erp_private.tax_filings where case_id=${C1}`)[0];
 assert.deepEqual([f1.acknowledgement_status,f1.itax_reference,f1.kind,f1.starts_on instanceof Date?f1.starts_on.toISOString().slice(0,10):f1.starts_on,f1.client_id===Z,f1.prepared_by===AST,f1.legacy],['ACKNOWLEDGEMENT_RECEIVED','KRA2610050001','VAT','2026-09-01',true,true,false],'client, kind, period and preparer are copied from the case');
 await assert.rejects(file('MANAGER2',C1,{itax:'KRA2610050002',doc}),/duplicate|unique/i,'one filing record per case');
 await assert.rejects(()=>tx`update erp_private.tax_filings set itax_reference='CHANGED' where case_id=${C1}`,/archived, not deleted/,'immutable');
 await assert.rejects(()=>tx`delete from erp_private.tax_filings where case_id=${C1}`,/archived, not deleted/);
 await assert.rejects(()=>tx`update erp_private.tax_cases set status='Filed',filing_date='2026-10-06' where case_id=${C1}`,/filing record/,'the filing date on the case must match the record');
 await tx`update erp_private.tax_cases set status='Filed',filing_date='2026-10-05' where case_id=${C1}`;
 assert.equal((await tx`select status from erp_private.tax_cases where case_id=${C1}`)[0].status,'Filed');
 // the procedure now accepts the Filed stage and closure on the record alone
 await tx`update erp_private.documents set is_locked=true where document_id=${doc}`;
 await tx`update erp_private.task_procedures set filing_document_id=${doc},stage='Filed - pending payment' where task_id=${W1}`;
 assert.equal((await tx`select stage from erp_private.task_procedures where task_id=${W1}`)[0].stage,'Filed - pending payment');
 // ---- 2. Exception path: a different Manager or Partner, with a reason ----------------------------------------------------------------------------------
 const C2=await mkCase('PAYE','2026-09-01','2026-09-30'),W2=await stamp(C2);
 const exc=(role,approver,reason='iTax portal outage: acknowledgment not yet issued')=>file(role,C2,{status:'MANAGER_EXCEPTION',reason,approver,itax:null});
 await assert.rejects(exc('SUPERVISOR',actors.SUPERVISOR.staff_id),/Manager or Partner/,'a Supervisor cannot approve an exception');
 await assert.rejects(exc('MANAGER',actors.PARTNER.staff_id),/signed-in/,'the approver must be the person recording it');
 await assert.rejects(exc('MANAGER2',M2,'short'),/check|constraint/i,'a reason of at least 10 characters');
 await assert.rejects(file('MANAGER',C2,{status:'MANAGER_EXCEPTION',reason:'iTax portal outage: acknowledgment not yet issued',approver:M,doc}),/instead of an acknowledgment/);
 // M reviewed C2 (reviewed_by=M), so M cannot approve an exception on it; another Manager or a Partner can
 await assert.rejects(exc('MANAGER',M),/did not prepare or review/,'the reviewer cannot approve the exception');
 await exc('MANAGER2',M2);
 const f2=(await tx`select * from erp_private.tax_filings where case_id=${C2}`)[0];
 assert.deepEqual([f2.acknowledgement_status,f2.exception_approved_by===M2,f2.exception_approved_at!==null,f2.acknowledgement_document_id],['MANAGER_EXCEPTION',true,true,null]);
 await tx`update erp_private.tax_cases set status='Filed',filing_date='2026-10-05' where case_id=${C2}`;
 await tx`update erp_private.task_procedures set stage='Filed - pending payment' where task_id=${W2}`;
 assert.equal((await tx`select stage from erp_private.task_procedures where task_id=${W2}`)[0].stage,'Filed - pending payment','an approved exception stands in for the document');
 const alerts=await tx`select count(*)::int n from erp_private.notifications where event_key like ${'filing-exception:'+f2.filing_id+':%'}`;
 assert.equal(alerts[0].n,(await tx`select count(*)::int n from erp_private.staff_members where category_code='PARTNER' and access_status='Active'`)[0].n,'every active Partner is told once about the exception');
 // ---- 3. Only a locked case can be recorded; a Partner (not the preparer) may also approve ------------------------------------------------------------
 const C3=await mkCase('VAT','2026-10-01','2026-10-31','Draft');
 await assert.rejects(file('MANAGER2',C3,{itax:'KRA2611050001',doc,filed_on:'2026-11-05'}),/locked tax case/);
 const C4=await mkCase('TOT','2026-09-01','2026-09-30');
 await file('PARTNER',C4,{status:'MANAGER_EXCEPTION',reason:'KRA acknowledgment will follow by courier',approver:PT,itax:null});
 assert.equal((await tx`select exception_approved_by from erp_private.tax_filings where case_id=${C4}`)[0].exception_approved_by,PT);
 // ---- 4. Legacy rows: made only by the migration -------------------------------------------------------------------------------------------------------
 await assert.rejects(q('MANAGER',`insert into erp_private.tax_filings(case_id,project_id,client_id,kind,starts_on,ends_on,prepared_by,filed_on,acknowledgement_status,recorded_by,legacy) values($1,$2,$3,'VAT','2026-09-01','2026-09-30',$4,'2026-10-05','ACKNOWLEDGEMENT_RECEIVED',$5,true)`,[C3,PJ,Z,AST,M]),/only by the migration/);
 // ---- 5. Access: records follow the engagement; the table is reachable only by erp_api ---------------------------------------------------------------------
 assert.equal((await q('MANAGER',`select count(*)::int n from erp_private.tax_filings where project_id=$1`,[PJ]))[0].n,3);
 for(const role of ['anon','authenticated']){await db.exec('begin');await db.exec(`set local role ${role}`);await assert.rejects(()=>db.query('select 1 from erp_private.tax_filings'),/permission denied/);await db.exec('rollback');}
 const fn=await tx`select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='erp_private' and p.proname in('tax_filing_guard','tax_filing_exception_alert')`;
 assert.ok(fn.every(x=>JSON.stringify(x.proconfig).includes('search_path')),'fixed search_path');
 for(const r of ['tax_filing_guard','tax_filing_exception_alert']){const g=await tx`select has_function_privilege('anon',('erp_private.'||${r}||'()')::regprocedure,'execute') a,has_function_privilege('authenticated',('erp_private.'||${r}||'()')::regprocedure,'execute') b`;assert.deepEqual([g[0].a,g[0].b],[false,false]);}
 // ---- 6. Server and screen --------------------------------------------------------------------------------------------------------------------------------------------
 const read=f=>fs.readFileSync(path.join(root,f),'utf8'),srv=read('supabase/functions/staff-workspace-v12/procedure-actions.ts'),ui=read('staff-procedures.mjs');
 assert.match(srv,/insert into erp_private\.tax_filings/);assert.match(srv,/Enter the iTax acknowledgment number/);
 assert.match(srv,/An exception needs a Manager or Partner who did not prepare or review this return/);
 assert.match(srv,/\[t\.assigned_to,w\.prepared_by,c\.prepared_by,c\.reviewed_by\]\.includes\(a\.staff_id\)/,'the preparer, the task owner and the reviewer cannot approve an exception');
 assert.ok(srv.indexOf('insert into erp_private.tax_filings')<srv.indexOf("set status='Filed',filing_date"),'the record is written before the case becomes Filed');
 assert.match(srv,/filing:a\.category_code==='INTERN'\?null/,'interns do not see the filing record');
 assert.match(ui,/name="itax_reference"|'itax_reference'/);assert.match(ui,/acknowledgement_exception/);assert.match(ui,/Filed on an approved exception/);
 assert.match(ui,/manager\(\)\?'<label class="full"><input type="checkbox" name="acknowledgement_exception">/,'the exception box is shown only to Managers and Partners');
 // a source guard: the build never states the forbidden standard name
 for(const f of ['supabase/functions/staff-workspace-v12/procedure-actions.ts','staff-procedures.mjs','supabase/migrations/20261110271000_filing_record.sql'])assert.ok(!/ISRS\s*4000/i.test(fs.readFileSync(path.join(root,f),'utf8')));
});
