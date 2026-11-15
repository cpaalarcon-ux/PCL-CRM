import test from 'node:test';import assert from 'node:assert/strict';
const R=await import('../supabase/functions/staff-workspace-v12/eligibility-rules.mjs');
const rec=(kind,o={})=>({kind,status:'Verified',valid_from:'2026-01-01',expires_on:'2027-01-01',staff_id:null,...o});
test('an entry is Recorded until verified, then Valid, Expiring inside 60 days, Expired after its last day, or Ended',()=>{
 assert.equal(R.recordState(rec('Firm licence',{status:'Recorded'}),'2026-11-15').state,'Recorded');
 assert.equal(R.recordState(rec('Firm licence'),'2026-06-01').state,'Valid');
 assert.equal(R.recordState(rec('Firm licence'),'2026-11-15').state,'Expiring');assert.equal(R.recordState(rec('Firm licence'),'2026-11-15').days_left,47);
 assert.equal(R.recordState(rec('Firm licence'),'2027-01-01').state,'Expiring');assert.equal(R.recordState(rec('Firm licence'),'2027-01-02').state,'Expired');
 assert.equal(R.recordState(rec('Firm licence',{valid_from:'2027-02-01',expires_on:'2028-01-01'}),'2026-11-15').state,'Not yet valid');
 assert.equal(R.recordState(rec('Firm licence',{status:'Ended'}),'2026-11-15').state,'Ended');
});
test('a service is ready only when every kind has a verified, unexpired entry; a named kind needs an entry for that person',()=>{
 const reqs=['Firm licence','Technical competence','Independence and conflicts'];
 const recs=[rec('Firm licence'),rec('Technical competence',{staff_id:'s1'}),rec('Independence and conflicts',{status:'Recorded'})];
 let r=R.readiness({requirements:reqs,records:recs,today:'2026-06-01',owner:'s1'});assert.deepEqual(r.missing,['Independence and conflicts']);assert.equal(r.can_activate,false);
 r=R.readiness({requirements:reqs,records:[...recs.slice(0,2),rec('Independence and conflicts')],today:'2026-06-01',owner:'s1'});assert.equal(r.can_activate,true);
 r=R.readiness({requirements:reqs,records:[...recs.slice(0,2),rec('Independence and conflicts')],today:'2026-06-01',owner:'s2'});assert.deepEqual(r.missing,['Technical competence'],'another person\'s competence does not count');
 r=R.readiness({requirements:['Firm licence'],records:[rec('Firm licence')],today:'2027-03-01'});assert.deepEqual(r.missing,['Firm licence'],'expired');
 r=R.readiness({requirements:['Firm licence'],records:[rec('Firm licence')],today:'2026-11-20'});assert.equal(r.can_activate,true);assert.equal(r.expiring[0].kind,'Firm licence');
});
