// Build 2833: eligibility evidence for restricted or specialist services. Pure rules, no database, no clock. This records evidence a person supplies and a Partner
// verifies; it does not establish that the firm or anyone holds a licence, an authorization or the competence. Current requirements must be checked against official sources.
export const KINDS=['Firm licence','Practitioner authorization','Technical competence','Independence and conflicts','Appointment','Management approval'];
export const NAMED_PRACTITIONER=['Practitioner authorization','Technical competence'];
export const WARN_DAYS=60;
const ms=d=>Date.parse(String(d).slice(0,10)+'T00:00:00Z');
// The state of one entry on a day: Recorded (waiting for a Partner), Valid, Expiring, Expired, Not yet valid, Ended.
export function recordState(r,today){
 if(r.status==='Ended')return {state:'Ended',days_left:null};
 if(r.status==='Recorded')return {state:'Recorded',days_left:null};
 const left=Math.round((ms(r.expires_on)-ms(today))/86400000);
 if(ms(r.valid_from)>ms(today))return {state:'Not yet valid',days_left:left};
 if(left<0)return {state:'Expired',days_left:left};
 return {state:left<=WARN_DAYS?'Expiring':'Valid',days_left:left};
}
// What a service still needs. A named-practitioner kind is met only by an entry for that person; the others by any entry for the service.
export function readiness({requirements,records,today,owner=null}){
 const missing=[],expiring=[];
 for(const kind of requirements){
  const hits=records.filter(r=>r.kind===kind&&(r.staff_id==null||r.staff_id===owner)).map(r=>({r,s:recordState(r,today)})).filter(x=>x.s.state==='Valid'||x.s.state==='Expiring');
  if(!hits.length)missing.push(kind);else if(hits.every(x=>x.s.state==='Expiring'))expiring.push({kind,days_left:Math.max(...hits.map(x=>x.s.days_left))});
 }
 return {can_activate:missing.length===0,missing,expiring};
}
