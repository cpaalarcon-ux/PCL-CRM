import {fail,text,uuid,choice,date,revision} from './validation.mjs';
// S2: legal reference, regulatory calendar and legislative monitoring registers. Checks live in the database functions; this file
// validates the input and keeps the wording the person typed. Nothing here computes a deadline except through regulatory_due_date().
export const INSTRUMENTS=['Act','Regulation','Circular','Guidance','Standard','Bill','Other'];
export const LEGAL_STATUSES=['Not yet confirmed','In force','Binding direction','Guidance only','Consultation','Proposed (Bill)','Repealed'];
export const APPLIES=['DT_SACCO','NWDT_SACCO','ALL_SACCO','OTHER'];
export const VERIFICATIONS=['Unverified','Secondary source','Primary source verified'];
export const RULE_TYPES=['Unresolved','Period after year end','Fixed date each year'];
export const DIRECTIONS=['On or before','Not earlier than','On'];
export const MONITOR_TYPES=['Bill','Regulation change','Circular','Consultation','Court decision','Standard','Other'];
export const MONITOR_OUTCOMES=['No change','Changed - needs review','Action needed','Closed'];
const applies=(v:any)=>{const l=Array.isArray(v)&&v.length?v:['ALL_SACCO'];for(const x of l)choice(x,APPLIES);return [...new Set(l)];};
const int=(v:any,min:number,max:number,label:string)=>{if(v===undefined||v===null||v==='')return null;const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail(400,`${label} must be a whole number from ${min} to ${max}.`);return n;};
const optUuid=(v:any)=>v?uuid(v):null;
export async function regulatoryRead(tx:any){return (await tx`select erp_private.regulatory_register() r`)[0].r;}
export async function regulatoryAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!act.startsWith('audit_reg_'))return undefined;
 if(act==='audit_reg_read')return await regulatoryRead(tx);
 if(act==='audit_reg_reference_save'){
  const body={ref_id:optUuid(p.ref_id),ref_code:p.ref_id?undefined:text(p.ref_code,60),title:text(p.title,300),instrument_type:choice(p.instrument_type,INSTRUMENTS),citation:text(p.citation||'',500,false),issuing_body:text(p.issuing_body||'',200,false),
   legal_status:choice(p.legal_status||'Not yet confirmed',LEGAL_STATUSES),applies_to:applies(p.applies_to),summary:text(p.summary||'',2000,false),source_url:text(p.source_url||'',500,false),revision:p.ref_id?revision(p.revision):undefined};
  if(body.source_url&&!/^https?:\/\//i.test(body.source_url))fail(400,'The source address must start with http:// or https://.');
  return (await tx`select erp_private.reg_reference_save(${tx.json(body)}::jsonb) r`)[0].r;
 }
 if(act==='audit_reg_reference_verify'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can verify a legal reference.');
  return (await tx`select erp_private.reg_reference_verify(${uuid(p.ref_id)}::uuid,${choice(p.level,VERIFICATIONS)},${text(p.note||'',1000,false)},${revision(p.revision)}::bigint) r`)[0].r;
 }
 if(act==='audit_reg_calendar_save'){
  const type=choice(p.rule_type||'Unresolved',RULE_TYPES);
  const body={item_id:optUuid(p.item_id),item_code:p.item_id?undefined:text(p.item_code,60),title:text(p.title,300),reference_id:optUuid(p.reference_id),applies_to:applies(p.applies_to),as_reported:text(p.as_reported,1000),
   conflicting_wording:text(p.conflicting_wording||'',1000,false),rule_type:type,offset_months:int(p.offset_months,0,24,'Months'),offset_days:int(p.offset_days,0,366,'Days'),
   fixed_month:int(p.fixed_month,1,12,'Month'),fixed_day:int(p.fixed_day,1,31,'Day'),direction:p.direction?choice(p.direction,DIRECTIONS):null,revision:p.item_id?revision(p.revision):undefined};
  if(type==='Unresolved'){body.offset_months=null;body.offset_days=null;body.fixed_month=null;body.fixed_day=null;}
  if(type==='Period after year end'){body.fixed_month=null;body.fixed_day=null;if(body.offset_months===null&&body.offset_days===null)fail(400,'Enter the months or days after the year end.');}
  if(type==='Fixed date each year'){body.offset_months=null;body.offset_days=null;if(body.fixed_month===null||body.fixed_day===null)fail(400,'Enter the month and day.');}
  return (await tx`select erp_private.reg_calendar_save(${tx.json(body)}::jsonb) r`)[0].r;
 }
 if(act==='audit_reg_calendar_confirm'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can confirm a regulatory calendar rule.');
  return (await tx`select erp_private.reg_calendar_confirm(${uuid(p.item_id)}::uuid,${text(p.note||'',1000,false)},${revision(p.revision)}::bigint) r`)[0].r;
 }
 if(act==='audit_reg_calendar_withdraw'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can withdraw a confirmed rule.');
  return (await tx`select erp_private.reg_calendar_withdraw(${uuid(p.item_id)}::uuid,${text(p.note||'',1000,false)}) r`)[0].r;
 }
 if(act==='audit_reg_due_date'){
  const d=date(p.year_end);if(!d)fail(400,'Enter the financial year end.');
  return {due:(await tx`select erp_private.regulatory_due_date(${uuid(p.item_id)}::uuid,${d}::date) r`)[0].r};
 }
 if(act==='audit_reg_monitor_save'){
  const body={entry_id:optUuid(p.entry_id),title:text(p.title,300),item_type:choice(p.item_type,MONITOR_TYPES),source_body:text(p.source_body||'',200,false),reference_id:optUuid(p.reference_id),
   first_seen_on:date(p.first_seen_on||''),next_check_due:date(p.next_check_due||''),owner_id:optUuid(p.owner_id),note:text(p.note||'',2000,false),revision:p.entry_id?revision(p.revision):undefined};
  return (await tx`select erp_private.reg_monitor_save(${tx.json(body)}::jsonb) r`)[0].r;
 }
 if(act==='audit_reg_monitor_check'){
  return (await tx`select erp_private.reg_monitor_check(${uuid(p.entry_id)}::uuid,${choice(p.outcome,MONITOR_OUTCOMES)},${text(p.note||'',1000,false)},${date(p.next_check_due||'')}::date) r`)[0].r;
 }
 fail(400,'Unknown regulatory action.');
}
