-- DRAFT ONLY: not applied, not a release migration.
-- Finish database/RLS integration tests before converting this to migrations.
-- Sector migration 20261023140533 is already applied separately.
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

CREATE TABLE erp_private.project_schedules (
 project_id uuid PRIMARY KEY REFERENCES erp_private.projects,
 frequency text NOT NULL CHECK(frequency IN ('Once-off','Weekly','Monthly','Weekly + Monthly','Quarterly','Annually')),
 pack text NOT NULL CHECK(pack IN ('General','Tax Compilation')),
 starts_on date NOT NULL, ends_on date NOT NULL, effective_from date NOT NULL,
 enabled boolean NOT NULL DEFAULT true, obligations text[] NOT NULL DEFAULT '{}',
 assigned_to uuid NOT NULL, reviewer_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
 FOREIGN KEY(project_id,assigned_to) REFERENCES erp_private.project_assignments(project_id,staff_id),
 FOREIGN KEY(project_id,reviewer_id) REFERENCES erp_private.project_assignments(project_id,staff_id),
 CHECK(ends_on>=starts_on AND ends_on<=starts_on+interval '5 years'),
 CHECK(obligations <@ ARRAY['VAT','PAYE','TOT','Payroll','Income Tax']::text[])
);
CREATE INDEX schedules_assignee_idx ON erp_private.project_schedules(assigned_to);
CREATE INDEX schedules_reviewer_idx ON erp_private.project_schedules(reviewer_id);
CREATE TABLE erp_private.task_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES erp_private.tasks,
 event_type text NOT NULL,from_staff_id uuid REFERENCES erp_private.staff_members,to_staff_id uuid REFERENCES erp_private.staff_members,
 reason text NOT NULL,created_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_events_task_idx ON erp_private.task_events(task_id,created_at);
CREATE INDEX task_events_from_idx ON erp_private.task_events(from_staff_id);
CREATE INDEX task_events_to_idx ON erp_private.task_events(to_staff_id);
CREATE INDEX task_events_creator_idx ON erp_private.task_events(created_by);
CREATE TABLE erp_private.notifications (
 notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),recipient_id uuid NOT NULL REFERENCES erp_private.staff_members,
 task_id uuid REFERENCES erp_private.tasks,message text NOT NULL,event_key text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_recipient_idx ON erp_private.notifications(recipient_id,created_at);
CREATE INDEX notifications_task_idx ON erp_private.notifications(task_id);
CREATE TABLE erp_private.timesheets (
 timesheet_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 project_id uuid NOT NULL,task_id uuid NOT NULL,work_date date NOT NULL,hours numeric(6,2) NOT NULL CHECK(hours<>0 AND abs(hours)<=24),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 2 AND 2000),billable boolean NOT NULL DEFAULT true,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Approved','Rejected')),
 reviewed_by uuid REFERENCES erp_private.staff_members,reviewed_at timestamptz,review_note text,
 reverses_id uuid UNIQUE REFERENCES erp_private.timesheets,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 FOREIGN KEY(task_id,project_id) REFERENCES erp_private.tasks(task_id,project_id),
 CHECK((hours>0 AND reverses_id IS NULL) OR (hours<0 AND reverses_id IS NOT NULL)),
 CHECK(reviewed_by IS NULL OR reviewed_by<>staff_id),
 CHECK(status NOT IN ('Approved','Rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX timesheets_staff_date_idx ON erp_private.timesheets(staff_id,work_date);
CREATE INDEX timesheets_project_idx ON erp_private.timesheets(project_id);
CREATE INDEX timesheets_task_idx ON erp_private.timesheets(task_id,project_id);
CREATE INDEX timesheets_reviewer_idx ON erp_private.timesheets(reviewed_by);
CREATE FUNCTION erp_private.timesheet_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='Approved' THEN RAISE EXCEPTION 'Approved time is locked; use a reversal' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.staff_id,NEW.project_id,NEW.task_id,NEW.reverses_id) IS DISTINCT FROM (OLD.staff_id,OLD.project_id,OLD.task_id,OLD.reverses_id) THEN
  RAISE EXCEPTION 'Timesheet identity cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.work_date>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'Time cannot be recorded in the future' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' AND NEW.staff_id=(erp_private.actor()).staff_id THEN
  IF NEW.status NOT IN ('Draft','Submitted') OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'Staff cannot approve their own time' USING ERRCODE='42501'; END IF;
 ELSIF current_user='erp_api' THEN
  IF NOT erp_private.is_leader() OR NOT erp_private.project_allowed(NEW.project_id) OR NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id
   OR NEW.status NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Manager review is required' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status<>'Submitted' OR (NEW.hours,NEW.work_date,NEW.description,NEW.billable) IS DISTINCT FROM (OLD.hours,OLD.work_date,OLD.description,OLD.billable)) THEN
   RAISE EXCEPTION 'Review submitted time without changing the work logged' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reverses_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.timesheets t WHERE t.timesheet_id=NEW.reverses_id AND t.status='Approved'
   AND t.reverses_id IS NULL AND (t.staff_id,t.project_id,t.task_id,t.work_date,t.hours)=(NEW.staff_id,NEW.project_id,NEW.task_id,NEW.work_date,-NEW.hours)) THEN
   RAISE EXCEPTION 'Reversal must offset an approved entry exactly' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER timesheet_guard BEFORE INSERT OR UPDATE ON erp_private.timesheets FOR EACH ROW EXECUTE FUNCTION erp_private.timesheet_guard();

