-- Expected time on tasks, and expected working hours per person (HR and time, stage 1).
-- Firm decisions of 26 November 2026:
--  * 8 hours a day and 40 hours a week.
--  * Every task has an expected time. A recurring task takes a standard expected time.
--  * The expected time is NOT shown to the people doing the work, so nobody can enter time to match it. It is seen and set only by
--    Engagement Partners and by Managers a Partner has selected (the TIME_BUDGET right).
--  * Time is therefore never blocked at entry. Time over the expected hours is flagged to those same people.
-- The hours live in their own table with their own row security, so they cannot leak through the task record, its history or its events.

-- 1. The right. Partners hold it by rank; a Partner grants it to a named Manager with a reason and an end date.
ALTER TABLE erp_private.staff_capabilities DROP CONSTRAINT staff_capabilities_capability_check;
ALTER TABLE erp_private.staff_capabilities ADD CONSTRAINT staff_capabilities_capability_check CHECK(capability IN('FINANCE','HR','SYSTEM_ADMIN','MLRO','APPROVE_TAX_RULES','TIME_BUDGET'));
CREATE FUNCTION erp_private.sees_time_budget() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT erp_private.has_capability('TIME_BUDGET') $$;
REVOKE ALL ON FUNCTION erp_private.sees_time_budget() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.sees_time_budget() TO erp_api;
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.staff_right_grant(uuid,text,text,date)'::regprocedure);
 o:=$q$IF p_capability NOT IN('FINANCE','APPROVE_TAX_RULES','MLRO') THEN$q$;n:=$q$IF p_capability NOT IN('FINANCE','APPROVE_TAX_RULES','MLRO','TIME_BUDGET') THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: time budget patch 1 not applied'; END IF; d:=replace(d,o,n);
 o:=$q$IF t.category_code='ADMIN' THEN$q$;
 n:=$q$IF p_capability='TIME_BUDGET' AND t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'Expected hours are seen and set by selected Managers. Choose a Manager (Engagement Partners already hold every right).' USING ERRCODE='23514'; END IF;
 IF t.category_code='ADMIN' THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: time budget patch 2 not applied'; END IF; d:=replace(d,o,n);
 EXECUTE d;
END $patch$;

-- 2. Expected working hours per person.
ALTER TABLE erp_private.staff_members
 ADD COLUMN expected_daily_hours numeric(4,2) NOT NULL DEFAULT 8 CHECK(expected_daily_hours BETWEEN 1 AND 12),
 ADD COLUMN expected_weekly_hours numeric(5,2) NOT NULL DEFAULT 40 CHECK(expected_weekly_hours BETWEEN 1 AND 52);
ALTER TABLE erp_private.staff_members ADD CONSTRAINT staff_expected_hours_check CHECK(expected_weekly_hours>=expected_daily_hours);

-- 3. The standard list: a task type chosen when a task is created by hand, or a recurring task matched by its template key.
CREATE TABLE erp_private.standard_task_hours(
 standard_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('Task type','Recurring task')),
 match_key text NOT NULL CHECK(length(btrim(match_key)) BETWEEN 2 AND 200),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 3 AND 200),
 expected_hours numeric(7,2) NOT NULL CHECK(expected_hours>0 AND expected_hours<=2000),
 active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,updated_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1);
