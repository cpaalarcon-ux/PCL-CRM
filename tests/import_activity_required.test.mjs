import test from 'node:test';import assert from 'node:assert/strict';
const {importActivity}=await import('../supabase/functions/staff-workspace-v12/period-import-actions.ts');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const txWith=rows=>async()=>rows;
const refuses=(p,re)=>assert.rejects(p,e=>re.test(String(e?.message||e?.error||JSON.stringify(e))));

test('several activities: a sales import must name one or choose split later',async()=>{
 const tx=txWith([{activity_id:A,activity_name:'Agriculture'},{activity_id:B,activity_name:'Wholesale'}]);
 await refuses(importActivity(tx,'C','2026-01-01','2026-03-31',undefined,'Sales'),/more than one business activity/);
 await refuses(importActivity(tx,'C','2026-01-01','2026-03-31','','Sales'),/more than one business activity/);
 assert.equal(await importActivity(tx,'C','2026-01-01','2026-03-31','split_later','Sales'),null);
 assert.equal(await importActivity(tx,'C','2026-01-01','2026-03-31',A,'Sales'),A);
});
test('a single activity is applied automatically; payroll is not forced to choose',async()=>{
 assert.equal(await importActivity(txWith([{activity_id:A,activity_name:'Agriculture'}]),'C','2026-01-01','2026-03-31',undefined,'Sales'),A);
 const two=txWith([{activity_id:A,activity_name:'Agriculture'},{activity_id:B,activity_name:'Wholesale'}]);
 assert.equal(await importActivity(two,'C','2026-01-01','2026-03-31',undefined,'Payroll'),null);
 assert.equal(await importActivity(txWith([]),'C','2026-01-01','2026-03-31',undefined,'Sales'),null);
});
test('an activity that does not belong to the client is still refused',async()=>{
 const tx=txWith([{activity_id:A,activity_name:'Agriculture'}]);
 await refuses(importActivity(tx,'C','2026-01-01','2026-03-31',B,'Sales'),/Choose a business activity of this client/);
});
