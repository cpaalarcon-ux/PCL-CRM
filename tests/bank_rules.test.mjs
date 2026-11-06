import test from 'node:test';import assert from 'node:assert/strict';
import {matchRule,fixItQueue,ruleProblem,norm,lineDirection} from '../supabase/functions/staff-workspace-v12/bank-rules.mjs';
const rule=(id,keyword,account,extra={})=>({rule_id:id,keyword,account_code:account,match_mode:'Contains',direction:'Either',status:'Active',created_at:'2026-01-0'+id.slice(-1),...extra});
const line=(id,reference,credit,debit=0,extra={})=>({row_id:id,revision:1,batch_id:'S1',bank_account_id:'B1',account_code:null,normalized:{date:'2026-09-02',reference,credit,debit},...extra});
test('only Active rules apply; the longest keyword wins; direction narrows a rule',()=>{
 const rules=[rule('1','loan','25000'),rule('2','director loan','25100'),rule('3','loan','25200',{status:'Proposed'}),rule('4','refund','40100',{direction:'Money in'})];
 assert.equal(matchRule(rules,line('a','LOAN FROM DIRECTOR LOAN A/C',5000)).account_code,'25100');
 assert.equal(matchRule(rules,line('b','Staff loan repayment',0,500)).account_code,'25000');
 assert.equal(matchRule(rules,line('c','KRA REFUND',800)).account_code,'40100');
 assert.equal(matchRule(rules,line('d','KRA REFUND',0,800)),null,'a money-in rule does not catch money out');
 assert.equal(matchRule([rule('3','loan','25200',{status:'Proposed'})],line('e','loan',100)),null,'a proposed rule is never applied');
});
test('words match whole words, "starts with" anchors, and a line is never mapped to its own bank account',()=>{
 assert.equal(matchRule([rule('1','tax','61000')],line('a','Taxi fare',0,300)),null,'"tax" is not inside "taxi"');
 assert.equal(matchRule([rule('1','mpesa','10040',{match_mode:'Starts with'})],line('a','MPESA 123',100)).account_code,'10040');
 assert.equal(matchRule([rule('1','mpesa','10040',{match_mode:'Starts with'})],line('a','Paid via MPESA',100)),null);
 assert.equal(matchRule([rule('1','bank to mobile','10040')],line('a','Bank to Mobile 998',0,2000),'10040'),null,'the line cannot be mapped to its own bank account');
});
test('rules must be specific enough',()=>{
 assert.match(ruleProblem({keyword:'ab',match_mode:'Contains',direction:'Either'}),/three/);
 assert.match(ruleProblem({keyword:'123',match_mode:'Contains',direction:'Either'}),/three letters|six digits/);
 assert.equal(ruleProblem({keyword:'Bank to Mobile',match_mode:'Contains',direction:'Either'}),null);
 assert.equal(norm('  KRA  Refund #12 '),'kra refund 12');assert.equal(lineDirection(line('a','x',10)),'Money in');
});
test('the Fix-It queue lists unmapped lines with their rule suggestion and unpaired transfers',()=>{
 const rows=[line('a','LOAN FROM JOHN',5000),line('b','Unknown deposit',900),line('c','Mapped fee',0,50,{account_code:'62500'}),line('t','Own transfer',0,2000,{account_code:'10040'})];
 const q=fixItQueue({rows,rules:[rule('1','loan','25000')],bankAccounts:[{bank_account_id:'B1',bank_name:'Fictional Bank',account_label:'Operating',gl_code:'10020'}]});
 assert.equal(q.not_mapped,2);assert.equal(q.suggested,1);assert.equal(q.transfers_unpaired,1);
 assert.equal(q.items.find(i=>i.row_id==='a').suggestion.account_code,'25000');assert.equal(q.items.find(i=>i.row_id==='b').suggestion,null);
 assert.equal(q.items.find(i=>i.row_id==='t').reason,'Transfer has no opposite line');assert.equal(q.items.find(i=>i.row_id==='a').bank,'Fictional Bank Operating');
});
