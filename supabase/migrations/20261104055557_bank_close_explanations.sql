-- Reviewed explanations for bank-close differences (bank close follow-up).
-- A preparer records why statement movement and posted bank movement differ (for example a timing
-- difference), with evidence. A different Manager or Partner accepts or returns it. The close check
-- treats the difference as explained only while an accepted explanation matches the current
-- difference to the cent; any change in the difference blocks the close again.
CREATE TABLE erp_private.bank_close_explanations(
 explanation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 check_code text NOT NULL CHECK(check_code IN('STATEMENT_TO_LEDGER')),
 as_of date NOT NULL,
 difference_cents bigint NOT NULL CHECK(difference_cents<>0),
 explanation text NOT NULL CHECK(length(btrim(explanation))>=20),
 evidence_reference text NOT NULL CHECK(length(btrim(evidence_reference))>=3),
 status text NOT NULL DEFAULT 'Submitted' CHECK(status IN('Submitted','Accepted','Returned','Withdrawn')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status NOT IN('Accepted','Returned') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>prepared_by))
);
CREATE INDEX bank_close_explanations_period_idx ON erp_private.bank_close_explanations(period_id,check_code,status);
CREATE INDEX bank_close_explanations_project_idx ON erp_private.bank_close_explanations(project_id);
CREATE INDEX bank_close_explanations_prepared_by_idx ON erp_private.bank_close_explanations(prepared_by);
CREATE INDEX bank_close_explanations_reviewed_by_idx ON erp_private.bank_close_explanations(reviewed_by);

ALTER TABLE erp_private.bank_close_explanations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bank_close_explanations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.bank_close_explanations TO erp_api;
CREATE POLICY bank_close_explanations_read ON erp_private.bank_close_explanations FOR SELECT TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY bank_close_explanations_insert ON erp_private.bank_close_explanations FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND prepared_by=(erp_private.actor()).staff_id AND status='Submitted');
CREATE POLICY bank_close_explanations_update ON erp_private.bank_close_explanations FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.project_allowed(project_id));

CREATE OR REPLACE FUNCTION erp_private.bank_close_explanation_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF (NEW.project_id,NEW.period_id,NEW.check_code,NEW.as_of,NEW.difference_cents,NEW.explanation,NEW.evidence_reference,NEW.prepared_by)
    IS DISTINCT FROM (OLD.project_id,OLD.period_id,OLD.check_code,OLD.as_of,OLD.difference_cents,OLD.explanation,OLD.evidence_reference,OLD.prepared_by) THEN
  RAISE EXCEPTION 'A recorded explanation cannot be edited; record a new one' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'Submitted' THEN RAISE EXCEPTION 'Only a submitted explanation can change status' USING ERRCODE='23514'; END IF;
 IF NEW.status IN('Accepted','Returned') AND current_user='erp_api' AND (a.category_code NOT IN('PARTNER','MANAGER') OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN
  RAISE EXCEPTION 'A different Manager or Partner must review this explanation' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.bank_close_explanation_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.bank_close_explanation_guard() TO erp_api;
CREATE TRIGGER bank_close_explanation_guard BEFORE UPDATE ON erp_private.bank_close_explanations FOR EACH ROW EXECUTE FUNCTION erp_private.bank_close_explanation_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.bank_close_explanations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.bank_close_explanations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('explanation_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.bank_close_explanations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
