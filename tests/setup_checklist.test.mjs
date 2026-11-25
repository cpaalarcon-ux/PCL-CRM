import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupSteps,setupChecklistHtml} from '../staff-setup-checklist.mjs';
const button=(a,l,id='')=>`<button type="button" data-v3="${a}" data-id="${id}">${l}</button>`;
const base={client:{legal_entity_type:'Private Limited Company',vat_categories_sold:null},activities:[],periods:[],policies:[],partners:[]};
test('empty client: activities, VAT and periods are To do; nothing is marked done',()=>{
 const s=setupSteps({r:base});
 assert.deepEqual(s.map(x=>x.key),['identity','kyc','activities','chart','vat','periods']);
 for(const k of ['activities','vat','periods'])assert.equal(s.find(x=>x.key===k).status,'todo');
 for(const k of ['identity','kyc','chart'])assert.equal(s.find(x=>x.key===k).status,null,'no invented status for '+k);
});
test('statuses follow the record and a pending change shows Waiting',()=>{
 const r={...base,client:{...base.client,vat_categories_sold:['Standard']},activities:[{}],periods:[{}],policies:[]};
 let s=setupSteps({r});
 assert.equal(s.find(x=>x.key==='activities').status,'done');assert.equal(s.find(x=>x.key==='vat').status,'done');assert.equal(s.find(x=>x.key==='stock').status,'todo');
 s=setupSteps({r,pending:[{}]});assert.equal(s.find(x=>x.key==='activities').status,'waiting');
});
test('stock step only with activities; profit-sharing only for a partnership; leader buttons only for leaders',()=>{
 assert.ok(!setupSteps({r:base}).some(x=>x.key==='stock'));
 assert.ok(!setupSteps({r:base}).some(x=>x.key==='partners'));
 assert.ok(setupSteps({r:{...base,client:{legal_entity_type:'Partnership'}}}).some(x=>x.key==='partners'));
 const flat=o=>setupSteps(o).flatMap(x=>x.btns.map(b=>b[0]));
 assert.ok(!flat({r:base}).includes('aml-queue'));assert.ok(flat({r:base,isLeader:true}).includes('aml-queue'));
 assert.ok(!flat({r:base}).includes('setup'));assert.ok(flat({r:base,isReviewer:true}).includes('setup'));
});
test('html: numbered steps, one list, counts only measurable steps, escapes text',()=>{
 const html=setupChecklistHtml({r:{...base,client:{vat_categories_sold:['<b>x</b>']},activities:[{}]},id:'c1',button});
 assert.match(html,/<ol class="setup-steps">/);assert.equal((html.match(/class="setup-step /g)||[]).length,7);
 assert.match(html,/2 of 4<\/b> measurable steps done/);
 assert.doesNotMatch(html,/<b>x<\/b>/);assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);
});
test('the Set-up tab uses the checklist and keeps the long sections collapsed',()=>{
 const s=fs.readFileSync(new URL('../staff-improvements.mjs',import.meta.url),'utf8');
 assert.match(s,/setupChecklistHtml\(\{r,id,pending/);assert.match(s,/<details class="setup-advanced">/);
 assert.doesNotMatch(s,/Choose multiple dated activities and tax positions\. The dependency map/);
 for(const a of ['Activities</h3>','Current dependency map','Verified reporting periods','Stock settings history'])assert.ok(s.includes(a),a);
});
