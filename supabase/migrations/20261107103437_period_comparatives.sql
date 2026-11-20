-- Annual pack step 2: prior-year comparatives for a first ERP year (no prior-year ledger). A Manager or Partner enters prior-year profit or loss,
-- equity movements and cash flows (indirect method); a different Partner approves them after they reconcile to the approved opening balances.
-- A change is a new version. Versions and their lines are never edited or deleted. No tax rate is stored.
CREATE TABLE erp_private.period_comparative_sets(
 set_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 version integer NOT NULL CHECK(version>=1),
 prior_year_end date NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('Signed prior-year financial statements','Prior-year accounting records outside the ERP','Management accounts')),
 source_reference text NOT NULL CHECK(length(btrim(source_reference))>=10 AND char_length(source_reference)<=500),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Approved','Returned','Superseded')),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 entered_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 UNIQUE(period_id,version),
 CHECK(status IN ('Draft','Superseded') OR reviewed_at IS NOT NULL)
);
CREATE UNIQUE INDEX period_comparative_one_draft ON erp_private.period_comparative_sets(period_id) WHERE status='Draft';
CREATE UNIQUE INDEX period_comparative_one_approved ON erp_private.period_comparative_sets(period_id) WHERE status='Approved';
CREATE TABLE erp_private.period_comparative_lines(
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 set_id uuid NOT NULL REFERENCES erp_private.period_comparative_sets,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 statement text NOT NULL CHECK(statement IN ('Profit or loss','Changes in equity','Cash flow')),
 line_code text NOT NULL CHECK(line_code ~ '^(PL|SFP|CF)[.][A-Z0-9_]{2,30}$'),
 movement text,
 amount numeric(18,2) NOT NULL CHECK(abs(amount)<1000000000000),
 CHECK((statement='Changes in equity' AND movement IN ('OPENING','PROFIT','DIVIDENDS_DRAWINGS','CAPITAL','OTHER')) OR (statement<>'Changes in equity' AND movement IS NULL)),
 CHECK((statement='Profit or loss' AND line_code LIKE 'PL.%') OR (statement='Changes in equity' AND line_code LIKE 'SFP.%') OR (statement='Cash flow' AND line_code LIKE 'CF.%'))
);
CREATE UNIQUE INDEX period_comparative_lines_unique ON erp_private.period_comparative_lines(set_id,statement,line_code,coalesce(movement,''));
COMMENT ON TABLE erp_private.period_comparative_sets IS 'Prior-year comparatives typed in or pasted from signed prior-year accounts for a first ERP year. Versioned; a Partner approves.';

ALTER TABLE erp_private.period_comparative_sets ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_comparative_sets FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.period_comparative_lines ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.period_comparative_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.period_comparative_sets,erp_private.period_comparative_lines FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.period_comparative_sets TO erp_api;
GRANT SELECT,INSERT ON erp_private.period_comparative_lines TO erp_api;
CREATE POLICY comparative_sets_read ON erp_private.period_comparative_sets FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY comparative_sets_add ON erp_private.period_comparative_sets FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND entered_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY comparative_sets_update ON erp_private.period_comparative_sets FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE POLICY comparative_lines_read ON erp_private.period_comparative_lines FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY comparative_lines_add ON erp_private.period_comparative_lines FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_comparative_sets FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_comparative_lines FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER lines_immutable BEFORE UPDATE ON erp_private.period_comparative_lines FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_comparative_sets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('set_id');
CREATE TRIGGER audit AFTER INSERT ON erp_private.period_comparative_lines FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('line_id');

CREATE FUNCTION erp_private.period_comparative_set_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The comparatives must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its comparatives can no longer be changed.' USING ERRCODE='23514'; END IF;
  IF NEW.prior_year_end<>p.starts_on-1 THEN RAISE EXCEPTION 'The comparatives must be for the year ending the day before this year starts.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.period_comparative_sets WHERE period_id=NEW.period_id),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.set_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.version,NEW.prior_year_end,NEW.source_kind,NEW.source_reference,NEW.entered_by,NEW.entered_at)
    IS DISTINCT FROM (OLD.set_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.version,OLD.prior_year_end,OLD.source_kind,OLD.source_reference,OLD.entered_by,OLD.entered_at) THEN
  RAISE EXCEPTION 'Prior-year comparatives cannot be edited. Save a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN ('Approved','Returned') THEN
   IF actor_cat<>'PARTNER' OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Partner must review prior-year comparatives.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' AND NEW.reviewed_by=OLD.entered_by THEN RAISE EXCEPTION 'Comparatives must be approved by a Partner other than the person who entered them.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning comparatives.' USING ERRCODE='23514'; END IF;
   SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=OLD.period_id;
   IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) THEN RAISE EXCEPTION 'Approved comparatives can only be superseded by a newer approved version.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'These comparatives are closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_comparative_set_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER comparative_set_guard BEFORE INSERT OR UPDATE ON erp_private.period_comparative_sets FOR EACH ROW EXECUTE FUNCTION erp_private.period_comparative_set_guard();

CREATE FUNCTION erp_private.period_comparative_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE s erp_private.period_comparative_sets;
BEGIN
 SELECT * INTO s FROM erp_private.period_comparative_sets WHERE set_id=NEW.set_id;
 IF NOT FOUND OR s.status<>'Draft' THEN RAISE EXCEPTION 'Lines can only be added to a draft version.' USING ERRCODE='23514'; END IF;
 IF NEW.project_id<>s.project_id THEN RAISE EXCEPTION 'The line must belong to the same project as its comparatives.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_comparative_line_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER comparative_line_guard BEFORE INSERT ON erp_private.period_comparative_lines FOR EACH ROW EXECUTE FUNCTION erp_private.period_comparative_line_guard();
