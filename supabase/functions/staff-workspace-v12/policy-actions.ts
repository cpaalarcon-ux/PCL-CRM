import {fail,text} from './validation.mjs';
export const ASSISTANT_ENTRY_POLICY='ASSISTANT_DATA_ENTRY';
export async function policiesRead(tx:any){
 return await tx`select p.policy_code,p.policy_name,p.statement,p.status,p.signed_by,s.full_name signed_by_name,p.signed_at,p.revision,p.review_due_date,(select value from erp_private.system_settings where key='GO_LIVE_DATE') go_live_date from erp_private.system_policies p left join erp_private.staff_members s on s.staff_id=p.signed_by order by p.policy_code`;
}
// Assistants may enter client data only after the Partner has signed this policy in the ERP.
export async function requireAssistantEntryAuthorised(tx:any,a:any){
 if(a.category_code!=='ASSISTANT')return;
 const rows=await tx`select status from erp_private.system_policies where policy_code=${ASSISTANT_ENTRY_POLICY}`;
 if(rows.length&&rows[0].status==='Expired')fail(403,'The Assistant data entry policy has expired. A Partner must sign it again before Assistants can enter client data.');
 if(!rows.length||rows[0].status!=='Signed_Off')fail(403,'Data entry by Assistants is currently locked pending Partner authorization.');
}
export async function policyAction(tx:any,a:any,p:any):Promise<any>{
 const action=String(p.action||'');
 if(action==='go_live_save'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can set the go-live date.');
  const d=p.go_live_date?String(p.go_live_date):null;if(d&&!/^\d{4}-\d{2}-\d{2}$/.test(d))fail(400,'Choose a valid date.');
  const note=text(p.note||'',1000,false).trim();if(note.length<10)fail(400,'Record why, in at least 10 characters.');
  await tx`select erp_private.go_live_save(${d}::date,${note})`;return {ok:true};
 }
 if(action!=='policy_sign'&&action!=='policy_revoke')return undefined;
 if(a.category_code!=='PARTNER')fail(403,'Only a Partner can sign off or withdraw a policy.');
 const rows=await tx`select * from erp_private.system_policies where policy_code=${text(p.policy_code||'',60)} for update`;
 if(!rows.length)fail(404,'Policy not found.');
 const row=rows[0];if(p.revision!==undefined&&String(p.revision)!==String(row.revision))fail(409,'This policy changed. Refresh and try again.');
 if(action==='policy_sign'){
  if(p.confirm!==true)fail(400,'Confirm that you authorize this policy.');
  if(row.status==='Signed_Off')fail(409,'This policy is already signed off.');
  await tx`update erp_private.system_policies set status='Signed_Off' where policy_code=${row.policy_code}`;return {ok:true,status:'Signed_Off'};
 }
 if(row.status!=='Signed_Off')fail(409,'This policy is not signed off.');
 await tx`update erp_private.system_policies set status='Pending' where policy_code=${row.policy_code}`;return {ok:true,status:'Pending'};
}
