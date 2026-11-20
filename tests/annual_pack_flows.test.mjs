import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {buildEquityStatement,buildCashFlow,linesByNature} from '../supabase/functions/staff-workspace-v12/annual-pack-flows.mjs';
// Fictional figures only. The statement-line catalogue is the real one (same codes, sections, sort order and normal side); each line gets one account.
const lineDefs=JSON.parse(readFileSync(new URL('./fixtures/statement_lines.json',import.meta.url),'utf8'));
const lines=lineDefs.filter(l=>l.statement!=='Excluded'),codeOf=new Map(lines.map((l,i)=>[l.line_code,String(10000+i*10)]));
const maps=lines.map(l=>({account_code:codeOf.get(l.line_code),line_code:l.line_code,effective_from:'2020-01-01',effective_to:null,status:'Approved'}));
const rowFor=(line,open,close)=>{const d=lineDefs.find(x=>x.line_code===line),s=d.normal_side==='Credit'?-1:1,o=s*open,n=s*close,mv=n-o;
 return {code:codeOf.get(line),name:d.label,opening:o,movement_debit:mv>0?mv:0,movement_credit:mv<0?-mv:0,net:n};};
const plRow=(line,amount)=>{const d=lineDefs.find(x=>x.line_code===line),s=d.normal_side==='Credit'?-1:1,n=s*amount;return {code:codeOf.get(line),name:d.label,opening:0,movement_debit:n>0?n:0,movement_credit:n<0?-n:0,net:n};};
const base={lineDefs,maps,asOf:'2026-12-31'};

// A small year: every figure is easy to follow by hand.
// Open: cash 500, receivables 200, equipment 800, payables 300, share capital 400, retained 800.
// Year: revenue 2,000, cost of sales 1,200, staff 300, depreciation 100, finance costs 50, tax 100 -> profit 250 (profit before tax 350).
// Close: receivables 260 (+60), inventory 150 (+150), equipment 750 (+purchase 50 less depreciation 100), payables 340 (+40), income tax payable 30 (+30),
//        borrowings 200 (+200), share capital 500 (+100), retained 800 less dividends 120 = 680. Cash closes at 840.
const tb=[
 rowFor('SFP.CASH',500,840),rowFor('SFP.TRADE_REC',200,260),rowFor('SFP.INV',0,150),rowFor('SFP.PPE',800,750),
 rowFor('SFP.TRADE_PAY',300,340),rowFor('SFP.INCOME_TAX',0,30),rowFor('SFP.BORROW_NC',0,200),
 rowFor('SFP.SHARE_CAP',400,500),rowFor('SFP.RETAINED',800,680),
 plRow('PL.REVENUE',2000),plRow('PL.COST_SALES',1200),plRow('PL.STAFF',300),plRow('PL.DEPREC',100),plRow('PL.FIN_COSTS',50),plRow('PL.TAX',100)
];
const sum=(rows,k)=>rows.reduce((a,r)=>a+r[k],0);

test('the trial balance of the worked year balances',()=>{assert.equal(sum(tb,'net'),0);});

test('cash flow by the indirect method, worked by hand, reconciles to the change in cash',()=>{
 const cf=buildCashFlow({...base,tb,rounding:'Whole shillings'}),by=Object.fromEntries(cf.rows.filter(r=>r.code).map(r=>[r.code,r.current]));
 // Rounded to shillings, so every cell is a whole number of shillings: 100 cents in the unit.
 assert.equal(cf.reconciles,true,cf.problems.join(' | '));
 assert.equal(by['CF.PBT'],350);assert.equal(by['CF.DEPREC'],100);assert.equal(by['CF.FIN_COSTS'],50);
 assert.equal(by['CF.WC_INV'],-150);assert.equal(by['CF.WC_REC'],-60);assert.equal(by['CF.WC_PAY'],40);
 assert.equal(by['CF.TAX_PAID'],-70,'tax charge 100 less the 30 still owing');assert.equal(by['CF.INTEREST_PAID'],-50);
 assert.equal(by['CF.PPE_PURCHASE'],-50,'equipment 800 to 750 after 100 depreciation means 50 bought');
 assert.equal(by['CF.BORROW_PROCEEDS'],200);assert.equal(by['CF.CAPITAL_ISSUED'],100);assert.equal(by['CF.DIVIDENDS_PAID'],-120);
 const net=cf.rows.find(r=>r.label==='Net increase or (decrease) in cash'),open=cf.rows.find(r=>r.code==='CF.CASH_OPEN'),close=cf.rows.find(r=>r.code==='CF.CASH_CLOSE');
 assert.equal(net.current,340);assert.equal(open.current,500);assert.equal(close.current,840);assert.equal(open.current+net.current,close.current);
 assert.equal(cf.cash_open,500);assert.equal(cf.cash_close,840);assert.equal(cf.net_change,340);
 assert.deepEqual(cf.problems,[],'no problems when the year reconciles');
});

