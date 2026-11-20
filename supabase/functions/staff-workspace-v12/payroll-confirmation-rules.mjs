// Client confirmation of a payroll month (build 2820). Pure rules.
// The report shows the client what will be paid and filed: who is on the run, their pay, the deductions and what changed since last month.
// It is fingerprinted. If the run changes after the client confirmed, the confirmation no longer matches and the run cannot go to review until a new version is confirmed.
import {payrollTotals,payrollChanges} from './payroll-journal-rules.mjs';
const money=v=>Math.round((Number(v)||0)*100)/100;
const day=v=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';
export const CONFIRM_DECISIONS=['Confirmed','Changes requested'];

// What the client is shown. Built only from the saved run, so the same run always gives the same snapshot.
export function confirmationSnapshot({payload,prior,month,inactive=[],clientName='',tradingName=''}){
 const emp=payload?.employees||[],calc=payload?.calculated||[];
 const lines=emp.map((e,i)=>{const c=calc[i]||{};return {name:String(e.name||'').trim(),pin:String(e.pin||'').trim(),employee_id:String(e.employee_id||'').trim(),employment_type:e.employment_type||'',
  gross:money(c.gross??e.gross),taxable_benefits:money(e.taxable_benefits),paye:money(c.paye),employee_nssf:money(c.employee_nssf),shif:money(c.shif),employee_ahl:money(c.employee_ahl),other_deductions:money(c.other_deductions??e.other_deductions),net_pay:money(c.net_pay)};});
 const t=payrollTotals(calc);
 const changes=payrollChanges(prior?.employees,emp);
 return {month,client_name:clientName,trading_name:tradingName,lines,
  totals:{employees:t.employees,gross:money(t.gross/100),paye:money(t.paye/100),employee_nssf:money(t.employee_nssf/100),shif:money(t.shif/100),employee_ahl:money(t.employee_ahl/100),other_deductions:money(t.other_deductions/100),net:money(lines.reduce((n,l)=>n+Math.round(l.net_pay*100),0)/100),employer_nssf:money(t.employer_nssf/100),employer_ahl:money(t.employer_ahl/100),nita:money(t.nita/100)},
  changes:{first_month:!!changes.first_month,new_staff:changes.new_staff||[],left:changes.left||[],salary_changes:changes.salary_changes||[]},
  inactive:inactive.map(x=>({name:x.name,from:day(x.from),to:x.to?day(x.to):null,reason:x.reason||''}))};
}
// Stable text for hashing: keys sorted, so the fingerprint does not depend on property order.
export function canonical(v){
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v??null);
}
// The part of the snapshot the client is actually confirming: people and money. The month's inactive notes and names of the client do not change the digest.
export function digestInput(s){return canonical({month:s.month,lines:s.lines,totals:s.totals});}

// rows: all versions for one run. currentDigest: the fingerprint of the run as it stands now.
export function confirmationState(rows,currentDigest){
 const list=[...(rows||[])].sort((a,b)=>b.version-a.version),latest=list[0];
 if(!latest)return {state:'Not requested',blocks:false,message:'No client confirmation report has been issued for this run.',latest:null,matches:null};
 const matches=latest.digest===currentDigest;
 if(latest.status==='Issued')return {state:matches?'Awaiting client':'Out of date',blocks:true,message:matches?`Version ${latest.version} was issued and the client has not answered.`:`The run changed after version ${latest.version} was issued. Issue a new version.`,latest,matches};
 if(latest.status==='Changes requested')return {state:matches?'Changes requested':'Out of date',blocks:true,message:matches?`The client asked for changes to version ${latest.version}. Make the changes, then issue a new version.`:`Changes were made after version ${latest.version}. Issue a new version for the client to confirm.`,latest,matches};
 if(latest.status==='Confirmed'){return matches?{state:'Confirmed',blocks:false,message:`The client confirmed version ${latest.version}.`,latest,matches}:{state:'Out of date',blocks:true,message:`The run changed after the client confirmed version ${latest.version}. Issue a new version for the client to confirm.`,latest,matches};}
 return {state:'Out of date',blocks:true,message:'Issue a new confirmation report.',latest,matches};
}
export function answerIssues({decision,responder,on,note,evidence,today}){
 const out=[];
 if(!CONFIRM_DECISIONS.includes(decision))out.push('Choose whether the client confirmed or asked for changes.');
 if(String(responder||'').trim().length<3)out.push('Say who at the client answered (their name).');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(on||'')))out.push('Give the date the client answered.');else if(on>today)out.push('The date the client answered cannot be in the future.');
 const n=String(note||'').trim().length;
 if(decision==='Changes requested'&&n<10)out.push('Write down the changes the client asked for (at least 10 characters).');
 if(decision==='Confirmed'&&!evidence&&n<10)out.push('Attach the client reply, or say how and where they confirmed (for example the email date). At least 10 characters.');
 return out;
}
