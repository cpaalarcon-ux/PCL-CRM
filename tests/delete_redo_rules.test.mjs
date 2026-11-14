import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {importPlan,uploadPlan}=await import('../supabase/functions/staff-workspace-v12/delete-redo-rules.mjs');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const prep={staff_id:'p',category_code:'ASSISTANT'},mgr={staff_id:'m',category_code:'MANAGER'},sup={staff_id:'s',category_code:'SUPERVISOR'},other={staff_id:'o',category_code:'ASSISTANT'};
const f=(x={})=>({kind:'Payroll',status:'Draft',prepared_by:'p',reviewed_by:null,starts_on:'2026-09-01',ends_on:'2026-09-30',journals:0,tax_cases:0,amendment_live:false,tax_open:true,...x});
test('import plan by stage and role',()=>{
 assert.equal(importPlan(f(),prep).apply,'discard');assert.equal(importPlan(f({status:'Returned'}),mgr).apply,'discard');
 const blocked=importPlan(f(),other);assert.equal(blocked.can_apply,false);assert.match(blocked.blockers[0],/prepared this payroll run, a Manager or a Partner/);
 assert.equal(importPlan(f({status:'Submitted'}),prep).apply,'withdraw_discard');
 assert.equal(importPlan(f({status:'Submitted',reviewed_by:'s'}),prep).can_apply,false);
 assert.equal(importPlan(f({status:'Submitted'}),mgr).apply,'return_discard');
 assert.equal(importPlan(f({status:'Submitted'}),sup).apply,'return');
 assert.equal(importPlan(f({status:'Submitted'}),other).can_apply,false);
 assert.equal(importPlan(f({status:'Submitted',tax_open:false}),mgr).can_apply,false);
});
test('journals, tax computations and open amendments block removal; confirmed work routes to an amendment',()=>{
 assert.match(importPlan(f({journals:1}),prep).blockers.join(' '),/accounting entry was prepared/);
 assert.match(importPlan(f({tax_cases:1}),prep).blockers.join(' '),/tax computation/);
 assert.match(importPlan(f({amendment_live:true}),prep).blockers.join(' '),/amendment is open/);
 const c=importPlan(f({status:'Confirmed',journals:2}),mgr);assert.equal(c.route,'amendment');assert.equal(c.can_apply,false);assert.match(c.steps.join(' '),/reversed/);
 assert.equal(importPlan(f({status:'Confirmed',kind:'Sales'}),mgr).route,'amendment');assert.equal(importPlan(f({status:'Confirmed',kind:'Other'}),mgr).route,'partner');
 assert.match(importPlan(f({status:'Confirmed',amendment_live:true}),mgr).steps[0],/already open/);
 assert.equal(importPlan(f({status:'Discarded'}),mgr).can_apply,false);
});
test('upload plan mirrors the archive rules',()=>{
 assert.equal(uploadPlan({uploaded_by:'p'},prep).apply,'archive');
 assert.equal(uploadPlan({uploaded_by:'p'},other).can_apply,false);
 const locked=uploadPlan({uploaded_by:'p',protected_rows:3,imports:1},prep);assert.equal(locked.can_apply,false);assert.equal(locked.blockers.length,2);
 const lead=uploadPlan({uploaded_by:'p',protected_rows:3,imports:1,journals:1},mgr);assert.equal(lead.can_apply,true);assert.equal(lead.controlled,true);
 assert.equal(uploadPlan({uploaded_by:'p',opening_submitted:1},mgr).can_apply,false);
});
test('screens: the panel is wired, payroll can be amended, the server action is classified',()=>{
 const ui=rd('staff-period-imports.mjs');assert.match(ui,/staff-delete-redo\.mjs\?v=20261115-redo-v1/);assert.match(ui,/delete_redo_plan/);assert.match(ui,/\['Sales','Payroll'\]\.includes\(current\.kind\)/);
 const r=rd('staff-delete-redo.mjs');assert.match(r,/delete_redo_apply/);assert.match(r,/Nothing is deleted|stays in the history/);
 assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/delete_redo_/);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/deleteRedoAction/);
 assert.match(rd('staff-sales-amend.mjs'),/payroll/i);
});
