import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {normaliseLines,journalIssues,costJournal,profitReport,trialBalance,assetCalculation,periodAssetCharge,sharedRateSeeds,payrollJournal,assetClassAllowed} from '../supabase/functions/staff-workspace-v12/ledger-rules.mjs';
const accounts=JSON.parse(fs.readFileSync(new URL('../supabase/functions/staff-workspace-v6/account-catalog.json',import.meta.url))).accounts.map(a=>({...a,status:'Active'}));
test('gross profit excludes specific operating expenses, payroll, finance and depreciation for every legal entity',()=>{
 const entries=[['40000',0,1000000],['50000',500000,0],['61180',10000,0],['60000',100000,0],['60050',6000,0],['62000',5000,0],['67050',25000,0],['40080',0,1000]].map(([account_code,debit,credit])=>({account_code,debit,credit}));
 for(const entity of ['Limited company','Sole proprietor','Partnership']){const x=profitReport(entries);assert.equal(x.gross_profit,500000,entity);assert.equal(x.profit_before_tax,355000);assert.equal(x.payroll,106000);assert.equal(x.other_income,1000);}
});
test('payroll gross cost and employer costs are charged once; deductions and settlements are liabilities',()=>{
 const x=payrollJournal({gross_pay:100000,paye:10000,employee_nssf:3000,shif:2000,employee_ahl:1500,employer_nssf:3000,employer_ahl:1500,employer_nita:50});
 assert.equal(x.reduce((s,r)=>s+r.debit-r.credit,0),0);assert.equal(profitReport(x).payroll,104550);assert.equal(x.find(r=>r.account_code==='21610').credit,83500);
 assert.throws(()=>payrollJournal({gross_pay:100,paye:200}),/deductions/);
});
test('specific non-eTIMS expenses stay below gross profit and VAT recovery needs review',()=>{
 const row={row_id:'one',revision:2,source_revision:2,dataset:'Non-eTIMS',route:2,account_code:'61180',normalized:{amount:10000,vat:1600},decision:'Eligible',deductible_percentage:100,income_treatment:'Allowable',review_details:{legal_basis:'Documented statutory basis',evidence:'Receipt reference'}};
 assert.equal(costJournal(row)[0].debit,10000);assert.equal(costJournal(row)[1].account_code,'10160');
 assert.equal(costJournal({...row,decision:'Excluded'})[0].debit,11600);
 assert.throws(()=>costJournal({...row,account_code:'50000',route:1}),/specific|Specific/);assert.throws(()=>costJournal({...row,source_revision:1}),/current/);
 assert.equal(costJournal({...row,normalized:{amount:-100,vat:-16}})[0].credit,100);
});
test('shared PPE rate gives equal book and tax amounts unless a real restriction differs',()=>{
 const rate=sharedRateSeeds.find(r=>r.class_code==='COMPUTER'),asset={cost:100000,business_percentage:100,first_use_date:'2026-01-01'};
 const x=assetCalculation(asset,rate,'2026-01-01','2026-12-31');assert.equal(x.book_annual,25000);assert.equal(x.tax_annual_projection,25000);assert.deepEqual(x.issues,[]);
 const y=periodAssetCharge(x,asset,'2026-01-01','2026-12-31','2026-01-01','2026-12-31');assert.equal(y.book_period,25000);
 const cap=assetCalculation({...asset,cost:4000000,noncommercial_vehicle:true},sharedRateSeeds.find(r=>r.class_code==='MOTOR'),'2026-01-01','2026-12-31');assert.equal(cap.book_annual,1000000);assert.equal(cap.tax_annual_projection,750000);
 const prior=assetCalculation({...asset,first_use_date:'2024-01-01',opening_book_value:8000,opening_tax_value:8000},rate,'2026-01-01','2026-12-31');assert.equal(prior.book_annual,8000);assert.equal(prior.tax_annual_projection,8000);
 assert.ok(assetCalculation({...asset,complex_case:true},rate,'2026-01-01','2026-12-31').issues.length);assert.equal(assetClassAllowed('15004','COMPUTER'),false);
});
test('opening mappings preserve the source and never insert balancing suspense',()=>{
 const x=normaliseLines([{legacy_code:'OLD42',source_name:'Original bank',debit:100,credit:0}],accounts,{allowUnmapped:true,opening:true});assert.equal(x[0].legacy_code,'OLD42');assert.equal(x[0].account_code,null);
 assert.ok(journalIssues(x,accounts,{kind:'Opening',entityType:'Limited company'}).some(s=>s.includes('No suspense')));
 assert.throws(()=>normaliseLines([{account_code:'10000',debit:-100}],accounts),/positive/);
 assert.throws(()=>normaliseLines([{account_code:'60000',debit:100}],accounts,{opening:true}),/balance-sheet/);
 const t=trialBalance(accounts,[{account_code:'10000',debit:100,credit:0}],[{account_code:'10000',debit:0,credit:10}]);assert.equal(t.find(r=>r.code==='10000').net,90);
});
test('a nonzero prior-year Difference in Books control blocks opening submission even when mapped lines balance',()=>{
 const lines=normaliseLines([{account_code:'10000',source_name:'Cash on hand',debit:100,credit:0,source_status:'Confirmed',source_reference:'Prior-year close'},{account_code:'20000',source_name:'Trade creditors',debit:0,credit:100,source_status:'Confirmed',source_reference:'Prior-year close'}],accounts,{opening:true});
 assert.deepEqual(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company'}),[]);
 assert.ok(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',difference_kes:1000.01}]}}).some(s=>s.includes('Difference in Books')));
 assert.deepEqual(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',difference_kes:0}]}}),[]);
});

import {journalExceptions,journalCheckSummary,journalIssues as issuesOf} from '../supabase/functions/staff-workspace-v12/ledger-rules.mjs';
test('journal exceptions name the failing line, its Excel row and the reason; the summary counts rows; the plain issue list is the same set of messages',()=>{
 const accounts=[{code:'10000',name:'Cash',status:'Active',is_legacy:false,in_client_chart:true},{code:'50100',name:'Not in chart',status:'Active',is_legacy:false,in_client_chart:false},{code:'30000',name:'Share capital',status:'Active',is_legacy:false,in_client_chart:true}];
 const line=(n,code,d,c,ref='Opening.xlsx | TB | row '+(n+1),st='Confirmed')=>({line_no:n,account_code:code,debit:d,credit:c,source_name:'Source '+n,source_reference:ref,source_status:st});
 const lines=[line(1,'10000',1000,0),line(2,'50100',0,600),line(3,'',0,300),line(4,'37000',0,50),line(5,'30000',0,50,'x','Unverified'),line(6,'10000',0,0)];
 const ex=journalExceptions(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',source_row:20,difference_kes:25}]}});
 const by=k=>ex.filter(e=>e.kind===k);
 assert.deepEqual(by('NOT_IN_CHART').map(e=>[e.line_no,e.source_row,e.account_code]),[[2,3,'50100']]);
 assert.deepEqual(by('UNMAPPED').map(e=>[e.line_no,e.source_row]),[[3,4]]);assert.deepEqual(by('SUSPENSE').map(e=>e.line_no),[4]);
 assert.deepEqual(by('SOURCE_UNCONFIRMED').map(e=>e.line_no),[5]);
 assert.equal(by('OUT_OF_BALANCE').length,0,'the lines balance: 1000 against 600+300+50+50');
 assert.deepEqual(by('DIFFERENCE_IN_BOOKS').map(e=>[e.scope,e.source_row,e.difference]),[['journal',20,25]]);
 assert.ok(ex.filter(e=>e.scope==='line').every(e=>e.line_no&&e.message.startsWith('Line '+e.line_no)),'every line exception names its line');
 assert.ok(!ex.some(e=>e.line_no===6),'a zero row is not an exception');
 const s=journalCheckSummary(lines,ex);
 assert.deepEqual([s.rows_total,s.rows_failing,s.rows_passing,s.journal_exceptions,s.debit,s.credit,s.difference,s.ready],[5,4,1,1,1000,1000,0,false]);
 assert.deepEqual(issuesOf(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',difference_kes:25}]}}),[...new Set(ex.map(e=>e.message))]);
 const clean=[line(1,'10000',500,0),line(2,'30000',0,500)];
 assert.deepEqual(journalExceptions(clean,accounts,{kind:'Opening',entityType:'Limited company'}),[]);assert.equal(journalCheckSummary(clean,[]).ready,true);
 const off=journalExceptions([line(1,'10000',500,0),line(2,'30000',0,400)],accounts,{kind:'Opening',entityType:'Limited company'});
 assert.deepEqual(off.map(e=>[e.kind,e.scope,e.difference]),[['OUT_OF_BALANCE','journal',100]]);
 assert.equal(journalCheckSummary([],[]).ready,false,'an empty entry is never ready');
});
