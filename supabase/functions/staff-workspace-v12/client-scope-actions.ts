import {fail,text,uuid,date} from './validation.mjs';
// Build 2864: engagement scope. Pure rules are in client-scope-rules.mjs; the database refuses out-of-scope work whichever screen it comes from
// (20261121160000_engagement_scope.sql). A client with no scope recorded is not gated yet, and the screens say so rather than guessing a date.
import {scopeProblem,overrideProblem,backdatedScope,preEngagementNote} from './client-scope-rules.mjs';
const ACTIONS=['client_scope_read','client_scope_record','client_scope_override_request','client_scope_override_decide','client_scope_queue'];
const day=(v:any)=>v?(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10)):null;
const nairobi=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const REVIEW=['PARTNER','MANAGER'];

async function scopeFirm(tx:any,cid:string,firmId:any){
 const firms=await tx`select f.firm_id,f.legal_name from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=${cid} and l.deleted_at is null order by f.legal_name`;
 if(!firms.length)fail(400,'This client is not linked to a handling firm yet.');
 const fid=firmId?uuid(firmId):(firms.length===1?firms[0].firm_id:fail(400,'Choose the handling firm.'));
 if(!firms.some((f:any)=>f.firm_id===fid))fail(403,'That firm is not linked to this client.');
 return {fid,firms};
}
async function read(tx:any,a:any,cid:string){
 const client=(await tx`select client_id,company_name from erp_private.clients where client_id=${cid} and deleted_at is null`)[0];
 if(!client)fail(403,'This client is unavailable to your account.');
 const firms=await tx`select f.firm_id,f.legal_name from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.client_id=${cid} and l.deleted_at is null order by f.legal_name`;
 const scopes=await tx`select s.scope_id,s.firm_id,s.engagement_date::text,s.scope_start_date::text,s.scope_end_date::text,s.letter_document_id,s.note,s.recorded_at,s.ended_at,s.ended_reason,erp_private.aml_staff_name(s.recorded_by) as recorded_by_name from erp_private.client_engagement_scopes s where s.client_id=${cid} order by s.recorded_at desc limit 100`;
 const overrides=await tx`select o.override_id,o.firm_id,o.from_date::text,o.to_date::text,o.reason,o.status,o.requested_at,o.decided_at,o.decision_note,o.sole_partner_approval,erp_private.aml_staff_name(o.requested_by) as requested_by_name,erp_private.aml_staff_name(o.decided_by) as decided_by_name from erp_private.scope_overrides o where o.client_id=${cid} order by o.requested_at desc limit 100`;
 const commence=(await tx`select value from erp_private.client_field_facts where client_id=${cid} and field_key='commencement_date' and status<>'Superseded' order by recorded_at desc limit 1`)[0]?.value||null;
 const docs=await tx`select document_id,file_name from erp_private.documents where client_id=${cid} and category='Signed Engagement Letters' and deleted_at is null order by uploaded_at desc limit 50`;
 const live=scopes.filter((s:any)=>!s.ended_at);
 return {client,firms,scopes,live,overrides,letters:docs,notes:live.map((s:any)=>({firm_id:s.firm_id,note:preEngagementNote(commence,s.scope_start_date,s.engagement_date)})).filter((x:any)=>x.note),
  can_record:REVIEW.includes(a.category_code),can_decide:a.category_code==='PARTNER',recorded:live.length>0,
  note:'Work before the scope start is blocked unless a Partner approves a scope override for that period. Opening balances and prior-year trial balances are reference data and are never blocked. A client with no scope recorded is not gated yet.'};
}

