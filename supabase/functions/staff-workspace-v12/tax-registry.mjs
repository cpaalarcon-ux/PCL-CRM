import {fail,text,choice,date,uuid} from './validation.mjs';
import {number,amount,round,graduatedTax} from './suite-rules.mjs';

export const taxKinds=['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest'];
// Client profile positions are broader than computable tax-case kinds. The extra
// entries record agent appointments, certificates, and conditional tax positions;
// they must not become calculation case types by accident.
// Income tax for bodies that earn taxable profit but are not companies, partnerships or individuals (co-operatives, trusts, associations).
// Non-profits and public bodies pay payroll taxes only and have no income-tax position.
// It records the filing position only: the ERP does not compute it until a separate rule is released, so it is not a case type.
export const otherEntityIncomeKinds=['Other entity income tax'];
export const profileKinds=[...taxKinds,'Withholding VAT agent','Withholding VAT credits received','Withholding income tax credits received','Excise duty','Instalment tax','Advance tax','NCA levy','Tourism levy','Catering levy','SEPT',...otherEntityIncomeKinds];
export const taxTypes=['VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy','Turnover tax','Rental income tax','Capital gains tax','NSSF','Relief / deduction','Interest benchmark'];
export const testRate=r=>r.is_test===true||/^QA/i.test(r.rate_key)||/FICTIONAL|SYNTHETIC TEST/i.test(r.label||'');
export const obligationStatusOptions={registered:['YES','NO','UNKNOWN'],applicable:['YES','NO','TO_CONFIRM'],client_status:['ACTIVE','DORMANT','NIL_FILER','DEREGISTERED','NOT_REGISTERED','UNKNOWN']};
const finalIncomeRegimes=['TOT','MRI'];
const ordinaryIncomePositions=['Company','Partnership','Individual','Instalment tax','Advance tax','Other entity income tax'];
export function normalizeObligationStatuses(obligations,raw,profileFrom,profileTo){
 if(raw!=null&&(typeof raw!=='object'||Array.isArray(raw)))fail(400,'Obligation status details must be an object keyed by the selected tax position.');
 const source=raw||{},selected=new Set(obligations),extra=Object.keys(source).filter(k=>!selected.has(k));
 if(extra.length)fail(400,`Remove status details for unselected positions: ${extra.join(', ')}.`);
 return Object.fromEntries(obligations.map(code=>{const x=source[code]||{},effective_from=date(x.effective_from||profileFrom),effective_to=date(x.effective_to||profileTo),handling_firm_ids=[...new Set((Array.isArray(x.handling_firm_ids)?x.handling_firm_ids:[]).map(v=>uuid(v)))];if(!effective_from||!effective_to||effective_to<effective_from||profileFrom&&effective_from<date(profileFrom)||profileTo&&effective_to>date(profileTo))fail(400,`${code}: choose valid obligation dates within the client tax-profile period.`);if(handling_firm_ids.length>50)fail(400,`${code}: select no more than 50 handling firms.`);return [code,{registered:choice(x.registered||'UNKNOWN',obligationStatusOptions.registered),applicable:choice(x.applicable||'TO_CONFIRM',obligationStatusOptions.applicable),client_status:choice(x.client_status||x.clientStatus||'UNKNOWN',obligationStatusOptions.client_status),evidence_reference:text(x.evidence_reference||x.evidence||'',300,false),effective_from,effective_to,handling_firm_ids}];}));
}
export function obligationWorkIssue(profile,code){
 if(!profile||profile.status!=='Verified')return 'Verify a dated client tax profile before scheduling tax work.';
 if(!(profile.obligations||[]).includes(code))return `${code} is not recorded on the client tax profile.`;
 if(!profile.obligations_reviewed_at)return 'Registration and applicability details have not been independently reviewed.';
 const s=profile.obligation_statuses?.[code];if(!s)return `${code}: registration, applicability and client status are not recorded.`;
 if(s.registered!=='YES')return `${code}: iTax registration is ${s.registered||'unknown'}; no filing task may be generated.`;
 if(s.applicable!=='YES')return `${code}: legal applicability is ${s.applicable||'not confirmed'}; no filing task may be generated.`;
 if(!s.evidence_reference)return `${code}: link iTax or other registration evidence before scheduling.`;
 if(['DEREGISTERED','NOT_REGISTERED','UNKNOWN'].includes(s.client_status))return `${code}: client status ${s.client_status} is not eligible for a filing task.`;
 if(code==='TOT'){
  if(profile.regime!=='TOT')return 'The client tax profile is not under the TOT income regime.';
  if(profile.vat_taxable_supplies_status!=='CONFIRMED'||profile.vat_taxable_supplies_12m==null||!profile.vat_threshold_checked_on||!profile.vat_threshold_evidence_reference)return 'Check, date and link evidence for the rolling 12-month vatable-supplies figure before scheduling TOT.';
  if(Number(profile.vat_taxable_supplies_12m)>=5000000){const vat=profile.obligation_statuses?.VAT;if(!(profile.obligations||[]).includes('VAT')||vat?.registered!=='YES'||vat?.applicable!=='YES'||!vat?.evidence_reference)return 'KRA threshold check: a TOT taxpayer with taxable supplies of KES 5 million or more needs VAT registration evidence before filing work is generated.';}
 }
 if(code==='VAT'&&profile.regime==='TOT'&&(profile.vat_taxable_supplies_status!=='CONFIRMED'||profile.vat_taxable_supplies_12m==null||!profile.vat_threshold_checked_on||!profile.vat_threshold_evidence_reference))return 'Check, date and support the rolling 12-month taxable-supplies figure; VAT and TOT may coexist.';
 return null;
}
const officialTaxSourceRoots=['kenyalaw.org','kra.go.ke','nssf.or.ke','nita.or.ke','nita.go.ke','epra.go.ke','parliament.go.ke','treasury.go.ke','sha.go.ke'];
export function taxSourceIssue(sourceUrl,sourceNote){
 let url;try{url=new URL(String(sourceUrl||''));}catch{return 'Link an official Kenya Law, KRA, Gazette or competent regulator source before approval.';}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.username||url.password||url.port||!officialTaxSourceRoots.some(root=>host===root||host.endsWith('.'+root)))
  return 'Rate approval requires an HTTPS official source hosted by Kenya Law, KRA, the Gazette or a competent regulator; secondary research links can support testing only.';
 if(!/\b(?:act|section|s\.|legal notice|ln\b|regulation|schedule|gazette|court order|judgment)\b/i.test(String(sourceNote||'')))
  return 'Add the applicable Act, section, Legal Notice, regulation, Schedule or Gazette citation to the source note.';
 return null;
}
export function rateApprovalIssue(rate,approverId){
 if(rate?.created_by&&String(rate.created_by)===String(approverId))return 'The person who prepared this tax rule cannot approve it.';
 return taxSourceIssue(rate?.source_url,rate?.source_note);
}
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
 if(otherEntityIncomeKinds.some(x=>obligations.includes(x))&&entity_type!=='Other')fail(400,'Other entity income tax is for co-operatives, trusts, associations and similar bodies that earn taxable profit. Choose the Other taxpayer type, or use the Company, Partnership or Individual income-tax position. Non-profits and public bodies pay payroll taxes only.');
 if(regime==='TOT'&&(!obligations.includes('TOT')||residency!=='Resident'))fail(400,'The TOT profile requires a resident taxpayer and the TOT obligation.');
 if(regime==='MRI'&&(!obligations.includes('MRI')||residency!=='Resident'))fail(400,'The MRI profile requires a resident taxpayer and the MRI obligation.');
 if(obligations.includes('TOT')&&regime!=='TOT')fail(400,'Select the TOT income regime for a TOT position.');
 if(obligations.includes('MRI')&&regime!=='MRI')fail(400,'Select the MRI income regime for an MRI position.');
 const annual_turnover=p.annual_turnover===''||p.annual_turnover==null?null:amount(p.annual_turnover);
 if(regime==='TOT'&&(annual_turnover===null||annual_turnover<=1000000||annual_turnover>25000000))fail(400,'TOT requires reviewed annual turnover above KES 1 million and at most KES 25 million.');
 if(regime==='MRI'&&(annual_turnover===null||annual_turnover<288000||annual_turnover>15000000))fail(400,'MRI requires reviewed qualifying annual residential rent from KES 288,000 to KES 15 million.');
 if(finalIncomeRegimes.includes(regime)&&ordinaryIncomePositions.some(x=>obligations.includes(x)))fail(400,`${regime} is final on the covered income. Remove ordinary income tax, instalment tax or advance tax from this profile; refer any income outside the regime to the Tax Lead because it needs a separately reviewed treatment.`);
 const obligation_statuses=normalizeObligationStatuses(obligations,p.obligation_statuses,p.effective_from,p.effective_to);
 const vat_taxable_supplies_status=choice(p.vat_taxable_supplies_status||'UNKNOWN',['CONFIRMED','UNKNOWN']);
 const vat_taxable_supplies_12m=p.vat_taxable_supplies_12m===''||p.vat_taxable_supplies_12m==null?null:amount(p.vat_taxable_supplies_12m);
 const vat_threshold_checked_on=date(p.vat_threshold_checked_on);
 const vat_threshold_evidence_reference=text(p.vat_threshold_evidence_reference||'',300,false);
 if(vat_taxable_supplies_status==='CONFIRMED'&&(vat_taxable_supplies_12m===null||!vat_threshold_checked_on||!vat_threshold_evidence_reference))fail(400,'Enter the rolling 12-month taxable-supplies amount, check date and evidence reference.');
 if(vat_taxable_supplies_status==='UNKNOWN'&&(vat_taxable_supplies_12m!==null||vat_threshold_checked_on||vat_threshold_evidence_reference))fail(400,'Clear the amount, check date and evidence reference or mark the rolling 12-month taxable-supplies figure Confirmed.');
 return {entity_type,residency,regime,obligations,obligation_statuses,annual_turnover,vat_taxable_supplies_status,vat_taxable_supplies_12m,vat_threshold_checked_on,vat_threshold_evidence_reference,notes:text(p.notes,4000)};
}
export function profileIssues(profile,c){
 const issues=[];if(!profile||profile.status!=='Verified')return ['A Manager or Partner must verify a client tax profile covering this period.'];
 if(!profile.obligations.includes(c.kind))issues.push(`${c.kind} is not confirmed in the client tax profile.`);
 const position=profile.obligation_statuses?.[c.kind];
 if(!profile.obligations_reviewed_at)issues.push('Separate registration and applicability checks have not been reviewed.');
 if(!position)issues.push(`${c.kind}: registration, legal applicability and client status are missing.`);
 else {if(position.registered!=='YES')issues.push(`${c.kind}: iTax registration is ${position.registered||'unknown'}; confirm registration before calculation.`);if(position.applicable!=='YES')issues.push(`${c.kind}: legal applicability is ${position.applicable||'not confirmed'}; resolve it before calculation.`);if(position.client_status==='UNKNOWN')issues.push(`${c.kind}: confirm the client status.`);if(position.registered==='YES'&&!position.evidence_reference)issues.push(`${c.kind}: link evidence for the registration status.`);if(['DEREGISTERED','NOT_REGISTERED'].includes(position.client_status))issues.push(`${c.kind}: the client status is ${position.client_status}; resolve the filing position before calculation.`);}
 if(c.kind==='TOT'){
  if(profile.regime!=='TOT')issues.push('Use the verified TOT income regime for a TOT return.');
  if(profile.vat_taxable_supplies_status!=='CONFIRMED'||profile.vat_taxable_supplies_12m==null||!profile.vat_threshold_checked_on||!profile.vat_threshold_evidence_reference)issues.push('The rolling 12-month VAT threshold has not been checked, dated and supported with evidence.');
  else if(Number(profile.vat_taxable_supplies_12m)>=5000000){const vat=profile.obligation_statuses?.VAT;if(!(profile.obligations||[]).includes('VAT')||vat?.registered!=='YES'||vat?.applicable!=='YES'||!vat?.evidence_reference)issues.push('KRA threshold check: taxable supplies of KES 5 million or more require a separate VAT registration position and evidence; VAT and TOT can coexist.');}
 }
 if(c.kind==='VAT'&&profile.regime==='TOT'&&(profile.vat_taxable_supplies_status!=='CONFIRMED'||profile.vat_taxable_supplies_12m==null||!profile.vat_threshold_checked_on||!profile.vat_threshold_evidence_reference))issues.push('Check, date and support the rolling 12-month taxable-supplies figure; VAT and TOT may coexist.');
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
  const casual=e.employment_type==='Casual',pensionBase=Math.min(pensionable,nssf.upper_limit),employee_nssf=casual?0:round(pensionBase*nssf.employee_rate/100),employer_nssf=casual?0:round(pensionBase*nssf.employer_rate/100),shif=casual?0:round(Math.max(rules.KE_SHIF.parameters.minimum||0,shifBase*rules.KE_SHIF.parameters.rate/100)),employee_ahl=round(housingBase*rules.KE_AHL_EMPLOYEE.parameters.rate/100),employer_ahl=round(housingBase*rules.KE_AHL_EMPLOYER.parameters.rate/100);
  const pension=Math.min(employee_nssf+amount(e.other_pension||0),limits.pension_monthly_cap),mortgage=Math.min(amount(e.mortgage_interest||0),limits.mortgage_monthly_cap),medical=Math.min(amount(e.postretirement_medical||0),limits.medical_monthly_cap),exemption=amount(e.approved_exemption||0);
  if((exemption||e.mortgage_interest>0||e.other_pension>0||e.insurance_premium>0||e.postretirement_medical>0)&&!e.evidence_reference)fail(400,'Add evidence references for reliefs, optional deductions or exemptions.');
  const allowed_deductions=round(pension+mortgage+medical+shif+employee_ahl),taxable=Math.max(0,round(gross+benefits-allowed_deductions-exemption)),gross_tax=graduatedTax(taxable,paye),personal=e.resident===true?amount(paye.personal_relief):0,insurance=e.resident===true?Math.min(round(amount(e.insurance_premium||0)*limits.insurance_rate/100),limits.insurance_monthly_cap):0,tax=Math.max(0,round(gross_tax-personal-insurance));
  return {name:text(e.name,160),gross,taxable_benefits:benefits,employee_nssf,employer_nssf,shif,employee_ahl,employer_ahl,nita:casual?0:amount(rules.KE_NITA.parameters.fixed_amount),employment_type:e.employment_type||'Permanent',allowed_deductions,exemption,taxable,gross_tax,personal_relief:personal,insurance_relief:insurance,paye:tax,source_paye:amount(e.source_paye||0),variance:round(tax-amount(e.source_paye||0)),net_before_other_deductions:round(gross-employee_nssf-amount(e.other_pension||0)-shif-employee_ahl-tax),evidence_reference:String(e.evidence_reference||'')};
 });
 const result={employees,exceptions:employees.filter(e=>Math.abs(e.variance)>.01).length};
 for(const key of ['paye','employee_nssf','employer_nssf','shif','employee_ahl','employer_ahl','nita','variance'])result[key]=round(employees.reduce((s,e)=>s+e[key],0));
 return result;
}
export function simpleTax(kind,p,rules){
 const v=k=>amount(p[k]||0),rate=k=>number(rules[k].parameters.rate,0,100);let result={};
 if(kind==='TOT'||kind==='MRI'){const base=v('gross_receipts'),r=rate(kind==='TOT'?'KE_TOT':'KE_MRI');result={gross_receipts:base,rate:r,gross_tax:round(base*r/100),final_tax:true,expense_deductions_allowed:false,tax_base_note:kind==='TOT'?'Final tax on covered gross sales; keep excluded income separate and do not deduct expenses.':'Final tax on qualifying residential rental income.'};}
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
