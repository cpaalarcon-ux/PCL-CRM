// P9 tax deduction cards (build 2877). Pure rules; no database, no clock, no tax rates of their own.
// The card copies the KRA Appendix 2A (2025 template) columns, their order and their letters exactly. It is built only from confirmed payroll months (the same confirmed summaries the
// statutory files use) and every column is checked against the payroll run's own figures. A column that cannot be filled or does not agree stops the card and names the person, month and column.
//   A Basic salary   B Benefits (non-cash)   C Value of quarters   D Total gross pay (A+B+C)
//   E Defined contribution scheme: E1 30 per cent of A, E2 actual contribution, E3 fixed monthly amount; E is the lowest of the three
//   F Affordable Housing Levy   G SHIF   H Post-retirement medical fund   I Owner-occupied interest   J Total deductions
//   K Chargeable pay (D minus J)   L Tax charged   M Personal relief   N Insurance relief   O PAYE tax (L minus M minus N)
// Limits (the monthly pension, medical and mortgage amounts) are read from the tax rule that was in force for the payroll month and is stored with that month's summary.
// The payroll run does not apply the 30 per cent test (E1): the card says so and leaves E1 empty rather than computing a rate the run did not use.
import {joinPayroll,toCsv} from './statutory-file-rules.mjs';
import {payrollTotals} from './payroll-journal-rules.mjs';

const cents=v=>Math.round(Number(v||0)*100);
const money=c=>c/100;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
export const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
// [letter, label]. E1 to E3 are the three parts of column E on the KRA card.
export const P9_COLUMNS=[['A','Basic salary'],['B','Benefits (non-cash)'],['C','Value of quarters'],['D','Total gross pay'],['E1','Defined contribution: 30% of A'],['E2','Defined contribution: actual contribution'],['E3','Defined contribution: fixed monthly amount'],['E','Defined contribution scheme (lowest of E1, E2, E3)'],
 ['F','Affordable Housing Levy'],['G','Social Health Insurance Fund'],['H','Post-retirement medical fund'],['I','Owner-occupied interest'],['J','Total deductions'],['K','Chargeable pay'],['L','Tax charged'],['M','Personal relief'],['N','Insurance relief'],['O','PAYE tax']];
export const P9_NOTE_QUARTERS='Value of quarters (C) is not held separately in the payroll register. All taxable benefits are in Benefits (B) and C is nil. Correct the payroll if the client houses staff.';
export const P9_NOTE_E1='The payroll run limits the pension deduction by the monthly cap in the tax rule but does not apply the 30% of basic pay test, so E1 is left empty and E is the lower of the actual contribution (E2) and the cap (E3). Check anyone whose contribution is above 30% of basic pay before filing.';
export const P9_NOTE_BASIC='Basic salary (A) is the cash pay in the payroll run (basic pay plus cash allowances).';

const limitsOf=rules=>{const r=(rules||[]).find(x=>x&&x.rate_key==='KE_PAYROLL_LIMITS');return r?.parameters||null;};

