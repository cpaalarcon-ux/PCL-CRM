-- Firm-scoped lead intake. Conversion prepares a CRM record, never activates a job.
CREATE TABLE erp_private.leads (
 lead_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL UNIQUE,
 firm_id uuid NOT NULL REFERENCES erp_private.firms, company_name text NOT NULL CHECK(length(trim(company_name)) BETWEEN 1 AND 200),
 kra_pin text CHECK(kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'), contact_name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 primary_sector text NOT NULL, branch_location text NOT NULL CHECK(branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
 service_code text NOT NULL REFERENCES erp_private.services, lead_source text NOT NULL CHECK(lead_source IN ('Referral','Website','Networking','Existing Client (Cross-sell)','Tender','Other')),
 temperature text NOT NULL DEFAULT 'Cold' CHECK(temperature IN ('Cold','Warm','Hot')),
 stage text NOT NULL DEFAULT 'New Lead' CHECK(stage IN ('New Lead','Contacted','Scoping & KYC','Proposal Sent','Negotiation','Accepted','Lost','Converted')),
 potential_pie boolean GENERATED ALWAYS AS (primary_sector IN ('Financial Services','Public Sector')) STORED,
 owner_id uuid NOT NULL REFERENCES erp_private.staff_members, notes text NOT NULL DEFAULT '', followup_date date,
 client_id uuid REFERENCES erp_private.clients, converted_at timestamptz, revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz,
 CHECK((stage='Converted')=(client_id IS NOT NULL AND converted_at IS NOT NULL))
);
CREATE INDEX lead_pipeline ON erp_private.leads(firm_id,stage,followup_date) WHERE deleted_at IS NULL;
ALTER TABLE erp_private.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.leads FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.leads TO erp_api;
CREATE POLICY leads_read ON erp_private.leads FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.is_leader() AND erp_private.firm_allowed(firm_id) AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm')));
CREATE POLICY leads_add ON erp_private.leads FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(firm_id) AND owner_id=(erp_private.actor()).staff_id AND stage<>'Converted' AND client_id IS NULL);
CREATE POLICY leads_update ON erp_private.leads FOR UPDATE TO erp_api USING(deleted_at IS NULL AND erp_private.is_leader() AND erp_private.firm_allowed(firm_id) AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm'))) WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(firm_id));
CREATE FUNCTION erp_private.lead_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.firm_id IS DISTINCT FROM OLD.firm_id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.request_id IS DISTINCT FROM OLD.request_id THEN RAISE EXCEPTION 'Lead ownership and handling firm are fixed; create a separate lead' USING ERRCODE='23514';END IF;
 IF OLD.stage='Converted' THEN RAISE EXCEPTION 'This lead is converted; update the linked client' USING ERRCODE='23514';END IF;
 IF NEW.client_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=NEW.client_id AND l.firm_id=NEW.firm_id AND l.deleted_at IS NULL) THEN RAISE EXCEPTION 'Client must be linked to the same handling firm' USING ERRCODE='23514';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER lead_guard BEFORE UPDATE ON erp_private.leads FOR EACH ROW EXECUTE FUNCTION erp_private.lead_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.leads FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.leads FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('lead_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.leads FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
REVOKE ALL ON FUNCTION erp_private.lead_guard() FROM PUBLIC;
