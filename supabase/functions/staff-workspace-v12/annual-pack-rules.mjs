import {comparativesStatus} from './annual-pack-comparatives.mjs';
// Annual financial statements: what must be true before a pack can be relied on. Pure rules, no database and no tax rates.
// IFRS for SMEs Accounting Standard, Third Edition (2025) is effective for annual periods beginning on or after 1 January 2027; earlier use is early application and must be disclosed.
export const THIRD_EDITION_EFFECTIVE='2027-01-01';
export const FRAMEWORKS={
 'IFRS for SMEs Accounting Standard':['Third Edition (2025)','Second Edition (2015, amended 2022)'],
 'IFRS Accounting Standards':['As issued at the reporting date'],
 'Other framework':['Other (state in the note)']
};
const day=v=>String(v instanceof Date?v.toISOString():v??'').slice(0,10);
const cents=v=>Math.round(Number(v||0)*100);
const kes=c=>(c/100).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});

// The default for a client year: the 2025 Third Edition, flagged as early application when the year begins before 1 January 2027.
export function defaultReporting(startsOn){
 const early=day(startsOn)<THIRD_EDITION_EFFECTIVE;
 return {framework:'IFRS for SMEs Accounting Standard',edition:'Third Edition (2025)',presentation_currency:'KES',rounding:'Whole shillings',comparatives_basis:'Prior year ledger',cash_flow_method:'Indirect',
  early_application_note:early?'Early application of the IFRS for SMEs Accounting Standard Third Edition (2025) for a year beginning before 1 January 2027, as the standard permits.':''};
}
// Problems with a reporting choice for a year starting on `startsOn`. The database enforces the same rules.
export function validateReporting(r,startsOn){
 const out=[],start=day(startsOn);
 if(!r)return ['No reporting framework has been recorded for this year.'];
 const editions=FRAMEWORKS[r.framework];
 if(!editions)out.push('Choose a reporting framework.');
 else if(!editions.includes(r.edition))out.push(`The edition "${r.edition}" does not belong to ${r.framework}.`);
 if(r.edition==='Second Edition (2015, amended 2022)'&&start>=THIRD_EDITION_EFFECTIVE)out.push('The Second Edition cannot be used for a year beginning on or after 1 January 2027.');
 if(r.edition==='Third Edition (2025)'&&start<THIRD_EDITION_EFFECTIVE&&String(r.early_application_note||'').trim().length<10)out.push('Using the Third Edition before 1 January 2027 is early application. Record the disclosure note.');
 if(!/^[A-Z]{3}$/.test(String(r.presentation_currency||'')))out.push('Presentation currency must be a three-letter code such as KES.');
 if(r.cash_flow_method!=='Indirect')out.push('The cash-flow statement uses the indirect method.');
 return out;
}
// The Approved mapping in force on a date, or null.
export function mapInForce(maps,code,at){
 return maps.find(m=>m.account_code===code&&m.status==='Approved'&&day(m.effective_from)<=at&&(!m.effective_to||day(m.effective_to)>=at))||null;
}
const sample=(items,n=6)=>items.slice(0,n).join(', ')+(items.length>n?` and ${items.length-n} more`:'');
// Readiness for one client year. Each check is Pass, Blocked or Info. The pack is ready only when nothing is Blocked.
// Input: {period:{starts_on,ends_on,status}, reporting, tb:[{code,name,opening,net,movement_debit,movement_credit}], maps:[...rows], lines:[{line_code,statement}],
//         issues:[string], prior:{source}, priorPeriodExists:boolean, asOf}
export function packReadiness({period,reporting,tb,maps,lines,issues=[],prior,priorPeriodExists=false,asOf,approvedSet=null,draftSet=null,recon=null}){
 const at=asOf||day(period.ends_on),checks=[],add=(code,label,status,detail='')=>checks.push({code,label,status,detail});
 const problems=validateReporting(reporting,period.starts_on);
 add('REPORTING_BASIS','Reporting framework and edition recorded',problems.length?'Blocked':'Pass',problems.join(' ')||`${reporting.framework}, ${reporting.edition}, ${reporting.presentation_currency}, ${reporting.rounding.toLowerCase()}, indirect cash flow.`);
 const lineOf=new Map(lines.map(l=>[l.line_code,l])),active=tb.filter(r=>cents(r.opening)!==0||cents(r.movement_debit)!==0||cents(r.movement_credit)!==0||cents(r.net)!==0);
 const missing=[],draftOnly=[],legacy=[],unresolved=[];
 for(const r of active){
  const m=mapInForce(maps,r.code,at);
  if(!m){(maps.some(x=>x.account_code===r.code&&x.status==='Draft')?draftOnly:missing).push(`${r.code} ${r.name||''}`.trim());continue;}
  const line=lineOf.get(m.line_code);
  if(!line){missing.push(`${r.code} (unknown line ${m.line_code})`);continue;}
  if(line.statement==='Excluded'&&cents(r.net)+cents(r.movement_debit)+cents(r.movement_credit)+cents(r.opening)!==0)legacy.push(`${r.code} ${r.name||''}`.trim());
  if(m.line_code==='PL.UNRESOLVED'&&(cents(r.movement_debit)!==0||cents(r.movement_credit)!==0||cents(r.net)!==0))unresolved.push(`${r.code} ${r.name||''} (KES ${kes(cents(r.net))})`.trim());
 }
 add('MAP_APPROVED','Every account with a balance sits on an approved statement line',missing.length||draftOnly.length?'Blocked':'Pass',
  [missing.length?`No statement line for: ${sample(missing)}.`:'',draftOnly.length?`Waiting for Partner approval: ${sample(draftOnly)}.`:''].filter(Boolean).join(' ')||`${active.length} account(s) with balances are mapped.`);
 add('NO_LEGACY','No balance on legacy accounts',legacy.length?'Blocked':'Pass',legacy.length?`Move the balance off: ${sample(legacy)}.`:'');
 add('NO_UNRESOLVED','No unresolved review items in profit',unresolved.length?'Blocked':'Pass',unresolved.length?`Resolve: ${sample(unresolved)}.`:'');
 const total=tb.reduce((s,r)=>s+cents(r.net),0);
 add('TB_BALANCED','Trial balance balances',total===0?'Pass':'Blocked',total===0?'':`Out by KES ${kes(total)}.`);
 add('LEDGER_REVIEW','Ledger review items cleared',issues.length?'Blocked':'Pass',issues.length?`${issues.length} item(s): ${issues.slice(0,3).join(' | ')}${issues.length>3?' | …':''}`:'');
 let comparatives=null;
 if(!reporting)add('COMPARATIVES','Prior-year comparatives','Blocked','Record the reporting basis first.');
 else{
  comparatives=comparativesStatus({basis:reporting.comparatives_basis,prior,priorPeriodExists,approved:approvedSet,draft:draftSet,recon});
  add('COMPARATIVES','Prior-year comparatives for every primary statement',comparatives.pass?'Pass':'Blocked',comparatives.detail);
 }
 if(period.status!=='Open')add('PERIOD','Ledger year status','Info',`The ledger year is ${period.status}.`);
 const blocked=checks.filter(c=>c.status==='Blocked');
 return {comparatives,ready:blocked.length===0,status:blocked.length?'Not ready':'Ready for review',blocked:blocked.length,checks,summary:blocked.length?`Not ready: ${blocked[0].label}. ${blocked[0].detail}`.trim():'All readiness checks pass.'};
}
