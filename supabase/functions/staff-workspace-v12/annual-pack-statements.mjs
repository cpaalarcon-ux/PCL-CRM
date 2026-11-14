// Formatted annual statements: the statement of profit or loss and the statement of financial position, current year beside the prior year.
// Pure: no database, no tax rates. Every figure comes from the posted trial balance through the Partner-approved statement-line map; the prior year
// comes from the approved comparatives (profit or loss) and the approved opening balances (financial position). Nothing is estimated: an account
// with no approved line, or a missing comparative, is reported and never shown as zero.
import {mapInForce} from './annual-pack-rules.mjs';

const cents=v=>Math.round(Number(v||0)*100);
const UNITS={'Whole shillings':100,'Thousands':100000};
const ASSET_SECTIONS=new Set(['Non-current assets','Current assets']);
// Round half away from zero to the presentation unit.
const roundTo=(c,unit)=>{const r=Math.floor(Math.abs(c)/unit+0.5+1e-9);return c<0?-r:r;};

// Convention for every per-line figure ("natural" cents): a credit-normal line counts credits as positive, a debit-normal line counts debits as positive.
// Profit or loss lines use the year's movement, balance sheet lines the closing balance.
export function currentByLine({tb,maps,lineDefs,asOf}){
 const defs=new Map(lineDefs.map(l=>[l.line_code,l])),by=new Map(),unmapped=[],excluded=[];
 for(const r of tb||[]){
  const mv=cents(r.movement_debit)-cents(r.movement_credit),net=cents(r.net);
  if(!cents(r.opening)&&!mv&&!net)continue;
  const m=mapInForce(maps,r.code,asOf),d=m&&defs.get(m.line_code);
  if(!d){unmapped.push({code:r.code,name:r.name||'',amount:net/100});continue;}
  if(d.statement==='Excluded'){if(net||mv)excluded.push({code:r.code,name:r.name||''});continue;}
  const signed=d.statement==='Profit or loss'?mv:net;
  by.set(d.line_code,(by.get(d.line_code)||0)+(d.normal_side==='Credit'?-signed:signed));
 }
 return {by,unmapped,excluded};
}

// Display sign: in profit or loss income is positive and costs negative; in the statement of financial position assets are positive, and equity and
// liabilities are positive with a drawing or a debit liability negative.
const plSign=d=>d.normal_side==='Credit'?1:-1;
const sfpSign=d=>ASSET_SECTIONS.has(d.section)?(d.normal_side==='Debit'?1:-1):(d.normal_side==='Credit'?1:-1);

function plStatement({lineDefs,cur,pri,unit}){
 const lines=lineDefs.filter(d=>d.statement==='Profit or loss'&&d.line_code!=='PL.UNRESOLVED').sort((a,b)=>a.sort_order-b.sort_order);
 const v=(m,d)=>m?roundTo((m.get(d.line_code)||0)*plSign(d),unit):null;
 const rows=[],run={cur:0,pri:0};
 const add=(kind,label,cv,pv,code=null)=>rows.push({kind,label,code,current:cv,prior:pri?pv:null});
 const section=(name,title)=>{
  const shown=lines.filter(d=>d.section===name&&((v(cur,d)||0)!==0||(pri&&(v(pri,d)||0)!==0)));
  if(!shown.length)return;
  rows.push({kind:'heading',label:title});
  for(const d of shown){const cv=v(cur,d),pv=pri?v(pri,d):0;run.cur+=cv;run.pri+=pv;add('line',d.label,cv,pv,d.line_code);}
 };
 const sub=(label,kind='subtotal')=>add(kind,label,run.cur,run.pri);
 section('Revenue','Revenue');section('Cost of sales','Cost of sales');sub('Gross profit');
 section('Other income','Other income');section('Operating costs','Operating costs');sub('Operating profit');
 section('Finance','Finance income and costs');sub('Profit before tax');
 section('Tax','Income tax');sub('Profit for the year','total');
 return {rows,profit:run.cur,prior_profit:pri?run.pri:null};
}

