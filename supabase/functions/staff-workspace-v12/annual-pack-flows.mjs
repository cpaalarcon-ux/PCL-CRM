// Statement of changes in equity and statement of cash flows (indirect method), current year beside the prior year.
// Pure: no database, no tax rates. Every current-year figure comes from the trial balance through the Partner-approved statement-line map; the prior year
// comes from the approved comparatives. Nothing is estimated: a balance with no approved line is reported, and a cash flow that does not reconcile to the
// change in cash is reported as a problem and never forced to agree.
import {mapInForce} from './annual-pack-rules.mjs';
import {CASH_FLOW_LINES} from './annual-pack-comparatives.mjs';

const cents=v=>Math.round(Number(v||0)*100);
const UNITS={'Whole shillings':100,'Thousands':100000};
const roundTo=(c,unit)=>{const r=Math.floor(Math.abs(c)/unit+0.5+1e-9);return c<0?-r:r;};
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const PROFIT_COLUMN='SFP.CURRENT_PROFIT';
const CAPITAL_LINES=new Set(['SFP.SHARE_CAP','SFP.SHARE_PREM','SFP.OWNER_CAP','SFP.HEAD_OFFICE']);

// Natural cents per statement line: a debit-normal line counts debits as positive, a credit-normal line credits. open and close are balances; mov is the
// movement in the year. The year's profit is not closed into retained earnings in the trial balance.
export function linesByNature({tb,maps,lineDefs,asOf}){
 const defs=new Map(lineDefs.map(l=>[l.line_code,l])),by=new Map(),unmapped=[],excluded=[];
 for(const r of tb||[]){
  const open=cents(r.opening),mv=cents(r.movement_debit)-cents(r.movement_credit),net=cents(r.net);
  if(!open&&!mv&&!net)continue;
  const m=mapInForce(maps,r.code,asOf),d=m&&defs.get(m.line_code);
  if(!d){unmapped.push({code:r.code,name:r.name||'',amount:net/100});continue;}
  if(d.statement==='Excluded'){excluded.push({code:r.code,name:r.name||''});continue;}
  const sign=d.normal_side==='Credit'?-1:1,cur=by.get(d.line_code)||{open:0,mov:0,close:0};
  cur.open+=sign*open;cur.mov+=sign*mv;cur.close+=sign*net;by.set(d.line_code,cur);
 }
 return {by,unmapped,excluded};
}
const profitOf=(by,lineDefs)=>lineDefs.filter(d=>d.statement==='Profit or loss'&&d.line_code!=='PL.UNRESOLVED').reduce((a,d)=>a+(d.normal_side==='Credit'?1:-1)*(by.get(d.line_code)?.mov||0),0);

