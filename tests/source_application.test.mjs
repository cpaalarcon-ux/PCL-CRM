import test from 'node:test';
import assert from 'node:assert/strict';
import {sourceApplicationSchedule} from '../supabase/functions/staff-workspace-v12/ledger-rules.mjs';

const tb=[
 {code:'10020',name:'Bank - operating',account_group:'Current assets',opening:500,net:620,movement_debit:320,movement_credit:200},
 {code:'10060',name:'Trade receivables',account_group:'Current assets',opening:100,net:0,movement_debit:0,movement_credit:100},
 {code:'15001',name:'Land',account_group:'Non-current assets',opening:0,net:100,movement_debit:100,movement_credit:0},
 {code:'15900',name:'Accumulated depreciation - buildings',account_group:'Contra assets',opening:0,net:-10,movement_debit:0,movement_credit:10},
 {code:'20000',name:'Trade payables',account_group:'Liabilities',opening:-50,net:-70,movement_debit:0,movement_credit:20},
 {code:'30000',name:'Share capital - companies',account_group:'Equity',opening:-550,net:-550,movement_debit:0,movement_credit:0},
 {code:'40000',name:'Domestic taxable sales - standard rate',account_group:'Revenue',opening:0,net:-200,movement_debit:0,movement_credit:200},
 {code:'50000',name:'Purchases - goods for resale',account_group:'Cost of sales',opening:0,net:100,movement_debit:100,movement_credit:0},
 {code:'67010',name:'Depreciation - buildings',account_group:'Expenditure',opening:0,net:10,movement_debit:10,movement_credit:0}
];

test('Source & Application ties posted movements to the annual trial balance without a plug',()=>{
 const result=sourceApplicationSchedule(tb);
 assert.equal(result.source_total,820);
 assert.equal(result.application_total,820);
 assert.equal(result.difference,0);
 assert.equal(result.trial_balance_difference,0);
 assert.equal(result.opening_trial_balance_difference,0);
 assert.equal(result.tie_out_difference,0);
 assert.equal(result.balanced,true);
 assert.equal(result.memo.find(x=>x.label.startsWith('Non-cash depreciation'))?.amount,10);
 assert.equal(result.applications.find(x=>x.label.startsWith('Asset disposal'))?.amount,undefined,'ordinary depreciation and its matching contra movement cancel');
 assert.equal(result.sources.find(x=>x.label==='Sales and other income')?.amount,200);
 assert.equal(result.applications.find(x=>x.label==='Closing cash and bank')?.amount,620);
 assert.equal(result.requirements.find(x=>x.key==='bank_statements')?.required,true);
 assert.equal(result.requirements.find(x=>x.key==='loan_statements')?.required,false);
 assert.equal(result.requirements.find(x=>x.key==='other_expenses')?.required,true);
 assert.equal(result.requirements.find(x=>x.key==='stock_movement')?.required,false);
 assert.equal(result.rows,undefined,'The schedule contains no suspense or balancing plug.');
});

test('asset disposal and accumulated depreciation removal stay traceable without a plug',()=>{
 const disposal=[
  {code:'10020',name:'Bank - operating',account_group:'Current assets',opening:1000,net:1090,movement_debit:90,movement_credit:0},
  {code:'15001',name:'Land',account_group:'Non-current assets',opening:100,net:0,movement_debit:0,movement_credit:100},
  {code:'15900',name:'Accumulated depreciation - buildings',account_group:'Contra assets',opening:-20,net:0,movement_debit:20,movement_credit:0},
  {code:'30000',name:'Share capital - companies',account_group:'Equity',opening:-1080,net:-1080,movement_debit:0,movement_credit:0},
  {code:'40110',name:'Gain / (loss) on PPE disposal',account_group:'Revenue',opening:0,net:-10,movement_debit:0,movement_credit:10}
 ];
 const result=sourceApplicationSchedule(disposal),adjustment=result.applications.find(x=>x.label.startsWith('Asset disposal'));
 assert.equal(result.source_total,1110);
 assert.equal(result.application_total,1110);
 assert.equal(adjustment.amount,20);
 assert.equal(adjustment.accounts.find(a=>a.code==='15900').amount,20);
 assert.equal(result.balanced,true);
});

test('an unbalanced opening trial balance is separately detected',()=>{
 const opening=tb.map(x=>({...x,movement_debit:0,movement_credit:0,net:x.opening}));
 opening.find(x=>x.code==='30000').opening=-540;opening.find(x=>x.code==='30000').net=-540;
 const result=sourceApplicationSchedule(opening);
 assert.equal(result.difference,0);
 assert.equal(result.trial_balance_difference,10);
 assert.equal(result.opening_trial_balance_difference,10);
 assert.equal(result.tie_out_difference,10);
 assert.equal(result.balanced,false);
 assert.match(result.issues.join(' '),/opening trial balance is out/);
});
