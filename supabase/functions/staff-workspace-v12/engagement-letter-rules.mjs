// Engagement letters list. Pure rules, no database. Nothing here links or verifies a letter.
export const LETTER_STATES=['Missing','Uploaded, not linked','Not verified','Expired','Verified'];
const day=v=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):null;
// One engagement: the saved controls (or null), the latest locked signed-letter PDF uploaded to it (or null), and today.
export function letterState(controls,candidate,today){
 const e=controls||null;
 if(e&&e.signed_letter_id){
  if(!e.letter_verified_by)return 'Not verified';
  if(e.letter_expires_on&&day(e.letter_expires_on)<today)return 'Expired';
  return 'Verified';
 }
 return candidate?'Uploaded, not linked':'Missing';
}
export function summarise(rows){
 const counts=Object.fromEntries(LETTER_STATES.map(s=>[s,0]));
 for(const r of rows)counts[r.letter_state]=(counts[r.letter_state]||0)+1;
 return counts;
}
// Which uploaded letters a leader may link now. The person who uploaded a letter does not also verify it, unless they are the only active Partner.
export function planLink(rows,{staff_id,sole}){
 const ready=[],left=[];
 for(const r of rows){
  if(r.letter_state!=='Uploaded, not linked')continue;
  if(r.controls_stage==='Finalized'){left.push({...r,why:'The engagement is finalized.'});continue;}
  if(!sole&&r.candidate_uploaded_by===staff_id){left.push({...r,why:'You uploaded this letter, so another Manager or Partner verifies it.'});continue;}
  ready.push(r);
 }
 return {ready,left};
}
export const MAX_LINK=200;
