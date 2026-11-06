-- Keep eTIMS and Z/POS coverage independent so an update supersedes only the
-- same source. Weekly and month-to-date updates never add over prior versions.
ALTER TABLE erp_private.period_imports
 ADD COLUMN source_type text NOT NULL DEFAULT 'ETIMS',
 ADD COLUMN coverage_mode text NOT NULL DEFAULT 'LEGACY';

-- Older deployed workspace code inserts Payroll without the new discriminators.
-- The guard below normalises those writes while keeping the source constraint strict.
ALTER TABLE erp_private.period_imports DISABLE TRIGGER period_import_guard;
UPDATE erp_private.period_imports SET source_type='PAYROLL' WHERE kind='Payroll';
ALTER TABLE erp_private.period_imports ENABLE TRIGGER period_import_guard;

ALTER TABLE erp_private.period_imports
 ADD CONSTRAINT period_import_source_mode_check CHECK (
  (kind='Sales' AND source_type IN ('ETIMS','Z_REPORT') AND coverage_mode IN ('WEEKLY','MONTH_TO_DATE','MONTH_FINAL','HISTORICAL','LEGACY'))
  OR (kind='Payroll' AND source_type='PAYROLL' AND coverage_mode IN ('PAYROLL_MONTHLY','LEGACY'))
 );
CREATE INDEX period_import_source_coverage_idx
 ON erp_private.period_imports(client_id,kind,source_type,starts_on,ends_on,status);

ALTER TABLE erp_private.period_import_days ADD COLUMN source_type text NOT NULL DEFAULT 'ETIMS';
UPDATE erp_private.period_import_days d SET source_type=i.source_type
 FROM erp_private.period_imports i WHERE i.import_id=d.import_id;
ALTER TABLE erp_private.period_import_days DROP CONSTRAINT period_import_days_pkey;
ALTER TABLE erp_private.period_import_days
 ADD CONSTRAINT period_import_days_pkey PRIMARY KEY(client_id,kind,source_type,coverage_day);

CREATE OR REPLACE FUNCTION erp_private.period_import_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;p erp_private.projects;
BEGIN
 a:=erp_private.actor();
 IF TG_OP='INSERT' AND NEW.kind='Payroll' AND NEW.source_type='ETIMS' AND NEW.coverage_mode='LEGACY' THEN
  NEW.source_type:='PAYROLL';
 END IF;
 SELECT * INTO p FROM erp_private.projects WHERE project_id=NEW.project_id AND deleted_at IS NULL;
 IF p.project_id IS NULL OR p.status='Archived' OR p.client_id IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'Use the authorised active client project';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=NEW.document_id AND project_id=NEW.project_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Project import source required';END IF;
 IF current_user='erp_api' AND (a.staff_id IS NULL OR a.category_code='INTERN') THEN RAISE EXCEPTION 'Assigned preparer required' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.reviewed_by IS NOT NULL OR (current_user='erp_api' AND NEW.prepared_by<>a.staff_id) THEN RAISE EXCEPTION 'Import as a preparer draft';END IF;
 ELSE
  IF (NEW.project_id,NEW.client_id,NEW.document_id,NEW.kind,NEW.source_type,NEW.coverage_mode,NEW.starts_on,NEW.ends_on,NEW.payload,NEW.source_hash,NEW.source_members,NEW.replaces_ids,NEW.prepared_by,NEW.notes) IS DISTINCT FROM (OLD.project_id,OLD.client_id,OLD.document_id,OLD.kind,OLD.source_type,OLD.coverage_mode,OLD.starts_on,OLD.ends_on,OLD.payload,OLD.source_hash,OLD.source_members,OLD.replaces_ids,OLD.prepared_by,OLD.notes) THEN RAISE EXCEPTION 'Import snapshot is immutable. Create a replacement.';END IF;
  IF OLD.status='Superseded' THEN RAISE EXCEPTION 'Superseded import history is immutable';END IF;
  IF NEW.status='Submitted' AND OLD.status IN ('Draft','Returned') THEN
   IF current_user='erp_api' AND a.staff_id<>OLD.prepared_by THEN RAISE EXCEPTION 'Only the preparer may submit';END IF;
  ELSIF NEW.status IN ('Confirmed','Returned') AND OLD.status='Submitted' THEN
   IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501';END IF;
   IF length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Record the independent review conclusion';END IF;
  ELSIF NEW.status='Draft' AND OLD.status='Submitted' THEN
   IF current_setting('erp.withdraw',true) IS DISTINCT FROM 'period_import' OR OLD.reviewed_by IS NOT NULL OR (current_user='erp_api' AND a.staff_id IS DISTINCT FROM OLD.prepared_by) THEN RAISE EXCEPTION 'Only the preparer can withdraw an import that has not been reviewed' USING ERRCODE='42501';END IF;
  ELSIF NEW.status='Superseded' THEN
   IF current_user='erp_api' AND current_setting('erp.period_import_replacement',true) IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'Confirm a replacement before retiring prior coverage';END IF;
  ELSE RAISE EXCEPTION 'Invalid import state transition';END IF;
  NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION erp_private.reserve_import_days() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='Superseded' THEN DELETE FROM erp_private.period_import_days WHERE import_id=NEW.import_id;
 ELSIF NEW.status='Confirmed' AND OLD.status<>'Confirmed' THEN
  INSERT INTO erp_private.period_import_days(client_id,kind,source_type,coverage_day,import_id,project_id)
  SELECT NEW.client_id,NEW.kind,NEW.source_type,d::date,NEW.import_id,NEW.project_id
  FROM pg_catalog.generate_series(NEW.starts_on::timestamp,NEW.ends_on::timestamp,'1 day'::interval) d;
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION erp_private.period_import_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.reserve_import_days() FROM PUBLIC,anon,authenticated;
