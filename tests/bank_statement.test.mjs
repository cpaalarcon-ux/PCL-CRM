import test from 'node:test';import assert from 'node:assert/strict';
import {reconcileStatement,statementContinuity,bankSummary} from '../supabase/functions/staff-workspace-v12/bank-statement.mjs';
import {bankCloseChecks} from '../supabase/functions/staff-workspace-v12/bank-close.mjs';
const r=(n,credit,debit,balance)=>({source_row:n,credit,debit,balance});
test('typed opening and closing balances prove the statement',()=>{
 const rows=[r(2,1000,0),r(3,0,300),r(4,50,0)];
 assert.equal(reconcileStatement({rows,declaredOpening:2000,declaredClosing:2750}).status,'Pass');
 const bad=reconcileStatement({rows,declaredOpening:2000,declaredClosing:2700});
 assert.equal(bad.status,'Fail');assert.match(bad.issues[0],/difference -50\.00/);
 assert.equal(reconcileStatement({rows}).status,'Not checked');
 assert.match(reconcileStatement({rows,declaredOpening:100}).issues[0],/both the opening and the closing/);
});
test('a running-balance column proves the statement in either file order',()=>{
 const asc=[r(2,1000,0,3000),r(3,0,300,2700),r(4,50,0,2750)];
 const a=reconcileStatement({rows:asc});assert.equal(a.status,'Pass');assert.equal(a.opening,2000);assert.equal(a.closing,2750);
 const desc=[r(2,50,0,2750),r(3,0,300,2700),r(4,1000,0,3000)];
 const d=reconcileStatement({rows:desc});assert.equal(d.status,'Pass');assert.equal(d.opening,2000);assert.equal(d.closing,2750);
 const broken=reconcileStatement({rows:[r(2,1000,0,3000),r(3,0,300,2600),r(4,50,0,2650)]});
 assert.equal(broken.status,'Fail');assert.match(broken.issues[0],/not continuous/);
 assert.equal(reconcileStatement({rows:asc,declaredOpening:2000,declaredClosing:2750}).status,'Pass');
 assert.match(reconcileStatement({rows:asc,declaredOpening:1900,declaredClosing:2650}).issues.join(' '),/differ from the balances you entered/);
});
test('consecutive statements of one bank must join up',()=>{
 const st=(bank,start,end,o,c)=>({bank_account_id:bank,period_start:start,period_end:end,statement_opening:o,statement_closing:c});
 assert.equal(statementContinuity([st('B1','2026-08-01','2026-08-31',100,500),st('B1','2026-09-01','2026-09-30',500,900)]).gaps.length,0);
 const g=statementContinuity([st('B1','2026-08-01','2026-08-31',100,500),st('B1','2026-09-01','2026-09-30',450,900),st('B2','2026-09-01','2026-09-30',1,2)]);
 assert.equal(g.gaps.length,1);assert.equal(g.compared,1);
 const r1=bankCloseChecks({bankRows:[],tb:[],statements:[st('B1','2026-08-01','2026-08-31',100,500),st('B1','2026-09-01','2026-09-30',450,900)]});
 assert.equal(r1.checks.find(c=>c.code==='BANK_CONTINUITY').status,'Blocked');
 const r2=bankCloseChecks({bankRows:[],tb:[],statements:[{...st('B1','2026-08-01','2026-08-31',100,500),balance_status:'Overridden'}]});
 assert.equal(r2.checks.find(c=>c.code==='BANK_BALANCE_OVERRIDE').blocking,false);
});
const line=(id,credit,account,bank='B1',debit=0)=>({row_id:id,bank_account_id:bank,account_code:account,normalized:{date:'2026-09-02',reference:id,credit,debit}});
test('money-in summary: transfers, the client\'s categories and unclassified lines come out before trade bankings',()=>{
 const rows=[line('s1',1000,'40000'),line('s2',2000,'40010'),line('loan',500,'25000'),line('refund',300,'41000'),line('tr',700,'10040'),line('un',90,null),line('pay',0,'61000','B1',400),line('trout',0,'10040','B1',100)];
 const cats=[{category_id:'c1',name:'Loans',account_codes:['25000'],status:'Active'},{category_id:'c2',name:'Old',account_codes:['41000'],status:'Retired'}];
 const s=bankSummary({rows,categories:cats,bankAccounts:[{bank_account_id:'B1',bank_name:'Fictional Bank'}]});
 assert.equal(s.money_in,4590);
 const by=Object.fromEntries(s.sections.map(x=>[x.key,x]));
 assert.equal(by.transfers.amount,700);assert.equal(by['cat:c1'].amount,500);assert.equal(by.unclassified.amount,90);
 assert.equal(by.trade.amount,3300,'sales plus the refund, because the Old category is retired');assert.equal(s.trade_bankings,3300);
 assert.equal(s.sections.reduce((n,x)=>n+(x.is_total?0:x.amount),0)+s.trade_bankings,s.money_in,'the sections add back to total money in');
 assert.deepEqual(s.money_out,{total:500,own_transfers:100,unpaid_cheques:0,not_classified:0,other_mapped:400});
 assert.equal(by['cat:c1'].lines[0].reference,'loan');
 assert.equal(bankSummary({rows,categories:cats,bankAccounts:[],bankAccountId:'B2'}).money_in,0);
});

