-- Build 2886: the supporting schedules behind the notes of the annual pack.
-- period_support_schedules: for one ledger year and one kind of schedule (stock, receivables, payables, bank, loans, tax, payroll, equity), the lines that say what is inside each account of the note,
-- the source that supports them, and the Manager or Partner who approved them. A schedule is declared by staff and approved by someone who did not declare it (a sole Partner may approve their own,
-- and it is recorded). Approved rows are never edited, only superseded by a newer approved one; a year locked by an audit or a closed year cannot change. The tie-out to the trial balance is worked
-- out when the notes are built, so a stored schedule can never claim to agree. Nothing here posts a journal, stores a tax rate or changes a figure in the ledger.

CREATE TABLE erp_private.period_support_schedules(
 schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 kind text NOT NULL CHECK(kind IN('STOCK','RECEIVABLES','PAYABLES','BANK','LOANS','TAX','PAYROLL','EQUITY')),
 version integer NOT NULL CHECK(version>=1),
 evidence text NOT NULL CHECK(char_length(btrim(evidence)) BETWEEN 10 AND 500),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 1 AND 200 AND pg_column_size(lines)<=120000),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 declared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 declared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,kind,version),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX period_support_schedules_one_draft ON erp_private.period_support_schedules(period_id,kind) WHERE status='Draft';
CREATE UNIQUE INDEX period_support_schedules_one_approved ON erp_private.period_support_schedules(period_id,kind) WHERE status='Approved';
CREATE INDEX period_support_schedules_project_idx ON erp_private.period_support_schedules(project_id);
CREATE INDEX period_support_schedules_client_idx ON erp_private.period_support_schedules(client_id);
CREATE INDEX period_support_schedules_declared_idx ON erp_private.period_support_schedules(declared_by);
CREATE INDEX period_support_schedules_reviewed_idx ON erp_private.period_support_schedules(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_support_schedules IS 'Declared supporting schedules behind the notes of the annual pack for one ledger year. Approved by someone who did not declare them; approved rows are only superseded. The tie-out to the trial balance is computed, never stored.';
ALTER TABLE erp_private.period_support_schedules ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_support_schedules FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_support_schedules FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_support_schedules TO erp_api;
CREATE POLICY period_support_schedules_read ON erp_private.period_support_schedules FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_support_schedules_add ON erp_private.period_support_schedules FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND declared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY period_support_schedules_update ON erp_private.period_support_schedules FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_support_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_support_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('schedule_id');

CREATE FUNCTION erp_private.period_support_schedule_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit, so its schedules cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its schedules can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The schedule must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_support_schedules d WHERE d.period_id=NEW.period_id AND d.kind=NEW.kind),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.schedule_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.kind,NEW.version,NEW.evidence,NEW.lines,NEW.declared_by,NEW.declared_at)
    IS DISTINCT FROM (OLD.schedule_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.kind,OLD.version,OLD.evidence,OLD.lines,OLD.declared_by,OLD.declared_at) THEN
  RAISE EXCEPTION 'A schedule cannot be edited. Declare it again as a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the schedule.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.declared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves a schedule you declared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they declared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the schedule.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'An approved schedule can only be superseded by a newer approved one.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This schedule is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_support_schedule_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_support_schedule_guard BEFORE INSERT OR UPDATE ON erp_private.period_support_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.period_support_schedule_guard();
