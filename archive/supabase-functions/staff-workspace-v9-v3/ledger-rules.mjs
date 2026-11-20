import {fail} from './validation.mjs';
import {cents,money} from './accounting-rules.mjs';

export const ledgerKinds=['Opening','Purchases','Sales','Stock','Payroll','Depreciation','Adjustment','Reversal','Year close'];
export const entityTypes=['Limited company','Sole proprietor','Partnership'];
export const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const staffReviewer=a=>['PARTNER','MANAGER'].includes(a.category_code);
export const expenseBelowGrossProfit=code=>/^\d{5}$/.test(String(code))&&Number(code)>=51000&&Number(code)<=68000;
export const specificExpense=code=>expenseBelowGrossProfit(code)&&!(Number(code)>=60000&&Number(code)<=60170)&&Number(code)<67000;
export const cashAmount=v=>{if(v instanceof Date||typeof v==='boolean'||typeof v==='object')fail(400,'Use a numeric amount, not a date or formula object.');return cents(v);};
const finite=(v,label,min=0,max=1e12)=>{if(v===''||v==null||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(400,'Enter a valid '+label+'.');return Number(v);};

export function normaliseLines(input,accounts,{allowUnmapped=false,opening=false,payroll=false}={}){
 if(!Array.isArray(input)||!input.length||input.length>2000)fail(400,'Enter 1–2,000 journal lines.');
 return input.map((r,i)=>{
  const code=String(r.account_code||'').trim(),account=accounts.find(a=>a.code===code),debit=cashAmount(r.debit===''||r.debit==null?0:r.debit),credit=cashAmount(r.credit===''||r.credit==null?0:r.credit);
  if(debit<0||credit<0||debit&&credit)fail(400,`Line ${i+1}: use a positive amount on one side only.`);
  if(!allowUnmapped&&(!account||account.status!=='Active'||account.is_legacy))fail(400,`Line ${i+1}: select an active detailed master account.`);
  if(code&&!account)fail(400,`Line ${i+1}: account is not in the master catalogue.`);
  if(account&&opening&&Number(code)>=40000)fail(400,'Opening year-start balances must use balance-sheet and equity accounts. Close prior-year income and expenses first.');
  if(account&&payroll&&!(Number(code)>=60000&&Number(code)<=60170)&&!['21600','21601','21602','21603','21604','21609','21610','21611','21612','20000','10000','10020'].includes(code))fail(400,'Use payroll expense or the matching settlement/liability account.');
  return {line_no:i+1,account_code:code||null,legacy_code:String(r.legacy_code||'').slice(0,80),source_name:String(r.source_name||account?.name||'').slice(0,200),description:String(r.description||'').slice(0,1000),debit:debit/100,credit:credit/100,source_status:r.source_status==='Confirmed'?'Confirmed':'Unverified',source_reference:String(r.source_reference||'').slice(0,1000)};
 });
}
export function journalIssues(lines,accounts,{kind='Adjustment',entityType}={}){
 const issues=[],sum=lines.reduce((x,r)=>x+cashAmount(r.debit)-cashAmount(r.credit),0);
 if(!lines.length||!lines.some(l=>Number(l.debit)||Number(l.credit)))issues.push('Enter journal amounts.');
 if(sum!==0)issues.push(`Debits and credits differ by KES ${(sum/100).toFixed(2)}. No suspense entry is created.`);
 for(const r of lines){if(!Number(r.debit)&&!Number(r.credit))continue;const c=accounts.find(a=>a.code===r.account_code);
  if(!c||c.status!=='Active'||c.is_legacy)issues.push(`Line ${r.line_no}: map to an active detailed account.`);
  const n=Number(r.account_code);
  if(n===37000&&(Number(r.debit)||Number(r.credit)))issues.push('Resolve suspense before approval.');
  if(n>=30000&&n<=36020&&((entityType==='Limited company'&&n>=35000)||(entityType==='Sole proprietor'&&!(n>=35000&&n<=35010))||(entityType==='Partnership'&&!(n>=36000&&n<=36020))))issues.push(`Line ${r.line_no}: equity account does not match the entity type.`);
  if(kind==='Opening'&&(r.source_status!=='Confirmed'||String(r.source_reference||'').trim().length<3))issues.push(`Line ${r.line_no}: confirm the opening source and evidence reference.`);
 }
 return [...new Set(issues)];
}

export function costJournal(row){
 if(!row.account_code||!row.route)fail(400,'Map every selected purchase first.');
 if(row.source_revision!==row.revision||!['Eligible','Excluded'].includes(row.decision)||!row.income_treatment||row.income_treatment==='Review')fail(400,'Each source needs current independent VAT and income-tax review.');
 if(row.dataset==='Non-eTIMS'&&(!specificExpense(row.account_code)||row.route!==2||!row.review_details?.legal_basis||!row.review_details?.evidence))fail(400,'Specific non-eTIMS expenditure needs an operating/finance expense category, supported basis and receipt. Stock, PPE and payroll use their own schedules.');
 const net=cashAmount(row.normalized.amount),vat=cashAmount(row.normalized.vat||0),claim=row.decision==='Eligible'?Math.round(vat*Number(row.deductible_percentage)/100):0;
 if(!Number.isFinite(claim)||Math.abs(claim)>Math.abs(vat)||claim&&Math.sign(claim)!==Math.sign(vat))fail(400,'VAT recovery exceeds the source amount.');
 const signed=(code,value)=>({account_code:code,debit:Math.max(value,0)/100,credit:Math.max(-value,0)/100,source_status:'Confirmed',source_reference:row.row_id,description:row.narration||row.normalized.description||''});
 return [signed(row.account_code,net+vat-claim),...(claim?[signed('10160',claim)]:[]),signed('20000',-net-vat)];
}

// One balanced payroll control entry: gross pay plus employer costs, never net pay twice.
export function payrollJournal(p){
 const positive=(v,label)=>{const n=cashAmount(v??0);if(n<0)fail(400,label+' cannot be negative.');return n;};
 const gross=positive(p.gross_pay,'Gross pay'),deductions=[['21600','PAYE','paye'],['21601','SHIF','shif'],['21602','Employee housing levy','employee_ahl'],['21603','Employee NSSF','employee_nssf'],['21611','Employee pension','employee_pension'],['21609','Other deductions','other_deductions']].map(([code,label,key])=>({code,label,n:positive(p[key],label)}));
 const total=deductions.reduce((n,r)=>n+r.n,0);if(!gross||total>gross)fail(400,'Enter positive gross pay with deductions no greater than gross pay.');
 const entries=[{account_code:'60000',debit:gross/100,credit:0,description:'Gross employment pay'}];
 for(const [expense,liability,label,key] of [['60050','21603','Employer NSSF','employer_nssf'],['60060','21602','Employer housing levy','employer_ahl'],['60070','21604','NITA employer levy','employer_nita'],['60080','21611','Employer pension','employer_pension']]){const n=positive(p[key],label);if(n){entries.push({account_code:expense,debit:n/100,credit:0,description:label},{account_code:liability,debit:0,credit:n/100,description:label});}}
 for(const x of deductions)if(x.n)entries.push({account_code:x.code,debit:0,credit:x.n/100,description:x.label});
 if(gross>total)entries.push({account_code:'21610',debit:0,credit:(gross-total)/100,description:'Net wages payable; settlement clears this liability'});
 return entries.map(x=>({...x,source_status:'Confirmed',source_reference:p.evidence||''}));
}
export function assetClassAllowed(account,code){
 const choices={'15001':['LAND'],'15002':['COMMERCIAL','EDUCATIONAL','INDUSTRIAL'],'15003':['QUALMACHINE'],'15004':['MOTOR'],'15005':['FURNITURE'],'15006':['COMPUTER'],'15008':['COMPUTER'],'15009':['QUALBUILD'],'15010':['TELECOM'],'15011':['FARMWORK'],'15016':['QUALMACHINE'],'15017':['MACHINERY']};
 return (choices[account]||[]).includes(code);
}

export function trialBalance(accounts,opening,postings){
 const values=new Map(accounts.map(a=>[a.code,{...a,opening:0,movement_debit:0,movement_credit:0}]));
 for(const l of opening){const r=values.get(l.account_code);if(r)r.opening+=cashAmount(l.debit)-cashAmount(l.credit);}
 for(const l of postings){const r=values.get(l.account_code);if(r){r.movement_debit+=cashAmount(l.debit);r.movement_credit+=cashAmount(l.credit);}}
 return [...values.values()].map(a=>{const net=a.opening+a.movement_debit-a.movement_credit;return {...a,opening:a.opening/100,movement_debit:a.movement_debit/100,movement_credit:a.movement_credit/100,net:net/100,debit:Math.max(net,0)/100,credit:Math.max(-net,0)/100};});
}
export function profitReport(lines){
 const total=(lo,hi,sign=1)=>money(lines.filter(l=>Number(l.account_code)>=lo&&Number(l.account_code)<=hi).reduce((n,l)=>n+sign*(Number(l.debit)-Number(l.credit)),0));
 const sales=total(40000,40070,-1)+total(40100,40100,-1),other_income=total(40080,40090,-1)+total(40110,40140,-1),cost_of_sales=total(50000,50150),gross_profit=money(sales-cost_of_sales),payroll=total(60000,60170),finance=total(62000,62090),depreciation=total(67010,67070),all_expenses=total(51000,68000),other_expenses=money(all_expenses-payroll-finance-depreciation),profit_before_tax=money(gross_profit+other_income-all_expenses),income_tax=total(69000,69010);
 return {sales,other_income,cost_of_sales,gross_profit,operating_expenses:other_expenses,payroll,finance,depreciation,total_expenses:all_expenses,profit_before_tax,income_tax,profit_after_tax:money(profit_before_tax-income_tax),statement:'Client accounting profit from posted entries only. Source schedules and tax wear and tear are not deducted a second time.'};
}

export function assetCalculation(asset,rate,start,end){
 const cost=cashAmount(asset.cost)/100,business=finite(asset.business_percentage,'business-use percentage',0,100)/100,first=day(asset.first_use_date),fyStart=day(start),fyEnd=day(end),issues=[];
 if(!first||first>fyEnd)issues.push('Confirm a first-use date within or before this financial year.');
 if(day(rate.effective_from)>fyStart||day(rate.effective_to)<fyEnd)issues.push('Select one reviewed rule covering this financial year.');
 if(asset.complex_case)issues.push('A disposal, special incentive or transitional case needs a supported separate adjustment.');
 const firstRate=finite(rate.first_rate,'first-use rate',0,100)/100,laterRate=finite(rate.annual_rate,'annual rate',0,100)/100,factor=finite(rate.later_basis_percentage,'later basis percentage',0,100)/100;
 const sameYear=first>=fyStart&&first<=fyEnd;
 const noncommercial=rate.class_code==='MOTOR'&&asset.noncommercial_vehicle===true;
 if(noncommercial&&!(Number(rate.tax_cost_cap)>0))issues.push('Confirm the dated statutory motor-vehicle cost cap.');
 const taxBasis=money(Math.min(cost,noncommercial&&Number(rate.tax_cost_cap)>0?Number(rate.tax_cost_cap):cost)*business);
 let book=null,tax=null;
 if(rate.class_code==='LAND'){book=0;tax=0;}
 else if(sameYear){book=money(cost*firstRate);tax=money(taxBasis*firstRate);}
 else {
  if(asset.opening_book_value==null||asset.opening_book_value==='')issues.push('Opening book carrying amount is missing.');
  else book=money(Math.min(finite(asset.opening_book_value,'opening book value'),cost*factor*laterRate));
  if(asset.opening_tax_value==null||asset.opening_tax_value==='')issues.push('Opening tax written-down value is missing.');
  else tax=money(Math.min(finite(asset.opening_tax_value,'opening tax value'),taxBasis*factor*laterRate));
 }
 if(book!=null&&book<0||tax!=null&&tax<0)issues.push('Annual charge cannot be negative.');
 const elapsed=Math.max(0,(Date.parse(fyEnd+'T00:00:00Z')-Date.parse(fyStart+'T00:00:00Z'))/86400000+1);
 return {book_annual:book,tax_annual_projection:tax,difference:book==null||tax==null?null:money(book-tax),qualifying_tax_cost:taxBasis,first_use_year:sameYear,shared_rate:sameYear?rate.first_rate:rate.annual_rate,method:rate.method,days:elapsed,issues,label:'Shared-rate annual projection. Book depreciation is posted once; tax wear and tear is a reconciliation item, not another expense.'};
}
export function periodAssetCharge(result,asset,fyStart,fyEnd,start,end){
 const max=(a,b)=>a>b?a:b,min=(a,b)=>a<b?a:b;
 const s=max(day(start),max(day(fyStart),day(asset.first_use_date))),e=min(day(end),day(fyEnd));
 const days=s>e?0:Math.round((Date.parse(e+'T00:00:00Z')-Date.parse(s+'T00:00:00Z'))/86400000)+1;
 // The same policy allocates the annual estimate over days in use in this year.
 const inUseStart=max(day(fyStart),day(asset.first_use_date));
 const denominator=Math.round((Date.parse(day(fyEnd)+'T00:00:00Z')-Date.parse(inUseStart+'T00:00:00Z'))/86400000)+1;
 if(result.issues.length||denominator<=0)return {...result,book_period:null,tax_period_projection:null};
 return {...result,book_period:money(Number(result.book_annual)*days/denominator),tax_period_projection:money(Number(result.tax_annual_projection)*days/denominator),charge_start:day(start),charge_end:day(end)};
}

export const sharedRateSeeds=[
 ['MOTOR','Motor vehicles and heavy earth-moving equipment',25,25,100,'67030','15920',3000000],
 ['COMPUTER','Computer hardware and qualifying software',25,25,100,'67050','15940',null],
 ['FURNITURE','Furniture and fittings',10,10,100,'67040','15930',null],
 ['TELECOM','Telecommunications equipment',10,10,100,'67020','15910',null],
 ['MACHINERY','Other machinery',10,10,100,'67020','15910',null],
 ['COMMERCIAL','Commercial buildings',10,10,100,'67010','15900',null],
 ['EDUCATIONAL','Qualifying educational buildings',10,10,100,'67010','15900',null],
 ['INDUSTRIAL','Industrial buildings and docks',10,10,100,'67010','15900',null],
 ['QUALBUILD','Qualifying hotel / manufacture / hospital building',50,25,50,'67010','15900',null],
 ['QUALMACHINE','Qualifying manufacturing / hospital equipment / ships',50,25,50,'67020','15910',null],
 ['FARMWORK','Qualifying farmworks',50,25,50,'67010','15900',null],
 ['LAND','Land',0,0,100,'67010','15900',null]
].map(([class_code,name,first_rate,annual_rate,later_basis_percentage,expense_account,contra_account,tax_cost_cap])=>({class_code,name,first_rate,annual_rate,later_basis_percentage,expense_account,contra_account,tax_cost_cap,method:'Equal instalments',effective_from:'2026-01-01',effective_to:'2026-12-31',source_reference:'Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf',source_checked_on:'2026-10-26',scope:'Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic.'}));