// One person's card for one month, in cents, or {issues}. e is the payroll line, c its calculation.
export function monthRow({e,c,limits}){
 const issues=[];
 if(!limits)return {issues:['the tax rule that limits pension, medical and mortgage relief was not stored with this month']};
 const A=cents(c.gross),B=cents(c.taxable_benefits),C=0,D=A+B+C;
 const E2=cents(c.employee_nssf)+cents(e.other_pension),E3=cents(limits.pension_monthly_cap),E=Math.min(E2,E3);
 const F=cents(c.employee_ahl),G=cents(c.shif),H=Math.min(cents(e.postretirement_medical),cents(limits.medical_monthly_cap)),I=Math.min(cents(e.mortgage_interest),cents(limits.mortgage_monthly_cap));
 const J=E+F+G+H+I,K=Math.max(0,D-J),L=cents(c.gross_tax),M=cents(c.personal_relief),N=cents(c.insurance_relief),O=Math.max(0,L-M-N);
 if(J!==cents(c.allowed_deductions))issues.push(`total deductions (J) are ${money(J).toFixed(2)} but the payroll run allowed ${money(cents(c.allowed_deductions)).toFixed(2)}`);
 if(cents(c.exemption))issues.push('the payroll run deducted an approved exemption, which the card has no column for');
 if(K!==cents(c.taxable))issues.push(`chargeable pay (K) is ${money(K).toFixed(2)} but the payroll run taxed ${money(cents(c.taxable)).toFixed(2)}`);
 if(O!==cents(c.paye))issues.push(`PAYE (O) is ${money(O).toFixed(2)} but the payroll run charged ${money(cents(c.paye)).toFixed(2)}`);
 return {A,B,C,D,E1:null,E2,E3,E,F,G,H,I,J,K,L,M,N,O,issues};
}
const SUM_KEYS=['A','B','C','D','E2','E','F','G','H','I','J','K','L','M','N','O'];
// months: [{month:'2026-03', import_id, employees:[...], calculated:[...], rules:[...]}]. people: the payroll register. year: number.
// emptyMonths: months the preparer confirmed had no payroll. Returns {employees:[{pin,name,rows,totals,issues}],issues,notes,coverage}.
export function buildP9({year,months=[],people=[],client={},emptyMonths=[]}){
 const issues=[],notes=[P9_NOTE_BASIC,P9_NOTE_QUARTERS,P9_NOTE_E1],byMonth=new Map(months.map(m=>[m.month,m])),people_=new Map();
 const coverage=[];
 for(let i=1;i<=12;i++){
  const key=`${year}-${String(i).padStart(2,'0')}`,m=byMonth.get(key);
  if(!m){
   if(emptyMonths.includes(key))coverage.push({month:key,status:'Confirmed as no payroll'});
   else{coverage.push({month:key,status:'No confirmed payroll'});issues.push(`${MONTHS[i-1]} ${year}: there is no confirmed payroll. Confirm the month, or tick that no payroll ran that month.`);}
   continue;
  }
  const joined=joinPayroll({employees:m.employees,calculated:m.calculated,people}),limits=limitsOf(m.rules);
  let inCards=0,outPaye=0;const totalPaye=payrollTotals(m.calculated).paye;
  for(const {e,c,p} of joined){
   if(!c){issues.push(`${e.name||'A line'} (${MONTHS[i-1]} ${year}, row ${e.source_row}) has no calculation in the confirmed summary.`);continue;}
   const pin=clean(e.pin).toUpperCase();
   if(!pin){outPaye+=cents(c.paye);people_.set('NOPIN:'+clean(e.name),{noPin:true,name:clean(e.name)});continue;}
   const row=monthRow({e,c,limits});
   const rec=people_.get(pin)||{pin,name:clean(e.name),reg:p||null,rows:Array(12).fill(null),issues:[]};
   if(!rec.reg&&p)rec.reg=p;
   rec.rows[i-1]=row;
   for(const x of row.issues)rec.issues.push(`${MONTHS[i-1]} ${year}: ${x}.`);
   people_.set(pin,rec);inCards+=cents(c.paye);
  }
  if(inCards+outPaye!==totalPaye)issues.push(`${MONTHS[i-1]} ${year}: the cards carry PAYE of ${money(inCards).toFixed(2)} and the confirmed summary ${money(totalPaye).toFixed(2)}.`);
  coverage.push({month:key,status:'Confirmed payroll',employees:m.calculated.length,import_id:m.import_id,paye_without_pin:money(outPaye)});
 }
 const employees=[];
 for(const rec of people_.values()){
  if(rec.noPin){notes.push(`${rec.name} has no KRA PIN, so no card can be made for them. Their PAYE is in the P10 under PAYE without PIN.`);continue;}
  const reg=rec.reg||{},surname=clean(reg.surname),other=clean(reg.other_names);
  const own=[...rec.issues];
  if(!surname||!other)own.push(`${rec.name}: surname and other names are missing from the payroll register. Fill them under Statutory details.`);
  const totals=Object.fromEntries(SUM_KEYS.map(k=>[k,rec.rows.reduce((a,r)=>a+(r?r[k]:0),0)]));
  employees.push({pin:rec.pin,name:rec.name,surname,other_names:other,rows:rec.rows,totals,issues:own,months_on_payroll:rec.rows.filter(Boolean).length});
 }
 employees.sort((a,b)=>a.name.localeCompare(b.name));
 for(const e of employees)issues.push(...e.issues);
 if(!employees.length&&!issues.length)issues.push('There are no employees with a KRA PIN in the confirmed payroll for this year.');
 return {year,client:{name:clean(client.name),pin:clean(client.pin).toUpperCase()},employees,issues:[...new Set(issues)],notes,coverage,ready:false};
}
// Whole-shilling presentation is the card's own; amounts here stay exact to the cent. The CSV is one employee: header block, the twelve months, totals and the KRA footer.
const f2=c=>c===null||c===undefined?'':money(c).toFixed(2);
export function p9Rows(card,employer){
 const head=[['Tax deduction card (P9), KRA Appendix 2A'],['Employer',employer.name],['Employer PIN',employer.pin],['Employee surname',card.surname],['Employee other names',card.other_names],['Employee PIN',card.pin],['Year',String(card.year)],[]];
 const cols=['Month',...P9_COLUMNS.map(([l])=>l)];
 const body=MONTHS.map((mn,i)=>{const r=card.rows[i];return [mn,...P9_COLUMNS.map(([l])=>r?f2(r[l]):'')];});
 const tot=['Total',...P9_COLUMNS.map(([l])=>l==='E1'||l==='E3'?'':f2(card.totals[l]))];
 return {head,cols,body,tot,foot:[['Total chargeable pay (Col. K)',f2(card.totals.K)],['Total tax (Col. O)',f2(card.totals.O)]]};
}
export function p9Csv(card,employer){
 const x=p9Rows(card,employer);
 return toCsv(x.head[0],[...x.head.slice(1).map(r=>r),x.cols,...x.body,x.tot,[],...x.foot]);
}
export function p9FileName(card,employer){
 const slug=s=>clean(s).replace(/[^A-Za-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,28)||'x';
 return `P9_${card.year}_${slug(employer.name)}_${slug(card.name)}_${card.pin}.csv`;
}
