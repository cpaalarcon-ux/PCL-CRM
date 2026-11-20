// Supervisor review of a payroll month (build 2805). Pure rules. One consolidated summary, a "clean run" test, and the register comparison.
// A clean run has nothing for a person to decide: no exceptions, no unmapped payroll code, a balanced journal, and the register has not changed under it.
// Anything else is listed by reason and the existing review (confirm with a note, or return) stays available. Nothing here posts anything.
import {payrollTotals,buildPayrollJournal,payrollChanges,payrollExceptions} from './payroll-journal-rules.mjs';
import {monthBounds,activeInMonth,payFor} from './payroll-register-rules.mjs';
const c=v=>Math.round(Number(v||0)*100);
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const keyPin=v=>String(v||'').toUpperCase().replace(/\s+/g,'');
const keyName=v=>String(v||'').trim().toLowerCase();
function match(e,people){
 const pin=keyPin(e.pin),id=String(e.employee_id||'').trim(),name=keyName(e.name);
 return people.find(p=>pin&&keyPin(p.kra_pin)===pin)||people.find(p=>id&&String(p.national_id||'').trim()===id)||people.find(p=>name&&keyName(p.name)===name)||null;
}
// How the saved run compares with the register today. A pay row recorded after the run was saved and effective by the month end is a late change:
// the run no longer matches the register, so it cannot be approved in one step. Other differences (overtime, bonuses) are shown, not blocked.
export function registerDrift({employees,people,pays,month,savedAt}){
 const b=monthBounds(month),out={applicable:false,not_in_register:[],missing_from_run:[],pay_differs:[],late_changes:[]};
 if(!b||!(people||[]).length)return out;
 out.applicable=true;
 const active=people.filter(p=>activeInMonth(p,b)),seen=new Set();
 for(const e of employees||[]){
  const p=match(e,people);
  if(!p){out.not_in_register.push({name:e.name});continue;}
  seen.add(p.person_id);
  const pay=payFor(pays,p.person_id,b);
  if(pay&&c(pay.gross)!==c(e.gross)){
   const row={name:e.name,saved:Number(e.gross),register:Number(pay.gross),effective_from:day(pay.effective_from),reason:pay.reason||''};
   out.pay_differs.push(row);
   if(savedAt&&pay.created_at&&new Date(pay.created_at)>new Date(savedAt))out.late_changes.push(row);
  }
 }
 for(const p of active)if(!seen.has(p.person_id))out.missing_from_run.push({name:p.name});
 return out;
}
export function reviewSummary({payload,prior,month,maps,people,pays,savedAt}){
 const calculated=payload?.calculated||[],t=payrollTotals(calculated);t.source_net=calculated.reduce((n,r)=>n+c(r.net_pay),0);
 const b=monthBounds(month),journal=b?buildPayrollJournal(t,maps||[],b.end):{lines:[],unmapped:[],problems:['Choose a valid month.'],debit:0,credit:0,balanced:false};
 const changes=payrollChanges(prior?.employees,payload?.employees||[]),exceptions=payrollExceptions(payload),drift=registerDrift({employees:payload?.employees,people,pays,month,savedAt});
 const blockers=[];
 if(!calculated.length)blockers.push('The summary has no calculated employees.');
 if(exceptions.length)blockers.push(`${exceptions.length} exception${exceptions.length>1?'s':''} to resolve or explain.`);
 if(journal.unmapped.length)blockers.push('No approved mapping for: '+journal.unmapped.map(x=>x.code).join(', ')+'.');
 for(const p of journal.problems)blockers.push(p);
 if(!journal.unmapped.length&&!journal.balanced&&!journal.problems.length)blockers.push('The journal does not balance.');
 if(drift.late_changes.length)blockers.push('The register changed after this run was saved: '+drift.late_changes.map(x=>x.name).join(', ')+'.');
 if(drift.not_in_register.length)blockers.push('Not in the register: '+drift.not_in_register.map(x=>x.name).join(', ')+'.');
 if(drift.missing_from_run.length)blockers.push('On the register but missing from this run: '+drift.missing_from_run.map(x=>x.name).join(', ')+'.');
 return {month,employees:t.employees,totals:{gross:t.gross/100,deductions:t.deductions/100,net:t.net/100,employer_cost:(t.employer_nssf+t.employer_ahl+t.nita)/100},changes,exceptions,drift,
  journal:{debit:journal.debit,credit:journal.credit,balanced:journal.balanced,lines:journal.lines},unmapped:journal.unmapped,blockers,clean:blockers.length===0};
}
export function approvalNote(s){
 return `Clean run approved in one step: ${s.employees} employees, gross ${s.totals.gross.toFixed(2)}, deductions ${s.totals.deductions.toFixed(2)}, net ${s.totals.net.toFixed(2)}. No exceptions, every payroll code mapped, journal balances, register unchanged since the run was saved. New staff ${(s.changes.new_staff||[]).length}, salary changes ${(s.changes.salary_changes||[]).length}, left ${(s.changes.left||[]).length}.`;
}
export function reopenNote(s,reason){
 const late=(s.drift.late_changes||[]).map(x=>`${x.name} ${x.saved.toFixed(2)} to ${x.register.toFixed(2)} from ${x.effective_from}`).join('; ');
 return `Returned to prepare a new version. ${String(reason||'').trim()}${late?' Register changes since the run was saved: '+late+'.':''}`.trim();
}
