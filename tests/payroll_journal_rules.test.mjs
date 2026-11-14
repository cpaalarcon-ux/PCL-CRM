import test from 'node:test';
import assert from 'node:assert/strict';
import {payrollTotals,buildPayrollJournal,payrollChanges,payrollExceptions} from '../supabase/functions/staff-workspace-v12/payroll-journal-rules.mjs';
import {payrollPreviewView,canPrepare} from '../staff-payroll-journal.mjs';
const emp=(n,gross,o={})=>({name:n,employee_id:'E'+n,pin:'A00'+n+'Z',gross,paye:gross*0.1,employee_nssf:100,shif:gross*0.0275,employee_ahl:gross*0.015,other_deductions:0,employer_nssf:100,employer_ahl:gross*0.015,nita:50,net_pay:gross-gross*0.1-100-gross*0.0275-gross*0.015,...o});
const CODES={GROSS_SALARY:['60000','Debit'],NSSF_EMPLOYER:['60050','Debit'],AHL_EMPLOYER:['60060','Debit'],NITA_EMPLOYER:['60070','Debit'],PAYE:['21600','Credit'],NSSF_EMPLOYEE:['21603','Credit'],SHIF:['21601','Credit'],AHL_EMPLOYEE:['21602','Credit'],OTHER_DEDUCTIONS:['21609','Credit'],NITA_PAYABLE:['21604','Credit'],NET_PAY_PAYABLE:['21610','Credit']};
const maps=(skip=[])=>Object.entries(CODES).filter(([c])=>!skip.includes(c)).map(([c,[a,s]],i)=>({routing_id:'m'+i,version:1,module:'Payroll',routing_code:c,erp_account_code:a,side:s,effective_from:'2026-01-01',effective_to:null,status:'Active'}));
const rows=[emp('1',100000),emp('2',50000)].map(e=>({...e,source_net:e.net_pay}));
const totals=()=>{const t=payrollTotals(rows);t.source_net=rows.reduce((n,r)=>n+Math.round(r.source_net*100),0);return t;};
test('journal balances, one line per account, employer shares credited with the employee code',()=>{
 const j=buildPayrollJournal(totals(),maps(),'2026-03-31');
 assert.equal(j.unmapped.length,0);assert.equal(j.balanced,true);assert.equal(j.debit,j.credit);
 assert.equal(j.lines.filter(l=>l.account_code==='21603').length,1);
 assert.equal(j.lines.find(l=>l.account_code==='60000').debit,150000);
});
test('a code without an approved mapping is named and stops the entry',()=>{
 const j=buildPayrollJournal(totals(),maps(['SHIF']),'2026-03-31');
 assert.deepEqual(j.unmapped.map(x=>x.code),['SHIF']);assert.equal(j.balanced,false);
});
test('a mapping not yet effective, or ended, is not used',()=>{
 assert.equal(buildPayrollJournal(totals(),maps(),'2025-12-31').balanced,false);
 const ended=maps().map(m=>({...m,effective_to:'2026-02-28'}));
 assert.equal(buildPayrollJournal(totals(),ended,'2026-03-31').balanced,false);
});
test('a mapping on the wrong side is refused',()=>{
 const m=maps().map(x=>x.routing_code==='PAYE'?{...x,side:'Debit'}:x);
 assert.ok(buildPayrollJournal(totals(),m,'2026-03-31').unmapped.some(x=>x.code==='PAYE'));
});
test('changes against the previous month: new, left, salary change; first month flagged',()=>{
 const prev=[emp('1',100000),emp('3',20000)],cur=[emp('1',110000),emp('2',50000)];
 const c=payrollChanges(prev,cur);
 assert.deepEqual(c.new_staff.map(x=>x.name),['2']);assert.deepEqual(c.left.map(x=>x.name),['3']);assert.equal(c.salary_changes[0].to,110000);
 assert.equal(payrollChanges([],cur).first_month,true);
});
test('exceptions list missing staff details and differences',()=>{
 const ex=payrollExceptions({employees:[{name:'X',gross:1,source_row:5}],differences:[{row:5,field:'paye',source:1,calculated:2}],issues:['odd']});
 assert.equal(ex.length,3);assert.equal(ex[0].kind,'Missing staff details');
});
test('preview view shows totals, escapes names, and only allows preparing a clean balanced run',()=>{
 const j=buildPayrollJournal(totals(),maps(),'2026-03-31');
 const r={month:'2026-03',employees:2,totals:{gross:150000,deductions:1,net:2,employer_cost:3},changes:{new_staff:[{name:'<b>x</b>',gross:1}],salary_changes:[],left:[]},exceptions:[],problems:[],unmapped:[],journal:j};
 const html=payrollPreviewView(r);assert.ok(!html.includes('<b>x</b>'));assert.ok(html.includes('Balanced'));assert.equal(canPrepare(r),true);
 assert.equal(canPrepare({...r,unmapped:[{code:'PAYE',reason:'r'}]}),false);
 assert.ok(payrollPreviewView({...r,unmapped:[{code:'PAYE',reason:'none'}]}).includes('no approved mapping'));
});
