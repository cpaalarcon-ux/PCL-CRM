-- Slice 22: statement balance proof at upload, and the client's own non-trade categories for the bank reconciliation summary.
ALTER TABLE erp_private.workbook_batches
 ADD COLUMN statement_opening numeric(18,2),
 ADD COLUMN statement_closing numeric(18,2),
 ADD COLUMN balance_status text CHECK(balance_status IN('Pass','Not checked','Overridden')),
 ADD COLUMN balance_override_reason text CHECK(balance_override_reason IS NULL OR char_length(btrim(balance_override_reason))>=10),
 ADD COLUMN balance_override_by uuid REFERENCES erp_private.staff_members;
CREATE INDEX workbook_batches_balance_override_by_idx ON erp_private.workbook_batches(balance_override_by) WHERE balance_override_by IS NOT NULL;

CREATE TABLE erp_private.bank_summary_categories(
 category_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 name text NOT NULL CHECK(char_length(btrim(name)) BETWEEN 3 AND 80),
 account_codes text[] NOT NULL CHECK(cardinality(account_codes) BETWEEN 1 AND 30),
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=300),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Retired')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 retired_by uuid REFERENCES erp_private.staff_members,
 retired_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Retired' OR (retired_by IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE UNIQUE INDEX bank_summary_categories_name_uq ON erp_private.bank_summary_categories(client_id,lower(btrim(name))) WHERE status='Active';
CREATE INDEX bank_summary_categories_client_idx ON erp_private.bank_summary_categories(client_id);
CREATE INDEX bank_summary_categories_created_by_idx ON erp_private.bank_summary_categories(created_by);
CREATE INDEX bank_summary_categories_retired_by_idx ON erp_private.bank_summary_categories(retired_by);
ALTER TABLE erp_private.bank_summary_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bank_summary_categories FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.bank_summary_categories TO erp_api;
CREATE POLICY bank_summary_categories_read ON erp_private.bank_summary_categories FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY bank_summary_categories_insert ON erp_private.bank_summary_categories FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Active');
CREATE POLICY bank_summary_categories_retire ON erp_private.bank_summary_categories FOR UPDATE TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'))
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE OR REPLACE FUNCTION erp_private.bank_summary_category_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (NEW.client_id,NEW.name,NEW.account_codes,NEW.note,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.client_id,OLD.name,OLD.account_codes,OLD.note,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A category cannot be edited. Retire it and add a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired category cannot change.' USING ERRCODE='23514'; END IF;
 NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.bank_summary_category_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER bank_summary_category_guard BEFORE UPDATE ON erp_private.bank_summary_categories FOR EACH ROW EXECUTE FUNCTION erp_private.bank_summary_category_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.bank_summary_categories FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.bank_summary_categories FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('category_id');