// ---------------------------------------------------------------- changes in equity
const MOVE_ROWS=[['OPENING','Balance at the start of the year'],['PROFIT','Profit for the year'],['DIVIDENDS_DRAWINGS','Dividends or drawings'],['CAPITAL','Capital introduced or repaid'],['OTHER','Other movements'],['CLOSING','Balance at the end of the year']];
function classify(code,movement){
 if(code==='SFP.DRAWINGS')return 'DIVIDENDS_DRAWINGS';
 if(CAPITAL_LINES.has(code))return 'CAPITAL';
 if(code==='SFP.RETAINED')return movement<0?'DIVIDENDS_DRAWINGS':'OTHER';
 return 'OTHER';
}
// Rows are movements, columns are equity lines plus the year's profit (which the statement of financial position also shows as its own line) and a total.
export function buildEquityStatement({lineDefs,maps,tb,asOf,rounding='Whole shillings',priorEquity=null}){
 const unit=UNITS[rounding]||100,{by,unmapped}=linesByNature({tb,maps,lineDefs,asOf});
 const profit=profitOf(by,lineDefs),equity=lineDefs.filter(d=>d.statement==='Financial position'&&d.section==='Equity').sort((a,b)=>a.sort_order-b.sort_order);
 const disp=d=>d.normal_side==='Credit'?1:-1;
 const cols=[];
 for(const d of equity){const v=by.get(d.line_code);if(v&&(v.open||v.mov||v.close))cols.push({code:d.line_code,label:d.label,def:d,v});}
 if(profit)cols.push({code:PROFIT_COLUMN,label:'Profit for the year',def:null,v:null});
 const cell={};for(const [m] of MOVE_ROWS)cell[m]={};
 let exactClose=0,exactOpen=0;
 for(const c of cols){
  let openC,closeC,prof=0;
  if(c.def){const s=disp(c.def);openC=s*c.v.open;closeC=s*c.v.close;}else{openC=0;closeC=profit;prof=profit;}
  const mv=closeC-openC-prof;
  exactOpen+=openC;exactClose+=closeC;
  const kind=c.def?classify(c.code,mv):'OTHER';
  const r={OPENING:roundTo(openC,unit),PROFIT:roundTo(prof,unit),DIVIDENDS_DRAWINGS:0,CAPITAL:0,OTHER:0};
  if(c.def)r[kind]=roundTo(mv,unit);
  const closing=roundTo(closeC,unit),parts=r.OPENING+r.PROFIT+r.DIVIDENDS_DRAWINGS+r.CAPITAL+r.OTHER;
  // Presentation rounding only: any difference is a unit or two and is absorbed in the movement that carries the line's change.
  const plug=closing-parts;if(plug){const tgt=c.def?kind:'OTHER';r[tgt]+=plug;}
  for(const m of Object.keys(r))cell[m][c.code]=r[m];
  cell.CLOSING[c.code]=closing;
 }
 const rows=MOVE_ROWS.map(([move,label])=>({move,label,cells:Object.fromEntries(cols.map(c=>[c.code,cell[move][c.code]||0])),total:cols.reduce((a,c)=>a+(cell[move][c.code]||0),0)}));
 const current={columns:cols.map(c=>({code:c.code,label:c.label})),rows};
 // Prior year, as approved: the effect of each movement on each equity line.
 let prior=null;const problems=[];
 if(priorEquity&&priorEquity.length){
  const defs=new Map(lineDefs.map(l=>[l.line_code,l])),pc=[...new Set(priorEquity.map(x=>x.line_code))].sort((a,b)=>(defs.get(a)?.sort_order||0)-(defs.get(b)?.sort_order||0));
  const pr=MOVE_ROWS.map(([move,label])=>{const cells={};for(const code of pc){cells[code]=move==='CLOSING'?priorEquity.filter(x=>x.line_code===code).reduce((a,x)=>a+roundTo(cents(x.amount),unit),0):priorEquity.filter(x=>x.line_code===code&&x.movement===move).reduce((a,x)=>a+roundTo(cents(x.amount),unit),0);}return {move,label,cells,total:Object.values(cells).reduce((a,b)=>a+b,0)};});
  prior={columns:pc.map(code=>({code,label:defs.get(code)?.label||code})),rows:pr};
  // The year opens where the prior year closed, line by line.
  const openRow=rows.find(r=>r.move==='OPENING'),priorClose=pr.find(r=>r.move==='CLOSING');
  for(const c of cols){if(c.code===PROFIT_COLUMN)continue;const a=openRow.cells[c.code]||0,b=priorClose.cells[c.code]||0;if(a!==b)problems.push(`${c.label} opens at KES ${kes(a*unit)} but closed the prior year at KES ${kes(b*unit)}.`);}
  for(const code of pc){if(code!==PROFIT_COLUMN&&!cols.some(c=>c.code===code)&&priorClose.cells[code])problems.push(`${defs.get(code)?.label||code} closed the prior year at KES ${kes(priorClose.cells[code]*unit)} but has no balance this year.`);}
 }
 if(unmapped.length)problems.push(`${unmapped.length} account(s) have no approved statement line, so equity may be incomplete.`);
 return {title:'Statement of changes in equity',current,prior,has_prior:!!prior,total_closing:rows.find(r=>r.move==='CLOSING').total,exact_closing:exactClose/100,exact_opening:exactOpen/100,problems};
}

