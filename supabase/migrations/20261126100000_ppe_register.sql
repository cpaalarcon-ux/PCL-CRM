-- Build 2881: the PPE register. A client-level record of property, plant and equipment that carries across the years.
-- 1. ppe_assets: one row per version of an asset (cost, class, dates, business use, and for an asset brought forward the accumulated depreciation and tax written-down value at a year end).
-- 2. ppe_disposals: one row per version of a disposal (date, proceeds, how).
-- A Manager or Partner who did not prepare a record approves it (a sole Partner may approve their own, recorded as such). Approved records are never edited: a correction is a new version that
-- supersedes the old one, and a record entered in error is ended with a reason. Nothing here stores a rate or posts a journal; depreciation rates come from asset_class_rates and the figures are worked out in the application.
-- A year locked by an audit cannot have records changed that fall in or before it.

CREATE TABLE erp_private.ppe_assets(
 record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_key uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 asset_name text NOT NULL CHECK(char_length(btrim(asset_name)) BETWEEN 3 AND 160),
 asset_account text NOT NULL REFERENCES erp_private.account_catalog(code),
 class_code text NOT NULL CHECK(class_code ~ '^[A-Z0-9_]{2,30}$'),
 acquired_on date NOT NULL,
 first_use_on date NOT NULL,
 cost numeric(18,2) NOT NULL CHECK(cost>0),
 business_percentage numeric(8,4) NOT NULL DEFAULT 100 CHECK(business_percentage BETWEEN 0 AND 100),
 noncommercial_vehicle boolean NOT NULL DEFAULT false,
 origin text NOT NULL CHECK(origin IN('Added in the year','Brought forward')),
 bf_as_of date,
 bf_accumulated_depreciation numeric(18,2) CHECK(bf_accumulated_depreciation IS NULL OR bf_accumulated_depreciation>=0),
 bf_tax_wdv numeric(18,2) CHECK(bf_tax_wdv IS NULL OR bf_tax_wdv>=0),
 source_row_id uuid REFERENCES erp_private.workbook_rows(row_id),
 evidence text NOT NULL CHECK(char_length(btrim(evidence)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded','Ended')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 ended_by uuid REFERENCES erp_private.staff_members,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 10 AND 500),
 UNIQUE(asset_key,version),
 CHECK(first_use_on>=acquired_on),
 CHECK((origin='Brought forward' AND bf_as_of IS NOT NULL AND bf_accumulated_depreciation IS NOT NULL AND bf_tax_wdv IS NOT NULL AND bf_accumulated_depreciation<=cost AND first_use_on<=bf_as_of)
    OR (origin='Added in the year' AND bf_as_of IS NULL AND bf_accumulated_depreciation IS NULL AND bf_tax_wdv IS NULL)),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded','Ended')),
 CHECK((status='Ended')=(ended_at IS NOT NULL AND ended_by IS NOT NULL AND ended_reason IS NOT NULL) OR status='Superseded')
);
CREATE UNIQUE INDEX ppe_assets_one_draft ON erp_private.ppe_assets(asset_key) WHERE status='Draft';
CREATE UNIQUE INDEX ppe_assets_one_approved ON erp_private.ppe_assets(asset_key) WHERE status='Approved';
CREATE UNIQUE INDEX ppe_assets_source_once ON erp_private.ppe_assets(source_row_id) WHERE source_row_id IS NOT NULL AND status IN('Draft','Approved');
CREATE INDEX ppe_assets_client_idx ON erp_private.ppe_assets(client_id,status);
CREATE INDEX ppe_assets_account_idx ON erp_private.ppe_assets(asset_account);
CREATE INDEX ppe_assets_prepared_idx ON erp_private.ppe_assets(prepared_by);
CREATE INDEX ppe_assets_reviewed_idx ON erp_private.ppe_assets(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX ppe_assets_ended_idx ON erp_private.ppe_assets(ended_by) WHERE ended_by IS NOT NULL;
COMMENT ON TABLE erp_private.ppe_assets IS 'The client''s property, plant and equipment register, one row per version of an asset. Approved rows are only superseded or ended; rates come from asset_class_rates and figures are worked out in the application.';
ALTER TABLE erp_private.ppe_assets ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.ppe_assets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ppe_assets FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.ppe_assets TO erp_api;
CREATE POLICY ppe_assets_read ON erp_private.ppe_assets FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ppe_assets_add ON erp_private.ppe_assets FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY ppe_assets_update ON erp_private.ppe_assets FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND erp_private.is_leader()) WITH CHECK(erp_private.client_allowed(client_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ppe_assets FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.ppe_assets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('record_id');

CREATE TABLE erp_private.ppe_disposals(
 record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 asset_key uuid NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 disposed_on date NOT NULL,
 proceeds numeric(18,2) NOT NULL CHECK(proceeds>=0),
 kind text NOT NULL CHECK(kind IN('Sold','Scrapped','Lost or stolen','Donated')),
 evidence text NOT NULL CHECK(char_length(btrim(evidence)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Returned','Superseded','Ended')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 ended_by uuid REFERENCES erp_private.staff_members,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 10 AND 500),
 UNIQUE(asset_key,version),
 CHECK(kind IN('Sold','Scrapped','Lost or stolen') OR proceeds=0),
 CHECK(status IN('Draft','Superseded') OR reviewed_at IS NOT NULL),
 CHECK(NOT sole_partner_approval OR status IN('Approved','Superseded','Ended')),
 CHECK((status='Ended')=(ended_at IS NOT NULL AND ended_by IS NOT NULL AND ended_reason IS NOT NULL) OR status='Superseded')
);
CREATE UNIQUE INDEX ppe_disposals_one_draft ON erp_private.ppe_disposals(asset_key) WHERE status='Draft';
CREATE UNIQUE INDEX ppe_disposals_one_approved ON erp_private.ppe_disposals(asset_key) WHERE status='Approved';
CREATE INDEX ppe_disposals_client_idx ON erp_private.ppe_disposals(client_id,status);
CREATE INDEX ppe_disposals_prepared_idx ON erp_private.ppe_disposals(prepared_by);
CREATE INDEX ppe_disposals_reviewed_idx ON erp_private.ppe_disposals(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX ppe_disposals_ended_idx ON erp_private.ppe_disposals(ended_by) WHERE ended_by IS NOT NULL;
COMMENT ON TABLE erp_private.ppe_disposals IS 'Disposals of register assets, one row per version. A disposal is approved separately from the asset and is only superseded or ended.';
ALTER TABLE erp_private.ppe_disposals ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.ppe_disposals FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ppe_disposals FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.ppe_disposals TO erp_api;
CREATE POLICY ppe_disposals_read ON erp_private.ppe_disposals FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ppe_disposals_add ON erp_private.ppe_disposals FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY ppe_disposals_update ON erp_private.ppe_disposals FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND erp_private.is_leader()) WITH CHECK(erp_private.client_allowed(client_id) AND erp_private.is_leader());
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ppe_disposals FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.ppe_disposals FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('record_id');

-- True when a live audit lock covers a year of this client that ends on or after the date: the register must not change underneath a locked pack.
CREATE FUNCTION erp_private.ppe_date_locked(p_client uuid,p_date date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.period_audit_locks k JOIN erp_private.ledger_periods p ON p.period_id=k.period_id WHERE k.client_id=p_client AND k.ended_at IS NULL AND p.ends_on>=p_date)
$$;
REVOKE ALL ON FUNCTION erp_private.ppe_date_locked(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.ppe_date_locked(uuid,date) TO erp_api;

CREATE FUNCTION erp_private.ppe_assets_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;DECLARE a erp_private.account_catalog;DECLARE at date;
BEGIN
 at:=coalesce(NEW.bf_as_of+1,NEW.acquired_on);
 IF erp_private.ppe_date_locked(NEW.client_id,at) OR (TG_OP='UPDATE' AND erp_private.ppe_date_locked(OLD.client_id,coalesce(OLD.bf_as_of+1,OLD.acquired_on))) THEN RAISE EXCEPTION 'The pack is locked by an audit, so this register cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO a FROM erp_private.account_catalog WHERE code=NEW.asset_account;
  IF a.status<>'Active' OR a.is_legacy OR a.route<>3 THEN RAISE EXCEPTION 'The cost account must be an active property, plant and equipment account.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.ppe_assets x WHERE x.asset_key=NEW.asset_key),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.version>1 AND NEW.client_id IS DISTINCT FROM (SELECT client_id FROM erp_private.ppe_assets x WHERE x.asset_key=NEW.asset_key AND x.version=1) THEN RAISE EXCEPTION 'A new version must belong to the same client.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.record_id,NEW.asset_key,NEW.version,NEW.client_id,NEW.asset_name,NEW.asset_account,NEW.class_code,NEW.acquired_on,NEW.first_use_on,NEW.cost,NEW.business_percentage,NEW.noncommercial_vehicle,NEW.origin,NEW.bf_as_of,NEW.bf_accumulated_depreciation,NEW.bf_tax_wdv,NEW.source_row_id,NEW.evidence,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.record_id,OLD.asset_key,OLD.version,OLD.client_id,OLD.asset_name,OLD.asset_account,OLD.class_code,OLD.acquired_on,OLD.first_use_on,OLD.cost,OLD.business_percentage,OLD.noncommercial_vehicle,OLD.origin,OLD.bf_as_of,OLD.bf_accumulated_depreciation,OLD.bf_tax_wdv,OLD.source_row_id,OLD.evidence,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'An asset record is never edited. Declare a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the asset.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.prepared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves an asset you prepared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they prepared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the asset.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status='Superseded' THEN
   IF (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved records keep their approval.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status='Ended' THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.ended_by IS DISTINCT FROM actor_id OR length(btrim(coalesce(NEW.ended_reason,'')))<10 THEN RAISE EXCEPTION 'A Manager or Partner ends an asset, with a reason of at least 10 characters.' USING ERRCODE='23514'; END IF;
   IF (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved records keep their approval.' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM erp_private.ppe_disposals d WHERE d.asset_key=OLD.asset_key AND d.status IN('Draft','Approved')) THEN RAISE EXCEPTION 'End or withdraw the disposal of this asset first.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'An approved asset can only be superseded by a newer version or ended with a reason.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This asset record is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.ppe_assets_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ppe_assets_guard BEFORE INSERT OR UPDATE ON erp_private.ppe_assets FOR EACH ROW EXECUTE FUNCTION erp_private.ppe_assets_guard();

CREATE FUNCTION erp_private.ppe_disposals_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE actor_cat text:=(erp_private.actor()).category_code;DECLARE actor_id uuid:=(erp_private.actor()).staff_id;DECLARE asset erp_private.ppe_assets;
BEGIN
 IF erp_private.ppe_date_locked(NEW.client_id,NEW.disposed_on) OR (TG_OP='UPDATE' AND erp_private.ppe_date_locked(OLD.client_id,OLD.disposed_on)) THEN RAISE EXCEPTION 'The pack is locked by an audit, so this register cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO asset FROM erp_private.ppe_assets x WHERE x.asset_key=NEW.asset_key AND x.status='Approved';
  IF NOT FOUND OR asset.client_id<>NEW.client_id THEN RAISE EXCEPTION 'Dispose only of an approved asset of this client.' USING ERRCODE='23514'; END IF;
  IF NEW.disposed_on<asset.first_use_on THEN RAISE EXCEPTION 'The disposal cannot be before the asset was first used.' USING ERRCODE='23514'; END IF;
  IF asset.origin='Brought forward' AND NEW.disposed_on<=asset.bf_as_of THEN RAISE EXCEPTION 'The disposal must be after the brought-forward date.' USING ERRCODE='23514'; END IF;
  IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.ppe_disposals x WHERE x.asset_key=NEW.asset_key),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
  IF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.record_id,NEW.asset_key,NEW.version,NEW.client_id,NEW.disposed_on,NEW.proceeds,NEW.kind,NEW.evidence,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.record_id,OLD.asset_key,OLD.version,OLD.client_id,OLD.disposed_on,OLD.proceeds,OLD.kind,OLD.evidence,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'A disposal record is never edited. Declare a new version.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Superseded' THEN NULL;
  ELSIF NEW.status IN('Approved','Returned') THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM actor_id THEN RAISE EXCEPTION 'A Manager or Partner must review the disposal.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' THEN
    IF NEW.reviewed_by=OLD.prepared_by THEN
     IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else approves a disposal you prepared, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
    ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner approves what they prepared.' USING ERRCODE='23514';
    END IF;
   END IF;
   IF NEW.status='Returned' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when returning the disposal.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'A draft can only be approved, returned or superseded.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Approved' THEN
  IF (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.sole_partner_approval) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note,OLD.sole_partner_approval) THEN RAISE EXCEPTION 'Approved records keep their approval.' USING ERRCODE='23514'; END IF;
  IF NEW.status='Ended' THEN
   IF actor_cat NOT IN('PARTNER','MANAGER') OR NEW.ended_by IS DISTINCT FROM actor_id OR length(btrim(coalesce(NEW.ended_reason,'')))<10 THEN RAISE EXCEPTION 'A Manager or Partner ends a disposal, with a reason of at least 10 characters.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.status<>'Superseded' THEN RAISE EXCEPTION 'An approved disposal can only be superseded by a newer version or ended with a reason.' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'This disposal record is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.ppe_disposals_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ppe_disposals_guard BEFORE INSERT OR UPDATE ON erp_private.ppe_disposals FOR EACH ROW EXECUTE FUNCTION erp_private.ppe_disposals_guard();
