-- TEST3: keep valid import lines moving, retain failed source evidence, and
-- archive mistaken uploads without deleting documents or their ledger history.
ALTER TABLE erp_private.documents
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN archived_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ADD COLUMN archive_reason text;

ALTER TABLE erp_private.documents
 ADD CONSTRAINT documents_archive_state_check CHECK (
  (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
  OR
  (archived_at IS NOT NULL AND archived_by IS NOT NULL AND length(btrim(coalesce(archive_reason,'')))>=3)
 );

GRANT UPDATE(archived_at,archived_by,archive_reason) ON erp_private.documents TO erp_api;
CREATE POLICY documents_archive_update ON erp_private.documents FOR UPDATE TO erp_api
 USING (
  deleted_at IS NULL AND archived_at IS NULL AND category='Import Sources'
  AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false)
  AND (
   erp_private.is_leader()
   OR uploaded_by=(erp_private.actor()).staff_id
    AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_batches b WHERE b.document_id=documents.document_id)
  )
 )
 WITH CHECK (
  deleted_at IS NULL AND archived_at IS NOT NULL
  AND archived_by=(erp_private.actor()).staff_id
  AND length(btrim(coalesce(archive_reason,'')))>=3
  AND category='Import Sources'
  AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false)
  AND (
   erp_private.is_leader()
   OR uploaded_by=(erp_private.actor()).staff_id
    AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_batches b WHERE b.document_id=documents.document_id)
  )
 );

-- Help the 100-row mapping page and pending credit-note checks avoid large scans.
CREATE INDEX workbook_rows_project_page_idx
 ON erp_private.workbook_rows(project_id,created_at,source_row,row_id)
 WHERE NOT is_split_parent;
CREATE INDEX workbook_rows_project_dataset_page_idx
 ON erp_private.workbook_rows(project_id,dataset,created_at,source_row,row_id)
 WHERE NOT is_split_parent;
CREATE INDEX workbook_rows_pending_purchase_match_idx
 ON erp_private.workbook_rows(project_id,row_key)
 WHERE dataset='Purchases' AND parent_row_id IS NULL;
CREATE INDEX workbook_rejections_pending_key_idx
 ON erp_private.workbook_rejections((raw_values->'_pending_purchase'->>'key'),source_row)
 WHERE raw_values ? '_pending_purchase';
