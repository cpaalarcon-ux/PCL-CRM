-- Step 4 of the joined-practice review (2026-11-09): licences and permits per client, with expiry dates, and a flag to the audit file.
--
-- A client in a regulated or licensed activity holds licences (EPRA, NTSA, a county single business permit, a SASRA licence, others).
-- Until now they were only KYC evidence (the SACCO_LICENCE evidence rule). This register holds each licence as dated data, so an expiry
-- can be seen on the client, in the go-live checks and on the audit file.
--
-- Rules built in:
--  * Manager or Partner only to record or end a licence (same as the ownership register). Rows are never deleted; a licence is ended
--    with a date and a reason. A mistake is ended and re-entered: the licence number, dates and authority cannot be edited.
--  * A renewal is a new row that points at the licence it renews (same client, same type, later expiry); the server ends the old one.
--  * State is worked out from the expiry date: Valid, Expiring (inside the warning window) or Expired. Dates use Nairobi time.
--  * The warning window is a setting on the licence type (default 60 days). It is a default, not confirmed by the Compliance Lead.
--  * Which licence a legal structure is expected to hold is a SUGGESTED default. Only the deposit-taking SACCO / SASRA licence is
--    listed, because the existing structure checklist already marks it Required. Nothing else is invented; the Compliance Lead adds
--    the rest. There is no activity-to-licence mapping (for example transport to NTSA) until the Compliance Lead confirms one.
--  * The audit file gets a READ-ONLY flag (type, authority, expiry, state; never the licence number). It creates no risk, blocks no
--    sign-off, and does not decide anything. Whether an expired licence should block audit approval is a Partner decision.

CREATE TABLE erp_private.licence_types(
 type_code text PRIMARY KEY CHECK(type_code ~ '^[A-Z_]{2,30}$'),
 label text NOT NULL,
 authority text NOT NULL,
 warn_days integer NOT NULL DEFAULT 60 CHECK(warn_days BETWEEN 0 AND 366),
 sort_order integer NOT NULL DEFAULT 100,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed','Retired')),
 note text NOT NULL DEFAULT ''
);
INSERT INTO erp_private.licence_types(type_code,label,authority,sort_order,note) VALUES
 ('EPRA','EPRA licence or permit','Energy and Petroleum Regulatory Authority (EPRA)',10,'Warning window and use are defaults; the Compliance Lead has not yet confirmed them.'),
 ('NTSA','NTSA licence','National Transport and Safety Authority (NTSA)',20,'Warning window and use are defaults; the Compliance Lead has not yet confirmed them.'),
 ('COUNTY_PERMIT','County single business permit','County government',30,'Record the county in the issuing authority.'),
 ('SACCO_LICENCE','SACCO licence','SACCO Societies Regulatory Authority (SASRA)',40,'Matches the SACCO_LICENCE evidence rule on the KYC file.'),
 ('OTHER','Other licence or permit','',90,'Describe the licence in the description field.');
ALTER TABLE erp_private.licence_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.licence_types FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.licence_types TO erp_api;
CREATE POLICY licence_types_read ON erp_private.licence_types FOR SELECT TO erp_api USING(true);

-- Suggested expectation by legal structure. Empty on purpose beyond the one rule the checklist already carries.
CREATE TABLE erp_private.licence_expectations(
 structure text NOT NULL,
 subtype text NOT NULL,
 type_code text NOT NULL REFERENCES erp_private.licence_types,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed','Retired')),
 note text NOT NULL DEFAULT '',
 PRIMARY KEY(structure,subtype,type_code),
 FOREIGN KEY(structure,subtype) REFERENCES erp_private.legal_structure_types(structure,subtype)
);
CREATE INDEX licence_expectations_type_idx ON erp_private.licence_expectations(type_code);
INSERT INTO erp_private.licence_expectations(structure,subtype,type_code,note) VALUES
 ('Co-operative Society','Deposit-taking SACCO','SACCO_LICENCE','The structure checklist already marks the SASRA licence Required for a deposit-taking SACCO.');
ALTER TABLE erp_private.licence_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.licence_expectations FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.licence_expectations TO erp_api;
CREATE POLICY licence_expectations_read ON erp_private.licence_expectations FOR SELECT TO erp_api USING(true);

