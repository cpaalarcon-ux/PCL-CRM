-- Build 2888: the partners' capital and current accounts behind a partnership's statement of changes in equity.
-- period_partner_equity: for one ledger year, one line per partner (opening capital, capital introduced or withdrawn, opening current account, drawings) and the source that supports them. It is
-- declared by staff and approved by a Manager or Partner who did not declare it (a sole Partner may approve their own, and it is recorded). The share of profit is never stored: it is worked out from
-- the approved profit shares, and the tie-out to the statement of changes in equity is computed when the pack is built, so a stored record can never claim to agree. Approved rows are never edited,
-- only superseded by a newer approved one; a year locked by an audit or a closed year cannot change. Nothing here posts a journal, stores a tax rate or changes a ledger figure.

CREATE TABLE erp_private.period_partner_equity(
 equity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 version integer NOT NULL CHECK(version>=1),
 evidence text NOT NULL CHECK(char_length(btrim(evidence)) BETWEEN 10 AND 500),
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array' AND jsonb_array_length(lines) BETWEEN 2 AND 20 AND pg_column_size(lines)<=120000),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 declared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 declared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,version),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX period_partner_equity_one_draft ON erp_private.period_partner_equity(period_id) WHERE status='Draft';
CREATE UNIQUE INDEX period_partner_equity_one_approved ON erp_private.period_partner_equity(period_id) WHERE status='Approved';
CREATE INDEX period_partner_equity_project_idx ON erp_private.period_partner_equity(project_id);
CREATE INDEX period_partner_equity_client_idx ON erp_private.period_partner_equity(client_id);
CREATE INDEX period_partner_equity_declared_idx ON erp_private.period_partner_equity(declared_by);
CREATE INDEX period_partner_equity_reviewed_idx ON erp_private.period_partner_equity(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_partner_equity IS 'Declared partners'' capital and current accounts for one ledger year. Approved by someone who did not declare them; approved rows are only superseded. The share of profit and the tie-out to the statement of changes in equity are computed, never stored.';
ALTER TABLE erp_private.period_partner_equity ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_partner_equity FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_partner_equity FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_partner_equity TO erp_api;
CREATE POLICY period_partner_equity_read ON erp_private.period_partner_equity FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_partner_equity_add ON erp_private.period_partner_equity FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND declared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY period_partner_equity_update ON erp_private.period_partner_equity FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_partner_equity FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_partner_equity FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('equity_id');

CREATE FUNCTION erp_private.period_partner_equity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit, so the partners'' accounts cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. The partners'' accounts can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The record must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_partner_equity d WHERE d.period_id=NEW.period_id ),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.equity_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.version,NEW.evidence,NEW.lines,NEW.declared_by,NEW.declared_at)
    IS DISTINCT FROM (OLD.equity_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.version,OLD.evidence,OLD.lines,OLD.declared_by,OLD.declared_at) THEN
  RAISE EXCEPTION 'The partners'' accounts cannot be edited. Declare it again as a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the partners'' accounts.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.declared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves partners'' accounts you declared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they declared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the record.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'An approved record can only be superseded by a newer approved one.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This record is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_partner_equity_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_partner_equity_guard BEFORE INSERT OR UPDATE ON erp_private.period_partner_equity FOR EACH ROW EXECUTE FUNCTION erp_private.period_partner_equity_guard();