CREATE UNIQUE INDEX standard_task_hours_key ON erp_private.standard_task_hours(kind,lower(match_key));
ALTER TABLE erp_private.standard_task_hours ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.standard_task_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY standard_task_hours_all ON erp_private.standard_task_hours FOR ALL TO erp_api USING(erp_private.sees_time_budget()) WITH CHECK(erp_private.sees_time_budget());
GRANT SELECT,INSERT,UPDATE ON erp_private.standard_task_hours TO erp_api;
CREATE TRIGGER standard_task_hours_revision BEFORE UPDATE ON erp_private.standard_task_hours FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
-- The names of the task types, without their hours, for anyone creating a task.
CREATE FUNCTION erp_private.task_type_names() RETURNS TABLE(standard_id uuid,label text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.standard_id,s.label FROM erp_private.standard_task_hours s WHERE s.kind='Task type' AND s.active AND (erp_private.actor()).staff_id IS NOT NULL ORDER BY s.label
$$;
REVOKE ALL ON FUNCTION erp_private.task_type_names() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.task_type_names() TO erp_api;

-- 4. The task type chosen for a task (a name, not hours), and the task's expected hours.
ALTER TABLE erp_private.tasks ADD COLUMN task_type_id uuid REFERENCES erp_private.standard_task_hours;
CREATE TABLE erp_private.task_expected_hours(
 task_id uuid PRIMARY KEY REFERENCES erp_private.tasks,
 expected_hours numeric(7,2) NOT NULL CHECK(expected_hours>0 AND expected_hours<=2000),
 source text NOT NULL CHECK(source IN('Standard','Set')),
 standard_id uuid REFERENCES erp_private.standard_task_hours,
 set_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE erp_private.task_expected_hours ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.task_expected_hours FORCE ROW LEVEL SECURITY;
CREATE POLICY task_expected_hours_all ON erp_private.task_expected_hours FOR ALL TO erp_api
 USING(erp_private.sees_time_budget() AND erp_private.task_allowed(task_id)) WITH CHECK(erp_private.sees_time_budget() AND erp_private.task_allowed(task_id));
GRANT SELECT,INSERT,UPDATE ON erp_private.task_expected_hours TO erp_api;

-- Every change to a task's expected hours, with who made it and why. Same audience.
CREATE TABLE erp_private.task_hour_changes(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES erp_private.tasks,
 old_hours numeric(7,2),new_hours numeric(7,2) NOT NULL CHECK(new_hours>0 AND new_hours<=2000),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 changed_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX task_hour_changes_task_idx ON erp_private.task_hour_changes(task_id,created_at);
ALTER TABLE erp_private.task_hour_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.task_hour_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY task_hour_changes_read ON erp_private.task_hour_changes FOR SELECT TO erp_api USING(erp_private.sees_time_budget() AND erp_private.task_allowed(task_id));
CREATE POLICY task_hour_changes_insert ON erp_private.task_hour_changes FOR INSERT TO erp_api
 WITH CHECK(changed_by=(erp_private.actor()).staff_id AND erp_private.sees_time_budget() AND erp_private.task_allowed(task_id));
GRANT SELECT,INSERT ON erp_private.task_hour_changes TO erp_api;

-- 5. A new task takes its standard hours automatically, whoever or whatever created it (a person, a service template, a recurring schedule).
-- The creator does not need to see the hours and is not shown them.
CREATE FUNCTION erp_private.task_apply_standard_hours() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s erp_private.standard_task_hours;
BEGIN
 IF NEW.task_type_id IS NOT NULL THEN SELECT * INTO s FROM erp_private.standard_task_hours WHERE standard_id=NEW.task_type_id AND active;
 ELSIF NEW.template_key IS NOT NULL THEN SELECT * INTO s FROM erp_private.standard_task_hours WHERE kind='Recurring task' AND lower(match_key)=lower(NEW.template_key) AND active; END IF;
 IF s.standard_id IS NOT NULL THEN
  INSERT INTO erp_private.task_expected_hours(task_id,expected_hours,source,standard_id) VALUES(NEW.task_id,s.expected_hours,'Standard',s.standard_id) ON CONFLICT(task_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.task_apply_standard_hours() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER task_standard_hours AFTER INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.task_apply_standard_hours();

-- 6. Hours logged on a task by everyone who has worked on it (rejected entries excluded; a reversal is negative and cancels its original).
-- Only for the people who may see expected hours, and only for a task they can open.
CREATE FUNCTION erp_private.task_logged_hours(p_task uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN erp_private.sees_time_budget() AND erp_private.task_allowed(p_task)
  THEN coalesce((SELECT sum(s.hours) FROM erp_private.timesheets s WHERE s.task_id=p_task AND s.deleted_at IS NULL AND s.status<>'Rejected'),0)
  ELSE NULL END
$$;
REVOKE ALL ON FUNCTION erp_private.task_logged_hours(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.task_logged_hours(uuid) TO erp_api;
