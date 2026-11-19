// Build 2900: PPE brought-forward balances from the opening trial balance, and purchases, completed in one step.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {bfPendingRows,bfPlan,classInfo,dayBefore} from '../supabase/functions/staff-workspace-v12/ppe-register-rules.mjs';
import {areaForStaffAction} from '../supabase/functions/staff-workspace-v12/staff-access-control.mjs';
const root=path.resolve(import.meta.dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const rates=[{class_code:'MOTOR',name:'Motor',contra_account:'15920',expense_account:'67030',effective_from:'2026-01-01'},{class_code:'COMMERCIAL',name:'Commercial buildings',contra_account:'15900',expense_account:'67010',effective_from:'2026-01-01'},{class_code:'LAND',name:'Land',contra_account:'15900',expense_account:'67010',effective_from:'2026-01-01'}];
const acct=(code,name)=>({code,name,status:'Active',route:3});
const accounts=[acct('15004','Vehicles'),acct('15100','Buildings'),acct('15110','Land'),acct('15920','Acc dep')];
const tb=[{code:'15004',opening:1000000},{code:'15100',opening:500000},{code:'15110',opening:200000},{code:'15920',opening:-400000},{code:'15900',opening:-100000}];

test('only cost accounts with an opening balance and no register record are waiting; the depreciation accounts never are',()=>{
 const p=bfPendingRows({tb,accounts,rates,records:[],start:'2026-01-01'});
 assert.deepEqual(p.map(x=>[x.asset_account,x.cost]),[['15004',1000000],['15100',500000],['15110',200000]]);
 const covered=bfPendingRows({tb,accounts,rates,records:[{asset_account:'15004',status:'Draft',acquired_on:'2022-01-01'}],start:'2026-01-01'});
 assert.deepEqual(covered.map(x=>x.asset_account),['15100','15110'],'a draft or approved record covers its account');
 assert.equal(bfPendingRows({tb,accounts,rates,records:[{asset_account:'15004',status:'Ended',acquired_on:'2022-01-01'}],start:'2026-01-01'}).length,3,'an ended record covers nothing');
 assert.equal(bfPendingRows({tb:[{code:'15004',opening:0}],accounts,rates,records:[],start:'2026-01-01'}).length,0);
 assert.equal(dayBefore('2026-01-01'),'2025-12-31');
});
test('the class decides the depreciation account; a shared account must be entered and must add up to the trial balance',()=>{
 const pending=bfPendingRows({tb,accounts,rates,records:[],start:'2026-01-01'}),classes=classInfo(rates,tb),asOf='2025-12-31';
 const mo={asset_account:'15004',class_code:'MOTOR',first_use_on:'2022-03-01',tax_wdv:300000},co={asset_account:'15100',class_code:'COMMERCIAL',first_use_on:'2020-01-01',tax_wdv:100000},la={asset_account:'15110',class_code:'LAND',first_use_on:'2019-01-01',tax_wdv:200000};
 assert.match(bfPlan({picks:[mo,co,la],pending,classes,asOf}).problems.join(' '),/shared/,'two accounts on one depreciation account need an entry');
 assert.match(bfPlan({picks:[mo],pending,classes,asOf}).problems.join(' '),/another account is not being completed/);
 const ok=bfPlan({picks:[mo,{...co,accumulated_depreciation:60000},{...la,accumulated_depreciation:40000}],pending,classes,asOf});assert.deepEqual(ok.problems,[]);
 assert.equal(ok.assets.find(x=>x.asset_account==='15004').bf_accumulated_depreciation,400000,'from the trial balance when the account is not shared');
 const off=bfPlan({picks:[mo,{...co,accumulated_depreciation:60000},{...la,accumulated_depreciation:30000}],pending,classes,asOf});assert.match(off.problems.join(' '),/is 90000 but the trial balance has 100000/);
 assert.equal(bfPlan({picks:[{...mo,tax_wdv:''},co,la],pending,classes,asOf}).assets.length,0,'one problem refuses the whole declaration');
});
test('the screens and actions are wired and honest about what they do not do',()=>{
 for(const a of ['ledger_ppe_bf_declare','ledger_ppe_additions_declare'])assert.equal(areaForStaffAction(a),areaForStaffAction('ledger_ppe_asset_declare'),a);
 const ui=rd('staff-ppe.mjs');assert.match(ui,/ledger_ppe_bf_declare/);assert.match(ui,/ledger_ppe_additions_declare/);assert.match(ui,/Nothing is filled in for you/);assert.match(ui,/one by one/);assert.match(ui,/pre-chosen only when the register already uses one class/);
 const act=rd('supabase/functions/staff-workspace-v12/ppe-actions.ts');assert.match(act,/PPE_BROUGHT_FORWARD_DECLARED/);assert.match(act,/PPE_ADDITIONS_DECLARED/);assert.doesNotMatch(act,/x\.cost/,'cost is never read from the request');
});
