import {fail,uuid,text,choice,date,revision} from './validation.mjs';

// Tax credit register: withholding VAT, withholding income tax, instalment tax and balances carried forward, checked against iTax before a return can claim them.
// The rules (a different person checks iTax, a Manager/Partner approves a difference, one claim at a time, no editing) live in the database
// (20261110273000_tax_credit_register.sql); the checks here give friendly messages and keep the amounts as written. No tax rate or formula is used.
export const CREDIT_TYPES=['WHT_VAT','VAT_CARRIED_FORWARD','WHT_INCOME_TAX','INSTALMENT_TAX','INCOME_TAX_CARRIED_FORWARD'];
const ACTIONS=['tax_credit_list','tax_credit_add','tax_credit_itax','tax_credit_approve','tax_credit_reject','tax_credit_claim','tax_credit_release'];
const one=(r:any[],m='That credit entry is unavailable.')=>{if(!r.length)fail(404,m);return r[0];};
const leader=(a:any,m:string)=>{if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,m);};
const money=(v:any,label:string)=>{const n=Number(v);if(v===''||v===null||v===undefined||!Number.isFinite(n)||n<0||n>1e12)fail(400,`Enter ${label} as an amount of zero or more.`);return Math.round(n*100)/100;};

export async function creditAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(a.category_code==='INTERN')fail(403,'The tax credit register is handled by staff preparers.');
 if(p.action==='tax_credit_list'){
  const pid=uuid(p.project_id);one(await tx`select project_id from erp_private.projects where project_id=${pid} and deleted_at is null`,'That engagement is unavailable.');
  return {credits:await tx`select credit_id,client_id,project_id,credit_type,applies_to,period_start,period_end,source_reference,source_document_id,erp_amount,itax_amount,variance,itax_document_id,itax_checked_by,itax_checked_at,status,claim_amount,decision_reason,decided_by,decided_at,claimed_in_case_id,entered_by,created_at,revision from erp_private.tax_credit_entries where project_id=${pid} order by created_at desc limit 500`};
 }
 if(p.action==='tax_credit_add'){
  const pid=uuid(p.project_id),project=one(await tx`select project_id,client_id from erp_private.projects where project_id=${pid} and deleted_at is null`,'That engagement is unavailable.');
  const type=choice(p.credit_type,CREDIT_TYPES),start=date(p.period_start),end=date(p.period_end),ref=text(p.source_reference,200);
  if(!start||!end||end<start)fail(400,'Enter the period the credit arises in.');
  if(ref.length<3)fail(400,'Enter the certificate, receipt or payment reference (at least 3 characters).');
  let doc=null;if(p.source_document_id){doc=uuid(p.source_document_id);one(await tx`select document_id from erp_private.documents where document_id=${doc} and project_id=${pid} and deleted_at is null`,'Choose a document from this engagement.');}
  const amt=money(p.erp_amount,'the amount recorded in the ERP');
  if((await tx`select 1 from erp_private.tax_credit_entries where client_id=${project.client_id} and credit_type=${type} and lower(btrim(source_reference))=lower(${ref}) and status<>'REJECTED'`).length)fail(409,'This certificate or payment is already in the register.');
  return one(await tx`insert into erp_private.tax_credit_entries(client_id,project_id,credit_type,period_start,period_end,source_reference,source_document_id,erp_amount,entered_by) values(${project.client_id},${pid},${type},${start},${end},${ref},${doc},${amt},${a.staff_id}) returning credit_id`);
 }
 const e=one(await tx`select * from erp_private.tax_credit_entries where credit_id=${uuid(p.credit_id)} for update`);
 if(String(e.revision)!==revision(p.revision))fail(409,'This credit entry changed. Refresh first.');
 if(p.action==='tax_credit_itax'){
  if(a.staff_id===e.entered_by)fail(403,'A different person must check the client\'s iTax ledger.');
  if(!['PENDING','DISPUTED'].includes(e.status))fail(400,'The iTax figure for this credit is already settled.');
  const amt=money(p.itax_amount,'the amount shown on the iTax ledger');
  let doc=null;if(p.itax_document_id){doc=uuid(p.itax_document_id);one(await tx`select document_id from erp_private.documents where document_id=${doc} and project_id=${e.project_id} and deleted_at is null`,'Choose a document from this engagement.');}
  await tx`update erp_private.tax_credit_entries set itax_amount=${amt},itax_document_id=${doc} where credit_id=${e.credit_id}`;
  return {ok:true,status:(await tx`select status from erp_private.tax_credit_entries where credit_id=${e.credit_id}`)[0].status};
 }
 if(p.action==='tax_credit_approve'){
  leader(a,'A Manager or Partner must approve a difference between the ERP and iTax.');
  if(a.staff_id===e.entered_by)fail(403,'A Manager or Partner other than the person who entered the credit must approve the difference.');
  if(e.status!=='DISPUTED')fail(400,'Only a credit with an unresolved difference can be approved.');
  const reason=text(p.reason,2000);if(reason.length<10)fail(400,'Explain why the difference is accepted and which amount may be claimed (at least 10 characters).');
  const claim=money(p.claim_amount,'the amount that may be claimed'),top=Math.max(Number(e.erp_amount),Number(e.itax_amount));
  if(claim>top)fail(400,'The amount to claim cannot exceed the larger of the ERP and iTax figures.');
  await tx`update erp_private.tax_credit_entries set status='MANAGER_APPROVED',claim_amount=${claim},decision_reason=${reason} where credit_id=${e.credit_id}`;return {ok:true};
 }
 if(p.action==='tax_credit_reject'){
  leader(a,'A Manager or Partner must reject a credit entry.');
  if(!['PENDING','DISPUTED'].includes(e.status))fail(400,'Only a pending or disputed credit can be rejected.');
  const reason=text(p.reason,2000);if(reason.length<10)fail(400,'Say why this entry is rejected (at least 10 characters).');
  await tx`update erp_private.tax_credit_entries set status='REJECTED',decision_reason=${reason} where credit_id=${e.credit_id}`;return {ok:true};
 }
 if(p.action==='tax_credit_claim'||p.action==='tax_credit_release'){
  if(p.action==='tax_credit_claim'){
   const c=one(await tx`select case_id,project_id,status,prepared_by from erp_private.tax_cases where case_id=${uuid(p.case_id)} for update`,'That tax case is unavailable.');
   if(c.project_id!==e.project_id)fail(400,'Choose a return of the same engagement.');
   if(!['Draft','Returned'].includes(c.status))fail(400,'Credits can be claimed only while the return is a draft.');
   if(c.prepared_by!==a.staff_id&&!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'The preparer of this return claims its credits.');
   await tx`update erp_private.tax_credit_entries set claimed_in_case_id=${c.case_id} where credit_id=${e.credit_id}`;return {ok:true};
  }
  if(!e.claimed_in_case_id)fail(400,'This credit is not claimed in a return.');
  await tx`update erp_private.tax_credit_entries set claimed_in_case_id=null where credit_id=${e.credit_id}`;return {ok:true};
 }
 return undefined;
}
