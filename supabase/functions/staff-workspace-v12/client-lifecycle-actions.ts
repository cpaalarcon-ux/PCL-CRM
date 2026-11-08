// Client lifecycle (Pause, Resume, Cancel, Archive, Restore) and contact routing. The rules live in the database functions; this only validates input.
import {fail,uuid,text} from './validation.mjs';
const ACTIONS=['Pause','Resume','Cancel','Archive','Restore'];
export async function clientLifecycleAction(tx:any,a:any,p:any){
 if(p.action==='client_lifecycle'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can change a client\'s lifecycle.');
  const act=String(p.lifecycle||'');if(!ACTIONS.includes(act))fail(400,'Choose Pause, Resume, Cancel, Archive or Restore.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Write the reason in at least 10 characters.');
  await tx`select erp_private.client_lifecycle(${uuid(p.client_id)}::uuid,${act},${reason})`;return {ok:true};
 }
 if(p.action==='client_routing_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can set contact routing.');
  const pick=(v:any)=>v?uuid(v):null;
  await tx`select erp_private.client_routing_save(${uuid(p.client_id)}::uuid,${pick(p.doc_request_contact_id)}::uuid,${pick(p.report_delivery_contact_id)}::uuid)`;return {ok:true};
 }
 return undefined;
}
