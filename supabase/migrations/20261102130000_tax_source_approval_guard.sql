-- Tax rule approval requires a distinct Partner and independently checked official-source evidence.
ALTER TABLE erp_private.tax_rates
 ADD COLUMN partner_source_verified_on date;

CREATE OR REPLACE FUNCTION erp_private.approved_rule_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=''
AS $$
DECLARE
 v_host text;
BEGIN
 IF NEW.status='Approved' AND OLD.status<>'Approved' THEN
  IF NEW.is_test OR NEW.rate_key ~* '^QA' OR NEW.label ~* '(FICTIONAL|SYNTHETIC TEST)' THEN
   RAISE EXCEPTION 'Test-only rates cannot be approved' USING ERRCODE='23514';
  END IF;
  IF NEW.approved_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN
   RAISE EXCEPTION 'Rate approver identity mismatch' USING ERRCODE='42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NEW.created_by=NEW.approved_by THEN
   RAISE EXCEPTION 'A tax rule preparer cannot approve their own rule' USING ERRCODE='42501';
  END IF;
  v_host:=lower(split_part(split_part(coalesce(NEW.source_url,''),'/',3),':',1));
  IF NEW.source_url !~* '^https://' OR NEW.source_url ~* '^https://[^/]*@'
    OR NOT (
      v_host='kenyalaw.org' OR v_host LIKE '%.kenyalaw.org'
      OR v_host='nssf.or.ke' OR v_host LIKE '%.nssf.or.ke'
      OR v_host='nita.or.ke' OR v_host LIKE '%.nita.or.ke'
      OR v_host LIKE '%.go.ke'
    ) THEN
   RAISE EXCEPTION 'Tax rule approval requires an official Kenya Law, KRA, Gazette or competent regulator URL' USING ERRCODE='23514';
  END IF;
  IF length(btrim(coalesce(NEW.source_note,'')))<20
    OR NEW.source_note !~* '(act|section|legal notice|ln[ .-]|regulation|schedule|gazette|court order|judgment)' THEN
   RAISE EXCEPTION 'Add the applicable Act, section, Legal Notice, regulation, Schedule or Gazette reference' USING ERRCODE='23514';
  END IF;
  IF NEW.partner_source_verified_on IS NULL THEN
   RAISE EXCEPTION 'Record the date the Partner checked the official source' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.rate_key,0));
  IF EXISTS(
   SELECT 1 FROM erp_private.tax_rates r
   WHERE r.rate_key=NEW.rate_key AND r.rate_id<>NEW.rate_id AND r.status='Approved'
    AND r.deleted_at IS NULL AND r.effective_from<=NEW.effective_to AND r.effective_to>=NEW.effective_from
  ) THEN
   RAISE EXCEPTION 'Approved rule periods overlap' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION erp_private.approved_rule_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.approved_rule_guard() TO erp_api;
