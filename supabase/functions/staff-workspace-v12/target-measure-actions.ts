import {fail,text,uuid,choice} from './validation.mjs';
import {ACTIVITIES,METHODS,TARGET_PCT,PERIODS_NEEDED,entryIssues,summarise} from './target-measure-rules.mjs';
// Build 2835: the register that measures the 95% reduction target. Entries are never edited: one is voided with a reason and entered again. Table rules are in
// 20261116230000_payroll_access_log_and_target_register.sql.
const ACTIONS=['target_measure_read','target_measure_record','target_measure_void'];
export const isTargetAction=(a:string)=>ACTIONS.includes(a);
const num=(v:any)=>{const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:NaN;};
const said=(v:any,min:number,max:number,what:string)=>{const t=text(v,max);if(t.length<min)fail(400,`${what} (at least ${min} characters).`);return t;};
export async function targetMeasureAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'The measurement register is kept by Supervisors, Managers and Partners.');
 if(p.action==='target_measure_read'){
  const rows=await tx`select m.*,c.company_name,erp_private.staff_name(m.recorded_by) as recorded_by_name,erp_private.staff_name(m.voided_by) as voided_by_name from erp_private.target_measurements m left join erp_private.clients c on c.client_id=m.client_id order by m.recorded_at desc limit 500`;
  const clients=await tx`select client_id,company_name from erp_private.clients where deleted_at is null order by company_name limit 500`;
  const active=rows.filter((r:any)=>r.status==='Active').map((r:any)=>({...r,minutes:Number(r.minutes),rework_minutes:Number(r.rework_minutes)}));
  return {activities:ACTIVITIES,methods:METHODS,target:TARGET_PCT,periods_needed:PERIODS_NEEDED,summary:summarise(active),entries:rows.map((r:any)=>({...r,minutes:Number(r.minutes),rework_minutes:Number(r.rework_minutes),recorded_at:new Date(r.recorded_at).toISOString(),voided_at:r.voided_at?new Date(r.voided_at).toISOString():null})),clients,can_void:true};
 }
 if(p.action==='target_measure_record'){
  const kind=choice(String(p.kind||''),['Baseline','Current']),activity=choice(String(p.activity||''),ACTIVITIES),method=choice(String(p.method||''),METHODS);
  const clientId=p.client_id?uuid(p.client_id):null,minutes=num(p.minutes),rework=kind==='Current'?num(p.rework_minutes||0):0;
  const firstPass=kind==='Current'?(p.first_pass===true||p.first_pass==='true'?true:p.first_pass===false||p.first_pass==='false'?false:null):null;
  const hasBaseline=kind==='Baseline'||(await tx`select 1 from erp_private.target_measurements where kind='Baseline' and status='Active' and activity=${activity} and (client_id is null or client_id is not distinct from ${clientId}::uuid) limit 1`).length>0;
  const issues=entryIssues({activity,kind,period_label:p.period_label,minutes,method,note:p.note,first_pass:firstPass,rework_minutes:rework},{hasBaseline});
  if(Number.isNaN(rework))issues.push('Enter the rework minutes as a number.');
  if(issues.length)fail(400,issues[0]);
  const row=(await tx`insert into erp_private.target_measurements(client_id,activity,kind,period_label,minutes,method,note,first_pass,rework_minutes,missed_deadline,recorded_by) values(${clientId},${activity},${kind},${String(p.period_label)},${minutes},${method},${p.note?text(p.note,1000):null},${firstPass},${rework},${kind==='Current'&&(p.missed_deadline===true||p.missed_deadline==='true')},${a.staff_id}) returning measurement_id`)[0];
  return {recorded:true,measurement_id:row.measurement_id};
 }
 const row=(await tx`select measurement_id,status from erp_private.target_measurements where measurement_id=${uuid(p.measurement_id)}`)[0];
 if(!row)fail(404,'That entry is not available to you.');if(row.status!=='Active')fail(409,'That entry is already voided.');
 await tx`update erp_private.target_measurements set status='Voided',void_reason=${said(p.reason,10,500,'Say why it is voided')},voided_by=${a.staff_id},voided_at=now() where measurement_id=${row.measurement_id}`;
 return {voided:true};
}
