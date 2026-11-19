// Build 2899: client supplier aliases (amendment F to rule A). Exact text only; an alias never approves a pair.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {aliasKey,aliasIssues,resolveAlias} from '../supabase/functions/staff-workspace-v12/routing-map-rules.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
import {aliasRows,ALIAS_NOTE} from '../staff-routing-map.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const al=(o={})=>({alias_id:'a1',status:'Active',party_key:'mlima supplies ltd',description_key:null,effective_from:'2026-09-01',effective_to:null,...o});

test('the clean-up is fixed: case, spaces and punctuation only, and similar names never match',()=>{
 assert.equal(aliasKey('  MLIMA  Supplies, Ltd. '),'mlima supplies ltd');
 assert.equal(aliasKey('Mlima Supplies Ltd'),aliasKey('mlima-supplies  LTD'));
 assert.notEqual(aliasKey('Mlima Supplies Limited'),aliasKey('Mlima Supplies Ltd'));
 assert.notEqual(aliasKey('Mlima Supply Ltd'),aliasKey('Mlima Supplies Ltd'));
 assert.equal(aliasKey(null),'');
});
test('an alias matches only on its dates, and a description alias wins over a supplier alias; two at one level map nothing',()=>{
 const at=(party,date,description)=>({party,description,date});
 assert.equal(resolveAlias([al()],at('Mlima Supplies Ltd.','2026-09-10')).status,'alias');
 assert.equal(resolveAlias([al()],at('Mlima Supplies Ltd','2026-08-31')).status,'none','before it starts');
 assert.equal(resolveAlias([al({effective_to:'2026-09-30'})],at('Mlima Supplies Ltd','2026-10-01')).status,'none','after it ends');
 assert.equal(resolveAlias([al({status:'Draft'})],at('Mlima Supplies Ltd','2026-09-10')).status,'none','a draft is not approved');
 assert.equal(resolveAlias([al({status:'Inactive'})],at('Mlima Supplies Ltd','2026-09-10')).status,'none','a withdrawn alias is not used');
 assert.equal(resolveAlias([al()],at('','2026-09-10')).status,'none','no supplier name');
 const generic=al(),specific=al({alias_id:'a2',description_key:'cement 50kg'});
 assert.equal(resolveAlias([generic,specific],at('Mlima Supplies Ltd','2026-09-10','Cement, 50kg')).alias.alias_id,'a2');
 assert.equal(resolveAlias([generic,specific],at('Mlima Supplies Ltd','2026-09-10','Nails')).alias.alias_id,'a1');
 assert.equal(resolveAlias([specific],at('Mlima Supplies Ltd','2026-09-10','Nails')).status,'none','a description alias alone does not cover other goods');
 assert.equal(resolveAlias([generic,al({alias_id:'a3'})],at('Mlima Supplies Ltd','2026-09-10')).status,'multiple');
});
test('a proposal names what is wrong with it',()=>{
 const ok={party:'Mlima Supplies Ltd',routing_code:'EXP01',item_code:'61030',effective_from:'2026-09-01'};
 assert.deepEqual(aliasIssues(ok),[]);
 assert.match(aliasIssues({...ok,party:'  '}).join(' '),/supplier name/);
 assert.match(aliasIssues({...ok,routing_code:'1x'}).join(' '),/routing code/);
 assert.match(aliasIssues({...ok,item_code:'610'}).join(' '),/five digits/);
 assert.match(aliasIssues({...ok,effective_from:''}).join(' '),/starts/);
 assert.match(aliasIssues({...ok,effective_to:'2026-08-01'}).join(' '),/end date/);
});
test('the alias actions sit in the projects area, and the database rules keep the maker apart from the approver',()=>{
 for(const a of ['routing_map_alias_read','routing_map_alias_propose','routing_map_alias_approve','routing_map_alias_end','routing_map_alias_withdraw'])assert.equal(areaForStaffAction(a),'projects',a);
 const sql=rd('supabase/migrations/20261202100000_client_routing_alias.sql');
 assert.match(sql,/A different Partner must approve this alias/);assert.match(sql,/An alias only points to a routing code and TB item code that a Partner has already approved/);
 assert.match(sql,/reject_delete/);assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/An alias cannot be edited/);
});
test('the screen lists aliases with the right buttons for each person and shows the rules in plain words',()=>{
 const rows=(me,list)=>aliasRows(list,{me});
 const draft=al({status:'Draft',created_by:'m1',revision:3,party_label:'Mlima Supplies Ltd',routing_code:'EXP01',item_code:'61030'});
 assert.match(rows({staff_id:'p1',category_code:'PARTNER'},[draft]),/data-rm="alias-approve"/);
 assert.doesNotMatch(rows({staff_id:'m1',category_code:'PARTNER'},[draft]),/alias-approve/,'the proposer never sees Approve');
 assert.doesNotMatch(rows({staff_id:'m2',category_code:'MANAGER'},[draft]),/alias-approve/,'only a Partner approves');
 assert.match(rows({staff_id:'m2',category_code:'MANAGER'},[al({revision:1})]),/alias-end/);
 assert.equal(rows({staff_id:'a1',category_code:'ASSISTANT'},[al({revision:1})]).includes('data-rm='),false,'staff see the list only');
 assert.match(ALIAS_NOTE,/never approve a pair|cannot approve a pair/);assert.match(ALIAS_NOTE,/similar names never do/);
 const src=rd('staff-routing-map.mjs');assert.match(src,/routing_map_alias_propose/);assert.match(src,/routing_map_alias_approve/);assert.match(src,/Only an exact match/);
 assert.match(rd('staff-standard-purchases.mjs'),/Mapped by approved alias/);assert.match(rd('supabase/functions/staff-workspace-v12/workbook-actions.ts'),/auto_via_alias/);
});
