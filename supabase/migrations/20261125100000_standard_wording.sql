-- Build 2878: standard wording library and client-specific disclosures for the annual statements.
-- 1. standard_wording: the firm's library of standard notes and policy wording, one row per version, per framework and edition. A Manager or Partner prepares a version (starting from the built-in
--    draft, which is only a draft), and a Partner approves it, a different Partner from the preparer unless the firm has only one Partner. Approved wording is never edited, only superseded.
-- 2. period_disclosures: the client-specific disclosures for one ledger year, each declared as text or as "Nothing to report" and approved by a Manager or Partner who did not declare it.
-- 3. period_disclosure_order: the order in which a year's disclosures are shown (presentation only).
-- Nothing here stores a tax rate or a figure. A year locked by an audit cannot have its disclosures changed.

CREATE TABLE erp_private.standard_wording(
 wording_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK(code ~ '^[A-Z_]{3,40}$'),
 framework text NOT NULL CHECK(char_length(btrim(framework)) BETWEEN 3 AND 80),
 edition text NOT NULL CHECK(char_length(btrim(edition)) BETWEEN 3 AND 80),
 version integer NOT NULL CHECK(version>=1),
 legal_form text NOT NULL CHECK(legal_form IN('All','Company','Partnership','Sole proprietor','Other')),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 3 AND 160),
 body text NOT NULL CHECK(char_length(btrim(body)) BETWEEN 20 AND 4000),
 origin text NOT NULL CHECK(origin IN('Built-in draft','Edited')),
 wording_version text NOT NULL CHECK(char_length(btrim(wording_version)) BETWEEN 3 AND 60),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(code,framework,edition,legal_form,version),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX standard_wording_one_draft ON erp_private.standard_wording(code,framework,edition,legal_form) WHERE status='Draft';
CREATE UNIQUE INDEX standard_wording_one_approved ON erp_private.standard_wording(code,framework,edition,legal_form) WHERE status='Approved';
CREATE INDEX standard_wording_prepared_idx ON erp_private.standard_wording(prepared_by);
CREATE INDEX standard_wording_reviewed_idx ON erp_private.standard_wording(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.standard_wording IS 'The firm''s standard note and policy wording, versioned by framework, edition and legal-form variant (All, where one text serves every form). A Partner approves each version; approved wording is only superseded.';
ALTER TABLE erp_private.standard_wording ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.standard_wording FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.standard_wording FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.standard_wording TO erp_api;
CREATE POLICY standard_wording_read ON erp_private.standard_wording FOR SELECT TO erp_api USING((erp_private.actor()).category_code<>'INTERN');
CREATE POLICY standard_wording_add ON erp_private.standard_wording FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY standard_wording_update ON erp_private.standard_wording FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.standard_wording FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.standard_wording FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('wording_id');

CREATE FUNCTION erp_private.standard_wording_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.standard_wording w WHERE w.code=NEW.code AND w.framework=NEW.framework AND w.edition=NEW.edition AND w.legal_form=NEW.legal_form),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.wording_id,NEW.code,NEW.framework,NEW.edition,NEW.version,NEW.legal_form,NEW.title,NEW.body,NEW.origin,NEW.wording_version,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.wording_id,OLD.code,OLD.framework,OLD.edition,OLD.version,OLD.legal_form,OLD.title,OLD.body,OLD.origin,OLD.wording_version,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'Wording cannot be edited. Prepare a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat<>'PARTNER' OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Partner must review the wording.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.prepared_by THEN
     IF NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A different Partner approves wording you prepared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they prepared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the wording.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved wording can only be superseded by newer approved wording.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This wording is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.standard_wording_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER standard_wording_guard BEFORE INSERT OR UPDATE ON erp_private.standard_wording FOR EACH ROW EXECUTE FUNCTION erp_private.standard_wording_guard();

