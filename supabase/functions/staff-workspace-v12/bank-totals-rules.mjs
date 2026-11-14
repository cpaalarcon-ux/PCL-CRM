// Monthly bank totals and adjustments (build 2799). The firm's "Five Bank Reconciliation" workbook, sheet BANK INPUTS, is read as it is:
//   01 bank account register, 02 monthly totals per bank (statement credits, bank charges, loan interest, excise on bank fees, other finance costs),
//   03 adjustments (non-trade credits, bounced cheques, trade receipt corrections).
// It is a review working: it feeds no ledger entry, no return and no statement line. The workbook's own reviewer text and Approved/REVIEW
// status are source evidence only; a different Manager or Partner confirms the batch in the ERP.
import {excelDate,money} from './workspace-rules.mjs';
import {sheetValues} from './workbook-templates.mjs';

export const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
export const NON_TRADE_CREDITS=['Loan received','Capital injection','Internal transfer in','Returnable cylinder deposit','Customer deposit / refundable liability','Refund / non-trade reversal credit','Other non-trade credit','Unidentified credit'];
export const ADJUSTMENTS={ // category -> the one direction it may have, as in the workbook
 ...Object.fromEntries(NON_TRADE_CREDITS.map(c=>[c,'Credit'])),
 'Bounced cheque reversal':'Debit','Trade receipt correction (+)':'Credit','Trade receipt correction (-)':'Debit'
};
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).replace(/\s+/g,' ').toLowerCase();
const HEAD={
 bank:['account code','bank / account name','account reference (last 4)','active?','currency','notes'],
 total:['month','account code','bank name (linked)','gross bank credits (kes)','bank charges (kes)','loan interest (kes)','excise on bank fees (kes)','other finance costs (kes)','statement debit total (optional)','statement ref / notes'],
 adjustment:['month','account code','date','bank reference','narration / source','direction','adjustment category','amount (kes)','evidence / document','review status']
};
const matches=(values,want)=>want.every((w,i)=>norm(values[i])===w);
const num=v=>clean(v)===''?null:money(v);

// Finds the three blocks by their headings, so extra rows above or below do not matter.
export function readBankInputs(sheet){
 const issues=[],found={bank:0,total:0,adjustment:0};
 let title='';for(let i=1;i<=Math.min(sheet.rowCount,6);i++){const v=sheetValues(sheet,i).map(clean).join(' ');if(/BANK INPUTS/i.test(v)){title=v;break;}}
 if(!title)return {recognised:false,issues:['The worksheet is not the BANK INPUTS sheet of the five-bank workbook.']};
 const rows=Math.min(sheet.rowCount,2000);
 for(let i=1;i<=rows;i++){const v=sheetValues(sheet,i);for(const k of Object.keys(HEAD))if(!found[k]&&matches(v,HEAD[k]))found[k]=i;}
 for(const [k,label] of [['bank','bank account register'],['total','monthly bank totals'],['adjustment','adjustments']])if(!found[k])issues.push(`The ${label} heading row was not found. Restore the workbook headings.`);
 if(issues.length)return {recognised:true,issues};
 const banks=[],months=[],adjustments=[];
 for(let i=found.bank+1;i<=rows;i++){const v=sheetValues(sheet,i);if(!clean(v[0])||!/^[A-Za-z0-9_-]{2,20}$/.test(clean(v[0])))break;banks.push({row:i,code:clean(v[0]),name:clean(v[1]),last4:clean(v[2]),active:!/^no$/i.test(clean(v[3])),currency:clean(v[4])||'KES',notes:clean(v[5])});}
 for(let i=found.total+1;i<=rows;i++){const v=sheetValues(sheet,i);if(!MONTHS.includes(clean(v[0])))break;
  months.push({row:i,month:clean(v[0]),bank:clean(v[1]),credits:num(v[3]),charges:num(v[4]),loan_interest:num(v[5]),excise:num(v[6]),other_finance:num(v[7]),debit_total:num(v[8]),notes:clean(v[9]),raw:[3,4,5,6,7,8].map(k=>clean(v[k]))});}
 for(let i=found.adjustment+1;i<=Math.min(rows,found.adjustment+600);i++){const v=sheetValues(sheet,i);if(!v.slice(0,10).some(x=>clean(x)))continue; // the workbook's adjustment block is 600 rows; anything below it is other content
  if(!MONTHS.includes(clean(v[0]))&&!clean(v[1]))continue;
  adjustments.push({row:i,month:clean(v[0]),bank:clean(v[1]),date:excelDate(v[2])||null,reference:clean(v[3]),narration:clean(v[4]),direction:clean(v[5]),category:clean(v[6]),amount:num(v[7]),evidence:clean(v[8]),source_status:clean(v[9]),raw_date:clean(v[2])});}
 const year=clean(sheetValues(sheet,4)[4])||null;
 return {recognised:true,issues,year:/^\d{4}$/.test(year||'')?Number(year):null,banks,months,adjustments};
}

