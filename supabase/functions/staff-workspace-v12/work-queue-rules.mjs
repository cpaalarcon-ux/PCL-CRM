// Build 2896: the work queue and the bulk decision on journals. Pure rules, no database.
// One list in three groups (To do, In progress, Done) and one bulk bar. The bar never decides anything the single-journal screen would refuse:
// each journal in a batch is tested against the same rules, and one refused journal refuses the whole batch and names it.
import {isPreparationParticipant} from './workflow-gate-rules.mjs';
export const GROUPS=['To do','In progress','Done'];
export const MIN_NOTE=10;
export const CAPS={check:100,return:100,approve:25};
export const VERBS={check:'checked',return:'returned',approve:'approved and posted'};
const LEADERS=['PARTNER','MANAGER'];
const REFERENCE=j=>j.reference||j.journal_id;

// Why a person may not take this decision on this journal. Empty string means they may. j: {status,prepared_by,last_prepared_by,checked_by,junior}
export function whyNot(decision,role,staffId,j){
 if(!CAPS[decision])return 'Choose Check, Return or Approve.';
 if(!j)return 'This journal is not available to you.';
 if(j.status!=='Submitted')return 'is not waiting for a decision';
 if(isPreparationParticipant(staffId,j.prepared_by,j.last_prepared_by))return 'you prepared or edited it, so a different person decides it';
 const leader=LEADERS.includes(role),supervisor=role==='SUPERVISOR';
 if(decision==='check'){
  if(!leader&&!supervisor)return 'only a Supervisor, Manager or Partner checks';
  if(!j.junior)return 'it was not prepared by an Assistant, so it needs no separate check';
  if(j.checked_by)return 'it has already been checked';
  return '';
 }
 if(decision==='return'){
  if(leader)return '';
  if(supervisor&&j.junior&&!j.checked_by)return '';
  return 'you cannot return it at this stage';
 }
 if(!leader)return 'only a Manager or Partner approves and posts';
 if(j.junior&&!j.checked_by)return 'it was prepared by an Assistant and still needs a check first';
 if(j.junior&&j.checked_by===staffId)return 'you checked it, so a different Manager or Partner approves it';
 return '';
}
// What the person may do to one submitted journal, for the buttons.
export const journalCan=(role,staffId,j)=>['check','return','approve'].filter(d=>!whyNot(d,role,staffId,j));

// Test a whole batch. journals: rows found for the ids; ids: the ids asked for. Returns {ok,problems,maker}; maker is true when any refusal is the maker-is-not-checker rule.
export function planBatch(decision,role,staffId,ids,journals){
 const by=new Map((journals||[]).map(j=>[j.journal_id,j])),problems=[];
 for(const id of ids){
  const j=by.get(id),why=whyNot(decision,role,staffId,j);
  if(why)problems.push({journal_id:id,reference:j?REFERENCE(j):id,reason:why,maker:/prepared or edited|you checked/.test(why)});
 }
 return {ok:!problems.length,problems,maker:problems.some(x=>x.maker)};
}
export function refusalText(decision,problems,total){
 const names=problems.slice(0,8).map(p=>`${p.reference} (${p.reason})`).join('; ')+(problems.length>8?`; and ${problems.length-8} more`:'');
 return `Nothing was changed. ${problems.length} of ${total} journal${total===1?'':'s'} cannot be ${VERBS[decision]||'decided'} by you: ${names}.`;
}
export const noteOk=n=>typeof n==='string'&&n.trim().length>=MIN_NOTE&&n.length<=5000;

// Group an item into To do, In progress or Done.
export function groupOfJournal(j,staffId){
 const mine=isPreparationParticipant(staffId,j.prepared_by,j.last_prepared_by);
 if(j.status==='Posted')return 'Done';
 if(j.status==='Draft'||j.status==='Returned')return 'To do';
 return mine?'In progress':'To do';
}
export function stageOfJournal(j,staffId){
 const mine=isPreparationParticipant(staffId,j.prepared_by,j.last_prepared_by);
 if(j.status==='Posted')return 'Posted';
 if(j.status==='Returned')return j.review_note?`Returned: ${String(j.review_note).slice(0,200)}`:'Returned';
 if(j.status==='Draft')return 'Draft: finish it and send it for review';
 if(j.junior&&!j.checked_by)return mine?'Sent for check':'Awaiting check';
 if(j.junior&&j.checked_by)return mine?'Checked, waiting for approval':'Checked, ready to approve';
 return mine?'Sent for approval':'Ready to approve';
}
export const countGroups=items=>Object.fromEntries(GROUPS.map(g=>[g,items.filter(x=>x.group===g).length]));
