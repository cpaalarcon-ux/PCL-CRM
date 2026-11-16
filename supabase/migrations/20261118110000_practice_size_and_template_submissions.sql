-- Build 2843: practice size and service categories in bulk.
-- 1. firm_practice_declarations: a Partner declares how many practitioners the firm has. It is an insert-only history. One practitioner means the Partner may put forward and approve
--    firm-wide set-up records (such as service templates) alone, recorded as a sole-Partner approval. Two or more means the usual rule: one person puts a record forward (a Manager or a
--    Partner) and a different Partner or Manager approves it. The declaration can only tighten the existing rule: it never makes someone the sole Partner when another active Partner has
--    access to the firm (the database refuses a declaration of 1 in that case, and sole_active_partner() still checks the real Partners).
-- 2. service_template_submissions: who put a Draft service template forward for approval. Starter templates have no proposer and service_templates are never edited, so this is a
--    separate insert-only record. The person who put a template forward cannot approve it, unless they are the only practitioner.
CREATE TABLE erp_private.firm_practice_declarations(
 declaration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 firm_id uuid NOT NULL REFERENCES erp_private.firms ON DELETE RESTRICT,
 practitioners integer NOT NULL CHECK(practitioners BETWEEN 1 AND 500),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 declared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 declared_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX firm_practice_declarations_firm_idx ON erp_private.firm_practice_declarations(firm_id,declared_at DESC);
CREATE INDEX firm_practice_declarations_by_idx ON erp_private.firm_practice_declarations(declared_by);
CREATE TABLE erp_private.service_template_submissions(
 submission_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 template_id uuid NOT NULL UNIQUE REFERENCES erp_private.service_templates ON DELETE RESTRICT,
 submitted_by uuid NOT NULL REFERENCES erp_private.staff_members,
 submitted_at timestamptz NOT NULL DEFAULT now(),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500)
);
CREATE INDEX service_template_submissions_by_idx ON erp_private.service_template_submissions(submitted_by);
ALTER TABLE erp_private.firm_practice_declarations ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.firm_practice_declarations FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_template_submissions ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.service_template_submissions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.firm_practice_declarations TO erp_api;
GRANT SELECT,INSERT ON erp_private.service_template_submissions TO erp_api;
CREATE POLICY fpd_read ON erp_private.firm_practice_declarations FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND erp_private.firm_allowed(firm_id));
CREATE POLICY fpd_insert ON erp_private.firm_practice_declarations FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND declared_by=(erp_private.actor()).staff_id AND erp_private.firm_allowed(firm_id));
CREATE POLICY sts_read ON erp_private.service_template_submissions FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY sts_insert ON erp_private.service_template_submissions FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND submitted_by=(erp_private.actor()).staff_id);
-- Staff rows are visible only to the person and seniors, so the count of active Partners for a firm is read by a function, for Partners and Managers only.
CREATE FUNCTION erp_private.firm_active_partners(p_firm uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND erp_private.firm_allowed(p_firm) THEN
  (SELECT count(DISTINCT m.staff_id)::int FROM erp_private.staff_firm_access f JOIN erp_private.staff_members m ON m.staff_id=f.staff_id
   WHERE f.firm_id=p_firm AND f.deleted_at IS NULL AND m.category_code='PARTNER' AND m.access_status='Active' AND m.deleted_at IS NULL) END
$$;
REVOKE ALL ON FUNCTION erp_private.firm_active_partners(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION erp_private.firm_active_partners(uuid) TO erp_api;
CREATE FUNCTION erp_private.firm_practice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.firm_id=NEW.firm_id AND f.staff_id=(erp_private.actor()).staff_id AND f.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'Only a Partner of this firm declares its number of practitioners.' USING ERRCODE='42501'; END IF;
 n:=erp_private.firm_active_partners(NEW.firm_id);
 IF NEW.practitioners<n THEN RAISE EXCEPTION 'The firm has % active Partners with access, so it cannot declare fewer practitioners. End the other Partners'' access first.',n USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER guard BEFORE INSERT ON erp_private.firm_practice_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.firm_practice_guard();
CREATE FUNCTION erp_private.service_submission_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.service_templates t WHERE t.template_id=NEW.template_id AND t.status='Draft') THEN
  RAISE EXCEPTION 'Only a draft service template is put forward for approval.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER guard BEFORE INSERT ON erp_private.service_template_submissions FOR EACH ROW EXECUTE FUNCTION erp_private.service_submission_guard();
CREATE FUNCTION erp_private.practice_records_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'This record is part of the audit trail and cannot be changed or removed.' USING ERRCODE='42501'; END;$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.firm_practice_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.practice_records_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.service_template_submissions FOR EACH ROW EXECUTE FUNCTION erp_private.practice_records_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.firm_practice_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('declaration_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.service_template_submissions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('submission_id');
-- Whoever put a template forward does not approve it, unless they are the only practitioner (checked in the database as well as in the action).
CREATE FUNCTION erp_private.service_templates_submitter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status='Draft' AND NEW.status='Approved' AND current_user='erp_api'
  AND EXISTS(SELECT 1 FROM erp_private.service_template_submissions s WHERE s.template_id=NEW.template_id AND s.submitted_by=(erp_private.actor()).staff_id)
  AND NOT ((erp_private.actor()).category_code='PARTNER' AND erp_private.sole_active_partner()) THEN
  RAISE EXCEPTION 'A different Partner or Manager approves a template you put forward, unless you are your firm''s only practitioner.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER submitter_guard BEFORE UPDATE ON erp_private.service_templates FOR EACH ROW EXECUTE FUNCTION erp_private.service_templates_submitter_guard();
-- The "only Partner" test now also honours a declaration of two or more practitioners: if the latest declaration for one of the actor's firms says more than one, the actor is not sole.
CREATE OR REPLACE FUNCTION erp_private.sole_active_partner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).category_code='PARTNER'
  AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=(erp_private.actor()).staff_id AND f.deleted_at IS NULL)
  AND NOT EXISTS(
   SELECT 1 FROM erp_private.staff_firm_access mine
   JOIN erp_private.staff_firm_access other ON other.firm_id=mine.firm_id AND other.deleted_at IS NULL AND other.staff_id<>mine.staff_id
   JOIN erp_private.staff_members m ON m.staff_id=other.staff_id AND m.category_code='PARTNER' AND m.access_status='Active' AND m.deleted_at IS NULL
   WHERE mine.staff_id=(erp_private.actor()).staff_id AND mine.deleted_at IS NULL)
  AND NOT EXISTS(
   SELECT 1 FROM erp_private.staff_firm_access mine
   JOIN LATERAL(SELECT d.practitioners FROM erp_private.firm_practice_declarations d WHERE d.firm_id=mine.firm_id ORDER BY d.declared_at DESC,d.declaration_id DESC LIMIT 1) l ON true
   WHERE mine.staff_id=(erp_private.actor()).staff_id AND mine.deleted_at IS NULL AND l.practitioners>1)
$$;
