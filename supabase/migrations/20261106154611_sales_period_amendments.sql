-- Amending a confirmed sales period. A confirmed summary is never edited. An amendment asks for permission, and each step needs a different person:
--   1. anyone who prepares work requests the amendment with a reason (Requested);
--   2. a different Manager or Partner approves or rejects it (Approved / Rejected);
--   3. a Manager or Partner prepares draft reversals of the posted entries built from the summary (Reversing);
--   4. a different Manager or Partner reviews and posts each reversal in the normal journal flow (Ready);
--   5. either a corrected summary is saved and independently confirmed (Replace) or the old one is withdrawn (Withdraw), then Complete.
-- Rows are never deleted and the reason, requester and original totals are fixed once recorded.
CREATE TABLE erp_private.import_amendments(
 amendment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects(project_id),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
 import_id uuid NOT NULL REFERENCES erp_private.period_imports(import_id),
 kind text NOT NULL CHECK(kind IN('Sales')),
 outcome text NOT NULL CHECK(outcome IN('Replace','Withdraw')),
 reason_type text NOT NULL CHECK(reason_type IN('Wrong month','Wrong amounts','Wrong file','Wrong client','Other')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 status text NOT NULL DEFAULT 'Requested' CHECK(status IN('Requested','Approved','Rejected','Reversing','Ready','Replacement saved','Complete','Cancelled')),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 original_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 decided_at timestamptz,
 decision_note text,
 prepared_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 prepared_at timestamptz,
 reversals jsonb NOT NULL DEFAULT '[]'::jsonb,
 replacement_import_id uuid REFERENCES erp_private.period_imports(import_id),
 completed_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 completed_at timestamptz,
 revision integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on>=starts_on),
 CHECK(status IN('Requested','Cancelled') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND length(btrim(coalesce(decision_note,'')))>=10)),
 CHECK(decided_by IS NULL OR decided_by<>requested_by),
 CHECK(status NOT IN('Complete') OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX import_amendments_one_live ON erp_private.import_amendments(import_id) WHERE status NOT IN('Rejected','Cancelled','Complete');
CREATE INDEX import_amendments_project_idx ON erp_private.import_amendments(project_id,starts_on,ends_on);
CREATE INDEX import_amendments_client_idx ON erp_private.import_amendments(client_id);
CREATE INDEX import_amendments_requested_idx ON erp_private.import_amendments(requested_by);
CREATE INDEX import_amendments_decided_idx ON erp_private.import_amendments(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX import_amendments_prepared_idx ON erp_private.import_amendments(prepared_by) WHERE prepared_by IS NOT NULL;
CREATE INDEX import_amendments_completed_idx ON erp_private.import_amendments(completed_by) WHERE completed_by IS NOT NULL;
CREATE INDEX import_amendments_replacement_idx ON erp_private.import_amendments(replacement_import_id) WHERE replacement_import_id IS NOT NULL;

CREATE FUNCTION erp_private.import_amendment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=erp_private,pg_temp AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Requested' OR (current_user='erp_api' AND (NEW.requested_by IS DISTINCT FROM a.staff_id OR a.category_code='INTERN')) THEN
   RAISE EXCEPTION 'Request an amendment as an assigned preparer.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.period_imports i WHERE i.import_id=NEW.import_id AND i.project_id=NEW.project_id AND i.client_id=NEW.client_id AND i.status='Confirmed' AND i.kind=NEW.kind) THEN
   RAISE EXCEPTION 'Only a confirmed summary of this project can be amended.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN('Rejected','Cancelled','Complete') THEN RAISE EXCEPTION 'A finished amendment cannot be changed.' USING ERRCODE='42501'; END IF;
 IF (NEW.project_id,NEW.client_id,NEW.import_id,NEW.kind,NEW.outcome,NEW.reason_type,NEW.reason,NEW.starts_on,NEW.ends_on,NEW.original_totals,NEW.requested_by,NEW.requested_at)
   IS DISTINCT FROM (OLD.project_id,OLD.client_id,OLD.import_id,OLD.kind,OLD.outcome,OLD.reason_type,OLD.reason,OLD.starts_on,OLD.ends_on,OLD.original_totals,OLD.requested_by,OLD.requested_at) THEN
  RAISE EXCEPTION 'The request, reason and original totals of an amendment cannot change.' USING ERRCODE='42501';
 END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NOT ((OLD.status,NEW.status) IN(('Requested','Approved'),('Requested','Rejected'),('Requested','Cancelled'),('Approved','Cancelled'),('Approved','Reversing'),('Approved','Ready'),
     ('Reversing','Ready'),('Ready','Replacement saved'),('Ready','Complete'),('Replacement saved','Ready'),('Replacement saved','Complete'))) THEN
   RAISE EXCEPTION 'That amendment step is not allowed from %.',OLD.status USING ERRCODE='23514';
  END IF;
  IF current_user='erp_api' THEN
   IF NEW.status IN('Approved','Rejected') AND (a.category_code NOT IN('PARTNER','MANAGER') OR a.staff_id=OLD.requested_by OR NEW.decided_by IS DISTINCT FROM a.staff_id) THEN
    RAISE EXCEPTION 'A different Manager or Partner must decide this amendment.' USING ERRCODE='42501';
   END IF;
   IF NEW.status IN('Reversing') OR (OLD.status='Approved' AND NEW.status='Ready') THEN
    IF a.category_code NOT IN('PARTNER','MANAGER') OR NEW.prepared_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'A Manager or Partner prepares the reversals.' USING ERRCODE='42501'; END IF;
   END IF;
   IF NEW.status='Complete' AND (a.category_code NOT IN('PARTNER','MANAGER') AND OLD.status<>'Replacement saved' OR NEW.completed_by IS NULL) THEN
    RAISE EXCEPTION 'A Manager or Partner completes the amendment.' USING ERRCODE='42501';
   END IF;
   IF NEW.status='Cancelled' AND a.staff_id IS DISTINCT FROM OLD.requested_by AND a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only the requester, a Manager or a Partner can cancel.' USING ERRCODE='42501'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_amendment_guard BEFORE INSERT OR UPDATE ON erp_private.import_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.import_amendment_guard();
CREATE TRIGGER import_amendment_revision BEFORE UPDATE ON erp_private.import_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER import_amendments_audit AFTER INSERT OR UPDATE ON erp_private.import_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('amendment_id');
CREATE TRIGGER import_amendments_no_delete BEFORE DELETE ON erp_private.import_amendments FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

ALTER TABLE erp_private.import_amendments ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.import_amendments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.import_amendments FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON erp_private.import_amendments TO erp_api;
CREATE POLICY import_amendments_read ON erp_private.import_amendments FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY import_amendments_add ON erp_private.import_amendments FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND requested_by=(erp_private.actor()).staff_id);
CREATE POLICY import_amendments_change ON erp_private.import_amendments FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
REVOKE ALL ON FUNCTION erp_private.import_amendment_guard() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.import_amendment_guard() TO erp_api;
