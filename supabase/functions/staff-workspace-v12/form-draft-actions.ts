import {fail,uuid} from './validation.mjs';
import {FORM_KINDS,MAX_DRAFTS_PER_PERSON,cleanPayload,draftTitle,draftIssues,auditShape} from './form-draft-rules.mjs';

// Build 2903: resumable form drafts. A person's own unfinished form is kept on the server so it survives a closed tab, a sign-out or another computer.
// It is private to its owner (row security), is never an approval, task or ledger record, and is removed when the form is submitted or discarded.
// The audit log records that a draft was created, saved on request, resumed or discarded. It never records what the draft contained.
const ACTIONS=['form_draft_list','form_draft_read','form_draft_save','form_draft_discard'];
const iso=(v:any)=>v instanceof Date?v.toISOString():String(v||'');
const audit=(tx:any,a:any,action:string,id:string,shape:any)=>tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'staff_form_drafts',${action},${id},${tx.json(shape)})`;
const meta=(d:any)=>({draft_id:d.draft_id,form_kind:d.form_kind,form_label:FORM_KINDS[d.form_kind]||d.form_kind,subject_key:d.subject_key,title:d.title,client_id:d.client_id||null,project_id:d.project_id||null,client_name:d.client_name||'',project_name:d.project_name||'',saved_at:iso(d.saved_at),revision:String(d.revision)});

export async function formDraftAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['ADMIN'].includes(a.category_code))fail(403,'Saved drafts are for staff who prepare work.');
 const me=a.staff_id;
 if(p.action==='form_draft_list'){
  const rows=await tx`select d.draft_id,d.form_kind,d.subject_key,d.title,d.client_id,d.project_id,d.saved_at,d.revision,c.company_name as client_name,pr.project_name
   from erp_private.staff_form_drafts d left join erp_private.clients c on c.client_id=d.client_id left join erp_private.projects pr on pr.project_id=d.project_id
   where d.staff_id=${me} order by d.saved_at desc limit 100`;
  return {ok:true,drafts:rows.map(meta),limit:MAX_DRAFTS_PER_PERSON};
 }
 const byKey=async()=>{
  if(p.draft_id)return (await tx`select * from erp_private.staff_form_drafts where draft_id=${uuid(p.draft_id)} and staff_id=${me}`)[0];
  return (await tx`select * from erp_private.staff_form_drafts where staff_id=${me} and form_kind=${String(p.form_kind||'')} and subject_key=${String(p.subject_key||'')}`)[0];
 };
 if(p.action==='form_draft_read'){
  const d=await byKey();
  if(!d)return {ok:true,draft:null};
  await audit(tx,a,'FORM_DRAFT_RESUMED',d.draft_id,auditShape(d.form_kind,d.subject_key,d.title,d.payload));
  return {ok:true,draft:{...meta(d),payload:d.payload}};
 }
 if(p.action==='form_draft_discard'){
  const d=await byKey();
  if(!d)return {ok:true,discarded:false};
  await tx`delete from erp_private.staff_form_drafts where draft_id=${d.draft_id} and staff_id=${me}`;
  await audit(tx,a,'FORM_DRAFT_DISCARDED',d.draft_id,{...auditShape(d.form_kind,d.subject_key,d.title,null),reason:p.reason==='submitted'?'form submitted':'discarded by owner'});
  return {ok:true,discarded:true};
 }
 // form_draft_save
 const kind=String(p.form_kind||''),subject=String(p.subject_key||''),title=draftTitle(kind,p.title);
 const issues=draftIssues({kind,subject_key:subject,title});
 if(issues.length)fail(400,issues.join(' '));
 const cleaned=cleanPayload(p.payload);
 if(!cleaned.ok)fail(400,cleaned.problems.join(' '));
 let projectId:string|null=null,clientId:string|null=null;
 if(p.project_id){
  projectId=uuid(p.project_id);
  const pr=(await tx`select project_id,client_id from erp_private.projects where project_id=${projectId} and deleted_at is null`)[0];
  if(!pr)fail(404,'That engagement is not available to you.');
  clientId=pr.client_id;
 }else if(p.client_id){
  clientId=uuid(p.client_id);
  const c=(await tx`select client_id from erp_private.clients where client_id=${clientId} and deleted_at is null`)[0];
  if(!c)fail(404,'That client is not available to you.');
 }
 const existing=(await tx`select draft_id,revision from erp_private.staff_form_drafts where staff_id=${me} and form_kind=${kind} and subject_key=${subject}`)[0];
 let id:string;
 if(existing){
  id=existing.draft_id;
  await tx`update erp_private.staff_form_drafts set title=${title},payload=${tx.json(cleaned.payload)} where draft_id=${id} and staff_id=${me}`;
  if(p.explicit===true)await audit(tx,a,'FORM_DRAFT_SAVED',id,auditShape(kind,subject,title,cleaned.payload));
 }else{
  const n=(await tx`select count(*)::int as n from erp_private.staff_form_drafts where staff_id=${me}`)[0].n;
  if(n>=MAX_DRAFTS_PER_PERSON)fail(409,`You already have ${MAX_DRAFTS_PER_PERSON} saved drafts. Resume or discard some before saving another.`);
  id=(await tx`insert into erp_private.staff_form_drafts(staff_id,form_kind,subject_key,title,client_id,project_id,payload) values(${me},${kind},${subject},${title},${clientId},${projectId},${tx.json(cleaned.payload)}) returning draft_id`)[0].draft_id;
  await audit(tx,a,'FORM_DRAFT_CREATED',id,auditShape(kind,subject,title,cleaned.payload));
 }
 const saved=(await tx`select saved_at,revision from erp_private.staff_form_drafts where draft_id=${id}`)[0];
 return {ok:true,draft_id:id,saved_at:iso(saved.saved_at),revision:String(saved.revision)};
}
