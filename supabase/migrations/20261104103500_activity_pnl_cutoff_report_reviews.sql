-- Step 3 of the entity / industry chart of accounts design, plus the 4 Nov 2026 UAT requests.
-- 1. Activity tag on journal lines and on sales / payroll period imports, so profit can be
--    reported per business activity. Only profit-and-loss accounts (40000 and above) carry a tag,
--    and the activity must belong to the journal's client and cover the journal date.
-- 2. Data cut-off: the ERP holds periods ending 31 December 2025 onwards. Older periods stay in
--    the client's previous records. NOT VALID keeps any earlier archived test rows untouched.
-- 3. Reviewed financial reports: a preparer submits a report (month, quarter, year to date or
--    year end) with a note; a different Manager or Partner approves or returns it with a note.

ALTER TABLE erp_private.ledger_lines ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES erp_private.client_activities;
CREATE INDEX IF NOT EXISTS ledger_lines_activity_idx ON erp_private.ledger_lines(activity_id) WHERE activity_id IS NOT NULL;
ALTER TABLE erp_private.period_imports ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES erp_private.client_activities;
CREATE INDEX IF NOT EXISTS period_imports_activity_idx ON erp_private.period_imports(activity_id) WHERE activity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION erp_private.ledger_line_activity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE cid uuid; jdate date;
BEGIN
 IF NEW.activity_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.account_code IS NULL OR NEW.account_code < '40000' THEN
  RAISE EXCEPTION 'Only income and expense lines carry a business activity' USING ERRCODE='23514';
 END IF;
 SELECT l.client_id,j.journal_date INTO cid,jdate FROM erp_private.ledger_journals j JOIN erp_private.ledger_periods l USING(period_id) WHERE j.journal_id=NEW.journal_id;
 IF NOT EXISTS(SELECT 1 FROM erp_private.client_activities a WHERE a.activity_id=NEW.activity_id AND a.client_id=cid
   AND a.effective_from<=jdate AND (a.effective_to IS NULL OR a.effective_to>=jdate)) THEN
  RAISE EXCEPTION 'The business activity on this line does not belong to the client or does not cover the journal date' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.ledger_line_activity_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.ledger_line_activity_guard() TO erp_api;
CREATE TRIGGER ledger_line_activity_guard BEFORE INSERT OR UPDATE OF activity_id,account_code ON erp_private.ledger_lines FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_line_activity_guard();

CREATE OR REPLACE FUNCTION erp_private.period_import_activity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.activity_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_activities a WHERE a.activity_id=NEW.activity_id AND a.client_id=NEW.client_id
   AND a.effective_from<=NEW.ends_on AND (a.effective_to IS NULL OR a.effective_to>=NEW.starts_on)) THEN
  RAISE EXCEPTION 'The business activity does not belong to the client or does not cover this import period' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.period_import_activity_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.period_import_activity_guard() TO erp_api;
CREATE TRIGGER period_import_activity_guard BEFORE INSERT OR UPDATE OF activity_id ON erp_private.period_imports FOR EACH ROW EXECUTE FUNCTION erp_private.period_import_activity_guard();

-- Data cut-off (periods ending 31 December 2025 onwards)
ALTER TABLE erp_private.ledger_periods ADD CONSTRAINT ledger_periods_data_cutoff CHECK(ends_on>=DATE '2025-12-31') NOT VALID;
ALTER TABLE erp_private.workbook_batches ADD CONSTRAINT workbook_batches_data_cutoff CHECK(period_end>=DATE '2025-12-31') NOT VALID;
ALTER TABLE erp_private.period_imports ADD CONSTRAINT period_imports_data_cutoff CHECK(ends_on>=DATE '2025-12-31') NOT VALID;
ALTER TABLE erp_private.tax_cases ADD CONSTRAINT tax_cases_data_cutoff CHECK(ends_on>=DATE '2025-12-31') NOT VALID;

-- Reviewed financial reports
CREATE TABLE erp_private.ledger_report_reviews(
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 report_kind text NOT NULL CHECK(report_kind IN('Month','Quarter','Year to date','Year end')),
 starts_on date NOT NULL,
 as_of date NOT NULL CHECK(as_of>=starts_on),
 snapshot jsonb NOT NULL,
 snapshot_digest text NOT NULL CHECK(length(snapshot_digest)=64),
 prepared_note text NOT NULL CHECK(length(btrim(prepared_note))>=10),
 status text NOT NULL DEFAULT 'Submitted' CHECK(status IN('Submitted','Approved','Returned')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status='Submitted' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>prepared_by AND length(btrim(coalesce(review_note,'')))>=10))
);
CREATE INDEX ledger_report_reviews_period_idx ON erp_private.ledger_report_reviews(period_id,status,as_of);
CREATE INDEX ledger_report_reviews_project_idx ON erp_private.ledger_report_reviews(project_id);
CREATE INDEX ledger_report_reviews_prepared_by_idx ON erp_private.ledger_report_reviews(prepared_by);
CREATE INDEX ledger_report_reviews_reviewed_by_idx ON erp_private.ledger_report_reviews(reviewed_by);
ALTER TABLE erp_private.ledger_report_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.ledger_report_reviews FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.ledger_report_reviews TO erp_api;
CREATE POLICY ledger_report_reviews_read ON erp_private.ledger_report_reviews FOR SELECT TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ledger_report_reviews_insert ON erp_private.ledger_report_reviews FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND prepared_by=(erp_private.actor()).staff_id AND status='Submitted');
CREATE POLICY ledger_report_reviews_update ON erp_private.ledger_report_reviews FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'))
 WITH CHECK(erp_private.project_allowed(project_id));
CREATE OR REPLACE FUNCTION erp_private.ledger_report_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF (NEW.project_id,NEW.period_id,NEW.report_kind,NEW.starts_on,NEW.as_of,NEW.snapshot,NEW.snapshot_digest,NEW.prepared_note,NEW.prepared_by)
    IS DISTINCT FROM (OLD.project_id,OLD.period_id,OLD.report_kind,OLD.starts_on,OLD.as_of,OLD.snapshot,OLD.snapshot_digest,OLD.prepared_note,OLD.prepared_by) THEN
  RAISE EXCEPTION 'A submitted report cannot be edited; submit a new one' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'Submitted' OR NEW.status NOT IN('Approved','Returned') THEN RAISE EXCEPTION 'Only a submitted report can be approved or returned' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' AND (a.category_code NOT IN('PARTNER','MANAGER') OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN
  RAISE EXCEPTION 'A different Manager or Partner must review this report' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.ledger_report_review_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.ledger_report_review_guard() TO erp_api;
CREATE TRIGGER ledger_report_review_guard BEFORE UPDATE ON erp_private.ledger_report_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_report_review_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ledger_report_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.ledger_report_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('review_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.ledger_report_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
