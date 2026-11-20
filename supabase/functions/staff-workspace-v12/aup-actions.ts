import {fail,text,uuid,choice,revision} from './validation.mjs';

// Step 6: the procedures engine for Agreed-Upon Procedures (ADV-AUP) and KRA Audit and Dispute Support (TAX-KRA).
// The database repeats every rule below (see 20261109263000_aup_engine.sql); these checks give friendly messages and keep the order of writes.
// Rights are not in the staff rights catalogue: who may do what is decided here and in the database triggers.
const SERVICES=['ADV-AUP','TAX-KRA'];
const ACTIONS=['aup_read','aup_scope_start','aup_scope_template','aup_item_add','aup_item_edit','aup_item_remove','aup_scope_lock','aup_change_request','aup_change_decide',
 'aup_item_perform','aup_item_review','aup_evidence_add','aup_evidence_remove','aup_report','aup_report_issue','aup_library_add','aup_library_confirm'];
const AREAS=['Tax','Payroll','Bank','Sales','Purchases','Ledger','Documents','General'];
const one=(r:any[],m='This record is not available to your account.')=>{if(!r.length)fail(403,m);return r[0];};
const leaderOf=(a:any,m='A Manager or Partner must do this.')=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,m);};
const partnerOf=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const same=(row:any,p:any,m='This record changed. Refresh first.')=>{if(String(row.revision)!==revision(p.revision))fail(409,m);};

async function projectOf(tx:any,pid:string){
 const pr=one(await tx`select p.project_id,p.client_id,p.project_name,p.service_code,p.status,s.service_name from erp_private.projects p join erp_private.services s using(service_code)
  where p.project_id=${pid} and p.deleted_at is null and erp_private.project_allowed(p.project_id)`,'This project is not available to your account.');
 if(!SERVICES.includes(pr.service_code))fail(400,'Procedures apply only to Agreed-Upon Procedures and KRA Audit and Dispute Support projects.');
 return pr;
}
const lockProject=(tx:any,pid:string)=>tx`select pg_advisory_xact_lock(hashtextextended(${pid+':aup'},0))`;
async function scopeOf(tx:any,pid:string,need?:'Draft'|'Locked'){
 const s=one(await tx`select * from erp_private.aup_scopes where project_id=${pid} for update`,'This project has no scope yet. Start one first.');
 if(need==='Draft'&&s.state!=='Draft')fail(400,s.state==='Locked'?'The scope is locked. Ask for a scope change that a Partner approves.':'The report has been issued; the scope can no longer change.');
 if(need==='Locked'&&s.state!=='Locked')fail(400,s.state==='Draft'?'A Partner must lock the scope first.':'The report has been issued; the scope can no longer change.');
 return s;
}
async function itemOf(tx:any,itemId:string,pid:string){
 const it=one(await tx`select i.*,s.project_id,s.state as scope_state from erp_private.aup_scope_items i join erp_private.aup_scopes s on s.scope_id=i.scope_id where i.item_id=${itemId} for update of i`,'This procedure is not available to your account.');
 if(it.project_id!==pid)fail(403,'This procedure is not part of this project.');
 if(it.removed_at)fail(400,'This procedure has been removed.');
 return it;
}
async function libraryRow(tx:any,id:string,service:string){
 return one(await tx`select * from erp_private.aup_procedure_library where library_id=${id} and rule_status<>'Retired' and applies_to in('Both',${service})`,'That library procedure is not available for this service.');
}
function wording(p:any){
 const title=text(p.title,200),description=text(p.description,2000);
 if(title.length<5)fail(400,'Give the procedure a title of at least 5 characters.');
 if(description.length<10)fail(400,'Describe what the procedure does, in at least 10 characters.');
 return {title,description,evidence:p.evidence_required===undefined?true:!!p.evidence_required};
}
async function addTemplate(tx:any,a:any,scopeId:string,service:string){
 const have=new Set((await tx`select library_id from erp_private.aup_scope_items where scope_id=${scopeId} and removed_at is null and library_id is not null`).map((r:any)=>r.library_id));
 const rows=await tx`select library_id,title,description,evidence_required from erp_private.aup_procedure_library where in_template and rule_status<>'Retired' and applies_to in('Both',${service}) order by code`;
 let n=0;
 for(const r of rows){if(have.has(r.library_id))continue;
  await tx`insert into erp_private.aup_scope_items(scope_id,source,library_id,title,description,evidence_required,added_by) values(${scopeId},'Library',${r.library_id},${r.title},${r.description},${r.evidence_required},${a.staff_id})`;n++;}
 return n;
}