test('unpaid cheques are deducted for every client, and a cheque that clears again is ordinary money in',()=>{
 const rows=[line('dep',1000,'40000'),line('ret',0,'10065','B1',1000),line('again',1000,'40000'),line('cyl',600,'20030')];
 const s=bankSummary({rows,categories:[{category_id:'cy',name:'Cylinder deposits',account_codes:['20030'],status:'Active'}],bankAccounts:[]});
 const by=Object.fromEntries(s.sections.map(x=>[x.key,x]));
 assert.equal(s.money_in,2600);assert.equal(by.cheques.amount,1000);assert.equal(by['cat:cy'].amount,600);
 assert.equal(s.trade_bankings,1000,'deposit 1000 returned, then the same cheque cleared: 1000 net');
 assert.equal(s.sections.reduce((n,x)=>n+(x.is_total?0:x.amount),0)+s.trade_bankings,s.money_in);
 assert.equal(s.money_out.unpaid_cheques,1000);assert.equal(s.money_out.other_mapped,0);
 assert.equal(by.cheques.lines[0].amount,1000);
});

test('money-out split: drawings, loans, finance costs, other, transfers, cheques and unclassified add back to total money out',async()=>{
 const {outGroup,DRAWINGS_CODES}=await import('../supabase/functions/staff-workspace-v12/bank-statement.mjs');
 const rows=[line('d1',0,'36020','B1',100),line('dv',0,'20140','B1',50),line('ln',0,'20090','B1',80),line('i1',0,'62000','B1',15),line('bc',0,'62510','B1',5),line('rent',0,'61000','B1',400),line('kra',0,'21600','B1',60),line('tr',0,'10040','B1',30),line('chq',0,'10065','B1',20),line('un',0,null,'B1',7),line('sale',900,'40000')];
 const s=bankSummary({rows,categories:[],bankAccounts:[]});
 const by=Object.fromEntries(s.money_out_sections.map(x=>[x.key,x]));
 assert.equal(by['out:drawings'].amount,150);assert.equal(by['out:loans'].amount,80);assert.equal(by['out:finance'].amount,20);
 assert.equal(by['out:other'].amount,460,'rent and the tax payment are other expenditure');assert.equal(by['out:transfers'].amount,30);assert.equal(by['out:cheques'].amount,20);assert.equal(by['out:unclassified'].amount,7);
 assert.equal(s.money_out.total,767);assert.deepEqual(s.tie_out.money_out,{buckets:767,total:767});assert.deepEqual(s.tie_out.money_in,{buckets:900,total:900});
 assert.equal(by['out:drawings'].lines[0].reference,'d1');assert.equal(by['out:drawings'].count,2);
 assert.equal(outGroup('62060'),'finance');assert.equal(outGroup('62'),'other');assert.equal(outGroup(''),'unclassified');assert.equal(outGroup('35010'),'drawings');assert.ok(DRAWINGS_CODES.includes('35010'));
 assert.equal(outGroup('30000'),'other','share capital is not a bank outflow group');
});
test('an unmapped money-out line is shown as not classified and the two sides still tie out',()=>{
 const s=bankSummary({rows:[line('x',0,null,'B1',250)],categories:[],bankAccounts:[]});
 assert.equal(s.money_out_sections.find(x=>x.key==='out:unclassified').amount,250);assert.equal(s.tie_out.money_out.buckets,s.tie_out.money_out.total);
});
