import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {monthWorkAction}=await import('../supabase/functions/staff-workspace-v12/month-work-actions.ts');
const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('other actions pass through; month actions sit in the projects area; both rights copies match',async()=>{
 assert.equal(await monthWorkAction(null,{},{action:'other'}),undefined);
 for(const a of ['month_work_read','month_work_open','month_work_new_week','month_work_submit','month_work_clear','month_work_add_task'])assert.equal(areaForStaffAction(a),'projects',a);
 assert.equal(rd('staff-action-rights.mjs'),rd('supabase/functions/staff-workspace-v12/staff-action-rights.mjs'));
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/monthWorkAction\(tx,a,p\)/);
 assert.match(rd('staff-pilot.mjs'),/staff-month-work\.mjs\?v=/);
});
test('the screen only offers what the server will accept',()=>{
 const u=rd('staff-month-work.mjs');
 assert.match(u,/m\.weeks\.every\(w=>w\.status==='Cleared'\)/,'New weekly task only after the previous week is cleared');
 assert.match(u,/w\.submitted_by!==mine\(r\)/,'the submitter never sees a Clear button');
 assert.match(u,/can_add_extra/);
});
