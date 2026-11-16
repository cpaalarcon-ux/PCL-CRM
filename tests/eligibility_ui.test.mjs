import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const U=await import('../staff-eligibility.mjs');
const rec=o=>({record_id:'r1',revision:'1',kind:'Technical competence',practitioner_name:'A. Fictional',state:'Recorded',status:'Recorded',authority:'ICPAK',reference:'CPD-1',valid_from:'2026-01-01',expires_on:'2027-01-01',recorded_by:'m1',recorded_by_name:'Manager',...o});
test('the eligibility card is wired into Settings and the cache chain is bumped',()=>{
 assert.match(rd('staff-suite.mjs'),/staff-eligibility\.mjs\?v=20261116-elig-v1/);assert.match(rd('staff-suite.mjs'),/eligibility\.card\(\)/);assert.match(rd('staff-suite.mjs'),/eligibility\.handle\(action,id\)/);
 assert.match(rd('staff-pilot.mjs'),/staff-suite\.mjs\?v=20261116-setuptasks-v1/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/eligibility_/);assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/eligibilityAction/);
});
test('a service shows what it needs, what is missing and offers Verify only to a Partner',()=>{
 const s={service_code:'ADV-VAL',service_name:'Business Valuation',service_group:'Advisory & Consulting',requirements:['Independence and conflicts','Technical competence'],named_kinds:['Technical competence'],firm_readiness:{missing:['Independence and conflicts'],expiring:[]},records:[rec({})]};
 const asPartner=U.serviceBlock(s,{canVerify:true,canRecord:true,me:'p1'}),asManager=U.serviceBlock(s,{canVerify:false,canRecord:true,me:'m1'});
 assert.match(asPartner,/Not available: missing Independence and conflicts/);assert.match(asPartner,/data-el="verify"/);assert.doesNotMatch(asManager,/data-el="verify"/);assert.match(asManager,/data-el="record"/);assert.match(asPartner,/A\. Fictional/);
});
test('an expiring entry shows the days left; a sole-Partner verification is labelled; ended entries offer nothing',()=>{
 assert.match(U.recordLine(rec({state:'Expiring',status:'Verified',days_left:12}),{canRecord:true}),/12 days left/);
 assert.match(U.recordLine(rec({state:'Valid',status:'Verified',verified_by_name:'P',sole_partner_verify:true}),{}),/sole Partner/);
 const ended=U.recordLine(rec({state:'Ended',status:'Ended',ended_reason:'Withdrawn'}),{canRecord:true,canVerify:true});assert.doesNotMatch(ended,/data-el=/);assert.match(ended,/ended: Withdrawn/);
});
