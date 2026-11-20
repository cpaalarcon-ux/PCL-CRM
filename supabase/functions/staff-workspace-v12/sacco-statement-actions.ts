import {fail,text,uuid,choice} from './validation.mjs';
// S4: SACCO statements. The rules live in the database functions (erp_private.sacco_*); this file checks the input and passes it on.
// No SASRA figure and no regulatory caption is fixed here. A Partner approves the layout and the account map.
export const STATEMENTS=['Financial position','Income statement','Statistical','Disclosure'];
export const KINDS=['Line','Total','Statistic','Check'];
export const ROLES=['TOTAL_ASSETS','TOTAL_LIABILITIES_EQUITY','SURPLUS','EQUITY_COLUMN','SURPLUS_COLUMN','ECL_ALLOWANCE','PRUDENTIAL_PROVISION'];
export const AUTO_KEYS=['EQUITY_RECONCILES','ECL_PRUDENTIAL','CAPITAL_FIGURES'];
export const MOVE_KINDS=['Transfer to or from reserve','Dividend on shares','Shares issued or redeemed','Revaluation','Other'];
const amount=(v:any,label:string,allowNegative=false)=>{const s=String(v??'').replace(/,/g,'').trim();const re=allowNegative?/^-?\d{1,16}(\.\d{1,2})?$/:/^\d{1,16}(\.\d{1,2})?$/;if(!re.test(s))fail(400,`${label} must be a number${allowNegative?'':' of zero or more'}, with at most two decimals.`);return s;};
const strList=(v:any,max:number,pattern:RegExp,label:string):string[]=>{if(v==null||v==='')return [];if(!Array.isArray(v)||v.length>max)fail(400,`${label} must be a short list.`);return v.map((x:any)=>{const s=String(x??'').trim();if(!pattern.test(s))fail(400,`${label} has an invalid entry.`);return s;});};
export async function saccoWorkspace(tx:any,fileId:string){return (await tx`select erp_private.sacco_workspace(${fileId}::uuid) r`)[0].r;}
export async function saccoStatementAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!act.startsWith('audit_sacco_'))return undefined;
 const leader=()=>{if(!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can do this.');};
 const partner=()=>{if(a.category_code!=='PARTNER')fail(403,'Only a Partner can do this.');};
 if(act==='audit_sacco_layout_copy'){leader();const r=(await tx`select erp_private.sacco_layout_copy() id`)[0];return {ok:true,layout_id:r.id};}
 if(act==='audit_sacco_layout_line_save'){
  leader();const l=p.line||{};const kind=choice(l.kind,KINDS);
  const side=kind==='Line'?choice(l.side,['Debit','Credit']):null;
  const unit=kind==='Statistic'?choice(l.unit,['KES','Count']):null;
  const autoKey=kind==='Check'&&l.auto_key?choice(l.auto_key,AUTO_KEYS):null;
  const so=Number(l.sort_order);if(!Number.isInteger(so)||so<0||so>100000)fail(400,'Enter the order number as a whole number.');
  const data={line_code:text(String(l.line_code||'').toUpperCase(),40),statement:choice(l.statement,STATEMENTS),section:text(l.section,80),caption:text(l.caption,200),detail:text(l.detail||'',500,false),kind,side,unit,auto_key:autoKey,sort_order:so,
   total_of:kind==='Total'?strList(l.total_of,40,/^-?[A-Z]{1,3}\.[A-Z0-9_]{2,30}$/,'The total'):[],roles:strList(l.roles,7,new RegExp('^('+ROLES.join('|')+')$'),'The roles')};
  if(!/^[A-Z]{1,3}\.[A-Z0-9_]{2,30}$/.test(data.line_code))fail(400,'The line code looks like A.CASH: letters, a dot, then letters, digits or underscores.');
  return (await tx`select erp_private.sacco_layout_line_save(${uuid(p.layout_id)}::uuid,${tx.json(data)}::jsonb) r`)[0].r;
 }
 if(act==='audit_sacco_layout_line_remove'){leader();return (await tx`select erp_private.sacco_layout_line_remove(${uuid(p.layout_id)}::uuid,${text(p.line_code,40)}) r`)[0].r;}
 if(act==='audit_sacco_layout_approve'){partner();return (await tx`select erp_private.sacco_layout_approve(${uuid(p.layout_id)}::uuid,${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_sacco_map_save'){
  const items=Array.isArray(p.items)?p.items:[];if(!items.length||items.length>300)fail(400,'Choose between 1 and 300 accounts.');
  const clean=items.map((i:any)=>({audit_account_id:uuid(i?.audit_account_id),line_code:text(String(i?.line_code||''),40)}));
  return (await tx`select erp_private.sacco_map_save(${tx.json(clean)}::jsonb) r`)[0].r;
 }
 if(act==='audit_sacco_map_approve'){
  partner();const ids=(Array.isArray(p.accounts)?p.accounts:[]).map(uuid);if(!ids.length||ids.length>300)fail(400,'Choose between 1 and 300 accounts.');
  return (await tx`select erp_private.sacco_map_approve(${ids}::uuid[]) r`)[0].r;
 }
 if(act==='audit_sacco_value_save')return (await tx`select erp_private.sacco_value_save(${uuid(p.audit_file_id)}::uuid,${text(p.line_code,40)},${amount(p.amount,'The value')}::numeric,${text(p.note||'',500,false)}) r`)[0].r;
 if(act==='audit_sacco_move_save')return (await tx`select erp_private.sacco_move_save(${uuid(p.audit_file_id)}::uuid,${text(p.line_code,40)},${choice(p.kind,MOVE_KINDS)},${amount(p.amount,'The movement',true)}::numeric,${text(p.note||'',500,false)}) r`)[0].r;
 if(act==='audit_sacco_move_withdraw')return (await tx`select erp_private.sacco_move_withdraw(${uuid(p.move_id)}::uuid,${text(p.note||'',500,false)}) r`)[0].r;
 if(act==='audit_sacco_check_prepare')return (await tx`select erp_private.sacco_check_prepare(${uuid(p.audit_file_id)}::uuid,${text(p.line_code,40)},${p.applicable!==false&&p.applicable!=='false'},${text(p.note||'',1000,false)}) r`)[0].r;
 if(act==='audit_sacco_check_review'){leader();return (await tx`select erp_private.sacco_check_review(${uuid(p.audit_file_id)}::uuid,${text(p.line_code,40)},${choice(p.decision,['Accept','Return'])==='Accept'},${text(p.note||'',1000,false)}) r`)[0].r;}
 fail(400,'Unknown SACCO statements action.');
}
