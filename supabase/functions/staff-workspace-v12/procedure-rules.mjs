import {fail} from './validation.mjs';
export const profiles=['Supporting task','Compilation review','Service deliverable','Tax filing'];
export function nextProcedureStage(w,operation,actor,owner){
 const prep=actor.staff_id===owner||['PARTNER','MANAGER'].includes(actor.category_code),reviewer=['PARTNER','MANAGER','SUPERVISOR'].includes(actor.category_code)&&actor.staff_id!==w.prepared_by,manager=['PARTNER','MANAGER'].includes(actor.category_code)&&actor.staff_id!==w.prepared_by;
 if(w.stage==='Closed')fail(400,'Closed work is audit locked. Create a separate correction.');
 if(['query','resume','submit','client-approval','file','deliver','capture'].includes(operation)&&!prep)fail(403,'The assigned preparer or Manager must handle this step.');
 if(operation==='query'&&['Pending preparer','Pending client documents'].includes(w.stage))return 'Pending client documents';
 if(operation==='resume'&&w.stage==='Pending client documents')return 'Pending preparer';
 if(operation==='capture'&&w.profile==='Supporting task'&&['Pending preparer','Pending client documents'].includes(w.stage))return 'Closed';
 if(operation==='submit'&&w.profile!=='Supporting task'&&['Pending preparer','Pending client documents'].includes(w.stage))return 'Pending supervisor review';
 if(['approve','return'].includes(operation)&&w.stage==='Pending supervisor review'){
  if(!reviewer||w.reviewer_id&&w.reviewer_id!==actor.staff_id&&!['PARTNER','MANAGER'].includes(actor.category_code))fail(403,'An independent assigned reviewer or Manager must review this work.');
  return operation==='return'?'Pending preparer':w.profile==='Compilation review'?'Delivered - pending closure':'Awaiting client approval';
 }
 if(operation==='client-approval'&&w.stage==='Awaiting client approval')return w.profile==='Tax filing'?'Ready to file':'Ready to deliver';
 if(operation==='file'&&w.stage==='Ready to file'&&w.profile==='Tax filing')return 'Filed - pending payment';
 if(operation==='deliver'&&w.stage==='Ready to deliver')return 'Delivered - pending closure';
 if(operation==='close'&&['Filed - pending payment','Delivered - pending closure'].includes(w.stage)){
  if(!manager)fail(403,'An independent Manager or Partner must verify evidence and close the work.');return 'Closed';
 }
 fail(400,'Complete the preceding procedure step first.');
}
