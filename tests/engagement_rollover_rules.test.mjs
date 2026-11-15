import test from 'node:test';import assert from 'node:assert/strict';
const {nextPeriod,periodsOverlap,carriedItems,dueForRollover,MAX_CARRIED}=await import('../supabase/functions/staff-workspace-v12/engagement-rollover-rules.mjs');
test('the next period follows without a gap: whole months by months, other periods by days',()=>{
 assert.deepEqual(nextPeriod('2026-01-01','2026-01-31'),{start:'2026-02-01',end:'2026-02-28',months:1,kind:'months'});
 assert.deepEqual(nextPeriod('2026-01-01','2026-03-31'),{start:'2026-04-01',end:'2026-06-30',months:3,kind:'months'});
 assert.deepEqual(nextPeriod('2027-12-01','2027-12-31'),{start:'2028-01-01',end:'2028-01-31',months:1,kind:'months'});
 assert.deepEqual(nextPeriod('2027-01-01','2027-12-31'),{start:'2028-01-01',end:'2028-12-31',months:12,kind:'months'});
 assert.deepEqual(nextPeriod('2026-01-15','2026-02-14'),{start:'2026-02-15',end:'2026-03-17',days:31,kind:'days'});
 assert.equal(nextPeriod('2026-02-01','2026-01-01'),null);assert.equal(nextPeriod('x','y'),null);
 assert.equal(periodsOverlap('2026-01-01','2026-03-31','2026-03-31','2026-04-30'),true);assert.equal(periodsOverlap('2026-01-01','2026-03-31','2026-04-01','2026-06-30'),false);
});
test('unresolved items carry their facts, never their status; finished work does not carry',()=>{
 const c=carriedItems([{task_id:'1',task_name:'A',status:'Completed'},{task_id:'2',task_name:'B',status:'Blocked',blocked_reason:'Waiting for statement',due_at:'2026-02-10'},{task_id:'3',task_name:'C',status:'In Review'},{task_id:'4',task_name:'D',status:'Cancelled'},{task_id:'5',task_name:'E',status:'Pending',deleted_at:'2026-01-01'}]);
 assert.deepEqual(c.map(x=>x.task_id),['2','3']);assert.equal(c[0].blocked_reason,'Waiting for statement');assert.equal(c[1].blocked_reason,null);assert.equal(c[0].was,'Blocked');assert.ok(!('status' in c[0]));
 assert.equal(carriedItems(Array.from({length:80},(_,i)=>({task_id:String(i),task_name:'t',status:'Pending'}))).length,MAX_CARRIED);
});
test('only the latest released set-up of a client and service is due, once its period has ended or is about to',()=>{
 const rows=[{client_id:'c1',service_code:'TAX-COMP',period_start:'2026-01-01',period_end:'2026-01-31',status:'Released',client_name:'Zed'},{client_id:'c1',service_code:'TAX-COMP',period_start:'2026-02-01',period_end:'2026-02-28',status:'Released',client_name:'Zed'},
  {client_id:'c2',service_code:'ACC-BOOK',period_start:'2026-02-01',period_end:'2026-02-28',status:'Waiting',client_name:'Amy'},{client_id:'c3',service_code:'ACC-BOOK',period_start:'2026-03-01',period_end:'2026-03-31',status:'Released',client_name:'Abe'}];
 const due=dueForRollover(rows,'2026-03-02');
 assert.deepEqual(due.map(d=>[d.client_id,d.period_end,d.overdue]),[['c1','2026-02-28',true]]);assert.equal(due[0].next.start,'2026-03-01');
 assert.equal(dueForRollover(rows,'2026-03-25').length,2);assert.equal(dueForRollover(rows,'2026-03-25',0).length,1);
});
