CREATE OR REPLACE FUNCTION erp_private.client_account_mapping_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  ac erp_private.account_catalog;
  actor_staff uuid;
  actor_category text;
BEGIN
  actor_staff := (erp_private.actor()).staff_id;
  actor_category := (erp_private.actor()).category_code;

  IF NEW.effective_to IS NOT NULL AND NEW.effective_to < NEW.effective_from THEN
    RAISE EXCEPTION 'Account mapping end date must be on or after its start date' USING ERRCODE='23514';
  END IF;

  SELECT * INTO ac FROM erp_private.account_catalog WHERE code=NEW.erp_account_code;
  IF ac.code IS NULL OR ac.status <> 'Active' OR ac.is_legacy THEN
    RAISE EXCEPTION 'Choose an active ERP account' USING ERRCODE='23514';
  END IF;

  IF TG_OP='INSERT' THEN
    IF NEW.status <> 'Draft' OR NEW.created_by IS DISTINCT FROM actor_staff
       OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Create a draft account mapping; approval is separate' USING ERRCODE='42501';
    END IF;
  ELSE
    IF OLD.status='Active' THEN
      IF (NEW.client_id,NEW.source_account_code,NEW.source_account_name,NEW.erp_account_code,NEW.effective_from,NEW.created_by,NEW.status,NEW.approved_by,NEW.approved_at)
         IS DISTINCT FROM
         (OLD.client_id,OLD.source_account_code,OLD.source_account_name,OLD.erp_account_code,OLD.effective_from,OLD.created_by,OLD.status,OLD.approved_by,OLD.approved_at) THEN
        RAISE EXCEPTION 'An approved client account mapping is immutable; close its date range and add a dated replacement' USING ERRCODE='23514';
      END IF;
      IF NEW.effective_to IS NULL OR
         (OLD.effective_to IS NOT NULL AND NEW.effective_to >= OLD.effective_to) THEN
        RAISE EXCEPTION 'An approved mapping can only be closed to an earlier effective end date' USING ERRCODE='23514';
      END IF;
      IF actor_category NOT IN ('PARTNER','MANAGER') OR actor_staff IS NOT DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'A Manager or Partner other than the creator must close this mapping' USING ERRCODE='42501';
      END IF;
    ELSIF OLD.status <> 'Draft' AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Only a draft mapping can be approved; preserve approved mappings' USING ERRCODE='23514';
    END IF;
  END IF;

  IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'Active') THEN
    IF actor_category NOT IN ('PARTNER','MANAGER') OR NEW.approved_by IS DISTINCT FROM actor_staff
       OR NEW.approved_at IS NULL OR NEW.approved_by=NEW.created_by THEN
      RAISE EXCEPTION 'A different Manager or Partner must approve this client account mapping' USING ERRCODE='42501';
    END IF;
  ELSIF NEW.status<>'Active' AND (NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Draft mappings cannot contain approval details' USING ERRCODE='23514';
  END IF;

  IF NEW.status='Active' AND EXISTS (
    SELECT 1 FROM erp_private.client_account_mappings m
    WHERE m.client_id=NEW.client_id
      AND coalesce(m.source_account_code,'')=coalesce(NEW.source_account_code,'')
      AND m.status='Active'
      AND m.mapping_id<>NEW.mapping_id
      AND m.effective_from<=coalesce(NEW.effective_to,'infinity'::date)
      AND coalesce(m.effective_to,'infinity'::date)>=NEW.effective_from
  ) THEN
    RAISE EXCEPTION 'An approved mapping already covers this source account and date' USING ERRCODE='23505';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION erp_private.client_account_mapping_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_account_mapping_guard() TO erp_api;
