import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const {ownerPayrollIssues,OWNER_PAYMENT_MESSAGE}=await import('../supabase/functions/staff-workspace-v12/owner-payments.mjs');
const root=path.resolve(import.meta.dirname,'..');
const rows=[{source_row:2,name:'Amina Fictional',pin:'A111111111A'},{source_row:3,name:'Brian Fictional',pin:'A222222222B'},{source_row:4,name:'Chloe Staff',pin:'A333333333C'}];

test('sole proprietors and partnerships cannot pay owners or partners as employees',()=>{
 assert.deepEqual(ownerPayrollIssues({entityType:'Limited company',clientPin:'A111111111A',rows}),[],'a company director can be an employee');
 assert.deepEqual(ownerPayrollIssues({entityType:'Non-profit organisation',rows}),[]);
 const sole=ownerPayrollIssues({entityType:'Sole proprietor',clientPin:'a111111111a',rows});
 assert.equal(sole.length,1);assert.match(sole[0],/Row 2: Amina Fictional is the owner of this sole proprietorship\. Owner and partner payments must be routed to Drawings, not payroll\./);
 const part=ownerPayrollIssues({entityType:'Partnership',partners:[{partner_name:'Someone Else',partner_pin:'A222222222B'},{partner_name:'chloe  STAFF',partner_pin:'A999999999Z'}],rows});
 assert.deepEqual(part.map(x=>x.slice(0,6)),['Row 3:','Row 4:'],'matched by PIN and by name');
 assert.ok(part.every(x=>x.includes(OWNER_PAYMENT_MESSAGE)));
 assert.deepEqual(ownerPayrollIssues({entityType:'Partnership',partners:[{partner_name:'Amy',partner_pin:''}],rows}),[],'very short names are not matched');
});

test('the ledger offers an owner drawing entry that debits the right drawings account',()=>{
 const ui=fs.readFileSync(root+'/staff-ledger.mjs','utf8');
 assert.match(ui,/owner-drawing/);assert.match(ui,/'36020':'35010'/);assert.match(ui,/Owners and partners are not paid through payroll/);
 assert.match(fs.readFileSync(root+'/supabase/functions/staff-workspace-v12/period-import-actions.ts','utf8'),/ownerPayrollIssues/);
});
