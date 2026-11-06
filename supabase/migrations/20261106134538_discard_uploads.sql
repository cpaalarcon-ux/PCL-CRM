-- Already applied to pcl-erp-staging on 6 November 2026; kept at its applied version
-- so repository migration history matches staging. Do not apply this again there.
ALTER TABLE erp_private.period_imports
 ADD COLUMN discarded_at timestamptz,
 ADD COLUMN discarded_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ADD COLUMN discard_reason text;
CREATE INDEX period_import_discarder_idx ON erp_private.period_imports(discarded_by) WHERE discarded_by IS NOT NULL;

ALTER TABLE erp_private.period_imports DROP CONSTRAINT period_imports_status_check;
ALTER TABLE erp_private.period_imports ADD CONSTRAINT period_imports_status_check
 CHECK(status IN ('Draft','Submitted','Returned','Confirmed','Superseded','Discarded'));
ALTER TABLE erp_private.period_imports ADD CONSTRAINT period_imports_discard_state CHECK(
 (status='Discarded' AND discarded_at IS NOT NULL AND discarded_by IS NOT NULL AND length(btrim(coalesce(discard_reason,'')))>=5)
 OR (status<>'Discarded' AND discarded_at IS NULL AND discarded_by IS NULL AND discard_reason IS NULL));

ALTER TABLE erp_private.period_imports DROP CONSTRAINT period_imports_project_id_source_hash_key;
CREATE UNIQUE INDEX period_imports_live_source_hash_idx ON erp_private.period_imports(project_id,source_hash) WHERE status<>'Discarded';

DO $patch$
DECLARE def text; patched text;
BEGIN
 def:=pg_get_functiondef('erp_private.period_import_guard()'::regprocedure);
 patched:=replace(def,$a$IF OLD.status='Superseded' THEN$a$,$b$IF OLD.status IN ('Superseded','Discarded') THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'period_import_guard: superseded rule not found'; END IF;
 def:=patched;
 patched:=replace(def,$a$ELSIF NEW.status='Superseded' THEN$a$,
  $b$ELSIF NEW.status='Discarded' AND OLD.status IN ('Draft','Returned') THEN
   IF current_user='erp_api' AND (a.staff_id IS NULL OR (a.staff_id IS DISTINCT FROM OLD.prepared_by AND a.category_code NOT IN ('PARTNER','MANAGER')) OR NEW.discarded_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Only the preparer, a Manager or a Partner can discard a draft summary' USING ERRCODE='42501';END IF;
  ELSIF NEW.status='Superseded' THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'period_import_guard: discard rule not found'; END IF;
 EXECUTE patched;
END
$patch$;

CREATE FUNCTION erp_private.row_locks_upload(r erp_private.workbook_rows) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT ((r.route IS NOT NULL OR r.account_code IS NOT NULL)
   AND NOT (r.review_details->'mapping_confirmation'->>'imported_by' IS NOT NULL AND r.review_details->'mapping_confirmation'->>'confirmed_by' IS NULL))
  OR EXISTS(SELECT 1 FROM erp_private.tax_row_reviews v WHERE v.row_id=r.row_id)
  OR EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Workbook row' AND s.source_key=r.row_id::text)
$$;
REVOKE ALL ON FUNCTION erp_private.row_locks_upload(erp_private.workbook_rows) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.row_locks_upload(erp_private.workbook_rows) TO erp_api;

ALTER POLICY workbook_batches_archive_update ON erp_private.workbook_batches
 USING (
  archived_at IS NULL AND erp_private.project_allowed(project_id)
  AND (
   erp_private.is_leader()
   OR EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=workbook_batches.document_id AND d.uploaded_by=(erp_private.actor()).staff_id)
    AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_rows r WHERE r.batch_id=workbook_batches.batch_id AND erp_private.row_locks_upload(r))
  )
 )
 WITH CHECK (
  archived_at IS NOT NULL AND archived_by=(erp_private.actor()).staff_id
  AND length(btrim(coalesce(archive_reason,'')))>=3
  AND erp_private.project_allowed(project_id)
  AND (
   erp_private.is_leader()
   OR EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=workbook_batches.document_id AND d.uploaded_by=(erp_private.actor()).staff_id)
    AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_rows r WHERE r.batch_id=workbook_batches.batch_id AND erp_private.row_locks_upload(r))
  )
 );

ALTER POLICY documents_archive_update ON erp_private.documents
 USING (
  deleted_at IS NULL AND archived_at IS NULL AND category='Import Sources'
  AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false)
  AND (
   erp_private.is_leader()
   OR uploaded_by=(erp_private.actor()).staff_id
    AND NOT EXISTS(
     SELECT 1 FROM erp_private.workbook_rows r JOIN erp_private.workbook_batches b USING(batch_id)
     WHERE b.document_id=documents.document_id AND erp_private.row_locks_upload(r)
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
     WHERE b.document_id=documents.document_id AND erp_private.row_locks_upload(r)
    )
  )
 );
;
