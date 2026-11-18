-- Build 2884: the client-specific pages of the annual pack.
-- period_client_pages: the entity information, the report of the directors or partners and the statement of responsibilities for one ledger year. Each page is declared by staff as a set of fields (or,
-- for the report and the statement, as "Not applicable" with a reason) and approved by a Manager or Partner who did not declare it. "Not applicable" is approved by a Partner only. The cover and the
-- key figures are built from verified client facts and the statements, so nothing is stored for them. Approved rows are never edited, only superseded; a year locked by an audit cannot change.
-- Nothing here stores a figure or a tax rate.

CREATE TABLE erp_private.period_client_pages(
 page_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 code text NOT NULL CHECK(code IN('ENTITY_INFO','REPORT','RESPONSIBILITIES')),
 version integer NOT NULL CHECK(version>=1),
 state text NOT NULL CHECK(state IN('Declared','Not applicable')),
 fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fields)='object' AND pg_column_size(fields)<=16000),
 reason text CHECK(reason IS NULL OR char_length(btrim(reason)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 declared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 declared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,code,version),
 CHECK((state='Declared' AND reason IS NULL AND fields<>'{}'::jsonb) OR (state='Not applicable' AND reason IS NOT NULL AND fields='{}'::jsonb)),
 CHECK(state='Declared' OR code IN('REPORT','RESPONSIBILITIES')),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX period_client_pages_one_draft ON erp_private.period_client_pages(period_id,code) WHERE status='Draft';
CREATE UNIQUE INDEX period_client_pages_one_approved ON erp_private.period_client_pages(period_id,code) WHERE status='Approved';
CREATE INDEX period_client_pages_project_idx ON erp_private.period_client_pages(project_id);
CREATE INDEX period_client_pages_client_idx ON erp_private.period_client_pages(client_id);
CREATE INDEX period_client_pages_declared_idx ON erp_private.period_client_pages(declared_by);
CREATE INDEX period_client_pages_reviewed_idx ON erp_private.period_client_pages(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_client_pages IS 'Declared client-specific pages of the annual pack for one ledger year (entity information, report of the directors or partners, statement of responsibilities). Approved by someone who did not declare them; approved rows are only superseded.';
ALTER TABLE erp_private.period_client_pages ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_client_pages FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_client_pages FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_client_pages TO erp_api;
CREATE POLICY period_client_pages_read ON erp_private.period_client_pages FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_client_pages_add ON erp_private.period_client_pages FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND declared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY period_client_pages_update ON erp_private.period_client_pages FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_client_pages FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_client_pages FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('page_id');

CREATE FUNCTION erp_private.period_client_page_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit, so its pages cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its pages can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The page must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_client_pages d WHERE d.period_id=NEW.period_id AND d.code=NEW.code),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.page_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.code,NEW.version,NEW.state,NEW.fields,NEW.reason,NEW.declared_by,NEW.declared_at)
    IS DISTINCT FROM (OLD.page_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.code,OLD.version,OLD.state,OLD.fields,OLD.reason,OLD.declared_by,OLD.declared_at) THEN
  RAISE EXCEPTION 'A page cannot be edited. Declare it again as a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the page.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.state='Not applicable' AND actor_cat<>'PARTNER' THEN RAISE EXCEPTION 'A Partner approves a page that is declared as not applicable.' USING ERRCODE='23514'; END IF;
    IF NEW.reviewed_by=OLD.declared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves a page you declared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they declared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the page.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'An approved page can only be superseded by a newer approved one.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This page is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_client_page_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_client_page_guard BEFORE INSERT OR UPDATE ON erp_private.period_client_pages FOR EACH ROW EXECUTE FUNCTION erp_private.period_client_page_guard();

-- The directors named on the entity pages. Ownership records are read by Managers and Partners only; the pages need just a director's name and dates, which any staff member who prepares the
-- statements may read for a client they are allowed to work on. No shareholding, identity number or PIN is returned.
CREATE FUNCTION erp_private.client_page_directors(p_client uuid) RETURNS TABLE(full_name text,appointed_on date,ceased_on date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p.full_name,p.appointed_on,p.ceased_on FROM erp_private.client_parties p
 WHERE p.client_id=p_client AND p.role='Director' AND p.party_kind='Individual' AND erp_private.client_allowed(p_client) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')
 ORDER BY p.appointed_on,p.party_id
$$;
REVOKE ALL ON FUNCTION erp_private.client_page_directors(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_page_directors(uuid) TO erp_api;