CREATE TABLE erp_private.workbook_batches (
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 document_id uuid NOT NULL REFERENCES erp_private.documents,sheet_name text NOT NULL,header_row integer NOT NULL CHECK(header_row>0),
 dataset text NOT NULL CHECK(dataset IN ('Sales','Purchases','Bank','General')),period_start date NOT NULL,period_end date NOT NULL,
 column_map jsonb NOT NULL,source_count integer NOT NULL,new_count integer NOT NULL,duplicate_count integer NOT NULL,rejected_count integer NOT NULL,
 uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(source_count=new_count+duplicate_count+rejected_count),CHECK(period_end>=period_start)
);
CREATE INDEX workbook_batches_project_idx ON erp_private.workbook_batches(project_id,created_at);
CREATE INDEX workbook_batches_document_idx ON erp_private.workbook_batches(document_id);
CREATE INDEX workbook_batches_staff_idx ON erp_private.workbook_batches(uploaded_by);
CREATE TABLE erp_private.workbook_rows (
 row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES erp_private.workbook_batches DEFERRABLE INITIALLY DEFERRED,
 project_id uuid NOT NULL REFERENCES erp_private.projects,client_id uuid NOT NULL REFERENCES erp_private.clients,
 dataset text NOT NULL,source_row integer NOT NULL,row_key text NOT NULL,raw_values jsonb NOT NULL,normalized jsonb NOT NULL,
 route integer CHECK(route IN (1,2,3)),category_code text,narration text,asset_details text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 UNIQUE(client_id,dataset,row_key)
);
CREATE INDEX workbook_rows_batch_idx ON erp_private.workbook_rows(batch_id);
CREATE INDEX workbook_rows_project_idx ON erp_private.workbook_rows(project_id);
CREATE TABLE erp_private.workbook_rejections (
 rejection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES erp_private.workbook_batches,
 source_row integer NOT NULL,reason text NOT NULL,raw_values jsonb NOT NULL
);
CREATE INDEX workbook_rejections_batch_idx ON erp_private.workbook_rejections(batch_id);
CREATE FUNCTION erp_private.workbook_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['route','category_code','narration','asset_details','revision','updated_at']) IS DISTINCT FROM
 (to_jsonb(OLD)-ARRAY['route','category_code','narration','asset_details','revision','updated_at']) THEN
 RAISE EXCEPTION 'Imported source rows are immutable' USING ERRCODE='23514'; END IF;RETURN NEW;
END; $$;
CREATE TRIGGER workbook_row_guard BEFORE UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.workbook_row_guard();