CREATE TABLE erp_private.client_licences(
 licence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 licence_type text NOT NULL REFERENCES erp_private.licence_types,
 licence_number text NOT NULL CHECK(length(btrim(licence_number))>=2),
 issuing_authority text NOT NULL CHECK(length(btrim(issuing_authority))>=2),
 description text NOT NULL DEFAULT '',
 issued_on date,
 expires_on date NOT NULL,
 evidence_id uuid REFERENCES erp_private.client_kyc_evidence(evidence_id),
 renews_licence_id uuid REFERENCES erp_private.client_licences(licence_id),
 ended_on date,
 end_reason text,
 ended_by uuid REFERENCES erp_private.staff_members,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(issued_on IS NULL OR expires_on>issued_on),
 CHECK(licence_type<>'OTHER' OR length(btrim(description))>=3),
 CHECK((ended_on IS NULL)=(ended_by IS NULL)),
 CHECK((ended_on IS NULL)=(end_reason IS NULL)),
 CHECK(end_reason IS NULL OR length(btrim(end_reason))>=10),
 CHECK(renews_licence_id IS NULL OR renews_licence_id<>licence_id)
);
CREATE INDEX client_licences_client_idx ON erp_private.client_licences(client_id,licence_type) WHERE ended_on IS NULL;
CREATE INDEX client_licences_expiry_idx ON erp_private.client_licences(expires_on) WHERE ended_on IS NULL;
CREATE INDEX client_licences_type_idx ON erp_private.client_licences(licence_type);
CREATE INDEX client_licences_evidence_idx ON erp_private.client_licences(evidence_id) WHERE evidence_id IS NOT NULL;
CREATE INDEX client_licences_renews_idx ON erp_private.client_licences(renews_licence_id) WHERE renews_licence_id IS NOT NULL;
CREATE INDEX client_licences_created_by_idx ON erp_private.client_licences(created_by);
CREATE INDEX client_licences_ended_by_idx ON erp_private.client_licences(ended_by) WHERE ended_by IS NOT NULL;
CREATE UNIQUE INDEX client_licences_current_unique ON erp_private.client_licences(client_id,licence_type,lower(btrim(licence_number))) WHERE ended_on IS NULL;

