CREATE OR REPLACE FUNCTION erp_private.actor() RETURNS erp_private.staff_members
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s FROM erp_private.staff_members s JOIN erp_private.pilot_sessions p ON p.staff_id=s.staff_id
 JOIN auth.sessions a ON a.id=p.session_id AND a.user_id=s.auth_user_id
 WHERE auth.uid() IS NOT NULL AND s.auth_user_id=auth.uid() AND p.session_id=(auth.jwt()->>'session_id')::uuid
 AND s.access_status='Active' AND s.deleted_at IS NULL
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND p.revoked_at IS NULL AND p.expires_at>now() AND p.last_seen_at>now()-interval '1 hour'
 AND p.issued_at>=s.sessions_invalid_before LIMIT 1
$$;
CREATE FUNCTION erp_private.project_editor() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR'),false)
$$;
-- Return only assignment-directory fields, never HR/credential/financial fields.
CREATE FUNCTION erp_private.assignment_candidates() RETURNS TABLE(staff_id uuid,full_name text,category_code text,firm_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.staff_id,s.full_name,s.category_code,f.firm_id FROM erp_private.staff_members s
 JOIN erp_private.staff_firm_access f ON f.staff_id=s.staff_id AND f.deleted_at IS NULL
 WHERE auth.uid() IS NOT NULL AND (erp_private.actor()).staff_id IS NOT NULL
 AND (erp_private.project_editor() OR s.category_code IN ('PARTNER','MANAGER','SUPERVISOR'))
 AND erp_private.firm_allowed(f.firm_id) AND s.deleted_at IS NULL AND s.access_status<>'Inactive'
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
$$;
CREATE FUNCTION erp_private.assignable(s uuid,f uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.assignment_candidates() a WHERE a.staff_id=s AND a.firm_id=f)
$$;
CREATE OR REPLACE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL AND (erp_private.actor()).category_code<>'INTERN'
 AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code='PARTNER'
 OR (erp_private.project_editor() AND e.owner_staff_id=(erp_private.actor()).staff_id)
 OR EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id)))
 OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=(erp_private.actor()).staff_id
 AND f.firm_id=e.handling_firm_id AND f.deleted_at IS NULL AND f.scope='Firm' AND erp_private.is_leader())))
$$;
DROP POLICY projects_insert ON erp_private.projects;
DROP POLICY projects_update ON erp_private.projects;
DROP POLICY assignments_insert ON erp_private.project_assignments;
DROP POLICY assignments_update ON erp_private.project_assignments;
DROP POLICY tasks_insert ON erp_private.tasks;
CREATE POLICY projects_insert ON erp_private.projects FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND owner_staff_id=(erp_private.actor()).staff_id AND erp_private.client_allowed(client_id) AND erp_private.firm_allowed(handling_firm_id));
CREATE POLICY projects_update ON erp_private.projects FOR UPDATE TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));
CREATE POLICY assignments_insert ON erp_private.project_assignments FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id) AND erp_private.assignable(staff_id,handling_firm_id));
CREATE POLICY assignments_update ON erp_private.project_assignments FOR UPDATE TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id) AND erp_private.assignable(staff_id,handling_firm_id));
CREATE POLICY tasks_insert ON erp_private.tasks FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));

ALTER TABLE erp_private.tasks ADD COLUMN requires_document boolean NOT NULL DEFAULT false,
 ADD COLUMN period_start date, ADD COLUMN period_end date, ADD COLUMN template_key text,
 ADD COLUMN schedule_version integer, ADD COLUMN filing_date date;
CREATE OR REPLACE FUNCTION erp_private.pilot_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='staff_members' AND TG_OP='UPDATE' THEN
  IF (NEW.staff_id,NEW.staff_identifier,NEW.auth_user_id,NEW.login_id,NEW.sessions_invalid_before,NEW.manager_id)
   IS DISTINCT FROM (OLD.staff_id,OLD.staff_identifier,OLD.auth_user_id,OLD.login_id,OLD.sessions_invalid_before,OLD.manager_id) THEN
   RAISE EXCEPTION 'Identity and reporting-line changes require the account service' USING ERRCODE='42501'; END IF;
  IF (erp_private.actor()).category_code='MANAGER' AND (OLD.category_code IN ('PARTNER','MANAGER') OR NEW.category_code IN ('PARTNER','MANAGER')) THEN
   RAISE EXCEPTION 'Managers cannot grant elevated staff categories' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='tasks' THEN
  IF (NEW.project_id,NEW.task_id,NEW.recurring_key,NEW.period_start,NEW.period_end,NEW.template_key,NEW.schedule_version)
   IS DISTINCT FROM (OLD.project_id,OLD.task_id,OLD.recurring_key,OLD.period_start,OLD.period_end,OLD.template_key,OLD.schedule_version) THEN
   RAISE EXCEPTION 'Task identity and generated period cannot change' USING ERRCODE='42501'; END IF;
  IF NOT erp_private.project_editor() AND (to_jsonb(NEW)-ARRAY['status','blocked_reason','filing_date','updated_at','revision'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','blocked_reason','filing_date','updated_at','revision']) THEN
   RAISE EXCEPTION 'Only task progress may be changed' USING ERRCODE='42501'; END IF;
  IF NEW.status='Completed' AND NEW.template_key IN ('monthly-paye','monthly-vat','monthly-tot') AND NEW.filing_date IS NULL THEN
   RAISE EXCEPTION 'Record the actual filing date' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;


REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;;

