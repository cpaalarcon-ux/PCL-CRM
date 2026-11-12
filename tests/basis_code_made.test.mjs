// Build 2791: the code of a new no-eTIMS legal basis is made from its name, not typed.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),src=fs.readFileSync(path.join(root,'staff-non-etims.mjs'),'utf8');
const {basisCode}=await import('../staff-non-etims.mjs');
test('the code is made from the name and always fits the server pattern',()=>{
 assert.equal(basisCode('Fictional supplier below threshold'),'NE-FICTIONAL-SUPPLIER-BELOW-THRESH'.slice(0,30).replace(/-+$/,''));
 for(const n of ['Fictional supplier below threshold','  a  ','Mixed / punctuation & symbols!!','x'.repeat(200)]){const c=basisCode(n);assert.match(c,/^[A-Za-z0-9-]{3,30}$/,n);assert.ok(!c.endsWith('-'));}
 assert.equal(basisCode(''),'');assert.equal(basisCode('!!!'),'','a name with no letters or digits gives no code');
 assert.equal(basisCode('Petty cash'),'NE-PETTY-CASH');
});
test('the form shows the code read-only and keeps it in step with the name',()=>{
 assert.match(src,/field\('basis_code','Code \(made from the name, not typed\)'[^)]*readonly required/);
 assert.doesNotMatch(src,/placeholder="NE-EXAMPLE"/);
 assert.match(src,/lab\.addEventListener\('input',sync\)/);
 assert.ok(src.indexOf("field('label','Name of the basis *'")<src.indexOf("field('basis_code'"),'the name comes before the code');
 assert.doesNotMatch(src,/forensic|ISRS 4000/i);
});
