import {fail,text} from './validation.mjs';

// Filing deadline windows: how many days before a filing's due date it is flagged "due soon", and how many days after it the Partners are alerted.
// The values, their limits and the confirmation rules live in the database (20261110270000_filing_deadline_windows.sql); these checks give friendly messages.
// Leaders can read the matrix; only a Partner can change a value or record its confirmation. Nothing here blocks any work.
const ACTIONS=['deadline_settings_read','deadline_setting_set','deadline_setting_confirm'];
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Filing windows are shown to Managers and Partners.');};
const partnerOf=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const one=(r:any[],m='That setting does not exist.')=>{if(!r.length)fail(404,m);return r[0];};

export async function deadlineAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='deadline_settings_read'){
  leader(a);
  return {settings:await tx`select setting_key,label,int_value,rule_status,source_note,confirmed_at,revision from erp_private.deadline_settings order by setting_key`};
 }
 if(p.action==='deadline_setting_set'){
  partnerOf(a,'Only a Partner can change a filing window.');
  const row=one(await tx`select * from erp_private.deadline_settings where setting_key=${text(p.setting_key,60)}`);
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  const n=Number(p.value);if(!Number.isInteger(n))fail(400,'Enter a whole number of days.');
  await tx`update erp_private.deadline_settings set int_value=${n} where setting_key=${row.setting_key}`;
  return {ok:true};
 }
 if(p.action==='deadline_setting_confirm'){
  partnerOf(a,'Only a Partner can confirm a filing window.');
  const row=one(await tx`select * from erp_private.deadline_settings where setting_key=${text(p.setting_key,60)}`);
  if(String(row.revision)!==String(p.revision))fail(409,'This setting changed. Refresh first.');
  const note=text(p.source_note,500);if(note.length<10)fail(400,'Say who confirmed this and where it is written (at least 10 characters).');
  await tx`update erp_private.deadline_settings set rule_status='Confirmed',confirmed_by=${a.staff_id},source_note=${note} where setting_key=${row.setting_key}`;
  return {ok:true};
 }
 return undefined;
}
