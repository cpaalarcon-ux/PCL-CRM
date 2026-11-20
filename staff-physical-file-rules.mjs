// Physical file register: what a person may do with one file next. Pure; the database and the server repeat these rules, this only decides which buttons to show.
// Retention periods are NOT decided. Nothing here sets or enforces how long a file is kept.
export const FILE_STATUSES=['In store','With staff','Pending dispatch','Returned to client','Archived'];
export const FINAL_STATUSES=['Returned to client','Archived'];
export const isFinal=f=>FINAL_STATUSES.includes(f.status);
export const hasCopy=f=>Boolean(f.digital_document_id||f.no_scan_reason);

// The actions open on a file, with the reason one is not open (shown beside the file).
export function fileActions(f,me){
 if(['INTERN','ADMIN'].includes(me.category_code))return {open:[],notes:[]};
 if(isFinal(f))return {open:[],notes:[f.status==='Archived'?'Archived: the record is locked.':'Returned to the client: the record is locked.']};
 const open=['pf-move','pf-copy'],notes=[];
 if(f.status!=='Pending dispatch')open.push('pf-pending');
 if(!hasCopy(f))notes.push('No scanned copy linked yet. A file cannot leave the office or be archived until one is linked or a reason is recorded.');
 else{
  if(f.status==='Pending dispatch')open.push('pf-return');
  open.push('pf-archive');
 }
 return {open,notes};
}

// A file that sits in the office while its ticket is being worked is listed beside the ticket.
export function ticketFileLine(files){
 const out=files.filter(f=>!isFinal(f));
 return out.length?`${out.length} physical file${out.length===1?'':'s'} still in the office (${out.map(f=>f.file_ref).join(', ')})`:'';
}

// High-priority tickets not started in time. The 24 hours is a default taken from the Partner's note; a Partner has not confirmed it as a firm rule.
export const HIGH_PRIORITY_RESPONSE_HOURS=24;
export const HIGH_PRIORITY_NOTE='24 hours: default from the reception note, not yet confirmed by a Partner.';
export function highPriorityStale(t,nowMs=Date.now()){
 if(t.status!=='Open'||!['High','Urgent'].includes(t.priority))return false;
 const opened=new Date(t.opened_at).getTime();
 return Number.isFinite(opened)&&nowMs-opened>HIGH_PRIORITY_RESPONSE_HOURS*3600*1000;
}