test('changes in equity, worked by hand, closes to the statement of financial position',()=>{
 const eq=buildEquityStatement({...base,tb}),cell=(m,c)=>eq.current.rows.find(r=>r.move===m).cells[c];
 assert.deepEqual(eq.current.columns.map(c=>c.code),['SFP.SHARE_CAP','SFP.RETAINED','SFP.CURRENT_PROFIT']);
 assert.equal(cell('OPENING','SFP.SHARE_CAP'),400);assert.equal(cell('OPENING','SFP.RETAINED'),800);
 assert.equal(cell('PROFIT','SFP.CURRENT_PROFIT'),250);
 assert.equal(cell('CAPITAL','SFP.SHARE_CAP'),100);assert.equal(cell('DIVIDENDS_DRAWINGS','SFP.RETAINED'),-120);
 assert.equal(cell('CLOSING','SFP.SHARE_CAP'),500);assert.equal(cell('CLOSING','SFP.RETAINED'),680);assert.equal(cell('CLOSING','SFP.CURRENT_PROFIT'),250);
 assert.equal(eq.current.rows.find(r=>r.move==='CLOSING').total,1430);
 assert.equal(eq.exact_closing,1430);assert.equal(eq.has_prior,false);
 // Every column foots down its movements.
 for(const c of eq.current.columns)assert.equal(['OPENING','PROFIT','DIVIDENDS_DRAWINGS','CAPITAL','OTHER'].reduce((a,m)=>a+cell(m,c.code),0),cell('CLOSING',c.code));
});

test('prior-year columns come from the approved comparatives and are checked against this year\'s opening',()=>{
 const priorEquity=[{line_code:'SFP.SHARE_CAP',movement:'OPENING',amount:400},{line_code:'SFP.RETAINED',movement:'OPENING',amount:500},{line_code:'SFP.RETAINED',movement:'PROFIT',amount:400},{line_code:'SFP.RETAINED',movement:'DIVIDENDS_DRAWINGS',amount:-100}];
 const eq=buildEquityStatement({...base,tb,priorEquity});
 assert.equal(eq.has_prior,true);assert.equal(eq.prior.rows.find(r=>r.move==='CLOSING').cells['SFP.RETAINED'],800);assert.equal(eq.prior.rows.find(r=>r.move==='CLOSING').total,1200);
 assert.deepEqual(eq.problems,[],'the year opens where the prior year closed');
 const off=buildEquityStatement({...base,tb,priorEquity:priorEquity.map(x=>x.movement==='PROFIT'?{...x,amount:350}:x)});
 assert.match(off.problems.join(' '),/Retained earnings opens at KES 800\.00 but closed the prior year at KES 750\.00/);
 const cfPrior=close=>[{line_code:'CF.PBT',amount:600},{line_code:'CF.WC_REC',amount:-100},{line_code:'CF.CASH_OPEN',amount:0},{line_code:'CF.CASH_CLOSE',amount:close}];
 const cf=buildCashFlow({...base,tb,priorCashFlow:cfPrior(450)});
 assert.equal(cf.has_prior,true);assert.equal(cf.rows.find(r=>r.code==='CF.PBT').prior,600);
 assert.match(cf.problems.join(' '),/does not add up to its closing cash/);assert.match(cf.problems.join(' '),/Cash at the start of the year \(KES 500\.00\) differs from cash at the end of the prior year \(KES 450\.00\)/);
 assert.deepEqual(buildCashFlow({...base,tb,priorCashFlow:cfPrior(500)}).problems,[],'the prior year adds up and closes where this year opens');
});

