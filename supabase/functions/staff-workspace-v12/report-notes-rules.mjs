// Report notes and the report-pack register (build 2890). Pure: no database, no files.
// Three notes belong to one report (a kind and a date): Client highlights and Information required print on the report and are part of what a reviewer signs off; Internal notes never print and are never
// part of the signed-off report. A blank client note prints as "None". The register states where each produced pack stands: Draft, Generated, Signed or Filed, worked out from the facts, never typed.
export const NOTES_VERSION='report-notes-v1';
export const NOTE_MAX=3000;
export const REPORT_KINDS=['Month','Quarter','Year to date','Year end'];
export const PACK_KINDS=['Monthly filing pack','Annual filing pack','Point-in-time status'];
export const NOTE_FIELDS=[
 {key:'client_highlights',label:'Client highlights',prints:true,help:'What the client should notice this period. It prints on the report.'},
 {key:'information_required',label:'Information required',prints:true,help:'What the client still has to send us. It prints on the report.'},
 {key:'internal_notes',label:'Internal notes',prints:false,help:'For the firm only. It never prints and is not part of the signed-off report.'}
];
// The text as it is kept: line breaks made uniform, control characters dropped, surrounding blanks removed.
export const cleanNote=v=>String(v??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();
// Returns {error} or {notes}. All three may be blank: that clears the notes.
export function validateNotes(input){
 const out={};
 for(const f of NOTE_FIELDS){
  const v=cleanNote(input&&input[f.key]);
  if(v.length>NOTE_MAX)return {error:`${f.label}: keep it to ${NOTE_MAX} characters (it is ${v.length}).`};
  out[f.key]=v;
 }
 return {notes:out};
}
export const sameNotes=(a,b)=>NOTE_FIELDS.every(f=>cleanNote(a&&a[f.key])===cleanNote(b&&b[f.key]));
export const blankNotes=n=>NOTE_FIELDS.every(f=>!cleanNote(n&&n[f.key]));
// What goes into the report snapshot, and so into the fingerprint a reviewer signs off. Only the two client notes, and nothing at all when both are blank,
// so a report with no notes keeps exactly the fingerprint it had before notes existed. The internal notes are never here.
export function snapshotNotes(n){
 const h=cleanNote(n&&n.client_highlights),i=cleanNote(n&&n.information_required);
 return h||i?{client_highlights:h,information_required:i}:undefined;
}
// What is printed under the report: the two client notes, with "None" for a blank one.
export const printable=n=>({client_highlights:cleanNote(n&&n.client_highlights)||'None',information_required:cleanNote(n&&n.information_required)||'None'});
export const packKindForReport=reportKind=>reportKind==='Month'?'Monthly filing pack':'Point-in-time status';

// Where a registered pack stands. pack: the row; events: its Signed and Filed events.
export function packState({pack,events=[]}){
 const filed=events.find(e=>e.event==='Filed'),signedEvent=events.find(e=>e.event==='Signed');
 if(!pack.is_final)return {status:'Draft',signed_via:null,detail:'Produced while checks were open. It cannot be signed or filed.'};
 const via=pack.review_id?'report review':pack.lock_id?'audit lock':signedEvent?'recorded sign-off':null;
 if(filed)return {status:'Filed',signed_via:via,detail:'Filed.'};
 if(via)return {status:'Signed',signed_via:via,detail:via==='report review'?'Signed off through the approved report review.':via==='audit lock'?'Signed through the live audit lock.':'Signed by a Manager or Partner.'};
 return {status:'Generated',signed_via:null,detail:'Every check passed. A Manager or Partner who did not generate it signs it.'};
}
// May this person sign this pack? Returns {ok,reason,sole}.
export function canSign({pack,events=[],actor,soleActivePartner=false}){
 const st=packState({pack,events});
 if(st.status==='Draft')return {ok:false,reason:'A draft pack cannot be signed.'};
 if(st.status!=='Generated')return {ok:false,reason:st.status==='Filed'?'This pack is filed.':'This pack is signed already.'};
 if(!['PARTNER','MANAGER'].includes(actor.category_code))return {ok:false,reason:'A Manager or Partner signs the pack.'};
 if(actor.staff_id===pack.generated_by){
  if(actor.category_code==='PARTNER'&&soleActivePartner)return {ok:true,sole:true,reason:''};
  return {ok:false,reason:'Someone else signs a pack you generated. If you are your firm’s only Partner, confirm that when you sign.'};
 }
 return {ok:true,sole:false,reason:''};
}
// The filing record, checked before it is saved. today: the date in Nairobi. Returns {error} or {filed_on,reference,note}.
export function validateFiling({filed_on,reference,note,today,as_of}){
 const d=String(filed_on??'').slice(0,10);
 const real=/^\d{4}-\d{2}-\d{2}$/.test(d)&&!Number.isNaN(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!real)return {error:'Enter the date it was filed.'};
 if(d>today)return {error:'The filing date cannot be in the future.'};
 if(as_of&&d<String(as_of).slice(0,10))return {error:'A pack cannot be filed before the date it reports on.'};
 const ref=String(reference??'').replace(/\s+/g,' ').trim();
 if(ref.length<3)return {error:'Say where or how it was filed (a reference, the email it went in, the portal acknowledgement), at least 3 characters.'};
 if(ref.length>200)return {error:'Keep the reference to 200 characters.'};
 const n=String(note??'').replace(/\s+/g,' ').trim();
 if(n.length>500)return {error:'Keep the note to 500 characters.'};
 return {filed_on:d,reference:ref,note:n||null};
}
// Whether registering a pack may carry a sign-off: the approved review for a report, the live lock for an annual pack. Used when a pack is registered.
export function signOffFor({packKind,final,review,lock,fingerprint}){
 if(!final)return {review_id:null,lock_id:null};
 if(packKind==='Annual filing pack')return {review_id:null,lock_id:lock&&lock.lock_id&&!lock.stale?lock.lock_id:null};
 return {review_id:review&&review.status==='Approved'&&review.snapshot_digest===fingerprint&&review.reviewed_by&&review.reviewed_by!==review.prepared_by?review.review_id:null,lock_id:null};
}
// A one-line summary of a register for the screen.
export function registerSummary(items){
 const by={Draft:0,Generated:0,Signed:0,Filed:0};for(const i of items)by[i.status]=(by[i.status]||0)+1;
 return {total:items.length,...by};
}
