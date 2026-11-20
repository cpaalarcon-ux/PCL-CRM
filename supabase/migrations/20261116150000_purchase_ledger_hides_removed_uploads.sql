-- Build 2827: the purchases ledger must not show rows from an import source that was removed from active mapping.
-- The view listed every purchase row whatever the state of its batch, so removing (archiving) an upload left its rows in the ledger.
-- The rows and batches are kept for history; the ledger now shows only rows whose batch is still active. Columns are unchanged.
CREATE OR REPLACE VIEW erp_private.purchase_ledger_items WITH(security_invoker=true) AS
SELECT r.row_id,r.project_id,r.client_id,r.batch_id,r.source_row,r.revision,r.dataset,
 b.document_id,b.sheet_name,b.period_start,b.period_end,
 coalesce(nullif(r.normalized->>'date',''),b.period_start::text) transaction_date,
 r.normalized->>'invoice' invoice,r.normalized->>'original_invoice' original_invoice,
 r.normalized->>'party' supplier,r.normalized->>'party_pin' supplier_pin,
 coalesce(nullif(r.narration,''),r.normalized->>'description','') narration,
 (r.normalized->>'amount')::numeric net_amount,(r.normalized->>'vat')::numeric vat_amount,
 CASE WHEN r.account_code IS NULL THEN 'Unmapped'
 WHEN r.route=1 AND (r.review_details->>'inventory_use'='Construction raw materials' OR r.account_code IN ('10200','50010')) THEN 'Construction raw materials'
 WHEN r.route=1 AND (r.review_details->>'inventory_use'='Goods for resale' OR r.account_code IN ('10190','50000')) THEN 'Goods for resale'
 WHEN r.route=1 THEN 'Other inventory' WHEN r.route=2 THEN 'Expenditure' WHEN r.route=3 THEN 'PPE' ELSE 'Unmapped' END ledger_group,
 CASE WHEN r.dataset='Non-eTIMS' THEN 'Non-eTIMS'
 WHEN v.vat_rate_key='KE_VAT_STANDARD' THEN '16%'
 WHEN v.vat_rate_key='KE_VAT_PETROLEUM_8' OR r.normalized->>'legacy_tax_review'='true' THEN '8%'
 WHEN v.vat_rate_key='KE_VAT_ZERO' THEN '0%'
 WHEN v.vat_rate_key='KE_VAT_EXEMPT' THEN 'Exempt'
 ELSE coalesce(r.normalized->>'vat_category','Unconfirmed') END vat_category,
 r.route,r.category_code,r.account_code,r.account_name,r.review_details->>'stock_class' stock_class,
 r.review_details->>'construction_job' construction_job,r.first_use_status,r.first_use_date,r.asset_details,
 CASE WHEN v.source_revision=r.revision AND v.decision IN ('Eligible','Excluded') AND v.income_treatment IS NOT NULL AND v.income_treatment<>'Review' THEN 'Reviewed' ELSE 'Pending review' END review_status,
 CASE WHEN v.source_revision=r.revision AND v.decision='Eligible' THEN round((r.normalized->>'vat')::numeric*v.deductible_percentage/100,2) ELSE NULL END recoverable_vat,
 j.journal_id,j.status posting_status,j.journal_date,j.reference posting_reference,
 a.asset_id,a.status asset_status,
 EXISTS(SELECT 1 FROM erp_private.ledger_journals reversal WHERE reversal.reversal_of=j.journal_id AND reversal.status='Posted') has_posted_reversal
FROM erp_private.workbook_rows r
JOIN erp_private.workbook_batches b USING(batch_id)
LEFT JOIN erp_private.tax_row_reviews v USING(row_id)
LEFT JOIN erp_private.ledger_sources s ON s.source_kind='Workbook row' AND s.source_key=r.row_id::text
LEFT JOIN erp_private.ledger_journals j ON j.journal_id=s.journal_id
LEFT JOIN erp_private.ledger_assets a ON a.source_row_id=r.row_id
WHERE r.dataset IN ('Purchases','Expenditure','Non-eTIMS') AND NOT r.is_split_parent AND b.archived_at IS NULL;
