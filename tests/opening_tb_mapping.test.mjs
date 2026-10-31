import test from 'node:test';
import assert from 'node:assert/strict';
import {openingTbMappingMatches} from '../supabase/functions/staff-workspace-v12/opening-tb-mapping.mjs';

const mappings=[
 {source_account_code:'WH-TB-001',source_account_name:'Cash on hand',erp_account_code:'10000'},
 {source_account_code:'',source_account_name:'Retained earnings',erp_account_code:'31000'},
];

test('opening TB uses the template source account code to find its approved client mapping',()=>{
 const matches=openingTbMappingMatches(mappings,' WH-TB-001 ','Cash on hand');
 assert.equal(matches.length,1);
 assert.equal(matches[0].erp_account_code,'10000');
});

test('opening TB falls back to name only for client mappings without a source code',()=>{
 assert.equal(openingTbMappingMatches(mappings,'',' retained earnings ')[0].erp_account_code,'31000');
 assert.deepEqual(openingTbMappingMatches(mappings,'UNKNOWN','Cash on hand'),[]);
});

test('duplicate opening TB source codes remain an explicit ambiguity',()=>{
 const duplicate=[...mappings,{source_account_code:'WH-TB-001',source_account_name:'Cash alternate',erp_account_code:'10010'}];
 assert.equal(openingTbMappingMatches(duplicate,'WH-TB-001','Cash on hand').length,2);
});
