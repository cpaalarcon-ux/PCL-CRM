// Slice 18: Foreign branch as a sixth entity family, and the pending-rate statutory shell.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const v=path.resolve(import.meta.dirname,'../supabase/functions/staff-workspace-v12/');
const {journalIssues,entityTypes}=await import(v+'/ledger-rules.mjs');
const {FAMILIES,accountingEnabled}=await import(v+'/legal-structure.mjs');
const {profileKinds}=await import(v+'/tax-registry.mjs');
const {ownerPayrollIssues}=await import(v+'/owner-payments.mjs');
const {clientObligationGroups,profileOnlyPositions}=await import('../staff-client-obligations.mjs');

const acct=code=>({code,status:'Active',is_legacy:false,in_client_chart:true});
const accounts=['10000','30000','31000','34320','35010','36020','34300'].map(acct);
const entry=code=>[{line_no:1,account_code:code,debit:100,credit:0,source_status:'Confirmed',source_reference:'Fictional branch letter'},{line_no:2,account_code:'10000',debit:0,credit:100,source_status:'Confirmed',source_reference:'Fictional branch letter'}];
const issues=code=>journalIssues(entry(code),accounts,{kind:'Adjustment',entityType:'Foreign branch'});

test('a foreign branch is an accounting entity and uses the head office account, never company, owner or partner equity',()=>{
 assert.ok(entityTypes.includes('Foreign branch'));assert.ok(FAMILIES.includes('Foreign branch'));assert.equal(accountingEnabled('Foreign branch'),true);
 assert.deepEqual(issues('34320'),[],'the head office account is allowed');
 for(const code of ['30000','31000','35010','36020'])assert.ok(issues(code).some(i=>/equity account does not match the entity type/.test(i)),code+' is refused for a branch');
 assert.deepEqual(ownerPayrollIssues({entityType:'Foreign branch',clientPin:'A111111111A',rows:[{source_row:2,name:'X',pin:'A111111111A'}]}),[],'owner payment rule is for sole proprietors and partnerships only');
});

test('the migration adds the branch as a legal structure, with its checklist and a suggestion only, and stores no rate',()=>{
 const sql=fs.readFileSync(path.resolve(import.meta.dirname,'../supabase/migrations')+'/'+fs.readdirSync(path.resolve(import.meta.dirname,'../supabase/migrations')).find(f=>f.endsWith('_foreign_branch_entity.sql')),'utf8');
 assert.match(sql,/Branch of a Foreign Company/);assert.match(sql,/'Suggested'/);assert.match(sql,/'Draft'/);
 assert.doesNotMatch(sql,/\b\d+(\.\d+)?\s?%/,'no tax rate in the migration');
});

test('NCA, tourism, catering and SEPT are profile positions whose rates are pending the Tax Lead',()=>{
 for(const k of ['NCA levy','Tourism levy','Catering levy','SEPT']){
  assert.ok(profileKinds.includes(k),k+' can be saved on a client tax profile');
  assert.ok(profileOnlyPositions.includes(k),k+' creates no schedule or calculation');
  const item=clientObligationGroups.flatMap(g=>g.items).find(x=>x[0]===k);
  assert.ok(item&&/rate pending Tax Lead approval/.test(item[1]),k+' shows the pending-rate badge');
 }
});