// ---------------------------------------------------------------- cash flow (indirect)
const SECTIONS=[['Operating','Cash flows from operating activities'],['Investing','Cash flows from investing activities'],['Financing','Cash flows from financing activities']];
const CF_LABEL=new Map(CASH_FLOW_LINES.map(([c,,l])=>[c,l])),CF_SECTION=new Map(CASH_FLOW_LINES.map(([c,s])=>[c,s]));
const OTHER_FIN='CF.OTHER_FIN';
export function buildCashFlow({lineDefs,maps,tb,asOf,rounding='Whole shillings',priorCashFlow=null}){
 const unit=UNITS[rounding]||100,{by,unmapped}=linesByNature({tb,maps,lineDefs,asOf});
 const nat=c=>by.get(c)||{open:0,mov:0,close:0};
 const pl=c=>nat(c).mov; // income and costs both positive in their own direction
 const profit=profitOf(by,lineDefs),tax=pl('PL.TAX'),pbt=profit+tax;
 const cashOpen=nat('SFP.CASH').open-nat('SFP.OVERDRAFT').open,cashClose=nat('SFP.CASH').close-nat('SFP.OVERDRAFT').close;
 const f={},problems=[];for(const [c] of CASH_FLOW_LINES)f[c]=0;f[OTHER_FIN]=0;
 f['CF.PBT']=pbt;
 // Non-cash charges and the split of finance items come from the catalogue: a profit or loss line classed "None" is added back.
 for(const d of lineDefs.filter(x=>x.statement==='Profit or loss'&&x.line_code!=='PL.UNRESOLVED'&&x.cash_flow_class==='None')){const add=(d.normal_side==='Credit'?-1:1)*pl(d.line_code),code={ 'PL.DEPREC':'CF.DEPREC','PL.IMPAIR':'CF.IMPAIR'}[d.line_code]||'CF.NONCASH_OTHER';f[code]+=add;}
 f['CF.FIN_COSTS']=pl('PL.FIN_COSTS');f['CF.FIN_INCOME']=-pl('PL.FIN_INCOME');f['CF.INTEREST_PAID']=-pl('PL.FIN_COSTS');f['CF.INTEREST_RECEIVED']=pl('PL.FIN_INCOME');
 // Every other statement-of-financial-position line moves cash by its change in balance: less for an asset that grew, more for a liability that grew.
 const SUB={'SFP.INV':'CF.WC_INV','SFP.BIO_C':'CF.WC_INV','SFP.TRADE_REC':'CF.WC_REC','SFP.CONTRACT_ASSET':'CF.WC_REC','SFP.OTHER_REC':'CF.WC_REC','SFP.RELATED_REC':'CF.WC_REC','SFP.TAX_REC':'CF.WC_REC',
  'SFP.TRADE_PAY':'CF.WC_PAY','SFP.ACCRUALS':'CF.WC_PAY','SFP.VAT':'CF.WC_PAY','SFP.PAYROLL_PAY':'CF.WC_PAY','SFP.OTHER_STATUTORY':'CF.WC_PAY','SFP.INCOME_TAX':'TAX','SFP.DEFTAX':'TAX','SFP.PPE':'CF.PPE_PURCHASE',
  'SFP.BORROW_NC':'BORROW','SFP.BORROW_C':'BORROW','SFP.RELATED_PAY':'BORROW','SFP.LEASE_NC':'CF.LEASE_PAID','SFP.LEASE_C':'CF.LEASE_PAID','SFP.DIVIDENDS_PAY':'DIVPAY'};
 const FALLBACK={Operating:'CF.WC_OTHER',Investing:'CF.INVEST_NET',Financing:OTHER_FIN},acc={};
 const ASSET_SECTIONS=new Set(['Non-current assets','Current assets']);
 for(const d of lineDefs.filter(x=>x.statement==='Financial position'&&x.section!=='Equity'&&!['SFP.CASH','SFP.OVERDRAFT'].includes(x.line_code))){
  const v=by.get(d.line_code);if(!v)continue;const delta=v.close-v.open;if(!delta)continue;
  const bucket=SUB[d.line_code]||FALLBACK[d.cash_flow_class];
  if(!bucket){problems.push(`${d.label} has no cash-flow class, so its movement of KES ${kes(delta)} is not placed in the cash flow.`);continue;}
  acc[bucket]=(acc[bucket]||0)+(ASSET_SECTIONS.has(d.section)?-delta:delta);
 }
 for(const c of ['CF.WC_INV','CF.WC_REC','CF.WC_PAY','CF.WC_OTHER','CF.PPE_PURCHASE','CF.INVEST_NET','CF.LEASE_PAID',OTHER_FIN])f[c]+=acc[c]||0;
 f['CF.PPE_PURCHASE']-=f['CF.DEPREC']+f['CF.IMPAIR']; // depreciation reduced the equipment balance without any cash moving, so purchases are the change plus the charge
 f['CF.TAX_PAID']=-tax+(acc.TAX||0);
 f['CF.BORROW_PROCEEDS']=Math.max(acc.BORROW||0,0);f['CF.BORROW_REPAID']=Math.min(acc.BORROW||0,0);
 // Equity movements other than the year's profit, with the same classification as the statement of changes in equity.
 let capital=0,div=0,drawings=0,other=0;
 for(const d of lineDefs.filter(x=>x.statement==='Financial position'&&x.section==='Equity')){
  const v=by.get(d.line_code);if(!v)continue;const sg=d.normal_side==='Credit'?1:-1,mv=sg*(v.close-v.open);if(!mv)continue;
  const k=classify(d.line_code,mv);if(k==='CAPITAL')capital+=mv;else if(k==='DIVIDENDS_DRAWINGS'&&d.line_code==='SFP.DRAWINGS')drawings+=mv;else if(k==='DIVIDENDS_DRAWINGS')div+=mv;else other+=mv;
 }
 f['CF.CAPITAL_ISSUED']=capital;f['CF.DIVIDENDS_PAID']=div+(acc.DIVPAY||0);f['CF.DRAWINGS']=drawings;f[OTHER_FIN]+=other;
 const total=s=>CASH_FLOW_LINES.filter(([c,sec])=>sec===s).reduce((a,[c])=>a+(f[c]||0),0)+(s==='Financing'?f[OTHER_FIN]:0);
 const op=total('Operating'),inv=total('Investing'),fin=total('Financing'),net=op+inv+fin,residual=(cashClose-cashOpen)-net;

 // Prior year as approved.
 const pri=priorCashFlow&&priorCashFlow.length?new Map():null;
 if(pri)for(const l of priorCashFlow)pri.set(l.line_code,(pri.get(l.line_code)||0)+cents(l.amount));
 const pget=c=>pri?(pri.get(c)||0):null,rows=[];
 const r=c=>roundTo(c,unit);
 const add=(kind,label,cur,prior,code=null)=>rows.push({kind,label,code,current:cur,prior:pri?prior:null});
 const subtotal={};
 for(const [sec,title] of SECTIONS){
  rows.push({kind:'heading',label:title});
  const lines=CASH_FLOW_LINES.filter(([,s])=>s===sec).map(([c])=>c);if(sec==='Financing')lines.push(OTHER_FIN);
  let cur=0,pv=0;
  for(const code of lines){
   const c=r(f[code]||0),p=pri?r(pget(code)||0):0;
   if(!c&&!p)continue;
   cur+=c;pv+=p;add('line',code===OTHER_FIN?'Other financing and equity movements (review)':CF_LABEL.get(code),c,p,code);
  }
  subtotal[sec]={cur,pv};add('subtotal',`Net cash from ${sec.toLowerCase()} activities`,cur,pv);
 }
 let netC=subtotal.Operating.cur+subtotal.Investing.cur+subtotal.Financing.cur,netP=subtotal.Operating.pv+subtotal.Investing.pv+subtotal.Financing.pv;
 // Opening and closing cash are balances and are rounded separately. When the exact cash flow reconciles, any difference is presentation rounding
 // of at most a few units and is shown as its own line so that the statement foots.
 const oC=r(cashOpen),cC=r(cashClose),po=pri?r(pget('CF.CASH_OPEN')||0):0,pc=pri?r(pget('CF.CASH_CLOSE')||0):0;
 const dC=cC-oC-netC,dP=pri?pc-po-netP:0;
 if(residual===0&&(dC||dP)&&Math.abs(dC)<=10&&Math.abs(dP)<=10){add('line','Presentation rounding',dC,dP);netC+=dC;netP+=dP;}
 add('total','Net increase or (decrease) in cash',netC,netP);
 add('line','Cash and cash equivalents at the start of the year',oC,po,'CF.CASH_OPEN');add('total','Cash and cash equivalents at the end of the year',cC,pc,'CF.CASH_CLOSE');
 if(residual!==0)problems.push(`The cash flow does not reconcile to the change in cash by KES ${kes(residual)}. Check unmapped, excluded or unbalanced accounts.`);
 if(unmapped.length)problems.push(`${unmapped.length} account(s) have no approved statement line, so the cash flow may be incomplete.`);
 if(other)problems.push(`Other equity movements of KES ${kes(other)} are included in financing. Confirm they were cash movements.`);
 if(pri){
  const priorNet=[...pri.entries()].filter(([c])=>CF_SECTION.get(c)&&['Operating','Investing','Financing'].includes(CF_SECTION.get(c))).reduce((a,[,v])=>a+v,0);
  if((pri.get('CF.CASH_OPEN')||0)+priorNet!==(pri.get('CF.CASH_CLOSE')||0))problems.push('The approved prior-year cash flow does not add up to its closing cash.');
  if((pri.get('CF.CASH_CLOSE')||0)!==cashOpen)problems.push(`Cash at the start of the year (KES ${kes(cashOpen)}) differs from cash at the end of the prior year (KES ${kes(pri.get('CF.CASH_CLOSE')||0)}).`);
 }
 return {title:'Statement of cash flows',rows,has_prior:!!pri,net_change:net/100,cash_open:cashOpen/100,cash_close:cashClose/100,reconciles:residual===0,residual:residual/100,problems,
  sections:{operating:op/100,investing:inv/100,financing:fin/100}};
}
