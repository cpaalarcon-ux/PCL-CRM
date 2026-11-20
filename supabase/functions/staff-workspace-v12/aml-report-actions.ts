import {fail,text,uuid,date} from './validation.mjs';
// Build 2865: the restricted store for internal suspicious-activity concerns, and the firm's annual compliance report.
// Any staff member raises a concern and is told only its reference: they are never shown what happens to it (the concern is not discussed with the client or
// the person who raised it). Only the MLRO reads or decides, through database functions that write an access-log row every time, including a refused attempt.
// A refused attempt therefore comes back as {denied:true} and not as an error: an error would roll the log row back.
const ACTIONS=['concern_raise','sar_menu','sar_list','sar_read','sar_event','sar_log','sar_annual_read','sar_annual_add','sar_annual_move'];
const DENIED={denied:true,note:'This area is for the appointed MLRO. The attempt has been recorded.'};
const day=(v:any)=>v?(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10)):null;
const nairobi=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const EVENT_TYPES=['Under review','Reported to FRC','Closed without report','Note'];
export async function amlReportAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='concern_raise'){
  const summary=text(p.summary,4000).trim();if(summary.length<20)fail(400,'Describe what you saw, in at least 20 characters. Give facts: who, what, when, and why it seemed unusual.');
  const client=p.client_id?uuid(p.client_id):null;
  const r=(await tx`select erp_private.aml_report_raise(${client},${summary}) as r`)[0].r;
  return {ok:true,ref:r.ref,note:'Your concern has been passed to the MLRO in confidence. Keep the reference. Do not discuss it with the client or with colleagues.'};
 }
 const mlro=!!(await tx`select erp_private.is_mlro() as ok`)[0].ok;
 if(p.action==='sar_menu')return {mlro};
 if(p.action==='sar_list'){const r=(await tx`select erp_private.aml_report_list() as r`)[0].r;return r.denied?DENIED:r;}
 if(p.action==='sar_read'){const r=(await tx`select erp_private.aml_report_read(${uuid(p.report_id)}) as r`)[0].r;return r.denied?DENIED:r;}
 if(p.action==='sar_log'){const r=(await tx`select erp_private.aml_report_log(200) as r`)[0].r;return r.denied?DENIED:r;}
 if(p.action==='sar_event'){
  const type=String(p.event_type||'');if(!EVENT_TYPES.includes(type))fail(400,'Choose what happened.');
  const note=p.note?text(p.note,2000).trim():'',frc=p.frc_reference?text(p.frc_reference,100).trim():'',on=p.reported_on?date(String(p.reported_on)):null;
  if(type==='Reported to FRC'){if(frc.length<3)fail(400,'Enter the reference the Financial Reporting Centre gave you.');if(!on)fail(400,'Enter the date it was reported.');if(on>nairobi())fail(400,'The date reported cannot be in the future.');}
  if(['Closed without report','Note'].includes(type)&&note.length<(type==='Note'?3:10))fail(400,type==='Note'?'Write the note.':'Say why no report is made (at least 10 characters).');
  const r=(await tx`select erp_private.aml_report_event(${uuid(p.report_id)},${type},${note||null},${frc||null},${on}) as r`)[0].r;return r.denied?DENIED:r;
 }
 // ---------- Annual compliance report ----------
 if(['PARTNER','MANAGER'].includes(a.category_code)===false&&!mlro)fail(403,'The annual compliance report is kept by the MLRO.');
 await tx`select erp_private.aml_annual_ensure()`;
 const rows=async()=>await tx`select r.annual_id,r.firm_id,f.legal_name as firm_name,r.covers_year,r.due_on::text as due_on,r.status,r.assigned_to,erp_private.aml_staff_name(r.assigned_to) as assigned_name,r.prepared_at,r.submitted_on::text as submitted_on,r.receipt_reference,r.note,erp_private.aml_staff_name(r.submitted_by) as submitted_by_name from erp_private.aml_annual_reports r join erp_private.firms f on f.firm_id=r.firm_id order by r.covers_year desc,f.legal_name`;
 const view=async()=>{const today=nairobi();return {mlro,today,reports:(await rows()).map((r:any)=>({...r,overdue:r.status!=='Submitted'&&r.due_on<today,days_left:Math.round((Date.parse(r.due_on)-Date.parse(today))/86400000)})),
  rule:'The practice rule: an annual compliance report is opened for each firm on 1 January, for the year just ended, and is due on 31 January. It is assigned to the MLRO. Submission is recorded here with the reference the regulator gave. This record does not file anything.'};};
 if(p.action==='sar_annual_read')return await view();
 if(!mlro)fail(403,'Only the appointed MLRO or an Engagement Partner does this. An Engagement Partner appoints the MLRO under Staff → Additional rights.');
 if(p.action==='sar_annual_add'){
  const year=Number(p.covers_year);if(!Number.isInteger(year))fail(400,'Choose the year the report covers.');
  try{await tx`select erp_private.aml_annual_add(${uuid(p.firm_id)},${year})`;}catch(e:any){if(String(e?.code)==='23505')fail(409,'That report already exists.');throw e;}
  return {ok:true,...await view()};
 }
 if(p.action==='sar_annual_move'){
  const status=String(p.status||'');if(!['Prepared','Submitted'].includes(status))fail(400,'Choose Prepared or Submitted.');
  const on=p.submitted_on?date(String(p.submitted_on)):null,rc=p.receipt_reference?text(p.receipt_reference,100).trim():'',note=p.note?text(p.note,1000).trim():'';
  if(status==='Submitted'){if(!on)fail(400,'Enter the date it was submitted.');if(on>nairobi())fail(400,'The date submitted cannot be in the future.');if(rc.length<3)fail(400,'Enter the reference the regulator gave you.');}
  await tx`select erp_private.aml_annual_move(${uuid(p.annual_id)},${status},${note||null},${rc||null},${on})`;
  return {ok:true,...await view()};
 }
}
