// Escalation to a Manager. A Supervisor or Assistant who cannot handle something on a project or task asks a Manager or Partner to decide.
// The named Manager (or any Partner) resolves it with a note. The rules live in the database (erp_private.escalation_*).
import {fail,text,uuid} from './validation.mjs';
export async function escalationAction(tx:any,a:any,p:any){
 if(String(p.action||'').startsWith('partner_escalation_'))return await partnerEscalation(tx,a,p);
 if(!String(p.action||'').startsWith('task_escalation_'))return undefined;
 if(p.action==='task_escalation_raise'){
  const reason=text(p.reason,1000,false).trim();if(reason.length<10)fail(400,'Say what you cannot handle and what you need decided, in at least 10 characters.');
  const [r]=await tx`select erp_private.escalation_raise(${uuid(p.project_id)}::uuid,${p.task_id?uuid(p.task_id):null}::uuid,${reason},${p.manager_id?uuid(p.manager_id):null}::uuid) id`;
  return {ok:true,escalation_id:r.id};
 }
 if(p.action==='task_escalation_list')return {escalations:await tx`select * from erp_private.escalation_list(${p.history===true})`};
 if(p.action==='task_escalation_resolve'){
  const note=text(p.note,1000,false).trim();if(note.length<10)fail(400,'Write the decision or instruction in at least 10 characters.');
  await tx`select erp_private.escalation_resolve(${uuid(p.escalation_id)}::uuid,${note})`;
  return {ok:true};
 }
 fail(400,'Unknown escalation action.');
}

// Escalate to Partner. Supervisors, Managers and Partners raise; any Partner except the person who raised it answers. The rules live in the database.
async function partnerEscalation(tx:any,a:any,p:any){
 if(p.action==='partner_escalation_raise'){
  if(!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Supervisor, Manager or Partner can escalate to a Partner.');
  const reason=text(p.reason,1000,false).trim();if(reason.length<10)fail(400,'Say what needs a Partner and why, in at least 10 characters.');
  const [r]=await tx`select erp_private.partner_escalation_raise(${uuid(p.project_id)}::uuid,${p.task_id?uuid(p.task_id):null}::uuid,${reason}) id`;
  return {ok:true,escalation_id:r.id};
 }
 if(p.action==='partner_escalation_list')return {escalations:await tx`select * from erp_private.partner_escalation_list(${p.history===true})`};
 if(p.action==='partner_escalation_answer'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can answer an escalation to the Partners.');
  const note=text(p.note,1000,false).trim();if(note.length<10)fail(400,'Write the decision or instruction in at least 10 characters.');
  await tx`select erp_private.partner_escalation_answer(${uuid(p.escalation_id)}::uuid,${note})`;
  return {ok:true};
 }
 fail(400,'Unknown escalation action.');
}
