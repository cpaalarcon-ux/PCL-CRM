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
