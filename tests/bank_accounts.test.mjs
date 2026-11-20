import test from 'node:test';import assert from 'node:assert/strict';
const {statementBank}=await import('../supabase/functions/staff-workspace-v12/bank-accounts.ts');
const B1='6a1c1f4e-3c1b-4c53-8a53-2a4f4c6a0001',B2='6a1c1f4e-3c1b-4c53-8a53-2a4f4c6a0002';
const stub=rows=>async()=>rows;
test('a client with no registered bank can still import a statement without choosing one',async()=>{
 assert.equal(await statementBank(stub([]),'c1',''),null);assert.equal(await statementBank(stub([]),'c1',undefined),null);
});
test('once a bank is registered, a statement must name an active bank of that client',async()=>{
 const tx=stub([{bank_account_id:B1,gl_code:'10020'}]);
 await assert.rejects(()=>statementBank(tx,'c1',''),/Choose which bank/);
 await assert.rejects(()=>statementBank(tx,'c1',B2),/active bank account registered/);
 await assert.rejects(()=>statementBank(tx,'c1','not-an-id'),/Invalid record/i);
 assert.equal(await statementBank(tx,'c1',B1),B1);
});
test('additional bank accounts are never proposed into a chart automatically, but remain a Manager choice',async()=>{
 const {proposeAccounts}=await import('../supabase/functions/staff-workspace-v12/client-chart.ts');
 const accounts=[{code:'10020',status:'Active',proposed:true},{code:'10021',status:'Active',proposed:false},{code:'10030',status:'Active'}];
 assert.deepEqual(proposeAccounts(accounts,'Limited company',['Retail']).map(x=>x.code),['10020','10030']);
});