function sfpStatement({lineDefs,cur,priorOpen,unit,profitCents}){
 const lines=lineDefs.filter(d=>d.statement==='Financial position').sort((a,b)=>a.sort_order-b.sort_order);
 const v=(m,d)=>m?roundTo((m.get(d.line_code)||0)*sfpSign(d),unit):null;
 const rows=[],tot={};
 const section=(name)=>{
  const shown=lines.filter(d=>d.section===name&&((v(cur,d)||0)!==0||(priorOpen&&(v(priorOpen,d)||0)!==0)));
  const withProfit=name==='Equity'&&profitCents!==0;
  if(!shown.length&&!withProfit)return;
  rows.push({kind:'heading',label:name});
  let c=0,p=0;
  for(const d of shown){const cv=v(cur,d),pv=priorOpen?v(priorOpen,d):null;c+=cv;p+=pv||0;rows.push({kind:'line',label:d.label,code:d.line_code,current:cv,prior:pv});}
  // The year's profit is not yet in retained earnings, so it is shown as its own line. The prior-year closing position already holds the prior profit in retained earnings.
  if(withProfit){const cv=roundTo(profitCents,unit);c+=cv;rows.push({kind:'line',label:'Profit for the year',code:'SFP.CURRENT_PROFIT',current:cv,prior:priorOpen?0:null});}
  tot[name]={current:c,prior:priorOpen?p:null};
  rows.push({kind:'subtotal',label:'Total '+name.toLowerCase(),current:c,prior:priorOpen?p:null});
 };
 const total=(label,names)=>{const cur_=names.reduce((a,n)=>a+(tot[n]?.current||0),0),pri_=priorOpen?names.reduce((a,n)=>a+(tot[n]?.prior||0),0):null;rows.push({kind:'total',label,current:cur_,prior:pri_});return {current:cur_,prior:pri_};};
 section('Non-current assets');section('Current assets');const assets=total('Total assets',['Non-current assets','Current assets']);
 section('Equity');section('Non-current liabilities');section('Current liabilities');
 const el=total('Total equity and liabilities',['Equity','Non-current liabilities','Current liabilities']);
 return {rows,assets,equity_and_liabilities:el};
}

// Input: {lineDefs,maps,tb,startsOn,endsOn,asOf,rounding,priorPl:[{line_code,amount}]|null,priorOpening:[{line_code,net}]|null}
// priorPl amounts carry their natural sign (income and costs both positive). priorOpening net is debit positive, grouped by statement line.
export function buildStatements({lineDefs,maps,tb,startsOn,endsOn,asOf,rounding='Whole shillings',priorPl=null,priorOpening=null}){
 const unit=UNITS[rounding]||100,at=asOf||String(endsOn).slice(0,10),defs=new Map(lineDefs.map(l=>[l.line_code,l]));
 const {by,unmapped,excluded}=currentByLine({tb,maps,lineDefs,asOf:at});
 let pri=null;
 if(priorPl&&priorPl.length){pri=new Map();for(const l of priorPl)pri.set(l.line_code,(pri.get(l.line_code)||0)+cents(l.amount));}
 let po=null,priorProblem=false;
 if(priorOpening){po=new Map();for(const o of priorOpening){const d=defs.get(o.line_code);if(!d||d.statement==='Excluded'){priorProblem=true;continue;}po.set(o.line_code,(po.get(o.line_code)||0)+(d.normal_side==='Credit'?-cents(o.net):cents(o.net)));}}
 // The year's profit exactly, in cents (income less costs), and the exact balance of the statement of financial position.
 const profitCents=lineDefs.filter(d=>d.statement==='Profit or loss'&&d.line_code!=='PL.UNRESOLVED').reduce((a,d)=>a+(by.get(d.line_code)||0)*plSign(d),0);
 const pl=plStatement({lineDefs,cur:by,pri,unit}),sfp=sfpStatement({lineDefs,cur:by,priorOpen:po,unit,profitCents});
 let assets=0,other=0;
 for(const d of lineDefs.filter(x=>x.statement==='Financial position')){const x=(by.get(d.line_code)||0)*sfpSign(d);if(ASSET_SECTIONS.has(d.section))assets+=x;else other+=x;}
 const difference=assets-(other+profitCents);
 const unresolved=(by.get('PL.UNRESOLVED')||0)!==0,problems=[];
 if(unmapped.length)problems.push(`${unmapped.length} account(s) have no approved statement line: ${unmapped.slice(0,5).map(u=>u.code).join(', ')}${unmapped.length>5?' and more':''}.`);
 if(excluded.length)problems.push(`Balances remain on excluded or legacy accounts: ${excluded.slice(0,5).map(u=>u.code).join(', ')}.`);
 if(unresolved)problems.push('Profit contains unresolved review items.');
 if(difference!==0)problems.push(`The statement of financial position is out by KES ${(difference/100).toFixed(2)}.`);
 if(!pri)problems.push('There are no approved prior-year profit or loss comparatives, so that column is not shown.');
 if(!po)problems.push('There are no approved prior-year opening balances, so that column is not shown.');
 if(priorProblem)problems.push('Some prior-year opening balances are not on a statement line.');
 return {
  period:{starts_on:String(startsOn).slice(0,10),ends_on:String(endsOn).slice(0,10),as_of:at},
  presentation:{currency:'KES',rounding:UNITS[rounding]?rounding:'Whole shillings',unit_label:unit===100?'KES':'KES thousands'},
  profit_or_loss:{title:'Statement of profit or loss',rows:pl.rows,has_prior:!!pri,profit:pl.profit,prior_profit:pl.prior_profit},
  financial_position:{title:'Statement of financial position',rows:sfp.rows,has_prior:!!po,assets:sfp.assets,equity_and_liabilities:sfp.equity_and_liabilities},
  checks:{balanced:difference===0,difference:difference/100,unmapped,excluded,unresolved,has_prior_pl:!!pri,has_prior_position:!!po},
  problems,
  complete:problems.length===0
 };
}
