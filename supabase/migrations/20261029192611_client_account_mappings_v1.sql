CREATE TABLE erp_private.client_account_mappings (
 mapping_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id) ON DELETE RESTRICT,
 source_account_code text CHECK(source_account_code IS NULL OR length(btrim(source_account_code))>0),
 source_account_name text NOT NULL CHECK(length(btrim(source_account_name))>0),
 erp_account_code text NOT NULL REFERENCES erp_private.account_catalog(code) ON DELETE RESTRICT,
 effective_from date NOT NULL,
 effective_to date CHECK(effective_to IS NULL OR effective_to>=effective_from),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Active','Inactive')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 approved_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 approved_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status='Draft' AND approved_by IS NULL AND approved_at IS NULL)
    OR (status='Active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR status='Inactive')
);

CREATE UNIQUE INDEX client_account_source_start_idx
 ON erp_private.client_account_mappings(client_id,coalesce(source_account_code,''),effective_from);
CREATE INDEX client_account_code_date_idx
 ON erp_private.client_account_mappings(client_id,erp_account_code,effective_from,effective_to)
 WHERE status='Active';

ALTER TABLE erp_private.client_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_account_mappings FORCE ROW LEVEL SECURITY;
CREATE POLICY client_account_map_read ON erp_private.client_account_mappings
 FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY client_account_map_write ON erp_private.client_account_mappings
 FOR ALL TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

CREATE OR REPLACE FUNCTION erp_private.client_account_mapping_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE ac erp_private.account_catalog; actor_staff uuid; actor_category text;
BEGIN
 actor_staff := (erp_private.actor()).staff_id;
 actor_category := (erp_private.actor()).category_code;
 IF NEW.effective_to IS NOT NULL AND NEW.effective_to<NEW.effective_from THEN
  RAISE EXCEPTION 'Account mapping end date must be on or after its start date' USING ERRCODE='23514';
 END IF;
 SELECT * INTO ac FROM erp_private.account_catalog WHERE code=NEW.erp_account_code;
 IF ac.code IS NULL OR ac.status<>'Active' OR ac.is_legacy THEN
  RAISE EXCEPTION 'Choose an active ERP account' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM actor_staff
     OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
   RAISE EXCEPTION 'Create a draft account mapping; approval is separate' USING ERRCODE='42501';
  END IF;
 ELSE
  IF OLD.status='Active' AND
   (NEW.client_id,NEW.source_account_code,NEW.source_account_name,NEW.erp_account_code,NEW.effective_from,NEW.effective_to,NEW.created_by)
   IS DISTINCT FROM
   (OLD.client_id,OLD.source_account_code,OLD.source_account_name,OLD.erp_account_code,OLD.effective_from,OLD.effective_to,OLD.created_by) THEN
   RAISE EXCEPTION 'An approved client account mapping is immutable; add a dated correction' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'Draft' AND NEW.status<>OLD.status THEN
   RAISE EXCEPTION 'Only a draft mapping can be approved; preserve approved mappings' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.status='Active' THEN
  IF actor_category NOT IN ('PARTNER','MANAGER') OR NEW.approved_by IS DISTINCT FROM actor_staff
     OR NEW.approved_at IS NULL OR NEW.approved_by=NEW.created_by THEN
   RAISE EXCEPTION 'A different Manager or Partner must approve this client account mapping' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM erp_private.client_account_mappings m
    WHERE m.client_id=NEW.client_id
      AND coalesce(m.source_account_code,'')=coalesce(NEW.source_account_code,'')
      AND m.status='Active' AND m.mapping_id<>NEW.mapping_id
      AND m.effective_from<=coalesce(NEW.effective_to,'infinity'::date)
      AND coalesce(m.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'An approved mapping already covers this source account and date' USING ERRCODE='23505';
  END IF;
 ELSE
  IF NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
   RAISE EXCEPTION 'Draft mappings cannot contain approval details' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$function$;

CREATE TRIGGER client_account_mapping_guard BEFORE INSERT OR UPDATE
 ON erp_private.client_account_mappings
 FOR EACH ROW EXECUTE FUNCTION erp_private.client_account_mapping_guard();
CREATE TRIGGER revision BEFORE UPDATE ON erp_private.client_account_mappings
 FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_account_mappings
 FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.client_account_mappings
 FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('mapping_id');

REVOKE ALL ON erp_private.client_account_mappings FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_account_mappings TO erp_api;
REVOKE ALL ON FUNCTION erp_private.client_account_mapping_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_account_mapping_guard() TO erp_api;
