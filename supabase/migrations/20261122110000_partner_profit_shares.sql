-- Build 2872: partners' profit shares for a partnership's annual statements.
-- A Manager or Partner records each partner and share from the partnership deed for one ledger year, with the deed as evidence. The shares are held as basis points and must add to
-- exactly 100% across at least two partners. A different Partner approves them (a sole Partner may approve what they recorded, with the flag set and recorded). A change is a new
-- version; versions and their lines are never edited or deleted. Only an approved version is used to allocate the year's profit. The deed must share profit and loss in these ratios with no
-- partner salary or interest on capital first; a deed that does anything else is not recorded here.
CREATE TABLE erp_private.period_partner_share_sets(
 set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 version integer NOT NULL CHECK(version>=1),
 document_id uuid REFERENCES erp_private.documents ON DELETE RESTRICT,
 source_reference text CHECK(source_reference IS NULL OR (char_length(btrim(source_reference)) BETWEEN 10 AND 500)),
 ratio_only boolean NOT NULL CHECK(ratio_only),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 entered_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,version),
 CHECK(document_id IS NOT NULL OR source_reference IS NOT NULL),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status='Approved')
);
CREATE UNIQUE INDEX partner_share_one_draft ON erp_private.period_partner_share_sets(period_id) WHERE status='Draft';
CREATE UNIQUE INDEX partner_share_one_approved ON erp_private.period_partner_share_sets(period_id) WHERE status='Approved';
CREATE INDEX partner_share_sets_project_idx ON erp_private.period_partner_share_sets(project_id);
CREATE INDEX partner_share_sets_client_idx ON erp_private.period_partner_share_sets(client_id);
CREATE INDEX partner_share_sets_document_idx ON erp_private.period_partner_share_sets(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX partner_share_sets_entered_idx ON erp_private.period_partner_share_sets(entered_by);
CREATE INDEX partner_share_sets_reviewed_idx ON erp_private.period_partner_share_sets(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE TABLE erp_private.period_partner_share_lines(
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 set_id uuid NOT NULL REFERENCES erp_private.period_partner_share_sets,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 partner_name text NOT NULL CHECK(char_length(btrim(partner_name)) BETWEEN 2 AND 120),
 share_bp integer NOT NULL CHECK(share_bp BETWEEN 1 AND 10000)
);
CREATE UNIQUE INDEX partner_share_lines_unique ON erp_private.period_partner_share_lines(set_id,lower(btrim(partner_name)));
CREATE INDEX partner_share_lines_project_idx ON erp_private.period_partner_share_lines(project_id);
COMMENT ON TABLE erp_private.period_partner_share_sets IS 'Partners profit shares for one ledger year of a partnership, from the deed. Versioned; a Partner approves; shares add to exactly 100%.';
ALTER TABLE erp_private.period_partner_share_sets ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_partner_share_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.period_partner_share_lines ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_partner_share_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_partner_share_sets,erp_private.period_partner_share_lines FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_partner_share_sets TO erp_api;
GRANT SELECT,INSERT ON erp_private.period_partner_share_lines TO erp_api;
CREATE POLICY partner_share_sets_read ON erp_private.period_partner_share_sets FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY partner_share_sets_add ON erp_private.period_partner_share_sets FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND entered_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY partner_share_sets_update ON erp_private.period_partner_share_sets FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE POLICY partner_share_lines_read ON erp_private.period_partner_share_lines FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY partner_share_lines_add ON erp_private.period_partner_share_lines FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_partner_share_sets FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_partner_share_lines FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER lines_immutable BEFORE UPDATE ON erp_private.period_partner_share_lines FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_partner_share_sets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('set_id');
CREATE TRIGGER audit AFTER INSERT ON erp_private.period_partner_share_lines FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('line_id');

CREATE FUNCTION erp_private.period_partner_share_set_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
DECLARE n integer;DECLARE total integer;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The profit shares must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its profit shares can no longer be changed.' USING ERRCODE='23514'; END IF;
  IF (SELECT legal_entity_type FROM erp_private.clients WHERE client_id=NEW.client_id) IS DISTINCT FROM 'Partnership' THEN RAISE EXCEPTION 'Profit shares are recorded for a partnership only.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_partner_share_sets WHERE period_id=NEW.period_id),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=NEW.document_id AND d.client_id=NEW.client_id AND d.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The deed must be a document of this client.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF (NEW.set_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.version,NEW.document_id,NEW.source_reference,NEW.ratio_only,NEW.entered_by,NEW.entered_at)
    IS DISTINCT FROM (OLD.set_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.version,OLD.document_id,OLD.source_reference,OLD.ratio_only,OLD.entered_by,OLD.entered_at) THEN
  RAISE EXCEPTION 'Profit shares cannot be edited. Save a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat<>'PARTNER' OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Partner must review the profit shares.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.entered_by THEN
     IF NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A different Partner approves profit shares you recorded, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they recorded.' USING ERRCODE='23514';
    END IF;
    SELECT count(*),coalesce(sum(share_bp),0) INTO n,total FROM erp_private.period_partner_share_lines WHERE set_id=OLD.set_id;
    IF n<2 OR total<>10000 THEN RAISE EXCEPTION 'The shares must cover at least two partners and add to exactly 100 per cent.' USING ERRCODE='23514'; END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning profit shares.' USING ERRCODE='23514'; END IF;
   SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=OLD.period_id;
   IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved profit shares can only be superseded by a newer approved version.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'These profit shares are closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_partner_share_set_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER partner_share_set_guard BEFORE INSERT OR UPDATE ON erp_private.period_partner_share_sets FOR EACH ROW EXECUTE FUNCTION erp_private.period_partner_share_set_guard();

CREATE FUNCTION erp_private.period_partner_share_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE s erp_private.period_partner_share_sets;
BEGIN
 SELECT * INTO s FROM erp_private.period_partner_share_sets WHERE set_id=NEW.set_id;
 IF NOT FOUND OR s.status<>'Draft' THEN RAISE EXCEPTION 'Lines can only be added to a draft version.' USING ERRCODE='23514'; END IF;
 IF NEW.project_id<>s.project_id THEN RAISE EXCEPTION 'The line must belong to the same project as its profit shares.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_partner_share_line_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER partner_share_line_guard BEFORE INSERT ON erp_private.period_partner_share_lines FOR EACH ROW EXECUTE FUNCTION erp_private.period_partner_share_line_guard();
