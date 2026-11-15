import {templateInForce} from './template-library-actions.ts';
import {fail,text,uuid,revision} from './validation.mjs';
import {readSourceSheet} from './source-reader.mjs';
import {readBankInputs,computeBankTotals,reviewProblem} from './bank-totals-rules.mjs';

// Monthly bank totals and adjustments (build 2799), read from the firm's five-bank workbook. A review working per client and financial year.
// It feeds no ledger entry, return or statement line. The server reads the uploaded file and works every figure out itself; nothing the browser
// sends is trusted. The rules for the table are in 20261114120000_bank_total_batches.sql.
const ACTIONS=['bank_totals_read','bank_totals_preview','bank_totals_save','bank_totals_confirm','bank_totals_withdraw'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const XLSX='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function parse(tx:any,cid:string,documentId:string,sheetName:string|null,storage:any){
 const doc=one(await tx`select * from erp_private.documents where document_id=${documentId} and deleted_at is null and archived_at is null for share`);
 const project=doc.project_id?one(await tx`select client_id from erp_private.projects where project_id=${doc.project_id} and deleted_at is null`):null;
 if(!project||project.client_id!==cid)fail(400,'Choose a workbook filed for this client.');
 if(doc.mime_type!==XLSX)fail(400,'Choose the five-bank Excel workbook.');
 const downloaded=await storage.download(doc.object_key);if(downloaded.error||!downloaded.data)fail(404,'The workbook is unavailable.');
 const bytes=new Uint8Array(await downloaded.data.arrayBuffer());
 const first=await readSourceSheet(bytes,doc.file_name,sheetName);
 // The sheet is found by its title, so a workbook with the report sheet beside it still works.
 let found:any=null;
 for(const item of [first.sheet.name,...(first.sheets||[]).filter((s:any)=>!s.unsupported&&s.name!==first.sheet.name).map((s:any)=>s.name)]){
  const out=item===first.sheet.name?first:await readSourceSheet(bytes,doc.file_name,item),read=readBankInputs(out.sheet);
  if(read.recognised){found={read,name:out.sheet.name};break;}
 }
 if(!found)fail(400,'The workbook has no BANK INPUTS sheet. Use the five-bank reconciliation workbook as it is.');
 if(found.read.issues.length)fail(400,found.read.issues.join(' '));
 const read=found.read,year=read.year||null;
 if(!year)fail(400,'Enter the financial year (for example 2026) in the BANK INPUTS sheet, next to "Financial year".');
 const result=computeBankTotals(read,{year});
 return {doc,year,sheet:found.name,inputs:{banks:read.banks,months:read.months.filter((m:any)=>m.credits!==null||m.charges!==null||m.loan_interest!==null||m.excise!==null||m.other_finance!==null||m.debit_total!==null),adjustments:read.adjustments},result};
}

