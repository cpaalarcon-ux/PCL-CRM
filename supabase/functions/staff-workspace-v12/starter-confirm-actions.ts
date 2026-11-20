import {fail,text,uuid} from './validation.mjs';
import {STARTER_RULES,lockedStarters} from './bank-starter-rules.mjs';

// Written confirmations for bank starter rules that depend on a tax ruling (build 2788). Managers and Partners can read; only a Partner can record or withdraw.
// A Partner records WHAT THE TAX LEAD CONFIRMED IN WRITING (name, date, where it is written). Claude never records one. The rules for the table are in the
// database (20261111060000_starter_rule_confirmations.sql); these checks give friendly messages. Recording applies the rule to no client.
const ACTIONS=['bank_starter_confirm_read','bank_starter_confirm_record','bank_starter_confirm_withdraw'];
const today=()=>new Date(Date.now()+3*3600*1000).toISOString().slice(0,10);

export async function starterConfirmAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='bank_starter_confirm_read'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Starter-rule confirmations are shown to Managers and Partners.');
  const rows=await tx`select confirmation_id,rule_key,account_code,confirmed_by_name,confirmed_on,source_note,recorded_by,recorded_at,status,withdrawn_at,withdrawn_reason,revision from erp_private.starter_rule_confirmations order by recorded_at desc`;
  return {starters:lockedStarters(rows),history:rows};
 }
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can record or withdraw a Tax Lead confirmation.');
 if(p.action==='bank_starter_confirm_record'){
  const rule=STARTER_RULES.find((s:any)=>s.key===p.rule_key&&s.needs);if(!rule)fail(400,'That starter rule does not need a confirmation.');
  if(p.account_code!==rule.account_code)fail(400,'The confirmation must name the account '+rule.account_code+'.');
  const who=text(p.confirmed_by_name,120);if(who.length<2)fail(400,'Give the name of the Tax Lead who confirmed.');
  const on=String(p.confirmed_on||'').slice(0,10);if(!/^\d{4}-\d\d-\d\d$/.test(on)||Number.isNaN(Date.parse(on)))fail(400,'Give the date of the written confirmation.');
  if(on>today())fail(400,'The date of the written confirmation cannot be in the future.');
  const note=text(p.source_note,500);if(note.length<10)fail(400,'Say where the confirmation is written, for example the email and its date (at least 10 characters).');
  if(p.seen_in_writing!==true)fail(400,'Tick the box to say you have seen the Tax Lead\'s written confirmation.');
  const live=await tx`select confirmation_id from erp_private.starter_rule_confirmations where rule_key=${rule.key} and status='Confirmed'`;
  if(live.length)fail(409,'A confirmation is already recorded. Withdraw it first if it is wrong.');
  const r=await tx`insert into erp_private.starter_rule_confirmations(rule_key,account_code,confirmed_by_name,confirmed_on,source_note,recorded_by) values(${rule.key},${rule.account_code},${who},${on},${note},${a.staff_id}) returning confirmation_id,status`;
  return r[0];
 }
 if(p.action==='bank_starter_confirm_withdraw'){
  const row=(await tx`select confirmation_id,status,revision from erp_private.starter_rule_confirmations where confirmation_id=${uuid(p.confirmation_id)} for update`)[0];
  if(!row)fail(404,'That confirmation does not exist.');
  if(row.status!=='Confirmed')fail(400,'That confirmation is already withdrawn.');
  if(String(row.revision)!==String(p.revision))fail(409,'This confirmation changed. Refresh first.');
  const why=text(p.reason,500);if(why.length<10)fail(400,'Give the reason for withdrawing (at least 10 characters).');
  await tx`update erp_private.starter_rule_confirmations set status='Withdrawn',withdrawn_by=${a.staff_id},withdrawn_reason=${why} where confirmation_id=${row.confirmation_id}`;
  return {ok:true};
 }
 return undefined;
}
