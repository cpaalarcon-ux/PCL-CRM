import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const {monthRange,previousMonth,sourceStates,taskSummary,taxSummary,packStatus,overview}=await import('../supabase/functions/staff-workspace-v12/period-pack-rules.mjs');
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('months',()=>{assert.deepEqual(monthRange('2028-02'),{start:'2028-02-01',end:'2028-02-29'});assert.equal(monthRange('2026-13'),null);assert.equal(previousMonth('2026-01'),'2025-12');assert.equal(previousMonth('x'),null);});
test('a source is expected only when it came before; absence is "Not received", never zero',()=>{
 assert.deepEqual(sourceStates('2026-09',{}),[]);
 const s=sourceStates('2026-09',{earlier:{sales:true,bank:true}});assert.deepEqual(s.map(x=>[x.key,x.state]),[['sales','Not received'],['bank','Not received']]);
 const ok=sourceStates('2026-09',{imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-09-01',ends_on:'2026-09-30'}],batches:[{dataset:'Bank',period_start:'2026-09-01',period_end:'2026-09-30',rows:40,unmapped:0},{dataset:'Purchases',period_start:'2026-09-01',period_end:'2026-09-30',rows:10,unmapped:3}]});
 assert.equal(ok.find(x=>x.key==='sales').state,'Ready');assert.equal(ok.find(x=>x.key==='bank').state,'Received');assert.equal(ok.find(x=>x.key==='purchases').state,'In progress');assert.match(ok.find(x=>x.key==='purchases').detail,/3 of 10 rows still unmapped/);
 const wb=sourceStates('2026-09',{batches:[{dataset:'Sales',period_start:'2026-09-01',period_end:'2026-09-30',rows:5,unmapped:0}]});assert.equal(wb[0].state,'Received');
});
test('payroll is blocked while last month is unapproved; worst state wins; returned work is named',()=>{
 const f=(prior,status)=>sourceStates('2026-09',{imports:[{kind:'Payroll',status,starts_on:'2026-09-01',ends_on:'2026-09-30'}],prior_payroll:prior});
 assert.equal(f('Submitted','Draft')[0].state,'Blocked');assert.equal(f('Confirmed','Draft')[0].state,'In progress');assert.equal(f(null,'Submitted')[0].state,'Waiting for review');assert.equal(f('Draft','Confirmed')[0].state,'Ready');
 const two=sourceStates('2026-09',{imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-09-01',ends_on:'2026-09-15'},{kind:'Sales',status:'Returned',starts_on:'2026-09-16',ends_on:'2026-09-30'}]});assert.equal(two[0].state,'Returned for correction');
 assert.deepEqual(sourceStates('2026-09',{imports:[{kind:'Sales',status:'Discarded',starts_on:'2026-09-01',ends_on:'2026-09-30'}],earlier:{}}),[]);
});
test('tasks and tax cases',()=>{
 const t=taskSummary([{task_name:'a',status:'Pending',due_at:'2026-09-01T00:00:00Z'},{task_name:'b',status:'Blocked',blocked_reason:'Waiting',due_at:'2027-01-01T00:00:00Z'},{task_name:'c',status:'Completed',due_at:'2026-01-01T00:00:00Z'},{task_name:'d',status:'Blocked',due_at:null}],'2026-10-01T00:00:00Z');
 assert.equal(t.open,3);assert.equal(t.overdue,1);assert.deepEqual(t.blocked.map(b=>b.reason),['Waiting','No reason recorded']);
 assert.deepEqual(taxSummary([{kind:'VAT',status:'Filed'},{kind:'PAYE',status:'Draft'}]),{cases:2,filed:1,open:1,kinds:['VAT','PAYE']});
});
test('pack stage and supervisor overview list exceptions only',()=>{
 const clean=packStatus({month:'2026-09',facts:{imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-09-01',ends_on:'2026-09-30'}]},tasks:[],cases:[],now:'2026-10-01T00:00:00Z'});
 assert.equal(clean.clean,true);assert.equal(clean.stage,'Ready for review');
 const filed=packStatus({month:'2026-09',facts:{imports:[{kind:'Sales',status:'Confirmed',starts_on:'2026-09-01',ends_on:'2026-09-30'}]},tasks:[],cases:[{kind:'VAT',status:'Filed'}],now:'2026-10-01T00:00:00Z'});assert.equal(filed.stage,'Filed');
 const bad=packStatus({month:'2026-09',facts:{earlier:{sales:true}},tasks:[],cases:[],now:'2026-10-01T00:00:00Z'});assert.equal(bad.stage,'Not ready');
 const blocked=packStatus({month:'2026-09',facts:{imports:[{kind:'Payroll',status:'Draft',starts_on:'2026-09-01',ends_on:'2026-09-30'}],prior_payroll:'Draft'},tasks:[],cases:[],now:'2026-10-01T00:00:00Z'});assert.equal(blocked.stage,'Blocked');
 const o=overview([{project_id:'1',project_name:'B',client_name:'Zed',pack:bad},{project_id:'2',project_name:'A',client_name:'Amy',pack:clean},{project_id:'3',project_name:'C',client_name:'Abe',pack:blocked}]);
 assert.equal(o.projects,3);assert.equal(o.clean,1);assert.deepEqual(o.rows.map(r=>r.client_name),['Abe','Zed']);
});
test('screens and server are wired',()=>{
 assert.match(rd('staff-workspace-v6.mjs'),/staff-period-packs\.mjs\?v=20261115-packs-v1/);assert.match(rd('staff-workspace-v6.mjs'),/Period pack/);
 assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261115-reportgate-v1/);
 assert.match(rd('staff-period-packs.mjs'),/period_pack_overview/);assert.match(rd('staff-period-packs.mjs'),/never as zero|never as zero\./i);
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/periodPackAction/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/period_pack_/);
});
