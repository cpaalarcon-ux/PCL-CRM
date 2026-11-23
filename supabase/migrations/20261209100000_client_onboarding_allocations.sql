-- Client onboarding allocations (access alignment, step 1).
-- A Manager or Partner allocates existing clients to a preparer (Assistant or Supervisor) before any project exists.
-- An active allocation gives that person access to the client's onboarding profile and its proposal workflow, and nothing else:
-- direct client edits stay with Managers and Partners, so changes still go through proposal, independent check and approval.
-- Ending the allocation ends the access (unless the person is also assigned through a project).
CREATE TABLE erp_private.client_onboarding_allocations (
 allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members(staff_id),
 allocated_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id),
 allocated_at timestamptz NOT NULL DEFAULT now(),
 note text,
 source text NOT NULL DEFAULT 'Selected',
 ended_at timestamptz,ended_by uuid REFERENCES erp_private.staff_members(staff_id),end_reason text,
 CHECK((ended_at IS NULL)=(ended_by IS NULL)),
 CHECK(ended_at IS NULL OR length(btrim(COALESCE(end_reason,'')))>=5)
);
CREATE UNIQUE INDEX client_onboarding_allocations_open ON erp_private.client_onboarding_allocations(client_id,staff_id) WHERE ended_at IS NULL;
CREATE INDEX client_onboarding_allocations_staff ON erp_private.client_onboarding_allocations(staff_id) WHERE ended_at IS NULL;
CREATE INDEX client_onboarding_allocations_by ON erp_private.client_onboarding_allocations(allocated_by);
CREATE INDEX client_onboarding_allocations_ended_by ON erp_private.client_onboarding_allocations(ended_by);
ALTER TABLE erp_private.client_onboarding_allocations ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_onboarding_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY onboarding_alloc_read ON erp_private.client_onboarding_allocations FOR SELECT TO erp_api USING(erp_private.is_leader() OR staff_id=(erp_private.actor()).staff_id);
CREATE POLICY onboarding_alloc_add ON erp_private.client_onboarding_allocations FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND allocated_by=(erp_private.actor()).staff_id AND ended_at IS NULL);
CREATE POLICY onboarding_alloc_end ON erp_private.client_onboarding_allocations FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
GRANT SELECT,INSERT,UPDATE ON erp_private.client_onboarding_allocations TO erp_api;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_onboarding_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_onboarding_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('allocation_id');

-- Only an active Assistant or Supervisor can be allocated; an allocation changes only by being ended, once, with a reason.
CREATE FUNCTION erp_private.client_onboarding_allocation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=NEW.staff_id;
  IF s.staff_id IS NULL OR s.deleted_at IS NOT NULL OR s.access_status<>'Active' OR s.category_code NOT IN('ASSISTANT','SUPERVISOR') THEN
   RAISE EXCEPTION 'Only an active Assistant or Supervisor can be allocated a client for onboarding.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.clients WHERE client_id=NEW.client_id AND deleted_at IS NULL) THEN
   RAISE EXCEPTION 'That client is not available.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended allocation is never edited.' USING ERRCODE='23514'; END IF;
 IF NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.allocated_by IS DISTINCT FROM OLD.allocated_by
  OR NEW.allocated_at IS DISTINCT FROM OLD.allocated_at OR NEW.source IS DISTINCT FROM OLD.source OR NEW.note IS DISTINCT FROM OLD.note THEN
  RAISE EXCEPTION 'An allocation changes only by being ended.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_guard BEFORE INSERT OR UPDATE ON erp_private.client_onboarding_allocations FOR EACH ROW EXECUTE FUNCTION erp_private.client_onboarding_allocation_guard();
REVOKE ALL ON FUNCTION erp_private.client_onboarding_allocation_guard() FROM PUBLIC,anon,authenticated,erp_api;

-- Does the signed-in Assistant or Supervisor hold an active allocation for this client, within a firm they work in?
CREATE FUNCTION erp_private.client_onboarding_allocated(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce((erp_private.actor()).category_code IN('ASSISTANT','SUPERVISOR'),false)
 AND EXISTS(SELECT 1 FROM erp_private.client_onboarding_allocations a JOIN erp_private.clients x ON x.client_id=a.client_id
  WHERE a.client_id=c AND a.staff_id=(erp_private.actor()).staff_id AND a.ended_at IS NULL AND x.deleted_at IS NULL
  AND (NOT erp_private.uat_scope_enabled() OR x.is_uat_fixture)
  AND (NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL)
   OR EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id))))
$$;
REVOKE ALL ON FUNCTION erp_private.client_onboarding_allocated(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.client_onboarding_allocated(uuid) TO erp_api;

-- Preparers a Manager or Partner may allocate to: active Assistants and Supervisors who work in at least one firm the signed-in person works in.
-- Staff records are visible only along the reporting line, so this is a narrow function that returns just what the allocation screen needs.
CREATE FUNCTION erp_private.onboarding_preparers() RETURNS TABLE(staff_id uuid,full_name text,category_code text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.staff_id,s.full_name,s.category_code FROM erp_private.staff_members s
 WHERE erp_private.is_leader() AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code IN('ASSISTANT','SUPERVISOR')
 AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND ((erp_private.actor()).category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=s.staff_id AND a.deleted_at IS NULL AND erp_private.firm_allowed(a.firm_id)))
$$;
REVOKE ALL ON FUNCTION erp_private.onboarding_preparers() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.onboarding_preparers() TO erp_api;

-- Does this person work in a firm that handles the client (or has the client no firm yet)? Used when allocating; a Manager cannot read
-- other staff members' firm access directly.
CREATE FUNCTION erp_private.onboarding_staff_fits_client(s uuid,c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.is_leader() AND (NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL)
  OR EXISTS(SELECT 1 FROM erp_private.client_firm_links l JOIN erp_private.staff_firm_access a ON a.firm_id=l.firm_id AND a.staff_id=s AND a.deleted_at IS NULL
   JOIN erp_private.firms f ON f.firm_id=a.firm_id AND f.deleted_at IS NULL AND f.is_active WHERE l.client_id=c AND l.deleted_at IS NULL))
$$;
REVOKE ALL ON FUNCTION erp_private.onboarding_staff_fits_client(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.onboarding_staff_fits_client(uuid,uuid) TO erp_api;

-- The existing client access check gains one path: an active onboarding allocation. Everything else in it is unchanged.
DO $$
DECLARE def text;needle text:='EXISTS(SELECT 1 FROM erp_private.projects e WHERE e.client_id=c AND erp_private.project_allowed(e.project_id)) OR';
BEGIN
 def:=pg_get_functiondef('erp_private.client_allowed(uuid)'::regprocedure);
 IF position(needle IN def)=0 THEN RAISE EXCEPTION 'client_allowed has an unexpected shape; the onboarding allocation path was not added.'; END IF;
 def:=replace(def,needle,needle||E'\n erp_private.client_onboarding_allocated(c) OR');
 EXECUTE def;
END $$;
