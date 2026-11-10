import {fail,uuid,text} from './validation.mjs';

// The Tax Manager role and the annual due-date rules (Settings). The rules live in the database (20261110280000_tax_manager_role_annual_rules.sql):
// a Partner assigns an active Manager as the Tax Manager of an engagement, a Partner switches the TAX_MANAGER role's APPROVE_TAX_RULES permission on (it starts off),
// and a Partner changes and confirms the annual due-date rules. Managers can read; only a Partner changes anything. Nothing here approves a tax rule.
const ACTIONS=['tax_manager_read','tax_manager_assign','tax_manager_end','tax_role_permission_set','annual_due_rule_set','annual_due_rule_confirm'];
const leader=(a:any)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The Tax Manager role is shown to Managers and Partners.');};
const partner=(a:any,m:string)=>{if(a.category_code!=='PARTNER')fail(403,m);};
const yes=(v:any)=>v===true||v==='on'||v==='true';
const num=(v:any,m:string)=>{const n=Number(v);if(v===''||v===null||v===undefined||!Number.isInteger(n))fail(400,m);return n;};
export async function taxManagerAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='tax_manager_read'){
  leader(a);
  const [permission]=await tx`select permission_key,role_code,allowed,source_note,changed_at,revision from erp_private.tax_role_permissions where permission_key='APPROVE_TAX_RULES' and role_code='TAX_MANAGER'`;
  const assignments=await tx`select e.assignment_id,e.project_id,e.staff_id,s.full_name as staff_name,pr.project_name,c.company_name,e.assigned_at,e.reason,e.ended_at,e.end_reason from erp_private.engagement_tax_managers e join erp_private.staff_members s on s.staff_id=e.staff_id join erp_private.projects pr on pr.project_id=e.project_id join erp_private.clients c on c.client_id=pr.client_id order by (e.ended_at is null) desc,e.assigned_at desc limit 200`;
  const rules=await tx`select rule_id,tax_kind,due_month_offset,external_deadline_day,internal_month_offset,internal_deadline_day,applies_from_period_end,rule_status,source_note,confirmed_at,revision from erp_private.annual_due_rules order by tax_kind,applies_from_period_end nulls first`;
  const candidates=a.category_code==='PARTNER'?await tx`select staff_id,full_name from erp_private.staff_members where category_code='MANAGER' and access_status='Active' and deleted_at is null order by full_name`:[];
  const [me]=await tx`select erp_private.tax_rules_approver() as ok`;
  return {permission,assignments,rules,candidates,i_can_approve_tax_rules:!!me?.ok};
 }
 if(p.action==='tax_manager_assign'){
  partner(a,'Only an Engagement Partner assigns the Tax Manager.');
  const [r]=await tx`select erp_private.tax_manager_assign(${uuid(p.project_id)}::uuid,${uuid(p.staff_id)}::uuid,${text(p.reason||'',500,false)}) as id`;
  return {ok:true,assignment_id:r.id};
 }
 if(p.action==='tax_manager_end'){
  partner(a,'Only an Engagement Partner ends a Tax Manager assignment.');
  await tx`select erp_private.tax_manager_end(${uuid(p.assignment_id)}::uuid,${text(p.reason||'',500,false)})`;
  return {ok:true};
 }
 if(p.action==='tax_role_permission_set'){
  partner(a,'Only an Engagement Partner changes what the Tax Manager role may do.');
  if(String(p.revision)!==String((await tx`select revision from erp_private.tax_role_permissions where permission_key='APPROVE_TAX_RULES' and role_code='TAX_MANAGER'`)[0]?.revision))fail(409,'This setting changed. Refresh first.');
  await tx`select erp_private.tax_role_permission_set(${yes(p.allowed)},${text(p.source_note||'',500,false)})`;
  return {ok:true};
 }
 const row=(await tx`select rule_id,revision from erp_private.annual_due_rules where rule_id=${uuid(p.rule_id)}`)[0];
 if(!row)fail(404,'That rule does not exist.');
 if(String(row.revision)!==String(p.revision))fail(409,'This rule changed. Refresh first.');
 if(p.action==='annual_due_rule_set'){
  partner(a,'Only a Partner can change an annual due-date rule.');
  await tx`select erp_private.annual_due_rule_set(${row.rule_id}::uuid,${num(p.due_month_offset,'Enter the months after the period end.')},${String(p.external_deadline_day??'').trim()===''?null:num(p.external_deadline_day,'Enter the day of the month, or leave it blank for the last day of the month.')},${num(p.internal_month_offset,'Enter the internal months after the period end.')},${num(p.internal_deadline_day,'Enter the internal day of the month.')})`;
  return {ok:true};
 }
 partner(a,'Only a Partner can confirm an annual due-date rule.');
 await tx`select erp_private.annual_due_rule_confirm(${row.rule_id}::uuid,${text(p.source_note||'',500,false)})`;
 return {ok:true};
}
