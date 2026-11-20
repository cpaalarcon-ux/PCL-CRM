-- Build .105 (staging): task statuses, working-hours clock with stuck-task alerts, Manager Pool, Partners out of the overload badge.
-- Decisions (8 Nov 2026, 23:04): working hours 08:00 to 17:00 Africa/Nairobi, Monday to Friday, paused on public holidays; statuses Waiting on
-- client and Paused are added (Blocked already exists); 4 working hours alerts the Supervisor, 8 the Manager; alerts never block the task.

-- 1. Task statuses.
DO $$
DECLARE c text;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.tasks'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%In Review%' LOOP
  EXECUTE format('ALTER TABLE erp_private.tasks DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('Pending','In Progress','Waiting on client','Paused','Blocked','In Review','Completed','Cancelled'));

-- 2. Public holidays (dates the clock does not run). Seeded with the fixed-date statutory holidays and the Monday that follows a Sunday holiday.
--    Movable holidays (Good Friday, Easter Monday, Eid) are not seeded: a Partner must add them. confirmed=false until a Partner checks the row.
CREATE TABLE erp_private.public_holidays(
 holiday_date date PRIMARY KEY,name text NOT NULL CHECK(length(btrim(name))>=3),confirmed boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO erp_private.public_holidays(holiday_date,name) VALUES
 ('2026-12-12','Jamhuri Day'),('2026-12-25','Christmas Day'),('2026-12-26','Boxing Day'),
 ('2027-01-01','New Year''s Day'),('2027-05-01','Labour Day'),('2027-06-01','Madaraka Day'),('2027-10-10','Utamaduni Day'),('2027-10-11','Utamaduni Day (Sunday observed on Monday)'),
 ('2027-10-20','Mashujaa Day'),('2027-12-12','Jamhuri Day'),('2027-12-13','Jamhuri Day (Sunday observed on Monday)'),('2027-12-25','Christmas Day'),('2027-12-26','Boxing Day'),('2027-12-27','Boxing Day (Sunday observed on Monday)');
ALTER TABLE erp_private.public_holidays ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.public_holidays TO erp_api;
CREATE POLICY public_holidays_read ON erp_private.public_holidays FOR SELECT TO erp_api USING(true);

-- 3. Working seconds between two moments: weekdays 08:00 to 17:00 Nairobi time, minus public holidays.
CREATE FUNCTION erp_private.working_seconds(p_from timestamptz,p_to timestamptz) RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN p_from IS NULL OR p_to IS NULL OR p_to<=p_from THEN 0 ELSE coalesce((
  SELECT sum(greatest(0,extract(epoch FROM least(p_to,(g.d+time '17:00') AT TIME ZONE 'Africa/Nairobi')-greatest(p_from,(g.d+time '08:00') AT TIME ZONE 'Africa/Nairobi'))))
  FROM (SELECT x::date d FROM generate_series((p_from AT TIME ZONE 'Africa/Nairobi')::date,(p_to AT TIME ZONE 'Africa/Nairobi')::date,interval '1 day') x) g
  WHERE extract(isodow FROM g.d)<6 AND NOT EXISTS(SELECT 1 FROM erp_private.public_holidays h WHERE h.holiday_date=g.d)),0) END
$$;
GRANT EXECUTE ON FUNCTION erp_private.working_seconds(timestamptz,timestamptz) TO erp_api;

-- 4. The clock on each task: counts only while the task is In Progress; Waiting on client, Paused and Blocked stop it; work_seconds keeps the total.
ALTER TABLE erp_private.tasks ADD COLUMN work_started_at timestamptz,ADD COLUMN last_paused_at timestamptz,ADD COLUMN work_seconds integer NOT NULL DEFAULT 0;
UPDATE erp_private.tasks SET work_started_at=now() WHERE status='In Progress' AND deleted_at IS NULL;
CREATE FUNCTION erp_private.task_work_clock() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status='In Progress' THEN NEW.work_started_at:=now(); END IF;
  RETURN NEW;
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF OLD.status='In Progress' AND OLD.work_started_at IS NOT NULL THEN
  NEW.work_seconds:=OLD.work_seconds+round(erp_private.working_seconds(OLD.work_started_at,now()))::integer;
  NEW.work_started_at:=NULL;
 END IF;
 IF NEW.status='In Progress' THEN NEW.work_started_at:=now();NEW.last_paused_at:=NULL;
 ELSIF NEW.status IN ('Waiting on client','Paused','Blocked') THEN NEW.last_paused_at:=now(); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_work_clock BEFORE INSERT OR UPDATE ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.task_work_clock();
CREATE FUNCTION erp_private.task_work_seconds(p_task uuid) RETURNS integer LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (t.work_seconds+CASE WHEN t.status='In Progress' THEN round(erp_private.working_seconds(t.work_started_at,now())) ELSE 0 END)::integer FROM erp_private.tasks t WHERE t.task_id=p_task
$$;

-- 5. Stuck-task alerts: once per task per level. 4 working hours tells the Supervisor, 8 the Manager. Nothing is blocked.
CREATE TABLE erp_private.task_stuck_alerts(
 task_id uuid NOT NULL REFERENCES erp_private.tasks,level smallint NOT NULL CHECK(level IN (4,8)),raised_at timestamptz NOT NULL DEFAULT now(),
 recipients integer NOT NULL DEFAULT 0,PRIMARY KEY(task_id,level));
ALTER TABLE erp_private.task_stuck_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.task_stuck_alerts TO erp_api;
CREATE POLICY task_stuck_alerts_read ON erp_private.task_stuck_alerts FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
CREATE FUNCTION erp_private.stuck_recipients(p_assignee uuid,p_project uuid,p_level smallint) RETURNS SETOF uuid LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a erp_private.staff_members;owner uuid;got boolean:=false;r uuid;
BEGIN
 SELECT * INTO a FROM erp_private.staff_members WHERE staff_id=p_assignee;
 SELECT owner_staff_id INTO owner FROM erp_private.projects WHERE project_id=p_project;
 -- A Partner has no Supervisor above them: the other Partners hear about it (an executive risk).
 IF a.category_code='PARTNER' THEN
  RETURN QUERY SELECT staff_id FROM erp_private.staff_members WHERE category_code='PARTNER' AND deleted_at IS NULL AND access_status='Active' AND staff_id<>p_assignee;RETURN;
 END IF;
 IF p_level=4 THEN
  FOR r IN SELECT pa.staff_id FROM erp_private.project_assignments pa JOIN erp_private.staff_members m ON m.staff_id=pa.staff_id
   WHERE pa.project_id=p_project AND pa.role_on_job='SUPERVISOR' AND pa.deleted_at IS NULL AND m.deleted_at IS NULL AND pa.staff_id<>p_assignee LOOP
   got:=true;RETURN NEXT r;
  END LOOP;
  IF got THEN RETURN; END IF;
 END IF;
 -- 8 working hours, or no Supervisor on the job: the Manager (the person's own, else the project owner), else the Partners.
 IF a.manager_id IS NOT NULL AND a.manager_id<>p_assignee THEN RETURN NEXT a.manager_id;RETURN; END IF;
 IF owner IS NOT NULL AND owner<>p_assignee THEN RETURN NEXT owner;RETURN; END IF;
 RETURN QUERY SELECT staff_id FROM erp_private.staff_members WHERE category_code='PARTNER' AND deleted_at IS NULL AND access_status='Active' AND staff_id<>p_assignee;
END $$;
CREATE FUNCTION erp_private.stuck_task_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;lvl smallint;n integer:=0;sent integer;rec uuid;tail text;
BEGIN
 FOR r IN SELECT t.task_id,t.task_name,t.project_id,t.assigned_to,s.full_name,c.company_name,
   t.work_seconds+round(erp_private.working_seconds(t.work_started_at,now()))::integer secs
  FROM erp_private.tasks t JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.clients c ON c.client_id=p.client_id
  WHERE t.status='In Progress' AND t.work_started_at IS NOT NULL AND t.deleted_at IS NULL
 LOOP
  FOR lvl IN SELECT x FROM unnest(ARRAY[4,8]::smallint[]) x WHERE r.secs>=x*3600 AND NOT EXISTS(SELECT 1 FROM erp_private.task_stuck_alerts a WHERE a.task_id=r.task_id AND a.level=x) ORDER BY x LOOP
   sent:=0;tail:=CASE WHEN lvl=4 THEN 'Please check in.' ELSE 'This is now a Manager-level alert; please review.' END;
   FOR rec IN SELECT DISTINCT q FROM erp_private.stuck_recipients(r.assigned_to,r.project_id,lvl) q LOOP
    INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
     VALUES(rec,r.task_id,format('%s has worked %s working hours on "%s" for %s. %s',r.full_name,lvl,r.task_name,r.company_name,tail),format('stuck:%s:%s:%s',r.task_id,lvl,rec)) ON CONFLICT DO NOTHING;
    sent:=sent+1;
   END LOOP;
   INSERT INTO erp_private.task_stuck_alerts(task_id,level,recipients) VALUES(r.task_id,lvl,sent) ON CONFLICT DO NOTHING;
   n:=n+1;
  END LOOP;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.stuck_recipients(uuid,uuid,smallint) FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.stuck_task_scan() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('pcl-stuck-task-scan','5 * * * *','select erp_private.stuck_task_scan();');

-- 6. Manager Pool. Review stays routed to the named reviewer. A task waiting for supervisor review goes to the pool when the named reviewer is
--    on approved leave today or there is no named reviewer; a Supervisor, Manager or Partner can also send a task there with a reason.
--    A Manager or Partner pulls it to themselves; the person who prepared it can never do so. Every move is logged with who and to whom.
CREATE TABLE erp_private.task_review_pool(
 task_id uuid PRIMARY KEY REFERENCES erp_private.tasks,
 review_pool_status text NOT NULL DEFAULT 'NAMED' CHECK(review_pool_status IN ('NAMED','POOL')),
 pool_reason text,manual boolean NOT NULL DEFAULT false,pooled_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX task_review_pool_status_idx ON erp_private.task_review_pool(review_pool_status) WHERE review_pool_status='POOL';
CREATE TABLE erp_private.task_pool_log(
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),task_id uuid NOT NULL REFERENCES erp_private.tasks,
 action text NOT NULL CHECK(action IN ('Pooled','Sent to pool','Claimed','Restored')),
 from_reviewer uuid REFERENCES erp_private.staff_members,to_staff_id uuid REFERENCES erp_private.staff_members,acted_by uuid REFERENCES erp_private.staff_members,
 reason text,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX task_pool_log_task_idx ON erp_private.task_pool_log(task_id,created_at DESC);
CREATE INDEX task_pool_log_to_idx ON erp_private.task_pool_log(to_staff_id);
CREATE INDEX task_pool_log_by_idx ON erp_private.task_pool_log(acted_by);
CREATE INDEX task_pool_log_from_idx ON erp_private.task_pool_log(from_reviewer);
ALTER TABLE erp_private.task_review_pool ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.task_pool_log ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.task_review_pool,erp_private.task_pool_log TO erp_api;
CREATE POLICY task_review_pool_read ON erp_private.task_review_pool FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
CREATE POLICY task_pool_log_read ON erp_private.task_pool_log FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.task_pool_log FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.task_review_pool FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.reject_update() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'This record cannot be changed' USING ERRCODE='23514'; END $$;
CREATE TRIGGER no_update BEFORE UPDATE ON erp_private.task_pool_log FOR EACH ROW EXECUTE FUNCTION erp_private.reject_update();

CREATE FUNCTION erp_private.refresh_review_pool() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;n integer:=0;
BEGIN
 -- tasks waiting for supervisor review with no usable named reviewer
 FOR r IN SELECT t.task_id,w.reviewer_id,
   CASE WHEN w.reviewer_id IS NULL THEN 'No named reviewer'
        WHEN EXISTS(SELECT 1 FROM erp_private.leave_requests l WHERE l.staff_id=w.reviewer_id AND l.status='Approved' AND l.deleted_at IS NULL AND (now() AT TIME ZONE 'Africa/Nairobi')::date BETWEEN l.starts_on AND l.ends_on) THEN 'Named reviewer is on leave' END reason
  FROM erp_private.tasks t JOIN erp_private.task_procedures w ON w.task_id=t.task_id
  WHERE t.deleted_at IS NULL AND t.status NOT IN ('Completed','Cancelled') AND w.stage='Pending supervisor review'
 LOOP
  IF r.reason IS NOT NULL THEN
   INSERT INTO erp_private.task_review_pool(task_id,review_pool_status,pool_reason,pooled_at) VALUES(r.task_id,'POOL',r.reason,now())
    ON CONFLICT (task_id) DO UPDATE SET review_pool_status='POOL',pool_reason=EXCLUDED.pool_reason,pooled_at=now(),updated_at=now() WHERE erp_private.task_review_pool.review_pool_status='NAMED';
   IF FOUND THEN INSERT INTO erp_private.task_pool_log(task_id,action,from_reviewer,reason) VALUES(r.task_id,'Pooled',r.reviewer_id,r.reason);n:=n+1; END IF;
  END IF;
 END LOOP;
 -- automatic pool entries whose reason has gone (reviewer back, or task no longer waiting) return to the named reviewer
 FOR r IN SELECT p.task_id,w.reviewer_id FROM erp_private.task_review_pool p JOIN erp_private.task_procedures w ON w.task_id=p.task_id
  WHERE p.review_pool_status='POOL' AND NOT p.manual AND (w.stage<>'Pending supervisor review' OR (w.reviewer_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM erp_private.leave_requests l WHERE l.staff_id=w.reviewer_id AND l.status='Approved' AND l.deleted_at IS NULL AND (now() AT TIME ZONE 'Africa/Nairobi')::date BETWEEN l.starts_on AND l.ends_on)))
 LOOP
  UPDATE erp_private.task_review_pool SET review_pool_status='NAMED',pool_reason=NULL,updated_at=now() WHERE task_id=r.task_id;
  INSERT INTO erp_private.task_pool_log(task_id,action,to_staff_id,reason) VALUES(r.task_id,'Restored',r.reviewer_id,'Reason for pooling no longer applies');n:=n+1;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.refresh_review_pool() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.refresh_review_pool() TO erp_api;
SELECT cron.schedule('pcl-review-pool-refresh','*/30 * * * *','select erp_private.refresh_review_pool();');

CREATE FUNCTION erp_private.task_send_to_pool(p_task uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;w erp_private.task_procedures;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'Supervisor, Manager or Partner required' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.task_allowed(p_task) THEN RAISE EXCEPTION 'This task is not available to your account' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Record why this goes to the pool (at least 10 characters).' USING ERRCODE='23514'; END IF;
 SELECT * INTO w FROM erp_private.task_procedures WHERE task_id=p_task;
 IF w.stage IS NULL OR w.stage='Closed' OR EXISTS(SELECT 1 FROM erp_private.tasks WHERE task_id=p_task AND status IN ('Completed','Cancelled')) THEN RAISE EXCEPTION 'Only open work can go to the pool' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.task_review_pool(task_id,review_pool_status,pool_reason,manual,pooled_at) VALUES(p_task,'POOL',btrim(p_reason),true,now())
  ON CONFLICT (task_id) DO UPDATE SET review_pool_status='POOL',pool_reason=btrim(p_reason),manual=true,pooled_at=now(),updated_at=now();
 INSERT INTO erp_private.task_pool_log(task_id,action,from_reviewer,acted_by,reason) VALUES(p_task,'Sent to pool',w.reviewer_id,a.staff_id,btrim(p_reason));
END $$;

CREATE FUNCTION erp_private.task_pool_claim(p_task uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;w erp_private.task_procedures;t erp_private.tasks;pl erp_private.task_review_pool;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner must pull work from the pool' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.task_allowed(p_task) THEN RAISE EXCEPTION 'This task is not available to your account' USING ERRCODE='42501'; END IF;
 SELECT * INTO pl FROM erp_private.task_review_pool WHERE task_id=p_task FOR UPDATE;
 IF pl.task_id IS NULL OR pl.review_pool_status<>'POOL' THEN RAISE EXCEPTION 'This task is not in the pool' USING ERRCODE='22023'; END IF;
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=p_task;SELECT * INTO w FROM erp_private.task_procedures WHERE task_id=p_task;
 IF a.staff_id IN (t.assigned_to,w.prepared_by) OR EXISTS(SELECT 1 FROM erp_private.timesheets x WHERE x.task_id=p_task AND x.staff_id=a.staff_id AND x.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'You prepared or worked on this task, so you cannot pull it for review' USING ERRCODE='42501';
 END IF;
 INSERT INTO erp_private.task_pool_log(task_id,action,from_reviewer,to_staff_id,acted_by,reason) VALUES(p_task,'Claimed',w.reviewer_id,a.staff_id,a.staff_id,pl.pool_reason);
 UPDATE erp_private.task_procedures SET reviewer_id=a.staff_id WHERE task_id=p_task;
 UPDATE erp_private.task_review_pool SET review_pool_status='NAMED',pool_reason=NULL,manual=false,updated_at=now() WHERE task_id=p_task;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(a.staff_id,p_task,'You pulled "'||t.task_name||'" from the Manager Pool for review.','pool-claim:'||p_task||':'||extract(epoch FROM now())::text) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION erp_private.task_send_to_pool(uuid,text),erp_private.task_pool_claim(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.task_send_to_pool(uuid,text),erp_private.task_pool_claim(uuid) TO erp_api;

-- The reviewer of work waiting for review may change only through a logged pull from the pool in the same transaction.
DO $$
DECLARE d text;n text;
BEGIN
 d:=pg_get_functiondef('erp_private.task_procedure_guard()'::regprocedure);
 n:=replace(d,'AND NEW.stage<>''Pending preparer'' THEN RAISE EXCEPTION ''Return work before changing setup''','AND NEW.stage<>''Pending preparer'' AND NOT EXISTS(SELECT 1 FROM erp_private.task_pool_log l WHERE l.task_id=NEW.task_id AND l.action=''Claimed'' AND l.to_staff_id=NEW.reviewer_id AND l.created_at=now()) THEN RAISE EXCEPTION ''Return work before changing setup''');
 IF n=d THEN RAISE EXCEPTION 'task_procedure_guard text not found'; END IF;
 EXECUTE n;
END $$;

-- 7. Team workload: Partners oversee many projects, so they are never flagged as overloaded.
CREATE OR REPLACE FUNCTION erp_private.team_workload() RETURNS TABLE(staff_id uuid,full_name text,category_code text,active_tasks integer,overdue_tasks integer,on_leave boolean,is_overloaded boolean)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'Supervisor, Manager or Partner required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT s.staff_id,s.full_name,s.category_code,
  coalesce(t.active,0)::integer,coalesce(t.overdue,0)::integer,
  EXISTS(SELECT 1 FROM erp_private.leave_requests l WHERE l.staff_id=s.staff_id AND l.status='Approved' AND l.deleted_at IS NULL AND (now() AT TIME ZONE 'Africa/Nairobi')::date BETWEEN l.starts_on AND l.ends_on),
  (coalesce(t.active,0)>15 AND s.category_code<>'PARTNER')
 FROM erp_private.staff_members s
 LEFT JOIN LATERAL (SELECT count(*) active,count(*) FILTER (WHERE k.due_at<now()) overdue FROM erp_private.tasks k
   WHERE k.assigned_to=s.staff_id AND k.deleted_at IS NULL AND k.status NOT IN ('Completed','Cancelled')) t ON true
 WHERE s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'ADMIN'
 ORDER BY coalesce(t.active,0) DESC,s.full_name;
END $$;
