// Client lifecycle (Pause, Resume, Cancel, Archive, Restore) and contact routing. The rules live in the database functions; this only validates input.
import {fail,uuid,text} from './validation.mjs';
const ACTIONS=['Pause','Resume','Cancel','Archive','Restore'],STATUSES=['Active','Inactive','Dormant'];
export async function clientLifecycleAction(tx:any,a:any,p:any){
 if(p.action==='client_lifecycle'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can change a client\'s lifecycle.');
  const act=String(p.lifecycle||'');if(!ACTIONS.includes(act))fail(400,'Choose Pause, Resume, Cancel, Archive or Restore.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Write the reason in at least 10 characters.');
  await tx`select erp_private.client_lifecycle(${uuid(p.client_id)}::uuid,${act},${reason})`;return {ok:true};
 }
 // Client status: Active, Inactive or Dormant. The database carries the change to the client's projects, tasks and invoices.
 if(p.action==='client_status_set'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can change a client\'s status.');
  const status=String(p.status||'');if(!STATUSES.includes(status))fail(400,'Choose Active, Inactive or Dormant.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Write the reason in at least 10 characters.');
  // For a Dormant client coming back, old_work says whether the archived projects and tasks resume or stay archived.
  const cid=uuid(p.client_id),[cur]=await tx`select erp_private.client_status_of(service_status,record_status) st from erp_private.clients where client_id=${cid} and deleted_at is null`;
  if(cur?.st==='Dormant'&&status==='Active'&&!['Resume','Leave archived'].includes(String(p.old_work||'')))fail(400,'Choose whether the earlier projects resume or stay archived.');
  return (await tx`select erp_private.client_status_set(${cid}::uuid,${status},${reason},${String(p.old_work||'Resume')!=='Leave archived'}) r`)[0].r;
 }
 if(p.action==='client_held_work')return (await tx`select erp_private.client_held_work(${uuid(p.client_id)}::uuid) r`)[0].r;
 if(p.action==='client_routing_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can set contact routing.');
  const pick=(v:any)=>v?uuid(v):null;
  await tx`select erp_private.client_routing_save(${uuid(p.client_id)}::uuid,${pick(p.doc_request_contact_id)}::uuid,${pick(p.report_delivery_contact_id)}::uuid)`;return {ok:true};
 }
 if(p.action==='client_comm_access_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Only a Manager or Partner can change communication access.');
  const level=String(p.level||'');if(!['SUPERVISORS_AND_ABOVE','MANAGERS_AND_PARTNERS'].includes(level))fail(400,'Choose who may record client communications.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Write the reason in at least 10 characters.');
  await tx`select erp_private.client_comm_access_save(${uuid(p.client_id)}::uuid,${level},${reason})`;return {ok:true};
 }
 return undefined;
}
