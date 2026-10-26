// Pending credits remain immutable source exceptions until a corrected upload
// supplies the original reference/date. They never become posting sources here.
export async function pendingPurchases(tx:any,projectId:string,start:string|null=null,end:string|null=null,batchId:string|null=null){
 const rows=await tx`with outstanding as (
  select distinct on (r.raw_values->'_pending_purchase'->>'key',r.raw_values->'_pending_purchase'->'match')
   r.rejection_id,r.source_row,r.reason,b.document_id,b.sheet_name,b.period_start,b.period_end,d.file_name,
   r.raw_values->'_pending_purchase'->'row' as normalized
  from erp_private.workbook_rejections r join erp_private.workbook_batches b using(batch_id)
  join erp_private.documents d using(document_id)
  where b.project_id=${projectId} and r.raw_values ? '_pending_purchase'
   and (${batchId}::text is null or b.batch_id=${batchId}::uuid)
   and (${start}::text is null or b.period_end>=${start}::date) and (${end}::text is null or b.period_start<=${end}::date)
   and not exists(select 1 from erp_private.workbook_rows w where w.project_id=b.project_id and w.dataset='Purchases' and w.parent_row_id is null
    and w.row_key=r.raw_values->'_pending_purchase'->>'key'
    and w.normalized @> (r.raw_values->'_pending_purchase'->'match')
    and coalesce(w.normalized->>'original_invoice','')<>'' and coalesce(w.normalized->>'original_invoice_date','')<>'')
  order by r.raw_values->'_pending_purchase'->>'key',r.raw_values->'_pending_purchase'->'match',b.created_at desc
 ) select *,count(*) over()::int total,
  sum((normalized->>'amount')::numeric) over() net,sum((normalized->>'vat')::numeric) over() vat,sum((normalized->>'gross')::numeric) over() gross
 from outstanding order by period_start,source_row,rejection_id limit 200`;
 return {total:rows[0]?.total||0,net:Number(rows[0]?.net||0),vat:Number(rows[0]?.vat||0),gross:Number(rows[0]?.gross||0),rows};
}
