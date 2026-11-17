-- Build 2856: POCAMLA applicability per service. The MLRO says, for each service in the catalogue, whether AML questions or an MLRO referral apply.
-- Nothing is decided for the MLRO: a service with no live rule shows as "MLRO has not decided". Rules are never edited; a change ends the old rule with a reason
-- and records a new one. Setting a service up for a client raises one flag per client, service and rule, for the MLRO queue. Flags never change.
CREATE TABLE erp_private.aml_service_rules(
 rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_code text NOT NULL REFERENCES erp_private.services(service_code) ON DELETE RESTRICT,
 applicability text NOT NULL CHECK(applicability IN('Not relevant','Ask AML questions','Refer to the MLRO')),
 activities text[] NOT NULL DEFAULT '{}' CHECK(cardinality(activities)<=40),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 5 AND 500),
 source text NOT NULL CHECK(char_length(btrim(source)) BETWEEN 3 AND 300),
 effective_from date NOT NULL DEFAULT current_date,
 set_by uuid NOT NULL REFERENCES erp_private.staff_members,set_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 CHECK((ended_by IS NULL)=(ended_at IS NULL) AND (ended_at IS NULL)=(ended_reason IS NULL))
);
CREATE UNIQUE INDEX aml_service_rules_live_uidx ON erp_private.aml_service_rules(service_code) WHERE ended_at IS NULL;
CREATE INDEX aml_service_rules_set_by_idx ON erp_private.aml_service_rules(set_by);
CREATE INDEX aml_service_rules_ended_by_idx ON erp_private.aml_service_rules(ended_by) WHERE ended_by IS NOT NULL;
CREATE FUNCTION erp_private.aml_service_rules_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended rule is history and cannot change.' USING ERRCODE='23514'; END IF;
  IF (NEW.rule_id,NEW.service_code,NEW.applicability,NEW.activities,NEW.reason,NEW.source,NEW.effective_from,NEW.set_by,NEW.set_at) IS DISTINCT FROM (OLD.rule_id,OLD.service_code,OLD.applicability,OLD.activities,OLD.reason,OLD.source,OLD.effective_from,OLD.set_by,OLD.set_at)
   THEN RAISE EXCEPTION 'A rule is not edited. End it with a reason and record a new one.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aml_service_rules_guard BEFORE INSERT OR UPDATE ON erp_private.aml_service_rules FOR EACH ROW EXECUTE FUNCTION erp_private.aml_service_rules_guard();

CREATE TABLE erp_private.aml_service_flags(
 flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 service_code text NOT NULL REFERENCES erp_private.services(service_code) ON DELETE RESTRICT,
 rule_id uuid NOT NULL REFERENCES erp_private.aml_service_rules ON DELETE RESTRICT,
 setup_id uuid REFERENCES erp_private.engagement_setups ON DELETE RESTRICT,
 applicability text NOT NULL CHECK(applicability IN('Ask AML questions','Refer to the MLRO')),
 raised_by uuid NOT NULL REFERENCES erp_private.staff_members,raised_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,service_code,rule_id)
);
CREATE INDEX aml_service_flags_rule_idx ON erp_private.aml_service_flags(rule_id);
CREATE INDEX aml_service_flags_setup_idx ON erp_private.aml_service_flags(setup_id) WHERE setup_id IS NOT NULL;
CREATE INDEX aml_service_flags_raised_by_idx ON erp_private.aml_service_flags(raised_by);
CREATE INDEX aml_service_flags_service_idx ON erp_private.aml_service_flags(service_code);

ALTER TABLE erp_private.aml_service_rules ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_service_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aml_service_flags ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_service_flags FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.aml_service_rules TO erp_api;
GRANT SELECT,INSERT ON erp_private.aml_service_flags TO erp_api;
CREATE POLICY aml_service_rules_read ON erp_private.aml_service_rules FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY aml_service_rules_insert ON erp_private.aml_service_rules FOR INSERT TO erp_api WITH CHECK(erp_private.is_mlro() AND set_by=(erp_private.actor()).staff_id);
CREATE POLICY aml_service_rules_update ON erp_private.aml_service_rules FOR UPDATE TO erp_api USING(erp_private.is_mlro()) WITH CHECK(erp_private.is_mlro());
CREATE POLICY aml_service_flags_read ON erp_private.aml_service_flags FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) OR erp_private.is_mlro());
CREATE POLICY aml_service_flags_insert ON erp_private.aml_service_flags FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND raised_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aml_service_rules FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.aml_service_flags_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'An AML service flag is a record and is not changed or removed.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.aml_service_flags FOR EACH ROW EXECUTE FUNCTION erp_private.aml_service_flags_immutable();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aml_service_rules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('rule_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.aml_service_flags FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('flag_id');

-- A person's name for an approval trail. Staff records are visible only for oneself and one's reports, so a plain join would hide a colleague's decision
-- from the person reading the trail. Only a signed-in staff member gets a name, and only the name.
CREATE FUNCTION erp_private.aml_staff_name(s uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.full_name FROM erp_private.staff_members m WHERE m.staff_id=s AND (erp_private.actor()).staff_id IS NOT NULL
$$;
REVOKE ALL ON FUNCTION erp_private.aml_staff_name(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.aml_staff_name(uuid) TO erp_api;
