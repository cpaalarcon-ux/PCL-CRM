import {fail,text,uuid,choice} from './validation.mjs';
import {validateShares,sharesState,bpToPercent} from './partner-shares-rules.mjs';
// Partners' profit shares for a partnership's ledger year (build 2872). A Manager or Partner records them from the deed; a different Partner approves.
const day=(v:any)=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);

export async function loadShareSets(tx:any,periodId:string){
 const heads=await tx`select set_id,version,document_id,source_reference,ratio_only,status,entered_by,entered_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(entered_by) entered_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_partner_share_sets where period_id=${periodId} order by version desc`;
 const withLines=async(h:any)=>h?{...h,lines:(await tx`select partner_name,share_bp from erp_private.period_partner_share_lines where set_id=${h.set_id} order by lower(partner_name)`).map((x:any)=>({partner_name:x.partner_name,share_bp:Number(x.share_bp)}))}:null;
 return {heads,approved:await withLines(heads.find((h:any)=>h.status==='Approved')),draft:await withLines(heads.find((h:any)=>h.status==='Draft'))};
}
// What the annual pack needs: none, draft or approved, and the approved lines.
export async function shareStateFor(tx:any,periodId:string){
 const s=await loadShareSets(tx,periodId),st=sharesState({approved:s.approved,draft:s.draft});
 return {status:st.status,lines:st.status==='approved'?st.set.lines:[],set:st.set};
}
async function isPartnership(tx:any,clientId:string){
 return (await tx`select legal_entity_type from erp_private.clients where client_id=${clientId}`)[0]?.legal_entity_type==='Partnership';
}
export async function partnerSharesRead(tx:any,a:any,l:any){
 if(!(await isPartnership(tx,l.client_id)))return {eligible:false,message:'Profit shares are recorded for a partnership. This client is not recorded as one.'};
 const s=await loadShareSets(tx,l.period_id);
 const docs=await tx`select document_id,doc_ref,file_name from erp_private.documents where client_id=${l.client_id} and deleted_at is null order by uploaded_at desc limit 200`;
 const show=(h:any)=>h&&{set_id:h.set_id,version:h.version,status:h.status,document_id:h.document_id,source_reference:h.source_reference,entered_name:h.entered_name,reviewed_name:h.reviewed_name,review_note:h.review_note,entered_at:h.entered_at,reviewed_at:h.reviewed_at,sole_partner_approval:h.sole_partner_approval,lines:h.lines.map((x:any)=>({partner_name:x.partner_name,share_bp:x.share_bp,percent:bpToPercent(x.share_bp)}))};
 const mine=!!s.draft&&s.draft.entered_by===a.staff_id;
 return {eligible:true,approved:show(s.approved),draft:show(s.draft),history:s.heads.map((h:any)=>({set_id:h.set_id,version:h.version,status:h.status,entered_name:h.entered_name,reviewed_name:h.reviewed_name,reviewed_at:h.reviewed_at})),
  documents:docs.map((d:any)=>({document_id:d.document_id,doc_ref:d.doc_ref,file_name:d.file_name})),
  can_record:isLeader(a)&&l.status==='Open',can_review:a.category_code==='PARTNER'&&l.status==='Open'&&!!s.draft,drafted_by_me:mine};
}
export async function partnerSharesSave(tx:any,a:any,l:any,p:any){
 if(!isLeader(a))fail(403,'A Manager or Partner records the partners’ profit shares.');
 if(l.status!=='Open')fail(409,'This ledger year is closed. Its profit shares can no longer be changed.');
 if(!(await isPartnership(tx,l.client_id)))fail(400,'Profit shares are recorded for a partnership only.');
 if(p.ratio_only!==true)fail(400,'Confirm that the deed shares profit and loss in these ratios, with no partner salary or interest on capital first. A deed that does anything else cannot be recorded here yet.');
 const v=validateShares(Array.isArray(p.partners)?p.partners.slice(0,40):[]);
 if(!v.ok)fail(400,v.problems[0]+(v.problems.length>1?` (${v.problems.length-1} more)`:''));
 const documentId=p.document_id?uuid(p.document_id):null,ref=p.source_reference?text(p.source_reference,500).trim():null;
 if(!documentId&&(!ref||ref.length<10))fail(400,'Choose the partnership deed from the client’s documents, or name it with its date (at least 10 characters).');
 if(documentId&&!(await tx`select 1 from erp_private.documents where document_id=${documentId} and client_id=${l.client_id} and deleted_at is null`).length)fail(400,'That document does not belong to this client.');
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':partner-shares'},0))`;
 await tx`update erp_private.period_partner_share_sets set status='Superseded' where period_id=${l.period_id} and status='Draft'`;
 const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_partner_share_sets where period_id=${l.period_id}`)[0].v);
 const head=(await tx`insert into erp_private.period_partner_share_sets(period_id,project_id,client_id,version,document_id,source_reference,ratio_only,entered_by) values(${l.period_id},${l.project_id},${l.client_id},${ver},${documentId},${ref},true,${a.staff_id}) returning set_id,version,status`)[0];
 for(const x of v.lines)await tx`insert into erp_private.period_partner_share_lines(set_id,project_id,partner_name,share_bp) values(${head.set_id},${l.project_id},${x.partner_name},${x.share_bp})`;
 return {...head,partners:v.lines.length};
}
export async function partnerSharesReview(tx:any,a:any,l:any,p:any){
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve or return the profit shares.');
 if(l.status!=='Open')fail(409,'This ledger year is closed.');
 const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
 await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':partner-shares'},0))`;
 const s=await loadShareSets(tx,l.period_id),draft=s.draft;
 if(!draft||draft.set_id!==uuid(p.set_id))fail(409,'These profit shares have changed. Refresh and review the latest draft.');
 if(decision==='Returned'){
  if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`update erp_private.period_partner_share_sets set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where set_id=${draft.set_id}`;
  return {status:'Returned'};
 }
 const own=draft.entered_by===a.staff_id;
 if(own&&p.sole_partner_approval!==true)fail(403,'A different Partner approves profit shares you recorded. If you are your firm’s only Partner, confirm that when you approve.');
 await tx`update erp_private.period_partner_share_sets set status='Superseded' where period_id=${l.period_id} and status='Approved'`;
 await tx`update erp_private.period_partner_share_sets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where set_id=${draft.set_id}`;
 return {status:'Approved',version:draft.version,sole_partner_approval:own};
}
export const partnerSharesAction=async(tx:any,a:any,l:any,p:any)=>{
 if(p.action==='ledger_partner_shares_read')return await partnerSharesRead(tx,a,l);
 if(p.action==='ledger_partner_shares_save')return await partnerSharesSave(tx,a,l,p);
 if(p.action==='ledger_partner_shares_review')return await partnerSharesReview(tx,a,l,p);
 return undefined;
};
void day;
