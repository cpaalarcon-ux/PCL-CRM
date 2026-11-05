// Escalation to a Manager. A Supervisor or Assistant who cannot handle something on a project or task asks a Manager or Partner to decide.
// The named Manager (or any Partner) resolves it with a note. The rules live in the database (erp_private.escalation_*).
import {fail,text,uuid} from './validation.mjs';
export async function escalationAction(tx:any,a:any,p:any){
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
