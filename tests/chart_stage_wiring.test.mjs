import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('the setup guide shows the chart of accounts as its own stage and opens the chart screen',()=>{
 const g=read('staff-setup-guide.mjs'),p=read('staff-pilot.mjs'),i=read('staff-improvements.mjs');
 assert.match(g,/title:'Chart of accounts'/);assert.match(g,/v3_client_chart_read/);assert.match(g,/openClientChart/);
 assert.match(g,/\{n:7,title:'Release'/);assert.match(g,/step\('2 · Chart of accounts'/);assert.match(g,/step\('4 · Opening trial balance'/);
 assert.match(p,/openClientChart:improvements\.chart/);
 assert.match(i,/Opening T-structure/);
});
test('the chart stage explains why it blocks and what to do next',()=>{
 const g=read('staff-setup-guide.mjs');
 for(const text of ['Approve at least one business activity first','Generate the chart','needs a check and then a different Manager or Partner','Propose a new chart version'])assert.ok(g.includes(text),text);
});
test('opening import offers only accounts of the approved chart and bulk-accepts template codes',()=>{
 const l=read('staff-ledger.mjs');
 assert.match(l,/a\.in_client_chart!==false/);assert.match(l,/workbook-code-suggestion'\)&&!!accountCode/);
});
