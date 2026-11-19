import {bankRemoval,retriedUpload,RETRY_WINDOW_MINUTES} from './upload-safety-rules.mjs';
// Build 2903: database reads for the upload safety rules. Reads only; the callers decide what to do with the answer.

// The same person sending the same file to the same place again within RETRY_WINDOW_MINUTES gets the earlier document back.
export async function findRetriedUpload(tx:any,a:any,args:{client_id:string,project_id:string|null,task_id:string|null,category:string,sha256:string}){
 const rows=await tx`select document_id,client_id,project_id,task_id,category,sha256,uploaded_by,uploaded_at,archived_at,deleted_at,now() as db_now from erp_private.documents
  where client_id=${args.client_id} and sha256=${args.sha256} and uploaded_by=${a.staff_id} and category=${args.category}
   and uploaded_at>now()-(${RETRY_WINDOW_MINUTES}::int*interval '1 minute') and archived_at is null and deleted_at is null order by uploaded_at desc limit 5`;
 return retriedUpload(rows,{staff_id:a.staff_id,sha256:args.sha256,client_id:args.client_id,project_id:args.project_id,task_id:args.task_id,category:args.category,now:rows.length?new Date(rows[0].db_now).getTime():Date.now()});
}

// What a bank statement upload holds, and whether anything from it has been used. Null when the document holds no bank statement.
export async function bankRemovalFacts(tx:any,documentId:string,fileName:string){
 const statements=await tx`select b.batch_id,b.sheet_name,b.period_start,b.period_end,b.project_id,count(r.row_id)::int as rows
  from erp_private.workbook_batches b left join erp_private.workbook_rows r using(batch_id) where b.document_id=${documentId} and b.dataset='Bank' and b.archived_at is null group by b.batch_id`;
 if(!statements.length)return null;
 const ids=statements.map((s:any)=>s.batch_id);
 const used=one(await tx`select count(*) filter(where erp_private.row_locks_upload(r))::int as matched from erp_private.workbook_rows r where r.batch_id=any(${tx.array(ids)}::uuid[])`);
 const alloc=one(await tx`select count(distinct c.bank_row_id)::int n from erp_private.customer_receipt_allocations c join erp_private.workbook_rows r on r.row_id=c.bank_row_id where r.batch_id=any(${tx.array(ids)}::uuid[])`);
 const closed=one(await tx`select count(*)::int n from erp_private.workbook_batches b where b.batch_id=any(${tx.array(ids)}::uuid[]) and not erp_private.tax_period_open(b.project_id,b.period_start,b.period_end)`);
 const journals=one(await tx`select count(*)::int n from erp_private.ledger_journals where source_snapshot->>'document_id'=${documentId}::text`);
 return {file_name:fileName,statements:statements.map((s:any)=>({sheet_name:s.sheet_name,period_start:s.period_start,period_end:s.period_end,rows:s.rows})),matched_rows:used.matched,receipt_allocations:alloc.n,closed_periods:closed.n,journals:journals.n};
}
const one=(rows:any[])=>rows[0];
export {bankRemoval};
