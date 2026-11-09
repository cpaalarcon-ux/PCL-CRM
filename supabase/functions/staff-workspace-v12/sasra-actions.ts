import {fail,text,uuid,choice,date,revision} from './validation.mjs';
// S3: Partner gates for SACCO audits. The rules live in the database functions (erp_private.sasra_*, audit_eqcr_*, audit_policy_save);
// this file validates the input and passes it on. Nothing here holds a SASRA figure.
export const POLICY_KEYS=['AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT'];
export const SACCO_TYPES=['DT_SACCO','NWDT_SACCO'];
export const MEASURES=['Percentage','Amount KES'];
export const COMPARATORS=['At least','At most'];
const optUuid=(v:any)=>v?uuid(v):null;
const num=(v:any,label:string,min=0)=>{const s=String(v??'').replace(/,/g,'').trim();if(!/^\d{1,16}(\.\d{1,4})?$/.test(s)||Number(s)<min)fail(400,`${label} must be a positive number.`);return s;};
export async function sasraOverview(tx:any){return (await tx`select erp_private.sasra_overview() r`)[0].r;}
export async function sasraFileOverview(tx:any,fileId:string){return (await tx`select erp_private.sasra_file_overview(${fileId}::uuid) r`)[0].r;}
export async function sasraSignoffIssues(tx:any,fileId:string):Promise<string[]>{return (await tx`select erp_private.sasra_signoff_issues(${fileId}::uuid) r`)[0].r||[];}
export async function sasraAction(tx:any,a:any,p:any):Promise<any>{
 const act=String(p.action||'');
 if(!act.startsWith('audit_sasra_')&&!['audit_policy_save','audit_report_date_save','audit_eqcr_decide'].includes(act))return undefined;
 const partner=()=>{if(a.category_code!=='PARTNER')fail(403,'Only a Partner can do this.');};
 if(act==='audit_policy_save'){
  partner();const key=choice(p.key,POLICY_KEYS);let value=text(String(p.value??''),20);
  if(key==='AUDIT_FILE_LOCK_DAYS'&&(!/^\d{1,3}$/.test(value)||Number(value)<1||Number(value)>365))fail(400,'Enter the number of days, from 1 to 365.');
  if(key==='AUDIT_FILE_LOCK_ANCHOR')choice(value,['REPORT_DATE','YEAR_END']);
  if(key==='SACCO_DT_REQUIRES_EQCR'||key==='SACCO_DT_REQUIRES_STATUTORY_REPORT')choice(value,['true','false']);
  return (await tx`select erp_private.audit_policy_save(${key},${value},${text(p.note||'',1000,false)}) r`)[0].r;
 }
 if(act==='audit_report_date_save'){
  partner();const d=date(p.audit_report_date);if(!d)fail(400,'Enter the audit report date.');
  return (await tx`select erp_private.audit_report_date_save(${uuid(p.audit_file_id)}::uuid,${d}::date,${text(p.note||'',1000,false)}) r`)[0].r;
 }
 if(act==='audit_eqcr_decide'){
  partner();return (await tx`select erp_private.audit_eqcr_decide(${uuid(p.audit_file_id)}::uuid,${p.decision==='Approve'},${text(p.note||'',2000,false)}) r`)[0].r;
 }
 if(act==='audit_sasra_eligibility_record'){
  partner();const year=Number(p.financial_year);if(!Number.isInteger(year)||year<2000||year>2100)fail(400,'Enter the financial year.');
  const approved=p.is_approved===true||p.is_approved==='true';
  if(approved&&p.confirm!==true)fail(400,'Tick the confirmation that the firm is on the SASRA approved auditor list for this year.');
  return (await tx`select erp_private.sasra_eligibility_record(${uuid(p.client_id)}::uuid,${uuid(p.firm_id)}::uuid,${year},${approved},${text(p.listing_reference||'',500,false)},${optUuid(p.proof_document_id)}::uuid,${text(p.appointment_reference||'',500,false)},${text(p.independence_note||'',2000,false)}) r`)[0].r;
 }
 if(act==='audit_sasra_line_define'){partner();return (await tx`select erp_private.sasra_line_define(${text(p.line_code,60)},${text(p.definition||'',2000,false)}) r`)[0].r;}
 if(act==='audit_sasra_ratio_save'){
  if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner prepares the ratio table.');
  const measure=choice(p.measure,MEASURES);
  const body={ratio_id:optUuid(p.ratio_id),ratio_code:p.ratio_id?undefined:text(p.ratio_code,60),label:text(p.label,200),sacco_type:choice(p.sacco_type,SACCO_TYPES),client_id:optUuid(p.client_id),measure,comparator:choice(p.comparator,COMPARATORS),
   threshold:num(p.threshold,'The minimum or maximum'),numerator_line:text(p.numerator_line,60),denominator_line:measure==='Percentage'?text(p.denominator_line||'',60):null,effective_from:date(p.effective_from||'')||fail(400,'Enter the date it takes effect.'),
   effective_to:date(p.effective_to||''),reference_id:optUuid(p.reference_id),proof_document_id:optUuid(p.proof_document_id),revision:p.ratio_id?revision(p.revision):undefined};
  return (await tx`select erp_private.sasra_ratio_save(${tx.json(body)}::jsonb) r`)[0].r;
 }
 if(act==='audit_sasra_ratio_activate'){partner();return (await tx`select erp_private.sasra_ratio_activate(${uuid(p.ratio_id)}::uuid,${text(p.note||'',1000,false)},${revision(p.revision)}::bigint) r`)[0].r;}
 if(act==='audit_sasra_ratio_retire'){partner();return (await tx`select erp_private.sasra_ratio_retire(${uuid(p.ratio_id)}::uuid,${date(p.effective_to||'')}::date,${text(p.note||'',1000,false)}) r`)[0].r;}
 if(act==='audit_sasra_figure_save'){
  return (await tx`select erp_private.sasra_figure_save(${uuid(p.audit_file_id)}::uuid,${text(p.line_code,60)},${num(p.amount,'The amount')}::numeric,${text(p.source_note||'',500,false)}) r`)[0].r;
 }
 if(act==='audit_sasra_breach_ack'){partner();return (await tx`select erp_private.sasra_breach_ack(${uuid(p.audit_file_id)}::uuid,${uuid(p.ratio_id)}::uuid,${text(p.note||'',2000,false)}) r`)[0].r;}
 fail(400,'Unknown SASRA action.');
}
