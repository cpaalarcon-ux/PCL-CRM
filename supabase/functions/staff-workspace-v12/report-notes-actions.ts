import {fail,uuid,choice,date} from './validation.mjs';
import {NOTES_VERSION,NOTE_FIELDS,REPORT_KINDS,validateNotes,sameNotes,snapshotNotes,printable,packKindForReport,packState,canSign,validateFiling,signOffFor,registerSummary} from './report-notes-rules.mjs';
// Report notes and the report-pack register (build 2890). Staff write three notes for a report (kind and date). Client highlights and Information required print on the report and are part of the
// figures a reviewer signs off (they are in the report snapshot, so changing them after sign-off makes the sign-off stale). Internal notes are never printed and never part of that snapshot.
// Every report file or assembled pack that is produced is registered by the fingerprint of what it holds. A pack is signed through its approved report review or live audit lock, or by a Manager or
// Partner who did not generate it, and filed by a person who records when and where. Nothing here posts a journal, approves a report or changes a figure.
const ACTIONS=['ledger_report_notes_read','ledger_report_notes_save','ledger_report_packs_read','ledger_report_pack_sign','ledger_report_pack_file'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const canWrite=(a:any)=>['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'].includes(a.category_code);
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Nairobi'});

// The latest saved version of the notes for one report, or null.
export async function latestNotes(tx:any,periodId:string,kind:string,asOf:string){
 return (await tx`select note_id,version,client_highlights,information_required,internal_notes,saved_by,saved_at,erp_private.staff_name(saved_by) saved_name from erp_private.ledger_report_notes where period_id=${periodId} and report_kind=${kind} and as_of=${asOf} order by version desc limit 1`)[0]||null;
}
// What the report snapshot carries: the two client notes, or nothing when both are blank. Never the internal notes.
export async function snapshotNotesFor(tx:any,l:any,kind:string,asOf:string){
 return snapshotNotes(await latestNotes(tx,l.period_id,kind,asOf));
}
export async function printableNotesFor(tx:any,l:any,kind:string,asOf:string){
 return printable(await latestNotes(tx,l.period_id,kind,asOf));
}

// Registers a produced file. The same content is registered once: a second download of an unchanged report adds nothing. Staff who cannot prepare reports are not recorded.
export async function registerPack(tx:any,a:any,l:any,x:{pack_kind:string,report_kind:string|null,as_of:string,file_format:string,file_name:string,status_word:string,fingerprint:string,is_final:boolean,review?:any,lock?:any}){
 if(!canWrite(a))return null;
 const sign=signOffFor({packKind:x.pack_kind,final:x.is_final,review:x.review,lock:x.lock,fingerprint:x.fingerprint});
 const rows=await tx`insert into erp_private.ledger_report_packs(period_id,project_id,client_id,pack_kind,report_kind,as_of,file_format,file_name,status_word,fingerprint,is_final,review_id,lock_id,generated_by)
  values(${l.period_id},${l.project_id},${l.client_id},${x.pack_kind},${x.report_kind},${x.as_of},${x.file_format},${x.file_name.slice(0,240)},${x.status_word},${x.fingerprint},${x.is_final},${sign.review_id},${sign.lock_id},${a.staff_id}) on conflict do nothing returning pack_id`;
 return rows[0]?.pack_id||null;
}

async function packsOf(tx:any,l:any){
 const rows=await tx`select k.pack_id,k.pack_kind,k.report_kind,k.as_of,k.file_format,k.file_name,k.status_word,k.fingerprint,k.is_final,k.review_id,k.lock_id,k.generated_by,k.generated_at,erp_private.staff_name(k.generated_by) generated_name from erp_private.ledger_report_packs k where k.period_id=${l.period_id} order by k.generated_at desc limit 200`;
 const ids=rows.map((r:any)=>r.pack_id),events=ids.length?await tx`select e.pack_id,e.event,e.actor_id,e.occurred_at,e.filed_on,e.reference,e.note,e.sole_partner_approval,erp_private.staff_name(e.actor_id) actor_name from erp_private.ledger_report_pack_events e where e.pack_id=any(${tx.array(ids)}::uuid[])`:[];
 const reviewers=rows.filter((r:any)=>r.review_id).length?await tx`select review_id,erp_private.staff_name(reviewed_by) n,reviewed_at from erp_private.ledger_report_reviews where review_id=any(${tx.array(rows.filter((r:any)=>r.review_id).map((r:any)=>r.review_id))}::uuid[])`:[];
 const locks=rows.filter((r:any)=>r.lock_id).length?await tx`select lock_id,erp_private.staff_name(locked_by) n,locked_at from erp_private.period_audit_locks where lock_id=any(${tx.array(rows.filter((r:any)=>r.lock_id).map((r:any)=>r.lock_id))}::uuid[])`:[];
 return rows.map((r:any)=>{
  const ev=events.filter((e:any)=>e.pack_id===r.pack_id),st=packState({pack:r,events:ev}),sg=ev.find((e:any)=>e.event==='Signed'),fl=ev.find((e:any)=>e.event==='Filed'),rv=reviewers.find((x:any)=>x.review_id===r.review_id),lk=locks.find((x:any)=>x.lock_id===r.lock_id);
  return {pack_id:r.pack_id,pack_kind:r.pack_kind,report_kind:r.report_kind,as_of:day(r.as_of),file_format:r.file_format,file_name:r.file_name,status_word:r.status_word,fingerprint:r.fingerprint,is_final:r.is_final,generated_by:r.generated_by,generated_name:r.generated_name,generated_at:r.generated_at,
   status:st.status,status_detail:st.detail,signed_via:st.signed_via,signed_name:rv?rv.n:lk?lk.n:sg?sg.actor_name:null,signed_at:rv?rv.reviewed_at:lk?lk.locked_at:sg?sg.occurred_at:null,sole_partner_approval:!!(sg&&sg.sole_partner_approval),
   filed_on:fl?day(fl.filed_on):null,filed_reference:fl?fl.reference:null,filed_note:fl?fl.note:null,filed_name:fl?fl.actor_name:null,filed_at:fl?fl.occurred_at:null};
 });
}

// deps.current(pack): the fingerprint the same pack would have if it were produced now (the report snapshot digest, or the assembled pack fingerprint).
export async function reportNotesAction(tx:any,a:any,l:any,p:any,deps:{current:(pack:any)=>Promise<string>}){
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Report notes and the pack register are for staff who prepare or review reports.');
 const open=l.status==='Open';
 if(p.action==='ledger_report_packs_read'){
  const items=await packsOf(tx,l);
  return {version:NOTES_VERSION,items,summary:registerSummary(items),can_sign:['PARTNER','MANAGER'].includes(a.category_code),can_file:canWrite(a),
   note:'Each file produced is listed once, by the fingerprint of what it holds. A draft was produced while checks were open. A pack is signed through its approved report review or its live audit lock, or by a Manager or Partner who did not generate it, and is filed by a person who records when and where.'};
 }
 if(p.action==='ledger_report_notes_read'||p.action==='ledger_report_notes_save'){
  const kind=choice(p.report_kind,REPORT_KINDS),asOf=date(p.as_of);
  if(!asOf)fail(400,'Choose the report date.');
  if(asOf<day(l.starts_on)||asOf>day(l.ends_on))fail(400,'Choose a report date inside this financial year.');
  const cur=await latestNotes(tx,l.period_id,kind,asOf);
  if(p.action==='ledger_report_notes_read'){
   const history=await tx`select version,saved_at,erp_private.staff_name(saved_by) saved_name,(client_highlights<>'') h,(information_required<>'') i,(internal_notes<>'') n from erp_private.ledger_report_notes where period_id=${l.period_id} and report_kind=${kind} and as_of=${asOf} order by version desc limit 20`;
   const review=(await tx`select review_id,status from erp_private.ledger_report_reviews where period_id=${l.period_id} and report_kind=${kind} and as_of=${asOf} order by created_at desc limit 1`)[0]||null;
   return {version:NOTES_VERSION,report_kind:kind,as_of:asOf,fields:NOTE_FIELDS,
    current:cur?{version:cur.version,client_highlights:cur.client_highlights,information_required:cur.information_required,internal_notes:cur.internal_notes,saved_name:cur.saved_name,saved_at:cur.saved_at}:null,
    history:history.map((h:any)=>({version:h.version,saved_at:h.saved_at,saved_name:h.saved_name,client_highlights:!!h.h,information_required:!!h.i,internal_notes:!!h.n})),
    review:review?{status:review.status}:null,can_edit:canWrite(a)&&open,
    printed_as:printable(cur),
    note:'Client highlights and Information required print on the report and are part of what the reviewer signs off; changing them after sign-off means the report is reviewed again. Internal notes never print.'};
  }
  if(!canWrite(a))fail(403,'Staff who prepare reports write their notes.');
  if(!open)fail(409,'This ledger year is closed. Its report notes can no longer be changed.');
  const v=validateNotes(p);if(v.error)fail(400,v.error);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.period_id+':notes:'+kind+':'+asOf},0))`;
  const latest=await latestNotes(tx,l.period_id,kind,asOf);
  if(latest?sameNotes(latest,v.notes):!(v.notes.client_highlights||v.notes.information_required||v.notes.internal_notes))fail(409,'Nothing has changed since the last version.');
  const ver=Number(latest?latest.version:0)+1;
  const row=(await tx`insert into erp_private.ledger_report_notes(period_id,project_id,client_id,report_kind,as_of,version,client_highlights,information_required,internal_notes,saved_by) values(${l.period_id},${l.project_id},${l.client_id},${kind},${asOf},${ver},${v.notes.client_highlights},${v.notes.information_required},${v.notes.internal_notes},${a.staff_id}) returning version`)[0];
  const sig=latest?!sameNotes({client_highlights:latest.client_highlights,information_required:latest.information_required},{client_highlights:v.notes.client_highlights,information_required:v.notes.information_required}):!!(v.notes.client_highlights||v.notes.information_required);
  const rv=(await tx`select status from erp_private.ledger_report_reviews where period_id=${l.period_id} and report_kind=${kind} and as_of=${asOf} order by created_at desc limit 1`)[0]||null;
  return {saved:true,version:row.version,client_notes_changed:sig,review_status:rv?rv.status:null,
   needs_review:sig&&!!rv&&['Approved','Submitted'].includes(rv.status)};
 }
 // sign and file act on one registered pack
 const id=uuid(p.pack_id),pack=(await packsOf(tx,l)).find((x:any)=>x.pack_id===id);
 if(!pack)fail(404,'That pack is not in this ledger year’s register.');
 const events=await tx`select event,actor_id from erp_private.ledger_report_pack_events where pack_id=${id}`,raw=(await tx`select review_id,lock_id from erp_private.ledger_report_packs where pack_id=${id}`)[0];
 const row={pack_id:id,is_final:pack.is_final,review_id:raw.review_id,lock_id:raw.lock_id,generated_by:pack.generated_by};
 if(p.action==='ledger_report_pack_sign'){
  const sole=(await tx`select erp_private.sole_active_partner() s`)[0].s===true;
  const c=canSign({pack:row,events,actor:{category_code:a.category_code,staff_id:a.staff_id},soleActivePartner:sole});
  if(!c.ok)fail(403,c.reason);
  if(c.sole&&p.sole_partner_approval!==true)fail(403,'Someone else signs a pack you generated. If you are your firm’s only Partner, confirm that when you sign.');
  const now=await deps.current(pack);
  if(now!==pack.fingerprint)fail(409,'The figures or notes changed after this pack was generated. Generate it again, then sign the new one.');
  await tx`insert into erp_private.ledger_report_pack_events(pack_id,project_id,event,actor_id,sole_partner_approval) values(${pack.pack_id},${l.project_id},'Signed',${a.staff_id},${c.sole===true})`;
  return {status:'Signed',sole_partner_approval:c.sole===true};
 }
 // file
 if(!canWrite(a))fail(403,'Staff who prepare reports record the filing.');
 const st=packState({pack:row,events});
 if(st.status==='Draft')fail(409,'A draft pack cannot be filed. Generate it again once every check passes.');
 if(st.status==='Generated')fail(409,'Sign the pack first. A Manager or Partner who did not generate it signs it.');
 if(st.status==='Filed')fail(409,'This pack is filed already.');
 const v=validateFiling({filed_on:p.filed_on,reference:p.reference,note:p.note,today:today(),as_of:pack.as_of});if(v.error)fail(400,v.error);
 const now=await deps.current(pack);
 if(now!==pack.fingerprint)fail(409,'The figures or notes changed after this pack was generated. Generate it again, have it signed, then file the new one.');
 await tx`insert into erp_private.ledger_report_pack_events(pack_id,project_id,event,actor_id,filed_on,reference,note) values(${pack.pack_id},${l.project_id},'Filed',${a.staff_id},${v.filed_on},${v.reference},${v.note})`;
 return {status:'Filed',filed_on:v.filed_on};
}