test('a year that does not reconcile, or has unmapped accounts or other equity movements, says so and never forces agreement',()=>{
 const broken=tb.map(r=>r.code===codeOf.get('SFP.CASH')?{...r,net:r.net+10,movement_debit:r.movement_debit+10}:r);
 const cf=buildCashFlow({...base,tb:broken});assert.equal(cf.reconciles,false);assert.equal(cf.residual,10);assert.match(cf.problems[0],/does not reconcile to the change in cash by KES 10\.00/);
 const stray=[...tb,{code:'99999',name:'Not mapped',opening:0,movement_debit:5,movement_credit:0,net:5}];
 assert.match(buildCashFlow({...base,tb:stray}).problems.join(' '),/1 account\(s\) have no approved statement line/);assert.match(buildEquityStatement({...base,tb:stray}).problems.join(' '),/no approved statement line/);
 const reserve=tb.concat([rowFor('SFP.RESERVES',0,40)]).map(r=>r.code===codeOf.get('SFP.CASH')?{...r,net:r.net+40,movement_debit:r.movement_debit+40}:r);
 const withReserve=buildCashFlow({...base,tb:reserve});assert.equal(withReserve.reconciles,true);assert.match(withReserve.problems.join(' '),/Other equity movements of KES 40\.00 are included in financing/);
});

test('drawings and dividends payable are cash effects of the right sign; a thousands presentation foots',()=>{
 const t=[rowFor('SFP.CASH',1000,700),rowFor('SFP.DRAWINGS',0,200),rowFor('SFP.DIVIDENDS_PAY',0,50),rowFor('SFP.RETAINED',1000,850),rowFor('SFP.OWNER_CAP',0,0),plRow('PL.REVENUE',100),plRow('PL.STAFF',100)];
 // cash 1000 -> 700; drawings 200 (debit); dividends payable +50 owing; retained 1000 -> 850 (dividends declared 150); cash out 200 + (150 - 50).
 const bal=t.map(r=>r);const total=sum(bal,'net');
 assert.equal(total,0,'worked year balances: '+total);
 const cf=buildCashFlow({...base,tb:bal}),by=Object.fromEntries(cf.rows.filter(r=>r.code).map(r=>[r.code,r.current]));
 assert.equal(cf.reconciles,true,cf.problems.join(' | '));assert.equal(by['CF.DRAWINGS'],-200);assert.equal(by['CF.DIVIDENDS_PAID'],-100,'150 declared less 50 still owing');
 const eq=buildEquityStatement({...base,tb:bal});assert.equal(eq.current.rows.find(r=>r.move==='DIVIDENDS_DRAWINGS').cells['SFP.DRAWINGS'],-200);
});

