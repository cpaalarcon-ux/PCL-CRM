import {fail,text,uuid,revision} from './validation.mjs';
import {one,leader} from './suite-actions.ts';
import {stagingRates} from './testing-rates.mjs';
import {computeSchedule,reviewProblem,monthProblem,cleanLines} from './excise-schedule-rules.mjs';

// Excise schedules (build 2794). A review working per client and month: quantities or values sold, times the dated excise rule in force. It feeds no return or filing.
// The server always works the duty out itself; a figure sent by the browser is never trusted. The rules for the table are in 20261112030000_excise_schedules.sql.
const ACTIONS=['excise_schedule_read','excise_schedule_preview','excise_schedule_save','excise_schedule_review','excise_schedule_withdraw'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const current=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This schedule changed. Refresh it before saving.');};

async function work(tx:any,cid:string,starts_on:string,ends_on:string,lines:any){
 const bad=monthProblem(starts_on,ends_on);if(bad)fail(400,bad);
 const rates=stagingRates(await tx`select * from erp_private.tax_rates where tax_type='Excise duty' and status in('Approved','Testing') and deleted_at is null`,Deno.env.get('SUPABASE_URL')||'');
 const profile=(await tx`select * from erp_private.client_tax_profiles where client_id=${cid} and status='Verified' and deleted_at is null and effective_from<=${starts_on} and effective_to>=${ends_on} order by effective_from desc limit 1`)[0]||null;
 return computeSchedule({starts_on,ends_on,lines,rates,profile});
}

export async function exciseScheduleAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Excise schedules are prepared by staff with client access.');
 const cid=p.client_id?uuid(p.client_id):null;
 if(p.action==='excise_schedule_read'){
  if(!cid)fail(400,'Choose the client.');
  one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  return {schedules:await tx`select s.schedule_id,s.client_id,s.starts_on,s.ends_on,s.inputs,s.result,s.total_duty::text,s.rules_status,s.status,s.created_by,pb.full_name as prepared_by_name,s.created_at,s.reviewed_by,rb.full_name as reviewed_by_name,s.reviewed_at,s.review_note,s.withdrawn_at,s.withdrawn_reason,s.revision from erp_private.excise_schedules s left join erp_private.staff_members pb on pb.staff_id=s.created_by left join erp_private.staff_members rb on rb.staff_id=s.reviewed_by where s.client_id=${cid} order by s.starts_on desc,s.created_at desc`};
 }
 if(p.action==='excise_schedule_preview'||p.action==='excise_schedule_save'){
  if(!cid)fail(400,'Choose the client.');
  one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  const starts=day(p.starts_on),ends=day(p.ends_on),result=await work(tx,cid,starts,ends,p.lines);
  if(p.action==='excise_schedule_preview')return {result};
  const lines=cleanLines(p.lines,starts,ends);
  if(p.schedule_id){
   const old=one(await tx`select * from erp_private.excise_schedules where schedule_id=${uuid(p.schedule_id)} and client_id=${cid} for update`);current(old,p);
   if(old.status!=='Draft')fail(400,'Only a draft schedule can be edited. Withdraw a reviewed schedule and prepare a new one.');
   if(day(old.starts_on)!==starts||day(old.ends_on)!==ends)fail(400,'The month of a saved schedule cannot change. Prepare a new schedule for another month.');
   const changed=await tx`update erp_private.excise_schedules set inputs=${tx.json(lines)},result=${tx.json(result)},total_duty=${result.total_duty},rules_status=${result.rules_status} where schedule_id=${old.schedule_id} returning schedule_id`;
   if(!changed.length)fail(403,'This schedule is not editable by your account.');
   return {ok:true,schedule_id:old.schedule_id,result};
  }
  const live=await tx`select schedule_id from erp_private.excise_schedules where client_id=${cid} and starts_on=${starts} and status<>'Withdrawn'`;
  if(live.length)fail(409,'This client already has a schedule for that month. Open it, or withdraw it first.');
  const r=await tx`insert into erp_private.excise_schedules(client_id,starts_on,ends_on,inputs,result,total_duty,rules_status,created_by) values(${cid},${starts},${ends},${tx.json(lines)},${tx.json(result)},${result.total_duty},${result.rules_status},${a.staff_id}) returning schedule_id`;
  return {ok:true,schedule_id:r[0].schedule_id,result};
 }
 const old=one(await tx`select * from erp_private.excise_schedules where schedule_id=${uuid(p.schedule_id)} for update`);current(old,p);
 if(p.action==='excise_schedule_review'){
  leader(a);const note=text(p.review_note||'',500,false).trim();if(note.length<10)fail(400,'Say what you checked, for example the sales records the quantities agree to (at least 10 characters).');
  if(p.confirmed!==true)fail(400,'Tick the box to confirm the quantities or values agree to the sales records.');
  const fresh=await work(tx,old.client_id,day(old.starts_on),day(old.ends_on),old.inputs);
  const problem=reviewProblem(old,fresh,a);if(problem)fail(400,problem);
  const changed=await tx`update erp_private.excise_schedules set status='Reviewed',inputs=${tx.json(old.inputs)},result=${tx.json(fresh)},total_duty=${fresh.total_duty},rules_status=${fresh.rules_status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where schedule_id=${old.schedule_id} returning schedule_id`;
  if(!changed.length)fail(403,'This schedule is not reviewable by your account.');
  return {ok:true,result:fresh};
 }
 if(p.action==='excise_schedule_withdraw'){
  leader(a);const reason=text(p.reason||'',500,false).trim();if(reason.length<10)fail(400,'Give the reason for withdrawing this schedule (at least 10 characters).');
  if(old.status==='Withdrawn')fail(400,'This schedule is already withdrawn.');
  await tx`update erp_private.excise_schedules set status='Withdrawn',withdrawn_by=${a.staff_id},withdrawn_at=now(),withdrawn_reason=${reason} where schedule_id=${old.schedule_id}`;
  return {ok:true};
 }
}
