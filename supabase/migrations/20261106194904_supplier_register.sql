-- Slice 19: supplier register. A supplier is a sub-account of the single Trade payables control account (20000): the
-- register never creates a general-ledger account per supplier. Suppliers are kept per client, keyed by KRA PIN.
CREATE TABLE erp_private.suppliers(
 supplier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 name text NOT NULL CHECK(btrim(name)<>'' AND char_length(name)<=200),
 kra_pin text NOT NULL DEFAULT '' CHECK(kra_pin='' OR kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 aliases text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK(cardinality(aliases)<=20),
 currency text NOT NULL DEFAULT 'KES' CHECK(currency IN('KES','USD','EUR','GBP')),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Inactive')),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=500),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX suppliers_client_pin_uq ON erp_private.suppliers(client_id,kra_pin) WHERE kra_pin<>'';
CREATE UNIQUE INDEX suppliers_client_name_uq ON erp_private.suppliers(client_id,lower(btrim(name)));
CREATE INDEX suppliers_created_by_idx ON erp_private.suppliers(created_by);
CREATE INDEX suppliers_updated_by_idx ON erp_private.suppliers(updated_by);

ALTER TABLE erp_private.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.suppliers FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.suppliers TO erp_api;
CREATE POLICY suppliers_read ON erp_private.suppliers FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY suppliers_insert ON erp_private.suppliers FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN' AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY suppliers_update ON erp_private.suppliers FOR UPDATE TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');

-- Identity of a supplier record cannot be moved to another client or re-attributed.
CREATE OR REPLACE FUNCTION erp_private.supplier_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.client_id<>OLD.client_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'A supplier record cannot be moved to another client.'; END IF;
 NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.supplier_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER supplier_guard BEFORE UPDATE ON erp_private.suppliers FOR EACH ROW EXECUTE FUNCTION erp_private.supplier_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.suppliers FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.suppliers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('supplier_id');