export async function bankTotalsAction(tx:any,a:any,p:any,storage:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Bank totals are prepared by staff with client access.');
 const cid=uuid(p.client_id);
 one(await tx`select client_id from erp_private.clients where client_id=${cid}`);
 if(p.action==='bank_totals_read'){
  const banks=await tx`select bank_account_id,bank_name,account_last4,status from erp_private.client_bank_accounts where client_id=${cid} and status='Active' order by bank_name`;
  const batches=await tx`select b.batch_id,b.starts_on,b.ends_on,b.source_document_id,b.result,b.status,b.created_by,pb.full_name as prepared_by_name,b.created_at,b.confirmed_by,cb.full_name as confirmed_by_name,b.confirmed_at,b.confirm_note,b.withdrawn_at,b.withdrawn_reason,b.revision,d.file_name
   from erp_private.bank_total_batches b left join erp_private.staff_members pb on pb.staff_id=b.created_by left join erp_private.staff_members cb on cb.staff_id=b.confirmed_by left join erp_private.documents d on d.document_id=b.source_document_id
   where b.client_id=${cid} order by b.starts_on desc,b.created_at desc limit 50`;
  const documents=await tx`select d.document_id,d.file_name from erp_private.documents d join erp_private.projects pr on pr.project_id=d.project_id where pr.client_id=${cid} and d.deleted_at is null and d.archived_at is null and d.mime_type=${XLSX} order by d.created_at desc limit 100`;
  return {batches,documents,bank_register:banks};
 }
 if(p.action==='bank_totals_preview'||p.action==='bank_totals_save'){
  const got=await parse(tx,cid,uuid(p.document_id),p.sheet_name?text(p.sheet_name,200):null,storage);
  // Link each workbook bank to a registered ERP bank by its last four characters, when exactly one matches. A link is shown, never assumed.
  const reg=await tx`select bank_account_id,bank_name,account_last4 from erp_private.client_bank_accounts where client_id=${cid} and status='Active'`;
  got.result.links=got.inputs.banks.map((b:any)=>{const m=b.last4?reg.filter((r:any)=>String(r.account_last4||'').toUpperCase()===b.last4.toUpperCase()):[];return {code:b.code,name:b.name,last4:b.last4,bank_account_id:m.length===1?m[0].bank_account_id:null,erp_name:m.length===1?m[0].bank_name:null};});
  for(const l of got.result.links)if(!l.bank_account_id)got.result.warnings.push(`${l.code} ${l.name} is not matched to a registered bank account (by last four characters). Register it under Client accounting > Banks.`);
  if(p.action==='bank_totals_preview')return {year:got.year,sheet:got.sheet,file_name:got.doc.file_name,result:got.result,blocked:got.result.issues.length>0};
  if(got.result.issues.length)fail(400,'Correct the listed rows in the workbook before saving: '+got.result.issues.slice(0,5).join(' '));
  const starts=`${got.year}-01-01`,ends=`${got.year}-12-31`;
  const live=await tx`select batch_id,status,revision from erp_private.bank_total_batches where client_id=${cid} and starts_on=${starts} and status<>'Withdrawn' for update`;
  if(live.length){
   const old=live[0];
   if(old.status!=='Draft')fail(409,'This client already has confirmed bank totals for '+got.year+'. Withdraw them first, then upload the corrected workbook.');
   if(String(old.revision)!==revision(p.revision))fail(409,'The saved draft changed. Refresh before saving.');
   const changed=await tx`update erp_private.bank_total_batches set inputs=${tx.json(got.inputs)},result=${tx.json(got.result)},source_document_id=${got.doc.document_id} where batch_id=${old.batch_id} returning batch_id`;
   if(!changed.length)fail(403,'This draft is not editable by your account.');
   return {ok:true,batch_id:old.batch_id,result:got.result};
  }
  const r=await tx`insert into erp_private.bank_total_batches(client_id,starts_on,ends_on,source_document_id,inputs,result,created_by,template_id) values(${cid},${starts},${ends},${got.doc.document_id},${tx.json(got.inputs)},${tx.json(got.result)},${a.staff_id},${await templateInForce(tx,'BANK_ANALYSIS',starts)}) returning batch_id`;
  return {ok:true,batch_id:r[0].batch_id,result:got.result};
 }
 const b=one(await tx`select * from erp_private.bank_total_batches where batch_id=${uuid(p.batch_id)} and client_id=${cid} for update`);
 if(String(b.revision)!==revision(p.revision))fail(409,'This batch changed. Refresh it before continuing.');
 if(p.action==='bank_totals_confirm'){
  const bad=reviewProblem({batch:b,actor:a,note:text(p.confirm_note||'',500,false),agreed:p.agrees===true||p.agrees==='on'});if(bad)fail(400,bad);
  if((b.result?.issues||[]).length)fail(400,'This batch still has listed problems. Upload a corrected workbook first.');
  const r=await tx`update erp_private.bank_total_batches set status='Confirmed',confirmed_by=${a.staff_id},confirmed_at=now(),confirm_note=${text(p.confirm_note,500,false)} where batch_id=${b.batch_id} returning batch_id`;
  if(!r.length)fail(403,'You cannot confirm this batch.');
  return {ok:true};
 }
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner withdraws bank totals.');
 if(b.status==='Withdrawn')fail(409,'This batch is already withdrawn.');
 const reason=text(p.reason||'',500,false);if(reason.trim().length<10)fail(400,'Say why it is withdrawn (at least 10 characters).');
 const r=await tx`update erp_private.bank_total_batches set status='Withdrawn',withdrawn_by=${a.staff_id},withdrawn_at=now(),withdrawn_reason=${reason} where batch_id=${b.batch_id} returning batch_id`;
 if(!r.length)fail(403,'You cannot withdraw this batch.');
 return {ok:true};
}
