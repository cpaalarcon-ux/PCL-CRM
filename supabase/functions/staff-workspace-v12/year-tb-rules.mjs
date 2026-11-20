// Prior-year trial balances as inputs to the comparatives (build 2824). Pure: no database, no tax rates.
// Three different things are kept apart: an opening trial balance (balances at the start of a year), a year-end trial balance (balances at its end) and the
// year's activity, which is only ever the difference between the two. Where something is missing the statement is "Not available" with the reason. Nothing is
// zero-filled, estimated or carried over from another year.
import {parseAmount,formatComparativeText,CASH_FLOW_LINES} from './annual-pack-comparatives.mjs';
import {linesByNature,classify,buildCashFlow} from './annual-pack-flows.mjs';

export const TB_KINDS=['Year-end','Opening'];
export const CLOSING_STATES=['Before year-end close','After year-end close'];
const cents=v=>Math.round(Number(v||0)*100);
const CF_CODES=new Set(CASH_FLOW_LINES.map(([c])=>c));
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const day=v=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
const addDays=(d,n)=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
// The twelve-month year ending on `end` starts the day after the same date a year earlier; its opening balances are as of that earlier date.
export const openingDateFor=end=>{const x=new Date(end+'T00:00:00Z');x.setUTCFullYear(x.getUTCFullYear()-1);return x.toISOString().slice(0,10);};

// One row per line: tab, semicolon or comma separated.  code, debit, credit  |  code, name, debit, credit  |  code, net  |  code, name, net.
// A net amount is a debit when positive and a credit when negative or in brackets. Numbers with thousands commas need tab separation (paste from Excel).
export function parseTbText(text){
 const rows=[],errors=[];
 String(text||'').split(/\r?\n/).forEach((raw,i)=>{
  const line=raw.trim();if(!line||line.startsWith('#'))return;
  const f=(line.includes('\t')?line.split('\t'):line.includes(';')?line.split(';'):line.split(',')).map(x=>x.trim());
  while(f.length&&f[f.length-1]==='')f.pop();
  const code=(f[0]||'').toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(code)){errors.push(`Row ${i+1}: "${f[0]||''}" is not an account code.`);return;}
  const amt=s=>s===''||s===undefined?0:parseAmount(s);
  let name='',debit=null,credit=null,net=null;
  if(f.length===2)net=amt(f[1]);
  else if(f.length===3){if(parseAmount(f[1])!==null&&parseAmount(f[2])!==null){debit=amt(f[1]);credit=amt(f[2]);}else{name=f[1];net=amt(f[2]);}}
  else if(f.length===4){name=f[1];debit=amt(f[2]);credit=amt(f[3]);}
  else{errors.push(`Row ${i+1}: expected code and amounts (debit and credit, or one net amount).`);return;}
  if(net!==null){if(net===null||Number.isNaN(net)){errors.push(`Row ${i+1}: the amount is not a number.`);return;}debit=net>0?net:0;credit=net<0?-net:0;}
  if(debit===null||credit===null){errors.push(`Row ${i+1}: an amount is not a number.`);return;}
  if(debit<0||credit<0){errors.push(`Row ${i+1}: debit and credit are positive amounts; use one column for a balance.`);return;}
  if(debit&&credit){errors.push(`Row ${i+1}: ${code} has both a debit and a credit. Enter the net balance.`);return;}
  if(!debit&&!credit)return;
  rows.push({code,name,debit,credit});
 });
 return {rows,errors};
}
// known: Set of account codes in the chart. Returns problems that stop the trial balance being recorded.
export function validateTb(rows,known){
 const out=[],seen=new Set();let d=0,c=0;
 if(!rows.length)return {problems:['The trial balance has no balances.'],debit:0,credit:0,balanced:false};
 for(const r of rows){if(seen.has(r.code))out.push(`${r.code} appears twice. Enter one net balance per account.`);seen.add(r.code);d+=cents(r.debit);c+=cents(r.credit);}
 const unknown=[...new Set(rows.map(r=>r.code))].filter(x=>!known.has(x));
 if(unknown.length)out.push(`These accounts are not in the chart of accounts: ${unknown.slice(0,8).join(', ')}${unknown.length>8?` and ${unknown.length-8} more`:''}. Map or add them first; they are not guessed.`);
 if(Math.abs(d-c)>=1)out.push(`The trial balance does not balance: debits KES ${kes(d)}, credits KES ${kes(c)} (difference KES ${kes(Math.abs(d-c))}).`);
 return {problems:out,debit:d/100,credit:c/100,balanced:Math.abs(d-c)<1};
}
export function describeTb(t){return t?{tb_id:t.tb_id,tb_kind:t.tb_kind,as_of:day(t.as_of),closing_state:t.closing_state,version:Number(t.version),row_count:Number(t.row_count),total_debit:Number(t.total_debit),total_credit:Number(t.total_credit),source_reference:t.source_reference,entered_by:t.entered_by,entered_by_name:t.entered_by_name||null,entered_at:t.entered_at}:null;}

