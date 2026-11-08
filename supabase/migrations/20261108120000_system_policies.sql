-- Partner policy sign-off (staging). Until the Partner signs "Audit Assistant Data Entry Policy" in the ERP, an Assistant cannot propose client data.
-- Only a Partner may sign or withdraw a policy. The statement and name cannot be edited. Nothing is deleted; every change is audit-logged.
CREATE TABLE erp_private.system_policies (
 policy_code text PRIMARY KEY CHECK(policy_code ~ '^[A-Z_]{3,60}$'),
 policy_name text NOT NULL,
 statement text NOT NULL,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN('Pending','Signed_Off')),
 signed_by uuid REFERENCES erp_private.staff_members,
 signed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Signed_Off' AND signed_by IS NOT NULL AND signed_at IS NOT NULL) OR (status='Pending' AND signed_by IS NULL AND signed_at IS NULL))
);
INSERT INTO erp_private.system_policies(policy_code,policy_name,statement) VALUES
 ('ASSISTANT_DATA_ENTRY','Audit Assistant Data Entry Policy','I authorize Audit Assistants to enter client data (KYC, Tax Profiles, TBs) prior to Manager/Partner review.');

CREATE FUNCTION erp_private.system_policies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me erp_private.staff_members;
BEGIN
 IF NEW.policy_code IS DISTINCT FROM OLD.policy_code OR NEW.policy_name IS DISTINCT FROM OLD.policy_name OR NEW.statement IS DISTINCT FROM OLD.statement THEN
  RAISE EXCEPTION 'A policy statement cannot be edited.';
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 me:=erp_private.actor();
 IF me.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can sign off or withdraw a policy.'; END IF;
 IF NEW.status='Signed_Off' THEN NEW.signed_by:=me.staff_id;NEW.signed_at:=now(); ELSE NEW.signed_by:=NULL;NEW.signed_at:=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER system_policies_guard BEFORE UPDATE ON erp_private.system_policies FOR EACH ROW EXECUTE FUNCTION erp_private.system_policies_guard();
ALTER TABLE erp_private.system_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.system_policies FORCE ROW LEVEL SECURITY;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.system_policies FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.system_policies FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('policy_code');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.system_policies FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
GRANT SELECT,UPDATE ON erp_private.system_policies TO erp_api;
CREATE POLICY system_policies_read ON erp_private.system_policies FOR SELECT TO erp_api USING(true);
CREATE POLICY system_policies_partner_update ON erp_private.system_policies FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