-- Relational identity constraints prevent a workbook row being relinked to another client/project.
ALTER TABLE erp_private.projects ADD CONSTRAINT projects_client_pair UNIQUE(project_id,client_id);
ALTER TABLE erp_private.documents ADD CONSTRAINT documents_project_pair UNIQUE(document_id,project_id);
ALTER TABLE erp_private.workbook_batches ADD CONSTRAINT batch_project_pair UNIQUE(batch_id,project_id),
 ADD CONSTRAINT batch_document_project_fk FOREIGN KEY(document_id,project_id) REFERENCES erp_private.documents(document_id,project_id);
ALTER TABLE erp_private.workbook_rows ADD CONSTRAINT rows_client_project_fk FOREIGN KEY(project_id,client_id) REFERENCES erp_private.projects(project_id,client_id),
 ADD CONSTRAINT rows_batch_project_fk FOREIGN KEY(batch_id,project_id) REFERENCES erp_private.workbook_batches(batch_id,project_id) DEFERRABLE INITIALLY DEFERRED;

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

-- Recurrence is based on Nairobi calendar periods, independently of cron's UTC clock.
CREATE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH periods AS (
 SELECT 'Weekly'::text kind,d::date first_day,(d+interval '6 days')::date last_day FROM generate_series(date_trunc('week',starts::timestamp),ends::timestamp,interval '7 days') d
 WHERE freq IN ('Weekly','Weekly + Monthly')
 UNION ALL SELECT 'Monthly',d::date,(d+interval '1 month -1 day')::date FROM generate_series(date_trunc('month',starts::timestamp),ends::timestamp,interval '1 month') d
 WHERE freq IN ('Monthly','Weekly + Monthly')
 UNION ALL SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date FROM generate_series(date_trunc('quarter',starts::timestamp),ends::timestamp,interval '3 months') d WHERE freq='Quarterly'
 UNION ALL SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date FROM generate_series(date_trunc('year',starts::timestamp),ends::timestamp,interval '1 year') d WHERE freq='Annually'
 UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), templates(key,label,kind,release_day,due_day,doc,review,obligation) AS (VALUES
 ('weekly-sales','Upload weekly sales','Weekly',0,6,true,false,''),
 ('weekly-purchases','Upload weekly purchases','Weekly',0,6,true,false,''),
 ('weekly-bank','Upload bank transactions','Weekly',0,6,true,false,''),
 ('weekly-mapping','Map purchases and reconcile bank','Weekly',0,6,false,false,''),
 ('weekly-review','Review weekly tax compilation','Weekly',0,6,false,true,''),
 ('weekly-report','Prepare weekly client report','Weekly',0,6,false,false,''),
 ('monthly-compile','Compile monthly tax schedules','Monthly',1,5,false,false,''),
 ('monthly-review','Review monthly tax compilation','Monthly',1,6,false,true,''),
 ('monthly-report','Prepare monthly client report','Monthly',1,7,false,false,''),
 ('monthly-paye','File PAYE return','Monthly',6,7,false,false,'PAYE'),
 ('monthly-vat','File VAT return','Monthly',15,18,false,false,'VAT'),
 ('monthly-tot','File TOT return','Monthly',15,18,false,false,'TOT'),
 ('monthly-payroll','Prepare payroll','Monthly',22,25,false,false,'Payroll')),
 occurrences AS (
 SELECT t.key,t.label,p.first_day,p.last_day,
 CASE WHEN p.kind='Weekly' THEN p.first_day::timestamp+interval '1 minute'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.release_day-1)*interval '1 day'+interval '1 minute' END rel,
 CASE WHEN p.kind='Weekly' THEN p.last_day::timestamp+interval '23 hours 59 minutes'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.due_day-1)*interval '1 day'+interval '23 hours 59 minutes' END due,
 t.doc,t.review FROM periods p JOIN templates t ON t.kind=p.kind
 WHERE pack_name='Tax Compilation' AND (t.obligation='' OR t.obligation=ANY(obligations))
 UNION ALL
 SELECT 'general-'||lower(p.kind),'Complete '||lower(p.kind)||' project work',p.first_day,p.last_day,
 greatest(p.first_day,starts)::timestamp+interval '1 minute',least(p.last_day,ends)::timestamp+interval '23 hours 59 minutes',false,false
 FROM periods p WHERE pack_name='General' OR p.kind IN ('Once-off','Quarterly','Annually')
 ) SELECT key,label,first_day,last_day,
 greatest(rel,starts::timestamp+interval '1 minute') AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,review
 FROM occurrences WHERE last_day>=starts AND first_day<=ends AND (effective<=starts OR first_day>=effective)
 AND (greatest(rel,starts::timestamp+interval '1 minute') AT TIME ZONE 'Africa/Nairobi')<=through_at
 ORDER BY rel,key