const NA=reason=>({state:'Not available',reason,lines:[]});
// The dates the comparatives for the year starting on `startsOn` expect.
export function expectedDates(startsOn){const end=addDays(day(startsOn),-1);return {prior_end:end,opening_as_of:openingDateFor(end)};}

// yearEnd / opening: {rows:[{code,name,debit,credit}],closing_state} or null. maps: approved statement-line maps. lineDefs: statement_lines rows.
// Returns per-statement states: Derived | Needs review | Not available, the lines for profit or loss and changes in equity, and the points to confirm.
export function deriveComparatives({yearEnd,opening,maps,lineDefs,priorEnd}){
 const warnings=[],net=r=>cents(r.debit)-cents(r.credit);
 const cash={state:'Not available',reason:'The prior-year cash flow is worked out from two consecutive year-end trial balances. Record both, or enter it from the signed statements.',lines:[]};
 if(!yearEnd)return {pl:NA(`No year-end trial balance is recorded for ${priorEnd}.`),eq:NA(`No year-end trial balance is recorded for ${priorEnd}.`),cf:{...cash,reason:`No year-end trial balance is recorded for ${priorEnd}, so the prior-year cash flow is not available. The statements cannot be final until it is entered from the signed statements or both trial balances are recorded.`},warnings,texts:{pl:'',eq:'',cf:''}};
 const openMap=new Map((opening?.rows||[]).map(r=>[r.code,net(r)])),endMap=new Map(yearEnd.rows.map(r=>[r.code,net(r)]));
 const codes=[...new Set([...openMap.keys(),...endMap.keys()])];
 const names=new Map([...(opening?.rows||[]),...yearEnd.rows].map(r=>[r.code,r.name||'']));
 const tb=codes.map(code=>{const o=openMap.get(code)||0,n=endMap.get(code)||0,mv=n-o;return {code,name:names.get(code),opening:o/100,movement_debit:mv>0?mv/100:0,movement_credit:mv<0?-mv/100:0,net:n/100};});
 const {by,unmapped}=linesByNature({tb,maps,lineDefs,asOf:priorEnd});
 const defs=new Map(lineDefs.map(l=>[l.line_code,l]));
 const bad=unmapped.length?`${unmapped.length} account(s) with a balance have no approved statement line: ${unmapped.slice(0,6).map(u=>u.code).join(', ')}${unmapped.length>6?' and more':''}. Approve the statement-line map first.`:'';
 if(bad)return {pl:{state:'Needs review',reason:bad,lines:[]},eq:{state:'Needs review',reason:bad,lines:[]},cf:{...cash,reason:bad},warnings,texts:{pl:'',eq:'',cf:''}};
 // Profit or loss: only a trial balance taken before the year-end close still carries the year's activity.
 let pl;
 if(yearEnd.closing_state!=='Before year-end close')pl=NA('The year-end trial balance was taken after the year-end close, so the year’s income and expenses are no longer in it. Use one taken before the close, or the signed statements.');
 else{
  const lines=[];let profit=0;
  for(const d of lineDefs){if(d.statement!=='Profit or loss'||d.line_code==='PL.UNRESOLVED')continue;const v=by.get(d.line_code);if(!v||!v.mov)continue;lines.push({statement:'Profit or loss',line_code:d.line_code,movement:null,amount:v.mov/100});profit+=(d.normal_side==='Credit'?1:-1)*v.mov;}
  pl=lines.length?{state:'Derived',reason:'',lines,profit:profit/100}:NA('The year-end trial balance carries no income or expense balances.');
 }
 // Changes in equity: needs the opening trial balance (the start of the year) and the profit above.
 let eq;
 if(!opening)eq=NA(`No opening trial balance is recorded for ${openingDateFor(priorEnd)}. The start-of-year equity cannot be taken from anywhere else.`);
 else if(pl.state!=='Derived')eq=NA('The profit for the year is not available, so the movement in equity cannot be analysed.');
 else{
  const lines=[],profitC=cents(pl.profit);
  const eqDefs=lineDefs.filter(d=>d.statement==='Financial position'&&d.section==='Equity').sort((a,b)=>a.sort_order-b.sort_order);
  for(const d of eqDefs){
   const v=by.get(d.line_code);if(!v||(!v.open&&!v.close))continue;
   const s=d.normal_side==='Credit'?1:-1,open=s*v.open,close=s*v.close,mv=close-open;
   if(open)lines.push({statement:'Changes in equity',line_code:d.line_code,movement:'OPENING',amount:open/100});
   if(mv){const kind=classify(d.line_code,mv);lines.push({statement:'Changes in equity',line_code:d.line_code,movement:kind,amount:mv/100});
    warnings.push(`${d.label}: a movement of KES ${kes(mv)} is shown as "${kind==='OTHER'?'Other movements':kind==='DIVIDENDS_DRAWINGS'?'Dividends or drawings':'Capital introduced or repaid'}". Confirm what it was against the signed statements.`);}
  }
  if(profitC){
   const i=lines.findIndex(l=>l.line_code==='SFP.RETAINED'&&l.movement==='PROFIT');if(i<0)lines.push({statement:'Changes in equity',line_code:'SFP.RETAINED',movement:'PROFIT',amount:profitC/100});
  }
  eq=lines.length?{state:'Needs review',reason:'Derived from the two trial balances. A Partner confirms the movements before approving.',lines}:NA('Neither trial balance carries equity balances.');
 }
 // Cash flow (build 2876, decision E option A): worked out by the same engine as the current year, from the two consecutive year-end trial balances and the approved statement-line map.
 // It needs the opening trial balance, a year-end trial balance taken before the close (so the year's profit is in it) and a result that reconciles to the change in cash. Otherwise it is Not available.
 let cf=cash;
 if(!opening)cf={...cash,reason:`No opening trial balance is recorded for ${openingDateFor(priorEnd)}, so the prior-year cash flow is not available. Record it, or enter the cash flow from the signed statements.`};
 else if(pl.state!=='Derived')cf={...cash,reason:'The prior-year cash flow needs the year-end trial balance taken before the year-end close, so the profit is in it. '+(pl.reason||'')};
 else{
  const flow=buildCashFlow({lineDefs,maps,tb,asOf:priorEnd,rounding:'Whole shillings'});
  if(!flow.reconciles)cf={...cash,reason:`The two trial balances do not reconcile to the change in cash (out by KES ${kes(Math.round(flow.residual*100))}), so no cash flow is derived. Enter it from the signed statements.`};
  else if(flow.exact['CF.OTHER_FIN'])cf={...cash,reason:`Other equity movements of KES ${kes(Math.round(flow.exact['CF.OTHER_FIN']*100))} cannot be placed in a financing line from the trial balances. Enter the cash flow from the signed statements.`};
  else if(flow.problems.some(x=>/no cash-flow class/.test(x)))cf={...cash,reason:flow.problems.find(x=>/no cash-flow class/.test(x))};
  else{
   const lines=Object.entries(flow.exact).map(([line_code,amount])=>({statement:'Cash flow',line_code,amount})).filter(l=>CF_CODES.has(l.line_code));
   cf=lines.length?{state:'Needs review',reason:'Derived from the two year-end trial balances. A Partner confirms the movements before approving.',lines}:{...cash,reason:'The trial balances carry no cash movements.'};
   if(cf.lines.length){
    warnings.push('Cash flow: purchases of property, plant and equipment are the change in the balance plus the depreciation charge. No property, plant and equipment register is held in the ERP, so disposals are not separated. Confirm against the signed statements.');
   }
  }
 }
 const texts={pl:formatComparativeText('Profit or loss',pl.lines),eq:formatComparativeText('Changes in equity',eq.lines),cf:formatComparativeText('Cash flow',cf.lines)};
 void defs;
 return {pl,eq,cf,warnings,texts};
}
