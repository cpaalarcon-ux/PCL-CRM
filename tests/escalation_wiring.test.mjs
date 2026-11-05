import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8'),fn='supabase/functions/staff-workspace-v12/';
test('escalation actions are routed, limited to the projects area and listed on the Manager Home queue',async()=>{
 assert.match(read(fn+'index.ts'),/escalationAction\(tx,a,p\)/);
 const {areaForStaffAction}=await import('../supabase/functions/staff-workspace-v12/staff-access-control.mjs');
 for(const a of ['task_escalation_raise','task_escalation_list','task_escalation_resolve'])assert.equal(areaForStaffAction(a),'projects',a);
 const queue=read(fn+'review-queue.ts');assert.match(queue,/escalation_list\(false\)/);assert.match(queue,/kind:'escalation'/);
 const sql=fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>/supervisor_sight_escalation/.test(f)).map(f=>read('supabase/migrations/'+f)).join('');
 assert.match(sql,/REVOKE ALL ON FUNCTION erp_private\.escalation_raise[^;]*FROM PUBLIC,anon,authenticated,service_role/);assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
});
test('Supervisors and Assistants get the Ask a Manager button; Managers answer from Home',()=>{
 const task=read('staff-task-workspace.mjs'),v6=read('staff-workspace-v6.mjs'),pilot=read('staff-pilot.mjs');
 assert.match(task,/\['SUPERVISOR','ASSISTANT'\]\.includes\(d\.me\.category_code\)&&open&&p\?`<button type="button" data-v6="ask-manager"/);
 assert.match(v6,/\["SUPERVISOR","ASSISTANT"\]\.includes\(d\(\)\.me\.category_code\)\?`<button data-v6="ask-manager"/);
 assert.match(v6,/b\.dataset\.v6==='ask-manager'\)await askManager\(/);assert.match(v6,/b\.dataset\.v6==='answer-escalation'\)await answerEscalation\(id\)/);
 assert.match(pilot,/myReview==='escalation'\)await v6\.answerEscalation\(b\.dataset\.id\)/);assert.match(pilot,/x\.kind==='escalation'\?'Answer':'Open to review'/);
});
