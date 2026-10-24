// One scoped query avoids serial database round trips on the landing page.
export async function readWorkspace(tx:any,a:any){
 const [r]=await tx`select jsonb_build_object(
 'me',jsonb_build_object('staff_id',${a.staff_id}::text,'login_id',${a.login_id}::text,'full_name',${a.full_name}::text,'category_code',${a.category_code}::text),
 'firms',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select firm_id,firm_code,legal_name,kra_pin,email,phone,physical_address,invoice_prefix from erp_private.firms where deleted_at is null order by firm_code) rows),
 'clients',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select client_id,company_name,kra_pin,primary_sector,branch_location,client_category,incorporation_date,is_pie,sme_audit_exempt,audit_requested,missing_fields,revision from erp_private.clients where deleted_at is null order by company_name limit 1000) rows),
 'projects',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select project_id,client_id,handling_firm_id,project_name,service_code,status,revision from erp_private.projects where deleted_at is null order by created_at desc limit 500) rows),
 'tasks',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select task_id,project_id,assigned_to,task_name,description,due_at,status,blocked_reason,revision,requires_document,period_start,period_end,template_key,filing_date from erp_private.tasks where deleted_at is null order by due_at nulls last limit 1000) rows),
 'documents',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select document_id,client_id,handling_firm_id,project_id,task_id,category,file_name,file_size_bytes,version,is_locked,uploaded_at from erp_private.documents where deleted_at is null order by uploaded_at desc limit 500) rows),
 'staff',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select staff_id,staff_identifier,login_id,full_name,category_code,employment_type,billing_status,branch_location,contract_start_date,contract_end_date,access_status,revision from erp_private.staff_members where deleted_at is null order by full_name limit 500) rows),
 'staff_firms',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select staff_id,firm_id,scope from erp_private.staff_firm_access where deleted_at is null) rows),
 'client_firms',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select client_id,firm_id from erp_private.client_firm_links where deleted_at is null) rows),
 'assignments',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select project_id,staff_id,start_date,end_date,allocation_percentage from erp_private.project_assignments where deleted_at is null) rows),
 'services',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select service_code,service_name from erp_private.services where is_active order by service_name) rows),
 'sectors',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select sector_id,name,parent_id from erp_private.sectors where deleted_at is null order by name) rows),
 'candidates',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select * from erp_private.assignment_candidates()) rows),
 'schedules',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select * from erp_private.project_schedules where deleted_at is null) rows),
 'timesheets',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select * from erp_private.timesheets where deleted_at is null order by work_date desc,created_at desc limit 1000) rows),
 'notifications',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select n.* from erp_private.notifications n where not exists(select 1 from erp_private.notification_reads nr where nr.notification_id=n.notification_id and nr.staff_id=${a.staff_id}) order by n.created_at desc limit 50) rows),
 'sales_reviews',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select reconciliation_id,project_id,review_type,starts_on,ends_on,status,prepared_by,revision,result from erp_private.sales_reconciliations order by ends_on desc limit 100) rows),
 'task_events',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select * from erp_private.task_events order by created_at desc limit 200) rows),
 'workbook_batches',(select coalesce(jsonb_agg(rows),'[]'::jsonb) from (select * from erp_private.workbook_batches order by created_at desc limit 200) rows)) as workspace`;return r.workspace;
}
