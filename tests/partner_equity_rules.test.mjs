import test from 'node:test';import assert from 'node:assert/strict';
import {buildEquityStatement} from '../supabase/functions/staff-workspace-v12/annual-pack-flows.mjs';
import {validatePartnerEquity,buildPartnerEquity,partnerEquityMatrix,partnerEquityState,partnerEquityCheck} from '../supabase/functions/staff-workspace-v12/annual-pack-partner-equity.mjs';
import {allocateProfit} from '../supabase/functions/staff-workspace-v12/partner-shares-rules.mjs';
import {packReadiness} from '../supabase/functions/staff-workspace-v12/annual-pack-rules.mjs';
import {annualGate} from '../supabase/functions/staff-workspace-v12/annual-gate-rules.mjs';
// Fictional figures only. A two-partner firm: capital 600,000 and 400,000 at the start; drawings of 200,000; the year's profit is 500,000.
const L=(line_code,statement,section,label,sort_order,normal_side)=>({line_code,statement,section,label,sort_order,normal_side,note_ref:null});
const lineDefs=[L('SFP.CASH','Financial position','Current assets','Cash',100,'Debit'),L('SFP.OWNER_CAP','Financial position','Equity','Partners capital',300,'Credit'),L('SFP.RETAINED','Financial position','Equity','Partners current accounts',370,'Credit'),L('SFP.DRAWINGS','Financial position','Equity','Drawings',380,'Debit'),
 L('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit'),L('PL.COST','Profit or loss','Operating costs','Costs',1100,'Debit')];
const map=(a,l)=>({account_code:a,line_code:l,effective_from:'2020-01-01',effective_to:null,status:'Approved'});
const maps=[map('10000','SFP.CASH'),map('30000','SFP.OWNER_CAP'),map('31000','SFP.RETAINED'),map('32000','SFP.DRAWINGS'),map('40000','PL.REVENUE'),map('50000','PL.COST')];
const bs=(code,opening,movDr,movCr)=>({code,name:'A'+code,opening,movement_debit:movDr,movement_credit:movCr,net:opening+movDr-movCr});
// opening: capital 1,000,000 (credit), current accounts 100,000 (credit). In the year: capital introduced 50,000, drawings 200,000, revenue 900,000, costs 400,000. Cash balances the books.
const tb=()=>[bs('10000',1100000,950000+0,200000+0),bs('30000',-1000000,0,50000),bs('31000',-100000,0,0),bs('32000',0,200000,0),bs('40000',0,0,900000),bs('50000',0,400000,0)];
const equity=()=>buildEquityStatement({lineDefs,maps,tb:tb(),asOf:'2026-12-31'});
const shares=[{partner_name:'Fictional Amani',share_bp:6000},{partner_name:'Fictional Zawadi',share_bp:4000}];
const rec=(over={})=>({version:1,evidence:'Fictional partners ledger',rows:[{partner_name:'Fictional Amani',capital_opening:600000,capital_movement:50000,current_opening:60000,drawings:120000},{partner_name:'Fictional Zawadi',capital_opening:400000,capital_movement:0,current_opening:40000,drawings:80000}],...over});
const alloc=eq=>{const a=allocateProfit(eq.current.rows.find(r=>r.move==='PROFIT').total,shares,0);return {rows:a.rows.map(r=>({partner_name:r.partner_name,amount:r.amount})),total:a.total};};
const build=(over={},eq=equity())=>buildPartnerEquity({record:rec(over),shares,equity:eq,alloc:alloc(eq)});

