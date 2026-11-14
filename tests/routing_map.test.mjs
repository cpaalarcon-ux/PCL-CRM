// Build 2802: the approved routing map. A routing code maps to the client's own account only through an approved, date-valid mapping.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {resolveRouting,proposalIssues,PAYROLL_CODES,payrollSide,unmappedByCode,routingConfirmed,ROUTING_METHOD_LABEL} from '../supabase/functions/staff-workspace-v12/routing-map-rules.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const m=(o={})=>({routing_id:'r1',module:'Purchases',routing_code:'EXP01',item_code:null,erp_account_code:'61030',status:'Active',effective_from:'2026-01-01',effective_to:null,...o});
const at=date=>({module:'Purchases',routing_code:'EXP01',item_code:'',date});

test('one approved, date-valid mapping assigns the account; nothing else does',()=>{
 assert.deepEqual(resolveRouting([m()],at('2026-03-15')),{status:'mapped',mapping:m()});
 assert.equal(resolveRouting([m({status:'Draft'})],at('2026-03-15')).status,'none','a draft is not approved');
 assert.equal(resolveRouting([m({status:'Inactive'})],at('2026-03-15')).status,'none','a withdrawn mapping is not used');
 const early=resolveRouting([m({effective_from:'2026-04-01'})],at('2026-03-15'));assert.equal(early.status,'none');assert.match(early.reason,/has an approved mapping, but not one that covers 2026-03-15/);
 assert.equal(resolveRouting([m({effective_to:'2026-02-28'})],at('2026-03-01')).status,'none','the end date is respected');
 assert.equal(resolveRouting([m({effective_to:'2026-02-28'})],at('2026-02-28')).status,'mapped','and the last day still counts');
 assert.equal(resolveRouting([m({module:'Sales'})],at('2026-03-15')).status,'none','a sales mapping never maps a purchase');
 assert.equal(resolveRouting([m()],{module:'Purchases',routing_code:' exp01 ',date:'2026-03-15'}).status,'mapped','case and spaces do not matter');
});
test('no match, or more than one, is flagged with an explanation and never guessed',()=>{
 const none=resolveRouting([],at('2026-03-15'));assert.equal(none.code,'ROUTING_UNMAPPED');assert.match(none.reason,/no approved mapping for this client/);
 const two=resolveRouting([m({routing_id:'a'}),m({routing_id:'b',erp_account_code:'61090'})],at('2026-03-15'));assert.equal(two.status,'multiple');assert.equal(two.code,'ROUTING_MULTIPLE');
 assert.equal(resolveRouting([m()],{module:'Purchases',routing_code:'',date:'2026-03-15'}).code,'ROUTING_BLANK');
});
test('one routing code with several accounts (the Jumesh EXP01 case) is settled by the file\'s TB item code, and only by an approved one',()=>{
 const maps=[m({routing_id:'a',item_code:'61030',erp_account_code:'61030'}),m({routing_id:'b',item_code:'61090',erp_account_code:'61090'}),m({routing_id:'c',item_code:'64000',erp_account_code:'64000'})];
 assert.equal(resolveRouting(maps,{...at('2026-03-15'),item_code:'61090'}).mapping.erp_account_code,'61090');
 const need=resolveRouting(maps,at('2026-03-15'));assert.equal(need.code,'ROUTING_ITEM_REQUIRED');assert.match(need.reason,/61030, 61090, 64000/);
 const unknown=resolveRouting(maps,{...at('2026-03-15'),item_code:'61080'});assert.equal(unknown.code,'ROUTING_ITEM_UNMAPPED');assert.match(unknown.reason,/61080 is not among the approved accounts/);
});
test('a file that contradicts the approved mapping is flagged, not silently overridden or accepted',()=>{
 const r=resolveRouting([m()],{...at('2026-03-15'),item_code:'61090'});assert.equal(r.code,'ROUTING_FILE_DIFFERS');assert.match(r.reason,/approved mapping is account 61030/);
 assert.equal(resolveRouting([m()],{...at('2026-03-15'),item_code:'61030'}).status,'mapped','a file that agrees is fine');
 const both=resolveRouting([m({routing_id:'g'}),m({routing_id:'s',item_code:'61090',erp_account_code:'61090'})],{...at('2026-03-15'),item_code:'61090'});assert.equal(both.mapping.routing_id,'s','the specific mapping wins over the general one');
});
test('a proposal is checked before it is saved',()=>{
 const accounts=[{code:'61030',status:'Active',is_legacy:false,route:2},{code:'11010',status:'Active',is_legacy:false,route:null},{code:'99999',status:'Draft',is_legacy:false,route:2}];
 const ok={module:'Purchases',routing_code:'EXP01',erp_account_code:'61030',effective_from:'2026-01-01'};assert.deepEqual(proposalIssues(ok,accounts),[]);
 assert.match(proposalIssues({...ok,erp_account_code:'11010'},accounts).join(' '),/not a purchase account/);
 assert.match(proposalIssues({...ok,erp_account_code:'99999'},accounts).join(' '),/not active/);
 assert.match(proposalIssues({...ok,routing_code:'1'},accounts).join(' '),/must start with a letter/);
 assert.match(proposalIssues({...ok,effective_to:'2025-12-31'},accounts).join(' '),/cannot be before/);
 assert.match(proposalIssues({...ok,module:'Sales',item_code:'61030'},accounts).join(' '),/only used to choose/);
 assert.match(proposalIssues({...ok,module:'Payroll',routing_code:'EXP01'},accounts).join(' '),/payroll codes/);
});
test('payroll codes carry the side of the account they post to, and cover gross pay, deductions, employer cost, net pay and the bank payment',()=>{
 for(const c of ['GROSS_SALARY','ALLOWANCES','OVERTIME','BONUS','PAYE','NSSF_EMPLOYEE','SHIF','AHL_EMPLOYEE','NSSF_EMPLOYER','AHL_EMPLOYER','NITA_EMPLOYER','NET_PAY_PAYABLE','PAYROLL_BANK_PAYMENT'])assert.ok(PAYROLL_CODES.some(x=>x.code===c),c);
 assert.equal(payrollSide('gross_salary'),'Debit');assert.equal(payrollSide('PAYE'),'Credit');assert.equal(payrollSide('NET_PAY_PAYABLE'),'Credit');assert.equal(payrollSide('nope'),null);
});
test('rows left over are grouped by routing code so one approval clears the group',()=>{
 const g=unmappedByCode([{routing_code:'EXP01',code:'ROUTING_UNMAPPED'},{routing_code:'EXP01',code:'ROUTING_UNMAPPED'},{routing_code:'STOCK',code:'ROUTING_UNMAPPED'},{routing_code:null,code:'NO_CODES'}]);
 assert.deepEqual(g,[{routing_code:'EXP01',rows:2,code:'ROUTING_UNMAPPED'},{routing_code:'STOCK',rows:1,code:'ROUTING_UNMAPPED'}]);
});
test('a mapped row stays valid only while the same approved mapping still covers it',()=>{
 const conf={method:ROUTING_METHOD_LABEL,routing_map_id:'r1',tb_item_code:'61030'};
 assert.equal(routingConfirmed(conf,'61030','2026-03-15',[m()]),true);
 assert.equal(routingConfirmed(conf,'61090','2026-03-15',[m()]),false,'the row was moved to another account');
 assert.equal(routingConfirmed(conf,'61030','2026-03-15',[m({status:'Inactive'})]),false,'the mapping was withdrawn');
 assert.equal(routingConfirmed(conf,'61030','2026-03-15',[m({effective_to:'2026-02-01'})]),false,'the mapping was ended before the date');
 assert.equal(routingConfirmed({...conf,method:'Mapped by staff'},'61030','2026-03-15',[m()]),false);
});
test('the actions are classified, wired, and the maker is never the checker',()=>{
 for(const a of ['routing_map_read','routing_map_propose','routing_map_approve','routing_map_end','routing_map_withdraw'])assert.equal(areaForStaffAction(a),'projects',a);
 const idx=rd('supabase/functions/staff-workspace-v12/index.ts');assert.match(idx,/routingMapAction\(tx,a,p\)/);
 const act=rd('supabase/functions/staff-workspace-v12/routing-map-actions.ts');assert.match(act,/a\.category_code!=='PARTNER'\)fail\(403,'A Partner approves/);assert.match(act,/m\.created_by===a\.staff_id\)fail\(403,'A Partner who did not propose it must approve/);assert.match(act,/Propose between 1 and 200/);
 const auto=rd('supabase/functions/staff-workspace-v12/auto-map.ts');assert.match(auto,/resolveRouting\(routingMap/);assert.match(auto,/awaiting_review:true/);assert.doesNotMatch(auto,/insert into erp_private\.(journal|ledger)/i,'mapping never posts');
 for(const f of ['ledger-actions.ts','accounting-actions.ts'])assert.match(rd('supabase/functions/staff-workspace-v12/'+f),/routingConfirmed\(/,f);
});
test('the migration: RLS forced, no delete, audited, approval by a different Manager or Partner, approved mappings never edited',()=>{
 const files=fs.readdirSync(path.join(root,'supabase/migrations')).filter(x=>/client_routing_map|routing_map_partner/.test(x)).sort(),f=files[0],sql=files.map(x=>rd('supabase/migrations/'+x)).join('\n');
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);assert.match(sql,/reject_delete/);assert.match(sql,/log_change\('routing_id'\)/);assert.match(sql,/touch_revision/);
 assert.match(sql,/A Partner who did not propose it must approve this routing mapping/);assert.match(sql,/A Manager or Partner proposes a routing mapping/);assert.match(sql,/ADD COLUMN version integer/);assert.match(sql,/coalesce\(max\(m\.version\),0\)\+1/);assert.match(sql,/cannot be edited\. Propose a new dated mapping instead/);
 assert.match(sql,/An approved mapping already covers this routing code on these dates/);assert.match(sql,/CHECK\(\(module='Payroll'\)=\(side IS NOT NULL\)\)/);
 assert.doesNotMatch(sql.replace(/^--.*$/gm,''),/client_account_mappings/i,'a separate table from the opening trial balance mappings');
 assert.ok(f>'20261107103437','newer than the baseline');
});
test('the screen: approve is offered only to a different Manager or Partner; staff can propose; it is reachable from Settings and from Purchases',async()=>{
 const {mapRows,createRoutingMapUI,ROUTING_NOTE}=await import('../staff-routing-map.mjs');
 const draft={routing_id:'d',module:'Purchases',routing_code:'EXP01',erp_account_code:'61030',account_name:'Office',effective_from:'2026-01-01',status:'Draft',created_by:'maker',created_by_name:'Maker',revision:1};
 const html=(me)=>mapRows([draft],{me});
 assert.doesNotMatch(html({staff_id:'maker',category_code:'PARTNER'}),/data-rm="approve"/,'the proposer cannot approve');
 assert.match(html({staff_id:'other',category_code:'PARTNER'}),/data-rm="approve"/);
 assert.doesNotMatch(html({staff_id:'other',category_code:'MANAGER'}),/data-rm="approve"/,'a Manager proposes; only a Partner approves');
 assert.doesNotMatch(html({staff_id:'x',category_code:'ASSISTANT'}),/data-rm="approve"/,'staff cannot approve');
 assert.match(html({staff_id:'maker',category_code:'MANAGER'}),/data-rm="withdraw"/,'the maker can withdraw their own draft');
 assert.match(html({staff_id:'other',category_code:'PARTNER'}),/Version 1/);
 const active={...draft,status:'Active',approved_by:'o',approved_by_name:'Other'};
 assert.match(mapRows([active],{me:{staff_id:'z',category_code:'PARTNER'}}),/data-rm="end"/);assert.doesNotMatch(mapRows([active],{me:{staff_id:'z',category_code:'ASSISTANT'}}),/data-rm="(end|withdraw)"/);
 assert.match(ROUTING_NOTE,/Nothing is posted/);
 const ui=createRoutingMapUI({$:()=>null,esc:s=>s,field:()=>'',select:()=>'',form:()=>'',modal:()=>{},request:async()=>({}),notice:()=>{},button:(a,l)=>`<b data-a="${a}">${l}</b>`,data:()=>({me:{category_code:'ASSISTANT'}})});
 assert.equal(ui.card(),'','staff do not see the Settings card');
 assert.equal(await ui.handle('other'),false);
 const suite=rd('staff-suite.mjs');assert.match(suite,/routingMap\.card\(\)/);assert.match(suite,/routingMap\.handle\(action,id\)/);
 const acc=rd('staff-accounting.mjs');assert.match(acc,/btn\('routing-map','Routing map',pid\)/);assert.match(acc,/Auto-mapped — approved routing map/);
});
