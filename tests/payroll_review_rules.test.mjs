import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerDrift,reviewSummary,approvalNote,reopenNote} from '../supabase/functions/staff-workspace-v12/payroll-review-rules.mjs';
import {reviewView} from '../staff-payroll-review.mjs';
const calc=g=>({gross:g,paye:g*0.1,employee_nssf:100,shif:g*0.0275,employee_ahl:g*0.015,other_deductions:0,employer_nssf:100,employer_ahl:g*0.015,nita:50,net_pay:g-g*0.1-100-g*0.0275-g*0.015});
const CODES={GROSS_SALARY:['60000','Debit'],NSSF_EMPLOYER:['60050','Debit'],AHL_EMPLOYER:['60060','Debit'],NITA_EMPLOYER:['60070','Debit'],PAYE:['21600','Credit'],NSSF_EMPLOYEE:['21603','Credit'],SHIF:['21601','Credit'],AHL_EMPLOYEE:['21602','Credit'],OTHER_DEDUCTIONS:['21609','Credit'],NITA_PAYABLE:['21604','Credit'],NET_PAY_PAYABLE:['21610','Credit']};
const maps=Object.entries(CODES).map(([c,[a,s]],i)=>({routing_id:'m'+i,version:1,module:'Payroll',routing_code:c,erp_account_code:a,side:s,effective_from:'2026-01-01',effective_to:null,status:'Active'}));
const emp=(n,g)=>({name:n,pin:'A00000000'+n+'Z',employee_id:'E'+n,gross:g});
const payload=()=>({employees:[emp('1',100000),emp('2',50000)],calculated:[calc(100000),calc(50000)],issues:[],differences:[]});
const people=[{person_id:'p1',name:'1',kra_pin:'A000000001Z',national_id:'E1',started_on:'2026-01-01',left_on:null},{person_id:'p2',name:'2',kra_pin:'A000000002Z',national_id:'E2',started_on:'2026-01-01',left_on:null}];
const pays=[{person_id:'p1',gross:100000,effective_from:'2026-01-01',reason:'r',created_at:'2026-01-02T00:00:00Z'},{person_id:'p2',gross:50000,effective_from:'2026-01-01',reason:'r',created_at:'2026-01-02T00:00:00Z'}];
const base=()=>({payload:payload(),prior:null,month:'2026-03',maps,people,pays,savedAt:'2026-04-01T00:00:00Z'});
test('a clean run has nothing to decide',()=>{const s=reviewSummary(base());assert.equal(s.clean,true);assert.deepEqual(s.blockers,[]);assert.equal(s.journal.balanced,true);assert.equal(s.totals.gross,150000);});
test('an exception, an unmapped code or an unbalanced run is not clean',()=>{
 assert.equal(reviewSummary({...base(),payload:{...payload(),issues:['odd']}}).clean,false);
 const u=reviewSummary({...base(),maps:maps.filter(m=>m.routing_code!=='PAYE')});assert.equal(u.clean,false);assert.match(u.blockers.join(' '),/PAYE/);
});
test('register: a pay row recorded after the run was saved blocks; an older difference is only shown',()=>{
 const late=[...pays,{person_id:'p1',gross:120000,effective_from:'2026-03-10',reason:'raise',created_at:'2026-04-02T00:00:00Z'}];
 const a=reviewSummary({...base(),pays:late});assert.equal(a.clean,false);assert.equal(a.drift.late_changes.length,1);
 const old=[...pays,{person_id:'p1',gross:120000,effective_from:'2026-03-10',reason:'raise',created_at:'2026-03-15T00:00:00Z'}];
 const b=reviewSummary({...base(),pays:old});assert.equal(b.clean,true);assert.equal(b.drift.pay_differs.length,1);
});
test('register: people missing from the run, or not on the register, block; no register means no comparison',()=>{
 const d=registerDrift({employees:[emp('1',100000),emp('9',5)],people,pays,month:'2026-03',savedAt:null});
 assert.deepEqual(d.not_in_register.map(x=>x.name),['9']);assert.deepEqual(d.missing_from_run.map(x=>x.name),['2']);
 assert.equal(registerDrift({employees:[emp('1',1)],people:[],pays:[],month:'2026-03'}).applicable,false);
 assert.equal(reviewSummary({...base(),people:[],pays:[]}).clean,true);
});
test('notes carry the numbers and the reason',()=>{
 const s=reviewSummary(base());assert.match(approvalNote(s),/2 employees, gross 150000\.00/);
 assert.match(reopenNote({drift:{late_changes:[{name:'A',saved:1,register:2,effective_from:'2026-03-10'}]}},'Raise recorded late'),/A 1\.00 to 2\.00 from 2026-03-10/);
});
test('the review screen escapes names and shows why a run is not clean',()=>{
 const s=reviewSummary({...base(),payload:{...payload(),employees:[emp('<i>',1)],issues:['x']}});
 const html=reviewView(s);assert.ok(!html.includes('<i>'));assert.ok(html.includes('Not a clean run'));
 assert.ok(reviewView(reviewSummary(base())).includes('Clean run'));
});
test('wiring: actions routed and classified; the screen is reachable from the payroll summary',()=>{
 const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
 assert.match(rd('supabase/functions/staff-workspace-v12/index.ts'),/payrollReviewAction\(tx,a,p\)/);assert.match(rd('supabase/functions/staff-workspace-v12/staff-access-control.mjs'),/payroll_review_\|/);
 const ui=rd('staff-period-imports.mjs');assert.match(ui,/staff-payroll-review\.mjs\?v=20261116-confirm-v1/);assert.match(ui,/button\('payroll-review','Review payroll summary'/);assert.match(ui,/payrollReview\.isAction\(action\)/);
 assert.doesNotMatch(rd('staff-payroll-review.mjs'),/ledger_journal|ledger_payroll_journal_create/);
 assert.match(rd('staff-workspace-v6.mjs'),/staff-period-imports\.mjs\?v=20261116-profiles-v1/);assert.match(rd('staff-pilot.mjs'),/staff-workspace-v6\.mjs\?v=20261116-profiles-v1/);
});