export async function clientScopeAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'The engagement scope is kept by staff with client access.');

 if(p.action==='client_scope_queue'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner decides scope override requests.');
  const rows=await tx`select o.override_id,o.client_id,c.company_name,o.firm_id,o.from_date::text,o.to_date::text,o.reason,o.requested_at,erp_private.aml_staff_name(o.requested_by) as requested_by_name from erp_private.scope_overrides o join erp_private.clients c on c.client_id=o.client_id where o.status='Requested' order by o.requested_at limit 200`;
  return {requests:rows};
 }
 const cid=uuid(p.client_id);
 await tx`select pg_advisory_xact_lock(hashtextextended(${cid+':client-scope'},0))`;

 if(p.action==='client_scope_read')return await read(tx,a,cid);

 if(p.action==='client_scope_record'){
  if(!REVIEW.includes(a.category_code))fail(403,'A Manager or Partner records the engagement scope.');
  const {fid}=await scopeFirm(tx,cid,p.firm_id);
  const engagement=date(String(p.engagement_date||'')),start=date(String(p.scope_start_date||p.engagement_date||'')),end=p.scope_end_date?date(String(p.scope_end_date)):null;
  const bad=scopeProblem({engagement,start,end,today:nairobi()});if(bad)fail(400,bad);
  const live=(await tx`select scope_id,scope_start_date::text from erp_private.client_engagement_scopes where client_id=${cid} and firm_id=${fid} and ended_at is null`)[0];
  // A scope that starts before the appointment date, or one that replaces another, is a Partner's decision.
  if((backdatedScope(engagement,start)||live)&&a.category_code!=='PARTNER')fail(403,live?'A Partner replaces an engagement scope that is already recorded.':'A scope that starts before the engagement date is a Partner’s decision.');
  const why=String(p.reason||'').trim();
  if(live){if(why.length<5)fail(400,'A scope is already recorded. Say why it is being replaced (at least 5 characters).');await tx`update erp_private.client_engagement_scopes set ended_by=${a.staff_id},ended_at=now(),ended_reason=${why.slice(0,500)} where scope_id=${live.scope_id}`;}
  const letter=p.letter_document_id?uuid(p.letter_document_id):null;
  if(letter&&!(await tx`select 1 from erp_private.documents where document_id=${letter} and client_id=${cid} and deleted_at is null`).length)fail(400,'That document does not belong to this client.');
  await tx`insert into erp_private.client_engagement_scopes(client_id,firm_id,engagement_date,scope_start_date,scope_end_date,letter_document_id,note,recorded_by) values(${cid},${fid},${engagement},${start},${end},${letter},${p.note?text(p.note,500):null},${a.staff_id})`;
  return {ok:true,replaced:!!live,...await read(tx,a,cid)};
 }

 if(p.action==='client_scope_override_request'){
  const {fid}=await scopeFirm(tx,cid,p.firm_id);
  const from=date(String(p.from_date||'')),to=date(String(p.to_date||''));
  const reason=String(p.reason||'').trim();
  const bad=overrideProblem({from,to,reason});if(bad)fail(400,bad);
  const live=(await tx`select scope_start_date::text,scope_end_date::text from erp_private.client_engagement_scopes where client_id=${cid} and firm_id=${fid} and ended_at is null`)[0];
  if(!live)fail(400,'No engagement scope is recorded for this client, so nothing is blocked and no override is needed.');
  if(!(await tx`select erp_private.scope_block(${cid},${fid},${from},${to}) as b`)[0].b)fail(400,'That period is already inside the engagement scope or covered by an approved override.');
  const dup=(await tx`select override_id from erp_private.scope_overrides where client_id=${cid} and firm_id=${fid} and status='Requested' and from_date<=${from} and to_date>=${to}`)[0];
  if(dup)return {ok:true,already:true,override_id:dup.override_id};
  const r=(await tx`insert into erp_private.scope_overrides(client_id,firm_id,from_date,to_date,reason,requested_by) values(${cid},${fid},${from},${to},${reason.slice(0,500)},${a.staff_id}) returning override_id`)[0];
  return {ok:true,already:false,override_id:r.override_id};
 }

 if(p.action==='client_scope_override_decide'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner decides a scope override.');
  const oid=uuid(p.override_id),decision=String(p.decision||'');if(!['Approve','Reject'].includes(decision))fail(400,'Choose Approve or Reject.');
  const o=(await tx`select * from erp_private.scope_overrides where override_id=${oid} and client_id=${cid} for update`)[0];
  if(!o)fail(403,'This request is unavailable to your account.');
  if(o.status!=='Requested')fail(409,'This request has already been decided.');
  const note=String(p.note||'').trim();if(decision==='Reject'&&note.length<3)fail(400,'Say why it is rejected (at least 3 characters).');
  // The person who asked does not approve it, except a Partner who is their firm's only Partner; that is recorded on the request.
  let sole=false;
  if(o.requested_by===a.staff_id){sole=(await tx`select erp_private.sole_active_partner() as sole`)[0]?.sole===true;if(!sole)fail(403,'A different Partner decides a request you made, unless you are your firm’s only Partner.');}
  await tx`update erp_private.scope_overrides set status=${decision==='Approve'?'Approved':'Rejected'},decided_by=${a.staff_id},decided_at=now(),decision_note=${note?note.slice(0,500):null},sole_partner_approval=${sole} where override_id=${oid}`;
  return {ok:true,status:decision==='Approve'?'Approved':'Rejected',sole_partner_approval:sole};
 }
}
