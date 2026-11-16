import {mergeDates,sameDates} from './practice-rules.mjs';
// Build 2845: the dates in force for service template versions (the latest record in service_template_dates), and recording a new one.
// Table and guards: 20261118120000_service_template_dates.sql.
const day=(v:any)=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):null;
export async function currentDates(tx:any,templateId?:string):Promise<Map<string,any>>{
 const rows=templateId
  ?await tx`select distinct on (d.template_id) d.template_id,d.effective_from::text effective_from,d.last_reviewed::text last_reviewed,d.note,d.recorded_at,erp_private.staff_name(d.recorded_by) recorded_by_name from erp_private.service_template_dates d where d.template_id=${templateId} order by d.template_id,d.recorded_at desc,d.date_id desc`
  :await tx`select distinct on (d.template_id) d.template_id,d.effective_from::text effective_from,d.last_reviewed::text last_reviewed,d.note,d.recorded_at,erp_private.staff_name(d.recorded_by) recorded_by_name from erp_private.service_template_dates d order by d.template_id,d.recorded_at desc,d.date_id desc`;
 return new Map(rows.map((r:any)=>[r.template_id,{effective_from:day(r.effective_from),last_reviewed:day(r.last_reviewed),dates_note:r.note||null,dates_recorded_by_name:r.recorded_by_name||null,dates_recorded_at:r.recorded_at||null}]));
}
export const noDates={effective_from:null,last_reviewed:null,dates_note:null,dates_recorded_by_name:null,dates_recorded_at:null};
// Records dates for one template version unless they are already what is in force. Returns the dates now in force.
export async function recordDates(tx:any,a:any,templateId:string,given:{effective_from:string|null,last_reviewed:string|null,note:string|null}){
 const cur=(await currentDates(tx,templateId)).get(templateId)||null;
 const merged=mergeDates(cur,given);
 if(sameDates(cur,merged))return {changed:false,dates:merged};
 await tx`insert into erp_private.service_template_dates(template_id,effective_from,last_reviewed,note,recorded_by) values(${templateId},${merged.effective_from},${merged.last_reviewed},${merged.note},${a.staff_id})`;
 return {changed:true,dates:merged};
}
