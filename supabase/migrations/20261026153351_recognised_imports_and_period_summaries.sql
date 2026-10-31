CREATE TABLE erp_private.period_imports (
 import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,document_id uuid NOT NULL REFERENCES erp_private.documents,
 kind text NOT NULL CHECK(kind IN ('Sales','Payroll')),starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),
 payload jsonb NOT NULL,source_hash text NOT NULL,source_members jsonb NOT NULL DEFAULT '[]',
 replaces_ids uuid[] NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Confirmed','Superseded')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,reviewed_by uuid REFERENCES erp_private.staff_members,
 review_note text,notes text NOT NULL DEFAULT '',revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,source_hash)
);
CREATE INDEX period_import_scope_idx ON erp_private.period_imports(project_id,kind,starts_on,ends_on,status);
CREATE INDEX period_import_client_idx ON erp_private.period_imports(client_id,kind,starts_on,ends_on);
CREATE INDEX period_import_document_idx ON erp_private.period_imports(document_id);
CREATE INDEX period_import_preparer_idx ON erp_private.period_imports(prepared_by);
CREATE INDEX period_import_reviewer_idx ON erp_private.period_imports(reviewed_by);
ALTER TABLE erp_private.period_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.period_imports FORCE ROW LEVEL SECURITY;
CREATE POLICY period_import_select ON erp_private.period_imports FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_import_insert ON erp_private.period_imports FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND prepared_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_import_update ON erp_private.period_imports FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
REVOKE ALL ON erp_private.period_imports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_imports TO erp_api;
CREATE FUNCTION erp_private.period_import_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;p erp_private.projects;
BEGIN
 a:=erp_private.actor();SELECT * INTO p FROM erp_private.projects WHERE project_id=NEW.project_id AND deleted_at IS NULL;
 IF p.project_id IS NULL OR p.status='Archived' OR p.client_id IS DISTINCT FROM NEW.client_id THEN RAISE EXCEPTION 'Use the authorised active client project';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=NEW.document_id AND project_id=NEW.project_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Project import source required';END IF;
 IF current_user='erp_api' AND (a.staff_id IS NULL OR a.category_code='INTERN') THEN RAISE EXCEPTION 'Assigned preparer required' USING ERRCODE='42501';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.reviewed_by IS NOT NULL OR (current_user='erp_api' AND NEW.prepared_by<>a.staff_id) THEN RAISE EXCEPTION 'Import as a preparer draft';END IF;
 ELSE
  IF (NEW.project_id,NEW.client_id,NEW.document_id,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.payload,NEW.source_hash,NEW.source_members,NEW.replaces_ids,NEW.prepared_by,NEW.notes) IS DISTINCT FROM (OLD.project_id,OLD.client_id,OLD.document_id,OLD.kind,OLD.starts_on,OLD.ends_on,OLD.payload,OLD.source_hash,OLD.source_members,OLD.replaces_ids,OLD.prepared_by,OLD.notes) THEN RAISE EXCEPTION 'Import snapshot is immutable. Create a replacement.';END IF;
  IF OLD.status='Superseded' THEN RAISE EXCEPTION 'Superseded import history is immutable';END IF;
  IF NEW.status='Submitted' AND OLD.status IN ('Draft','Returned') THEN
   IF current_user='erp_api' AND a.staff_id<>OLD.prepared_by THEN RAISE EXCEPTION 'Only the preparer may submit';END IF;
  ELSIF NEW.status IN ('Confirmed','Returned') AND OLD.status='Submitted' THEN
   IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Independent reviewer required' USING ERRCODE='42501';END IF;
   IF length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Record the independent review conclusion';END IF;
  ELSIF NEW.status='Superseded' THEN
   IF current_user='erp_api' AND current_setting('erp.period_import_replacement',true) IS DISTINCT FROM 'confirmed' THEN RAISE EXCEPTION 'Confirm a replacement before retiring prior coverage';END IF;
  ELSE RAISE EXCEPTION 'Invalid import state transition';END IF;
  NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER period_import_guard BEFORE INSERT OR UPDATE ON erp_private.period_imports FOR EACH ROW EXECUTE FUNCTION erp_private.period_import_guard();
REVOKE ALL ON FUNCTION erp_private.period_import_guard() FROM PUBLIC,anon,authenticated;

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
WHERE r.dataset IN ('Purchases','Expenditure','Non-eTIMS') AND NOT r.is_split_parent;

CREATE TRIGGER period_import_audit AFTER INSERT OR UPDATE ON erp_private.period_imports FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('import_id');

-- A global unique daily reservation enforces non-overlap even when RLS hides an
-- existing engagement. Confirmation transfers coverage atomically.
CREATE TABLE erp_private.period_import_days (
 client_id uuid NOT NULL REFERENCES erp_private.clients,kind text NOT NULL,
 coverage_day date NOT NULL,import_id uuid NOT NULL REFERENCES erp_private.period_imports,
 project_id uuid NOT NULL REFERENCES erp_private.projects,PRIMARY KEY(client_id,kind,coverage_day)
);
CREATE INDEX period_import_days_source_idx ON erp_private.period_import_days(import_id);
CREATE INDEX period_import_days_project_idx ON erp_private.period_import_days(project_id);
ALTER TABLE erp_private.period_import_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.period_import_days FORCE ROW LEVEL SECURITY;
CREATE POLICY period_days_scope ON erp_private.period_import_days FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
REVOKE ALL ON erp_private.period_import_days FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON erp_private.period_import_days TO erp_api;
CREATE FUNCTION erp_private.reserve_import_days() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='Superseded' THEN DELETE FROM erp_private.period_import_days WHERE import_id=NEW.import_id;
 ELSIF NEW.status='Confirmed' AND OLD.status<>'Confirmed' THEN
  INSERT INTO erp_private.period_import_days(client_id,kind,coverage_day,import_id,project_id)
  SELECT NEW.client_id,NEW.kind,d::date,NEW.import_id,NEW.project_id FROM pg_catalog.generate_series(NEW.starts_on::timestamp,NEW.ends_on::timestamp,'1 day'::interval) d;
 END IF;RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.reserve_import_days() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER period_import_coverage AFTER UPDATE ON erp_private.period_imports FOR EACH ROW EXECUTE FUNCTION erp_private.reserve_import_days();
