-- Frozen source totals and numbered computation snapshots (build 2026-11-10.2730), step 4 of the Partner's build order of 10 Nov 2026 17:46.
-- Every time a return is submitted for review, and again when it is locked, the server records an immutable, numbered snapshot: the inputs, the result, the rate versions
-- used and whether the Tax Lead's written confirmation covers them, the credits claimed, and the totals of the source rows by dataset with a fingerprint of those rows.
-- A return cannot be locked if its source rows no longer match the last submission, and a return whose rates or rules are not confirmed cannot be recorded as filed.
-- This holds records; it does not compute anything and activates no VAT formula, credit rule or rate. Rates stay governed by tax_rates (status Approved plus the
-- Tax Lead's recorded legal confirmation), which a Partner records; Claude never records that confirmation.

CREATE TABLE erp_private.tax_computation_snapshots(
 snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.tax_cases,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 snapshot_no integer NOT NULL,
 stage text NOT NULL CHECK(stage IN('SUBMITTED','LOCKED')),
 taken_by uuid NOT NULL REFERENCES erp_private.staff_members,
 taken_at timestamptz NOT NULL DEFAULT now(),
 inputs jsonb NOT NULL,
 result jsonb NOT NULL,
 applied_rates jsonb NOT NULL DEFAULT '[]',
 rules_status text NOT NULL CHECK(rules_status IN('CONFIRMED','UNCONFIRMED','TESTING')),
 source_totals jsonb NOT NULL DEFAULT '[]',
 source_row_count integer NOT NULL CHECK(source_row_count>=0),
 source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
 credits_claimed jsonb NOT NULL DEFAULT '[]',
 UNIQUE(case_id,snapshot_no)
);
CREATE INDEX tax_snapshot_project_idx ON erp_private.tax_computation_snapshots(project_id);
CREATE INDEX tax_snapshot_client_idx ON erp_private.tax_computation_snapshots(client_id);
CREATE INDEX tax_snapshot_taker_idx ON erp_private.tax_computation_snapshots(taken_by);
ALTER TABLE erp_private.tax_computation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.tax_computation_snapshots FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.tax_computation_snapshots TO erp_api;
CREATE POLICY tax_snapshot_read ON erp_private.tax_computation_snapshots FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY tax_snapshot_insert ON erp_private.tax_computation_snapshots FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND taken_by=(erp_private.actor()).staff_id);

CREATE FUNCTION erp_private.tax_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c erp_private.tax_cases;prev erp_private.tax_computation_snapshots;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.case_id::text||':snapshot',0));
 SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
 IF c.case_id IS NULL OR c.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'The snapshot must belong to this tax case and its engagement' USING ERRCODE='23514'; END IF;
 NEW.client_id:=(SELECT client_id FROM erp_private.projects WHERE project_id=c.project_id);
 NEW.snapshot_no:=COALESCE((SELECT max(snapshot_no) FROM erp_private.tax_computation_snapshots WHERE case_id=NEW.case_id),0)+1;
 SELECT * INTO prev FROM erp_private.tax_computation_snapshots WHERE case_id=NEW.case_id ORDER BY snapshot_no DESC LIMIT 1;
 IF NEW.stage='SUBMITTED' AND c.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'A submission snapshot is taken from a draft or returned return' USING ERRCODE='23514'; END IF;
 IF NEW.stage='LOCKED' THEN
  IF c.status<>'Submitted' THEN RAISE EXCEPTION 'A lock snapshot is taken from a submitted return' USING ERRCODE='23514'; END IF;
  IF prev.snapshot_id IS NULL OR prev.stage<>'SUBMITTED' THEN RAISE EXCEPTION 'Submit the return, with its snapshot, before locking it' USING ERRCODE='23514'; END IF;
  IF prev.source_hash<>NEW.source_hash THEN RAISE EXCEPTION 'The source rows changed after this return was submitted. Return it to the preparer and submit it again' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_snapshot_guard BEFORE INSERT ON erp_private.tax_computation_snapshots FOR EACH ROW EXECUTE FUNCTION erp_private.tax_snapshot_guard();
