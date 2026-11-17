-- Build 2868: licence-driven expense accounts. A client that holds a licence (recorded in the licence register) is proposed the account that carries that licence's fees.
-- The link is data kept here, not a rule in code. Every new account is a Draft until a Partner approves it, and none carries a tax rate or a tax decision.
-- A licence the client has ended is not counted. Which licence a client holds is read through a function that checks the person may open the client, because the register itself is for Managers and Partners.
CREATE TABLE erp_private.licence_type_accounts(
 type_code text NOT NULL REFERENCES erp_private.licence_types,
 account_code text NOT NULL REFERENCES erp_private.account_catalog,
 note text NOT NULL DEFAULT '',
 PRIMARY KEY(type_code,account_code)
);
CREATE INDEX licence_type_accounts_account_idx ON erp_private.licence_type_accounts(account_code);
ALTER TABLE erp_private.licence_type_accounts ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.licence_type_accounts FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.licence_type_accounts TO erp_api;
CREATE POLICY licence_type_accounts_read ON erp_private.licence_type_accounts FOR SELECT TO erp_api USING(true);

INSERT INTO erp_private.account_catalog
  (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-21-LICENCE','Draft'
FROM (VALUES
 ('61500','Transport licence and permit fees','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Licence and permit receipts','Fees for transport licences and permits held by the client'),
 ('61510','County business permit and licence fees','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','County permit receipts','Single business permit and other county licence fees'),
 ('61520','Co-operative regulator licence and levy fees','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Regulator receipts and levy notices','Licence fees and levies paid to the co-operative regulator')
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes)
ON CONFLICT (code) DO NOTHING;
INSERT INTO erp_private.account_statement_map(account_code,line_code,effective_from,reason)
SELECT code,'PL.OTHER_OPEX',DATE '2025-01-01','Provisional: licence fee account; awaiting Partner approval' FROM (VALUES('61500'),('61510'),('61520')) AS m(code)
WHERE NOT EXISTS(SELECT 1 FROM erp_private.account_statement_map s WHERE s.account_code=m.code);

INSERT INTO erp_private.licence_type_accounts(type_code,account_code,note) VALUES
 ('EPRA','61470','Energy and petroleum licence and permit fees'),
 ('NTSA','61500','Transport licence and permit fees'),
 ('COUNTY_PERMIT','61510','County permit fees'),
 ('SACCO_LICENCE','61520','Regulator licence and levy fees');

-- The licence types a client holds today, for the chart proposal. Open licences only; the person must be able to open the client.
CREATE FUNCTION erp_private.client_licence_types(p_client uuid) RETURNS TABLE(type_code text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'This record is not available to your account.' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT DISTINCT l.licence_type FROM erp_private.client_licences l WHERE l.client_id=p_client AND l.ended_on IS NULL;
END $$;
REVOKE ALL ON FUNCTION erp_private.client_licence_types(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_licence_types(uuid) TO erp_api;
