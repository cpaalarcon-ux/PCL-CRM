-- Step 3 of the joined-practice review (2026-11-09): directors, shareholders and trustees as data, an ownership link between entities,
-- a check that holdings add up to 100%, and a group profile.
--
-- Until now directors, members and trustees were only KYC evidence records (CR12, register of members, officials list). This register holds
-- the people and entities themselves, dated. Beneficial owners (control, including indirect) stay in beneficial_owners; they are a
-- different question from who is on the share register.
--
-- Rules built in:
--  * Manager or Partner only (same as beneficial owners). Rows are never deleted; a row is ended with a date and a reason.
--  * Identity fields cannot be edited after entry. A mistake is ended with a reason and re-entered.
--  * A shareholder can be another client of the firm (holder_client_id): that is the ownership link between entities. A client cannot
--    hold itself, directly or through a chain (no cycles).
--  * Current shareholdings can never add up to more than 100%. Less than 100% is allowed but shown as a gap.
--  * Which roles a legal structure expects is a DEFAULT, not confirmed by the Compliance Lead; it only drives an advisory status and the
--    go-live counts. It does not block KYC verification (that is a Partner decision).
--  * The group profile records whether the client is part of a group and who the ultimate parent is. No tax threshold is applied here;
--    top-up tax and similar group rules need the Tax Lead's written confirmation first.

