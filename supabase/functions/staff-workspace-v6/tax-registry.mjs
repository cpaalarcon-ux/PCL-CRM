import {fail,text,choice} from './validation.mjs';
import {number,amount,round,graduatedTax} from './suite-rules.mjs';

export const taxKinds=['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest'];
// Client profile positions are broader than computable tax-case kinds. The extra
// entries record agent appointments, certificates, and conditional tax positions;
// they must not become calculation case types by accident.
export const profileKinds=[...taxKinds,'Withholding VAT agent','Withholding VAT credits received','Withholding income tax credits received','Excise duty','Instalment tax','Advance tax'];
export const taxTypes=['VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy','Turnover tax','Rental income tax','Capital gains tax','NSSF','Relief / deduction','Interest benchmark'];
export const testRate=r=>r.is_test===true||/^QA/i.test(r.rate_key)||/FICTIONAL|SYNTHETIC TEST/i.test(r.label||'');
export const dateString=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const keys={Company:['KE_CIT_RES'],Individual:['KE_IIT_ANNUAL'],TOT:['KE_TOT'],MRI:['KE_MRI'],CGT:['KE_CGT'],PAYE:['KE_PAYE_MONTHLY','KE_AHL_EMPLOYEE','KE_AHL_EMPLOYER','KE_SHIF','KE_NSSF','KE_NITA','KE_PAYROLL_LIMITS'],'Housing levy':['KE_AHL_EMPLOYEE','KE_AHL_EMPLOYER'],SHIF:['KE_SHIF'],NSSF:['KE_NSSF'],NITA:['KE_NITA'],'Fringe benefit':['KE_FBT_BENCHMARK','KE_CIT_RES'],'Deemed interest':['KE_DEEMED_BENCHMARK','KE_WHT_DEEMED']};
export function pickRate(rates,key,start,end=start){
 const matches=rates.filter(r=>r.rate_key===key&&r.status==='Approved'&&!r.deleted_at&&!testRate(r)&&dateString(r.effective_from)<=start&&dateString(r.effective_to)>=end);
 if(matches.length!==1)fail(400,matches.length?`Multiple approved versions of ${key} cover this period.`:`Applicable approved rate missing: ${key} (${start} to ${end}).`);
 return matches[0];
}
export function validateProfile(p){
 const entity_type=choice(p.entity_type,['Company','Partnership','Individual','Other']),residency=choice(p.residency,['Resident','Non-resident']),regime=choice(p.regime,['Standard','TOT','MRI','Special']);
 const obligations=[...new Set(p.obligations||[])].map(x=>choice(x,profileKinds));if(!obligations.length)fail(400,'Select at least one confirmed client tax position.');
 if(obligations.includes('Company')&&entity_type!=='Company'||obligations.includes('Individual')&&entity_type!=='Individual'||obligations.includes('Partnership')&&entity_type!=='Partnership')fail(400,'The income-tax obligation does not match the entity type.');
 if(regime==='TOT'&&(!obligations.includes('TOT')||residency!=='Resident'))fail(400,'The TOT profile requires a resident taxpayer and the TOT obligation.');
 if(regime==='MRI'&&(!obligations.includes('MRI')||residency!=='Resident'))fail(400,'The MRI profile requires a resident taxpayer and the MRI obligation.');
 const annual_turnover=p.annual_turnover===''||p.annual_turnover==null?null:amount(p.annual_turnover);
 if(regime==='TOT'&&(annual_turnover===null||annual_turnover<=1000000||annual_turnover>25000000))fail(400,'TOT requires reviewed annual turnover above KES 1 million and at most KES 25 million.');
 if(regime==='MRI'&&(annual_turnover===null||annual_turnover<288000||annual_turnover>15000000))fail(400,'MRI requires reviewed qualifying annual residential rent from KES 288,000 to KES 15 million.');
 if(regime==='TOT'&&['Company','Individual','Partnership'].some(x=>obligations.includes(x)))fail(400,'Mixed TOT and ordinary income needs a separately reviewed income-source profile; do not tax the same income twice.');
 return {entity_type,residency,regime,obligations,annual_turnover,notes:text(p.notes,4000)};
}
export function profileIssues(profile,c){
 const issues=[];if(!profile||profile.status!=='Verified')return ['A Manager or Partner must verify a client tax profile covering this period.'];
 if(!profile.obligations.includes(c.kind))issues.push(`${c.kind} is not confirmed in the client tax profile.`);
 if(profile.regime==='Special')issues.push('Special-regime computation requires a specialist schedule; standard rates cannot be applied automatically.');
 if(['Company','Individual','TOT','MRI'].includes(c.kind)&&profile.residency!=='Resident')issues.push('This computation supports the resident standard regime. Obtain a reviewed non-resident schedule.');
 if(c.kind==='PAYE'||['Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest','TOT','MRI'].includes(c.kind)){
  const last=new Date(Date.UTC(Number(c.starts_on.slice(0,4)),Number(c.starts_on.slice(5,7)),0)).toISOString().slice(0,10);
  if(c.starts_on.slice(8)!=='01'||c.ends_on!==last)issues.push('Use one complete calendar month for this calculation.');
 }
 if(c.kind==='Individual'&&(c.starts_on.slice(5)!=='01-01'||c.ends_on!==c.starts_on.slice(0,4)+'-12-31'))issues.push('The individual schedule requires a full calendar year.');
 return issues;
}
export function registryParameters(type,p){
 const allowed=['rate','method','fixed_amount','minimum','basis','treatment','period','bands','personal_relief','employee_rate','employer_rate','lower_limit','upper_limit','pension_monthly_cap','mortgage_monthly_cap','medical_monthly_cap','insurance_rate','insurance_monthly_cap','minimum_turnover_exclusive','maximum_turnover','minimum_annual_rent','maximum_annual_rent'];const out=Object.fromEntries(Object.entries(p||{}).filter(([k])=>allowed.includes(k)));
 if(type==='NSSF'){out.employee_rate=number(p.employee_rate,0,100);out.employer_rate=number(p.employer_rate,0,100);out.lower_limit=amount(p.lower_limit);out.upper_limit=amount(p.upper_limit);if(out.upper_limit<out.lower_limit)fail(400,'NSSF upper limit must exceed lower limit.');}
 else if(type==='Relief / deduction')for(const k of ['pension_monthly_cap','mortgage_monthly_cap','medical_monthly_cap','insurance_rate','insurance_monthly_cap'])out[k]=number(p[k],0,k==='insurance_rate'?100:1e9);
 else if(type==='PAYE'||type==='Individual income tax'){if(!Array.isArray(p.bands))fail(400,'Graduated bands are required.');}
 else if(type==='Levy'&&p.method==='fixed')out.fixed_amount=amount(p.fixed_amount);
 else out.rate=number(p.rate,0,100);
 if(out.minimum!=null)out.minimum=amount(out.minimum);
 return out;
}
export function vatRuleCheck(row,rate){
 const n=row.normalized||{},vat=Number(n.vat||0),base=Number(n.amount||0),expected=round(base*Number(rate.parameters.rate||0)/100);
 if(['Exempt','Outside scope'].includes(rate.parameters.treatment)&&row.decision==='Eligible')return 'Exempt/outside-scope expenditure cannot be marked eligible for input VAT.';
 if(Math.abs(vat-expected)>.02&&!row.vat_difference_reason)return `Imported VAT ${vat} differs from ${rate.rate_key} calculation ${expected}; correct the source or record the reviewer-supported basis.`;
 return null;
}
export function payrollFromRules(inputs,rules){
 const list=inputs.employees;if(!Array.isArray(list)||!list.length||list.length>500)fail(400,'Add 1–500 payroll rows.');
 const paye=rules.KE_PAYE_MONTHLY.parameters,limits=rules.KE_PAYROLL_LIMITS.parameters,nssf=rules.KE_NSSF.parameters;
 const employees=list.map(e=>{
  const gross=amount(e.gross),benefits=amount(e.taxable_benefits||0),pensionable=amount(e.pensionable_pay===''||e.pensionable_pay==null?gross:e.pensionable_pay),housingBase=amount(e.housing_levy_base===''||e.housing_levy_base==null?gross:e.housing_levy_base),shifBase=amount(e.shif_base===''||e.shif_base==null?gross:e.shif_base);
  if((pensionable!==gross||housingBase!==gross||shifBase!==gross)&&!e.base_reason)fail(400,'Explain statutory bases which differ from cash gross pay.');
  const pensionBase=Math.min(pensionable,nssf.upper_limit),employee_nssf=round(pensionBase*nssf.employee_rate/100),employer_nssf=round(pensionBase*nssf.employer_rate/100),shif=round(Math.max(rules.KE_SHIF.parameters.minimum||0,shifBase*rules.KE_SHIF.parameters.rate/100)),employee_ahl=round(housingBase*rules.KE_AHL_EMPLOYEE.parameters.rate/100),employer_ahl=round(housingBase*rules.KE_AHL_EMPLOYER.parameters.rate/100);
  const pension=Math.min(employee_nssf+amount(e.other_pension||0),limits.pension_monthly_cap),mortgage=Math.min(amount(e.mortgage_interest||0),limits.mortgage_monthly_cap),medical=Math.min(amount(e.postretirement_medical||0),limits.medical_monthly_cap),exemption=amount(e.approved_exemption||0);
  if((exemption||e.mortgage_interest>0||e.other_pension>0||e.insurance_premium>0||e.postretirement_medical>0)&&!e.evidence_reference)fail(400,'Add evidence references for reliefs, optional deductions or exemptions.');
  const allowed_deductions=round(pension+mortgage+medical+shif+employee_ahl),taxable=Math.max(0,round(gross+benefits-allowed_deductions-exemption)),gross_tax=graduatedTax(taxable,paye),personal=e.resident===true?amount(paye.personal_relief):0,insurance=e.resident===true?Math.min(round(amount(e.insurance_premium||0)*limits.insurance_rate/100),limits.insurance_monthly_cap):0,tax=Math.max(0,round(gross_tax-personal-insurance));
  return {name:text(e.name,160),gross,taxable_benefits:benefits,employee_nssf,employer_nssf,shif,employee_ahl,employer_ahl,nita:amount(rules.KE_NITA.parameters.fixed_amount),allowed_deductions,exemption,taxable,gross_tax,personal_relief:personal,insurance_relief:insurance,paye:tax,source_paye:amount(e.source_paye||0),variance:round(tax-amount(e.source_paye||0)),net_before_other_deductions:round(gross-employee_nssf-amount(e.other_pension||0)-shif-employee_ahl-tax),evidence_reference:String(e.evidence_reference||'')};
 });
 const result={employees,exceptions:employees.filter(e=>Math.abs(e.variance)>.01).length};
 for(const key of ['paye','employee_nssf','employer_nssf','shif','employee_ahl','employer_ahl','nita','variance'])result[key]=round(employees.reduce((s,e)=>s+e[key],0));
 return result;
}
export function simpleTax(kind,p,rules){
 const v=k=>amount(p[k]||0),rate=k=>number(rules[k].parameters.rate,0,100);let result={};
 if(kind==='TOT'||kind==='MRI'){const base=v('gross_receipts'),r=rate(kind==='TOT'?'KE_TOT':'KE_MRI');result={gross_receipts:base,rate:r,gross_tax:round(base*r/100)};}
 else if(kind==='CGT'){const gain=round(v('proceeds')-v('acquisition_cost')-v('improvement_cost')-v('transfer_cost'));result={proceeds:v('proceeds'),adjusted_cost:round(v('acquisition_cost')+v('improvement_cost')+v('transfer_cost')),gain,rate:rate('KE_CGT'),gross_tax:round(Math.max(0,gain)*rate('KE_CGT')/100)};}
 else if(kind==='WHT'){const r=rules[p.payment_code];if(!r||r.tax_type!=='Withholding tax')fail(400,'Select a reviewed WHT payment category.');if(p.eligibility_confirmed!==true||!p.evidence_reference)fail(400,'Confirm payee residence, threshold, exemption/treaty review and evidence.');result={taxable_payment:v('taxable_payment'),rate:r.parameters.rate,gross_tax:round(v('taxable_payment')*r.parameters.rate/100)};}
 else if(['Fringe benefit','Deemed interest'].includes(kind)){if(kind==='Deemed interest'&&Number(p.actual_interest_rate||0)!==0)fail(400,'This deemed-interest schedule supports qualifying interest-free loans only.');const key=kind==='Fringe benefit'?'KE_FBT_BENCHMARK':'KE_DEEMED_BENCHMARK',benchmark=rate(key),actual=number(p.actual_interest_rate||0,0,100),benefit=round(v('loan_balance')*Math.max(0,benchmark-actual)/100/12),r=rate(kind==='Fringe benefit'?'KE_CIT_RES':'KE_WHT_DEEMED');result={loan_balance:v('loan_balance'),benchmark_interest:benchmark,actual_interest:actual,monthly_taxable_interest:benefit,rate:r,gross_tax:round(benefit*r/100)};if(!p.evidence_reference)fail(400,'Link the loan balance and interest calculation evidence.');}
 else if(kind==='Housing levy'){result={gross_pay:v('gross_pay'),employee:round(v('gross_pay')*rate('KE_AHL_EMPLOYEE')/100),employer:round(v('gross_pay')*rate('KE_AHL_EMPLOYER')/100)};result.gross_tax=round(result.employee+result.employer);}
 else if(kind==='NITA'){result={headcount:number(p.headcount,0,100000),per_employee:rules.KE_NITA.parameters.fixed_amount};if(!Number.isInteger(result.headcount))fail(400,'Headcount must be a whole number.');result.gross_tax=round(result.headcount*result.per_employee);}
 else if(kind==='NSSF'||kind==='SHIF'){
  if(!p.employees?.length)fail(400,'Enter employee bases; caps and minimums apply per employee.');
  result.employees=p.employees.map(e=>{const base=amount(e.gross);if(kind==='SHIF')return {name:text(e.name,160),base,employee:round(Math.max(rules.KE_SHIF.parameters.minimum||0,base*rate('KE_SHIF')/100)),employer:0};const r=rules.KE_NSSF.parameters;return {name:text(e.name,160),base,employee:round(Math.min(base,r.upper_limit)*r.employee_rate/100),employer:round(Math.min(base,r.upper_limit)*r.employer_rate/100)};});result.gross_tax=round(result.employees.reduce((s,e)=>s+e.employee+e.employer,0));
 }
 else fail(400,'This tax calculation requires a specialist schedule.');
 const credits=v('credits');if(credits&&!p.evidence_reference)fail(400,'Link payment/certificate evidence for tax credits.');result.credits=credits;result.balance=round(result.gross_tax-credits);result.payable=Math.max(0,result.balance);result.overpayment=Math.max(0,-result.balance);return result;
}

