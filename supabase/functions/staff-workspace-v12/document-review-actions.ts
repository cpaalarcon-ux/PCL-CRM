import {fail,uuid,text,choice,date} from './validation.mjs';

// Per-document review state, expiring access grants and the evidence-scan stub (step 5 of the 10 Nov 2026 build order).
// The rules (reviewer is not the uploader, written comment, hash-bound review, 30-day grants, Restricted files stay closed, append-only history)
// live in the database (20261110275000_document_review.sql); the checks here give friendly messages.
// `evidence_scan` is the entry point for the planned POST /api/evidence/scan: this service has one POST endpoint that takes an `action`, so the call is
// { action: 'evidence_scan', document_id }. It always answers PENDING_MANUAL_REVIEW with no provider until a third-party scanner (for example VirusTotal
// or AWS GuardDuty) is connected. Nothing is blocked on the answer yet.
export const SCAN_PENDING='PENDING_MANUAL_REVIEW';
const ACTIONS=['document_review_list','document_review_states','document_review_submit','document_grantees','document_grant_add','document_grant_revoke','document_grants_mine','evidence_scan'];
const DECISIONS=['APPROVED','CHANGES_REQUESTED','REJECTED'];
const one=(r:any[],m='That document is unavailable to your account.')=>{if(!r.length)fail(404,m);return r[0];};
const leader=(a:any,m:string)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,m);};
const iso=(v:any)=>v instanceof Date?v.toISOString():String(v??'');

