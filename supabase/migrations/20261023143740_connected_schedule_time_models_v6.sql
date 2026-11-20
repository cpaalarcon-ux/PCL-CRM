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

;

