-- No suspense account (4 Nov 2026 UAT). The trial balance must balance; nothing is ever posted to 37000.
-- The row was never used (no lines, no mappings), so it is removed. The existing ledger line guard already rejects any
-- line whose account is missing from the catalog, so an attempt to post to 37000 now fails there too.
-- The no_delete guard is switched off for this one removal only and straight back on; the audit trigger records it.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.ledger_lines WHERE account_code='37000')
  OR EXISTS(SELECT 1 FROM erp_private.client_account_mappings WHERE erp_account_code='37000') THEN
  RAISE EXCEPTION 'Account 37000 is in use; clear it before retiring the suspense account';
 END IF;
END $$;
ALTER TABLE erp_private.account_catalog DISABLE TRIGGER no_delete;
DELETE FROM erp_private.account_catalog WHERE code='37000';
ALTER TABLE erp_private.account_catalog ENABLE TRIGGER no_delete;

CREATE OR REPLACE FUNCTION erp_private.reject_suspense_account() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.code='37000' OR NEW.name ~* 'suspense' THEN RAISE EXCEPTION 'There is no suspense account; the trial balance must balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.reject_suspense_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.reject_suspense_account() TO erp_api;
CREATE TRIGGER reject_suspense_account BEFORE INSERT OR UPDATE ON erp_private.account_catalog FOR EACH ROW EXECUTE FUNCTION erp_private.reject_suspense_account();
