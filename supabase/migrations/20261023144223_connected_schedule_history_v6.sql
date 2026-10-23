-- Keep current-period releases when a schedule changes before the filing month.
CREATE TABLE erp_private.project_schedule_history (LIKE erp_private.project_schedules INCLUDING DEFAULTS);
ALTER TABLE erp_private.project_schedule_history ADD PRIMARY KEY(project_id,version),
 ADD FOREIGN KEY(project_id) REFERENCES erp_private.projects;
ALTER TABLE erp_private.project_schedule_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.project_schedule_history FORCE ROW LEVEL SECURITY;
CREATE POLICY schedule_history_read ON erp_private.project_schedule_history FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY schedule_history_append ON erp_private.project_schedule_history FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));
REVOKE ALL ON erp_private.project_schedule_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.project_schedule_history TO erp_api;
CREATE TRIGGER history_immutable BEFORE UPDATE OR DELETE ON erp_private.project_schedule_history FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
CREATE FUNCTION erp_private.preserve_schedule() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE previous erp_private.project_schedules;
BEGIN
 previous:=OLD;previous.ends_on:=least(previous.ends_on,NEW.effective_from-1);
 IF previous.ends_on>=previous.starts_on THEN INSERT INTO erp_private.project_schedule_history SELECT (previous).* ON CONFLICT DO NOTHING;END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER preserve_schedule BEFORE UPDATE ON erp_private.project_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.preserve_schedule();
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record;n integer;total integer:=0;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
 RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';END IF;
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status<>'Archived' AND c.deleted_at IS NULL) THEN RETURN 0;END IF;
 FOR s IN SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL
 UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL
 ORDER BY version LOOP
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version)
 SELECT pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
 'Generated from project schedule. Internal work target; confirm statutory obligations before filing.',o.due_at,o.template_key||':'||o.period_start::text,
 o.requires_document,o.period_start,o.period_end,o.template_key,s.version
 FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at) o
 ON CONFLICT(project_id,recurring_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;total:=total+n;
 END LOOP;RETURN total;
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.preserve_schedule() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.preserve_schedule() TO erp_api;
;

