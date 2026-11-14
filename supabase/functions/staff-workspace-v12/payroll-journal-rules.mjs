// Payroll draft journal from the approved payroll mappings (build 2803). Pure rules.
// The confirmed payroll summary (the register of employees for the month) is summed by account; one journal line per account, not per employee.
// Every account comes from an approved, date-valid Payroll mapping of this client. A code with no approved mapping stops the draft and is named,
// never replaced by a guess. The mapping prepares the entry; it never posts it: a different authorised reviewer approves and posts the journal.
import {resolveRouting,payrollSide} from './routing-map-rules.mjs';
const c=v=>Math.round(Number(v||0)*100);
const k=cents=>cents/100;
const num=(rows,key)=>rows.reduce((n,r)=>n+c(r[key]),0);
export function payrollTotals(calculated){
 const rows=Array.isArray(calculated)?calculated:[];
 const t={employees:rows.length,gross:num(rows,'gross'),paye:num(rows,'paye'),employee_nssf:num(rows,'employee_nssf'),shif:num(rows,'shif'),employee_ahl:num(rows,'employee_ahl'),other_deductions:num(rows,'other_deductions'),employer_nssf:num(rows,'employer_nssf'),employer_ahl:num(rows,'employer_ahl'),nita:num(rows,'nita'),source_net:num(rows,'net_pay')};
 t.deductions=t.paye+t.employee_nssf+t.shif+t.employee_ahl+t.other_deductions;
 t.net=t.gross-t.deductions;
 return t;
}
// The journal: [code, side, cents, description, liability_of?]. Employer NSSF and housing levy are owed to the same statutory body as the employee share,
// so their credit goes to the same account as the employee code. NITA has its own payable code.
export function journalPlan(t){
 const plan=[['GROSS_SALARY','Debit',t.gross,'Gross salaries and wages'],
  ['NSSF_EMPLOYER','Debit',t.employer_nssf,'Employer NSSF'],['AHL_EMPLOYER','Debit',t.employer_ahl,'Employer housing levy'],['NITA_EMPLOYER','Debit',t.nita,'NITA levy'],
  ['PAYE','Credit',t.paye,'PAYE payable'],['NSSF_EMPLOYEE','Credit',t.employee_nssf+t.employer_nssf,'NSSF payable (employee and employer shares)'],['SHIF','Credit',t.shif,'SHIF payable'],
  ['AHL_EMPLOYEE','Credit',t.employee_ahl+t.employer_ahl,'Housing levy payable (employee and employer shares)'],['OTHER_DEDUCTIONS','Credit',t.other_deductions,'Other employee deductions'],['NITA_PAYABLE','Credit',t.nita,'NITA payable'],
  ['NET_PAY_PAYABLE','Credit',t.net,'Net salary payable']];
 return plan.filter(x=>x[2]!==0);
}
// maps: the client's routing-map rows. Returns {lines, unmapped:[{code,reason}], problems, balanced, debit, credit}.
export function buildPayrollJournal(t,maps,date){
 const plan=journalPlan(t),unmapped=[],byAccount=new Map(),used=[];
 for(const [code,side,cents,description] of plan){
  const found=resolveRouting(maps,{module:'Payroll',routing_code:code,date});
  if(found.status!=='mapped'){unmapped.push({code,reason:found.reason||`No approved payroll mapping for ${code}.`});continue;}
  if(found.mapping.side!==side||payrollSide(code)!==side){unmapped.push({code,reason:`The approved mapping for ${code} is on the ${found.mapping.side} side; this entry needs it on the ${side} side.`});continue;}
  const key=found.mapping.erp_account_code+'|'+side,cur=byAccount.get(key)||{account_code:found.mapping.erp_account_code,side,cents:0,descriptions:[]};
  cur.cents+=cents;cur.descriptions.push(description);byAccount.set(key,cur);
  used.push({code,account_code:found.mapping.erp_account_code,mapping_id:found.mapping.routing_id,version:found.mapping.version||1});
 }
 const lines=[...byAccount.values()].map(x=>({account_code:x.account_code,debit:x.side==='Debit'?k(x.cents):0,credit:x.side==='Credit'?k(x.cents):0,description:x.descriptions.join('; ')}));
 const debit=lines.reduce((n,l)=>n+c(l.debit),0),credit=lines.reduce((n,l)=>n+c(l.credit),0),problems=[];
 if(t.net<0)problems.push('Deductions are greater than gross pay, so net pay would be negative. Check the payroll summary.');
 if(Math.abs(t.net-t.source_net)>5)problems.push(`Net pay in the payroll summary (${k(t.source_net).toFixed(2)}) differs from gross less deductions (${k(t.net).toFixed(2)}).`);
 return {lines,unmapped,problems,used,debit:k(debit),credit:k(credit),balanced:!unmapped.length&&debit===credit&&debit>0};
}
const keyOf=e=>String(e.employee_id||e.pin||e.name||'').trim().toLowerCase();
// New staff, staff no longer on the payroll, and gross pay changes against the previous month's summary.
export function payrollChanges(prev,cur){
 const p=new Map((prev||[]).map(e=>[keyOf(e),e])),n=new Map((cur||[]).map(e=>[keyOf(e),e])),out={new_staff:[],left:[],salary_changes:[]};
 if(!prev||!prev.length){out.first_month=true;return out;}
 for(const [id,e] of n){const o=p.get(id);if(!o)out.new_staff.push({name:e.name,gross:Number(e.gross)});else if(c(o.gross)!==c(e.gross))out.salary_changes.push({name:e.name,from:Number(o.gross),to:Number(e.gross)});}
 for(const [id,e] of p)if(!n.has(id))out.left.push({name:e.name,gross:Number(e.gross)});
 return out;
}
// Things the reviewer must see before approving: missing staff details, source-versus-ERP differences, rows the importer flagged.
export function payrollExceptions(payload){
 const out=[],emp=payload?.employees||[];
 for(const e of emp){const miss=[];if(!e.pin&&e.employment_type!=='Casual')miss.push('KRA PIN');if(!e.employee_id)miss.push('employee number');if(miss.length)out.push({kind:'Missing staff details',row:e.source_row,name:e.name,detail:'Missing '+miss.join(' and ')});}
 for(const d of payload?.differences||[])out.push({kind:'Source differs from ERP calculation',row:d.row,detail:`${d.field}: source ${d.source??'blank'}, ERP ${d.calculated}`});
 for(const i of payload?.issues||[])out.push({kind:'Import issue',detail:String(i)});
 return out;
}
