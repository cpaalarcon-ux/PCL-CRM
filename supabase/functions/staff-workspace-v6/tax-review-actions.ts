import {stagingRates,preferredRates} from './testing-rates.mjs';
import {taxKinds,pickRate,profileIssues,keys,testRate,payrollFromRules,simpleTax,vatRuleCheck} from './tax-registry.mjs';
import {fail,text,uuid,choice,revision,date} from './validation.mjs';
import {range,day,number,amount,round,filingKinds,vatCalculation,incomeCalculation,payrollCalculation} from './suite-rules.mjs';
import {one,leader,today} from './suite-actions.ts';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const editor=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner must review this work.');};
const fresh=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
export async function taxSummary(tx:any,c:any){
 if(['Locked','Filed'].includes(c.status)&&c.review_snapshot){const x=c.review_snapshot;return {result:x.result,issues:[],rows:x.rows||[],batches:x.batches||[],findings:x.findings||[],rate:x.rate,applied_rates:x.applied_rates||[x.rate].filter(Boolean),profile:x.profile,reconciliation:x.reconciliation||null,source_count:(x.batches||[]).reduce((n:number,b:any)=>n+b.source_count,0),rejected_count:0,unreviewed:0,unmapped:0};}
 const project=one(await tx`select client_id from erp_private.projects where project_id=${c.project_id}`);
 const profiles=await tx`select * from erp_private.client_tax_profiles where client_id=${project.client_id} and status='Verified' and deleted_at is null and effective_from<=${c.starts_on} and effective_to>=${c.ends_on}`;
 const profile=profiles.length===1?profiles[0]:null;
 const available=stagingRates(await tx`select * from erp_private.tax_rates where status in('Approved','Testing') and deleted_at is null`,Deno.env.get('SUPABASE_URL')||'');
 const applied:any[]=[];const rules:any={};const ruleIssues:string[]=[];
 const use=(key:string,start=dateText(c.starts_on),end=dateText(c.ends_on))=>{try{const r=pickRate(preferredRates(available,key,start,end),key,start,end);if(!applied.some(x=>x.rate_id===r.rate_id))applied.push(r);return r;}catch(e){ruleIssues.push((e as Error).message);return null;}};
 const needed=[...((keys as any)[c.kind]||[])];if(c.kind==='WHT'){if(c.inputs.payment_code)needed.push(c.inputs.payment_code);else ruleIssues.push('Select a WHT payment category.');}
 for(const key of needed){const r=use(key);if(r){if(c.kind==='WHT'&&r.tax_type!=='Withholding tax')ruleIssues.push('Select a withholding-tax payment rule.');else rules[key]=r;}}

 const batches=await tx`select * from erp_private.workbook_batches where project_id=${c.project_id} and period_start<=${c.ends_on} and period_end>=${c.starts_on}`;
 const rows=await tx`select r.*,v.decision,v.deductible_percentage,v.source_revision,v.reviewed_by,v.vat_rate_key,v.vat_difference_reason,v.income_treatment,b.period_start,b.period_end,b.uploaded_by
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v on v.row_id=r.row_id
  where r.project_id=${c.project_id} and not r.is_split_parent and r.dataset<>'POS' and b.period_start>=${c.starts_on} and b.period_end<=${c.ends_on} order by r.source_row limit 10001`;
 if(rows.length>10000)fail(400,'Split the tax review into smaller periods (maximum 10,000 rows per case).');
 const issues:string[]=profileIssues(profile,{...c,starts_on:dateText(c.starts_on),ends_on:dateText(c.ends_on)});if(batches.some((b:any)=>dateText(b.period_start)<dateText(c.starts_on)||dateText(b.period_end)>dateText(c.ends_on)))issues.push('An imported batch crosses this case period. Use matching period boundaries.');
 const rejected=batches.reduce((s:number,b:any)=>s+b.rejected_count,0);
 if(rejected&&!c.inputs.rejection_resolution)issues.push(`${rejected} rejected source rows need a documented reconciliation.`);
 const findings=await tx`select * from erp_private.tax_findings where project_id=${c.project_id} and deleted_at is null and (case_id=${c.case_id} or case_id is null)`;
 if(findings.some((f:any)=>f.status==='Open'))issues.push('Open findings must be resolved.');
 let output=0,input=0,unreviewed=0,unmapped=0;
 for(const r of rows){
  const approved=r.source_revision===r.revision&&['Eligible','Excluded','Confirmed'].includes(r.decision);
  if(!approved)unreviewed++;
  if(c.kind==='VAT'&&r.dataset!=='Bank'){
   if(!r.vat_rate_key)issues.push(`Row ${r.source_row}: reviewer must select the VAT treatment.`);
   else {const rr=use(r.vat_rate_key,dateText(r.normalized.date)||dateText(c.starts_on),dateText(r.normalized.date)||dateText(c.starts_on));if(rr){if(rr.tax_type!=='VAT'||rr.parameters.treatment==='Withholding')issues.push(`Row ${r.source_row}: select a supply VAT rule.`);else {const issue=vatRuleCheck(r,rr);if(issue)issues.push(`Row ${r.source_row}: ${issue}`);r.applied_rate=rr;}}}
   if(['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)&&(!r.income_treatment||r.income_treatment==='Review'))issues.push(`Row ${r.source_row}: income-tax classification requires review.`);
  }
  if(['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)&&(!r.route||!r.category_code||!r.account_code))unmapped++;
  if(r.dataset==='Sales'&&approved&&r.decision==='Confirmed')output+=Number(r.normalized.vat||0);
  if(['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)&&approved&&r.decision==='Eligible')input+=round(Number(r.normalized.vat||0)*Number(r.deductible_percentage)/100);
 }
 let result:any={},salesReview:any=null,rate=rules[needed[0]]||null;
 if(c.rate_id){const selected=available.find((r:any)=>r.rate_id===c.rate_id);if(!selected||testRate(selected))issues.push('The previously selected rate is unavailable or test-only. Preview and save the current applicable rules.');else if(rate&&selected.rate_id!==rate.rate_id)issues.push('The selected rate does not match the current client/period rules. Preview and save again.');}
 if(c.kind==='VAT'){
  const reconciliation=await tx`select reconciliation_id,reviewed_by,review_note,inputs,result,source_fingerprint from erp_private.sales_reconciliations where project_id=${c.project_id} and review_type='Monthly' and starts_on=${c.starts_on} and ends_on=${c.ends_on} and status='Locked'`;salesReview=reconciliation[0]||null;if(!reconciliation.length)issues.push('Complete independent monthly sales and bank reconciliation before tax submission.');
  if(!batches.some((b:any)=>b.dataset==='Sales'))issues.push('Upload the sales source for this period.');
  if(!batches.some((b:any)=>['Purchases','Expenditure','Non-eTIMS'].includes(b.dataset)))issues.push('Upload the purchases/expenditure source for this period.');
  if(!batches.some((b:any)=>b.dataset==='Bank'))issues.push('Upload the bank control source for this period.');
  if(unreviewed)issues.push(`${unreviewed} source rows require reviewer decisions.`);if(unmapped)issues.push(`${unmapped} purchase/expenditure rows need mapping.`);
  if(!c.inputs.bank_reconciliation)issues.push('Record the bank reconciliation explanation and resolved differences.');
  const previous=(await tx`select result,ends_on,status from erp_private.tax_cases where project_id=${c.project_id} and kind='VAT' and ends_on<${c.starts_on} and status in ('Locked','Filed') order by ends_on desc limit 1`)[0];
  const opening=previous?amount(previous.result.carry_forward):amount(c.inputs.opening_credit||0);
  if(previous){const next=new Date(Date.parse(dateText(previous.ends_on))+86400000).toISOString().slice(0,10);if(next!==dateText(c.starts_on))issues.push('The preceding VAT period is not contiguous. Complete the intervening period first.');}
  else if(opening&&!c.inputs.opening_credit_basis)issues.push('Provide evidence for the opening VAT credit.');
  result=vatCalculation({output:round(output),eligible_input:round(input),opening_credit:opening,withholding_credit:c.inputs.withholding_credit||0,reverse_charge:c.inputs.reverse_charge||0,adjustments:c.inputs.adjustments||0});
  if((result.withholding_credit||result.reverse_charge||result.adjustments)&&!c.inputs.adjustment_basis)issues.push('Explain withholding certificates, reverse charge and adjustments with evidence references.');
 }else if(c.kind==='PAYE'){
  if(!c.inputs.employees?.length)issues.push('Add the payroll rows before submitting.');
  else if(needed.every(k=>rules[k])){try{result=payrollFromRules(c.inputs,rules);if(result.exceptions)issues.push(`${result.exceptions} employee PAYE differences need correction.`);}catch(e){issues.push((e as Error).message);}}
 }else if(['Company','Individual','Partnership'].includes(c.kind)){
  if(c.inputs.accounting_profit===undefined||c.inputs.accounting_profit==='')issues.push('Enter accounting profit and supported tax adjustments.');
  else if(c.kind==='Partnership'&&!c.inputs.partners?.length)issues.push('Add partner profit-sharing percentages.');
  else if(c.kind==='Partnership'||rate){const reliefs=c.kind==='Individual'?Number(rate.parameters.personal_relief||0)+Number(c.inputs.other_reliefs||0):0;result=incomeCalculation(c.kind,{...c.inputs,reliefs},rate?.parameters);if(c.kind==='Individual')result.personal_relief=Number(rate.parameters.personal_relief||0);}
 }else if(needed.length&&needed.every(k=>rules[k])){try{result=simpleTax(c.kind,c.inputs,rules);}catch(e){issues.push((e as Error).message);}}
 if(['TOT','MRI','CGT'].includes(c.kind)&&(!c.inputs.eligibility_confirmed||!c.inputs.evidence_reference))issues.push('Confirm tax-regime eligibility / exemptions and provide the evidence reference.');
 issues.push(...ruleIssues);
 if(['TOT','MRI'].includes(c.kind)&&profile?.regime!==c.kind)issues.push('The client income regime does not match this computation.');
 if(c.kind!=='VAT'&&!c.source_document_id)issues.push('Link the supporting working-paper document.');
 if(!c.inputs.return_tied)issues.push('Confirm that the draft return agrees to the reviewed computation.');
 if(applied.some(r=>r.approval_scope==='Testing'))result.testing_only=true;
 return {result,issues:[...new Set(issues)],rows,batches,findings,rate,applied_rates:applied,profile,reconciliation:salesReview,source_count:batches.reduce((s:number,b:any)=>s+b.source_count,0),rejected_count:rejected,unreviewed,unmapped};
}
export async function taxAction(tx:any,a:any,p:any):Promise<any>{
 if(!String(p.action).startsWith('tax_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Tax compilation requires a staff preparer.');
 if(p.action==='tax_create'){
  const pid=uuid(p.project_id);one(await tx`select project_id from erp_private.projects where project_id=${pid}`);const [start,end]=range(p.starts_on,p.ends_on),kind=choice(p.kind,taxKinds);
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  if((await tx`select case_id from erp_private.tax_cases where project_id=${pid} and kind=${kind} and starts_on<=${end} and ends_on>=${start}`).length)fail(400,'A tax case already overlaps this period. Open the existing case.');
  return one(await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,prepared_by) values(${pid},${kind},${start},${end},${a.staff_id}) returning case_id`);
 }
 if(p.action==='tax_row_review'){
  editor(a);const target=one(await tx`select project_id from erp_private.workbook_rows where row_id=${uuid(p.row_id)}`);await tx`select pg_advisory_xact_lock(hashtextextended(${target.project_id+':tax'},0))`;
  const r=one(await tx`select r.*,b.uploaded_by,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where row_id=${uuid(p.row_id)} for update of r`);fresh(r,p);if(r.is_split_parent||r.dataset==='POS')fail(400,'Review the active posting allocations, not the source control.');
  if(r.uploaded_by===a.staff_id)fail(403,'Another reviewer must review rows you imported.');
  if(!one(await tx`select erp_private.tax_period_open(${r.project_id}::uuid,${r.period_start}::date,${r.period_end}::date) as open`).open)fail(400,'Return the submitted case before changing a row decision. Locked cases cannot change.');
  const cost=['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset),decision=choice(p.decision,cost?['Eligible','Excluded','Unresolved']:['Confirmed','Unresolved']),percent=decision==='Eligible'?number(p.deductible_percentage,0,100):0;
  if(decision==='Eligible'&&(!r.route||!r.category_code))fail(400,'Map the purchase before deciding eligibility.');
  if(decision==='Eligible'&&r.dataset==='Non-eTIMS'&&(!r.review_details?.legal_basis||!r.review_details?.evidence))fail(400,'Complete the non-eTIMS legal basis and evidence before an eligibility decision.');
  const vatKey=r.dataset==='Bank'?null:text(p.vat_rate_key||'',60,false),difference=text(p.vat_difference_reason||'',2000,false),income=cost?choice(p.income_treatment||'Review',['Allowable','Disallowable','Capital','Inventory','Review']):null;
  await tx`insert into erp_private.tax_row_reviews(row_id,project_id,source_revision,decision,deductible_percentage,reason,reviewed_by,vat_rate_key,vat_difference_reason,income_treatment) values(${r.row_id},${r.project_id},${r.revision},${decision},${percent},${text(p.reason,2000)},${a.staff_id},${vatKey},${difference},${income}) on conflict(row_id) do update set source_revision=excluded.source_revision,decision=excluded.decision,deductible_percentage=excluded.deductible_percentage,reason=excluded.reason,reviewed_by=excluded.reviewed_by,vat_rate_key=excluded.vat_rate_key,vat_difference_reason=excluded.vat_difference_reason,income_treatment=excluded.income_treatment`;return {ok:true};
 }
 if(p.action==='tax_finding_add'){
  const pid=uuid(p.project_id),cid=p.case_id?uuid(p.case_id):null;if(cid)one(await tx`select case_id from erp_private.tax_cases where case_id=${cid} and project_id=${pid}`);
  await tx`insert into erp_private.tax_findings(project_id,case_id,summary,raised_by) values(${pid},${cid},${text(p.summary,2000)},${a.staff_id})`;return {ok:true};
 }
 if(p.action==='tax_finding_resolve'){
  editor(a);const f=one(await tx`select * from erp_private.tax_findings where finding_id=${uuid(p.finding_id)}`);fresh(f,p);
  await tx`update erp_private.tax_findings set status='Resolved',resolution=${text(p.resolution,2000)},resolved_by=${a.staff_id} where finding_id=${f.finding_id}`;return {ok:true};
 }
 const c=one(await tx`select * from erp_private.tax_cases where case_id=${uuid(p.case_id)} for update`);await tx`select pg_advisory_xact_lock(hashtextextended(${c.project_id+':tax'},0))`;
 if(p.action==='tax_read'){const summary=await taxSummary(tx,c);return {case:c,...summary,rows:summary.rows.map((r:any)=>({row_id:r.row_id,revision:r.revision,dataset:r.dataset,source_row:r.source_row,normalized:r.normalized,route:r.route,category_code:r.category_code,account_code:r.account_code,account_name:r.account_name,catalog_version:r.catalog_version,parent_row_id:r.parent_row_id,first_use_date:r.first_use_date,first_use_status:r.first_use_status,decision:r.decision,deductible_percentage:r.deductible_percentage,reviewed_by:r.reviewed_by,source_revision:r.source_revision,vat_rate_key:r.vat_rate_key,vat_difference_reason:r.vat_difference_reason,income_treatment:r.income_treatment,applied_rate:r.applied_rate}))};}
 fresh(c,p);
 if(p.action==='tax_save'||p.action==='tax_preview'){
  if(!['Draft','Returned'].includes(c.status))fail(400,'Only a draft or returned case can be changed.');if(c.prepared_by!==a.staff_id)fail(403,'The assigned preparer must update the computation.');
  let inputs=p.inputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||JSON.stringify(inputs).length>20000)fail(400,'Invalid computation inputs.');
  // Strip arbitrary metadata; computed results and approvals never come from browser input.
  const allowed=c.kind==='VAT'?['opening_credit','opening_credit_basis','withholding_credit','reverse_charge','adjustments','adjustment_basis','bank_reconciliation','rejection_resolution','return_tied']:c.kind==='PAYE'?['employees','return_tied']:['accounting_profit','addbacks','deductions','losses','partners','other_reliefs','credits','return_tied','gross_receipts','proceeds','acquisition_cost','improvement_cost','transfer_cost','payment_code','taxable_payment','eligibility_confirmed','evidence_reference','loan_balance','actual_interest_rate','gross_pay','headcount','employees'];
  inputs=Object.fromEntries(Object.entries(inputs).filter(([k])=>allowed.includes(k)));inputs.return_tied=inputs.return_tied===true;inputs.eligibility_confirmed=inputs.eligibility_confirmed===true;
  const source=p.source_document_id?uuid(p.source_document_id):null;if(source)one(await tx`select document_id from erp_private.documents where document_id=${source} and project_id=${c.project_id}`);
  const rid=null; // Applicable versions are resolved on the server from client, tax and period.
  const next={...c,inputs,source_document_id:source,rate_id:rid};const s=await taxSummary(tx,next);
  if(p.action==='tax_preview')return {result:s.result,issues:s.issues,applied_rates:s.applied_rates,profile:s.profile};
  await tx`update erp_private.tax_cases set inputs=${tx.json(inputs)},source_document_id=${source},rate_id=${s.rate?.rate_id||null},result=${tx.json(s.result)},status='Draft',review_note=null where case_id=${c.case_id}`;return {ok:true,issues:s.issues};
 }
 if(p.action==='tax_submit'){
  if(c.prepared_by!==a.staff_id||!['Draft','Returned'].includes(c.status))fail(403,'The preparer must submit a draft or returned case.');const s=await taxSummary(tx,c);if(s.issues.length)fail(400,s.issues.join(' '));
  await tx`update erp_private.tax_cases set status='Submitted',result=${tx.json(s.result)} where case_id=${c.case_id}`;return {ok:true};
 }
 if(p.action==='tax_review'){
  editor(a);if(c.prepared_by===a.staff_id)fail(403,'Another reviewer must approve your computation.');if(c.status!=='Submitted')fail(400,'Choose a submitted case.');const status=choice(p.status,['Locked','Returned']),note=text(p.review_note,2000);
  const s=await taxSummary(tx,c);if(status==='Locked'&&s.issues.length)fail(400,s.issues.join(' '));
  const snapshot={result:s.result,rate:s.rate,applied_rates:s.applied_rates,profile:s.profile,reconciliation:s.reconciliation,rows:s.rows.map((r:any)=>({row_id:r.row_id,source_row:r.source_row,revision:r.revision,batch_id:r.batch_id,dataset:r.dataset,normalized:r.normalized,raw_values:r.raw_values,account_code:r.account_code,account_name:r.account_name,catalog_version:r.catalog_version,parent_row_id:r.parent_row_id,decision:r.decision,deductible_percentage:r.deductible_percentage,reviewed_by:r.reviewed_by,vat_rate_key:r.vat_rate_key,vat_difference_reason:r.vat_difference_reason,income_treatment:r.income_treatment,applied_rate:r.applied_rate})),batches:s.batches,findings:s.findings,inputs:c.inputs,reviewed_by:a.staff_id,reviewed_at:new Date().toISOString()};
  await tx`update erp_private.tax_cases set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note},result=${tx.json(s.result)},review_snapshot=${status==='Locked'?tx.json(snapshot):null} where case_id=${c.case_id}`;return {ok:true};
 }
 if(p.action==='tax_file')fail(400,'Open the linked task workspace to log written client approval, acknowledgment PDF and PRN before recording filing.');
 fail(404,'Unknown tax action.');
}
