import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {expectedSide,sideNote} from '../staff-tb-source-rules.mjs';
const A=(name,account_group)=>({name,account_group});const fmt=v=>'KES '+v;
test('build 2859: each kind of account has a normal side, and contra, overdraft, drawings and either-side accounts are named',()=>{
 assert.equal(expectedSide(A('Trade receivables','Current assets')),'Debit');assert.equal(expectedSide(A('Land and buildings','Non-current assets')),'Debit');
 assert.equal(expectedSide(A('Accumulated depreciation - vehicles','Contra assets')),'Credit');assert.equal(expectedSide(A('Inventory write-down allowance','Current assets')),'Credit');
 assert.equal(expectedSide(A('Bank overdraft','Liabilities')),'Credit');assert.equal(expectedSide(A('Trade payables','Liabilities')),'Credit');
 assert.equal(expectedSide(A('PAYE payable','Tax / statutory liabilities')),'Credit');assert.equal(expectedSide(A('Net VAT payable / (credit)','Tax / statutory liabilities')),'Either');
 assert.equal(expectedSide(A('Share capital','Equity')),'Credit');assert.equal(expectedSide(A('Retained earnings','Equity')),'Either');assert.equal(expectedSide(A('Partner drawings','Equity')),'Debit');
 assert.equal(expectedSide(A('Sales - goods','Revenue')),'Credit');assert.equal(expectedSide(A('Trade discounts and volume rebates allowed','Revenue')),'Either');
 assert.equal(expectedSide(A('Rent','Expenditure')),'Debit');assert.equal(expectedSide(A('Purchases','Cost of sales')),'Debit');
 assert.equal(expectedSide(A('Something new','A group nobody has heard of')),'Either');assert.equal(expectedSide(null),'Either');
});
test('a line on the unexpected side gets a sentence; the expected side, a nil line and either-side accounts get none',()=>{
 const debtors=A('Trade receivables','Current assets');
 assert.equal(sideNote(debtors,5000,0,fmt),'');assert.equal(sideNote(debtors,0,0,fmt),'');
 const n=sideNote(debtors,0,5000,fmt);assert.match(n,/Trade receivables normally carries a debit balance, but this line is a credit of KES 5000/);assert.match(n,/overpayment/);
 assert.equal(sideNote(A('Accumulated depreciation - vehicles','Contra assets'),0,8000,fmt),'');assert.match(sideNote(A('Accumulated depreciation - vehicles','Contra assets'),8000,0,fmt),/credit balance/);
 assert.match(sideNote(A('Cash at bank','Current assets'),0,1200,fmt),/overdrawn/,'a bank account in credit is a prompt to check an overdraft');
 assert.equal(sideNote(A('Retained earnings','Equity'),9000,0,fmt),'','an accumulated deficit is legitimate');
 assert.equal(sideNote(debtors,6000,1000,fmt),'','the net of several rows decides');assert.match(sideNote(debtors,1000,6000,fmt),/credit of KES 5000/);
 assert.equal(sideNote(null,0,5,fmt),'');
});
test('the browser copy and the server copy of the rules stay identical, and the screen shows the note as a warning, not a block',()=>{
 assert.equal(fs.readFileSync(new URL('../staff-tb-source-rules.mjs',import.meta.url),'utf8'),fs.readFileSync(new URL('../supabase/functions/staff-workspace-v12/tb-source-rules.mjs',import.meta.url),'utf8'));
 const ui=fs.readFileSync(new URL('../staff-ledger.mjs',import.meta.url),'utf8');
 assert.match(ui,/sideNote\(accounts\.find\(a=>a\.code===g\.account_code\),g\.debit,g\.credit,kes\)/);assert.match(ui,/data-opening-side/);
 assert.match(ui,/debit,credit,rows:\[Number\(row\.source_row\)\]/,'each source line carries its amounts');
 assert.doesNotMatch(ui.slice(ui.indexOf('const sideOf=')),/^[^\n]*hasProblems=true/,'the note never sets the blocking flag');
});