test('build 2888: the equity statement now carries its exact movements in cents',()=>{
 const e=equity();assert.deepEqual(e.exact,{OPENING:110000000,PROFIT:50000000,DIVIDENDS_DRAWINGS:-20000000,CAPITAL:5000000,OTHER:0,CLOSING:145000000});
 assert.equal(e.exact.OPENING+e.exact.PROFIT+e.exact.DIVIDENDS_DRAWINGS+e.exact.CAPITAL+e.exact.OTHER,e.exact.CLOSING);
});
test('build 2888: a declaration names every partner once, with figures to the cent, and drawings as a positive figure',()=>{
 const partners=shares.map(s=>s.partner_name),ok={evidence:'Fictional partners ledger',partners,rows:rec().rows};
 assert.equal(validatePartnerEquity(ok).error,undefined);
 const bad=(o,re)=>assert.match(validatePartnerEquity({...ok,...o}).error,re);
 bad({evidence:'short'},/what supports/);bad({partners:[]},/not approved yet/);bad({rows:'x'},/line for every partner/);
 bad({rows:[rec().rows[0]]},/Add a line for Fictional Zawadi/);
 bad({rows:[...rec().rows,{...rec().rows[0]}]},/appears twice/);
 bad({rows:[{...rec().rows[0],partner_name:'Fictional Stranger'},rec().rows[1]]},/not a partner in the approved profit shares/);
 bad({rows:[{...rec().rows[0],drawings:-5},rec().rows[1]]},/positive figure/);
 bad({rows:[{...rec().rows[0],drawings:''},rec().rows[1]]},/enter the drawings/);
 bad({rows:[{...rec().rows[0],capital_opening:1.005},rec().rows[1]]},/two decimal/);
 const loose=validatePartnerEquity({...ok,rows:[{...rec().rows[1],partner_name:'  fictional   zawadi '},rec().rows[0]]});assert.deepEqual(loose.rows.map(r=>r.partner_name),partners,'names are matched loosely and kept as on the shares, in the shares’ order');
 assert.equal(validatePartnerEquity({...ok,rows:[{...rec().rows[0],capital_opening:-5000},rec().rows[1]]}).rows[0].capital_opening,-5000,'a partner in deficit is allowed');
});
test('build 2888: each partner’s accounts add up, the profit is shared by the approved shares, and the totals tie to the equity statement to the cent',()=>{
 const b=build();assert.equal(b.built,true);assert.equal(b.ties,true,JSON.stringify(b.tie));assert.deepEqual(b.problems,[]);
 const a=b.columns[0],z=b.columns[1];
 assert.deepEqual([a.capital_open,a.capital_move,a.capital_close,a.current_open,a.profit,a.drawings,a.current_close],[600000,50000,650000,60000,300000,-120000,240000]);
 assert.deepEqual([z.capital_close,z.profit,z.current_close],[400000,200000,160000]);
 assert.equal(b.totals.equity,1450000);assert.equal(b.totals.profit,500000);assert.deepEqual(b.tie.map(t=>t.ties),[true,true,true,true,true,true]);assert.equal(b.rounding_shown,false);
 const m=partnerEquityMatrix(b);assert.deepEqual(m.columns,['Fictional Amani','Fictional Zawadi','Total']);
 assert.deepEqual(m.rows.map(r=>r.cells[2]),[1000000,50000,1050000,100000,500000,-200000,400000,1450000]);assert.equal(m.rows.at(-1).total,true);
 const rows=m.rows;assert.equal(rows[2].cells[0]+rows[6].cells[0],a.capital_close+a.current_close,'a partner’s total is capital plus current account');
});
test('build 2888: a difference to the statement is named by movement and never absorbed',()=>{
 const off=build({rows:[{...rec().rows[0],drawings:110000},rec().rows[1]]});
 assert.equal(off.ties,false);assert.deepEqual(off.tie.filter(t=>!t.ties).map(t=>[t.move,t.difference]),[['DIVIDENDS_DRAWINGS',10000],['CLOSING',10000]]);
 assert.match(off.problems[0],/Drawings: the partners’ accounts give -190,000\.00 and the statement of changes in equity -200,000\.00/);
 const missingOpening=build({rows:[{...rec().rows[0],current_opening:50000},rec().rows[1]]});assert.deepEqual(missingOpening.tie.filter(t=>!t.ties).map(t=>t.move),['OPENING','CLOSING']);
 const other=equity();other.exact={...other.exact,OTHER:-300000,CLOSING:other.exact.CLOSING-300000};
 const o=buildPartnerEquity({record:rec(),shares,equity:other,alloc:alloc(other)});assert.equal(o.ties,false);assert.deepEqual(o.tie.filter(t=>!t.ties).map(t=>t.move),['OTHER','CLOSING'],'a movement the statement holds that no partner carries is a difference');
});
test('build 2888: nothing is built without an approved record, the shares or the statement, or when the partners have changed',()=>{
 const e=equity();
 assert.match(buildPartnerEquity({record:null,shares,equity:e,alloc:alloc(e)}).problems[0],/not declared and approved/);
 assert.equal(buildPartnerEquity({record:rec(),shares:[],equity:e,alloc:alloc(e)}).built,false);
 assert.equal(buildPartnerEquity({record:rec(),shares,equity:{},alloc:alloc(e)}).built,false);
 const three=[...shares.map(s=>({...s,share_bp:s.share_bp-1000})),{partner_name:'Fictional Baraka',share_bp:2000}];
 const c=buildPartnerEquity({record:rec(),shares:three,equity:e,alloc:alloc(e)});assert.equal(c.built,false);assert.match(c.problems[0],/Fictional Baraka is missing/);
});
test('build 2888: figures in thousands keep every column adding up and show the rounding rather than hide it',()=>{
 const e=buildEquityStatement({lineDefs,maps,tb:tb().map(r=>r.code==='40000'?{...r,movement_credit:900000.5,net:-900000.5}:r),asOf:'2026-12-31',rounding:'Thousands'});
 const r=rec({rows:[{...rec().rows[0],drawings:120000.4},{...rec().rows[1],drawings:79999.6}]});
 const b=buildPartnerEquity({record:r,shares,equity:e,alloc:alloc(e),rounding:'Thousands'});
 for(const c of b.columns)assert.equal(c.capital_close+c.current_close,c.capital_open+c.capital_move+c.current_open+c.profit+c.drawings,'each partner’s column adds up as printed');
 assert.equal(b.unit_label,'KES thousands');assert.equal(b.ties,true,JSON.stringify(b.tie));assert.equal(b.totals.profit>0,true,'the profit share comes from the approved shares applied to the exact profit, so the 50 cents is shared and the exact tie holds; printed rounding does not decide it');
 assert.equal(b.columns.reduce((n,c)=>n+c.profit,0),b.rounding.profit+b.totals.profit,'the profit shares are the face allocation');
});
test('build 2888: the pack check is left out when the caller gives none or it does not apply, passes when approved and agreeing, blocks otherwise and keeps the pack out of review',()=>{
 const b=build(),ok=partnerEquityState({relevant:true,record:{},built:b});assert.equal(ok.ok,true);assert.equal(partnerEquityCheck(ok).status,'Pass');
 assert.equal(partnerEquityCheck(partnerEquityState({relevant:false})).status,'Info');
 assert.match(partnerEquityState({relevant:true,record:null,draft:false}).problems[0],/not declared/);assert.match(partnerEquityState({relevant:true,record:null,draft:true}).problems[0],/wait for approval/);
 const off=partnerEquityState({relevant:true,record:{},built:build({rows:[{...rec().rows[0],drawings:110000},rec().rows[1]]})});assert.equal(partnerEquityCheck(off).status,'Blocked');
 const period={starts_on:'2026-01-01',ends_on:'2026-12-31',status:'Open'},run=pe=>packReadiness({period,reporting:{},tb:tb(),maps,lines:lineDefs,issues:[],prior:{source:'x'},priorPeriodExists:true,asOf:'2026-12-31',partnerEquity:pe});
 assert.equal(run(null).checks.find(c=>c.code==='PARTNER_EQUITY'),undefined);assert.equal(run({relevant:false,ok:true,problems:[]}).checks.find(c=>c.code==='PARTNER_EQUITY'),undefined);
 assert.equal(run(ok).checks.find(c=>c.code==='PARTNER_EQUITY').status,'Pass');
 const blocked=run(off),g=annualGate({gate:{checks:[]},pack:blocked,statementProblems:[]}).checks.find(c=>c.code==='A_PARTNER_EQUITY');assert.equal(g.ok,false);
 assert.equal(annualGate({gate:{checks:[]},pack:blocked,statementProblems:[]}).ready_for_review,false);
});