export async function aupAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;

 if(p.action==='aup_library_add'){
  leaderOf(a,'A Manager or Partner must add a suggested procedure to the library.');
  const code=text(p.code,10).toUpperCase();if(!/^[A-Z]{2,5}-[0-9]{2,3}$/.test(code))fail(400,'Use a code such as KRA-11 or AUP-06.');
  const w=wording(p),area=choice(p.area,AREAS),applies=choice(p.applies_to,['Both','ADV-AUP','TAX-KRA']);
  const [row]=await tx`insert into erp_private.aup_procedure_library(code,title,description,area,applies_to,in_template,evidence_required,created_by)
   values(${code},${w.title},${w.description},${area},${applies},${!!p.in_template},${w.evidence},${a.staff_id}) returning library_id`;
  return {ok:true,library_id:row.library_id};
 }
 if(p.action==='aup_library_confirm'){
  partnerOf(a,'Only a Partner can record the Compliance Lead\'s confirmation of a library procedure.');
  const row=one(await tx`select * from erp_private.aup_procedure_library where library_id=${uuid(p.library_id)} for update`);same(row,p,'This procedure changed. Refresh first.');
  if(row.rule_status==='Retired')fail(400,'A retired procedure stays retired.');
  const status=choice(p.rule_status,['Confirmed','Retired']);if(status==='Confirmed'&&row.rule_status==='Confirmed')fail(400,'This procedure is already confirmed.');
  const source=text(p.source_note,1000);if(source.length<10)fail(400,status==='Confirmed'?'Record where the Compliance Lead confirmed this in writing (for example a memo and its date), at least 10 characters.':'Record why this procedure is retired, at least 10 characters.');
  await tx`update erp_private.aup_procedure_library set rule_status=${status},source_note=${source},confirmed_by=${a.staff_id} where library_id=${row.library_id}`;
  return {ok:true};
 }

 const pid=uuid(p.project_id||(p.item_id||p.change_id||p.evidence_id?await projectForRecord(tx,p):null));
 const pr=await projectOf(tx,pid);

 if(p.action==='aup_read'){
  const scope=(await tx`select s.scope_id,s.project_id,s.state,s.letter_document_id,s.letter_reference,s.locked_by,s.locked_at,s.scope_sha256,s.report_issued_by,s.report_issued_at,s.report_sha256,s.revision,
    (select m.full_name from erp_private.staff_members m where m.staff_id=s.locked_by) as locked_by_name,
    (select m.full_name from erp_private.staff_members m where m.staff_id=s.report_issued_by) as issued_by_name,
    (select d.file_name from erp_private.documents d where d.document_id=s.letter_document_id) as letter_file
   from erp_private.aup_scopes s where s.project_id=${pid}`)[0]||null;
  const library=await tx`select library_id,code,title,description,area,applies_to,in_template,evidence_required,rule_status,source_note,revision from erp_private.aup_procedure_library
   where rule_status<>'Retired' and applies_to in('Both',${pr.service_code}) order by code`;
  const documents=await tx`select document_id,file_name,category from erp_private.aup_project_documents(${pid}::uuid)`;
  const letterOk=!!(await tx`select erp_private.project_letter_ok(${pid}::uuid) as ok`)[0].ok;
  let items:any[]=[],changes:any[]=[],progress:any=null;
  if(scope){
   const rows=await tx`select i.item_id,i.seq,i.library_id,i.source,i.title,i.description,i.evidence_required,i.exec_status,i.finding,i.performed_by,i.performed_at,i.reviewed_by,i.reviewed_at,i.added_in_change,i.revision,
     (select m.full_name from erp_private.staff_members m where m.staff_id=i.performed_by) as performed_by_name,
     (select m.full_name from erp_private.staff_members m where m.staff_id=i.reviewed_by) as reviewed_by_name
    from erp_private.aup_scope_items i where i.scope_id=${scope.scope_id} and i.removed_at is null order by i.seq`;
   const ev=await tx`select * from erp_private.aup_evidence_list(${scope.scope_id}::uuid)`;
   items=rows.map((i:any)=>({...i,evidence:ev.filter((e:any)=>e.item_id===i.item_id)}));
   changes=await tx`select c.change_id,c.kind,c.item_id,c.proposed_title,c.proposed_description,c.proposed_evidence_required,c.reason,c.status,c.requested_by,c.requested_at,c.decided_by,c.decided_at,c.decision_note,c.revision,
     (select m.full_name from erp_private.staff_members m where m.staff_id=c.requested_by) as requested_by_name,
     (select m.full_name from erp_private.staff_members m where m.staff_id=c.decided_by) as decided_by_name,
     (select i.title from erp_private.aup_scope_items i where i.item_id=c.item_id) as item_title
    from erp_private.aup_scope_changes c where c.scope_id=${scope.scope_id} order by c.requested_at desc`;
   progress=(await tx`select * from erp_private.aup_scope_progress(${scope.scope_id}::uuid)`)[0]||null;
  }
  return {project:pr,scope,items,changes,library,documents,letter_ok:letterOk,progress};
 }

 await lockProject(tx,pid);

 if(p.action==='aup_scope_start'){
  leaderOf(a,'A Manager or Partner must start the scope.');
  if((await tx`select 1 from erp_private.aup_scopes where project_id=${pid}`).length)fail(409,'This project already has a scope.');
  const [s]=await tx`insert into erp_private.aup_scopes(project_id,created_by) values(${pid},${a.staff_id}) returning scope_id`;
  const added=p.use_template?await addTemplate(tx,a,s.scope_id,pr.service_code):0;
  return {ok:true,scope_id:s.scope_id,added};
 }
 if(p.action==='aup_scope_template'){
  leaderOf(a,'A Manager or Partner must change the scope.');const s=await scopeOf(tx,pid,'Draft');
  return {ok:true,added:await addTemplate(tx,a,s.scope_id,pr.service_code)};
 }
 if(p.action==='aup_item_add'){
  leaderOf(a,'A Manager or Partner must change the scope.');const s=await scopeOf(tx,pid,'Draft');
  if(p.library_id){
   const lib=await libraryRow(tx,uuid(p.library_id),pr.service_code);
   if((await tx`select 1 from erp_private.aup_scope_items where scope_id=${s.scope_id} and library_id=${lib.library_id} and removed_at is null`).length)fail(400,'That procedure is already in the scope.');
   const [row]=await tx`insert into erp_private.aup_scope_items(scope_id,source,library_id,title,description,evidence_required,added_by) values(${s.scope_id},'Library',${lib.library_id},${lib.title},${lib.description},${lib.evidence_required},${a.staff_id}) returning item_id`;
   return {ok:true,item_id:row.item_id};
  }
  const w=wording(p);
  const [row]=await tx`insert into erp_private.aup_scope_items(scope_id,source,title,description,evidence_required,added_by) values(${s.scope_id},'Custom',${w.title},${w.description},${w.evidence},${a.staff_id}) returning item_id`;
  return {ok:true,item_id:row.item_id};
 }
 if(p.action==='aup_item_edit'){
  leaderOf(a,'A Manager or Partner must change the scope.');await scopeOf(tx,pid,'Draft');const it=await itemOf(tx,uuid(p.item_id),pid);same(it,p);
  const w=wording(p);
  await tx`update erp_private.aup_scope_items set title=${w.title},description=${w.description},evidence_required=${w.evidence} where item_id=${it.item_id}`;
  return {ok:true};
 }
 if(p.action==='aup_item_remove'){
  leaderOf(a,'A Manager or Partner must change the scope.');await scopeOf(tx,pid,'Draft');const it=await itemOf(tx,uuid(p.item_id),pid);same(it,p);
  const reason=text(p.reason,500);if(reason.length<3)fail(400,'Say why the procedure is removed.');
  await tx`update erp_private.aup_scope_items set removed_at=now(),removed_by=${a.staff_id},removed_reason=${reason} where item_id=${it.item_id}`;
  return {ok:true};
 }
 if(p.action==='aup_scope_lock'){
  partnerOf(a,'Only a Partner can lock the scope against the signed engagement letter.');
  const s=await scopeOf(tx,pid,'Draft');same(s,p,'The scope changed. Refresh first.');
  const ref=text(p.letter_reference,300);if(ref.length<3)fail(400,'Say where the procedures are listed in the engagement letter (for example "Schedule 1" or "clause 4").');
  if(!(await tx`select erp_private.project_letter_ok(${pid}::uuid) as ok`)[0].ok)fail(400,'Upload and verify the signed engagement letter before the scope is locked against it.');
  await tx`update erp_private.aup_scopes set state='Locked',locked_by=${a.staff_id},letter_reference=${ref} where scope_id=${s.scope_id}`;
  return {ok:true};
 }
 if(p.action==='aup_change_request'){
  leaderOf(a,'A Manager or Partner must request a scope change.');const s=await scopeOf(tx,pid,'Locked');
  const kind=choice(p.kind,['Add','Remove']),reason=text(p.reason,1000);if(reason.length<10)fail(400,'Say why the scope should change, in at least 10 characters. Refer to the client\'s written request or the amended letter.');
  const support=p.supporting_document_id?uuid(p.supporting_document_id):null;
  if(kind==='Remove'){
   const it=await itemOf(tx,uuid(p.item_id),pid);if(it.scope_id!==s.scope_id)fail(400,'Choose a procedure in this scope.');
   const [row]=await tx`insert into erp_private.aup_scope_changes(scope_id,kind,item_id,reason,supporting_document_id,requested_by) values(${s.scope_id},'Remove',${it.item_id},${reason},${support},${a.staff_id}) returning change_id`;
   return {ok:true,change_id:row.change_id};
  }
  let libId:string|null=null,title:string,description:string,evidence:boolean;
  if(p.library_id){const lib=await libraryRow(tx,uuid(p.library_id),pr.service_code);libId=lib.library_id;title=lib.title;description=lib.description;evidence=lib.evidence_required;}
  else{const w=wording(p);title=w.title;description=w.description;evidence=w.evidence;}
  const [row]=await tx`insert into erp_private.aup_scope_changes(scope_id,kind,library_id,proposed_title,proposed_description,proposed_evidence_required,reason,supporting_document_id,requested_by)
   values(${s.scope_id},'Add',${libId},${title},${description},${evidence},${reason},${support},${a.staff_id}) returning change_id`;
  return {ok:true,change_id:row.change_id};
 }
 if(p.action==='aup_change_decide'){
  partnerOf(a,'Only a Partner can decide a scope change.');const s=await scopeOf(tx,pid,'Locked');
  const ch=one(await tx`select * from erp_private.aup_scope_changes where change_id=${uuid(p.change_id)} and scope_id=${s.scope_id} for update`);same(ch,p);
  if(ch.status!=='Requested')fail(400,'This request has already been decided.');
  if(ch.requested_by===a.staff_id)fail(403,'A scope change must be decided by a Partner other than the person who requested it.');
  const decision=choice(p.decision,['Approved','Rejected']),note=text(p.decision_note,1000);if(note.length<10)fail(400,'Record the reason for the decision, in at least 10 characters.');
  await tx`update erp_private.aup_scope_changes set status=${decision},decided_by=${a.staff_id},decision_note=${note} where change_id=${ch.change_id}`;
  if(decision==='Approved'){
   if(ch.kind==='Add')await tx`insert into erp_private.aup_scope_items(scope_id,source,library_id,title,description,evidence_required,added_by,added_in_change)
     values(${s.scope_id},${ch.library_id?'Library':'Custom'},${ch.library_id},${ch.proposed_title},${ch.proposed_description},${ch.proposed_evidence_required},${a.staff_id},${ch.change_id})`;
   else await tx`update erp_private.aup_scope_items set removed_at=now(),removed_by=${a.staff_id},removed_reason=${'Approved scope change: '+note.slice(0,200)},removed_in_change=${ch.change_id} where item_id=${ch.item_id}`;
  }
  return {ok:true};
 }
 if(p.action==='aup_item_perform'){
  await scopeOf(tx,pid,'Locked');const it=await itemOf(tx,uuid(p.item_id),pid);same(it,p);
  const status=choice(p.exec_status,['In progress','Completed','Exception','Not applicable']),finding=text(p.finding||'',4000,false);
  if(status==='Completed'&&finding.length<3)fail(400,'Record the factual finding.');
  if(['Exception','Not applicable'].includes(status)&&finding.length<10)fail(400,status==='Exception'?'Describe the exception, in at least 10 characters.':'Say why this procedure does not apply, in at least 10 characters.');
  await tx`update erp_private.aup_scope_items set exec_status=${status},finding=${finding||null},performed_by=${a.staff_id} where item_id=${it.item_id}`;
  return {ok:true};
 }
 if(p.action==='aup_item_review'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner reviews a result.');
  await scopeOf(tx,pid,'Locked');const it=await itemOf(tx,uuid(p.item_id),pid);same(it,p);
  if(it.performed_by===a.staff_id)fail(403,'The person who performed a procedure cannot review it.');
  await tx`update erp_private.aup_scope_items set reviewed_by=${a.staff_id} where item_id=${it.item_id}`;
  return {ok:true};
 }
 if(p.action==='aup_evidence_add'){
  await scopeOf(tx,pid,'Locked');const it=await itemOf(tx,uuid(p.item_id),pid);
  const [row]=await tx`insert into erp_private.aup_item_evidence(item_id,document_id,note,linked_by) values(${it.item_id},${uuid(p.document_id)},${text(p.note||'',500,false)},${a.staff_id}) returning evidence_id`;
  return {ok:true,evidence_id:row.evidence_id};
 }
 if(p.action==='aup_evidence_remove'){
  const s=await scopeOf(tx,pid,'Locked');const ev=one(await tx`select e.* from erp_private.aup_item_evidence e where e.evidence_id=${uuid(p.evidence_id)} and exists(select 1 from erp_private.aup_scope_items i where i.item_id=e.item_id and i.scope_id=${s.scope_id}) for update`);same(ev,p);
  if(ev.removed_at)fail(400,'This evidence has already been removed.');
  await tx`update erp_private.aup_item_evidence set removed_at=now(),removed_by=${a.staff_id} where evidence_id=${ev.evidence_id}`;
  return {ok:true};
 }
 if(p.action==='aup_report'){
  const s=one(await tx`select state,report_sha256,report_issued_at,report_snapshot from erp_private.aup_scopes where project_id=${pid}`,'This project has no scope yet.');
  // An issued report is shown from its stored snapshot, so it never changes after issue.
  const report=s.state==='Issued'?s.report_snapshot:(await tx`select erp_private.aup_report(${pid}::uuid) as r`)[0].r;
  return {report,state:s.state,report_sha256:s.report_sha256,report_issued_at:s.report_issued_at};
 }
 if(p.action==='aup_report_issue'){
  partnerOf(a,'Only a Partner can issue the report.');
  const s=await scopeOf(tx,pid,'Locked');same(s,p,'The scope changed. Refresh first.');
  await tx`update erp_private.aup_scopes set state='Issued',report_issued_by=${a.staff_id} where scope_id=${s.scope_id}`;
  return {ok:true};
 }
 return undefined;
}

// Actions on one record carry its id instead of the project id. Find the project from the record.
async function projectForRecord(tx:any,p:any):Promise<string|null>{
 if(p.item_id)return (await tx`select s.project_id from erp_private.aup_scope_items i join erp_private.aup_scopes s on s.scope_id=i.scope_id where i.item_id=${uuid(p.item_id)}`)[0]?.project_id||null;
 if(p.change_id)return (await tx`select s.project_id from erp_private.aup_scope_changes c join erp_private.aup_scopes s on s.scope_id=c.scope_id where c.change_id=${uuid(p.change_id)}`)[0]?.project_id||null;
 if(p.evidence_id)return (await tx`select s.project_id from erp_private.aup_item_evidence e join erp_private.aup_scope_items i on i.item_id=e.item_id join erp_private.aup_scopes s on s.scope_id=i.scope_id where e.evidence_id=${uuid(p.evidence_id)}`)[0]?.project_id||null;
 return null;
}
