// Step 6 (joined-practice review): the procedures engine for Agreed-Upon Procedures and KRA Audit and Dispute Support.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PGlite}=require(require.resolve('@electric-sql/pglite',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const root=path.resolve(import.meta.dirname,'..');
const id=()=>crypto.randomUUID(),db=new PGlite(),actors={},F=id(),C=id(),P=id();
const tx=async(parts,...v)=>{const sql=parts.reduce((s,p,i)=>s+p+(i<v.length?'$'+(i+1):''),'');return (await db.query(sql,v)).rows;};
async function as(role,fn){const a=actors[role];await db.exec('begin');try{await db.query(`select set_config('request.jwt.claims',$1,true)`,[JSON.stringify({sub:a.auth_user_id,session_id:a.session})]);await db.exec('set local role erp_api');const r=await fn(a);await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}}
const j=v=>JSON.parse(JSON.stringify(v));
test('Step 6: procedures engine (library, draft scope, Partner lock, scope changes, execution, evidence gate, report)',async t=>{
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
 const PT=actors.PARTNER.staff_id,PT2=actors.PARTNER2.staff_id,SUP=actors.SUPERVISOR.staff_id,AST=actors.ASSISTANT.staff_id;
 const act=async(svc,status='Active')=>{await db.exec('alter table erp_private.projects disable trigger user');const p=await proj(A,svc,status);await db.exec('alter table erp_private.projects enable trigger user');return p;};
 const doc=async(p,category='PBC Documents',name)=>{const d=id();await tx`insert into erp_private.documents(document_id,client_id,handling_firm_id,project_id,category,file_name,object_key,file_size_bytes,sha256,mime_type,uploaded_by) values(${d},${A},${F},${p},${category},${name||category+'.pdf'},${'k/'+d},10,${'a'.repeat(64)},'application/pdf',${M})`;return d;};
 const withLetter=async p=>{const d=await doc(p,'Signed Engagement Letters','Letter.pdf');await tx`insert into erp_private.engagement_controls(project_id,signed_letter_id,letter_verified_by,stage) values(${p},${d},${M},'Accepted')`;return d;};
 const team=async p=>{await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${AST},${F},'ASSISTANT')`;await tx`insert into erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) values(${p},${SUP},${F},'SUPERVISOR')`;};
 const addItem=async(role,scope,title,{lib=null,ev=true,desc='Compare the two named records and list each difference.'}={})=>(await q(role,`insert into erp_private.aup_scope_items(scope_id,source,library_id,title,description,evidence_required,added_by) values($1,$2,$3,$4,$5,$6,$7) returning item_id,seq`,[scope,lib?'Library':'Custom',lib,title,desc,ev,actors[role].staff_id]))[0];
 const item=async id_=>j((await tx`select * from erp_private.aup_scope_items where item_id=${id_}`)[0]);

 // ---- 1. Library ------------------------------------------------------------------------------------------------------------------------------
 const lib=await tx`select code,applies_to,in_template,rule_status from erp_private.aup_procedure_library order by code`;
 assert.equal(lib.length,15);assert.ok(lib.every(l=>l.rule_status==='Suggested'),'nothing in the library is confirmed at the start');
 assert.ok(lib.filter(l=>l.applies_to==='TAX-KRA'&&l.in_template).length>=5&&lib.filter(l=>l.applies_to==='ADV-AUP'&&l.in_template).length>=2,'both services have a template');
 assert.equal((await tx`select count(*)::int n from erp_private.aup_procedure_library where title ~* 'ISRS 4000' or description ~* 'ISRS 4000'`)[0].n,0);
 const L1=(await tx`select library_id from erp_private.aup_procedure_library where code='KRA-01'`)[0].library_id;
 const L7=(await tx`select library_id from erp_private.aup_procedure_library where code='KRA-07'`)[0].library_id;
 const add=(role,code)=>q(role,`insert into erp_private.aup_procedure_library(code,title,description,area,applies_to,created_by) values($1,'Check the fictional register','Compare the register to the ledger and list each difference.','General','Both',$2)`,[code,actors[role].staff_id]);
 await add('MANAGER','KRA-11');
 await assert.rejects(add('ASSISTANT','KRA-12'),/row-level security|Only a Manager or Partner/);
 await assert.rejects(q('MANAGER',`update erp_private.aup_procedure_library set title='Another title entirely' where code='KRA-11'`),/cannot be edited/);
 await assert.rejects(q('MANAGER',`update erp_private.aup_procedure_library set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead memo of 9 Nov' where code='KRA-11'`,[M]),/Only a Partner/);
 await assert.rejects(q('PARTNER',`update erp_private.aup_procedure_library set rule_status='Confirmed',confirmed_by=$1,source_note='short' where code='KRA-11'`,[PT]),/check constraint/);
 await assert.rejects(q('PARTNER',`update erp_private.aup_procedure_library set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead memo of 9 Nov' where code='KRA-11'`,[PT2]),/signed-in Partner/);
 await q('PARTNER',`update erp_private.aup_procedure_library set rule_status='Confirmed',confirmed_by=$1,source_note='Compliance Lead memo of 9 Nov' where code='KRA-11'`,[PT]);
 assert.equal((await tx`select rule_status from erp_private.aup_procedure_library where code='KRA-11'`)[0].rule_status,'Confirmed');
 await assert.rejects(q('PARTNER',`update erp_private.aup_procedure_library set source_note='Changed my mind about the source' where code='KRA-11'`),/cannot be changed/);
 await assert.rejects(db.query(`delete from erp_private.aup_procedure_library where code='KRA-11'`),/./,'no hard delete');

 // ---- 2. A scope belongs to the two services only -----------------------------------------------------------------------------------------------
 const plan=await act('ADV-PLAN');
 const newScope=(role,p)=>q(role,`insert into erp_private.aup_scopes(project_id,created_by) values($1,$2) returning scope_id`,[p,actors[role].staff_id]);
 await assert.rejects(newScope('MANAGER',plan),/applies only to Agreed-Upon Procedures/);
 const P1=await act('ADV-AUP','Draft');await team(P1);
 await assert.rejects(newScope('ASSISTANT',P1),/row-level security|Only a Manager/);
 const S1=(await newScope('MANAGER',P1))[0].scope_id;
 await assert.rejects(newScope('MANAGER',P1),/duplicate key/,'one scope per project');
 assert.equal((await q('ASSISTANT','select count(*)::int n from erp_private.aup_scopes where scope_id=$1',[S1]))[0].n,1,'an assigned Assistant can read the scope');
 assert.equal((await q('INTERN','select count(*)::int n from erp_private.aup_scopes where scope_id=$1',[S1]))[0].n,0,'an Intern cannot');

 // ---- 3. Draft: add, edit and remove freely ---------------------------------------------------------------------------------------------------
 const i1=await addItem('MANAGER',S1,'Agree the debtors schedule to the ledger');
 const i2=await addItem('MANAGER',S1,'Agree opening balances to prior-year trial balance',{lib:L7});
 const i3=await addItem('PARTNER',S1,'Inspect the board minutes for approvals',{ev:false});
 assert.deepEqual([i1.seq,i2.seq,i3.seq],[1,2,3]);
 await assert.rejects(addItem('ASSISTANT',S1,'An unauthorised extra procedure'),/Only a Manager or Partner can add/);
 await q('MANAGER',`update erp_private.aup_scope_items set title='Agree the debtors list to the ledger', description='Compare the debtors list to the ledger and list each difference.' where item_id=$1`,[i1.item_id]);
 assert.equal((await item(i1.item_id)).title,'Agree the debtors list to the ledger');
 await assert.rejects(q('ASSISTANT',`update erp_private.aup_scope_items set title='Quietly rewritten wording' where item_id=$1`,[i1.item_id]),/Only a Manager or Partner can edit/);
 const extra=await addItem('MANAGER',S1,'A procedure that is not needed');
 await q('MANAGER',`update erp_private.aup_scope_items set removed_at=now(),removed_by=$2,removed_reason='Not in the letter' where item_id=$1`,[extra.item_id,M]);
 await assert.rejects(q('MANAGER',`update erp_private.aup_scope_items set removed_at=null,removed_by=null,removed_reason=null where item_id=$1`,[extra.item_id]),/stays removed/);
 await assert.rejects(db.query(`delete from erp_private.aup_scope_items where item_id='${extra.item_id}'`),/./,'no hard delete');
 await assert.rejects(q('MANAGER',`update erp_private.aup_scope_items set exec_status='In progress',performed_by=$2 where item_id=$1`,[i1.item_id,M]),/only after a Partner has locked/);

 // ---- 4. Lock: Partner only, against a verified letter, with a hash ------------------------------------------------------------------------------
 const lock=(role,ref='Schedule 1 of the letter')=>q(role,`update erp_private.aup_scopes set state='Locked',locked_by=$2,letter_reference=$3 where scope_id=$1`,[S1,actors[role].staff_id,ref]);
 await assert.rejects(lock('MANAGER'),/Only a Partner can lock/);
 await assert.rejects(lock('PARTNER'),/Upload and verify the signed engagement letter/);
 const letter=await withLetter(P1);
 await assert.rejects(lock('PARTNER',''),/check constraint/);
 const empty=await act('TAX-KRA','Draft');await withLetter(empty);
 const SE=(await newScope('MANAGER',empty))[0].scope_id;
 await assert.rejects(q('PARTNER',`update erp_private.aup_scopes set state='Locked',locked_by=$2,letter_reference='Annex A' where scope_id=$1`,[SE,PT]),/at least one procedure/);
 await lock('PARTNER');
 const sc=(await tx`select * from erp_private.aup_scopes where scope_id=${S1}`)[0];
 assert.equal(sc.state,'Locked');assert.equal(sc.letter_document_id,letter);assert.equal(sc.locked_by,PT);assert.match(sc.scope_sha256,/^[0-9a-f]{64}$/);assert.ok(sc.locked_at);
 await assert.rejects(q('PARTNER',`update erp_private.aup_scopes set letter_reference='Edited afterwards' where scope_id=$1`,[S1]),/cannot be edited/);
 await assert.rejects(lock('PARTNER','A different reference'),/cannot be edited/,'a second lock cannot rewrite the record');
 await assert.rejects(addItem('MANAGER',S1,'A procedure added after the lock'),/only through a scope change/);
 await assert.rejects(q('MANAGER',`update erp_private.aup_scope_items set title='Reworded after the lock' where item_id=$1`,[i1.item_id]),/cannot change; ask a Partner/);
 await assert.rejects(q('MANAGER',`update erp_private.aup_scope_items set removed_at=now(),removed_by=$2,removed_reason='No longer wanted' where item_id=$1`,[i3.item_id,M]),/only through a scope change/);
 // the hash covers the active procedures only, in order
 assert.equal(sc.scope_sha256,(await tx`select encode(sha256(convert_to(string_agg(title||E'\n'||description||E'\n'||evidence_required::text,E'\n--\n' order by seq),'UTF8')),'hex') h from erp_private.aup_scope_items where scope_id=${S1} and removed_at is null`)[0].h);

 // ---- 5. Scope changes: request, a different Partner decides, approval applies it ---------------------------------------------------------------
 const req=(role,sqlText,v)=>q(role,sqlText,v);
 await assert.rejects(req('ASSISTANT',`insert into erp_private.aup_scope_changes(scope_id,kind,proposed_title,proposed_description,proposed_evidence_required,reason,requested_by) values($1,'Add','Extra procedure','Compare the extra records.',true,'The client asked in writing',$2)`,[S1,AST]),/row-level security|Only a Manager or Partner can request/);
 const ch=(await req('MANAGER',`insert into erp_private.aup_scope_changes(scope_id,kind,proposed_title,proposed_description,proposed_evidence_required,reason,requested_by) values($1,'Add','Agree payroll to the P9 forms','Agree the payroll totals to the P9 forms and list each difference.',true,'Client asked for this in writing on 9 November',$2) returning change_id`,[S1,M]))[0].change_id;
 await assert.rejects(req('MANAGER',`update erp_private.aup_scope_changes set status='Approved',decided_by=$2,decision_note='I approve my own request' where change_id=$1`,[ch,M]),/Only a Partner/);
 await assert.rejects(req('PARTNER',`update erp_private.aup_scope_changes set status='Approved',decided_by=$2,decision_note='short' where change_id=$1`,[ch,PT]),/check constraint/);
 await assert.rejects(addItem('PARTNER',S1,'Agree payroll to the P9 forms'),/only through a scope change/,'not before it is approved');
 await req('PARTNER',`update erp_private.aup_scope_changes set status='Approved',decided_by=$2,decision_note='Agreed with the client in writing' where change_id=$1`,[ch,PT]);
 const added=(await req('MANAGER',`insert into erp_private.aup_scope_items(scope_id,source,title,description,evidence_required,added_by,added_in_change) values($1,'Custom','Agree payroll to the P9 forms','Agree the payroll totals to the P9 forms and list each difference.',true,$2,$3) returning item_id,seq`,[S1,M,ch]))[0];
 assert.equal(added.seq,5,'a removed procedure keeps its number; numbers are never reused');
 await assert.rejects(req('MANAGER',`insert into erp_private.aup_scope_items(scope_id,source,title,description,evidence_required,added_by,added_in_change) values($1,'Custom','The same change used twice','Agree the payroll totals again to be sure.',true,$2,$3)`,[S1,M,ch]),/already been applied/);
 await assert.rejects(req('PARTNER',`update erp_private.aup_scope_changes set status='Rejected',decided_by=$2,decision_note='Trying to flip a decision' where change_id=$1`,[ch,PT]),/already been decided/);
 // a Partner's own request is decided by the other Partner; a rejected removal removes nothing
 const rm=(await req('PARTNER',`insert into erp_private.aup_scope_changes(scope_id,kind,item_id,reason,requested_by) values($1,'Remove',$2,'The letter was amended on 9 November',$3) returning change_id`,[S1,i3.item_id,PT]))[0].change_id;
 await assert.rejects(req('PARTNER',`insert into erp_private.aup_scope_changes(scope_id,kind,item_id,reason,requested_by) values($1,'Remove',$2,'A second open request for the same',$3)`,[S1,i3.item_id,PT]),/duplicate key/);
 await assert.rejects(req('PARTNER',`update erp_private.aup_scope_changes set status='Approved',decided_by=$2,decision_note='Approving my own request' where change_id=$1`,[rm,PT]),/other than the person who requested/);
 await req('PARTNER2',`update erp_private.aup_scope_changes set status='Rejected',decided_by=$2,decision_note='Keep the minutes review in the scope' where change_id=$1`,[rm,PT2]);
 await assert.rejects(req('MANAGER',`update erp_private.aup_scope_items set removed_at=now(),removed_by=$3,removed_reason='Rejected removal',removed_in_change=$2 where item_id=$1`,[i3.item_id,rm,M]),/only through a scope change that a Partner has approved/);
 const rm2=(await req('MANAGER',`insert into erp_private.aup_scope_changes(scope_id,kind,item_id,reason,requested_by) values($1,'Remove',$2,'The client withdrew this procedure in writing',$3) returning change_id`,[S1,i3.item_id,M]))[0].change_id;
 await req('PARTNER',`update erp_private.aup_scope_changes set status='Approved',decided_by=$2,decision_note='Withdrawal confirmed in the client email' where change_id=$1`,[rm2,PT]);
 await req('MANAGER',`update erp_private.aup_scope_items set removed_at=now(),removed_by=$3,removed_reason='Approved scope change',removed_in_change=$2 where item_id=$1`,[i3.item_id,rm2,M]);
 assert.ok((await item(i3.item_id)).removed_at);
 const draftOnly=await act('ADV-AUP','Draft');const SD=(await newScope('MANAGER',draftOnly))[0].scope_id;
 await assert.rejects(req('MANAGER',`insert into erp_private.aup_scope_changes(scope_id,kind,proposed_title,proposed_description,proposed_evidence_required,reason,requested_by) values($1,'Add','Too early','Compare the extra records.',true,'Asking before the lock',$2)`,[SD,M]),/only while the scope is locked/);

 // ---- 6. Execution and the evidence gate ----------------------------------------------------------------------------------------------------------------
 const perform=(role,it,status,finding)=>q(role,`update erp_private.aup_scope_items set exec_status=$2,finding=$3,performed_by=$4 where item_id=$1`,[it,status,finding,actors[role].staff_id]);
 await assert.rejects(perform('ASSISTANT',i1.item_id,'In progress',null),/Activate the engagement/,'the project must be active');
 await db.exec('alter table erp_private.projects disable trigger user');await tx`update erp_private.projects set status='Active' where project_id=${P1}`;await db.exec('alter table erp_private.projects enable trigger user');
 await perform('ASSISTANT',i1.item_id,'In progress',null);
 await assert.rejects(perform('ASSISTANT',i1.item_id,'Completed','Agreed without exception'),/Attach the evidence/);
 const other=await act('ADV-AUP','Active');const foreign=await doc(other,'PBC Documents','Foreign.pdf');
 const attach=(role,it,d)=>q(role,`insert into erp_private.aup_item_evidence(item_id,document_id,linked_by) values($1,$2,$3) returning evidence_id`,[it,d,actors[role].staff_id]);
 await assert.rejects(attach('ASSISTANT',i1.item_id,foreign),/filed on this project/);
 const d1=await doc(P1,'PBC Documents','Debtors.pdf');
 const ev1=(await attach('ASSISTANT',i1.item_id,d1))[0].evidence_id;
 await assert.rejects(attach('ASSISTANT',i1.item_id,d1),/duplicate key/);
 await assert.rejects(perform('ASSISTANT',i1.item_id,'Completed','ok'),/factual finding|check constraint/,'a finding of two characters is not a finding');
 await perform('ASSISTANT',i1.item_id,'Completed','Agreed without exception');
 let r1=await item(i1.item_id);assert.equal(r1.exec_status,'Completed');assert.equal(r1.performed_by,AST);assert.ok(r1.performed_at);
 await assert.rejects(q('ASSISTANT',`update erp_private.aup_item_evidence set removed_at=now(),removed_by=$2 where evidence_id=$1`,[ev1,AST]),/Reopen the procedure/);
 // review: a different Supervisor, Manager or Partner; not an Assistant; not the performer
 const review=(role,it)=>q(role,`update erp_private.aup_scope_items set reviewed_by=$2 where item_id=$1`,[it,actors[role].staff_id]);
 await assert.rejects(review('ASSISTANT',i1.item_id),/A Supervisor, Manager or Partner reviews/);
 await review('SUPERVISOR',i1.item_id);
 assert.equal((await item(i1.item_id)).reviewed_by,SUP);
 await assert.rejects(review('MANAGER',i1.item_id),/already been reviewed/);
 // changing a result removes the review
 await perform('ASSISTANT',i1.item_id,'Completed','Agreed; one small difference noted and explained');
 r1=await item(i1.item_id);assert.equal(r1.reviewed_by,null,'a changed result needs a new review');
 await assert.rejects(perform('ASSISTANT',i1.item_id,'Not started',null),/cannot go back to Not started|check constraint/);
 // the performer cannot review their own result
 await perform('SUPERVISOR',i2.item_id,'In progress',null);
 const d2=await doc(P1,'PBC Documents','Opening TB.pdf');await attach('SUPERVISOR',i2.item_id,d2);
 await assert.rejects(perform('SUPERVISOR',i2.item_id,'Exception','Short'),/at least 10 characters/);
 await perform('SUPERVISOR',i2.item_id,'Exception','Opening debtors differ from the prior-year closing by a small amount');
 await assert.rejects(review('SUPERVISOR',i2.item_id),/cannot review it/);
 await review('MANAGER',i2.item_id);
 // a procedure that needs no evidence completes without it; Not applicable needs a reason
 await perform('ASSISTANT',added.item_id,'In progress',null);
 await assert.rejects(perform('ASSISTANT',added.item_id,'Not applicable','No'),/at least 10 characters/);
 const d3=await doc(P1,'Working Papers','P9 agreement.xlsx');await attach('ASSISTANT',added.item_id,d3);
 await perform('ASSISTANT',added.item_id,'Completed','Agreed to the P9 forms without exception');
 // someone not on the project cannot touch it
 const outsider=await q('ASSISTANT2' in actors?'ASSISTANT2':'INTERN','select count(*)::int n from erp_private.aup_scope_items where scope_id=$1',[S1]);
 assert.equal(outsider[0].n,0);

 // ---- 7. Report -------------------------------------------------------------------------------------------------------------------------------
 let rep=j((await q('MANAGER','select erp_private.aup_report($1) r',[P1]))[0].r);
 assert.equal(rep.standard.text,'[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]');
 assert.equal(rep.procedures.length,3,'removed procedures are not reported');
 assert.deepEqual(rep.procedures.map(p=>p.seq),[1,2,5]);
 assert.equal(rep.scope_changes.length,2,'approved scope changes are reported');
 assert.match(rep.statement,/no assurance is expressed/);assert.ok(!JSON.stringify(rep).includes('ISRS 4000'));
 assert.equal((await q('INTERN','select erp_private.aup_report($1) r',[P1]))[0].r,null);
 const prog=j((await q('MANAGER','select * from erp_private.aup_scope_progress($1)',[S1]))[0]);
 assert.deepEqual([prog.total,prog.completed,prog.exceptions,prog.open_items,prog.unreviewed,prog.missing_evidence],[3,2,1,0,2,0]);
 const issue=role=>q(role,`update erp_private.aup_scopes set state='Issued',report_issued_by=$2 where scope_id=$1`,[S1,actors[role].staff_id]);
 await assert.rejects(issue('MANAGER'),/Only a Partner can issue/);
 await assert.rejects(issue('PARTNER'),/must be reviewed/);
 await review('MANAGER',i1.item_id);await review('SUPERVISOR',added.item_id);
 const openChange=(await req('MANAGER',`insert into erp_private.aup_scope_changes(scope_id,kind,proposed_title,proposed_description,proposed_evidence_required,reason,requested_by) values($1,'Add','A late request','Compare the late request records.',true,'The client asked late on 9 November',$2) returning change_id`,[S1,M]))[0].change_id;
 await assert.rejects(issue('PARTNER'),/Decide the open scope change/);
 await req('PARTNER',`update erp_private.aup_scope_changes set status='Rejected',decided_by=$2,decision_note='Outside the signed letter, declined' where change_id=$1`,[openChange,PT]);
 // the Compliance Lead's confirmation of the standard changes the wording of the report
 const ref=(await tx`select reference_id,reference from erp_private.service_references where service_code='ADV-AUP' and reference ilike '%ISRS 4400%'`)[0];
 await q('PARTNER',`update erp_private.service_references set rule_status='Confirmed',confirmed_by=$2,source_note='Compliance Lead memo of 9 Nov' where reference_id=$1`,[ref.reference_id,PT]);
 rep=j((await q('MANAGER','select erp_private.aup_report($1) r',[P1]))[0].r);assert.equal(rep.standard.text,ref.reference);
 await issue('PARTNER');
 const done=(await tx`select * from erp_private.aup_scopes where scope_id=${S1}`)[0];
 assert.equal(done.state,'Issued');assert.equal(done.report_issued_by,PT);assert.ok(done.report_issued_at);
 assert.equal(done.report_sha256,(await tx`select encode(sha256(convert_to(report_snapshot::text,'UTF8')),'hex') h from erp_private.aup_scopes where scope_id=${S1}`)[0].h);
 assert.equal(done.report_snapshot.procedures.length,3);
 // once issued, nothing moves
 await assert.rejects(perform('ASSISTANT',i1.item_id,'In progress',null),/report has been issued/);
 await assert.rejects(req('MANAGER',`insert into erp_private.aup_scope_changes(scope_id,kind,proposed_title,proposed_description,proposed_evidence_required,reason,requested_by) values($1,'Add','After issue','Compare records after issue.',true,'Asking after the report',$2)`,[S1,M]),/only while the scope is locked/);
 await assert.rejects(issue('PARTNER'),/report has been issued/);
 await assert.rejects(q('PARTNER',`update erp_private.aup_scopes set report_sha256=$2 where scope_id=$1`,[S1,'b'.repeat(64)]),/report has been issued/);

 // ---- 8. The file checklist and the go-live counts ---------------------------------------------------------------------------------------------------
 const cl=j(await q('MANAGER','select * from erp_private.project_file_checklist($1)',[P1]));const ck=k=>cl.find(x=>x.item_key===k);
 assert.equal(ck('scope_locked').present,true);assert.equal(ck('report_issued').present,true);
 const cl2=j(await q('MANAGER','select * from erp_private.project_file_checklist($1)',[empty]));
 assert.equal(cl2.find(x=>x.item_key==='scope_locked').present,false);assert.equal(cl2.find(x=>x.item_key==='report_issued').present,false);
 const cnt=j((await q('MANAGER','select erp_private.aup_counts() c'))[0].c);
 assert.deepEqual(Object.keys(cnt).sort(),['aup_changes_requested','aup_library_unconfirmed','aup_projects_scope_not_locked','aup_results_unreviewed']);
 assert.ok(Number(cnt.aup_projects_scope_not_locked)>=1);assert.equal(Number(cnt.aup_library_unconfirmed),15,"15 seeded and still suggested; the one added and confirmed is not counted");
 assert.deepEqual(Object.values(j((await q('ASSISTANT','select erp_private.aup_counts() c'))[0].c)).map(Number),[0,0,0,0],'only Managers and Partners see the counts');

 // ---- 9. Tables are protected and audited -----------------------------------------------------------------------------------------------------------
 for(const tname of ['aup_procedure_library','aup_scopes','aup_scope_items','aup_item_evidence','aup_scope_changes']){
  const r=(await tx`select relrowsecurity a,relforcerowsecurity b from pg_class where oid=${'erp_private.'+tname}::regclass`)[0];assert.ok(r.a&&r.b,tname+' has forced row security');
  assert.ok((await tx`select count(*)::int n from pg_trigger where tgrelid=${'erp_private.'+tname}::regclass and not tgisinternal and tgname='no_delete'`)[0].n===1,tname+' cannot be deleted from');
 }
 assert.ok((await tx`select count(*)::int n from erp_private.audit_events where table_name in('aup_scopes','aup_scope_items','aup_scope_changes','aup_item_evidence')`)[0].n>=15);
 assert.deepEqual((await tx`select engine_state from erp_private.service_profiles where service_code in('ADV-AUP','TAX-KRA') order by service_code`).map(r=>r.engine_state),['Built','Built']);
});
