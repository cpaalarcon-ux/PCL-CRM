import {fail,text,uuid,choice} from './validation.mjs';
import {canonicalNotes,notesState,NOTES_VERSION} from './annual-pack-notes.mjs';
// Notes to the annual statements (build 2873): a Manager or Partner prepares them from the ledger, a Partner approves them, and the approval holds only while the figures are unchanged.
const isLeader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
export const notesDigest=async(notes:any[])=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(canonicalNotes(notes)))))).map(n=>n.toString(16).padStart(2,'0')).join('');

export async function loadNoteSets(tx:any,periodId:string){
 const heads=await tx`select set_id,version,as_of,digest,note_count,calculation_version,status,prepared_by,prepared_at,reviewed_by,reviewed_at,review_note,sole_partner_approval,erp_private.reviewer_label(prepared_by) prepared_name,erp_private.reviewer_label(reviewed_by) reviewed_name from erp_private.period_note_sets where period_id=${periodId} order by version desc`;
 return {heads,approved:heads.find((h:any)=>h.status==='Approved')||null,draft:heads.find((h:any)=>h.status==='Draft')||null};
}
// The state against the figures now: none, draft, approved or stale.
export async function noteStateFor(tx:any,periodId:string,digestNow:string){
 const s=await loadNoteSets(tx,periodId);
 return {...notesState({approved:s.approved,draft:s.draft,digestNow}),sets:s};
}
// getStatements(asOf) builds the statements (and so the notes) from the ledger as they are now.
export async function notesAction(tx:any,a:any,l:any,p:any,getStatements:(asOf:string)=>Promise<any>,asOf:string){
 if(p.action==='ledger_notes_read'){
  const st=await getStatements(asOf),n=st.statements.notes,state=await noteStateFor(tx,l.period_id,n.digest),sets=state.sets;
  const view=(h:any)=>h&&{set_id:h.set_id,version:h.version,status:h.status,digest_matches:h.digest===n.digest,note_count:h.note_count,prepared_name:h.prepared_name,prepared_at:h.prepared_at,reviewed_name:h.reviewed_name,reviewed_at:h.reviewed_at,review_note:h.review_note,sole_partner_approval:h.sole_partner_approval};
  return {notes:n.items,unit_label:n.unit_label,problems:n.problems,digest:n.digest,state:state.status,approved:view(sets.approved),draft:view(sets.draft),
   history:sets.heads.map((h:any)=>({set_id:h.set_id,version:h.version,status:h.status,prepared_name:h.prepared_name,reviewed_name:h.reviewed_name,reviewed_at:h.reviewed_at})),
   can_prepare:isLeader(a)&&l.status==='Open',can_review:a.category_code==='PARTNER'&&l.status==='Open'&&!!sets.draft&&sets.draft.digest===n.digest,drafted_by_me:!!sets.draft&&sets.draft.prepared_by===a.staff_id,
   client:st.client,reporting:st.reporting};
 }
 if(p.action==='ledger_notes_prepare'){
  if(!isLeader(a))fail(403,'A Manager or Partner prepares the notes.');
  if(l.status!=='Open')fail(409,'This ledger year is closed. Its notes can no longer be changed.');
  const st=await getStatements(asOf),S=st.statements,n=S.notes;
  if(S.checks.unmapped.length||S.checks.excluded.length||!S.checks.balanced)fail(400,'The statements are not ready for notes: '+(S.problems.find((x:string)=>/no approved statement line|excluded or legacy|out by/.test(x))||'fix the trial balance mapping first')+' Fix them first.');
  if(!n.items.length)fail(400,'There are no notes to prepare: no statement line with a balance has a note.');
  if(n.problems.length)fail(400,'A note does not agree with its caption: '+n.problems[0]);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':notes'},0))`;
  const sets=await loadNoteSets(tx,l.period_id);
  if(sets.approved&&sets.approved.digest===n.digest&&!sets.draft)fail(409,'These notes are already approved and the figures have not changed.');
  await tx`update erp_private.period_note_sets set status='Superseded' where period_id=${l.period_id} and status='Draft'`;
  const ver=Number((await tx`select coalesce(max(version),0)+1 v from erp_private.period_note_sets where period_id=${l.period_id}`)[0].v);
  const snapshot={notes:n.items,unit_label:n.unit_label,legal_form:S.legal_form||null,as_of:asOf};
  const head=(await tx`insert into erp_private.period_note_sets(period_id,project_id,client_id,version,as_of,digest,note_count,calculation_version,snapshot,prepared_by) values(${l.period_id},${l.project_id},${l.client_id},${ver},${asOf},${n.digest},${n.items.length},${NOTES_VERSION},${tx.json(snapshot)},${a.staff_id}) returning set_id,version,status,note_count`)[0];
  return head;
 }
 if(p.action==='ledger_notes_review'){
  if(a.category_code!=='PARTNER')fail(403,'Only a Partner can approve or return the notes.');
  if(l.status!=='Open')fail(409,'This ledger year is closed.');
  const decision=choice(p.decision,['Approved','Returned']),note=text(p.review_note??'',500,false);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':notes'},0))`;
  const sets=await loadNoteSets(tx,l.period_id),draft=sets.draft;
  if(!draft||draft.set_id!==uuid(p.set_id))fail(409,'These notes have changed. Refresh and review the latest draft.');
  if(decision==='Returned'){
   if(note.length<10)fail(400,'Give a reason of at least 10 characters.');
   await tx`update erp_private.period_note_sets set status='Returned',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note} where set_id=${draft.set_id}`;
   return {status:'Returned'};
  }
  const st=await getStatements(asOf);
  if(st.statements.notes.digest!==draft.digest)fail(409,'The figures have changed since these notes were prepared. Prepare the notes again before approving.');
  const own=draft.prepared_by===a.staff_id;
  if(own&&p.sole_partner_approval!==true)fail(403,'A different Partner approves notes you prepared. If you are your firm’s only Partner, confirm that when you approve.');
  await tx`update erp_private.period_note_sets set status='Superseded' where period_id=${l.period_id} and status='Approved'`;
  await tx`update erp_private.period_note_sets set status='Approved',reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null},sole_partner_approval=${own} where set_id=${draft.set_id}`;
  return {status:'Approved',version:draft.version,sole_partner_approval:own};
 }
 return undefined;
}
