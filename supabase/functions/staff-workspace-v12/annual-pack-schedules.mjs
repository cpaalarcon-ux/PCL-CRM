// Supporting schedules for the notes (build 2886). Pure: no database, no tax rates.
// A note analyses a caption by ledger account. A supporting schedule says what is inside each account (the stock by class, the receivables by kind, the loans by lender, the tax by type, the staff
// costs by element, the equity by component) and is declared by staff, supported by a stated source, and approved by someone who did not declare it. Only an approved schedule is printed under the
// note. Every account in the note must be accounted for by the schedule to the cent, and every schedule line must sit on an account the note holds; a difference is reported, never absorbed.
// This module imports only the statement rounding helpers, so it can be used by the notes engine without a circular import.
import {UNITS,roundTo} from './annual-pack-statements.mjs';

export const SCHEDULES_VERSION='support-schedules-v1';
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>Math.round(c)/100;
const money=n=>Number(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});

// One kind of schedule per note family it supports. `ref` is the note family on the statement-line catalogue.
export const KINDS=[
 {code:'STOCK',ref:'INV',title:'Inventories',categories:['Goods for resale','Raw materials','Work in progress','Finished goods','Consumables and packaging','Allowance for slow-moving stock'],
  source:'The stock count sheet and its valuation at the year end (the count date, the counters and the basis of cost).'},
 {code:'RECEIVABLES',ref:'REC',title:'Receivables and prepayments',categories:['Trade receivables','Allowance for expected credit losses','Other receivables','Prepayments','Deposits paid'],
  source:'The debtors listing at the year end and the support for each non-trade balance.'},
 {code:'PAYABLES',ref:'PAY',title:'Trade and other payables',categories:['Trade payables','Accrued expenses','Statutory deductions payable','Customer deposits and deferred income','Other payables'],
  source:'The supplier listing at the year end and the support for each accrual and other balance.'},
 {code:'BANK',ref:'CASH',title:'Cash and cash equivalents',categories:['Bank balances','Mobile money','Cash in hand','Short-term deposits'],
  source:'The bank statements and confirmations at the year end, and the cash count.'},
 {code:'LOANS',ref:'BORROW',title:'Borrowings',categories:['Bank loan','Other loan','Bank overdraft','Lease liability'],
  source:'The lender statements or loan agreements at the year end.'},
 {code:'TAX',ref:'TAX',title:'Taxation',categories:['Current income tax','Instalment tax paid','Withholding tax credits','Deferred tax','Value added tax','Other taxes'],
  source:'The tax computation for the year and the KRA ledger or returns.'},
 {code:'PAYROLL',ref:'STAFF',title:'Staff costs',categories:['Salaries and wages','Casual labour','Bonuses and allowances','Employer statutory contributions','Other staff costs'],
  source:'The payroll registers for the year, agreed to the payroll returns filed.'},
 {code:'EQUITY',ref:'EQUITY',title:'Equity',categories:['Share capital or capital introduced','Share premium','Retained earnings','Reserves','Current accounts','Drawings'],
  source:'The share register, the capital agreement or the owner’s capital record.'}
];
export const KIND_CODES=KINDS.map(k=>k.code);
export const kindOf=code=>KINDS.find(k=>k.code===code)||null;
export const kindForRef=ref=>KINDS.find(k=>k.ref===ref)||null;
export const MAX_LINES=200;

// The lines of one proposed schedule, checked before they are saved. accounts: the codes of the accounts the note holds. Returns {error} or {lines,evidence}.
export function validateSchedule({kind,evidence,lines,accounts=[]}){
 const k=kindOf(kind);
 if(!k)return {error:'Choose which schedule this is.'};
 const ev=String(evidence??'').replace(/\s+/g,' ').trim();
 if(ev.length<10)return {error:'Say what supports the schedule (the count sheet, the statement, the agreement), at least 10 characters.'};
 if(ev.length>500)return {error:'Keep the source to 500 characters.'};
 if(!Array.isArray(lines)||!lines.length)return {error:'Add at least one line.'};
 if(lines.length>MAX_LINES)return {error:`A schedule has at most ${MAX_LINES} lines.`};
 const allowed=new Set(accounts.map(String)),out=[],seen=new Set();
 for(let i=0;i<lines.length;i++){
  const x=lines[i]||{},n=i+1,category=String(x.category??'').trim(),description=String(x.description??'').replace(/\s+/g,' ').trim(),account=String(x.account??'').trim(),reference=String(x.reference??'').replace(/\s+/g,' ').trim();
  if(!k.categories.includes(category))return {error:`Line ${n}: choose a heading for ${k.title.toLowerCase()}.`};
  if(description.length<3||description.length>120)return {error:`Line ${n}: describe the item in 3 to 120 characters.`};
  if(!allowed.has(account))return {error:`Line ${n}: account ${account||'(none)'} is not one this note holds. Choose an account from the list.`};
  if(reference.length>120)return {error:`Line ${n}: keep the reference to 120 characters.`};
  const raw=Number(x.amount);
  if(x.amount===''||x.amount==null||typeof x.amount==='boolean'||!Number.isFinite(raw))return {error:`Line ${n}: enter the amount.`};
  if(Math.abs(raw)>=1e12)return {error:`Line ${n}: the amount is too large.`};
  if(Math.abs(raw*100-Math.round(raw*100))>1e-6)return {error:`Line ${n}: use at most two decimal places.`};
  const amount=kes(Math.round(raw*100));
  if(amount===0)return {error:`Line ${n}: an amount of nil is not listed.`};
  const key=[category,description.toLowerCase(),account].join('|');
  if(seen.has(key))return {error:`Line ${n}: ${description} is listed twice under ${category}.`};
  seen.add(key);
  out.push({category,description,account,reference,amount});
 }
 return {lines:out,evidence:ev};
}

