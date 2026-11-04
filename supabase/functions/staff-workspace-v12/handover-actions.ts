// Task and project handover. An assistant hands over assigned, unfinished work with a narration; a Supervisor, Manager or
// Partner reallocates it to another staff member (or declines it). Those roles can also reallocate directly.
// The rules live in the database (erp_private.handover_*); this file validates input and calls them.
import {choice,fail,text,uuid} from './validation.mjs';
const DECIDERS=['PARTNER','MANAGER','SUPERVISOR'];
const decider=(a:any)=>{if(!DECIDERS.includes(a.category_code))fail(403,'Only a Supervisor, Manager or Partner can reallocate work.');};
const narration=(v:any,label:string)=>{const s=text(v,1000,false).trim();if(s.length<10)fail(400,`Write ${label} of at least 10 characters: what is done, what is left, what the next person needs.`);return s;};
export async function handoverAction(tx:any,a:any,p:any){
 if(!String(p.action||'').startsWith('task_handover_'))return undefined;
 if(p.action==='task_handover_request'){
  const project=uuid(p.project_id),task=p.task_id?uuid(p.task_id):null;
  const [r]=await tx`select erp_private.handover_request(${project}::uuid,${task}::uuid,${narration(p.narration,'a narration')}) id`;
  return {ok:true,handover_id:r.id};
 }
 if(p.action==='task_handover_list'){
  const project=p.project_id?uuid(p.project_id):null,task=p.task_id?uuid(p.task_id):null;
  return {handovers:await tx`select * from erp_private.handover_queue(${p.history===true},${project}::uuid,${task}::uuid)`};
 }
 if(p.action==='task_handover_candidates'){
  decider(a);const project=uuid(p.project_id),exclude=p.exclude?uuid(p.exclude):null;
  return {candidates:await tx`select * from erp_private.handover_candidates(${project}::uuid,${exclude}::uuid)`};
 }
 if(p.action==='task_handover_decide'){
  decider(a);const decision=choice(p.decision,['Reallocated','Declined']);
  const to=decision==='Reallocated'?uuid(p.new_assignee_id):null;
  const note=decision==='Declined'?narration(p.note,'a reason'):text(p.note||'',1000,false).trim();
  const [r]=await tx`select erp_private.handover_decide(${uuid(p.handover_id)}::uuid,${decision},${to}::uuid,${note}) moved`;
  return {ok:true,moved:r.moved};
 }
 if(p.action==='task_handover_reallocate'){
  decider(a);const task=p.task_id?uuid(p.task_id):null,from=p.from_staff_id?uuid(p.from_staff_id):null;
  if(!task&&!from)fail(400,'Choose a task, or whose project work is being reallocated.');
  const [r]=await tx`select erp_private.handover_reallocate(${uuid(p.project_id)}::uuid,${task}::uuid,${from}::uuid,${uuid(p.new_assignee_id)}::uuid,${narration(p.reason,'a reason')}) moved`;
  return {ok:true,moved:r.moved};
 }
 fail(400,'Unknown handover action.');
}
