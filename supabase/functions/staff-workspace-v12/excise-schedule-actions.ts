import {fail,text,uuid,revision,date as dateOnly} from './validation.mjs';
import {one,leader} from './suite-actions.ts';
import {stagingRates} from './testing-rates.mjs';
import {computeSchedule,reviewProblem,monthProblem,cleanLines} from './excise-schedule-rules.mjs';
import {summarySalesRows} from './period-import-actions.ts';
import {projectTaskGate,assign} from './workspace-actions.ts';

// Excise schedules (build 2794). A review working per client and month: quantities or values sold, times the dated excise rule in force. It feeds no return or filing.
// The server always works the duty out itself; a figure sent by the browser is never trusted. The rules for the table are in 20261112030000_excise_schedules.sql.
const ACTIONS=['excise_schedule_read','excise_schedule_preview','excise_schedule_save','excise_schedule_review','excise_schedule_withdraw','excise_schedule_due_state','excise_schedule_due_confirm','excise_schedule_due_fallback','excise_schedule_task_create'];
const DUE_KIND='Excise';
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const current=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This schedule changed. Refresh it before saving.');};

// All eTIMS sales recorded for the client's engagements in the month: detailed rows if there are any, else the confirmed or submitted period summaries. Net of VAT.
async function etimsSales(tx:any,cid:string,start:string,end:string){
 const projects=await tx`select project_id from erp_private.projects where client_id=${cid} and deleted_at is null`;
 let detailedRows=0,net=0,summaryNet=0,summaryRows=0;
 for(const pr of projects){
  const rows=await tx`select r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pr.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset='Sales' and b.period_start>=${start} and b.period_end<=${end}`;
  detailedRows+=rows.length;for(const r of rows)net+=Number(r.normalized?.amount||0);
  const sums=await summarySalesRows(tx,pr.project_id,start,end,{includeSubmitted:true,sourceTypes:['ETIMS']});
  summaryRows+=sums.length;for(const r of sums)summaryNet+=Number(r.normalized?.amount||0);
 }
 if(detailedRows)return {available:true,net:Math.round(net*100)/100,source:'detailed eTIMS sales rows'};
 if(summaryRows)return {available:true,net:Math.round(summaryNet*100)/100,source:'eTIMS period summaries'};
 return {available:false,net:0,source:null};
}
async function work(tx:any,cid:string,starts_on:string,ends_on:string,lines:any){
 const bad=monthProblem(starts_on,ends_on);if(bad)fail(400,bad);
 const rates=stagingRates(await tx`select * from erp_private.tax_rates where tax_type='Excise duty' and status in('Approved','Testing') and deleted_at is null`,Deno.env.get('SUPABASE_URL')||'');
 const profile=(await tx`select * from erp_private.client_tax_profiles where client_id=${cid} and status='Verified' and deleted_at is null and effective_from<=${starts_on} and effective_to>=${ends_on} order by effective_from desc limit 1`)[0]||null;
 return computeSchedule({starts_on,ends_on,lines,rates,profile,sales:await etimsSales(tx,cid,starts_on,ends_on)});
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
 if(p.action.startsWith('excise_schedule_due_')||p.action==='excise_schedule_task_create'){
  const sch=one(await tx`select schedule_id,client_id,starts_on,ends_on,status from erp_private.excise_schedules where schedule_id=${uuid(p.schedule_id)}`),start=day(sch.starts_on),end=day(sch.ends_on);
  const state=async()=>(await tx`select erp_private.period_due_state(${sch.client_id}::uuid,${start}::date,${end}::date,${DUE_KIND}) as s`)[0].s;
  const task=async()=>(await tx`select l.link_id,l.task_id,l.due_basis,t.task_name,t.status,t.due_at,t.project_id from erp_private.excise_schedule_tasks l join erp_private.tasks t on t.task_id=l.task_id where l.schedule_id=${sch.schedule_id}`)[0]||null;
  if(p.action==='excise_schedule_due_state')return {state:await state(),task:await task()};
  if(sch.status==='Withdrawn')fail(400,'This schedule is withdrawn.');
  if(p.action==='excise_schedule_due_confirm'){
   await tx`select erp_private.period_due_confirm(${sch.client_id}::uuid,${start}::date,${end}::date,${DUE_KIND},${day(p.kra_due_date)}::date,${p.itax_confirmed===true||p.itax_confirmed==='on'})`;
   return {ok:true,state:await state(),task:await task()};
  }
  if(p.action==='excise_schedule_due_fallback'){
   await tx`select erp_private.period_due_fallback(${sch.client_id}::uuid,${start}::date,${end}::date,${DUE_KIND},${text(p.fallback_reason||'',500,false)})`;
   return {ok:true,state:await state(),task:await task()};
  }
  // The return task. It needs a confirmed KRA due date, or the task-date fallback with a date the person chooses. The task is made through the same project gate
  // and assignment rules as every other task, in an engagement of this client.
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Partner, Manager or Supervisor creates the return task.');
  if(await task())fail(409,'This schedule already has a return task.');
  const st=await state();if(!st||!st.status)fail(400,'Confirm the KRA due date for this month first (or choose the task-date fallback). The task takes its date from that.');
  let due=st.status==='CONFIRMED'?day(st.kra_due_date):dateOnly(p.due_date);
  if(!due)fail(400,'The task-date fallback is in use for this month. Choose the task due date.');
  if(st.status==='CONFIRMED'&&p.due_date&&dateOnly(p.due_date)!==due)fail(400,'The task takes the confirmed KRA due date.');
  const pid=uuid(p.project_id),sid=uuid(p.assigned_to);
  const project=one(await tx`select client_id,handling_firm_id,status from erp_private.projects where project_id=${pid} and deleted_at is null`);
  if(project.client_id!==sch.client_id)fail(400,'Choose an engagement of this client.');
  if(project.status==='Archived')fail(400,'Choose an open engagement.');
  const gate=await projectTaskGate(tx,pid,project.client_id,due);if(!gate.ready)fail(400,gate.reason);
  await assign(tx,pid,project.handling_firm_id,sid);
  const client=one(await tx`select company_name from erp_private.clients where client_id=${sch.client_id}`);
  const name=`Excise return · ${start.slice(0,7)} · ${client.company_name}`.slice(0,200);
  const t=await tx`insert into erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,period_start,period_end,template_key) values(${pid},${sid},${name},${`File and pay the excise return for ${start.slice(0,7)}. Working: excise schedule ${sch.schedule_id}. Due ${due} (${st.status==='CONFIRMED'?'KRA due date confirmed against the iTax calendar':'task date chosen because the KRA date is not confirmed'}).`},${due+'T17:00:00+03:00'},${'excise:'+start.slice(0,7)},${start},${end},'excise-return') on conflict(project_id,recurring_key) do nothing returning task_id`;
  if(!t.length)fail(409,'This engagement already has an excise return task for that month.');
  await tx`insert into erp_private.excise_schedule_tasks(schedule_id,task_id,due_basis,created_by) values(${sch.schedule_id},${t[0].task_id},${st.status},${a.staff_id})`;
  return {ok:true,task:await task(),state:st};
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