CREATE TABLE erp_private.period_disclosures(
 disclosure_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 code text NOT NULL CHECK(code IN('PRINCIPAL_ACTIVITY','GOING_CONCERN','RELATED_PARTIES','EVENTS_AFTER','COMMITMENTS','CONTINGENCIES','POLICY_REVENUE','POLICY_PPE','POLICY_INVENTORY')),
 version integer NOT NULL CHECK(version>=1),
 state text NOT NULL CHECK(state IN('Text','Nothing to report')),
 body text CHECK(body IS NULL OR char_length(btrim(body)) BETWEEN 10 AND 4000),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded')),
 declared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 declared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(period_id,code,version),
 CHECK((state='Text' AND body IS NOT NULL) OR (state='Nothing to report' AND body IS NULL)),
 CHECK(state='Text' OR code IN('RELATED_PARTIES','EVENTS_AFTER','COMMITMENTS','CONTINGENCIES')),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded'))
);
CREATE UNIQUE INDEX period_disclosure_one_draft ON erp_private.period_disclosures(period_id,code) WHERE status='Draft';
CREATE UNIQUE INDEX period_disclosure_one_approved ON erp_private.period_disclosures(period_id,code) WHERE status='Approved';
CREATE INDEX period_disclosures_project_idx ON erp_private.period_disclosures(project_id);
CREATE INDEX period_disclosures_client_idx ON erp_private.period_disclosures(client_id);
CREATE INDEX period_disclosures_declared_idx ON erp_private.period_disclosures(declared_by);
CREATE INDEX period_disclosures_reviewed_idx ON erp_private.period_disclosures(reviewed_by) WHERE reviewed_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_disclosures IS 'Client-specific disclosures for one ledger year, declared as text or as nothing to report and approved by someone who did not declare them. Approved rows are only superseded.';
ALTER TABLE erp_private.period_disclosures ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_disclosures FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_disclosures FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_disclosures TO erp_api;
CREATE POLICY period_disclosures_read ON erp_private.period_disclosures FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_disclosures_add ON erp_private.period_disclosures FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND declared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY period_disclosures_update ON erp_private.period_disclosures FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_disclosures FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_disclosures FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('disclosure_id');

CREATE FUNCTION erp_private.period_disclosure_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit, so its disclosures cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its disclosures can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The disclosure must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_disclosures d WHERE d.period_id=NEW.period_id AND d.code=NEW.code),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.disclosure_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.code,NEW.version,NEW.state,NEW.body,NEW.declared_by,NEW.declared_at)
    IS DISTINCT FROM (OLD.disclosure_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.code,OLD.version,OLD.state,OLD.body,OLD.declared_by,OLD.declared_at) THEN
  RAISE EXCEPTION 'A disclosure cannot be edited. Declare it again as a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the disclosure.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.declared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves a disclosure you declared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they declared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the disclosure.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'An approved disclosure can only be superseded by a newer approved one.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This disclosure is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_disclosure_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_disclosure_guard BEFORE INSERT OR UPDATE ON erp_private.period_disclosures FOR EACH ROW EXECUTE FUNCTION erp_private.period_disclosure_guard();

CREATE TABLE erp_private.period_disclosure_order(
 period_id uuid PRIMARY KEY REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 codes text[] NOT NULL CHECK(cardinality(codes) BETWEEN 1 AND 20),
 updated_by uuid NOT NULL REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX period_disclosure_order_project_idx ON erp_private.period_disclosure_order(project_id);
CREATE INDEX period_disclosure_order_client_idx ON erp_private.period_disclosure_order(client_id);
CREATE INDEX period_disclosure_order_by_idx ON erp_private.period_disclosure_order(updated_by);
COMMENT ON TABLE erp_private.period_disclosure_order IS 'The order in which a year''s disclosures are shown. Presentation only: it changes no wording and no figure.';
ALTER TABLE erp_private.period_disclosure_order ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_disclosure_order FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_disclosure_order FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_disclosure_order TO erp_api;
CREATE POLICY period_disclosure_order_read ON erp_private.period_disclosure_order FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_disclosure_order_add ON erp_private.period_disclosure_order FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND updated_by=(erp_private.actor()).staff_id);
CREATE POLICY period_disclosure_order_update ON erp_private.period_disclosure_order FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND updated_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_disclosure_order FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_disclosure_order FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('period_id');

CREATE FUNCTION erp_private.period_disclosure_order_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND OR (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The order must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
 IF cardinality(NEW.codes)<>(SELECT count(DISTINCT c) FROM unnest(NEW.codes) c) THEN RAISE EXCEPTION 'List each disclosure once.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.codes) c WHERE c NOT IN('PRINCIPAL_ACTIVITY','GOING_CONCERN','RELATED_PARTIES','EVENTS_AFTER','COMMITMENTS','CONTINGENCIES','POLICY_REVENUE','POLICY_PPE','POLICY_INVENTORY')) THEN RAISE EXCEPTION 'That is not a disclosure the pack uses.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_disclosure_order_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_disclosure_order_guard BEFORE INSERT OR UPDATE ON erp_private.period_disclosure_order FOR EACH ROW EXECUTE FUNCTION erp_private.period_disclosure_order_guard();
