-- Task reassignment is an explicitly checked operation for assignees, without giving them unrestricted UPDATE rights.
CREATE FUNCTION erp_private.escalate_task(target_task uuid,target_staff uuid,reason_text text,expected_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;t erp_private.tasks;f uuid;cat text;
BEGIN
 a:=erp_private.actor();IF a.staff_id IS NULL OR auth.uid() IS NULL OR NOT erp_private.task_allowed(target_task) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=target_task FOR UPDATE;
 IF t.revision<>expected_revision THEN RAISE EXCEPTION 'Task changed; refresh first' USING ERRCODE='40001';END IF;
 IF t.status IN ('Completed','Cancelled') OR length(btrim(reason_text))<3 OR length(reason_text)>1000 THEN RAISE EXCEPTION 'Open task and reason required' USING ERRCODE='23514';END IF;
 SELECT handling_firm_id INTO f FROM erp_private.projects WHERE project_id=t.project_id AND deleted_at IS NULL;
 SELECT s.category_code INTO cat FROM erp_private.staff_members s JOIN erp_private.staff_firm_access fa ON fa.staff_id=s.staff_id
 WHERE s.staff_id=target_staff AND fa.firm_id=f AND fa.deleted_at IS NULL AND s.deleted_at IS NULL AND s.access_status<>'Inactive'
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date);
 IF cat IS NULL OR NOT erp_private.firm_allowed(f) OR (NOT erp_private.project_editor() AND (t.assigned_to<>a.staff_id OR cat NOT IN ('PARTNER','MANAGER','SUPERVISOR'))) THEN RAISE EXCEPTION 'Choose an authorised reviewer' USING ERRCODE='42501';END IF;
 IF target_staff=t.assigned_to THEN RAISE EXCEPTION 'Choose another staff member' USING ERRCODE='23514';END IF;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(t.project_id,target_staff,f,cat)
 ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL;
 UPDATE erp_private.tasks SET assigned_to=target_staff,blocked_reason=reason_text WHERE task_id=t.task_id;
 INSERT INTO erp_private.task_events(task_id,event_type,from_staff_id,to_staff_id,reason,created_by) VALUES(t.task_id,'Reassigned',t.assigned_to,target_staff,reason_text,a.staff_id);
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(target_staff,t.task_id,'Task reassigned: '||t.task_name,gen_random_uuid()::text);
END; $$;

DO $$ DECLARE x text;BEGIN
 FOREACH x IN ARRAY ARRAY['sectors','project_schedules','task_events','notifications','timesheets','workbook_batches','workbook_rows','workbook_rejections'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',x);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',x);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',x);
 END LOOP;
 FOREACH x IN ARRAY ARRAY['task_events','notifications','workbook_batches','workbook_rejections'] LOOP
 EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change()',x);
 END LOOP;
END; $$;
CREATE TRIGGER time_revision BEFORE UPDATE ON erp_private.timesheets FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER row_revision BEFORE UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER time_audit AFTER INSERT OR UPDATE ON erp_private.timesheets FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('timesheet_id');
CREATE TRIGGER row_audit AFTER INSERT OR UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('row_id');
CREATE TRIGGER schedule_audit AFTER INSERT OR UPDATE ON erp_private.project_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('project_id');
GRANT SELECT,INSERT ON erp_private.sectors TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.project_schedules,erp_private.timesheets,erp_private.workbook_rows TO erp_api;
GRANT SELECT,INSERT ON erp_private.workbook_batches,erp_private.workbook_rejections TO erp_api;
GRANT SELECT ON erp_private.task_events,erp_private.notifications TO erp_api;
CREATE POLICY sectors_read ON erp_private.sectors FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND deleted_at IS NULL);
CREATE POLICY sectors_add ON erp_private.sectors FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND NOT system_default);
CREATE POLICY schedules_read ON erp_private.project_schedules FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY schedules_write ON erp_private.project_schedules FOR ALL TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id));
CREATE POLICY events_read ON erp_private.task_events FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id) OR from_staff_id=(erp_private.actor()).staff_id);
CREATE POLICY notifications_read ON erp_private.notifications FOR SELECT TO erp_api USING(recipient_id=(erp_private.actor()).staff_id);
CREATE POLICY time_read ON erp_private.timesheets FOR SELECT TO erp_api USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.project_allowed(project_id))));
CREATE POLICY time_insert ON erp_private.timesheets FOR INSERT TO erp_api WITH CHECK((staff_id=(erp_private.actor()).staff_id AND erp_private.task_allowed(task_id) AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=timesheets.task_id AND t.assigned_to=timesheets.staff_id)) OR (erp_private.is_leader() AND erp_private.project_allowed(project_id) AND reverses_id IS NOT NULL));
CREATE POLICY time_update ON erp_private.timesheets FOR UPDATE TO erp_api USING((staff_id=(erp_private.actor()).staff_id AND status IN ('Draft','Rejected') AND erp_private.task_allowed(task_id)) OR (erp_private.is_leader() AND erp_private.project_allowed(project_id) AND staff_id<>(erp_private.actor()).staff_id AND status='Submitted')) WITH CHECK(staff_id=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.project_allowed(project_id)));
CREATE POLICY batch_read ON erp_private.workbook_batches FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY batch_insert ON erp_private.workbook_batches FOR INSERT TO erp_api WITH CHECK(uploaded_by=(erp_private.actor()).staff_id AND erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY rows_read ON erp_private.workbook_rows FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY rows_insert ON erp_private.workbook_rows FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY rows_update ON erp_private.workbook_rows FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY rejections_read ON erp_private.workbook_rejections FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.workbook_batches b WHERE b.batch_id=workbook_rejections.batch_id));
CREATE POLICY rejections_insert ON erp_private.workbook_rejections FOR INSERT TO erp_api WITH CHECK(EXISTS(SELECT 1 FROM erp_private.workbook_batches b WHERE b.batch_id=workbook_rejections.batch_id AND b.uploaded_by=(erp_private.actor()).staff_id));
REVOKE ALL ON ALL TABLES IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.project_editor(),erp_private.assignment_candidates(),erp_private.assignable(uuid,uuid),erp_private.escalate_task(uuid,uuid,text,bigint),erp_private.timesheet_guard(),erp_private.workbook_row_guard() TO erp_api;

;

