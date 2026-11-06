-- Slice 21: bank statement narration rules. A rule maps a keyword in a statement line's reference or description to a ledger
-- account for one client. A preparer proposes a rule; a different Manager or Partner approves it before it is ever applied.
-- A rule cannot be edited: retire it and propose a new one, so every mapping can be traced to the rule text that made it.
CREATE TABLE erp_private.bank_mapping_rules(
 rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 keyword text NOT NULL CHECK(char_length(btrim(keyword)) BETWEEN 3 AND 60),
 match_mode text NOT NULL DEFAULT 'Contains' CHECK(match_mode IN('Contains','Starts with')),
 direction text NOT NULL DEFAULT 'Either' CHECK(direction IN('Money in','Money out','Either')),
 account_code text NOT NULL REFERENCES erp_private.account_catalog(code),
 status text NOT NULL DEFAULT 'Proposed' CHECK(status IN('Proposed','Active','Retired')),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=300),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Active' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by<>created_by))
);
CREATE UNIQUE INDEX bank_mapping_rules_live_uq ON erp_private.bank_mapping_rules(client_id,lower(btrim(keyword)),match_mode,direction) WHERE status<>'Retired';
CREATE INDEX bank_mapping_rules_client_idx ON erp_private.bank_mapping_rules(client_id,status);
CREATE INDEX bank_mapping_rules_account_idx ON erp_private.bank_mapping_rules(account_code);
CREATE INDEX bank_mapping_rules_created_by_idx ON erp_private.bank_mapping_rules(created_by);
CREATE INDEX bank_mapping_rules_reviewed_by_idx ON erp_private.bank_mapping_rules(reviewed_by);

ALTER TABLE erp_private.bank_mapping_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bank_mapping_rules FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.bank_mapping_rules TO erp_api;
CREATE POLICY bank_mapping_rules_read ON erp_private.bank_mapping_rules FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY bank_mapping_rules_insert ON erp_private.bank_mapping_rules FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN' AND created_by=(erp_private.actor()).staff_id AND status='Proposed');
CREATE POLICY bank_mapping_rules_review ON erp_private.bank_mapping_rules FOR UPDATE TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'))
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'));

CREATE OR REPLACE FUNCTION erp_private.bank_mapping_rule_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (NEW.client_id,NEW.keyword,NEW.match_mode,NEW.direction,NEW.account_code,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.client_id,OLD.keyword,OLD.match_mode,OLD.direction,OLD.account_code,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A rule cannot be edited. Retire it and propose a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired rule cannot change.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Active' AND NEW.status<>'Retired' AND NEW.status<>'Active' THEN RAISE EXCEPTION 'An active rule can only be retired.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>OLD.status AND current_user='erp_api' AND (erp_private.actor()).staff_id IS DISTINCT FROM NEW.reviewed_by THEN
  RAISE EXCEPTION 'The reviewer recorded must be the person making this change.' USING ERRCODE='42501';
 END IF;
 NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.bank_mapping_rule_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bank_mapping_rule_guard BEFORE UPDATE ON erp_private.bank_mapping_rules FOR EACH ROW EXECUTE FUNCTION erp_private.bank_mapping_rule_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.bank_mapping_rules FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.bank_mapping_rules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('rule_id');
