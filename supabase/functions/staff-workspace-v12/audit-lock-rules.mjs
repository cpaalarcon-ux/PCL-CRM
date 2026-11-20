// The audit lock on the annual statements (build 2875). Pure rules: no database, no tax rates.
// The statements stay DRAFT until the audit is complete. The state of the audit for one client year comes from three things: how the year is audited (the arrangement, or an audit file for the year),
// whether a live lock exists, and whether the figures and the approved notes are still the ones the lock was made against.
export const MODES=['In-house audit','External audit'];
export const ARRANGEMENTS=['In-house audit','External audit','Not audited'];
export const OPINIONS=['Unmodified','Qualified','Adverse','Disclaimer of opinion'];
export const DONE_FILE=['Approved','Completion'];
// What the figures are tied to: every coded line of the two primary statements, as shown.
export function figuresInput(statements){
 const pick=key=>(statements?.[key]?.rows||[]).filter(r=>r.code).map(r=>[r.code,r.current??null]);
 return {profit_or_loss:pick('profit_or_loss'),financial_position:pick('financial_position')};
}
// arrangement: {mode}|null. file: the audit file covering the year, {file_status}|null. lock: the live lock or null.
// figuresNow / notesNow: digests of the figures and of the notes as the ledger would produce them now.
export function auditState({arrangement,file,lock,figuresNow,notesNow}){
 const mode=arrangement?.mode||(file?'In-house audit':null);
 if(lock){
  const stale=lock.figures_digest!==figuresNow||lock.notes_digest!==notesNow;
  return {status:stale?'stale':'locked',required:true,mode:lock.mode,label:stale?'Figures changed after the audit was locked':`Audited: ${lock.mode==='External audit'?'external auditor':'in-house audit'}`,locked:!stale,stale};
 }
 if(mode==='Not audited')return {status:'not_audited',required:false,mode,label:'Not audited',locked:false,stale:false};
 if(!mode)return {status:'not_declared',required:false,mode:null,label:'Audit arrangement not recorded',locked:false,stale:false};
 if(mode==='External audit')return {status:'external_pending',required:true,mode,label:'External auditor pending',locked:false,stale:false};
 if(!file)return {status:'not_started',required:true,mode,label:'Not started',locked:false,stale:false};
 if(!DONE_FILE.includes(file.file_status))return {status:'in_progress',required:true,mode,label:'In-house audit in progress',locked:false,stale:false};
 return {status:'ready',required:true,mode,label:'In-house audit complete: ready to lock',locked:false,stale:false};
}
// The pack check. Info when no audit is required (not audited, or not recorded); Pass only for a live lock that still matches the figures and the notes.
export function auditCheck(state){
 if(!state.required)return {status:'Info',detail:state.status==='not_audited'?'A Partner recorded that this year is not audited.':'No audit is recorded for this year. Record whether it is audited in-house, by an external auditor, or not audited.'};
 if(state.locked)return {status:'Pass',detail:'Locked: '+state.label+'.'};
 if(state.stale)return {status:'Blocked',detail:'The figures or the notes changed after the pack was locked. A Partner ends the lock, the notes are approved again, and the pack is locked again.'};
 const why={not_started:'The in-house audit has not started: there is no audit file for this year.',in_progress:'The in-house audit is in progress. Complete and approve the audit file, then lock the pack.',ready:'The audit file is complete. A Manager or Partner who did not prepare it locks the pack.',external_pending:'The external auditor has not reported. Attach the signed audit report and lock the pack.'}[state.status];
 return {status:'Blocked',detail:why||'The audit is not complete.'};
}
// "Audited" is used only once the lock is in place and still matches the figures.
export const auditWording=state=>state.locked?'Audited':'Draft';
