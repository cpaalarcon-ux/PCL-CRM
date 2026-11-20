import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),tax=fs.readFileSync(root+'/staff-tax-config.mjs','utf8');
test('ticking an obligation re-reads the status rows from FormData, not from the form element',()=>{
 // readStatusFields uses FormData methods (get / getAll), so the form element must never be passed to it.
 assert.match(tax,/const readStatusFields=\(f,codes\)=>[^\n]*f\.get\('ob_registered_'\+i\)[^\n]*f\.getAll\('ob_firm_'\+i\)/);
 const calls=[...tax.matchAll(/readStatusFields\((new FormData\(f\)|f),renderedCodes\)/g)].map(m=>m[1]);
 assert.equal(calls.length,2);
 assert.ok(calls.includes('new FormData(f)'),'the change handler wraps the form in FormData');
 assert.ok(calls.includes('f'),'the save handler already receives FormData');
});
test('the obligation change handler rebuilds the status rows after reading the old ones',()=>{
 const at=tax.indexOf("f.addEventListener('change',e=>{if(e.target.name==='obligations')");assert.ok(at>0);const handler=tax.slice(at,at+600);
 assert.match(handler,/statusCache=\{\.\.\.statusCache,\.\.\.readStatusFields\(new FormData\(f\),renderedCodes\)\}/);
 assert.match(handler,/renderedCodes=\[\.\.\.f\.querySelectorAll\('\[name="obligations"\]:checked'\)\]/);
 assert.match(handler,/\$\('#obligationStatusRows'\)\.innerHTML=statusFields\(renderedCodes,statusCache/);
});

test('a saved profile read back from the database (Date values) still validates, so verification works with a VAT threshold date',async()=>{
 const {validateProfile}=await import('../supabase/functions/staff-workspace-v12/tax-registry.mjs');
 const st={registered:'YES',applicable:'YES',client_status:'ACTIVE',effective_from:'2026-01-01',effective_to:'2026-12-31',evidence_reference:'Fictional extract',handling_firm_ids:[]};
 const row={entity_type:'Individual',residency:'Resident',regime:'Standard',obligations:['Individual','PAYE'],obligation_statuses:{Individual:st,PAYE:st},annual_turnover:'3900000.00',vat_taxable_supplies_status:'CONFIRMED',vat_taxable_supplies_12m:'3600000.00',vat_threshold_evidence_reference:'Fictional sales book',notes:'Fictional'};
 const asStrings=validateProfile({...row,effective_from:'2026-01-01',effective_to:'2026-12-31',vat_threshold_checked_on:'2026-11-05'});
 const asDates=validateProfile({...row,effective_from:new Date('2026-01-01'),effective_to:new Date('2026-12-31'),vat_threshold_checked_on:new Date('2026-11-05')});
 assert.equal(asDates.vat_threshold_checked_on,'2026-11-05');
 assert.deepEqual(asDates,asStrings);
 assert.throws(()=>validateProfile({...row,effective_from:'2026-01-01',effective_to:'2026-12-31',vat_threshold_checked_on:'2026-02-30'}),/valid date/);
});
