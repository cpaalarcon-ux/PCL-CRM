-- Let the uploader remove a mistaken, still-unmapped import from active mapping.
-- Keep source files and imported row history; mapped/reviewed/posted rows require
-- a Partner or Manager to archive them as a controlled correction.
ALTER TABLE erp_private.workbook_batches
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN archived_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ADD COLUMN archive_reason text,
 ADD CONSTRAINT workbook_batches_archive_state_check CHECK (
  (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
  OR
  (archived_at IS NOT NULL AND archived_by IS NOT NULL AND length(btrim(coalesce(archive_reason,'')))>=3)
 );

GRANT UPDATE(archived_at,archived_by,archive_reason) ON erp_private.workbook_batches TO erp_api;
CREATE POLICY workbook_batches_archive_update ON erp_private.workbook_batches FOR UPDATE TO erp_api
 USING (
  archived_at IS NULL AND erp_private.project_allowed(project_id)
  AND (
   erp_private.is_leader()
   OR EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=workbook_batches.document_id AND d.uploaded_by=(erp_private.actor()).staff_id)
    AND NOT EXISTS(
     SELECT 1 FROM erp_private.workbook_rows r WHERE r.batch_id=workbook_batches.batch_id AND (
      r.route IS NOT NULL OR r.account_code IS NOT NULL
      OR EXISTS(SELECT 1 FROM erp_private.tax_row_reviews v WHERE v.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.mapping_history h WHERE h.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Workbook row' AND s.source_key=r.row_id::text)
     )
    )
  )
 )
 WITH CHECK (
  archived_at IS NOT NULL AND archived_by=(erp_private.actor()).staff_id
  AND length(btrim(coalesce(archive_reason,'')))>=3
  AND erp_private.project_allowed(project_id)
  AND (
   erp_private.is_leader()
   OR EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=workbook_batches.document_id AND d.uploaded_by=(erp_private.actor()).staff_id)
    AND NOT EXISTS(
     SELECT 1 FROM erp_private.workbook_rows r WHERE r.batch_id=workbook_batches.batch_id AND (
      r.route IS NOT NULL OR r.account_code IS NOT NULL
      OR EXISTS(SELECT 1 FROM erp_private.tax_row_reviews v WHERE v.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.mapping_history h WHERE h.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Workbook row' AND s.source_key=r.row_id::text)
     )
    )
  )
 );

DROP POLICY documents_archive_update ON erp_private.documents;
CREATE POLICY documents_archive_update ON erp_private.documents FOR UPDATE TO erp_api
 USING (
  deleted_at IS NULL AND archived_at IS NULL AND category='Import Sources'
  AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false)
  AND (
   erp_private.is_leader()
   OR uploaded_by=(erp_private.actor()).staff_id
    AND NOT EXISTS(
     SELECT 1 FROM erp_private.workbook_rows r JOIN erp_private.workbook_batches b USING(batch_id)
     WHERE b.document_id=documents.document_id AND (
      r.route IS NOT NULL OR r.account_code IS NOT NULL
      OR EXISTS(SELECT 1 FROM erp_private.tax_row_reviews v WHERE v.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.mapping_history h WHERE h.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Workbook row' AND s.source_key=r.row_id::text)
     )
    )
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
    AND NOT EXISTS(
     SELECT 1 FROM erp_private.workbook_rows r JOIN erp_private.workbook_batches b USING(batch_id)
     WHERE b.document_id=documents.document_id AND (
      r.route IS NOT NULL OR r.account_code IS NOT NULL
      OR EXISTS(SELECT 1 FROM erp_private.tax_row_reviews v WHERE v.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.mapping_history h WHERE h.row_id=r.row_id)
      OR EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Workbook row' AND s.source_key=r.row_id::text)
     )
    )
  )
 );

-- Keep row keys intact in the audit history while allowing corrected files to
-- be staged as a new batch. Active duplicate prevention remains serialized by
-- the existing client/dataset advisory lock in the import action.
ALTER TABLE erp_private.workbook_rows
 DROP CONSTRAINT workbook_rows_client_id_dataset_row_key_key,
 ADD CONSTRAINT workbook_rows_batch_id_row_key_key UNIQUE(batch_id,row_key);

CREATE INDEX workbook_batches_active_document_idx
 ON erp_private.workbook_batches(document_id,created_at DESC)
 WHERE archived_at IS NULL;
CREATE INDEX workbook_rows_client_dataset_key_idx
 ON erp_private.workbook_rows(client_id,dataset,row_key)
 WHERE parent_row_id IS NULL;