CREATE TABLE erp_private.client_parties(
 party_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 role text NOT NULL CHECK(role IN('Director','Shareholder','Trustee')),
 party_kind text NOT NULL CHECK(party_kind IN('Individual','Entity')),
 full_name text NOT NULL CHECK(length(btrim(full_name))>=2),
 identity_reference text CHECK(identity_reference IS NULL OR length(btrim(identity_reference))>=3),
 kra_pin text CHECK(kra_pin IS NULL OR kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 holder_client_id uuid REFERENCES erp_private.clients,
 shareholding_percentage numeric(7,4),
 share_class text CHECK(share_class IS NULL OR length(btrim(share_class))>0),
 appointed_on date NOT NULL,
 ceased_on date,
 end_reason text,
 evidence_id uuid REFERENCES erp_private.client_kyc_evidence(evidence_id),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 ended_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((role='Shareholder')=(shareholding_percentage IS NOT NULL)),
 CHECK(shareholding_percentage IS NULL OR (shareholding_percentage>0 AND shareholding_percentage<=100)),
 CHECK(holder_client_id IS NULL OR (role='Shareholder' AND party_kind='Entity')),
 CHECK(share_class IS NULL OR role='Shareholder'),
 CHECK(ceased_on IS NULL OR ceased_on>=appointed_on),
 CHECK((ceased_on IS NULL)=(ended_by IS NULL)),
 CHECK(ceased_on IS NULL OR length(btrim(COALESCE(end_reason,'')))>=10)
);
CREATE INDEX client_parties_client_idx ON erp_private.client_parties(client_id,role) WHERE ceased_on IS NULL;
CREATE INDEX client_parties_holder_idx ON erp_private.client_parties(holder_client_id) WHERE holder_client_id IS NOT NULL;
CREATE INDEX client_parties_evidence_idx ON erp_private.client_parties(evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX client_parties_created_by_idx ON erp_private.client_parties(created_by);
CREATE INDEX client_parties_ended_by_idx ON erp_private.client_parties(ended_by) WHERE ended_by IS NOT NULL;
CREATE UNIQUE INDEX client_parties_current_unique ON erp_private.client_parties(client_id,role,lower(btrim(full_name)),COALESCE(lower(btrim(identity_reference)),'')) WHERE ceased_on IS NULL;

-- Is `target` already held, directly or through a chain, by `start`? Used to stop ownership loops.
CREATE FUNCTION erp_private.ownership_reaches(p_start uuid,p_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH RECURSIVE chain(client_id,depth) AS (
  SELECT p_start,0
  UNION
  SELECT p.holder_client_id,chain.depth+1 FROM chain JOIN erp_private.client_parties p ON p.client_id=chain.client_id
   WHERE p.role='Shareholder' AND p.ceased_on IS NULL AND p.holder_client_id IS NOT NULL AND chain.depth<50
 ) SELECT EXISTS(SELECT 1 FROM chain WHERE client_id=p_target)
$$;

CREATE FUNCTION erp_private.client_party_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_total numeric;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND (NOT erp_private.is_leader() OR NEW.created_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can record directors, shareholders and trustees' USING ERRCODE='42501'; END IF;
  IF NEW.ceased_on IS NOT NULL OR NEW.ended_by IS NOT NULL THEN RAISE EXCEPTION 'Record a party as current; end it later with a date and reason' USING ERRCODE='23514'; END IF;
  IF NEW.holder_client_id IS NOT NULL THEN
   IF NEW.holder_client_id=NEW.client_id THEN RAISE EXCEPTION 'A client cannot be its own shareholder' USING ERRCODE='23514'; END IF;
   IF erp_private.ownership_reaches(NEW.holder_client_id,NEW.client_id) THEN RAISE EXCEPTION 'That would make the ownership chain a loop: the client already holds the shareholder, directly or through other entities' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.role='Shareholder' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':shareholding',0));
   SELECT COALESCE(sum(shareholding_percentage),0) INTO v_total FROM erp_private.client_parties WHERE client_id=NEW.client_id AND role='Shareholder' AND ceased_on IS NULL;
   IF v_total+NEW.shareholding_percentage>100 THEN
    RAISE EXCEPTION 'Current shareholdings would add up to % percent; they cannot exceed 100 percent (now %)',v_total+NEW.shareholding_percentage,v_total USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- UPDATE: the identity of a row is fixed. Only ending it, or linking its evidence, is allowed.
 IF ROW(NEW.client_id,NEW.role,NEW.party_kind,NEW.full_name,NEW.identity_reference,NEW.kra_pin,NEW.holder_client_id,NEW.shareholding_percentage,NEW.share_class,NEW.appointed_on,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.role,OLD.party_kind,OLD.full_name,OLD.identity_reference,OLD.kra_pin,OLD.holder_client_id,OLD.shareholding_percentage,OLD.share_class,OLD.appointed_on,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A recorded party cannot be edited; end it with a reason and record the correct one' USING ERRCODE='23514';
 END IF;
 IF v_actor IS NOT NULL AND NOT erp_private.is_leader() THEN RAISE EXCEPTION 'Only a Manager or Partner can change this register' USING ERRCODE='42501'; END IF;
 IF OLD.ceased_on IS NOT NULL AND (NEW.ceased_on IS DISTINCT FROM OLD.ceased_on OR NEW.end_reason IS DISTINCT FROM OLD.end_reason OR NEW.ended_by IS DISTINCT FROM OLD.ended_by) THEN
  RAISE EXCEPTION 'An ended party stays ended' USING ERRCODE='23514';
 END IF;
 IF OLD.ceased_on IS NULL AND NEW.ceased_on IS NOT NULL THEN
  IF NEW.ceased_on>current_date THEN RAISE EXCEPTION 'The end date cannot be in the future' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.ended_by<>v_actor THEN RAISE EXCEPTION 'The person ending the record must be the signed-in Manager or Partner' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER party_guard BEFORE INSERT OR UPDATE ON erp_private.client_parties FOR EACH ROW EXECUTE FUNCTION erp_private.client_party_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_parties FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_parties FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_parties FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('party_id');
ALTER TABLE erp_private.client_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_parties FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_parties TO erp_api;
CREATE POLICY parties_read ON erp_private.client_parties FOR SELECT TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY parties_add ON erp_private.client_parties FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND created_by=(erp_private.actor()).staff_id AND (holder_client_id IS NULL OR erp_private.client_allowed(holder_client_id)));
CREATE POLICY parties_update ON erp_private.client_parties FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

-- Group profile: one row per client.
CREATE TABLE erp_private.client_group_profile(
 client_id uuid PRIMARY KEY REFERENCES erp_private.clients,
 group_status text NOT NULL CHECK(group_status IN('Standalone','Part of a group')),
 ultimate_parent_client_id uuid REFERENCES erp_private.clients,
 ultimate_parent_name text,
 ultimate_parent_country text,
 operates_in_other_countries text NOT NULL DEFAULT 'To confirm' CHECK(operates_in_other_countries IN('Yes','No','To confirm')),
 note text NOT NULL DEFAULT '',
 assessed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 assessed_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(ultimate_parent_client_id IS NULL OR ultimate_parent_client_id<>client_id),
 CHECK(group_status='Standalone' OR ultimate_parent_client_id IS NOT NULL OR (length(btrim(COALESCE(ultimate_parent_name,'')))>=2 AND length(btrim(COALESCE(ultimate_parent_country,'')))>=2)),
 CHECK(group_status='Part of a group' OR (ultimate_parent_client_id IS NULL AND ultimate_parent_name IS NULL AND ultimate_parent_country IS NULL))
);
CREATE INDEX client_group_parent_idx ON erp_private.client_group_profile(ultimate_parent_client_id) WHERE ultimate_parent_client_id IS NOT NULL;
CREATE INDEX client_group_assessed_by_idx ON erp_private.client_group_profile(assessed_by);
CREATE FUNCTION erp_private.client_group_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;
 IF v_actor IS NOT NULL AND (NOT erp_private.is_leader() OR NEW.assessed_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can record the group profile' USING ERRCODE='42501'; END IF;
 NEW.assessed_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER group_guard BEFORE INSERT OR UPDATE ON erp_private.client_group_profile FOR EACH ROW EXECUTE FUNCTION erp_private.client_group_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_group_profile FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_group_profile FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_group_profile FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('client_id');
ALTER TABLE erp_private.client_group_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_group_profile FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_group_profile TO erp_api;
CREATE POLICY group_read ON erp_private.client_group_profile FOR SELECT TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY group_add ON erp_private.client_group_profile FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND assessed_by=(erp_private.actor()).staff_id AND (ultimate_parent_client_id IS NULL OR erp_private.client_allowed(ultimate_parent_client_id)));
CREATE POLICY group_update ON erp_private.client_group_profile FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND (ultimate_parent_client_id IS NULL OR erp_private.client_allowed(ultimate_parent_client_id)));

-- What the register should hold for each client, and where it falls short. The expectation per legal structure is a DEFAULT that the
-- Compliance Lead has not confirmed. Empty for anyone who is not a Manager or Partner.
CREATE FUNCTION erp_private.ownership_status_all() RETURNS TABLE(client_id uuid,expects text[],issues text[],shareholding_total numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH base AS (
  SELECT c.client_id,
   CASE
    WHEN c.legal_structure='Limited Company' AND c.legal_subtype IN('Private Limited Company','Public Limited Company') THEN ARRAY['Director','Shareholder']
    WHEN c.legal_structure='Limited Company' THEN ARRAY['Director']
    WHEN c.legal_structure='Other' AND c.legal_subtype='Trust' THEN ARRAY['Trustee']
    ELSE ARRAY[]::text[]
   END AS expects,
   COALESCE((SELECT sum(p.shareholding_percentage) FROM erp_private.client_parties p WHERE p.client_id=c.client_id AND p.role='Shareholder' AND p.ceased_on IS NULL),0) AS total,
   (SELECT count(*) FROM erp_private.client_parties p WHERE p.client_id=c.client_id AND p.role='Director' AND p.ceased_on IS NULL) AS directors,
   (SELECT count(*) FROM erp_private.client_parties p WHERE p.client_id=c.client_id AND p.role='Trustee' AND p.ceased_on IS NULL) AS trustees
  FROM erp_private.clients c WHERE c.deleted_at IS NULL AND erp_private.is_leader() AND erp_private.client_allowed(c.client_id)
 )
 SELECT b.client_id,b.expects,
  array_remove(ARRAY[
   CASE WHEN 'Director'=ANY(b.expects) AND b.directors=0 THEN 'No current director is recorded' END,
   CASE WHEN 'Trustee'=ANY(b.expects) AND b.trustees=0 THEN 'No current trustee is recorded' END,
   CASE WHEN 'Shareholder'=ANY(b.expects) AND b.total=0 THEN 'No current shareholder is recorded' END,
   CASE WHEN 'Shareholder'=ANY(b.expects) AND b.total>0 AND b.total<100 THEN 'Shareholdings add up to '||b.total::text||' percent, not 100' END
  ],NULL),b.total
 FROM base b
$$;

-- Clients where nothing has been recorded about group membership (read-only; used by the go-live checks).
CREATE FUNCTION erp_private.group_unassessed_count() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN erp_private.is_leader() THEN (SELECT count(*)::int FROM erp_private.clients c WHERE c.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_group_profile g WHERE g.client_id=c.client_id)) ELSE 0 END
$$;

REVOKE EXECUTE ON FUNCTION erp_private.client_party_guard(),erp_private.client_group_guard(),erp_private.ownership_reaches(uuid,uuid),erp_private.ownership_status_all(),erp_private.group_unassessed_count() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.ownership_reaches(uuid,uuid),erp_private.ownership_status_all(),erp_private.group_unassessed_count() TO erp_api;