CREATE TRIGGER tax_snapshot_immutable BEFORE UPDATE OR DELETE ON erp_private.tax_computation_snapshots FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER tax_snapshot_audit AFTER INSERT ON erp_private.tax_computation_snapshots FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('snapshot_id');

-- (A snapshot only counts if it was taken after the case was last changed, so a returned and edited case needs a fresh one.)
CREATE FUNCTION erp_private.tax_snapshot_case_gate() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE want text;
BEGIN
 IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN('Submitted','Locked') THEN
  want:=CASE WHEN NEW.status='Submitted' THEN 'SUBMITTED' ELSE 'LOCKED' END;
  IF NOT EXISTS(SELECT 1 FROM erp_private.tax_computation_snapshots x WHERE x.case_id=NEW.case_id AND x.stage=want AND x.taken_at>=OLD.updated_at AND x.snapshot_no=(SELECT max(snapshot_no) FROM erp_private.tax_computation_snapshots y WHERE y.case_id=NEW.case_id)) THEN
   RAISE EXCEPTION 'Record the computation snapshot when a return is %', lower(NEW.status) USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_snapshot_gate BEFORE UPDATE OF status ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_snapshot_case_gate();

-- A return whose rates or rules the Tax Lead has not confirmed cannot be recorded as filed.
CREATE OR REPLACE FUNCTION erp_private.tax_filing_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c erp_private.tax_cases;v_actor uuid;v_cat text;d erp_private.documents;v_today date;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
 IF NEW.legacy THEN
  IF v_actor IS NOT NULL THEN RAISE EXCEPTION 'Legacy filing records are created only by the migration' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF c.case_id IS NULL OR c.project_id IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'The filing must belong to this tax case and its engagement' USING ERRCODE='23514'; END IF;
 IF c.status<>'Locked' THEN RAISE EXCEPTION 'Only an independently reviewed, locked tax case can be recorded as filed' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.tax_computation_snapshots x WHERE x.case_id=c.case_id AND x.stage='LOCKED' AND x.rules_status='UNCONFIRMED') THEN RAISE EXCEPTION 'The rates and rules in this return are not confirmed by the Tax Lead, so it cannot be recorded as filed' USING ERRCODE='23514'; END IF;
 NEW.client_id:=(SELECT client_id FROM erp_private.projects WHERE project_id=c.project_id);NEW.kind:=c.kind;NEW.starts_on:=c.starts_on;NEW.ends_on:=c.ends_on;NEW.prepared_by:=c.prepared_by;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 IF NEW.filed_on>v_today OR NEW.filed_on<c.ends_on THEN RAISE EXCEPTION 'Check the actual filing date against the return period' USING ERRCODE='23514'; END IF;
 IF NEW.acknowledgement_status='ACKNOWLEDGEMENT_RECEIVED' THEN
  SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.acknowledgement_document_id AND project_id=NEW.project_id AND deleted_at IS NULL;
  IF d.document_id IS NULL OR d.mime_type<>'application/pdf' THEN RAISE EXCEPTION 'Attach the KRA acknowledgment as PDF evidence for this engagement' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.acknowledgement_document_id IS NOT NULL THEN RAISE EXCEPTION 'An exception is recorded instead of an acknowledgment document' USING ERRCODE='23514'; END IF;
  IF v_cat NOT IN('PARTNER','MANAGER') OR NEW.exception_approved_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'Only the signed-in Manager or Partner approving the exception can record it' USING ERRCODE='42501'; END IF;
  IF v_actor IN(c.prepared_by,c.reviewed_by) THEN RAISE EXCEPTION 'A Manager or Partner who did not prepare or review this return must approve the exception' USING ERRCODE='42501'; END IF;
  NEW.exception_approved_at:=now();
 END IF;
 RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION erp_private.tax_snapshot_guard(),erp_private.tax_snapshot_case_gate() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_snapshot_guard(),erp_private.tax_snapshot_case_gate() TO erp_api;
