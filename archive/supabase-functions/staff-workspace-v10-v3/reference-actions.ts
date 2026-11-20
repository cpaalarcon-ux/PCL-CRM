import {fail,text,uuid} from './validation.mjs';
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only Managers and the Engagement Partner may manage reference documents.');};
export async function referenceAction(tx:any,a:any,p:any){
 if(p.action==='reference_list'){leader(a);return {references:await tx`select reference_id,title,version_label,file_name,file_size_bytes,sha256,status,supersedes_id,uploaded_at,approved_at,approval_note from erp_private.reference_documents order by uploaded_at desc`};}
 if(p.action==='reference_approve'){
  leader(a);const note=text(p.approval_note,2000);if(note.length<3)fail(400,'Record the approval decision.');
  const [r]=await tx`update erp_private.reference_documents set status='Approved',approved_by=${a.staff_id},approved_at=now(),approval_note=${note} where reference_id=${uuid(p.reference_id)} and status='Awaiting review' returning reference_id`;
  if(!r)fail(409,'This reference is unavailable or already reviewed.');
  await tx`insert into erp_private.reference_access_events(reference_id,actor_id,action) values(${r.reference_id},${a.staff_id},'APPROVE')`;return {ok:true};
 }
 return undefined;
}