export async function documentReviewAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN'||a.category_code==='ADMIN')fail(403,'Your role does not use document review.');

 if(p.action==='document_grants_mine'){
  return {grants:await tx`select g.grant_id,g.document_id,g.reason,g.granted_at,g.expires_at,d.file_name,d.category,d.client_id,d.handling_firm_id,s.full_name granted_by_name
   from erp_private.document_access_grants g join erp_private.documents d on d.document_id=g.document_id join erp_private.staff_members s on s.staff_id=g.granted_by
   where g.grantee_id=${a.staff_id} and g.revoked_at is null and g.expires_at>now() and d.deleted_at is null order by g.expires_at`};
 }
 if(p.action==='document_review_states'){
  const ids=(Array.isArray(p.document_ids)?p.document_ids:[]).slice(0,300).map(uuid);
  if(!ids.length)return {states:[]};
  return {states:await tx`select d.document_id,
    coalesce((select r.decision from erp_private.document_reviews r where r.document_id=d.document_id and r.reviewed_sha256=d.sha256 order by r.reviewed_at desc limit 1),'NOT_REVIEWED') state,
    (select s.full_name from erp_private.document_reviews r join erp_private.staff_members s on s.staff_id=r.reviewer_id where r.document_id=d.document_id and r.reviewed_sha256=d.sha256 order by r.reviewed_at desc limit 1) reviewer,
    (select r.reviewed_at from erp_private.document_reviews r where r.document_id=d.document_id and r.reviewed_sha256=d.sha256 order by r.reviewed_at desc limit 1) reviewed_at,
    (select x.status from erp_private.document_scan_results x where x.document_id=d.document_id and x.sha256=d.sha256 order by x.requested_at desc limit 1) scan_status
   from erp_private.documents d where d.document_id=any(${ids}::uuid[]) and d.deleted_at is null`};
 }
 const docId=uuid(p.document_id);
 const d=one(await tx`select document_id,client_id,handling_firm_id,project_id,category,file_name,sha256,version,uploaded_by,uploaded_at,confidentiality,archived_at from erp_private.documents where document_id=${docId} and deleted_at is null`);

 if(p.action==='document_review_list'){
  const reviews=await tx`select r.review_id,r.decision,r.comment,r.reviewed_at,r.reviewed_sha256=${d.sha256} current_file,s.full_name reviewer from erp_private.document_reviews r join erp_private.staff_members s on s.staff_id=r.reviewer_id where r.document_id=${docId} order by r.reviewed_at desc`;
  const grants=['PARTNER','MANAGER'].includes(a.category_code)?await tx`select g.grant_id,g.reason,g.granted_at,g.expires_at,g.revoked_at,g.revoke_reason,gs.full_name grantee,bs.full_name granted_by
   from erp_private.document_access_grants g join erp_private.staff_members gs on gs.staff_id=g.grantee_id join erp_private.staff_members bs on bs.staff_id=g.granted_by where g.document_id=${docId} order by g.granted_at desc`:[];
  const scans=await tx`select scan_id,status,provider,requested_at,sha256=${d.sha256} current_file from erp_private.document_scan_results where document_id=${docId} order by requested_at desc limit 5`;
  const uploader=(await tx`select full_name from erp_private.staff_members where staff_id=${d.uploaded_by}`)[0];
  const cur=reviews.find((r:any)=>r.current_file);
  return {document:{...d,uploader:uploader?.full_name||null},state:cur?cur.decision:'NOT_REVIEWED',reviews,grants,scans,
   can:{review:['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code)&&d.uploaded_by!==a.staff_id&&!d.archived_at,grant:['PARTNER','MANAGER'].includes(a.category_code),scan:true}};
 }
 if(p.action==='document_review_submit'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'Only a Supervisor, Manager or Partner reviews a document.');
  if(d.uploaded_by===a.staff_id)fail(403,'The person who uploaded a document cannot review it. Ask a colleague.');
  const decision=choice(p.decision,DECISIONS),comment=text(p.comment,2000);
  if(comment.trim().length<10)fail(400,'Write a comment of at least 10 characters saying what you checked.');
  if(p.reviewed_sha256&&String(p.reviewed_sha256)!==d.sha256)fail(409,'A newer file replaced the one you opened. Refresh before reviewing.');
  const r=await tx`insert into erp_private.document_reviews(document_id,reviewed_sha256,decision,comment,reviewer_id) values(${docId},${d.sha256},${decision},${comment.trim()},${a.staff_id}) returning review_id`;
  return {ok:true,review_id:r[0].review_id};
 }
 if(p.action==='document_grantees'){
  leader(a,'A Manager or Partner gives access to a document.');
  return {staff:await tx`select s.staff_id,s.full_name,s.category_code from erp_private.staff_members s
   where s.deleted_at is null and s.access_status='Active' and s.category_code in('MANAGER','SUPERVISOR','ASSISTANT') and s.staff_id<>${a.staff_id}
   and exists(select 1 from erp_private.staff_firm_access x join erp_private.firms f on f.firm_id=x.firm_id where x.staff_id=s.staff_id and x.firm_id=${d.handling_firm_id} and x.deleted_at is null and f.deleted_at is null and f.is_active)
   and not exists(select 1 from erp_private.document_access_grants g where g.document_id=${docId} and g.grantee_id=s.staff_id and g.revoked_at is null and g.expires_at>now())
   order by s.full_name`};
 }
 if(p.action==='document_grant_add'){
  leader(a,'Only a Manager or Partner can give access to a document.');
  const grantee=uuid(p.grantee_id),reason=text(p.reason,2000),until=date(String(p.expires_on||''));
  if(!until)fail(400,'Choose the last day of access.');
  if(reason.trim().length<10)fail(400,'Say why this person needs the document (at least 10 characters).');
  const expires=until+'T23:59:59+03:00';
  const inserted=await tx`insert into erp_private.document_access_grants(document_id,grantee_id,granted_by,reason,expires_at) values(${docId},${grantee},${a.staff_id},${reason.trim()},${expires}::timestamptz) returning grant_id,expires_at`;
  return {ok:true,grant_id:inserted[0].grant_id,expires_at:iso(inserted[0].expires_at)};
 }
 if(p.action==='document_grant_revoke'){
  leader(a,'Only a Manager or Partner can withdraw access to a document.');
  const g=one(await tx`select grant_id,revoked_at from erp_private.document_access_grants where grant_id=${uuid(p.grant_id)} and document_id=${docId} for update`,'That access grant is unavailable.');
  if(g.revoked_at)fail(409,'This access was already withdrawn.');
  const reason=text(p.reason,2000);if(reason.trim().length<10)fail(400,'Say why the access is withdrawn (at least 10 characters).');
  await tx`update erp_private.document_access_grants set revoked_at=now(),revoked_by=${a.staff_id},revoke_reason=${reason.trim()} where grant_id=${g.grant_id}`;
  return {ok:true};
 }
 if(p.action==='evidence_scan'){
  const r=await tx`insert into erp_private.document_scan_results(document_id,sha256,status,provider,requested_by) values(${docId},${d.sha256},${SCAN_PENDING},null,${a.staff_id}) returning scan_id,requested_at`;
  return {status:SCAN_PENDING,provider:null,document_id:docId,sha256:d.sha256,scan_id:r[0].scan_id,requested_at:iso(r[0].requested_at),
   message:'No scanning service is connected yet. The file is queued for manual review; a third-party scanner will be added later.'};
 }
 return undefined;
}
