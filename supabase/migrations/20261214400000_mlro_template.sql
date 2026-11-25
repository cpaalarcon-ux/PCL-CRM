-- MLRO onboarding template (client onboarding batch form v3.1).
-- 1. Each owner records whether the identity document was sighted, when and by whom. No identity-document number is needed: the form never collects one.
-- 2. A batch record holds what the MLRO did for the whole batch (the checks, the evidence reference, the review dates, the signed confirmation),
--    and one row per client with the staged non-identity answers and the MLRO's rating and condition. Only a user holding the MLRO right writes the MLRO part,
--    and never on a batch they uploaded themselves. The client decision itself is still made through the existing AML decision, which has its own rules.
ALTER TABLE erp_private.beneficial_owners
 ADD COLUMN identity_sighted boolean,
 ADD COLUMN identity_sighted_on date,
 ADD COLUMN identity_sighted_by text,
 ADD CONSTRAINT beneficial_owners_sighting_check CHECK(identity_sighted IS NOT TRUE OR (identity_sighted_on IS NOT NULL AND length(btrim(COALESCE(identity_sighted_by,'')))>=2));

CREATE TABLE erp_private.onboarding_batches(
 batch_ref text PRIMARY KEY CHECK(batch_ref ~ '^OB-[0-9]{8}-[A-Z0-9]{4}$'),
 firm_id uuid REFERENCES erp_private.firms(firm_id),
 file_name text NOT NULL,
 client_count integer NOT NULL CHECK(client_count BETWEEN 1 AND 30),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id),
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'Staged' CHECK(status IN('Staged','Checks complete','Confirmed')),
 checks jsonb NOT NULL DEFAULT '{}'::jsonb,
 exposure_instruction_on date,
 evidence_reference text,
 uncovered_clients text,
 staff_register_checked_on date,
 conditions_cleared boolean,
 mlro_staff_id uuid REFERENCES erp_private.staff_members(staff_id),
 mlro_name text,
 decision_date date,
 next_screening_due date,
 full_review_due date,
 checks_saved_at timestamptz,
 signed_doc_ref text,
 signed_document_id uuid REFERENCES erp_private.documents(document_id),
 signed_by uuid REFERENCES erp_private.staff_members(staff_id),
 signed_at timestamptz,
 CHECK(next_screening_due IS NULL OR decision_date IS NULL OR next_screening_due>decision_date),
 CHECK(full_review_due IS NULL OR next_screening_due IS NULL OR full_review_due>next_screening_due),
 CHECK(status<>'Confirmed' OR signed_document_id IS NOT NULL)
);
CREATE INDEX onboarding_batches_created_by ON erp_private.onboarding_batches(created_by);
CREATE INDEX onboarding_batches_firm ON erp_private.onboarding_batches(firm_id);
CREATE INDEX onboarding_batches_mlro ON erp_private.onboarding_batches(mlro_staff_id);
CREATE INDEX onboarding_batches_signed_doc ON erp_private.onboarding_batches(signed_document_id);
CREATE INDEX onboarding_batches_signed_by ON erp_private.onboarding_batches(signed_by);

CREATE TABLE erp_private.onboarding_batch_clients(
 batch_ref text NOT NULL REFERENCES erp_private.onboarding_batches(batch_ref),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
 row_no integer NOT NULL,
 kra_pin text NOT NULL,
 answers jsonb NOT NULL DEFAULT '{}'::jsonb,
 risk_rating text CHECK(risk_rating IN('Low','Medium','High')),
 condition_text text CHECK(condition_text IS NULL OR length(condition_text)<=1000),
 rated_by uuid REFERENCES erp_private.staff_members(staff_id),
 rated_at timestamptz,
 PRIMARY KEY(batch_ref,client_id),
 CHECK((risk_rating IS NULL)=(rated_by IS NULL))
);
CREATE INDEX onboarding_batch_clients_client ON erp_private.onboarding_batch_clients(client_id);
CREATE INDEX onboarding_batch_clients_rated_by ON erp_private.onboarding_batch_clients(rated_by);

