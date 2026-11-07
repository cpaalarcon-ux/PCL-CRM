import {fail} from './validation.mjs';
import {cents,money} from './accounting-rules.mjs';

export const ledgerKinds=['Opening','Purchases','Sales','Stock','Payroll','Depreciation','Adjustment','Reversal','Year close'];
export const entityTypes=['Limited company','Sole proprietor','Partnership','Non-profit organisation','Foreign branch'];
export const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const staffReviewer=a=>['PARTNER','MANAGER'].includes(a.category_code);
export const expenseBelowGrossProfit=code=>/^\d{5}$/.test(String(code))&&Number(code)>=51000&&Number(code)<=68000;
export const specificExpense=code=>expenseBelowGrossProfit(code)&&!(Number(code)>=60000&&Number(code)<=60170)&&Number(code)<67000;
export const cashAmount=v=>{if(v instanceof Date||typeof v==='boolean'||typeof v==='object')fail(400,'Use a numeric amount, not a date or formula object.');return cents(v);};
const finite=(v,label,min=0,max=1e12)=>{if(v===''||v==null||typeof v==='boolean'||!Number.isFinite(Number(v))||Number(v)<min||Number(v)>max)fail(400,'Enter a valid '+label+'.');return Number(v);};

// Where last year's income and expenses go when the source TB has not been closed. Shown in the error so the preparer knows the fix.
export function closingAccountHint(entityType){
 const t=String(entityType||'').toLowerCase();
 if(/limited|company|ltd|plc/.test(t))return {code:'31000',name:'Retained earnings - companies'};
 if(/partner/.test(t))return {code:'36010',name:'Partner current accounts'};
 if(/sole|proprietor/.test(t))return {code:'35000',name:'Proprietor capital - sole proprietorship'};
 return {code:'32000',name:'Current year retained result'};
}
export function normaliseLines(input,accounts,{allowUnmapped=false,opening=false,payroll=false,entityType=''}={}){
 if(!Array.isArray(input)||!input.length||input.length>2000)fail(400,'Enter 1–2,000 journal lines.');
 if(opening){
  const bad=input.map((r,i)=>({i,code:String(r.account_code||'').trim(),r})).filter(x=>x.code&&accounts.some(a=>a.code===x.code)&&Number(x.code)>=40000&&(Number(x.r.debit)||Number(x.r.credit)));
  if(bad.length){const shown=bad.slice(0,6).map(x=>`line ${x.i+1} (${x.r.legacy_code?x.r.legacy_code+' ':''}${String(x.r.source_name||'').slice(0,40)} → ERP ${x.code})`).join('; ');fail(400,`Opening year-start balances must use balance-sheet and equity accounts. ${bad.length} line(s) use an income or expense account: ${shown}${bad.length>6?' and more':''}. Close last year's income and expenses into ${closingAccountHint(entityType).code} ${closingAccountHint(entityType).name} for this client: change each of these lines to that account, or close them in the source TB before uploading.`);}
 }
 return input.map((r,i)=>{
  const code=String(r.account_code||'').trim(),account=accounts.find(a=>a.code===code),debit=cashAmount(r.debit===''||r.debit==null?0:r.debit),credit=cashAmount(r.credit===''||r.credit==null?0:r.credit);
  if(debit<0||credit<0||debit&&credit)fail(400,`Line ${i+1}: use a positive amount on one side only.`);
  if(!allowUnmapped&&(!account||account.status!=='Active'||account.is_legacy))fail(400,`Line ${i+1}: select an active detailed master account.`);
  if(code&&!account)fail(400,`Line ${i+1}: account is not in the master catalogue.`);
  if(account&&opening&&Number(code)>=40000)fail(400,'Opening year-start balances must use balance-sheet and equity accounts. Close prior-year income and expenses first.');
  if(account&&payroll&&!(Number(code)>=60000&&Number(code)<=60170)&&!['21600','21601','21602','21603','21604','21609','21610','21611','21612','20000','10000','10020'].includes(code))fail(400,'Use payroll expense or the matching settlement/liability account.');
  return {line_no:i+1,account_code:code||null,legacy_code:String(r.legacy_code||'').slice(0,80),source_name:String(r.source_name||account?.name||'').slice(0,200),description:String(r.description||'').slice(0,1000),debit:debit/100,credit:credit/100,source_status:r.source_status==='Confirmed'?'Confirmed':'Unverified',source_reference:String(r.source_reference||'').slice(0,1000),activity_id:/^[0-9a-f-]{36}$/i.test(String(r.activity_id||''))?String(r.activity_id):null};
 });
}
// Structured exceptions for a journal: the same rules journalIssues has always applied, but each failure says which line and why, so a preparer can fix
// only the broken rows. scope is 'journal' (affects the whole entry) or 'line'. source_row is the Excel row the line came from, when it has one.
export function journalExceptions(lines,accounts,{kind='Adjustment',entityType='',sourceSnapshot={}}={}){
 const out=[],sum=lines.reduce((x,r)=>x+cashAmount(r.debit)-cashAmount(r.credit),0);
 const add=(scope,e)=>out.push({scope,line_no:null,source_row:null,account_code:null,source_name:'',...e});
 if(!lines.length||!lines.some(l=>Number(l.debit)||Number(l.credit)))add('journal',{kind:'NO_AMOUNTS',message:'Enter journal amounts.'});
 if(sum!==0)add('journal',{kind:'OUT_OF_BALANCE',difference:sum/100,message:`Debits and credits differ by KES ${(sum/100).toFixed(2)}. The trial balance must balance: correct the entry. No suspense or balancing entry is created or allowed.`});
 if(kind==='Opening')for(const control of sourceSnapshot?.source_controls||[]){
  if(control.type==='difference_in_books'&&Math.abs(Number(control.difference_kes||0))>0.01)add('journal',{kind:'DIFFERENCE_IN_BOOKS',source_row:control.source_row||null,difference:Number(control.difference_kes),message:`The source trial balance reports a non-zero “Difference in Books” of KES ${Number(control.difference_kes).toFixed(2)}. Reconcile the prior-year closing balance before submitting this opening entry.`});
 }
 for(const r of lines){if(!Number(r.debit)&&!Number(r.credit))continue;const c=accounts.find(a=>a.code===r.account_code);
  const sourceRow=Number((String(r.source_reference||'').match(/\|\s*row\s+(\d+)\s*$/i)||String(r.description||'').match(/Excel row (\d+)/)||[])[1])||null;
  const line=(k,message)=>add('line',{kind:k,line_no:r.line_no,source_row:sourceRow,account_code:r.account_code||null,source_name:r.source_name||'',message});
  if(String(r.account_code)==='37000')line('SUSPENSE',`Line ${r.line_no}: there is no suspense account. Post to the correct account; the trial balance must balance.`);
  else if(!c||c.status!=='Active'||c.is_legacy)line(r.account_code?'ACCOUNT_NOT_ACTIVE':'UNMAPPED',`Line ${r.line_no}: map to an active detailed account.`);
  else if(c.in_client_chart===false)line('NOT_IN_CHART',`Line ${r.line_no}: ERP account ${r.account_code} is not in this client's approved chart of accounts.`);
  const n=Number(r.account_code);
  if(n>=30000&&n<=36020&&((entityType==='Limited company'&&n>=35000)||(entityType==='Sole proprietor'&&!(n>=35000&&n<=35010))||(entityType==='Non-profit organisation'&&(n<=31000||n>=35000))||(entityType==='Partnership'&&!(n>=36000&&n<=36020))||(entityType==='Foreign branch'&&(n<=31000||n>=35000))))line('EQUITY_ENTITY_MISMATCH',`Line ${r.line_no}: equity account does not match the entity type.`);
  if(kind==='Opening'&&(r.source_status!=='Confirmed'||String(r.source_reference||'').trim().length<3))line('SOURCE_UNCONFIRMED',`Line ${r.line_no}: confirm the opening source and evidence reference.`);
 }
 return out;
}
export function journalIssues(lines,accounts,options={}){return [...new Set(journalExceptions(lines,accounts,options).map(e=>e.message))];}
// What the preparer sees: how many rows pass, which fail and why, the totals, and whether the entry may be sent for review (only with no exceptions).
export function journalCheckSummary(lines,exceptions){
 const used=lines.filter(l=>Number(l.debit)||Number(l.credit)),failing=new Set(exceptions.filter(e=>e.scope==='line').map(e=>e.line_no));
 const debit=used.reduce((n,l)=>n+cashAmount(l.debit),0),credit=used.reduce((n,l)=>n+cashAmount(l.credit),0);
 return {rows_total:used.length,rows_failing:failing.size,rows_passing:used.length-failing.size,journal_exceptions:exceptions.filter(e=>e.scope==='journal').length,debit:debit/100,credit:credit/100,difference:(debit-credit)/100,ready:exceptions.length===0&&used.length>0};
}

