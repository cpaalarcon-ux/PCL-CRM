import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {setupPhases,setupSteps,setupChecklistHtml} from '../staff-setup-checklist.mjs';
const button=(a,l,id='')=>`<button type="button" data-v3="${a}" data-id="${id}">${l}</button>`;
const base={client:{legal_entity_type:'Private Limited Company',vat_categories_sold:null},activities:[],periods:[],policies:[],partners:[]};
const st=(o,k)=>setupSteps(o).find(x=>x.key===k);
test('three phases for a company, four for a partnership',()=>{
 assert.deepEqual(setupPhases({r:base}).map(p=>p.key),['identity','operations','financials']);
 assert.deepEqual(setupPhases({r:{...base,client:{legal_entity_type:'Partnership'}}}).map(p=>p.key),['identity','operations','financials','profit']);
});
test('every older step still exists inside a phase, so no button is lost',()=>{
 const keys=setupSteps({r:{...base,activities:[{}]},isLeader:true,isReviewer:true}).map(x=>x.key);
 assert.deepEqual(keys,['identity','kyc','activities','vat','stock','chart','periods']);
 const b=setupSteps({r:{...base,activities:[{}],client:{legal_entity_type:'Partnership'}},isLeader:true,isReviewer:true}).flatMap(x=>x.btns.map(y=>y[0]));
 for(const a of ['identity','master','aml','aml-queue','activity','setup','setup-review','setup-queue','vat-cats','stock-policy','stock-category','chart','period','partners'])assert.ok(b.includes(a),a);
});
test('part statuses follow the record; unprovable parts show none',()=>{
 for(const k of ['activities','vat','periods'])assert.equal(st({r:base},k).status,'todo');
 for(const k of ['identity','kyc','chart'])assert.equal(st({r:base},k).status,null,k);
 const r={...base,client:{...base.client,vat_categories_sold:['Standard']},activities:[{}],periods:[{}]};
 assert.equal(st({r},'activities').status,'done');assert.equal(st({r},'vat').status,'done');assert.equal(st({r},'stock').status,'todo');
 assert.equal(st({r,pending:[{}]},'activities').status,'waiting');
});
test('a phase gets a badge only when every part in it can be measured',()=>{
 const ph=o=>Object.fromEntries(setupPhases(o).map(p=>[p.key,p.status]));
 assert.equal(ph({r:base}).identity,null);assert.equal(ph({r:base}).financials,null,'chart has no check, so no phase badge');
 assert.equal(ph({r:base}).operations,'todo');
 const r={...base,client:{...base.client,vat_categories_sold:['Standard']},activities:[{}],policies:[{}]};
 assert.equal(ph({r}).operations,'done');assert.equal(ph({r,pending:[{}]}).operations,'waiting');
});
test('leader and reviewer buttons only for those roles; stock only with activities',()=>{
 const flat=o=>setupSteps(o).flatMap(x=>x.btns.map(b=>b[0]));
 assert.ok(!flat({r:base}).includes('aml-queue'));assert.ok(flat({r:base,isLeader:true}).includes('aml-queue'));
 assert.ok(!flat({r:base}).includes('setup'));assert.ok(flat({r:base,isReviewer:true}).includes('setup'));
 assert.ok(!flat({r:base}).includes('stock-policy'));
});
test('html: phases are one numbered list, parts nested, text escaped',()=>{
 const html=setupChecklistHtml({r:{...base,client:{vat_categories_sold:['<b>x</b>']},activities:[{}]},id:'c1',button});
 assert.match(html,/<ol class="setup-steps">/);assert.equal((html.match(/class="setup-step /g)||[]).length,3);
 assert.equal((html.match(/class="setup-part /g)||[]).length,7);
 assert.match(html,/2 of 4<\/b> measurable parts done/);
 assert.doesNotMatch(html,/<b>x<\/b>/);assert.match(html,/&lt;b&gt;x&lt;\/b&gt;/);
});
test('the Set-up tab uses the checklist and keeps the long sections collapsed',()=>{
 const s=fs.readFileSync(new URL('../staff-improvements.mjs',import.meta.url),'utf8');
 assert.match(s,/setupChecklistHtml\(\{r,id,pending/);assert.match(s,/<details class="setup-advanced">/);
 for(const a of ['Activities</h3>','Current dependency map','Verified reporting periods','Stock settings history'])assert.ok(s.includes(a),a);
});
