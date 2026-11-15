import {fail,text,uuid,date,choice,revision} from './validation.mjs';
import {KINDS,NAMED_PRACTITIONER,WARN_DAYS,recordState,readiness} from './eligibility-rules.mjs';
// Build 2833: eligibility evidence for restricted and specialist services. A Manager or Partner records the evidence; a Partner (a different one, unless the firm has only one)
// verifies it; an expired or ended entry stops the service being activated. Table rules are in 20261116200000_service_catalogue_and_eligibility.sql.
const ACTIONS=['eligibility_read','eligibility_record','eligibility_verify','eligibility_end'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const said=(v:any,min:number,max:number,what:string)=>{const t=text(v,max);if(t.length<min)fail(400,`${what} (at least ${min} characters).`);return t;};
const nairobiToday=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
export async function eligibilityAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Eligibility evidence is for Managers and Partners.');
 const leader=['PARTNER','MANAGER'].includes(a.category_code);
 if(p.action==='eligibility_read'){
  const today=nairobiToday();
  const services=await tx`select s.service_code,s.service_name,s.service_group,sp.engine_state,sp.note from erp_private.services s join erp_private.service_profiles sp on sp.service_code=s.service_code where exists(select 1 from erp_private.service_eligibility_requirements r where r.service_code=s.service_code) order by s.service_group,s.service_name`;
  const reqs=await tx`select service_code,kind from erp_private.service_eligibility_requirements order by service_code,kind`;
  const recs=await tx`select e.*,erp_private.staff_name(e.staff_id) as practitioner_name,erp_private.staff_name(e.recorded_by) as recorded_by_name,erp_private.staff_name(e.verified_by) as verified_by_name,erp_private.staff_name(e.ended_by) as ended_by_name from erp_private.service_eligibility_records e order by e.service_code,e.kind,e.recorded_at desc`;
  const staff=await tx`select staff_id,full_name from erp_private.staff_members where deleted_at is null and access_status<>'Inactive' and category_code<>'ADMIN' order by full_name`;
  const records=recs.map((r:any)=>({...r,valid_from:day(r.valid_from),expires_on:day(r.expires_on),...recordState({...r,valid_from:day(r.valid_from),expires_on:day(r.expires_on)},today)}));
  return {today,warn_days:WARN_DAYS,kinds:KINDS,named_practitioner:NAMED_PRACTITIONER,me:a.staff_id,can_record:leader,can_verify:a.category_code==='PARTNER',staff,
   services:services.map((s:any)=>{const requirements=reqs.filter((r:any)=>r.service_code===s.service_code).map((r:any)=>r.kind),mine=records.filter((r:any)=>r.service_code===s.service_code);
    return {...s,requirements,records:mine,firm_readiness:readiness({requirements:requirements.filter((k:string)=>!NAMED_PRACTITIONER.includes(k)),records:mine,today}),named_kinds:requirements.filter((k:string)=>NAMED_PRACTITIONER.includes(k))};})};
 }
 if(!leader)fail(403,'Only a Manager or Partner records eligibility evidence.');
 if(p.action==='eligibility_record'){
  const service=text(p.service_code,20),kind=choice(String(p.kind||''),KINDS);
  if(!(await tx`select 1 from erp_private.service_eligibility_requirements where service_code=${service} and kind=${kind}`).length)fail(400,'That service does not need this kind of evidence.');
  const staffId=NAMED_PRACTITIONER.includes(kind)?uuid(p.staff_id):null,from=date(p.valid_from),to=date(p.expires_on);
  if(!from||!to)fail(400,'Enter the first and last day the evidence covers.');if(to<=from)fail(400,'The expiry date must be after the start date.');
  const rec=one(await tx`insert into erp_private.service_eligibility_records(service_code,kind,staff_id,authority,reference,evidence_note,valid_from,expires_on,recorded_by) values(${service},${kind},${staffId},${said(p.authority,2,200,'Name the authority or body')},${said(p.reference,3,200,'Give the reference or number')},${said(p.evidence_note,10,1000,'Say what evidence was seen and where it is kept')},${from},${to},${a.staff_id}) returning record_id`);
  return {recorded:true,record_id:rec.record_id};
 }
 const rec=one(await tx`select record_id,status,revision,recorded_by from erp_private.service_eligibility_records where record_id=${uuid(p.record_id)}`);
 if(String(rec.revision)!==revision(p.revision))fail(409,'The record changed. Refresh first.');
 if(p.action==='eligibility_verify'){
  if(a.category_code!=='PARTNER')fail(403,'A Partner verifies eligibility evidence.');if(rec.status!=='Recorded')fail(409,'Only newly recorded evidence is verified.');
  const own=rec.recorded_by===a.staff_id;
  await tx`update erp_private.service_eligibility_records set status='Verified',verified_by=${a.staff_id},verified_at=now(),verification_note=${said(p.verification_note,10,1000,'Say what you checked it against')},sole_partner_verify=${own} where record_id=${rec.record_id}`;
  return {verified:true,sole_partner:own};
 }
 if(rec.status==='Ended')fail(409,'This entry has already been ended.');
 await tx`update erp_private.service_eligibility_records set status='Ended',ended_by=${a.staff_id},ended_at=now(),ended_reason=${said(p.reason,5,500,'Say why it is ended')} where record_id=${rec.record_id}`;
 return {ended:true};
}