export function costJournal(row){
 if(!row.account_code||!row.route)fail(400,'Map every selected purchase first.');
 if(row.source_revision!==row.revision||!['Eligible','Excluded'].includes(row.decision)||!row.income_treatment||row.income_treatment==='Review')fail(400,'Each source needs current independent VAT and income-tax review.');
 if(row.dataset==='Non-eTIMS'&&(!specificExpense(row.account_code)||row.route!==2||!row.review_details?.legal_basis||!row.review_details?.evidence))fail(400,'Specific non-eTIMS expenditure needs an operating/finance expense category, supported basis and receipt. Stock, PPE and payroll use their own schedules.');
 if(row.normalized.vat==null)fail(400,'Confirm the source VAT amount, including an explicit zero where applicable, before posting.');
 const net=cashAmount(row.normalized.amount),vat=cashAmount(row.normalized.vat),claim=row.decision==='Eligible'?Math.round(vat*Number(row.deductible_percentage)/100):0;
 if(!Number.isFinite(claim)||Math.abs(claim)>Math.abs(vat)||claim&&Math.sign(claim)!==Math.sign(vat))fail(400,'VAT recovery exceeds the source amount.');
 const signed=(code,value)=>({account_code:code,debit:Math.max(value,0)/100,credit:Math.max(-value,0)/100,source_status:'Confirmed',source_reference:row.row_id,description:row.narration||row.normalized.description||''});
 return [{...signed(row.account_code,net+vat-claim),activity_id:row.review_details?.activity_id||null},...(claim?[signed('10160',claim)]:[]),signed('20000',-net-vat)];
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
 const sales=total(40000,40070,-1)+total(40100,40100,-1)+total(40150,40299,-1),other_income=total(40080,40090,-1)+total(40110,40140,-1),cost_of_sales=total(50000,50999),gross_profit=money(sales-cost_of_sales),payroll=total(60000,60170),finance=total(62000,62090),depreciation=total(67010,67070),all_expenses=total(51000,68000),other_expenses=money(all_expenses-payroll-finance-depreciation),profit_before_tax=money(gross_profit+other_income-all_expenses),income_tax=total(69000,69010);
 return {sales,other_income,cost_of_sales,gross_profit,operating_expenses:other_expenses,payroll,finance,depreciation,total_expenses:all_expenses,profit_before_tax,income_tax,profit_after_tax:money(profit_before_tax-income_tax),statement:'Client accounting profit from posted entries only. Source schedules and tax wear and tear are not deducted a second time.'};
}

