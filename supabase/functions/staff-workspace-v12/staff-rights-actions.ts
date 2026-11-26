import {fail,text,uuid} from './validation.mjs';
// Additional rights (for example FINANCE) are granted by an Engagement Partner to a named person with a reason
// and an end date. The rules live in the database functions, which check the Partner again.
export async function staffRightsAction(tx:any,a:any,p:any):Promise<any>{
 if(!['staff_rights_read','staff_right_grant','staff_right_revoke'].includes(p.action))return undefined;
 if(a.category_code!=='PARTNER')fail(403,'Only an Engagement Partner can manage additional rights.');
 if(p.action==='staff_rights_read'){
  const [r]=await tx`select erp_private.staff_rights_overview() as o`;
  return {...r.o,grantable:[{code:'FINANCE',label:'Finance',effect:'Record client advances, invoices and payments.'},{code:'APPROVE_TAX_RULES',label:'Tax Lead (approve tax rules)',effect:'Confirm and approve tax rules. VAT, credit and excise rules are approved by an Engagement Partner (by rank) or by a Manager who holds this right. Held by a Manager.'},{code:'TIME_BUDGET',label:'Expected task hours',effect:'See and set the expected hours on tasks, keep the list of standard hours, and see tasks that have run over. Staff doing the work are not shown expected hours. Held by a Manager; Engagement Partners hold it by rank.'},{code:'MLRO',label:'MLRO (money laundering reporting officer)',effect:'Maintains the POCAMLA lists, rates client risk, decides on client relationships and approves enhanced due diligence. Held by a Manager appointed at management level.'}],reserved:[{code:'HR',label:'HR'},{code:'SYSTEM_ADMIN',label:'System administrator'}]};
 }
 if(p.action==='staff_right_grant'){
  const reason=text(p.reason,1000,false),expires=/^\d{4}-\d{2}-\d{2}$/.test(String(p.expires_on||''))?String(p.expires_on):fail(400,'Choose the end date.');
  const [r]=await tx`select erp_private.staff_right_grant(${uuid(p.staff_id)}::uuid,${text(p.capability,30)},${reason},${expires}::date) as grant_id`;
  return {ok:true,grant_id:r.grant_id};
 }
 await tx`select erp_private.staff_right_revoke(${uuid(p.grant_id)}::uuid,${text(p.reason,1000,false)})`;
 return {ok:true};
}