// A note's accounts in exact cents (basis) against the lines of an approved schedule. Every account on either side is listed, with the schedule, the trial balance and the difference.
export function tieOut({basis,lines}){
 const tb=new Map(),sc=new Map(),names=new Map();
 for(const a of basis||[]){tb.set(String(a.code),(tb.get(String(a.code))||0)+a.cents);names.set(String(a.code),a.name||'');}
 for(const l of lines||[])sc.set(String(l.account),(sc.get(String(l.account))||0)+cents(l.amount));
 const rows=[...new Set([...tb.keys(),...sc.keys()])].sort().map(code=>{
  const s=sc.get(code)||0,t=tb.get(code)||0;
  return {account:code,name:names.get(code)||'',schedule:kes(s),trial_balance:kes(t),difference:kes(s-t),ties:s===t};
 });
 return {rows,ties:rows.every(r=>r.ties),differences:rows.filter(r=>!r.ties).length};
}

// The schedule as printed under the note: by heading, in the order of the headings, with a subtotal for each, rounded to the statements' unit. Returns null when there is no approved schedule.
export function buildSupport({kind,schedule,basis,rounding='Whole shillings'}){
 const k=kindOf(kind);if(!k||!schedule)return null;
 const unit=UNITS[rounding]||100,lines=schedule.lines||[],tie=tieOut({basis,lines});
 const categories=k.categories.map(category=>{
  const mine=lines.filter(l=>l.category===category);if(!mine.length)return null;
  const exact=mine.reduce((s,l)=>s+cents(l.amount),0),shown=mine.map(l=>({description:l.description,reference:l.reference||'',account:l.account,amount:roundTo(cents(l.amount),unit)}));
  return {category,lines:shown,total:roundTo(exact,unit),rounding:roundTo(exact,unit)-shown.reduce((s,l)=>s+l.amount,0)};
 }).filter(Boolean);
 const exact=lines.reduce((s,l)=>s+cents(l.amount),0);
 return {kind,title:k.title,version:schedule.version,evidence:schedule.evidence,declared_by:schedule.declared_name||null,approved_by:schedule.reviewed_name||null,categories,total:roundTo(exact,unit),tie,ties:tie.ties};
}

// What is hashed with the notes: every line of an approved schedule, so a change to a schedule changes the figures a Partner approved and the approval goes stale.
export const canonicalSupport=s=>s?{k:s.kind,v:s.version,c:s.categories.map(c=>[c.category,c.total,c.lines.map(l=>[l.account,l.description,l.amount])])}:null;

// Readiness of the schedules for one year. notes: the built notes (each with support_basis and support). rows: {approved,draft,returned} keyed by kind.
export function scheduleReadiness({notes=[],rows={}}){
 const kinds=[],problems=[];
 for(const n of notes){
  const k=kindForRef(n.ref);if(!k)continue;
  const basis=(n.support_basis&&n.support_basis.accounts)||[],relevant=basis.some(a=>a.cents!==0);
  const ap=rows.approved?.[k.code]||null,dr=rows.draft?.[k.code]||null,rt=rows.returned?.[k.code]||null;
  const state=ap?'Approved':dr?'Waiting for approval':rt?'Returned':'Not declared';
  const ties=ap?!!n.support&&n.support.ties:null,diffs=ap&&n.support?n.support.tie.rows.filter(r=>!r.ties):[];
  kinds.push({kind:k.code,title:k.title,ref:k.ref,note_number:n.number,note_title:n.title,relevant,state,ties,differences:diffs.length});
  if(!relevant)continue;
  const label=`${k.title} (note ${n.number})`;
  if(!ap)problems.push(state==='Waiting for approval'?`${label}: the schedule waits for approval.`:state==='Returned'?`${label}: the schedule was returned and has not been declared again.`:`${label}: no supporting schedule.`);
  else if(diffs.length){const d=diffs[0];problems.push(`${label}: account ${d.account}${d.name?' '+d.name:''} is ${money(d.schedule)} on the schedule and ${money(d.trial_balance)} in the trial balance.`);}
 }
 const relevantKinds=kinds.filter(x=>x.relevant);
 return {kinds,relevant:relevantKinds.length,ok:problems.length===0,problems};
}
export function schedulesCheck(r){
 if(!r||!r.relevant)return {status:'Info',detail:'No note has balances that need a supporting schedule.'};
 if(r.ok)return {status:'Pass',detail:`${r.relevant} supporting schedule${r.relevant===1?'':'s'} approved and agreed to the trial balance.`};
 return {status:'Blocked',detail:r.problems.slice(0,3).join(' ')+(r.problems.length>3?` (+${r.problems.length-3} more)`:'')};
}
