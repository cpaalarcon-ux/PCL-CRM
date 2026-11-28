import {fail,fileType,text,uuid,choice} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {day,round} from './suite-rules.mjs';
import {sheetRows} from './owner-batch-actions.ts';
import {nextNumber} from './suite-actions.ts';
import {checkPriorBilling,clientKey,PRIOR_SHEET,PRIOR_COLUMNS,MAX_PRIOR_ROWS} from './prior-billing-rules.mjs';
// Billing brought over from the previous system. See migration 20261215500000_prior_billing.sql for what these records are and are not.
// Stage: a person with the Finance right uploads the load file; every line is checked; one error and nothing is kept.
// Approve: a different Partner. Only then do the documents appear under each client.
const ACTIONS=['prior_billing_batches','prior_billing_decide','prior_billing_client','prior_receipt_add','prior_receipt_reverse'];
const one=(rows:any[])=>rows.length?rows[0]:fail(404,'This record is not available.');
const nairobi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
async function finance(tx:any){if(!(await tx`select erp_private.has_capability('FINANCE') ok`)[0].ok)fail(403,'This needs the Finance right.');}
async function reader(tx:any){if(!(await tx`select erp_private.prior_billing_reader() ok`)[0].ok)fail(403,'You do not have access to previous-system billing.');}
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');

