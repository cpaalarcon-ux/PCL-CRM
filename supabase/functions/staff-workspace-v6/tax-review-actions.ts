import {fail,text,uuid,choice,revision,date} from './validation.mjs';
import {range,day,number,amount,round,filingKinds,vatCalculation,incomeCalculation,payrollCalculation} from './suite-rules.mjs';
import {one,leader,today} from './suite-actions.ts';
const dateText=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const editor=(a:any)=>{if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner must review this work.');};
const fresh=(r:any,p:any)=>{if(String(r.revision)!==revision(p.revision))fail(409,'This record changed. Refresh before saving.');};
export async function taxSummary(tx:any,c:any){
 const batches=await tx`select * from erp_private.workbook_batches where project_id=${c.project_id} and period_start<=${c.ends_on} and period_end>=${c.starts_on}`;
 const rows=await tx`select r.*,v.decision,v.deductible_percentage,v.source_revision,v.reviewed_by,b.period_start,b.period_end,b.uploaded_by
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) left join erp_private.tax_row_reviews v on v.row_id=r.row_id
  where r.project_id=${c.project_id} and b.period_start>=${c.starts_on} and b.period_end<=${c.ends_on} order by r.source_row limit 10001`;
 if(rows.length>10000)fail(400,'Split the tax review into smaller periods (maximum 10,000 rows per case).');
 const issues:string[]=[];if(batches.some((b:any)=>dateText(b.period_start)<dateText(c.starts_on)||dateText(b.period_end)>dateText(c.ends_on)))issues.push('An imported batch crosses this case period. Use matching period boundaries.');
 const rejected=batches.reduce((s:number,b:any)=>s+b.rejected_count,0);
 if(rejected&&!c.inputs.rejection_resolution)issues.push(`${rejected} rejected source rows need a documented reconciliation.`);
 const findings=await tx`select * from erp_private.tax_findings where project_id=${c.project_id} and deleted_at is null and (case_id=${c.case_id} or case_id is null)`;
 if(findings.some((f:any)=>f.status==='Open'))issues.push('Open findings must be resolved.');
 let output=0,input=0,unreviewed=0,unmapped=0;
 for(const r of rows){
  const approved=r.source_revision===r.revision&&['Eligible','Excluded','Confirmed'].includes(r.decision);
  if(!approved)unreviewed++;
  if(['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)&&(!r.route||!r.category_code))unmapped++;
  if(r.dataset==='Sales'&&approved&&r.decision==='Confirmed')output+=Number(r.normalized.vat||0);
  if(['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset)&&approved&&r.decision==='Eligible')input+=round(Number(r.normalized.vat||0)*Number(r.deductible_percentage)/100);
 }
 let result:any={},rate=null;
 if(c.rate_id){rate=one(await tx`select * from erp_private.tax_rates where rate_id=${c.rate_id}`);if(rate.status!=='Approved'||dateText(rate.effective_from)>dateText(c.starts_on)||dateText(rate.effective_to)<dateText(c.ends_on))issues.push('The approved rate does not cover the complete tax period.');}
 if(c.kind==='VAT'){
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
  if(!rate||rate.tax_type!=='PAYE')issues.push('Select an approved PAYE band schedule.');else if(!c.inputs.employees?.length)issues.push('Add the payroll rows before submitting.');else {result=payrollCalculation(c.inputs,rate.parameters);if(result.exceptions)issues.push(`${result.exceptions} employee PAYE differences need correction.`);}
 }else{
  const expected=c.kind==='Company'?'Corporation tax':'Individual income tax';
  if(c.kind!=='Partnership'&&(!rate||rate.tax_type!==expected))issues.push(`Select an approved ${expected} schedule.`);
  else if(c.inputs.accounting_profit===undefined||c.inputs.accounting_profit==='')issues.push('Enter the accounting profit and tax adjustments.');
  else if(c.kind==='Partnership'&&!c.inputs.partners?.length)issues.push('Add the partners and profit-sharing percentages.');
  else result=incomeCalculation(c.kind,c.inputs,rate?.parameters);
 }
 if(c.kind!=='VAT'&&!c.source_document_id)issues.push('Link the supporting working-paper document.');
 if(!c.inputs.return_tied)issues.push('Confirm that the draft return agrees to the reviewed computation.');
 return {result,issues,rows,batches,findings,rate,source_count:batches.reduce((s:number,b:any)=>s+b.source_count,0),rejected_count:rejected,unreviewed,unmapped};
}
export async function taxAction(tx:any,a:any,p:any):Promise<any>{
 if(!String(p.action).startsWith('tax_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Tax compilation requires a staff preparer.');
 if(p.action==='tax_create'){
  const pid=uuid(p.project_id);one(await tx`select project_id from erp_private.projects where project_id=${pid}`);const [start,end]=range(p.starts_on,p.ends_on),kind=choice(p.kind,filingKinds);
  await tx`select pg_advisory_xact_lock(hashtextextended(${pid+':tax'},0))`;
  if((await tx`select case_id from erp_private.tax_cases where project_id=${pid} and kind=${kind} and starts_on<=${end} and ends_on>=${start}`).length)fail(400,'A tax case already overlaps this period. Open the existing case.');
  return one(await tx`insert into erp_private.tax_cases(project_id,kind,starts_on,ends_on,prepared_by) values(${pid},${kind},${start},${end},${a.staff_id}) returning case_id`);
 }
 if(p.action==='tax_row_review'){
  editor(a);const target=one(await tx`select project_id from erp_private.workbook_rows where row_id=${uuid(p.row_id)}`);await tx`select pg_advisory_xact_lock(hashtextextended(${target.project_id+':tax'},0))`;
  const r=one(await tx`select r.*,b.uploaded_by,b.period_start,b.period_end from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where row_id=${uuid(p.row_id)} for update of r`);fresh(r,p);
  if(r.uploaded_by===a.staff_id)fail(403,'Another reviewer must review rows you imported.');
  if(!one(await tx`select erp_private.tax_period_open(${r.project_id}::uuid,${r.period_start}::date,${r.period_end}::date) as open`).open)fail(400,'Return the submitted case before changing a row decision. Locked cases cannot change.');
  const cost=['Purchases','Expenditure','Non-eTIMS'].includes(r.dataset),decision=choice(p.decision,cost?['Eligible','Excluded','Unresolved']:['Confirmed','Unresolved']),percent=decision==='Eligible'?number(p.deductible_percentage,0,100):0;
  if(decision==='Eligible'&&(!r.route||!r.category_code))fail(400,'Map the purchase before deciding eligibility.');
  if(decision==='Eligible'&&r.dataset==='Non-eTIMS'&&(!r.review_details?.legal_basis||!r.review_details?.evidence))fail(400,'Complete the non-eTIMS legal basis and evidence before an eligibility decision.');
  await tx`insert into erp_private.tax_row_reviews(row_id,project_id,source_revision,decision,deductible_percentage,reason,reviewed_by) values(${r.row_id},${r.project_id},${r.revision},${decision},${percent},${text(p.reason,2000)},${a.staff_id}) on conflict(row_id) do update set source_revision=excluded.source_revision,decision=excluded.decision,deductible_percentage=excluded.deductible_percentage,reason=excluded.reason,reviewed_by=excluded.reviewed_by`;return {ok:true};
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
 if(p.action==='tax_read'){const summary=await taxSummary(tx,c);return {case:c,...summary,rows:summary.rows.map((r:any)=>({row_id:r.row_id,revision:r.revision,dataset:r.dataset,source_row:r.source_row,normalized:r.normalized,route:r.route,category_code:r.category_code,decision:r.decision,deductible_percentage:r.deductible_percentage,reviewed_by:r.reviewed_by,source_revision:r.source_revision}))};}
 fresh(c,p);
 if(p.action==='tax_save'){
  if(!['Draft','Returned'].includes(c.status))fail(400,'Only a draft or returned case can be changed.');if(c.prepared_by!==a.staff_id)fail(403,'The assigned preparer must update the computation.');
  let inputs=p.inputs;if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||JSON.stringify(inputs).length>20000)fail(400,'Invalid computation inputs.');
  // Strip arbitrary metadata; computed results and approvals never come from browser input.
  const allowed=c.kind==='VAT'?['opening_credit','opening_credit_basis','withholding_credit','reverse_charge','adjustments','adjustment_basis','bank_reconciliation','rejection_resolution','return_tied']:c.kind==='PAYE'?['employees','return_tied']:['accounting_profit','addbacks','deductions','losses','partners','reliefs','credits','return_tied'];
  inputs=Object.fromEntries(Object.entries(inputs).filter(([k])=>allowed.includes(k)));inputs.return_tied=inputs.return_tied===true;
  const source=p.source_document_id?uuid(p.source_document_id):null;if(source)one(await tx`select document_id from erp_private.documents where document_id=${source} and project_id=${c.project_id}`);
  const rid=p.rate_id?uuid(p.rate_id):null;if(rid)one(await tx`select rate_id from erp_private.tax_rates where rate_id=${rid}`);
  const next={...c,inputs,source_document_id:source,rate_id:rid};const s=await taxSummary(tx,next);
  await tx`update erp_private.tax_cases set inputs=${tx.json(inputs)},source_document_id=${source},rate_id=${rid},result=${tx.json(s.result)},status='Draft',review_note=null where case_id=${c.case_id}`;return {ok:true,issues:s.issues};
 }
 if(p.action==='tax_submit'){
  if(c.prepared_by!==a.staff_id||!['Draft','Returned'].includes(c.status))fail(403,'The preparer must submit a draft or returned case.');const s=await taxSummary(tx,c);if(s.issues.length)fail(400,s.issues.join(' '));
  await tx`update erp_private.tax_cases set status='Submitted',result=${tx.json(s.result)} where case_id=${c.case_id}`;return {ok:true};
 }
 if(p.action==='tax_review'){
  editor(a);if(c.prepared_by===a.staff_id)fail(403,'Another reviewer must approve your computation.');if(c.status!=='Submitted')fail(400,'Choose a submitted case.');const status=choice(p.status,['Locked','Returned']),note=text(p.review_note,2000);
  const s=await taxSummary(tx,c);if(status==='Locked'&&s.issues.length)fail(400,s.issues.join(' '));
  const snapshot={result:s.result,rate:s.rate,rows:s.rows.map((r:any)=>({row_id:r.row_id,revision:r.revision,batch_id:r.batch_id,dataset:r.dataset,normalized:r.normalized,decision:r.decision,deductible_percentage:r.deductible_percentage,reviewed_by:r.reviewed_by})),batches:s.batches,findings:s.findings,inputs:c.inputs,reviewed_by:a.staff_id,reviewed_at:new Date().toISOString()};
  await tx`update erp_private.tax_cases set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note},result=${tx.json(s.result)},review_snapshot=${status==='Locked'?tx.json(snapshot):null} where case_id=${c.case_id}`;return {ok:true};
 }
 if(p.action==='tax_file'){
  editor(a);if(c.status!=='Locked')fail(400,'Review and lock the case before recording filing.');const filed=day(p.filing_date);if(filed>today()||filed<dateText(c.ends_on))fail(400,'Filing date must follow the period and cannot be in the future.');
  await tx`update erp_private.tax_cases set status='Filed',filing_date=${filed} where case_id=${c.case_id}`;return {ok:true};
 }
 fail(404,'Unknown tax action.');
}
