// Prior-year comparatives for a first ERP year: parsing, validation and the reconciliations that must hold before a Partner can approve them.
// Pure: no database, no tax rates. Amounts are in KES. Profit or loss lines carry their natural sign (income and costs both positive, a gain shown
// as a negative cost only when the signed accounts do). Equity amounts are the effect on equity (a drawing or dividend is negative). Cash-flow amounts
// are the cash effect (cash out is negative).
export const EQUITY_MOVES=[['OPENING','Balance at the start of the prior year'],['PROFIT','Profit or loss for the year'],['DIVIDENDS_DRAWINGS','Dividends or drawings'],['CAPITAL','Capital introduced or repaid'],['OTHER','Other movements']];
export const CASH_FLOW_LINES=[
 ['CF.PBT','Operating','Profit before tax'],['CF.DEPREC','Operating','Depreciation and amortisation'],['CF.IMPAIR','Operating','Impairment of assets'],
 ['CF.FIN_COSTS','Operating','Finance costs'],['CF.FIN_INCOME','Operating','Finance income'],['CF.DISPOSAL','Operating','Loss or (gain) on disposal of assets'],['CF.NONCASH_OTHER','Operating','Other non-cash items'],
 ['CF.WC_INV','Operating','Decrease or (increase) in inventories'],['CF.WC_REC','Operating','Decrease or (increase) in receivables'],['CF.WC_PAY','Operating','Increase or (decrease) in payables'],['CF.WC_OTHER','Operating','Other working-capital changes'],
 ['CF.TAX_PAID','Operating','Income tax paid'],['CF.INTEREST_PAID','Operating','Interest paid'],
 ['CF.PPE_PURCHASE','Investing','Purchase of property, plant and equipment'],['CF.PPE_PROCEEDS','Investing','Proceeds from sale of property, plant and equipment'],['CF.INVEST_NET','Investing','Net purchase of investments'],['CF.INTEREST_RECEIVED','Investing','Interest received'],
 ['CF.BORROW_PROCEEDS','Financing','Proceeds from borrowings'],['CF.BORROW_REPAID','Financing','Repayment of borrowings'],['CF.LEASE_PAID','Financing','Lease payments (principal)'],['CF.CAPITAL_ISSUED','Financing','Capital introduced or shares issued'],['CF.DIVIDENDS_PAID','Financing','Dividends paid'],['CF.DRAWINGS','Financing','Owner or partner drawings'],
 ['CF.CASH_OPEN','Cash','Cash and cash equivalents at the start of the prior year'],['CF.CASH_CLOSE','Cash','Cash and cash equivalents at the end of the prior year']];
const CF_SECTION=new Map(CASH_FLOW_LINES.map(([c,s])=>[c,s])),CF_LABEL=new Map(CASH_FLOW_LINES.map(([c,,l])=>[c,l])),MOVES=new Set(EQUITY_MOVES.map(m=>m[0]));
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const STATEMENTS=['Statement of financial position','Profit or loss','Changes in equity','Cash flow'];

