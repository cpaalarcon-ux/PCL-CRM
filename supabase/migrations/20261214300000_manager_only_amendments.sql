-- Only a Manager or an Engagement Partner starts an amendment of a filed return. The server already checks this; the database repeats it
-- so no other route can create an amendment case for a signed-in Supervisor, Assistant or Intern. System work with no signed-in person is not affected.
CREATE FUNCTION erp_private.tax_amendment_starter_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 IF NEW.amends_case_id IS NULL THEN RETURN NEW; END IF;
 a:=erp_private.actor();
 IF a.staff_id IS NOT NULL AND a.category_code NOT IN('MANAGER','PARTNER') THEN
  RAISE EXCEPTION 'Only a Manager or a Partner can start an amendment of a filed return.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.tax_amendment_starter_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_amendment_starter_guard() TO erp_api;
CREATE TRIGGER amendment_authority_guard BEFORE INSERT ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_amendment_starter_guard();