CREATE FUNCTION erp_private.client_licence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_old record;v_today date;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND (NOT erp_private.is_leader() OR NEW.created_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can record a licence or permit' USING ERRCODE='42501'; END IF;
  IF NEW.ended_on IS NOT NULL THEN RAISE EXCEPTION 'Record a licence as current; end it later with a date and reason' USING ERRCODE='23514'; END IF;
  IF NEW.issued_on IS NOT NULL AND NEW.issued_on>v_today THEN RAISE EXCEPTION 'The issue date cannot be in the future' USING ERRCODE='23514'; END IF;
  IF NEW.renews_licence_id IS NOT NULL THEN
   SELECT l.client_id,l.licence_type,l.expires_on INTO v_old FROM erp_private.client_licences l WHERE l.licence_id=NEW.renews_licence_id;
   IF NOT FOUND OR v_old.client_id<>NEW.client_id OR v_old.licence_type<>NEW.licence_type THEN RAISE EXCEPTION 'A renewal must be for the same client and the same type of licence' USING ERRCODE='23514'; END IF;
   IF NEW.expires_on<=v_old.expires_on THEN RAISE EXCEPTION 'A renewal must expire after the licence it renews' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- UPDATE: what the licence is cannot change. Only ending it, or linking its evidence, is allowed.
 IF ROW(NEW.client_id,NEW.licence_type,NEW.licence_number,NEW.issuing_authority,NEW.description,NEW.issued_on,NEW.expires_on,NEW.renews_licence_id,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.licence_type,OLD.licence_number,OLD.issuing_authority,OLD.description,OLD.issued_on,OLD.expires_on,OLD.renews_licence_id,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A recorded licence cannot be edited; end it with a reason and record the correct one' USING ERRCODE='23514';
 END IF;
 IF v_actor IS NOT NULL AND NOT erp_private.is_leader() THEN RAISE EXCEPTION 'Only a Manager or Partner can change the licence register' USING ERRCODE='42501'; END IF;
 IF OLD.ended_on IS NOT NULL AND (NEW.ended_on IS DISTINCT FROM OLD.ended_on OR NEW.end_reason IS DISTINCT FROM OLD.end_reason OR NEW.ended_by IS DISTINCT FROM OLD.ended_by) THEN
  RAISE EXCEPTION 'An ended licence stays ended' USING ERRCODE='23514';
 END IF;
 IF OLD.ended_on IS NULL AND NEW.ended_on IS NOT NULL THEN
  IF NEW.ended_on>v_today THEN RAISE EXCEPTION 'The end date cannot be in the future' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.ended_by<>v_actor THEN RAISE EXCEPTION 'The person ending the record must be the signed-in Manager or Partner' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER licence_guard BEFORE INSERT OR UPDATE ON erp_private.client_licences FOR EACH ROW EXECUTE FUNCTION erp_private.client_licence_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_licences FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_licences FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_licences FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('licence_id');
ALTER TABLE erp_private.client_licences ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_licences FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_licences TO erp_api;
CREATE POLICY licences_read ON erp_private.client_licences FOR SELECT TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY licences_add ON erp_private.client_licences FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY licences_update ON erp_private.client_licences FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

-- The state of a licence from its expiry date and the type's warning window.
CREATE FUNCTION erp_private.licence_state(p_expires date,p_warn integer) RETURNS text LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_expires<(now() AT TIME ZONE 'Africa/Nairobi')::date THEN 'Expired'
             WHEN p_expires<=(now() AT TIME ZONE 'Africa/Nairobi')::date+p_warn THEN 'Expiring'
             ELSE 'Valid' END
$$;

-- Every current licence, plus each suggested licence a client is missing. Manager or Partner only (empty for anyone else).
CREATE FUNCTION erp_private.licence_summary_all() RETURNS TABLE(client_id uuid,licence_id uuid,licence_type text,state text,expires_on date,days_left integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT l.client_id,l.licence_id,l.licence_type,erp_private.licence_state(l.expires_on,t.warn_days),l.expires_on,
        l.expires_on-(now() AT TIME ZONE 'Africa/Nairobi')::date
  FROM erp_private.client_licences l JOIN erp_private.licence_types t ON t.type_code=l.licence_type JOIN erp_private.clients c ON c.client_id=l.client_id
  WHERE l.ended_on IS NULL AND c.deleted_at IS NULL AND erp_private.is_leader() AND erp_private.client_allowed(l.client_id)
 UNION ALL
 SELECT c.client_id,NULL::uuid,e.type_code,'Missing',NULL::date,NULL::integer
  FROM erp_private.clients c JOIN erp_private.licence_expectations e ON e.structure=c.legal_structure AND e.subtype=c.legal_subtype AND e.rule_status<>'Retired'
  WHERE c.deleted_at IS NULL AND erp_private.is_leader() AND erp_private.client_allowed(c.client_id)
   AND NOT EXISTS(SELECT 1 FROM erp_private.client_licences l WHERE l.client_id=c.client_id AND l.licence_type=e.type_code AND l.ended_on IS NULL)
$$;

-- What the audit file may see about one client's licences: type, authority, expiry and state. Never the licence number or the evidence.
-- Open to anyone who can see the client (the audit team needs it), unlike the register itself.
CREATE FUNCTION erp_private.audit_licence_flags(p_client uuid) RETURNS TABLE(licence_type text,label text,authority text,state text,expires_on date,days_left integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT l.licence_type,t.label,l.issuing_authority,erp_private.licence_state(l.expires_on,t.warn_days),l.expires_on,
        l.expires_on-(now() AT TIME ZONE 'Africa/Nairobi')::date
  FROM erp_private.client_licences l JOIN erp_private.licence_types t ON t.type_code=l.licence_type
  WHERE l.client_id=p_client AND l.ended_on IS NULL AND erp_private.client_allowed(p_client)
 UNION ALL
 SELECT e.type_code,t.label,t.authority,'Missing',NULL::date,NULL::integer
  FROM erp_private.clients c JOIN erp_private.licence_expectations e ON e.structure=c.legal_structure AND e.subtype=c.legal_subtype AND e.rule_status<>'Retired'
  JOIN erp_private.licence_types t ON t.type_code=e.type_code
  WHERE c.client_id=p_client AND c.deleted_at IS NULL AND erp_private.client_allowed(p_client)
   AND NOT EXISTS(SELECT 1 FROM erp_private.client_licences l WHERE l.client_id=c.client_id AND l.licence_type=e.type_code AND l.ended_on IS NULL)
 ORDER BY 5 NULLS FIRST
$$;

-- Counts for the go-live checks (Manager or Partner only).
CREATE FUNCTION erp_private.licence_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'licences_expired',count(*) FILTER(WHERE state='Expired'),
  'licences_expiring',count(*) FILTER(WHERE state='Expiring'),
  'expected_licences_missing',count(*) FILTER(WHERE state='Missing'))
 FROM erp_private.licence_summary_all()
$$;

REVOKE EXECUTE ON FUNCTION erp_private.client_licence_guard(),erp_private.licence_state(date,integer),erp_private.licence_summary_all(),erp_private.audit_licence_flags(uuid),erp_private.licence_counts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.licence_state(date,integer),erp_private.licence_summary_all(),erp_private.audit_licence_flags(uuid),erp_private.licence_counts() TO erp_api;
