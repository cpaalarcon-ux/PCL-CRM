-- Auto-mapping hardening: a dated supplier override. A Manager or Partner who removes an automatic mapping can record that the
-- same supplier (by PIN) must not be mapped to the same account automatically again for invoices dated on or after a date.
-- Rules are ended, never deleted. No tax treatment is stored here.
CREATE TABLE erp_private.supplier_mapping_blocks(
 block_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 party_pin text NOT NULL CHECK(party_pin=upper(btrim(party_pin)) AND length(party_pin)>0),
 account_code text NOT NULL REFERENCES erp_private.account_catalog,
 effective_from date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason))>=10),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 ended_by uuid REFERENCES erp_private.staff_members,
 end_reason text,
 CHECK((ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL) OR (ended_at IS NOT NULL AND ended_by IS NOT NULL AND length(btrim(coalesce(end_reason,'')))>=10))
);
CREATE UNIQUE INDEX supplier_mapping_blocks_active_idx ON erp_private.supplier_mapping_blocks(client_id,party_pin,account_code) WHERE ended_at IS NULL;
CREATE INDEX supplier_mapping_blocks_client_idx ON erp_private.supplier_mapping_blocks(client_id);
COMMENT ON TABLE erp_private.supplier_mapping_blocks IS 'Dated supplier overrides: stops automatic mapping of a supplier to one account for invoices on or after effective_from, until a Manager or Partner ends the rule.';

ALTER TABLE erp_private.supplier_mapping_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.supplier_mapping_blocks FORCE ROW LEVEL SECURITY;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.supplier_mapping_blocks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.supplier_mapping_blocks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('block_id');
REVOKE ALL ON erp_private.supplier_mapping_blocks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.supplier_mapping_blocks TO erp_api;
CREATE POLICY supplier_block_read ON erp_private.supplier_mapping_blocks FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY supplier_block_add ON erp_private.supplier_mapping_blocks FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN ('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY supplier_block_end ON erp_private.supplier_mapping_blocks FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN ('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN ('PARTNER','MANAGER'));

-- A rule can only be ended: its supplier, account, date and reason never change, and an ended rule stays ended.
CREATE FUNCTION erp_private.supplier_mapping_block_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (NEW.block_id,NEW.client_id,NEW.party_pin,NEW.account_code,NEW.effective_from,NEW.reason,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM (OLD.block_id,OLD.client_id,OLD.party_pin,OLD.account_code,OLD.effective_from,OLD.reason,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A supplier mapping rule cannot be edited. End it and record a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.ended_at IS NOT NULL AND (NEW.ended_at,NEW.ended_by,NEW.end_reason) IS DISTINCT FROM (OLD.ended_at,OLD.ended_by,OLD.end_reason) THEN
  RAISE EXCEPTION 'This supplier mapping rule has already ended.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.supplier_mapping_block_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER supplier_mapping_block_guard BEFORE UPDATE ON erp_private.supplier_mapping_blocks FOR EACH ROW EXECUTE FUNCTION erp_private.supplier_mapping_block_guard();