// "1,234.50", "(1,234.50)", "-1234.5", "KES 1 234" -> number of shillings with two decimals, or null.
export function parseAmount(raw){
 let s=String(raw??'').trim();if(!s)return null;
 let neg=false;if(/^\(.*\)$/.test(s)){neg=true;s=s.slice(1,-1);}
 s=s.replace(/^kes\s*/i,'').replace(/[\s,]/g,'');if(s.startsWith('-')){neg=!neg;s=s.slice(1);}
 if(!/^\d+(\.\d{1,2})?$/.test(s))return null;
 const n=Math.round(Number(s)*100)/100;return neg?-n:n;
}
// Pasted or typed text, one row per line. Fields are separated by a tab, a semicolon or a comma; a comma inside a number is kept when the row has a tab.
// 'Profit or loss' and 'Cash flow': CODE, amount.   'Changes in equity': CODE, MOVEMENT, amount.
export function parseComparativeText(statement,text){
 const rows=[],errors=[];
 String(text||'').split(/\r?\n/).forEach((raw,i)=>{
  const line=raw.trim();if(!line||line.startsWith('#'))return;
  const eqRow=statement==='Changes in equity',m=eqRow?line.match(/^([A-Za-z0-9_.]+)[\s,;]+([A-Za-z_-]+)[\s,;]+(.+)$/):line.match(/^([A-Za-z0-9_.]+)[\s,;]+(.+)$/);
  if(!m){errors.push(`Row ${i+1}: expected ${eqRow?'code, movement and amount':'code and amount'}.`);return;}
  const f=m.slice(1),want=f.length,amount=parseAmount(f[want-1].replace(/^[\s,;]+|[\s,;]+$/g,''));if(amount===null){errors.push(`Row ${i+1}: "${f[want-1]}" is not an amount.`);return;}
  const code=f[0].toUpperCase();
  if(statement==='Changes in equity'){const mv=f[1].toUpperCase().replace(/[\s-]+/g,'_');if(!MOVES.has(mv)){errors.push(`Row ${i+1}: movement must be one of ${[...MOVES].join(', ')}.`);return;}rows.push({statement,line_code:code,movement:mv,amount});}
  else rows.push({statement,line_code:code,movement:null,amount});
 });
 return {rows,errors};
}
export function formatComparativeText(statement,lines){
 return lines.filter(l=>l.statement===statement).map(l=>statement==='Changes in equity'?`${l.line_code}\t${l.movement}\t${Number(l.amount).toFixed(2)}`:`${l.line_code}\t${Number(l.amount).toFixed(2)}`).join('\n');
}
// lineDefs: statement_lines rows. Returns problems with the lines themselves (codes, duplicates, presence).
export function validateComparativeLines(lines,lineDefs){
 const out=[],defs=new Map(lineDefs.map(l=>[l.line_code,l])),seen=new Set();
 for(const l of lines){
  const key=`${l.statement}|${l.line_code}|${l.movement||''}`;if(seen.has(key))out.push(`${l.line_code} appears twice${l.movement?' for '+l.movement:''}.`);seen.add(key);
  if(l.statement==='Profit or loss'){const d=defs.get(l.line_code);if(!d||d.statement!=='Profit or loss'||l.line_code==='PL.UNRESOLVED')out.push(`${l.line_code} is not a profit or loss line.`);}
  else if(l.statement==='Changes in equity'){const d=defs.get(l.line_code);if(!d||d.statement!=='Financial position'||d.section!=='Equity')out.push(`${l.line_code} is not an equity line.`);}
  else if(l.statement==='Cash flow'){if(!CF_SECTION.has(l.line_code))out.push(`${l.line_code} is not a cash-flow line.`);}
 }
 return out;
}
// The reconciliations. opening: [{line_code, net}] = approved opening balances grouped by statement line (net: debit positive).
export function reconcileComparatives({lines,lineDefs,opening}){
 const problems=[],present={pl:false,eq:false,cf:false},defs=new Map(lineDefs.map(l=>[l.line_code,l]));
 problems.push(...validateComparativeLines(lines,lineDefs));
 const pl=lines.filter(l=>l.statement==='Profit or loss'),eq=lines.filter(l=>l.statement==='Changes in equity'),cf=lines.filter(l=>l.statement==='Cash flow');
 present.pl=pl.length>0;present.eq=eq.length>0;present.cf=cf.length>0;
 let profit=0,tax=0;
 for(const l of pl){const d=defs.get(l.line_code);if(!d)continue;const sign=d.normal_side==='Credit'?1:-1;profit+=sign*cents(l.amount);if(l.line_code==='PL.TAX')tax+=cents(l.amount);}
 const pbt=profit+tax;
 if(present.pl&&!pl.some(l=>defs.get(l.line_code)?.section==='Revenue'))problems.push('Profit or loss has no revenue line.');
 // equity
 let eqClose=0,eqProfit=0;const opens=eq.filter(l=>l.movement==='OPENING');
 for(const l of eq){eqClose+=cents(l.amount);if(l.movement==='PROFIT')eqProfit+=cents(l.amount);}
 if(present.eq){
  if(!opens.length)problems.push('Changes in equity has no opening balance at the start of the prior year.');
  if(present.pl&&eqProfit!==profit)problems.push(`Profit or loss for the year in changes in equity (KES ${kes(eqProfit)}) differs from profit per the profit or loss lines (KES ${kes(profit)}).`);
  const openEq=-(opening||[]).filter(o=>{const d=defs.get(o.line_code);return d&&d.statement==='Financial position'&&d.section==='Equity';}).reduce((s,o)=>s+cents(o.net),0);
  if(eqClose!==openEq)problems.push(`Prior-year closing equity per the comparatives (KES ${kes(eqClose)}) differs from equity in the approved opening balances (KES ${kes(openEq)}).`);
 }
 // cash flow
 if(present.cf){
  const get=c=>cf.filter(l=>l.line_code===c).reduce((s,l)=>s+cents(l.amount),0),has=c=>cf.some(l=>l.line_code===c);
  for(const c of ['CF.PBT','CF.CASH_OPEN','CF.CASH_CLOSE'])if(!has(c))problems.push(`Cash flow needs "${CF_LABEL.get(c)}".`);
  const sec=s=>cf.filter(l=>CF_SECTION.get(l.line_code)===s).reduce((a,l)=>a+cents(l.amount),0),net=sec('Operating')+sec('Investing')+sec('Financing');
  if(has('CF.CASH_OPEN')&&has('CF.CASH_CLOSE')&&get('CF.CASH_OPEN')+net!==get('CF.CASH_CLOSE'))problems.push(`Cash at the start (KES ${kes(get('CF.CASH_OPEN'))}) plus net cash movement (KES ${kes(net)}) does not equal cash at the end (KES ${kes(get('CF.CASH_CLOSE'))}).`);
  if(present.pl&&has('CF.PBT')&&get('CF.PBT')!==pbt)problems.push(`Profit before tax in the cash flow (KES ${kes(get('CF.PBT'))}) differs from profit before tax per the profit or loss lines (KES ${kes(pbt)}).`);
  const cash=(opening||[]).filter(o=>o.line_code==='SFP.CASH'||o.line_code==='SFP.OVERDRAFT').reduce((s,o)=>s+cents(o.net),0);
  if(has('CF.CASH_CLOSE')&&get('CF.CASH_CLOSE')!==cash)problems.push(`Cash at the end of the prior year (KES ${kes(get('CF.CASH_CLOSE'))}) differs from cash less overdraft in the approved opening balances (KES ${kes(cash)}).`);
 }
 return {present,problems,ok:problems.length===0&&present.pl&&present.eq&&present.cf,figures:{profit:profit/100,profit_before_tax:pbt/100}};
}
// Group opening trial-balance rows by the statement line in force. tb rows: {code,opening}; maps as in annual-pack-rules.
export function openingByLine(tb,maps,mapInForce,at){
 const by=new Map();
 for(const r of tb){if(!cents(r.opening))continue;const m=mapInForce(maps,r.code,at);const k=m?m.line_code:'UNMAPPED';by.set(k,(by.get(k)||0)+cents(r.opening));}
 return [...by.entries()].map(([line_code,c])=>({line_code,net:c/100}));
}
// The comparatives line for the readiness gate. Names every statement that is missing.
export function comparativesStatus({basis,prior,priorPeriodExists,approved,draft,recon}){
 const st=(statement,state,detail='')=>({statement,state,detail});
 if(basis==='First period - none')return {pass:!priorPeriodExists,statements:[],detail:priorPeriodExists?'A prior year exists in the ERP. Comparatives must be presented.':'First period: no comparatives.'};
 if(basis==='Prior year ledger'){
  const ok=prior?.source==='Prior-year ledger';
  return {pass:ok,statements:STATEMENTS.map(s=>st(s,ok?'From the prior-year ledger':'Missing')),detail:ok?'Comparatives come from the prior-year ledger.':'There is no prior-year ledger. Set it up, or use approved opening balances with prior-year comparatives as the basis.'};
 }
 if(prior?.source==='Prior-year ledger')return {pass:false,statements:[],detail:'A prior-year ledger exists. Use it for the comparatives.'};
 const out=[st('Statement of financial position',prior?.source==='Opening balances'?'From approved opening balances':'Missing')];
 for(const [name,key] of [['Profit or loss','pl'],['Changes in equity','eq'],['Cash flow','cf']]){
  if(approved)out.push(st(name,!recon?.present?.[key]?'Missing':recon.ok?'Approved':'Does not reconcile',recon?.present?.[key]?'':'Not in the approved comparatives'));
  else out.push(st(name,draft?'Waiting for Partner approval':'Missing'));
 }
 const bad=out.filter(s=>!/^(Approved|From)/.test(s.state)),reconBad=approved&&recon&&!recon.ok;
 return {pass:!bad.length&&!reconBad,statements:out,detail:reconBad&&recon.present.pl&&recon.present.eq&&recon.present.cf?recon.problems[0]+(recon.problems.length>1?` (${recon.problems.length-1} more)`:''):bad.length?`Missing or not approved: ${bad.map(s=>s.statement.toLowerCase()).join(', ')}.`:'Comparatives are complete for every primary statement.'};
}
