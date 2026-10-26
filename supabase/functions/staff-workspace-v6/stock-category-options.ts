export async function stockCategoryOptions(tx:any,clientId:string){
 return tx`select distinct activity_id,inventory_use,stock_class from (
  select activity_id::text,inventory_use,stock_class from erp_private.stock_categories where client_id=${clientId}
  union
  select c.activity_id::text,null::text as inventory_use,c.stock_class from erp_private.stock_controls c join erp_private.projects p using(project_id) where p.client_id=${clientId}
  union
  select nullif(r.review_details->>'activity_id',''),coalesce(r.review_details->>'inventory_use',case when r.account_code in ('10200','50010') then 'Construction raw materials' when r.account_code in ('10190','50000') then 'Goods for resale' else 'Other inventory' end),r.review_details->>'stock_class'
  from erp_private.workbook_rows r join erp_private.tax_row_reviews v using(row_id)
  where r.client_id=${clientId} and r.route=1 and not r.is_split_parent and v.source_revision=r.revision and v.decision in ('Eligible','Excluded') and coalesce(r.review_details->>'stock_class','')<>''
 ) choices order by stock_class,activity_id,inventory_use`;
}