export function validateCanonicalRate(key,type,p){
 const expected=key.startsWith('KE_VAT_')?'VAT':key.startsWith('KE_WHT_')?'Withholding tax':({KE_CIT_RES:'Corporation tax',KE_IIT_ANNUAL:'Individual income tax',KE_TOT:'Turnover tax',KE_MRI:'Rental income tax',KE_CGT:'Capital gains tax',KE_PAYE_MONTHLY:'PAYE',KE_AHL_EMPLOYEE:'Levy',KE_AHL_EMPLOYER:'Levy',KE_SHIF:'Levy',KE_NSSF:'NSSF',KE_NITA:'Levy',KE_PAYROLL_LIMITS:'Relief / deduction',KE_FBT_BENCHMARK:'Interest benchmark',KE_DEEMED_BENCHMARK:'Interest benchmark'})[key];
 if(expected&&type!==expected)fail(400,`${key} requires the ${expected} rule type.`);
 if(key==='KE_NITA'&&(p.method!=='fixed'||p.fixed_amount==null))fail(400,'NITA uses a fixed amount per employee.');
 if(key==='KE_SHIF'&&p.minimum==null)fail(400,'The SHIF per-person minimum is required.');
 if(key.startsWith('KE_VAT_')&&!p.treatment)fail(400,'VAT treatment is required.');
}
