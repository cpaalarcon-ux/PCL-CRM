-- Expected time on tasks, and expected working hours per person (HR and time, stage 1).
-- Firm decisions of 26 November 2026: 8 hours a day and 40 hours a week; when the hours logged on a task would pass the hours
-- allocated to it, the entry is refused (a hard block) until a Supervisor, Manager or Partner increases the allocation with a reason.
ALTER TABLE erp_private.tasks ADD COLUMN allocated_hours numeric(7,2) CHECK(allocated_hours IS NULL OR (allocated_hours>0 AND allocated_hours<=2000));
COMMENT ON COLUMN erp_private.tasks.allocated_hours IS 'Hours the task is expected to take. Null on tasks created before this rule; those are not blocked until hours are set.';
ALTER TABLE erp_private.staff_members
 ADD COLUMN expected_daily_hours numeric(4,2) NOT NULL DEFAULT 8 CHECK(expected_daily_hours BETWEEN 1 AND 12),
 ADD COLUMN expected_weekly_hours numeric(5,2) NOT NULL DEFAULT 40 CHECK(expected_weekly_hours BETWEEN 1 AND 52);
ALTER TABLE erp_private.staff_members ADD CONSTRAINT staff_expected_hours_check CHECK(expected_weekly_hours>=expected_daily_hours);

-- Every change to a task's allocated hours, with who made it and why.
CREATE TABLE erp_private.task_hour_changes(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES erp_private.tasks,
 old_hours numeric(7,2),new_hours numeric(7,2) NOT NULL CHECK(new_hours>0 AND new_hours<=2000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 changed_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX task_hour_changes_task_idx ON erp_private.task_hour_changes(task_id,created_at);
ALTER TABLE erp_private.task_hour_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.task_hour_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY task_hour_changes_read ON erp_private.task_hour_changes FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
CREATE POLICY task_hour_changes_insert ON erp_private.task_hour_changes FOR INSERT TO erp_api
 WITH CHECK(changed_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND erp_private.task_allowed(task_id));
GRANT SELECT,INSERT ON erp_private.task_hour_changes TO erp_api;

-- Hours already logged on a task by everyone who has worked on it (rejected entries excluded; a reversal is negative and cancels its original).
-- The person logging time can see only their own entries, so the total is worked out here, and only for a task the caller can open.
CREATE FUNCTION erp_private.task_logged_hours(p_task uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN erp_private.task_allowed(p_task)
  THEN coalesce((SELECT sum(s.hours) FROM erp_private.timesheets s WHERE s.task_id=p_task AND s.deleted_at IS NULL AND s.status<>'Rejected'),0)
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION erp_private.task_logged_hours(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.task_logged_hours(uuid) TO erp_api;