// Property: for any balanced trial balance the indirect cash flow reconciles exactly, and the equity statement closes to the position.
function lcg(seed){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
test('property: for 300 random balanced years the cash flow reconciles to the cent and equity foots',()=>{
 const free=lineDefs.filter(l=>l.statement==='Financial position'&&!['SFP.CASH','SFP.OVERDRAFT'].includes(l.line_code)),pls=lineDefs.filter(l=>l.statement==='Profit or loss'&&l.line_code!=='PL.UNRESOLVED');
 for(let seed=1;seed<=300;seed++){
  const rnd=lcg(seed*7919),amt=()=>Math.round(rnd()*2000000)/100,rows=[];
  let openOther=0,closeOther=0,profit=0; // credit-positive sums for liabilities and equity less assets
  for(const d of free){const o=amt(),c=Math.round((o+(rnd()-0.5)*amt())*100)/100,s=d.normal_side==='Credit'?1:-1;rows.push(rowFor(d.line_code,o,c));openOther+=s*o;closeOther+=s*c;}
  for(const d of pls){const v=rnd()<0.2?0:amt(),s=d.normal_side==='Credit'?1:-1;rows.push(plRow(d.line_code,v));profit+=s*v;}
  // Cash is what makes each balance sheet balance: assets = liabilities + equity (+ the year's profit at the close).
  const cashOpen=Math.round(openOther*100)/100,cashClose=Math.round((closeOther+profit)*100)/100;
  rows.push(rowFor('SFP.CASH',cashOpen,cashClose));
  assert.ok(Math.abs(sum(rows,'net'))<=1,`seed ${seed}: the generated books are out by ${sum(rows,'net')}`);
  const fix=sum(rows,'net');if(fix){const r=rows[rows.length-1];r.net-=fix;if(fix>0)r.movement_debit-=fix;else r.movement_credit+=fix;}
  assert.equal(sum(rows,'net'),0);
  const cf=buildCashFlow({...base,tb:rows});
  assert.equal(cf.reconciles,true,`seed ${seed}: ${cf.problems.join(' | ')} residual ${cf.residual}`);
  for(const rounding of ['Whole shillings','Thousands']){
   const r=buildCashFlow({...base,tb:rows,rounding}).rows,at=l=>r.find(x=>x.label===l).current,net=at('Net increase or (decrease) in cash');
   assert.equal(at('Cash and cash equivalents at the start of the year')+net,at('Cash and cash equivalents at the end of the year'),`seed ${seed} ${rounding}: opening plus net movement equals closing`);
   const sections=r.filter(x=>x.kind==='subtotal').reduce((a,x)=>a+x.current,0),rounding_=r.find(x=>x.label==='Presentation rounding')?.current||0;
   assert.equal(sections+rounding_,net,`seed ${seed} ${rounding}: sections plus rounding equal the net movement`);
   const lineSum=r.filter(x=>x.kind==='line'&&x.code&&!/CASH_/.test(x.code)).reduce((a,x)=>a+x.current,0);
   assert.equal(lineSum,sections,`seed ${seed} ${rounding}: lines foot to their section totals`);
  }
  const eq=buildEquityStatement({...base,tb:rows}),closing=eq.current.rows.find(r=>r.move==='CLOSING');
  for(const c of eq.current.columns)assert.equal(['OPENING','PROFIT','DIVIDENDS_DRAWINGS','CAPITAL','OTHER'].reduce((a,m)=>a+eq.current.rows.find(r=>r.move===m).cells[c.code],0),closing.cells[c.code],`seed ${seed} ${c.code}`);
  assert.equal(closing.total,Object.values(closing.cells).reduce((a,b)=>a+b,0));
 }
});

test('lines by nature skips accounts with nothing on them and reports unmapped and excluded ones separately',()=>{
 const out=linesByNature({tb:[{code:'10000',name:'Idle',opening:0,movement_debit:0,movement_credit:0,net:0},{code:'77777',name:'Nowhere',opening:0,movement_debit:1,movement_credit:0,net:1}],maps,lineDefs,asOf:'2026-12-31'});
 assert.equal(out.by.size,0);assert.equal(out.unmapped.length,1);assert.equal(out.excluded.length,0);
});

test('a line the catalogue does not classify for cash flow is reported, not guessed',()=>{
 const defs=lineDefs.map(l=>l.line_code==='SFP.GRANTS_ADV'?{...l,cash_flow_class:undefined}:l);
 const t=tb.map(r=>r).concat([rowFor('SFP.GRANTS_ADV',0,70)]).map(r=>r.code===codeOf.get('SFP.CASH')?{...r,net:r.net+70,movement_debit:r.movement_debit+70}:r);
 const cf=buildCashFlow({...base,lineDefs:defs,tb:t});
 assert.equal(cf.reconciles,false);assert.match(cf.problems.join(' '),/Grants received in advance has no cash-flow class, so its movement of KES 70\.00 is not placed in the cash flow/);
 assert.equal(buildCashFlow({...base,tb:t}).reconciles,true,'with its catalogue class it is an operating movement and the year reconciles');
});

test('depreciation and impairment are added back because the catalogue says they are non-cash',()=>{
 // Equity 100 plus profit 60 is 160; equipment fell by 40 (30 depreciation, 10 impairment), so cash is 160 less the 60 of equipment left = 100.
 const u=[rowFor('SFP.CASH',0,100),rowFor('SFP.PPE',100,60),rowFor('SFP.SHARE_CAP',100,100),plRow('PL.REVENUE',100),plRow('PL.DEPREC',30),plRow('PL.IMPAIR',10)];
 assert.equal(sum(u,'net'),0);
 const cf=buildCashFlow({...base,tb:u}),by=Object.fromEntries(cf.rows.filter(r=>r.code).map(r=>[r.code,r.current]));
 assert.equal(cf.reconciles,true,cf.problems.join(' | '));assert.equal(by['CF.PBT'],60);assert.equal(by['CF.DEPREC'],30);assert.equal(by['CF.IMPAIR'],10);assert.equal(by['CF.PPE_PURCHASE'],undefined,'no equipment was bought');
});
