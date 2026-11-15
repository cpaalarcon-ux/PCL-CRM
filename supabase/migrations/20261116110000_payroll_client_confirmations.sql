-- Build 2820: client confirmation of a payroll month. A confirmation report is issued from a payroll run as a numbered version. Each version keeps a snapshot of
-- what the client was shown and its fingerprint. The client's answer (confirmed, or changes wanted) is recorded once with who answered, when, and the evidence.
-- A version is never edited; issuing a new version supersedes the old one. Nothing is deleted.
CREATE TABLE erp_private.payroll_client_confirmations(
 confirmation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 import_id uuid NOT NULL REFERENCES erp_private.period_imports ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>=1),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'Issued' CHECK(status IN('Issued','Confirmed','Changes requested','Superseded')),
 issued_by uuid NOT NULL REFERENCES erp_private.staff_members,issued_at timestamptz NOT NULL DEFAULT now(),
 responder_name text CHECK(responder_name IS NULL OR char_length(btrim(responder_name)) BETWEEN 3 AND 120),
 responded_on date,
 response_note text CHECK(response_note IS NULL OR char_length(response_note)<=1000),
 evidence_document_id uuid REFERENCES erp_private.documents,
 recorded_by uuid REFERENCES erp_private.staff_members,recorded_at timestamptz,
 superseded_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(import_id,version),
 CHECK(status NOT IN('Confirmed','Changes requested') OR (responder_name IS NOT NULL AND responded_on IS NOT NULL AND recorded_by IS NOT NULL AND recorded_at IS NOT NULL)),
 CHECK(status<>'Confirmed' OR evidence_document_id IS NOT NULL OR char_length(btrim(coalesce(response_note,'')))>=10),
 CHECK(status<>'Changes requested' OR char_length(btrim(coalesce(response_note,'')))>=10),
 CHECK(status<>'Superseded' OR superseded_at IS NOT NULL)
);
CREATE UNIQUE INDEX payroll_client_confirmations_open_uidx ON erp_private.payroll_client_confirmations(import_id) WHERE status<>'Superseded';
CREATE INDEX payroll_client_confirmations_client_idx ON erp_private.payroll_client_confirmations(client_id);
CREATE INDEX payroll_client_confirmations_project_idx ON erp_private.payroll_client_confirmations(project_id);
CREATE INDEX payroll_client_confirmations_issued_by_idx ON erp_private.payroll_client_confirmations(issued_by);
CREATE INDEX payroll_client_confirmations_recorded_by_idx ON erp_private.payroll_client_confirmations(recorded_by) WHERE recorded_by IS NOT NULL;
CREATE INDEX payroll_client_confirmations_evidence_idx ON erp_private.payroll_client_confirmations(evidence_document_id) WHERE evidence_document_id IS NOT NULL;
ALTER TABLE erp_private.payroll_client_confirmations ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.payroll_client_confirmations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.payroll_client_confirmations TO erp_api;
CREATE POLICY payroll_confirm_read ON erp_private.payroll_client_confirmations FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY payroll_confirm_insert ON erp_private.payroll_client_confirmations FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND issued_by=(erp_private.actor()).staff_id);
CREATE POLICY payroll_confirm_update ON erp_private.payroll_client_confirmations FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.payroll_client_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.payroll_client_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('confirmation_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.payroll_client_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.payroll_client_confirmations_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE imp erp_private.period_imports;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO imp FROM erp_private.period_imports WHERE import_id=NEW.import_id;
  IF imp.import_id IS NULL OR imp.kind<>'Payroll' OR imp.client_id<>NEW.client_id OR imp.project_id<>NEW.project_id THEN RAISE EXCEPTION 'A confirmation belongs to a payroll run of the same client and project.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Issued' THEN RAISE EXCEPTION 'A confirmation report is issued first; the client answer is recorded afterwards.' USING ERRCODE='23514'; END IF;
  IF imp.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'A report is issued while the payroll run is still being prepared.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.payroll_client_confirmations WHERE import_id=NEW.import_id),0)+1 THEN RAISE EXCEPTION 'Versions are numbered in order.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.project_id,NEW.import_id,NEW.version,NEW.digest,NEW.snapshot,NEW.issued_by,NEW.issued_at) IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.import_id,OLD.version,OLD.digest,OLD.snapshot,OLD.issued_by,OLD.issued_at) THEN
  RAISE EXCEPTION 'An issued report is never edited. Issue a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Superseded' THEN RAISE EXCEPTION 'A superseded version stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Issued' AND NEW.status IN('Confirmed','Changes requested') THEN
  IF current_user='erp_api' AND NEW.recorded_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The answer is recorded under your own name.' USING ERRCODE='23514'; END IF;
  IF NEW.responded_on>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The date of the answer cannot be in the future.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status='Superseded' AND OLD.status IN('Issued','Confirmed','Changes requested') THEN
  IF ROW(NEW.responder_name,NEW.responded_on,NEW.response_note,NEW.evidence_document_id,NEW.recorded_by,NEW.recorded_at) IS DISTINCT FROM ROW(OLD.responder_name,OLD.responded_on,OLD.response_note,OLD.evidence_document_id,OLD.recorded_by,OLD.recorded_at) THEN RAISE EXCEPTION 'The recorded answer stays as it was.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payroll_client_confirmations_guard BEFORE INSERT OR UPDATE ON erp_private.payroll_client_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.payroll_client_confirmations_guard();
