import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {normaliseLines,journalIssues,costJournal,profitReport,trialBalance,assetCalculation,periodAssetCharge,sharedRateSeeds,payrollJournal,assetClassAllowed} from '../supabase/functions/staff-workspace-v6/ledger-rules.mjs';
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
 const lines=normaliseLines([{account_code:'10000',source_name:'Cash',debit:100,credit:0,source_status:'Confirmed',source_reference:'Prior-year close'},{account_code:'20000',source_name:'Trade creditors',debit:0,credit:100,source_status:'Confirmed',source_reference:'Prior-year close'}],accounts,{opening:true});
 assert.deepEqual(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company'}),[]);
 assert.ok(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',difference_kes:1000.01}]}}).some(s=>s.includes('Difference in Books')));
 assert.deepEqual(journalIssues(lines,accounts,{kind:'Opening',entityType:'Limited company',sourceSnapshot:{source_controls:[{type:'difference_in_books',difference_kes:0}]}}),[]);
});