$$;
CREATE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s erp_private.project_schedules;n integer;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
 RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status<>'Archived' AND c.deleted_at IS NULL) THEN RETURN 0;END IF;
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version)
 SELECT pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
 'Generated from project schedule. Internal work target; confirm statutory obligations before filing.',o.due_at,o.template_key||':'||o.period_start::text,
 o.requires_document,o.period_start,o.period_end,o.template_key,s.version
 FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at) o
 ON CONFLICT(project_id,recurring_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END; $$;
CREATE FUNCTION erp_private.run_workspace_scheduler() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p record;t record;n integer:=0;escalated integer:=0;
BEGIN
 FOR p IN SELECT project_id FROM erp_private.project_schedules WHERE enabled AND deleted_at IS NULL LOOP
 n:=n+erp_private.generate_project_tasks(p.project_id);END LOOP;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT DISTINCT r.staff_id,t.task_id,'Overdue task: '||t.task_name,'overdue:'||t.task_id::text||':'||r.staff_id::text
 FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id
 LEFT JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 CROSS JOIN LATERAL(SELECT t.assigned_to staff_id UNION SELECT s.reviewer_id) r
 WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status<>'Archived' AND t.due_at<now()-interval '5 minutes'
 AND t.status NOT IN ('Completed','Cancelled') AND r.staff_id IS NOT NULL ON CONFLICT(event_key) DO NOTHING;
 FOR t IN SELECT t.*,s.reviewer_id,p.handling_firm_id,r.category_code FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 JOIN erp_private.staff_members r ON r.staff_id=s.reviewer_id
 JOIN erp_private.staff_firm_access fa ON fa.staff_id=r.staff_id AND fa.firm_id=p.handling_firm_id AND fa.deleted_at IS NULL
 WHERE t.requires_document AND t.status IN ('Pending','In Progress','Blocked') AND t.due_at<now() AND t.deleted_at IS NULL
 AND p.deleted_at IS NULL AND p.status<>'Archived' AND s.enabled AND s.deleted_at IS NULL AND r.access_status='Active' AND r.deleted_at IS NULL
 AND r.category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND t.assigned_to<>s.reviewer_id
 AND (r.contract_end_date IS NULL OR r.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.task_id=t.task_id AND d.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM erp_private.notifications n WHERE n.event_key='missing-document:'||t.task_id::text)
 LOOP
 UPDATE erp_private.tasks SET assigned_to=t.reviewer_id,blocked_reason='Escalated automatically: required client document is overdue.' WHERE task_id=t.task_id;
 INSERT INTO erp_private.task_events(task_id,event_type,from_staff_id,to_staff_id,reason) VALUES(t.task_id,'Missing documents',t.assigned_to,t.reviewer_id,'Required upload is overdue.');
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(t.reviewer_id,t.task_id,'Missing document: '||t.task_name,'missing-document:'||t.task_id::text);
 escalated:=escalated+1;
 END LOOP;
 RETURN jsonb_build_object('generated',n,'escalated',escalated);
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz),erp_private.generate_project_tasks(uuid,timestamptz),erp_private.run_workspace_scheduler() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz),erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('pcl-workspace-tasks','* * * * *','select erp_private.run_workspace_scheduler();');
