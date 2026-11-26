import {fail,text,uuid} from './validation.mjs';
import {attempt} from './owner-batch-actions.ts';
// Check or approve several proposals the person has ticked, whatever kind they are. Each one goes through the same single-proposal check or approval, in its own savepoint,
// under the signed-in person's name, so every rule still applies (not your own proposal, not one you checked, role, evidence, the 100% share rule). An entry that cannot be handled is held back and listed.
const ACTIONS=['client_proposal_check_selected','client_proposal_approve_selected'];
export const MAX_SELECTED=100;
export async function proposalSelectAction(tx:any,a:any,p:any,run:(p:any)=>Promise<any>):Promise<any>{
 const action=String(p.action||'');if(!ACTIONS.includes(action))return undefined;
 const checking=action==='client_proposal_check_selected',note=text(p.note||'',1000,false);
 if(note.length<10)fail(400,'Record your '+(checking?'check conclusion':'approval note')+' in at least 10 characters.');
 if(checking&&!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'You do not have access to this action.');
 if(!checking&&!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve a proposal.');
 const raw=Array.isArray(p.proposal_ids)?p.proposal_ids:[];
 if(!raw.length)fail(400,'Tick the proposals to '+(checking?'check':'approve')+'.');
 if(raw.length>MAX_SELECTED)fail(400,`Choose at most ${MAX_SELECTED} proposals at a time.`);
 const ids=[...new Set(raw.map((x:any)=>uuid(x)))];
 const rows=await tx`select proposal_id,status,summary,proposed_by,checked_by from erp_private.change_proposals where proposal_id=any(${ids}::uuid[]) order by proposed_at,proposal_id`;
 const known=new Set(rows.map((r:any)=>r.proposal_id)),done:any[]=[],held:any[]=[];
 for(const id of ids)if(!known.has(id))held.push({proposal_id:id,name:'Proposal',reason:'This proposal is not available to your account.'});
 const want=checking?'Proposed':'Checked';
 for(const r of rows){
  const name=String(r.summary||'Proposal');
  if(r.status!==want){held.push({proposal_id:r.proposal_id,name,reason:checking?'It is not waiting for a check.':'It has not been checked yet, or is already decided.'});continue;}
  if(r.proposed_by===a.staff_id){held.push({proposal_id:r.proposal_id,name,reason:'You proposed this, so someone else must '+(checking?'check':'approve')+' it.'});continue;}
  if(!checking&&r.checked_by===a.staff_id){held.push({proposal_id:r.proposal_id,name,reason:'You checked this, so a different Manager or Partner must approve it.'});continue;}
  const res=await attempt(tx,true,()=>run({action:checking?'client_proposal_check':'client_proposal_approve',proposal_id:r.proposal_id,note}));
  if(res.ok)done.push({proposal_id:r.proposal_id,name,activity:res.out?.activity});else held.push({proposal_id:r.proposal_id,name,reason:res.reason});
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'change_proposals',${checking?'PROPOSALS_SELECTED_CHECKED':'PROPOSALS_SELECTED_APPROVED'},${crypto.randomUUID()},${tx.json({chosen:ids.length,done:done.length,held:held.length})})`;
 return {ok:true,status:checking?'Checked':'Approved',done,held};
}