-- Who may write the MLRO part: the MLRO right, and never the person who uploaded the batch.
CREATE FUNCTION erp_private.onboarding_mlro_may_write(p_batch text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT erp_private.is_mlro() AND EXISTS(SELECT 1 FROM erp_private.onboarding_batches b WHERE b.batch_ref=p_batch AND b.created_by IS DISTINCT FROM (erp_private.actor()).staff_id)
$$;
REVOKE ALL ON FUNCTION erp_private.onboarding_mlro_may_write(text) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.onboarding_mlro_may_write(text) TO erp_api;

ALTER TABLE erp_private.onboarding_batches ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.onboarding_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.onboarding_batch_clients ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.onboarding_batch_clients FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_batches_read ON erp_private.onboarding_batches FOR SELECT TO erp_api USING(erp_private.is_leader() OR erp_private.is_mlro() OR created_by=(erp_private.actor()).staff_id);
CREATE POLICY onboarding_batches_add ON erp_private.onboarding_batches FOR INSERT TO erp_api WITH CHECK(created_by=(erp_private.actor()).staff_id AND status='Staged' AND checks='{}'::jsonb AND mlro_staff_id IS NULL AND signed_document_id IS NULL);
CREATE POLICY onboarding_batches_mlro ON erp_private.onboarding_batches FOR UPDATE TO erp_api USING(erp_private.onboarding_mlro_may_write(batch_ref)) WITH CHECK(erp_private.onboarding_mlro_may_write(batch_ref));
CREATE POLICY onboarding_batch_clients_read ON erp_private.onboarding_batch_clients FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.onboarding_batches b WHERE b.batch_ref=onboarding_batch_clients.batch_ref));
CREATE POLICY onboarding_batch_clients_add ON erp_private.onboarding_batch_clients FOR INSERT TO erp_api WITH CHECK(risk_rating IS NULL AND rated_by IS NULL AND EXISTS(SELECT 1 FROM erp_private.onboarding_batches b WHERE b.batch_ref=onboarding_batch_clients.batch_ref AND b.created_by=(erp_private.actor()).staff_id));
CREATE POLICY onboarding_batch_clients_rate ON erp_private.onboarding_batch_clients FOR UPDATE TO erp_api USING(erp_private.onboarding_mlro_may_write(batch_ref)) WITH CHECK(erp_private.onboarding_mlro_may_write(batch_ref));
GRANT SELECT,INSERT,UPDATE ON erp_private.onboarding_batches,erp_private.onboarding_batch_clients TO erp_api;

-- The MLRO changes the checks and ratings only: what the preparer uploaded stays as uploaded.
CREATE FUNCTION erp_private.onboarding_batches_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 IF ROW(NEW.batch_ref,NEW.firm_id,NEW.file_name,NEW.client_count,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.batch_ref,OLD.firm_id,OLD.file_name,OLD.client_count,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'The uploaded batch details cannot be changed.' USING ERRCODE='42501'; END IF;
 IF NEW.mlro_staff_id IS NOT NULL AND NEW.mlro_staff_id IS DISTINCT FROM (erp_private.actor()).staff_id AND ROW(NEW.checks,NEW.evidence_reference,NEW.decision_date)IS DISTINCT FROM ROW(OLD.checks,OLD.evidence_reference,OLD.decision_date) THEN
  RAISE EXCEPTION 'The checks are recorded under your own name.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Confirmed' THEN RAISE EXCEPTION 'A confirmed batch is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER onboarding_batches_guard BEFORE UPDATE ON erp_private.onboarding_batches FOR EACH ROW EXECUTE FUNCTION erp_private.onboarding_batches_guard();
CREATE FUNCTION erp_private.onboarding_batch_clients_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 IF ROW(NEW.batch_ref,NEW.client_id,NEW.row_no,NEW.kra_pin,NEW.answers) IS DISTINCT FROM ROW(OLD.batch_ref,OLD.client_id,OLD.row_no,OLD.kra_pin,OLD.answers) THEN
  RAISE EXCEPTION 'The uploaded client answers cannot be changed.' USING ERRCODE='42501'; END IF;
 IF NEW.risk_rating IS NOT NULL AND NEW.rated_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The rating is recorded under your own name.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.onboarding_batches b WHERE b.batch_ref=NEW.batch_ref AND b.status='Confirmed') THEN RAISE EXCEPTION 'A confirmed batch is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER onboarding_batch_clients_guard BEFORE UPDATE ON erp_private.onboarding_batch_clients FOR EACH ROW EXECUTE FUNCTION erp_private.onboarding_batch_clients_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.onboarding_batches FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.onboarding_batch_clients FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.onboarding_batches FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('batch_ref');
