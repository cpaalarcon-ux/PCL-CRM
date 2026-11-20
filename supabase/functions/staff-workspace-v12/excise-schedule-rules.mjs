// Excise schedule (build 2794): for one client and one calendar month, work out the excise duty on the products sold, from the dated excise rule in force.
// It is a review working only. It feeds no return and no filing, and it never invents a rate: the product code, unit and rate are read from the dated rule.
// A rule used for staging tests, or one still waiting for the Tax Lead's written confirmation, marks the whole schedule TESTING - NOT FOR FILING.
import {fail,text} from './validation.mjs';
import {dateString,profileIssues,legalPendingRates} from './tax-registry.mjs';
import {preferredRates} from './testing-rates.mjs';
import {number,amount,round} from './suite-rules.mjs';
import {rulesStatus,appliedRateSummary} from './snapshot-rules.mjs';

export const MAX_LINES=40;
const SALES_TOLERANCE=1;
// Sales check (build 2795). The eTIMS sales import holds values (net amount, VAT, description) but no quantity or product code, so quantities cannot be checked against it.
// What can be checked is the sales VALUE the person enters for each line: it cannot be more than all the eTIMS sales recorded for the month. Nothing is invented from the descriptions.
export function salesCheck(lines,sales){
 const declared=round(lines.reduce((s,l)=>s+(l.value||0),0)),entered=lines.some(l=>l.value!=null);
 const out={declared_value:declared,etims_net:sales?.available?sales.net:null,etims_source:sales?.available?sales.source:null,status:'',message:''};
 if(!entered){out.status='No value entered';out.message='Quantities cannot be checked against eTIMS: the eTIMS import holds sales values, not quantities. Enter the sales value of each line to compare it with the eTIMS sales for the month.';return out;}
 if(!sales?.available){out.status='No eTIMS sales';out.message='No eTIMS sales are imported for this client and month, so the sales values entered cannot be checked yet.';return out;}
 if(declared>round(sales.net)+SALES_TOLERANCE){out.status='More than eTIMS sales';out.message=`The sales values entered (KES ${declared.toFixed(2)}) are more than all the eTIMS sales for the month (KES ${round(sales.net).toFixed(2)}). Check the figures or the import.`;return out;}
 out.status='Within eTIMS sales';out.message=`The sales values entered (KES ${declared.toFixed(2)}) are within the eTIMS sales for the month (KES ${round(sales.net).toFixed(2)}). The eTIMS import cannot show which products were sold, so this does not prove the quantities.`;return out;
}
const isoDate=v=>/^\d{4}-\d\d-\d\d$/.test(String(v||''))&&!Number.isNaN(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
// A month is given by its first and last day, both checked.
export function monthProblem(starts_on,ends_on){
 if(!isoDate(starts_on)||!isoDate(ends_on))return 'Choose the month.';
 const last=new Date(Date.UTC(Number(starts_on.slice(0,4)),Number(starts_on.slice(5,7)),0)).toISOString().slice(0,10);
 if(starts_on.slice(8)!=='01'||ends_on!==last)return 'Use one complete calendar month.';
 return null;
}
// What the person typed, tidied and checked for shape only. Whether the rule exists and has figures is decided in compute().
export function cleanLines(list,starts_on,ends_on){
 if(!Array.isArray(list)||!list.length)fail(400,'Add at least one excise product line.');
 if(list.length>MAX_LINES)fail(400,`Add at most ${MAX_LINES} lines to one schedule.`);
 return list.map((x,i)=>{
  const n=i+1,rate_key=String(x?.rate_key||'');
  if(!/^KE_EXCISE_[A-Z0-9_]{1,50}$/.test(rate_key))fail(400,`Line ${n}: choose the excise rule.`);
  const from=dateString(x.from)||starts_on,to=dateString(x.to)||ends_on;
  if(!isoDate(from)||!isoDate(to))fail(400,`Line ${n}: enter the dates sold from and through.`);
  if(to<from)fail(400,`Line ${n}: the sale dates cannot end before they start.`);
  if(from<starts_on||to>ends_on)fail(400,`Line ${n}: the sale dates must fall inside the month.`);
  const line={rate_key,from,to,note:text(x.note||'',200,false)};
  if(x.quantity!==''&&x.quantity!=null)line.quantity=number(x.quantity,0,1e12,`line ${n} quantity`);
  if(x.value!==''&&x.value!=null)line.value=amount(x.value,`line ${n} value (KES)`);
  return line;
 });
}
const sameWindow=(a,b)=>a.rate_key===b.rate_key&&a.from<=b.to&&b.from<=a.to;
// rates: the excise rules the person may use (approved, or approved for staging tests), as returned by stagingRates().
// profile: the verified client tax profile covering the month, or null.
export function computeSchedule({starts_on,ends_on,lines,rates,profile,sales=null}){
 const issues=[],applied=[],out=[];
 const bad=monthProblem(starts_on,ends_on);if(bad)fail(400,bad);
 const clean=cleanLines(lines,starts_on,ends_on);
 for(let i=0;i<clean.length;i++)for(let j=i+1;j<clean.length;j++)if(sameWindow(clean[i],clean[j]))issues.push(`Lines ${i+1} and ${j+1} use the same excise rule for overlapping dates. List each sale once.`);
 const pi=profileIssues(profile,{kind:'Excise duty'});for(const m of pi)issues.push(m);
 clean.forEach((l,i)=>{
  const n=i+1,found=preferredRates(rates.filter((r)=>r.tax_type==='Excise duty'),l.rate_key,l.from,l.to);
  if(found.length!==1){issues.push(found.length?`Line ${n}: more than one version of ${l.rate_key} covers ${l.from} to ${l.to}.`:`Line ${n}: no approved or staging-test version of ${l.rate_key} covers ${l.from} to ${l.to}. If the rate changed during the month, enter the sales before and after the change as separate lines.`);out.push({...l,problem:true});return;}
  const r=found[0],p=r.parameters||{};
  if(!applied.some(x=>x.rate_id===r.rate_id))applied.push(r);
  const listed=(profile?.excise_products||[]).some((x)=>x.rate_key===l.rate_key&&dateString(x.effective_from)<=l.from&&dateString(x.effective_to)>=l.to);
  if(profile&&!listed)issues.push(`Line ${n}: ${l.rate_key} is not listed in the client's excise products for ${l.from} to ${l.to}. Add it to the client tax profile.`);
  const base={rate_key:l.rate_key,label:String(r.label||l.rate_key).replace(/\s*\(rate pending\)\s*$/i,''),from:l.from,to:l.to,note:l.note,rate_id:r.rate_id,approval_scope:r.approval_scope||null,product_code:p.product_code??null,basis:p.excise_basis??null};
  if(p.excise_basis==='Amount per unit'){
   if(l.quantity==null){issues.push(`Line ${n}: enter the quantity sold in ${p.unit}.`);out.push({...base,unit:p.unit,problem:true});return;}
   out.push({...base,unit:p.unit,rate_per_unit:p.rate_per_unit,quantity:l.quantity,...(l.value!=null?{value:l.value}:{}),duty:round(l.quantity*Number(p.rate_per_unit))});
  }else if(p.excise_basis==='Percentage of value'){
   if(l.value==null){issues.push(`Line ${n}: enter the value of the sales (KES).`);out.push({...base,problem:true});return;}
   out.push({...base,rate:p.rate,value:l.value,duty:round(l.value*Number(p.rate)/100)});
  }else {issues.push(`Line ${n}: ${l.rate_key} has no figures yet (its product code, basis and rate wait for the Tax Lead's written confirmation). Nothing can be worked out.`);out.push({...base,problem:true});}
 });
 const check=salesCheck(clean,sales);if(check.status==='More than eTIMS sales')issues.push(check.message);
 const total=round(out.reduce((s,x)=>s+(x.duty||0),0));
 const status=rulesStatus(applied,{});
 const notices=[];
 if(status==='TESTING')notices.push('TESTING - NOT FOR FILING: this schedule uses a rule approved for staging tests only.');
 if(['No value entered','No eTIMS sales'].includes(check.status))notices.push(check.message);
 for(const r of legalPendingRates(applied).filter((r,i,a)=>a.findIndex(y=>y.rate_key===r.rate_key)===i))notices.push(`${r.rate_key}: pending Tax Lead written confirmation. This working is a test and is not for filing.`);
 return {lines:out,sales_check:check,total_duty:total,issues:[...new Set(issues)],notices,rules_status:status,not_for_filing:status!=='CONFIRMED',applied_rates:appliedRateSummary(applied),starts_on,ends_on};
}
// The preparer and the reviewer must be different people, and a schedule with open issues cannot be reviewed.
export function reviewProblem(schedule,computed,actor){
 if(!schedule)return 'Schedule not found.';
 if(schedule.status!=='Draft')return 'Only a draft schedule can be reviewed.';
 if(!['PARTNER','MANAGER'].includes(actor?.category_code))return 'Only a Manager or Partner can review an excise schedule.';
 if(String(schedule.created_by)===String(actor.staff_id))return 'The person who prepared this schedule cannot review it.';
 if(computed.issues.length)return 'Resolve every issue before the schedule is reviewed.';
 return null;
}
