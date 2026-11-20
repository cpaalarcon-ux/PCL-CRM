-- Slice 20: per-client bank accounts. Each bank, savings or mobile-money account a client uses is registered once and linked to
-- one ledger account in the client's chart. Bank statements are tied to the bank they came from, so the bank-close checks
-- compare each statement with its own ledger account. Only the last four digits of an account number are stored.

-- Accounts that exist for the Manager to add on request and are never proposed automatically.
ALTER TABLE erp_private.account_catalog ADD COLUMN proposed boolean NOT NULL DEFAULT true;

-- Additional bank accounts so a client with several banks can give each its own ledger account. Draft until a Partner approves.
INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,proposed)
SELECT code,name,'Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Bank statements / reconciliation','Add to a client chart only when the client holds more than one bank or mobile-money account',false,null,'COA-2026-11-07-BANKS','Draft',false
FROM (VALUES
 ('10021','Bank - additional account 1'),('10022','Bank - additional account 2'),('10023','Bank - additional account 3'),('10024','Bank - additional account 4'),
 ('10025','Bank - additional account 5'),('10026','Bank - additional account 6'),('10027','Bank - additional account 7'),('10028','Bank - additional account 8')
) AS v(code,name);

CREATE TABLE erp_private.client_bank_accounts(
 bank_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 bank_name text NOT NULL CHECK(btrim(bank_name)<>'' AND char_length(bank_name)<=120),
 account_label text NOT NULL DEFAULT '' CHECK(char_length(account_label)<=120),
 account_last4 text NOT NULL DEFAULT '' CHECK(account_last4='' OR account_last4 ~ '^[0-9A-Za-z]{4}$'),
 kind text NOT NULL CHECK(kind IN('Bank current','Bank savings','Mobile money','Overdraft','Other')),
 gl_code text NOT NULL REFERENCES erp_private.account_catalog(code),
 currency text NOT NULL DEFAULT 'KES' CHECK(currency IN('KES','USD','EUR','GBP')),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Closed')),
 opened_on date,
 closed_on date,
 note text NOT NULL DEFAULT '' CHECK(char_length(note)<=500),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(closed_on IS NULL OR opened_on IS NULL OR closed_on>=opened_on),
 CHECK(status<>'Closed' OR closed_on IS NOT NULL)
);
-- One live bank account per ledger account for a client, so a statement can be compared with exactly one ledger account.
CREATE UNIQUE INDEX client_bank_accounts_gl_uq ON erp_private.client_bank_accounts(client_id,gl_code) WHERE status='Active';
CREATE INDEX client_bank_accounts_client_idx ON erp_private.client_bank_accounts(client_id);
CREATE INDEX client_bank_accounts_gl_idx ON erp_private.client_bank_accounts(gl_code);
CREATE INDEX client_bank_accounts_created_by_idx ON erp_private.client_bank_accounts(created_by);
CREATE INDEX client_bank_accounts_updated_by_idx ON erp_private.client_bank_accounts(updated_by);

ALTER TABLE erp_private.client_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_bank_accounts FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_bank_accounts TO erp_api;
CREATE POLICY client_bank_accounts_read ON erp_private.client_bank_accounts FOR SELECT TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY client_bank_accounts_insert ON erp_private.client_bank_accounts FOR INSERT TO erp_api
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN' AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY client_bank_accounts_update ON erp_private.client_bank_accounts FOR UPDATE TO erp_api
 USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>'INTERN');

CREATE OR REPLACE FUNCTION erp_private.client_bank_account_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.client_id<>OLD.client_id OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN RAISE EXCEPTION 'A bank account record cannot be moved to another client.'; END IF;
 -- Once statements or postings depend on the ledger account link it cannot be pointed elsewhere; close the account and add a new one.
 IF NEW.gl_code<>OLD.gl_code AND EXISTS(SELECT 1 FROM erp_private.workbook_batches b WHERE b.bank_account_id=OLD.bank_account_id) THEN
  RAISE EXCEPTION 'Statements are already linked to this bank account. Close it and add a new bank account for the new ledger account.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Closed' AND NEW.status<>'Closed' THEN RAISE EXCEPTION 'A closed bank account cannot be reopened. Add a new bank account.' USING ERRCODE='23514'; END IF;
 NEW.revision:=OLD.revision+1;NEW.updated_at:=now();
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.client_bank_account_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER client_bank_account_guard BEFORE UPDATE ON erp_private.client_bank_accounts FOR EACH ROW EXECUTE FUNCTION erp_private.client_bank_account_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_bank_accounts FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.client_bank_accounts FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('bank_account_id');

-- A bank statement belongs to one registered bank. Batches stay append-only; the link is set when the statement is imported.
ALTER TABLE erp_private.workbook_batches ADD COLUMN bank_account_id uuid REFERENCES erp_private.client_bank_accounts;
CREATE INDEX workbook_batches_bank_account_idx ON erp_private.workbook_batches(bank_account_id) WHERE bank_account_id IS NOT NULL;