// Annual source-and-application control modeled on the client worksheet. It is
// calculated from posted TB balances and movements, with no suspense/plug line.
export function sourceApplicationSchedule(tb){
 const accounts=(tb||[]).filter(a=>Number(a.opening)||Number(a.net)||Number(a.movement_debit)||Number(a.movement_credit));
 const code=a=>Number(a.code),sum=(list,fn)=>money(list.reduce((n,a)=>n+fn(a),0));
 const rows=[];
 const add=(section,label,list,amountFn)=>{const amount=sum(list,amountFn);if(amount||list.length)rows.push({section,label,amount,accounts:list.map(a=>({code:a.code,name:a.name,opening:money(Number(a.opening||0)),closing:money(Number(a.net||0)),movement_debit:money(Number(a.movement_debit||0)),movement_credit:money(Number(a.movement_credit||0)),amount:money(amountFn(a))})).filter(a=>a.amount||a.opening||a.closing)});};
 const cash=accounts.filter(a=>code(a)>=10000&&code(a)<=10050),assetGroups=[
  ['Receivables, tax credits and prepayments',a=>code(a)>=10060&&code(a)<=10189||code(a)>=10260&&code(a)<=10300],
  ['Inventory and stock',a=>code(a)>=10190&&code(a)<=10250],
  ['Other current assets',a=>code(a)>10300&&code(a)<15000],
  ['Property and other non-current assets',a=>code(a)>=15000&&code(a)<20000&&a.account_group!=='Contra assets']
 ];
 const nonCashAssets=accounts.filter(a=>code(a)>=10060&&code(a)<20000&&a.account_group!=='Contra assets');
 const liabilities=accounts.filter(a=>code(a)>=20000&&code(a)<30000),equity=accounts.filter(a=>code(a)>=30000&&code(a)<40000),income=accounts.filter(a=>code(a)>=40000&&code(a)<50000),expenses=accounts.filter(a=>code(a)>=50000&&code(a)<=69999),contraAssets=accounts.filter(a=>a.account_group==='Contra assets');
 const nonCashExpenses=expenses.filter(a=>(code(a)>=67010&&code(a)<=67070)||code(a)===68000),cashExpenses=expenses.filter(a=>!((code(a)>=67010&&code(a)<=67070)||code(a)===68000));
 add('Source','Opening cash and bank',cash,a=>Number(a.opening||0));
 add('Source','Sales and other income',income,a=>Number(a.movement_credit||0)-Number(a.movement_debit||0));
 for(const [label,predicate] of assetGroups){const group=nonCashAssets.filter(predicate);add('Source',`Decrease in ${label.toLowerCase()}`,group,a=>Math.max(0,Number(a.opening||0)-Number(a.net||0)));add('Application',`Increase in ${label.toLowerCase()}`,group,a=>Math.max(0,Number(a.net||0)-Number(a.opening||0)));}
 add('Source','Increase in creditors, tax liabilities and loans',liabilities,a=>Math.max(0,Number(a.opening||0)-Number(a.net||0)));
 add('Application','Decrease in creditors, tax liabilities and loans',liabilities,a=>Math.max(0,Number(a.net||0)-Number(a.opening||0)));
 add('Source','Increase in capital and other equity',equity,a=>Math.max(0,Number(a.opening||0)-Number(a.net||0)));
 add('Application','Decrease in capital and other equity',equity,a=>Math.max(0,Number(a.net||0)-Number(a.opening||0)));
 add('Memo','Non-cash depreciation and impairment (excluded from cash applications)',nonCashExpenses,a=>Number(a.movement_debit||0)-Number(a.movement_credit||0));
 // A disposal or prior-period contra-asset adjustment can move accumulated
 // depreciation without a current-year depreciation expense. Show that net
 // ledger-derived adjustment explicitly; it is never a user-entered plug.
 const assetAdjustment=money([...contraAssets,...nonCashExpenses].reduce((n,a)=>n+Number(a.movement_debit||0)-Number(a.movement_credit||0),0));
 if(assetAdjustment>0)add('Application','Asset disposal / accumulated depreciation adjustment',[...contraAssets,...nonCashExpenses],a=>Number(a.movement_debit||0)-Number(a.movement_credit||0));
 else if(assetAdjustment<0)add('Source','Asset disposal / accumulated depreciation adjustment',[...contraAssets,...nonCashExpenses],a=>Number(a.movement_credit||0)-Number(a.movement_debit||0));
 add('Application','Purchases, cost of sales and expenses (excluding non-cash depreciation / impairment)',cashExpenses,a=>Math.max(0,Number(a.movement_debit||0)-Number(a.movement_credit||0)));
 add('Application','Closing cash and bank',cash,a=>Number(a.net||0));
 const sources=rows.filter(r=>r.section==='Source'),applications=rows.filter(r=>r.section==='Application'),memo=rows.filter(r=>r.section==='Memo'),source_total=sum(sources,r=>r.amount),application_total=sum(applications,r=>r.amount),difference=money(source_total-application_total);
 const trial_balance_difference=money(accounts.reduce((n,a)=>n+Number(a.net||0),0)),opening_trial_balance_difference=money(accounts.reduce((n,a)=>n+Number(a.opening||0),0)),tie_out_difference=money(difference+trial_balance_difference);
 const unclassified=accounts.filter(a=>{const n=code(a);return !(n>=10000&&n<=69999);}).map(a=>({code:a.code,name:a.name,opening:money(Number(a.opening||0)),closing:money(Number(a.net||0))}));
 const hasActivity=list=>list.some(a=>Number(a.opening)||Number(a.net)||Number(a.movement_debit)||Number(a.movement_credit));
 const loanAccounts=accounts.filter(a=>['20070','20080','20090'].includes(String(a.code)));
 const stockAccounts=accounts.filter(a=>Number(a.code)>=10190&&Number(a.code)<=10250);
 const expenseAccounts=expenses.filter(a=>!(code(a)>=67010&&code(a)<=67070));
 const requirements=[
  {key:'bank_statements',label:'Bank statements and annual bank review',required:true,ledger_signal:'Annual bank evidence is required for the tax review.'},
  {key:'loan_statements',label:'Loan / overdraft statements',required:hasActivity(loanAccounts),ledger_signal:hasActivity(loanAccounts)?'Loan or overdraft balances/activity appear in the posted trial balance.':'No loan or overdraft balance/activity appears in the posted trial balance; confirm against client records.'},
  {key:'other_expenses',label:'Other expense support',required:hasActivity(expenseAccounts),ledger_signal:hasActivity(expenseAccounts)?'Expense or purchase activity appears in the posted trial balance.':'No expense activity appears in the posted trial balance; confirm completeness.'},
  {key:'stock_movement',label:'Stock movement report',required:hasActivity(stockAccounts),ledger_signal:hasActivity(stockAccounts)?'Inventory balances/activity appear in the posted trial balance.':'No inventory balance/activity appears in the posted trial balance; confirm completeness.'}
 ];
 const issues=[];if(unclassified.length)issues.push('Map nonzero balances outside the supported Source & Application account ranges before annual review.');
 if(Math.abs(opening_trial_balance_difference)>0.01)issues.push('The opening trial balance is out by KES '+opening_trial_balance_difference.toFixed(2)+'. Reconcile opening balances before relying on this annual schedule.');
 if(Math.abs(difference)>0.01)issues.push('Source & Application of Funds does not balance. Review posted balances and movements; the ERP will not create a balancing entry.');
 if(Math.abs(trial_balance_difference)>0.01)issues.push('The closing trial balance is out by KES '+trial_balance_difference.toFixed(2)+'.');
 if(Math.abs(tie_out_difference)>0.01)issues.push('Source & Application does not tie to the closing trial balance. Check that the opening trial balance balanced and all account classes are included.');
 return {name:'Source & Application of Funds',sources,applications,memo,source_total,application_total,difference,trial_balance_difference,opening_trial_balance_difference,tie_out_difference,balanced:Math.abs(difference)<=0.01&&Math.abs(trial_balance_difference)<=0.01&&Math.abs(opening_trial_balance_difference)<=0.01&&Math.abs(tie_out_difference)<=0.01,unclassified,requirements,issues,basis:'Calculated from posted annual opening balances and posted journal movements. Non-cash depreciation is shown separately and excluded from cash applications, as in the supplied schedule. VAT/input tax, tax credits, inventory, payables, loans, PPE and equity movements remain traceable in account details. This control does not prove source completeness or approve a tax claim.'};
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

// Profit per business activity from posted income and expense lines. Lines without an activity
// are shown as Unallocated, so the activity columns always add up to the total.
export function profitByActivity(lines,activities){
 const pl=lines.filter(l=>Number(l.account_code)>=40000);
 const columns=activities.map(a=>({activity_id:a.activity_id,activity_name:a.activity_name,pack_code:a.pack_code,is_primary:!!a.is_primary,...profitReport(pl.filter(l=>l.activity_id===a.activity_id))}));
 const known=new Set(activities.map(a=>a.activity_id)),unallocated=profitReport(pl.filter(l=>!l.activity_id||!known.has(l.activity_id)));
 return {activities:columns,unallocated,total:profitReport(pl),statement:'Posted income and expense lines by business activity. Unallocated lines have no activity tag.'};
}
// ISO-8601 week of a date (weeks start Monday; week 1 contains the first Thursday).
export function isoWeek(dateText){
 const d=new Date(String(dateText).slice(0,10)+'T00:00:00Z'),dow=(d.getUTCDay()+6)%7,thu=new Date(d);thu.setUTCDate(d.getUTCDate()-dow+3);
 const year=thu.getUTCFullYear(),jan4=new Date(Date.UTC(year,0,4)),week=1+Math.round(((thu-jan4)/864e5-3+((jan4.getUTCDay()+6)%7))/7);
 const start=new Date(d);start.setUTCDate(d.getUTCDate()-dow);const end=new Date(start);end.setUTCDate(start.getUTCDate()+6);
 return {year,week,starts_on:start.toISOString().slice(0,10),ends_on:end.toISOString().slice(0,10),label:`${year} – Week ${week}`};
}
export const DATA_CUTOFF='2025-12-31';
// The ERP holds financial years ending 31 December 2025 or later. A client's first supported year starts the day after the previous
// year-end, so a December client starts on 1 January 2025 and a June client on 1 July 2025.
export function firstSupportedStart(month=12,day=31){
 const m=Math.min(12,Math.max(1,Math.trunc(Number(month))||12)),d=Math.max(1,Math.trunc(Number(day))||31);
 const yearEnd=y=>Date.UTC(y,m-1,Math.min(d,new Date(Date.UTC(y,m,0)).getUTCDate()));
 const y=yearEnd(2025)>=Date.parse(DATA_CUTOFF+'T00:00:00Z')?2025:2026;
 return new Date(yearEnd(y-1)+86400000).toISOString().slice(0,10);
}
export const unsupportedPeriodMessage=start=>`The ERP holds data for periods ending 31 December 2025 onwards. This client's first supported date is ${start}. Keep earlier periods in the client\u2019s previous records.`;
