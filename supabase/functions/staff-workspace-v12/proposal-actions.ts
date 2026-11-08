import {fail,text,uuid} from './validation.mjs';
import {isProposableAction} from './staff-rights-catalog.mjs';
import {requireAssistantEntryAuthorised} from './policy-actions.ts';
const deny=():never=>fail(403,'You do not have access to this action.');
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const canCheck=(a:any)=>['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code);
const MAX_PAYLOAD=20000;
// A short plain-language line for the review queue. It only repeats what the proposer typed.
export function proposalSummary(action:string,p:any):string{
 const v=(x:any)=>String(x??'').trim().slice(0,120);
 if(action==='client_save')return (p.client_id?'Change client details: ':'Add client: ')+(v(p.company_name)||'client');
 if(action==='contact_save')return 'Add client contact: '+(v(p.full_name)||'contact');
 if(action==='owner_add')return 'Add owner or controller: '+(v(p.full_name)||'person');
 return 'Change: '+action.replace(/_/g,' ');
}
// Assistants and Supervisors do not change client onboarding records directly. Their entry is kept exactly as typed and waits for review.
export async function createProposal(tx:any,a:any,p:any){
 const action=String(p.action||'');
 if(!isProposableAction(action)||!['ASSISTANT','SUPERVISOR'].includes(a.category_code))deny();
 await requireAssistantEntryAuthorised(tx,a);
 if(p.tax_setup||p.purchase_setup)fail(409,'Project and schedule set-up is done by a Manager or Partner. Propose the client details on their own.');
 const reason=text(p.proposal_reason||'',1000,false);
 const {action:_a,proposal_reason:_r,...payload}=p;
 if(JSON.stringify(payload).length>MAX_PAYLOAD)fail(413,'This entry is too large to propose.');
 let clientId:string|null=null;
 if(p.client_id){clientId=uuid(p.client_id);if(!(await tx`select client_id from erp_private.clients where client_id=${clientId}`).length)fail(403,'This record is not available to your account.');}
 const summary=proposalSummary(action,p);
 const [row]=await tx`insert into erp_private.change_proposals(client_id,action,summary,payload,reason,proposed_by,proposed_role)
  values(${clientId},${action},${summary},${tx.json(payload)},${reason||null},${a.staff_id},${a.category_code}) returning proposal_id,status`;
 return {ok:true,proposed:true,proposal_id:row.proposal_id,status:row.status,message:'Proposal saved. A different Supervisor, Manager or Partner will check it, then a Manager or Partner who did not prepare or check it approves it. Nothing has changed on the client record yet.'};
}
export async function proposalsRead(tx:any){
 return await tx`select p.proposal_id,p.client_id,c.company_name,p.action,p.summary,p.reason,p.status,p.proposed_role,p.proposed_at,p.proposed_by,s.full_name proposed_by_name,
  p.checked_by,ck.full_name checked_by_name,p.checked_at,p.check_note,p.decided_by,d.full_name decided_by_name,p.decided_at,p.decision_note,p.payload,p.revision
  from erp_private.change_proposals p left join erp_private.staff_members s on s.staff_id=p.proposed_by left join erp_private.staff_members ck on ck.staff_id=p.checked_by
  left join erp_private.staff_members d on d.staff_id=p.decided_by left join erp_private.clients c on c.client_id=p.client_id
  order by case when p.status in('Proposed','Checked') then 0 else 1 end,p.proposed_at desc limit 200`;
}
async function load(tx:any,p:any){
 const rows=await tx`select * from erp_private.change_proposals where proposal_id=${uuid(p.proposal_id)} for update`;
 if(!rows.length)fail(403,'This proposal is not available to your account.');
 const row=rows[0];if(p.revision!==undefined&&String(p.revision)!==String(row.revision))fail(409,'This proposal changed. Refresh and try again.');
 return row;
}
export async function proposalAction(tx:any,a:any,p:any,replay:(p:any)=>Promise<any>):Promise<any>{
 const action=String(p.action||'');
 if(action==='client_proposal_check'){
  if(!canCheck(a))deny();const row=await load(tx,p);
  if(row.status!=='Proposed')fail(409,'Only a proposal that has not been checked can be checked.');
  if(row.proposed_by===a.staff_id)fail(403,'You cannot check your own proposal.');
  const note=text(p.note||'',1000,false);if(note.length<10)fail(400,'Record your check conclusion in at least 10 characters.');
  await tx`update erp_private.change_proposals set status='Checked',check_note=${note} where proposal_id=${row.proposal_id}`;
  return {ok:true,status:'Checked'};
 }
 if(action==='client_proposal_return'){
  if(!canCheck(a))deny();const row=await load(tx,p);
  if(!['Proposed','Checked'].includes(row.status))fail(409,'This proposal is already closed.');
  if(row.proposed_by===a.staff_id)fail(403,'You cannot return your own proposal. Withdraw it instead.');
  const note=text(p.note||'',1000,false);if(note.length<10)fail(400,'Say what needs to change in at least 10 characters.');
  await tx`update erp_private.change_proposals set status='Returned',decision_note=${note} where proposal_id=${row.proposal_id}`;
  return {ok:true,status:'Returned'};
 }
 if(action==='client_proposal_withdraw'){
  const row=await load(tx,p);if(row.proposed_by!==a.staff_id)deny();
  if(!['Proposed','Checked'].includes(row.status))fail(409,'This proposal is already closed.');
  await tx`update erp_private.change_proposals set status='Withdrawn' where proposal_id=${row.proposal_id}`;
  return {ok:true,status:'Withdrawn'};
 }
 if(action==='client_proposal_approve'){
  if(!isLeader(a))fail(403,'Only a Manager or Partner can approve a proposal.');const row=await load(tx,p);
  if(!isProposableAction(row.action))fail(409,'This kind of proposal can no longer be applied.');
  if(!['Proposed','Checked'].includes(row.status))fail(409,'This proposal is already closed.');
  if(row.proposed_by===a.staff_id)fail(403,'You cannot approve your own proposal.');
  if(row.checked_by&&row.checked_by===a.staff_id)fail(403,'You checked this proposal, so another Manager or Partner must approve it.');
  if(row.status!=='Checked')fail(409,'A Supervisor, Manager or Partner other than the proposer must check this proposal first.');
  const approvalNote=text(p.note||'',1000,false);if(approvalNote.length<10)fail(400,'Record your approval note in at least 10 characters.');
  // Replayed under the approver's own name: every existing validation, scope and review rule runs exactly as if the approver had typed it.
  const result=await replay({...row.payload,action:row.action,proposal_applied:row.proposal_id});
  await tx`update erp_private.change_proposals set status='Approved',decision_note=${approvalNote},result=${tx.json(JSON.parse(JSON.stringify(result??{ok:true})))} where proposal_id=${row.proposal_id}`;
  return {ok:true,status:'Approved',applied:result};
 }
 return undefined;
}
