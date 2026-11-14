-- Statutory layer of the client chart: accounts that only make sense when the client has a tax obligation.
-- 'VAT'  - the client is VAT registered (input/output/net VAT, VAT withholding, non-recoverable VAT).
-- 'PAYE' - the client employs staff (PAYE, SHIF, Housing Levy, NSSF, NITA payables, accrued payroll, employer levies).
-- The tags only decide whether the ERP proposes the account. An account stays usable once it is in an approved chart, and a client whose
-- obligation is not yet confirmed still gets the account, so nothing is hidden on a guess. The tag choices are for Tax Lead confirmation.
ALTER TABLE erp_private.account_catalog
  ADD COLUMN statutory_tags text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT account_catalog_statutory_tags_check CHECK (statutory_tags <@ ARRAY['VAT','PAYE']::text[]);
COMMENT ON COLUMN erp_private.account_catalog.statutory_tags IS 'Tax obligations the account depends on (VAT, PAYE); empty = proposed for every client.';

-- Like entity and industry scope, statutory tags are classification and may change on an Active account.
DO $m$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef('erp_private.accounting_control_guard'::regproc) INTO d;
 d:=replace(d,'ARRAY[''entity_types'',''industry_packs'',''revision'',''updated_at'']','ARRAY[''entity_types'',''industry_packs'',''statutory_tags'',''revision'',''updated_at'']');
 IF position('statutory_tags' IN d)=0 THEN RAISE EXCEPTION 'account_catalog guard was not updated'; END IF;
 EXECUTE d;
END $m$;

UPDATE erp_private.account_catalog SET statutory_tags=ARRAY['VAT']
 WHERE code IN ('10160','10170','21000','21010','21020','21030','50060','51060','69940');
UPDATE erp_private.account_catalog SET statutory_tags=ARRAY['PAYE']
 WHERE code IN ('20020','21600','21601','21602','21603','21604','21610','21611','21612','60050','60060','60070');

-- Obligation rows are readable only by Managers and Partners, but an Assistant or Supervisor proposes the chart. This returns just the
-- position per tag: 'yes' (an obligation is applicable), 'unconfirmed' (to confirm, or no verified tax profile yet) or 'no' (a verified
-- profile covers the date and the obligation is not on it as applicable or to confirm). PAYE stands for payroll: PAYE, NSSF, SHIF, Housing levy, NITA.
CREATE FUNCTION erp_private.client_statutory_status(p_client uuid,p_from date)
RETURNS TABLE(tag text,status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE verified boolean;
BEGIN
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'This record is not available to your account.' USING ERRCODE='42501'; END IF;
 SELECT EXISTS(SELECT 1 FROM erp_private.client_tax_profiles v WHERE v.client_id=p_client AND v.status='Verified' AND v.deleted_at IS NULL AND v.effective_to>=p_from) INTO verified;
 RETURN QUERY
 SELECT x.tag,CASE
   WHEN EXISTS(SELECT 1 FROM erp_private.client_tax_obligations o JOIN erp_private.client_tax_profiles p USING(profile_id)
     WHERE o.client_id=p_client AND o.is_selected AND p.deleted_at IS NULL AND o.effective_to>=p_from AND o.obligation_code=ANY(x.codes) AND o.applicable='YES') THEN 'yes'
   WHEN NOT verified OR EXISTS(SELECT 1 FROM erp_private.client_tax_obligations o JOIN erp_private.client_tax_profiles p USING(profile_id)
     WHERE o.client_id=p_client AND o.is_selected AND p.deleted_at IS NULL AND o.effective_to>=p_from AND o.obligation_code=ANY(x.codes) AND o.applicable='TO_CONFIRM') THEN 'unconfirmed'
   ELSE 'no' END
 FROM (VALUES ('VAT',ARRAY['VAT']),('PAYE',ARRAY['PAYE','NSSF','SHIF','Housing levy','NITA'])) AS x(tag,codes);
END $$;
REVOKE ALL ON FUNCTION erp_private.client_statutory_status(uuid,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_statutory_status(uuid,date) TO erp_api;