export async function priorBillingStage(tx:any,a:any,f:FormData){
 await finance(tx);
 const file=f.get('file');if(!(file instanceof File))fail(400,'Choose an Excel workbook.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const names=(await readWorkbookSheet(bytes,null)).sheets.map((s:any)=>String(s.name));
 if(!names.includes(PRIOR_SHEET))fail(400,`The workbook needs a sheet named “${PRIOR_SHEET}”.`);
 const sheet=sheetRows((await readWorkbookSheet(bytes,PRIOR_SHEET)).sheet,MAX_PRIOR_ROWS);
 for(const h of PRIOR_COLUMNS)if(!sheet.heads.includes(h))fail(400,`The ${PRIOR_SHEET} sheet needs a column named ${h}.`);
 const sha=hex(await crypto.subtle.digest('SHA-256',bytes));
 const [same]=await tx`select batch_ref,status from erp_private.prior_billing_batches where file_sha256=${sha} and status<>'Discarded'`;
 if(same)fail(400,`This file is already ${same.status==='Loaded'?'loaded':'staged and waiting for approval'} (${same.batch_ref}).`);
 // Clients are matched on the exact name in the ERP, ignoring letter case and extra spaces. A name held by two clients matches neither.
 const clients=new Map<string,string|null>();for(const c of await tx`select client_id,company_name from erp_private.clients where deleted_at is null`){const k=clientKey(c.company_name);clients.set(k,clients.has(k)?null:c.client_id);}
 const firms=new Map<string,string>((await tx`select firm_id,firm_code from erp_private.firms`).map((x:any)=>[String(x.firm_code).toUpperCase(),x.firm_id]));
 const existing=new Set<string>((await tx`select kind,reference from erp_private.prior_billing_documents`).map((d:any)=>`${d.kind}|${String(d.reference).toUpperCase()}`));
 const out=checkPriorBilling(sheet.rows,{clients,firms,today:nairobi(),existing});
 if(out.errors.length)return {status:'VALIDATION_FAILED',message:`${out.errors.length} line${out.errors.length===1?'':'s'} need correcting. Nothing was kept.`,errors:out.errors.slice(0,300),checked:sheet.rows.length};
 const ref='PB-'+nairobi().replaceAll('-','')+'-'+hex(crypto.getRandomValues(new Uint8Array(3)).buffer).toUpperCase();
 await tx`insert into erp_private.prior_billing_batches(batch_ref,file_name,file_sha256,rows,summary,staged_by) values(${ref},${text(file.name,200)},${sha},${tx.json(out.clean.map(({row,client_name,firm_code,...d}:any)=>d))},${tx.json(out.summary)},${a.staff_id})`;
 return {status:'STAGED',batch_ref:ref,message:'The file passed every check and is waiting for a different Partner to approve it. Nothing shows under the clients until then.',summary:out.summary};
}

export async function priorBillingAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(p.action==='prior_billing_batches'){
  await reader(tx);
  return {can_stage:(await tx`select erp_private.has_capability('FINANCE') ok`)[0].ok===true,can_decide:a.category_code==='PARTNER',me:a.staff_id,
   batches:await tx`select b.batch_ref,b.source,b.file_name,b.status,b.summary,b.staged_by,s.full_name staged_by_name,b.staged_at,d.full_name decided_by_name,b.decided_at,b.decision_note from erp_private.prior_billing_batches b left join erp_private.staff_members s on s.staff_id=b.staged_by left join erp_private.staff_members d on d.staff_id=b.decided_by order by b.staged_at desc limit 50`};
 }
 if(p.action==='prior_billing_decide')return (await tx`select erp_private.prior_billing_decide(${text(p.batch_ref,30)},${choice(p.decision,['Approve','Discard'])},${text(p.note||'',1000,false)}) r`)[0].r;
 if(p.action==='prior_billing_client'){
  await reader(tx);const cid=uuid(p.client_id);one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
  const documents=await tx`select d.doc_id,d.source,d.kind,d.reference,d.firm_id,f.firm_code,d.doc_date,d.due_date,d.net_amount,d.vat_amount,d.total_amount,d.amount_due,d.prior_status,d.reverses_reference,d.method,
   (case when d.kind='Invoice' then erp_private.prior_billing_outstanding(d.doc_id) end) outstanding from erp_private.prior_billing_documents d left join erp_private.firms f using(firm_id) where d.client_id=${cid} order by d.doc_date desc,d.reference desc limit 3000`;
  const receipts=await tx`select r.receipt_id,r.doc_id,d.reference invoice_reference,r.receipt_number,r.payment_date,r.method,r.reference,r.amount,r.reverses_id,r.reason,s.full_name created_by_name,r.created_at,
   exists(select 1 from erp_private.prior_billing_receipts x where x.reverses_id=r.receipt_id) reversed from erp_private.prior_billing_receipts r join erp_private.prior_billing_documents d using(doc_id) left join erp_private.staff_members s on s.staff_id=r.created_by where r.client_id=${cid} order by r.created_at desc limit 1000`;
  const t=(k:string,f='total_amount')=>round(documents.filter((d:any)=>d.kind===k).reduce((s:number,d:any)=>s+Number(d[f]||0),0));
  return {documents,receipts,can_receipt:(await tx`select erp_private.has_capability('FINANCE') ok`)[0].ok===true,
   totals:{invoiced:t('Invoice'),credited:t('Credit note'),paid_before:t('Payment'),received_here:round(receipts.reduce((s:number,r:any)=>s+Number(r.amount),0)),outstanding:t('Invoice','outstanding')}};
 }
 // Money received now against an invoice from the previous system. It gets a receipt number from the firm's own sequence.
 await finance(tx);const rid=uuid(p.request_id),[dup]=await tx`select receipt_id,receipt_number from erp_private.prior_billing_receipts where request_id=${rid}`;if(dup)return dup;
 if(p.action==='prior_receipt_add'){
  const d=one(await tx`select doc_id,kind,firm_id,client_id,doc_date from erp_private.prior_billing_documents where doc_id=${uuid(p.doc_id)}`);
  if(d.kind!=='Invoice')fail(400,'Record the receipt against an invoice.');if(!d.firm_id)fail(400,'This invoice has no firm; it cannot be receipted here.');
  const when=day(p.payment_date),value=round(Number(p.amount));if(!(value>0))fail(400,'Enter the amount received.');if(when>nairobi())fail(400,'The payment date cannot be in the future.');
  const left=Number((await tx`select erp_private.prior_billing_outstanding(${d.doc_id}::uuid) o`)[0].o);if(value>left+0.001)fail(400,`Only ${left.toFixed(2)} is still owed on this invoice.`);
  const receipt=await nextNumber(tx,d.firm_id,'REC',when);
  return one(await tx`insert into erp_private.prior_billing_receipts(request_id,doc_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,created_by) values(${rid},${d.doc_id},${d.client_id},${d.firm_id},${receipt},${when},${choice(p.method,['Cash','M-Pesa','Bank','Cheque'])},${text(p.reference,200)},${value},${a.staff_id}) returning receipt_id,receipt_number`);
 }
 const old=one(await tx`select * from erp_private.prior_billing_receipts where receipt_id=${uuid(p.receipt_id)}`),reason=text(p.reason||'',500,false).trim();
 if(old.reverses_id)fail(400,'A reversal cannot itself be reversed.');if(reason.length<10)fail(400,'Give the reason in at least 10 characters.');
 if((await tx`select 1 from erp_private.prior_billing_receipts where reverses_id=${old.receipt_id}`).length)fail(400,'This receipt is already reversed.');
 const receipt=await nextNumber(tx,old.firm_id,'REC',nairobi());
 return one(await tx`insert into erp_private.prior_billing_receipts(request_id,doc_id,client_id,firm_id,receipt_number,payment_date,method,reference,amount,reverses_id,reason,created_by) values(${rid},${old.doc_id},${old.client_id},${old.firm_id},${receipt},${nairobi()},${old.method},${text('Reversal of '+old.receipt_number,200)},${-Number(old.amount)},${old.receipt_id},${reason},${a.staff_id}) returning receipt_id,receipt_number`);
}
