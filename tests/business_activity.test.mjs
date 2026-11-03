import test from 'node:test';
import assert from 'node:assert/strict';
import {businessActivityChoices,businessActivityName,suggestedIndustryPack} from '../staff-business-activities.mjs';

test('business activity choices are pre-populated, unique and include an Other path',()=>{
  const choices=businessActivityChoices();
  const codes=choices.map(([code])=>code);
  assert.ok(choices.length>=15);
  assert.equal(new Set(codes).size,codes.length);
  assert.ok(choices.some(([code,label])=>code==='construction'&&/Construction/.test(label)));
  assert.ok(choices.some(([code,label])=>code==='other'&&/Other/.test(label)));
});

test('a selected activity is saved as a standard label, while Other requires a client description',()=>{
  assert.equal(businessActivityName('construction'),'Construction and building works');
  assert.equal(businessActivityName('other','County road works'),'Other — County road works');
  assert.throws(()=>businessActivityName('other','  '),/Describe the other business activity/);
  assert.throws(()=>businessActivityName('not-a-choice'),/Choose a business activity/);
});

test('activity choices suggest the matching industry pack without changing the income stream',()=>{
  assert.equal(suggestedIndustryPack('construction'),'Construction');
  assert.equal(suggestedIndustryPack('hospitality'),'Hospitality');
  assert.equal(suggestedIndustryPack('retail'),'Wholesale');
  assert.equal(suggestedIndustryPack('professional'),'Consultancy');
  assert.equal(suggestedIndustryPack('healthcare'),'Other');
  assert.equal(suggestedIndustryPack('unknown'),'');
});
