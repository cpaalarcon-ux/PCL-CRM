import test from 'node:test';import assert from 'node:assert/strict';
import {bankCloseChecks} from '../supabase/functions/staff-workspace-v12/bank-close.mjs';
const row=(id,batch,code,date,credit,debit=0,reference='')=>({row_id:id,batch_id:batch,account_code:code,normalized:{date,credit,debit,reference:reference||id}});
const status=(r,code)=>r.checks.find(c=>c.code===code)?.status;
const tb=(bankMovement,suspense=0)=>[{code:'10020',movement_debit:Math.max(bankMovement,0),movement_credit:Math.max(-bankMovement,0),opening:0,net:bankMovement},{code:'37000',net:suspense,opening:suspense}];

test('missing statements are Not ready, never zero',()=>{
 assert.equal(status(bankCloseChecks({bankRows:[],tb:tb(500)}),'STATEMENTS'),'Not ready');
 assert.equal(status(bankCloseChecks({bankRows:[],tb:[]}),'STATEMENTS'),'Not applicable');
});
test('unmatched lines and suspense block the close and are named',()=>{
 const r=bankCloseChecks({bankRows:[row('a','S1','40000','2026-09-02',1000),row('b','S1',null,'2026-09-03',0,200,'CHQ 0045'),row('c','S1','37000','2026-09-04',50)],tb:tb(850,50)});
 assert.equal(status(r,'LINES_EXPLAINED'),'Blocked');assert.match(r.checks.find(c=>c.code==='LINES_EXPLAINED').detail,/2 line\(s\).*CHQ 0045/);
 assert.equal(status(r,'SUSPENSE_CLEAR'),'Blocked');
 assert.ok(r.blocking.length>=2);
});
test('own-account transfers pair strictly: other statement, exact opposite amount, within 3 days, used once',()=>{
 const ok=bankCloseChecks({bankRows:[row('t1','S1','10030','2026-09-10',0,5000),row('t2','S2','10020','2026-09-12',5000)],tb:tb(0)});
 assert.equal(status(ok,'TRANSFERS_PAIRED'),'Pass');
 const late=bankCloseChecks({bankRows:[row('t1','S1','10030','2026-09-10',0,5000),row('t2','S2','10020','2026-09-14',5000)],tb:tb(0)});
 assert.equal(status(late,'TRANSFERS_PAIRED'),'Blocked','four days apart is not a pair');
 const near=bankCloseChecks({bankRows:[row('t1','S1','10030','2026-09-10',0,5000),row('t2','S2','10020','2026-09-10',4999)],tb:tb(-1)});
 assert.equal(status(near,'TRANSFERS_PAIRED'),'Blocked','amounts must be exactly opposite');
 const same=bankCloseChecks({bankRows:[row('t1','S1','10030','2026-09-10',0,5000),row('t2','S1','10020','2026-09-10',5000)],tb:tb(0)});
 assert.equal(status(same,'TRANSFERS_PAIRED'),'Blocked','both sides cannot come from the same statement');
 const once=bankCloseChecks({bankRows:[row('t1','S1','10030','2026-09-10',0,5000),row('t2','S2','10020','2026-09-10',5000),row('t3','S3','10020','2026-09-10',5000)],tb:tb(5000)});
 assert.equal(status(once,'TRANSFERS_PAIRED'),'Blocked','a line is matched only once');
});
test('statement movement must agree with posted bank movement; balances stay visible as Not checked',()=>{
 const rows=[row('a','S1','40000','2026-09-02',1000),row('b','S1','61180','2026-09-03',0,300)];
 assert.equal(status(bankCloseChecks({bankRows:rows,tb:tb(700)}),'STATEMENT_TO_LEDGER'),'Pass');
 const off=bankCloseChecks({bankRows:rows,tb:tb(600)});
 assert.equal(status(off,'STATEMENT_TO_LEDGER'),'Blocked');assert.match(off.checks.find(c=>c.code==='STATEMENT_TO_LEDGER').detail,/Difference KES 100\.00/);
 assert.equal(status(off,'STATEMENT_BALANCES'),'Not checked');
 assert.equal(off.checks.find(c=>c.code==='STATEMENT_BALANCES').blocking,false);
});
