-- Build 2819: payroll register lifecycle. A person is Active, Inactive for a period (and can return to Active), or Separated.
-- Inactive periods are recorded with a reason and are ended by a return, never edited. A separation is requested with an effective date and a reason and takes effect only
-- when a different Manager or Partner approves it; the person's record and every past payroll stay. Nothing is deleted.
CREATE TABLE erp_private.client_payroll_status_changes(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 person_id uuid NOT NULL REFERENCES erp_private.client_payroll_people ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('Inactive','Separation')),
 starts_on date NOT NULL,
 ends_on date,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 status text NOT NULL CHECK(status IN('In force','Returned','Requested','Approved','Rejected','Withdrawn')),
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES erp_private.staff_members,decided_at timestamptz,decision_note text CHECK(decision_note IS NULL OR char_length(decision_note)<=500),
 returned_on date,returned_by uuid REFERENCES erp_private.staff_members,returned_at timestamptz,returned_reason text CHECK(returned_reason IS NULL OR char_length(btrim(returned_reason)) BETWEEN 10 AND 500),
 revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_on IS NULL OR ends_on>=starts_on),
 CHECK(kind<>'Inactive' OR status IN('In force','Returned')),
 CHECK(kind<>'Separation' OR (status IN('Requested','Approved','Rejected','Withdrawn') AND ends_on IS NULL)),
 CHECK(status<>'Returned' OR (returned_on IS NOT NULL AND returned_by IS NOT NULL AND returned_at IS NOT NULL AND returned_on>starts_on AND returned_reason IS NOT NULL)),
 CHECK(status NOT IN('Approved','Rejected') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL AND decided_by<>requested_by)),
 CHECK(status<>'Rejected' OR char_length(btrim(coalesce(decision_note,'')))>=5)
);
CREATE INDEX client_payroll_status_changes_person_idx ON erp_private.client_payroll_status_changes(person_id,kind,status);
CREATE INDEX client_payroll_status_changes_client_idx ON erp_private.client_payroll_status_changes(client_id,status);
CREATE INDEX client_payroll_status_changes_requested_by_idx ON erp_private.client_payroll_status_changes(requested_by);
CREATE INDEX client_payroll_status_changes_decided_by_idx ON erp_private.client_payroll_status_changes(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX client_payroll_status_changes_returned_by_idx ON erp_private.client_payroll_status_changes(returned_by) WHERE returned_by IS NOT NULL;
CREATE UNIQUE INDEX client_payroll_open_separation_uidx ON erp_private.client_payroll_status_changes(person_id) WHERE kind='Separation' AND status IN('Requested','Approved');
ALTER TABLE erp_private.client_payroll_status_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_payroll_status_changes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_payroll_status_changes TO erp_api;
CREATE POLICY payroll_status_read ON erp_private.client_payroll_status_changes FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY payroll_status_insert ON erp_private.client_payroll_status_changes FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND requested_by=(erp_private.actor()).staff_id);
CREATE POLICY payroll_status_update ON erp_private.client_payroll_status_changes FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_payroll_status_changes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_payroll_status_changes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('change_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_payroll_status_changes FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.client_payroll_status_changes_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE who erp_private.staff_members;pr erp_private.client_payroll_people;
BEGIN
 SELECT * INTO pr FROM erp_private.client_payroll_people WHERE person_id=NEW.person_id;
 IF pr.person_id IS NULL OR pr.client_id<>NEW.client_id THEN RAISE EXCEPTION 'This change does not belong to that client.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF pr.status<>'Active' THEN RAISE EXCEPTION 'This person has already left the payroll.' USING ERRCODE='23514'; END IF;
  IF NEW.starts_on<pr.started_on THEN RAISE EXCEPTION 'A change cannot take effect before the person started.' USING ERRCODE='23514'; END IF;
  IF NEW.kind='Inactive' THEN
   IF NEW.status<>'In force' THEN RAISE EXCEPTION 'An inactive period is recorded as in force and ended by a return.' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM erp_private.client_payroll_status_changes c WHERE c.person_id=NEW.person_id AND c.kind='Inactive' AND c.status='In force'
     AND c.starts_on<=coalesce(NEW.ends_on,'infinity'::date) AND coalesce(c.ends_on,'infinity'::date)>=NEW.starts_on) THEN
    RAISE EXCEPTION 'This person is already inactive for part of that period.' USING ERRCODE='23514';
   END IF;
  ELSE
   IF NEW.status<>'Requested' THEN RAISE EXCEPTION 'A separation is requested first and approved by someone else.' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM erp_private.client_payroll_pay p WHERE p.person_id=NEW.person_id AND p.effective_from>NEW.starts_on) THEN
    RAISE EXCEPTION 'A pay change is dated after the separation date. Choose a later date.' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.person_id,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.reason,NEW.requested_by,NEW.requested_at) IS DISTINCT FROM ROW(OLD.client_id,OLD.person_id,OLD.kind,OLD.starts_on,OLD.ends_on,OLD.reason,OLD.requested_by,OLD.requested_at) THEN
  RAISE EXCEPTION 'The facts of a change are never edited. Return or reject it and record a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN('Returned','Approved','Rejected','Withdrawn') THEN RAISE EXCEPTION 'A closed change stays as it was.' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' THEN SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id; END IF;
 IF OLD.kind='Inactive' AND OLD.status='In force' AND NEW.status='Returned' THEN
  IF current_user='erp_api' AND NEW.returned_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'The return is recorded under your own name.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.kind='Separation' AND OLD.status='Requested' AND NEW.status IN('Approved','Rejected') THEN
  IF current_user='erp_api' THEN
   IF who.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner decides a separation.' USING ERRCODE='23514'; END IF;
   IF NEW.decided_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'The decision is recorded under your own name.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF OLD.kind='Separation' AND OLD.status='Requested' AND NEW.status='Withdrawn' THEN
  IF current_user='erp_api' AND OLD.requested_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'Only the person who asked withdraws a separation request.' USING ERRCODE='23514'; END IF;
 ELSE
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_payroll_status_changes_guard BEFORE INSERT OR UPDATE ON erp_private.client_payroll_status_changes FOR EACH ROW EXECUTE FUNCTION erp_private.client_payroll_status_changes_guard();

-- A person is marked as left only through an approved separation with the same date: the register can no longer be edited around the approval.
CREATE OR REPLACE FUNCTION erp_private.client_payroll_people_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Active' THEN RAISE EXCEPTION 'A person is added as active. A separation is requested and approved separately, with a reason.' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.client_id,NEW.created_by,NEW.started_on) IS DISTINCT FROM ROW(OLD.client_id,OLD.created_by,OLD.started_on) THEN
   RAISE EXCEPTION 'The client, start date and who added the person cannot be changed.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Left' THEN RAISE EXCEPTION 'A person who has left stays as recorded. If they return, add them again with a new start date.' USING ERRCODE='23514'; END IF;
  IF NEW.status='Left' THEN
   IF NOT EXISTS(SELECT 1 FROM erp_private.client_payroll_status_changes c WHERE c.person_id=NEW.person_id AND c.kind='Separation' AND c.status='Approved' AND c.starts_on=NEW.left_on) THEN
    RAISE EXCEPTION 'A person leaves the payroll only through an approved separation with the same effective date.' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM erp_private.client_payroll_pay p WHERE p.person_id=NEW.person_id AND p.effective_from>NEW.left_on) THEN
    RAISE EXCEPTION 'A pay change is dated after the leaving date. Choose a later leaving date.' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
