import {fail,text,uuid,choice,date} from './validation.mjs';

// Forensic restricted file. The database (20261110266000_forensic_file.sql) decides who is on a file's access list and repeats every rule below;
// these checks give friendly messages. A person who is not on a file's list gets the same "not available" answer whether the file exists or not.
// Administrators and Interns never reach this module. The file itself (evidence upload) is handled in index.ts, which then calls forensic_evidence_register.
// Rights are not in the staff rights catalogue: the access list and the lead Partner decide who may do what.
const ACTIONS=['forensic_menu','forensic_list','forensic_clients','forensic_open','forensic_get','forensic_staff_options','forensic_access_add','forensic_access_level','forensic_access_remove','forensic_lead_transfer',
 'forensic_evidence_withdraw','forensic_custody_add','forensic_finding_add','forensic_finding_withdraw','forensic_report_save','forensic_report_issue','forensic_hold_set','forensic_hold_release',
 'forensic_settings_read','forensic_setting_set','forensic_setting_confirm'];
const eligible=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code))fail(403,'Your account cannot use forensic files.');};
const partnerOf=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const one=(r:any[],m='This record is not available to your account.')=>{if(!r.length)fail(403,m);return r[0];};
const optText=(v:any,max:number)=>v?text(v,max):null;

export async function forensicAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 // The menu check never refuses: a person who is not eligible simply gets no entry.
 if(p.action==='forensic_menu'){if(!['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code))return {show:false};const r=await tx`select erp_private.forensic_menu() r`;return {show:r[0].r===true};}
 eligible(a);

 if(p.action==='forensic_list'){
  const rows=await tx`select erp_private.forensic_list() r`;
  return {cases:rows[0].r,can_open:a.category_code==='PARTNER'};
 }
 if(p.action==='forensic_clients'){
  partnerOf(a,'Only a Partner can open a forensic file.');
  const clients=await tx`select c.client_id,c.company_name from erp_private.clients c where c.deleted_at is null and erp_private.client_allowed(c.client_id) order by c.company_name limit 2000`;
  const firms=await tx`select l.client_id,f.firm_id,f.firm_code,f.legal_name from erp_private.client_firm_links l join erp_private.firms f on f.firm_id=l.firm_id where l.deleted_at is null and f.deleted_at is null and f.is_active and erp_private.client_allowed(l.client_id) order by f.firm_code`;
  return {clients,firms};
 }
 if(p.action==='forensic_open'){
  partnerOf(a,'Only a Partner can open a forensic file.');
  const title=text(p.title,200);if(title.length<5)fail(400,'Give the file a title of at least 5 characters.');
  const mandate=text(p.mandate_text,4000);if(mandate.length<20)fail(400,'Describe the mandate in at least 20 characters.');
  const day=date(String(p.mandate_date||''));if(!day)fail(400,'Enter the date of the mandate.');
  const id=crypto.randomUUID();
  const r=await tx`select erp_private.forensic_case_open(${id},${uuid(p.client_id)},${uuid(p.firm_id)},${title},${mandate},${day}) r`;
  return {ok:true,...r[0].r};
 }
 if(p.action==='forensic_get'){
  const r=await tx`select erp_private.forensic_get(${uuid(p.case_id)}) r`;
  return r[0].r;
 }
 if(p.action==='forensic_staff_options'){
  const r=await tx`select erp_private.forensic_staff_options(${uuid(p.case_id)}) r`;
  return {staff:r[0].r};
 }
 if(p.action==='forensic_access_add'){
  const level=choice(p.level,['Investigator','Viewer']);
  await tx`select erp_private.forensic_access_add(${uuid(p.case_id)},${uuid(p.staff_id)},${level})`;
  return {ok:true};
 }
 if(p.action==='forensic_access_level'){
  const level=choice(p.level,['Investigator','Viewer']);
  await tx`select erp_private.forensic_access_level(${uuid(p.case_id)},${uuid(p.staff_id)},${level})`;
  return {ok:true};
 }
 if(p.action==='forensic_access_remove'){
  const reason=text(p.reason,500);if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`select erp_private.forensic_access_remove(${uuid(p.case_id)},${uuid(p.staff_id)},${reason})`;
  return {ok:true};
 }
 if(p.action==='forensic_lead_transfer'){
  partnerOf(a,'Only the lead Partner can transfer the lead.');
  const reason=text(p.reason,500);if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`select erp_private.forensic_lead_transfer(${uuid(p.case_id)},${uuid(p.new_lead_id)},${reason})`;
  return {ok:true};
 }
 if(p.action==='forensic_evidence_withdraw'){
  const reason=text(p.reason,500);if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`select erp_private.forensic_evidence_withdraw(${uuid(p.evidence_id)},${reason})`;
  return {ok:true};
 }
 if(p.action==='forensic_custody_add'){
  const event=choice(p.event_type,['Transferred','Examined','Copied','Sealed','Returned']);
  const at=p.event_at?new Date(String(p.event_at)):null;if(at&&Number.isNaN(at.getTime()))fail(400,'Enter a valid date and time.');
  await tx`select erp_private.forensic_custody_add(${uuid(p.evidence_id)},${event},${optText(p.from_holder,200)},${optText(p.to_holder,200)},${optText(p.note,1000)},${at?at.toISOString():null})`;
  return {ok:true};
 }
 if(p.action==='forensic_finding_add'){
  const title=text(p.title,200);if(title.length<5)fail(400,'Give the finding a title of at least 5 characters.');
  const description=text(p.description,4000);if(description.length<20)fail(400,'Describe the finding in at least 20 characters.');
  const ids=Array.isArray(p.evidence_ids)?p.evidence_ids.map((x:any)=>uuid(x)):[];if(!ids.length)fail(400,'A finding must cite at least one item of evidence.');
  const r=await tx`select erp_private.forensic_finding_add(${uuid(p.case_id)},${title},${description},${tx.array(ids)}::uuid[]) r`;
  return {ok:true,...r[0].r};
 }
 if(p.action==='forensic_finding_withdraw'){
  const reason=text(p.reason,500);if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`select erp_private.forensic_finding_withdraw(${uuid(p.finding_id)},${reason})`;
  return {ok:true};
 }
 if(p.action==='forensic_report_save'){
  const body=text(p.body,100000);if(body.length<20)fail(400,'The report needs at least 20 characters.');
  const r=await tx`select erp_private.forensic_report_save(${uuid(p.case_id)},${body}) r`;
  return {ok:true,...r[0].r};
 }
 if(p.action==='forensic_report_issue'){
  partnerOf(a,'Only the lead Partner can issue a forensic report.');
  const r=await tx`select erp_private.forensic_report_issue(${uuid(p.case_id)},${p.confirm===true}) r`;
  return {ok:true,...r[0].r};
 }
 if(p.action==='forensic_hold_set'){
  const note=text(p.note,1000);if(note.length<10)fail(400,'Say what is held and why (at least 10 characters).');
  await tx`select erp_private.forensic_hold_set(${uuid(p.case_id)},${note})`;
  return {ok:true};
 }
 if(p.action==='forensic_hold_release'){
  const reason=text(p.reason,1000);if(reason.length<10)fail(400,'Give a reason of at least 10 characters.');
  await tx`select erp_private.forensic_hold_release(${uuid(p.case_id)},${reason})`;
  return {ok:true};
 }
 if(p.action==='forensic_settings_read'){
  partnerOf(a,'Only a Partner can read the forensic settings.');
  return {settings:await tx`select setting_key,label,text_value,rule_status,source_note,confirmed_at,revision from erp_private.forensic_settings order by setting_key`};
 }
 if(p.action==='forensic_setting_set'){
  partnerOf(a,'Only a Partner can change a forensic setting.');
  const row=one(await tx`select * from erp_private.forensic_settings where setting_key=${text(p.setting_key,60)}`,'That setting does not exist.');
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  const value=row.setting_key==='report_needs_verified_standard'?choice(p.value,['YES','NO']):text(p.value,300);
  if(row.setting_key==='standard_reference'&&value.length<5)fail(400,'Enter the reference in at least 5 characters.');
  await tx`update erp_private.forensic_settings set text_value=${value} where setting_key=${row.setting_key}`;
  return {ok:true};
 }
 if(p.action==='forensic_setting_confirm'){
  partnerOf(a,'Only a Partner can confirm a forensic setting.');
  const row=one(await tx`select * from erp_private.forensic_settings where setting_key=${text(p.setting_key,60)}`,'That setting does not exist.');
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  const note=text(p.source_note,500);if(note.length<10)fail(400,'Say who confirmed this and where it is written (at least 10 characters).');
  await tx`update erp_private.forensic_settings set rule_status='Confirmed',confirmed_by=${a.staff_id},source_note=${note} where setting_key=${row.setting_key}`;
  return {ok:true};
 }
 return undefined;
}
