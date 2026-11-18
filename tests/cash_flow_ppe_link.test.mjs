import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildCashFlow} from '../supabase/functions/staff-workspace-v12/annual-pack-flows.mjs';
import {cashFlowInput,registerYear} from '../supabase/functions/staff-workspace-v12/ppe-register-rules.mjs';
// Build 2882: the cash flow takes purchases, sale proceeds and the gain or loss on disposal from the approved PPE register. Fictional figures only.
const lineDefs=JSON.parse(readFileSync(new URL('./fixtures/statement_lines.json',import.meta.url),'utf8'));
const lines=lineDefs.filter(l=>l.statement!=='Excluded'),codeOf=new Map(lines.map((l,i)=>[l.line_code,String(10000+i*10)]));
const maps=lines.map(l=>({account_code:codeOf.get(l.line_code),line_code:l.line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved'}));
const rowFor=(line,open,close)=>{const d=lineDefs.find(x=>x.line_code===line),s=d.normal_side==='Credit'?-1:1,o=s*open,n=s*close,mv=n-o;return {code:codeOf.get(line),name:d.label,opening:o,movement_debit:mv>0?mv:0,movement_credit:mv<0?-mv:0,net:n};};
const plRow=(line,amount)=>{const d=lineDefs.find(x=>x.line_code===line),s=d.normal_side==='Credit'?-1:1,n=s*amount;return {code:codeOf.get(line),name:d.label,opening:0,movement_debit:n>0?n:0,movement_credit:n<0?-n:0,net:n};};
const base={lineDefs,maps,asOf:'2026-12-31'};
// Equipment opens at 800. In the year: 180 bought, an old asset (cost 300, depreciation so far 200, book value 100) sold for 130, depreciation of 100 charged on the others.
// Equipment closes at 800 + 180 - 100 - 100 = 780. The gain of 30 is in other income. Cash closes at 840 either way: -180 + 130 = -50.
const tb=(ppeClose=780,gain=30)=>[
 rowFor('SFP.CASH',500,840),rowFor('SFP.TRADE_REC',200,260),rowFor('SFP.INV',0,150),rowFor('SFP.PPE',800,ppeClose),
 rowFor('SFP.TRADE_PAY',300,340),rowFor('SFP.INCOME_TAX',0,30),rowFor('SFP.BORROW_NC',0,200),rowFor('SFP.SHARE_CAP',400,500),rowFor('SFP.RETAINED',800,680),
 plRow('PL.REVENUE',2000),plRow('PL.COST_SALES',1200),plRow('PL.STAFF',300),plRow('PL.DEPREC',100),plRow('PL.FIN_COSTS',50),plRow('PL.TAX',100),...(gain?[plRow('PL.OTHER_INCOME',gain)]:[])
];
const by=cf=>Object.fromEntries(cf.rows.filter(r=>r.code).map(r=>[r.code,r.current]));
const reg={additions:18000,proceeds:13000,gain_loss:3000,relevant:true,usable:true};

test('without the register the sale is hidden inside purchases, as before',()=>{
 const cf=buildCashFlow({...base,tb:tb()});assert.equal(cf.reconciles,true);
 assert.equal(by(cf)['CF.PPE_PURCHASE'],-80,'180 bought less the book value 100 sold, with the gain left inside profit');assert.equal(by(cf)['CF.PPE_PROCEEDS']??0,0);assert.equal(cf.ppe_link,null);
});
test('the approved register splits purchases, proceeds and the gain, and the statement still reconciles',()=>{
 const cf=buildCashFlow({...base,tb:tb(),ppe:reg}),b=by(cf);
 assert.equal(cf.reconciles,true,cf.problems.join(' | '));assert.deepEqual(cf.problems,[]);
 assert.equal(b['CF.PPE_PURCHASE'],-180);assert.equal(b['CF.PPE_PROCEEDS'],130);assert.equal(b['CF.DISPOSAL'],-30,'a gain is taken out of operating cash');
 assert.equal(b['CF.PBT'],380);assert.equal(cf.net_change,340);assert.equal(cf.cash_close-cf.cash_open,340);
 assert.deepEqual({u:cf.ppe_link.used,d:cf.ppe_link.difference,a:cf.ppe_link.additions,p:cf.ppe_link.proceeds,g:cf.ppe_link.gain_loss},{u:true,d:0,a:180,p:130,g:30});
 assert.equal(cf.exact['CF.PPE_PROCEEDS'],130,'the exact lines used to derive a prior year carry the new lines');
});
test('a loss on disposal is added back in operating and proceeds are shown separately',()=>{
 // Book value 100 sold for 70: loss 30. Equipment closes at 780 as before; the loss sits in other operating expenses (profit lower by 30, cash unchanged by the add-back).
 const t=tb(780,0);t.push(plRow('PL.OTHER_OPEX',30));t[3]=rowFor('SFP.PPE',800,780);
 // Balance: equipment +30 debit... expenses 30 debit: cash falls 60 less than the case with a gain, so close cash at 780.
 const t2=t.map(r=>r.code===codeOf.get('SFP.CASH')?rowFor('SFP.CASH',500,780):r);
 const cf=buildCashFlow({...base,tb:t2,ppe:{additions:18000,proceeds:7000,gain_loss:-3000,relevant:true,usable:true}}),b=by(cf);
 assert.equal(cf.reconciles,true,cf.problems.join(' | '));assert.equal(b['CF.DISPOSAL'],30);assert.equal(b['CF.PPE_PROCEEDS'],70);assert.equal(b['CF.PPE_PURCHASE'],-180);
});
test('a register that disagrees with the trial balance is reported and never absorbed',()=>{
 const cf=buildCashFlow({...base,tb:tb(),ppe:{...reg,additions:15000}});
 assert.equal(cf.reconciles,false,'the statement does not hide the difference');assert.equal(cf.residual,-30);
 assert.match(cf.problems.join(' '),/Property, plant and equipment in the cash flow: the register .* differs from the trial-balance movement by KES 30\.00/);
 assert.equal(cf.ppe_link.difference,30);
});
test('a register that is not ready leaves the trial-balance figure and says so',()=>{
 const cf=buildCashFlow({...base,tb:tb(),ppe:{...reg,usable:false}});
 assert.equal(cf.reconciles,true);assert.equal(by(cf)['CF.PPE_PURCHASE'],-80);assert.match(cf.problems.join(' '),/taken from the trial-balance movement, not from the register/);
 const none=buildCashFlow({...base,tb:tb(),ppe:{relevant:false,usable:false,additions:0,proceeds:0,gain_loss:0}});assert.deepEqual(none.problems,[]);
});
test('cashFlowInput reads the register totals only when the register is ready',()=>{
 const rates=[{class_code:'EQUIP',first_rate:0,annual_rate:0,later_basis_percentage:100,expense_account:'60500',contra_account:'15100',effective_from:'2025-01-01',effective_to:'2027-12-31'}];
 const assets=[{asset_key:'a1',asset_name:'Press',asset_account:'15005',class_code:'EQUIP',acquired_on:'2026-03-01',first_use_on:'2026-03-01',cost:1800,business_percentage:100,noncommercial_vehicle:false,origin:'Added in the year'}];
 const register=registerYear({assets,disposals:[],rates,start:'2026-01-01',end:'2026-12-31'});
 const ok=cashFlowInput({register,readiness:{relevant:true,ok:true}});assert.deepEqual({...ok},{relevant:true,usable:true,additions:180000,proceeds:0,gain_loss:0});
 assert.equal(cashFlowInput({register,readiness:{relevant:true,ok:false}}).usable,false);assert.equal(cashFlowInput({register,readiness:{relevant:false,ok:true}}).relevant,false);
});
test('the screen says where the property, plant and equipment lines came from',()=>{
 const src=readFileSync(new URL('../staff-ledger.mjs',import.meta.url),'utf8');
 assert.match(src,/come from the approved register and agree to the trial balance/);assert.match(src,/cf\.ppe_link&&cf\.ppe_link\.used/);
});