const cents=v=>Math.round(Number(v||0)*100),kes=c=>c/100;
export function computeBankTotals(input,{year=null}={}){
 const issues=[],warnings=[],bankCodes=new Set(),seen=new Set();
 for(const b of input.banks){if(bankCodes.has(b.code))issues.push(`Bank register row ${b.row}: ${b.code} is listed twice.`);bankCodes.add(b.code);if(!b.name)issues.push(`Bank register row ${b.row}: enter the bank name for ${b.code}.`);if(b.last4&&!/^[A-Za-z0-9]{1,4}$/.test(b.last4))issues.push(`Bank register row ${b.row}: keep only the last four characters of the account reference.`);if(b.currency!=='KES')warnings.push(`${b.code} is in ${b.currency}. Totals are taken as KES amounts; convert before relying on them.`);}
 const adjByKey=new Map(),kinds={};
 for(const a of input.adjustments){
  const at=`Adjustment row ${a.row}`;let bad=false;
  if(!MONTHS.includes(a.month)){issues.push(`${at}: choose the month.`);bad=true;}
  if(!bankCodes.has(a.bank)){issues.push(`${at}: account code ${a.bank||'(blank)'} is not in the bank register.`);bad=true;}
  const dir=ADJUSTMENTS[a.category];
  if(!dir){issues.push(`${at}: choose an adjustment category from the list.`);bad=true;}
  else if(a.direction!==dir){issues.push(`${at}: ${a.category} must be a ${dir.toLowerCase()}, not "${a.direction||'blank'}".`);bad=true;}
  if(a.amount===null||a.amount<=0){issues.push(`${at}: enter the amount as a positive number.`);bad=true;}
  if(clean(a.raw_date)&&!a.date){issues.push(`${at}: the date is not valid.`);bad=true;}
  if(a.date&&MONTHS.includes(a.month)&&Number(a.date.slice(5,7))!==MONTHS.indexOf(a.month)+1)warnings.push(`${at}: the date is in a different month from "${a.month}". A reversal of an earlier-period cheque keeps its own date; say so in the notes.`);
  if(year&&a.date&&Number(a.date.slice(0,4))!==year)warnings.push(`${at}: the date is outside ${year}.`);
  if(!a.evidence)warnings.push(`${at}: no evidence or document is named.`);
  if(bad)continue;
  const k=a.month+'|'+a.bank,o=adjByKey.get(k)||{nonTrade:0,bounced:0,correction:0};
  if(NON_TRADE_CREDITS.includes(a.category)){o.nonTrade+=cents(a.amount);kinds[a.category]=(kinds[a.category]||0)+cents(a.amount);}
  else if(a.category==='Bounced cheque reversal')o.bounced+=cents(a.amount);
  else o.correction+=(a.category==='Trade receipt correction (+)'?1:-1)*cents(a.amount);
  adjByKey.set(k,o);
 }
 const rows=[];
 for(const m of input.months){
  const at=`Monthly totals row ${m.row}`,key=m.month+'|'+m.bank;let bad=false;
  if(!bankCodes.has(m.bank)){issues.push(`${at}: account code ${m.bank||'(blank)'} is not in the bank register.`);continue;}
  if(seen.has(key)){issues.push(`${at}: ${m.bank} appears twice for ${m.month}.`);continue;}seen.add(key);
  for(const [k,label,col] of [['credits','statement credits','D'],['charges','bank charges','E'],['loan_interest','loan interest','F'],['excise','excise on bank fees','G'],['other_finance','other finance costs','H'],['debit_total','statement debit total','I']]){
   const raw=m.raw[['credits','charges','loan_interest','excise','other_finance','debit_total'].indexOf(k)]; // original cell text
   if(m[k]===null&&clean(raw)!==''&&k!=='credits'){issues.push(`${at}: column ${col} (${label}) is not a valid amount.`);bad=true;}
   if(m[k]!==null&&m[k]<0){issues.push(`${at}: column ${col} (${label}) cannot be negative.`);bad=true;}
  }
  const adj=adjByKey.get(key)||{nonTrade:0,bounced:0,correction:0},finance=cents(m.charges)+cents(m.loan_interest)+cents(m.excise)+cents(m.other_finance);
  const hasData=m.credits!==null||finance>0||m.debit_total!==null||adj.nonTrade||adj.bounced||adj.correction;
  if(!hasData&&!bad){rows.push({...m,empty:true});continue;}
  if(m.credits===null&&(adj.nonTrade||adj.bounced||adj.correction)){issues.push(`${at}: ${m.bank} ${m.month} has adjustments but no statement credit total. Enter the credits, using 0 where there were none.`);bad=true;}
  if(m.debit_total!==null&&cents(m.debit_total)<finance)warnings.push(`${at}: the statement debit total is less than the finance costs entered for ${m.bank} ${m.month}.`);
  const adjusted=m.credits===null?null:cents(m.credits)-adj.nonTrade-adj.bounced+adj.correction;
  if(adjusted!==null&&adjusted<0){issues.push(`${at}: non-trade credits and bounced cheques exceed the statement credits for ${m.bank} ${m.month}.`);bad=true;}
  rows.push({row:m.row,month:m.month,bank:m.bank,credits:m.credits,finance_costs:kes(finance),charges:m.charges,loan_interest:m.loan_interest,excise:m.excise,other_finance:m.other_finance,debit_total:m.debit_total,non_trade:kes(adj.nonTrade),bounced:kes(adj.bounced),correction:kes(adj.correction),adjusted_trade:adjusted===null?null:kes(adjusted),notes:m.notes,problem:bad});
 }
 for(const k of adjByKey.keys()){const [month,bank]=k.split('|');if(!input.months.some(m=>m.month===month&&m.bank===bank))issues.push(`${bank} ${month} has adjustments but no row in the monthly totals.`);}
 const live=rows.filter(r=>!r.empty);
 if(!live.length)issues.push('No monthly bank totals were found. Enter at least one month.');
 if(input.months.length>60)issues.push('The monthly totals block has more than 60 rows.');
 const by=MONTHS.map(month=>{const r=live.filter(x=>x.month===month);const s=k=>kes(r.reduce((n,x)=>n+cents(x[k]),0));return {month,credits:s('credits'),non_trade:s('non_trade'),bounced:s('bounced'),correction:s('correction'),adjusted_trade:s('adjusted_trade'),finance_costs:s('finance_costs')};}).filter(x=>live.some(r=>r.month===x.month));
 const sum=k=>kes(by.reduce((n,x)=>n+cents(x[k]),0));
 return {issues,warnings,rows:live,by_month:by,by_kind:Object.fromEntries(Object.entries(kinds).map(([k,v])=>[k,kes(v)])),totals:{credits:sum('credits'),non_trade:sum('non_trade'),bounced:sum('bounced'),correction:sum('correction'),adjusted_trade:sum('adjusted_trade'),finance_costs:sum('finance_costs')}};
}

// A different Manager or Partner confirms; the note says what was checked.
export function reviewProblem({batch,actor,note,agreed}){
 if(!['PARTNER','MANAGER'].includes(actor.category_code))return 'A Manager or Partner confirms bank totals.';
 if(batch.created_by===actor.staff_id)return 'A different Manager or Partner must confirm. The person who prepared it cannot.';
 if(batch.status!=='Draft')return 'Only a draft can be confirmed.';
 if(clean(note).length<10)return 'Say what you checked (at least 10 characters).';
 if(!agreed)return 'Tick that the totals agree to the bank statements.';
 return null;
}
