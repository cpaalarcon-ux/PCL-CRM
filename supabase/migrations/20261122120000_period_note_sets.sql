-- Build 2873: the notes to the annual statements, prepared and approved as a set.
-- A Manager or Partner prepares the notes: the ledger builds them from the posted trial balance and the approved statement-line map, and the set is stored with a digest of every
-- figure in it. A Partner approves it (a different Partner from the preparer, unless the firm has only one Partner, which is recorded). The annual statements cannot be final while the
-- approved set no longer matches the figures. A change is a new version; versions and their snapshots are never edited or deleted. No tax rate is stored.
CREATE TABLE erp_private.period_note_sets(
 set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 version integer NOT NULL CHECK(version>=1),
 as_of date NOT NULL,
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 note_count integer NOT NULL CHECK(note_count>=1),
 calculation_version text NOT NULL CHECK(char_length(btrim(calculation_version)) BETWEEN 3 AND 60),
 snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,version),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX period_note_one_draft ON erp_private.period_note_sets(period_id) WHERE status='Draft';
CREATE UNIQUE INDEX period_note_one_approved ON erp_private.period_note_sets(period_id) WHERE status='Approved';
CREATE INDEX period_note_sets_project_idx ON erp_private.period_note_sets(project_id);
CREATE INDEX period_note_sets_client_idx ON erp_private.period_note_sets(client_id);
CREATE INDEX period_note_sets_prepared_idx ON erp_private.period_note_sets(prepared_by);
CREATE INDEX period_note_sets_reviewed_idx ON erp_private.period_note_sets(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_note_sets IS 'Notes to the annual statements for one ledger year, prepared from the ledger and approved by a Partner. The digest ties the approval to the figures.';
ALTER TABLE erp_private.period_note_sets ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_note_sets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_note_sets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_note_sets TO erp_api;
CREATE POLICY note_sets_read ON erp_private.period_note_sets FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY note_sets_add ON erp_private.period_note_sets FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY note_sets_update ON erp_private.period_note_sets FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_note_sets FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_note_sets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('set_id');

CREATE FUNCTION erp_private.period_note_set_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The notes must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its notes can no longer be changed.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_note_sets WHERE period_id=NEW.period_id),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.set_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.version,NEW.as_of,NEW.digest,NEW.note_count,NEW.calculation_version,NEW.snapshot,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.set_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.version,OLD.as_of,OLD.digest,OLD.note_count,OLD.calculation_version,OLD.snapshot,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'Notes cannot be edited. Prepare a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat<>'PARTNER' OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Partner must review the notes.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.prepared_by THEN
     IF NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A different Partner approves notes you prepared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they prepared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the notes.' USING ERRCODE='23514'; END IF;
   SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=OLD.period_id;
   IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved notes can only be superseded by newer approved notes.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'These notes are closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_note_set_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER note_set_guard BEFORE INSERT OR UPDATE ON erp_private.period_note_sets FOR EACH ROW EXECUTE FUNCTION erp_private.period_note_set_guard();
