-- Monthly compliance work period: four mandatory weekly tasks, cleared one at a time by an independent reviewer, then open extra tasks until the
-- return is filed with its acknowledgement. After that the month is locked: new work needs an amendment, linked to the original month.
-- Builds on project_work_periods (period_kind 'Monthly') and work_period_tasks. Nothing is changed for work periods that were not opened here.

ALTER TABLE erp_private.work_period_tasks
 ADD COLUMN task_kind text NOT NULL DEFAULT 'Extra' CHECK(task_kind IN('Weekly','Extra','Supplementary')),
 ADD COLUMN amendment_case_id uuid REFERENCES erp_private.tax_cases;

-- One row per month opened through this feature. Only these months are weekly-tracked and lockable.
CREATE TABLE erp_private.month_work_meta(
 work_period_id uuid PRIMARY KEY REFERENCES erp_private.project_work_periods,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 month_start date NOT NULL CHECK(month_start=date_trunc('month',month_start)::date),
 preparer_id uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_by uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_at timestamptz NOT NULL DEFAULT now(),
 duplicate_reason text, duplicate_approved_by uuid REFERENCES erp_private.staff_members,
 CHECK(duplicate_reason IS NULL OR (length(btrim(duplicate_reason))>=10 AND duplicate_approved_by IS NOT NULL))
);
-- One monthly record per client and month unless a Manager or Partner documented why a second is needed.
CREATE UNIQUE INDEX month_work_one_per_client_month ON erp_private.month_work_meta(client_id,month_start) WHERE duplicate_reason IS NULL;

CREATE TABLE erp_private.work_period_weeks(
 task_id uuid PRIMARY KEY REFERENCES erp_private.tasks,
 work_period_id uuid NOT NULL REFERENCES erp_private.month_work_meta(work_period_id),
 week_no smallint NOT NULL CHECK(week_no BETWEEN 1 AND 4),
 window_start date NOT NULL, window_end date NOT NULL,
 checklist jsonb NOT NULL DEFAULT '{"sales":false,"purchases":false,"bank":false,"mapping":false,"review":false,"reporting":false}',
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Submitted','Returned','Cleared')),
 submitted_by uuid REFERENCES erp_private.staff_members, submitted_at timestamptz,
 cleared_by uuid REFERENCES erp_private.staff_members, cleared_at timestamptz, return_note text,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(work_period_id,week_no),
 CHECK(status<>'Cleared' OR (cleared_by IS NOT NULL AND submitted_by IS NOT NULL AND cleared_by<>submitted_by))
);
CREATE INDEX work_period_weeks_period_idx ON erp_private.work_period_weeks(work_period_id,status);
ALTER TABLE erp_private.month_work_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.work_period_weeks ENABLE ROW LEVEL SECURITY;
CREATE POLICY month_work_read ON erp_private.month_work_meta FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.project_work_periods w WHERE w.work_period_id=month_work_meta.work_period_id AND erp_private.project_allowed(w.project_id)));
CREATE POLICY week_read ON erp_private.work_period_weeks FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
GRANT SELECT ON erp_private.month_work_meta,erp_private.work_period_weeks TO erp_api;
REVOKE ALL ON erp_private.month_work_meta,erp_private.work_period_weeks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON erp_private.month_work_meta,erp_private.work_period_weeks TO erp_api;
CREATE TRIGGER month_work_no_delete BEFORE DELETE ON erp_private.month_work_meta FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER week_no_delete BEFORE DELETE ON erp_private.work_period_weeks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER month_work_audit AFTER INSERT OR UPDATE ON erp_private.month_work_meta FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('work_period_id');
CREATE TRIGGER week_audit AFTER INSERT OR UPDATE ON erp_private.work_period_weeks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('task_id');

-- A month is closed once a filing record (with its acknowledgement or approved exception) covers it.
CREATE FUNCTION erp_private.month_closed(p_period uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.project_work_periods w JOIN erp_private.month_work_meta m USING(work_period_id)
  JOIN erp_private.tax_filings f ON f.project_id=w.project_id AND f.starts_on<=w.starts_on AND f.ends_on>=w.ends_on
  WHERE w.work_period_id=p_period)
$$;
CREATE FUNCTION erp_private.month_cleared(p_period uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT count(*)::int FROM erp_private.work_period_weeks x JOIN erp_private.tasks t USING(task_id) WHERE x.work_period_id=p_period AND x.status='Cleared' AND t.status<>'Cancelled' AND t.deleted_at IS NULL
$$;
REVOKE ALL ON FUNCTION erp_private.month_closed(uuid),erp_private.month_cleared(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.month_closed(uuid),erp_private.month_cleared(uuid) TO erp_api;

-- Database rules that no screen can bypass.
CREATE FUNCTION erp_private.month_task_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m erp_private.month_work_meta; w erp_private.project_work_periods;
BEGIN
 SELECT * INTO m FROM erp_private.month_work_meta WHERE work_period_id=NEW.work_period_id;
 IF m.work_period_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO w FROM erp_private.project_work_periods WHERE work_period_id=NEW.work_period_id;
 IF NEW.task_kind='Weekly' THEN RETURN NEW; END IF;
 IF erp_private.month_closed(NEW.work_period_id) THEN
  IF NEW.task_kind<>'Supplementary' OR NEW.amendment_case_id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.tax_cases c WHERE c.case_id=NEW.amendment_case_id AND c.project_id=w.project_id AND c.amends_case_id IS NOT NULL AND c.status<>'Filed' AND c.starts_on<=w.starts_on AND c.ends_on>=w.ends_on) THEN
   RAISE EXCEPTION 'This month is closed: the return is filed. Further work needs an amendment started by a Manager, and the task is recorded as supplementary to it.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.task_kind='Supplementary' THEN RAISE EXCEPTION 'A supplementary task needs a filed month and an open amendment.' USING ERRCODE='23514'; END IF;
 IF erp_private.month_cleared(NEW.work_period_id)<4 THEN RAISE EXCEPTION 'Clear the four weekly tasks before adding other tasks for this month.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER month_task_link_guard BEFORE INSERT ON erp_private.work_period_tasks FOR EACH ROW EXECUTE FUNCTION erp_private.month_task_link_guard();

CREATE FUNCTION erp_private.week_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; t erp_private.tasks;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.week_no>1 AND NOT EXISTS(SELECT 1 FROM erp_private.work_period_weeks p WHERE p.work_period_id=NEW.work_period_id AND p.week_no=NEW.week_no-1 AND p.status='Cleared') THEN
   RAISE EXCEPTION 'Week % can be created only after week % is cleared by a reviewer.',NEW.week_no,NEW.week_no-1 USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.task_id,NEW.work_period_id,NEW.week_no,NEW.window_start,NEW.window_end) IS DISTINCT FROM (OLD.task_id,OLD.work_period_id,OLD.week_no,OLD.window_start,OLD.window_end) THEN RAISE EXCEPTION 'A weekly task cannot be moved.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Cleared' THEN RAISE EXCEPTION 'A cleared week is final.' USING ERRCODE='23514'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status,NEW.status) IN(('Open','Submitted'),('Returned','Submitted'),('Submitted','Cleared'),('Submitted','Returned'))) THEN RAISE EXCEPTION 'That change of status is not allowed.' USING ERRCODE='23514'; END IF;
 IF NEW.status='Cleared' THEN
  SELECT * INTO t FROM erp_private.tasks WHERE task_id=NEW.task_id;
  IF NEW.cleared_by IS NULL OR NEW.cleared_by=NEW.submitted_by OR NEW.cleared_by=t.assigned_to THEN RAISE EXCEPTION 'A different reviewer must clear the week: not the preparer who submitted it.' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER week_guard BEFORE INSERT OR UPDATE ON erp_private.work_period_weeks FOR EACH ROW EXECUTE FUNCTION erp_private.week_guard();

-- Tasks cannot be created straight into a closed month by any other route: a task due inside a closed, weekly-tracked month is refused unless it goes through month_add_task.
CREATE FUNCTION erp_private.month_closed_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF coalesce(current_setting('erp.month_task',true),'')='1' OR NEW.due_at IS NULL THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.project_work_periods w JOIN erp_private.month_work_meta m USING(work_period_id)
   WHERE w.project_id=NEW.project_id AND (NEW.due_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN w.starts_on AND w.ends_on AND erp_private.month_closed(w.work_period_id)) THEN
  RAISE EXCEPTION 'This month is closed: the return is filed. Further work needs an amendment started by a Manager.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER month_closed_task_guard BEFORE INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.month_closed_task_guard();

-- Actions. Each re-checks who is calling; the database rules above hold even if these are bypassed.
CREATE FUNCTION erp_private.month_lead() RETURNS erp_private.staff_members LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.actor();
BEGIN IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'A Partner, Manager or Supervisor manages the monthly work.' USING ERRCODE='42501'; END IF; RETURN a; END $$;

CREATE FUNCTION erp_private.month_make_task(p_period uuid,p_name text,p_due date,p_preparer uuid,p_kind text,p_week smallint,p_amend uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w erp_private.project_work_periods; pr erp_private.projects; s erp_private.staff_members; tid uuid;
BEGIN
 SELECT * INTO w FROM erp_private.project_work_periods WHERE work_period_id=p_period;
 SELECT * INTO pr FROM erp_private.projects WHERE project_id=w.project_id;
 SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=p_preparer AND deleted_at IS NULL AND access_status='Active';
 IF s.staff_id IS NULL OR s.category_code<>'ASSISTANT' THEN RAISE EXCEPTION 'Tasks are assigned to an Assistant. Choose an active Assistant.' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(w.project_id,s.staff_id,pr.handling_firm_id,s.category_code) ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL;
 PERFORM set_config('erp.month_task','1',true);
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at) VALUES(w.project_id,s.staff_id,btrim(p_name),CASE WHEN p_kind='Weekly' THEN 'Weekly checklist: sales, purchases, bank, mapping, review and reporting.' ELSE NULL END,(p_due||'T17:00:00+03:00')::timestamptz) RETURNING task_id INTO tid;
 INSERT INTO erp_private.work_period_tasks(task_id,work_period_id,task_kind,amendment_case_id) VALUES(tid,p_period,p_kind,p_amend);
 PERFORM set_config('erp.month_task','',true);
 RETURN tid;
END $$;

CREATE FUNCTION erp_private.month_open(p_project uuid,p_month date,p_preparer uuid,p_duplicate_reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.month_lead(); pr erp_private.projects; ms date:=date_trunc('month',p_month)::date; me date; wp uuid; dup text:=NULLIF(btrim(coalesce(p_duplicate_reason,'')),''); existing uuid;
BEGIN
 IF NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'You cannot open months on this engagement.' USING ERRCODE='42501'; END IF;
 SELECT * INTO pr FROM erp_private.projects WHERE project_id=p_project FOR UPDATE;
 IF pr.status<>'Active' THEN RAISE EXCEPTION 'The engagement must be active.' USING ERRCODE='23514'; END IF;
 me:=(ms+interval '1 month'-interval '1 day')::date;
 SELECT m.work_period_id INTO existing FROM erp_private.month_work_meta m JOIN erp_private.project_work_periods w USING(work_period_id) WHERE w.project_id=p_project AND m.month_start=ms;
 IF existing IS NOT NULL THEN RETURN existing; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.month_work_meta WHERE client_id=pr.client_id AND month_start=ms AND duplicate_reason IS NULL) THEN
  IF dup IS NULL OR length(dup)<10 THEN RAISE EXCEPTION 'This client already has a monthly record for that month. A second one needs a documented reason (at least 10 characters).' USING ERRCODE='23514'; END IF;
  IF a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner approves a second monthly record.' USING ERRCODE='42501'; END IF;
 ELSE dup:=NULL; END IF;
 SELECT work_period_id INTO wp FROM erp_private.project_work_periods WHERE project_id=p_project AND period_kind='Monthly' AND starts_on=ms;
 IF wp IS NULL THEN INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on) VALUES(p_project,'Monthly',ms,me) RETURNING work_period_id INTO wp; END IF;
 INSERT INTO erp_private.month_work_meta(work_period_id,client_id,month_start,preparer_id,opened_by,duplicate_reason,duplicate_approved_by) VALUES(wp,pr.client_id,ms,p_preparer,a.staff_id,dup,CASE WHEN dup IS NULL THEN NULL ELSE a.staff_id END);
 PERFORM erp_private.month_new_week(wp);
 RETURN wp;
END $$;

-- Creates the next weekly task, once. Repeated calls return the task that already exists; it refuses until the previous week is cleared.
CREATE FUNCTION erp_private.month_new_week(p_period uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.month_lead(); m erp_private.month_work_meta; w erp_private.project_work_periods; n smallint; tid uuid; ws date; we date;
BEGIN
 SELECT * INTO w FROM erp_private.project_work_periods WHERE work_period_id=p_period FOR UPDATE;
 SELECT * INTO m FROM erp_private.month_work_meta WHERE work_period_id=p_period;
 IF m.work_period_id IS NULL OR NOT erp_private.project_allowed(w.project_id) THEN RAISE EXCEPTION 'Choose a monthly work period you can manage.' USING ERRCODE='42501'; END IF;
 IF erp_private.month_closed(p_period) THEN RAISE EXCEPTION 'This month is closed: the return is filed.' USING ERRCODE='23514'; END IF;
 SELECT coalesce(max(week_no),0)+1 INTO n FROM erp_private.work_period_weeks WHERE work_period_id=p_period;
 IF n>4 THEN SELECT task_id INTO tid FROM erp_private.work_period_weeks WHERE work_period_id=p_period AND week_no=4; RETURN tid; END IF;
 IF n>1 AND NOT EXISTS(SELECT 1 FROM erp_private.work_period_weeks WHERE work_period_id=p_period AND week_no=n-1 AND status='Cleared') THEN
  -- Not cleared yet: the existing open week is the answer, so a repeated click creates nothing new.
  SELECT task_id INTO tid FROM erp_private.work_period_weeks WHERE work_period_id=p_period AND week_no=n-1;
  RETURN tid; END IF;
 ws:=m.month_start+((n-1)*7); we:=CASE n WHEN 4 THEN m.month_start+27 ELSE ws+6 END;
 tid:=erp_private.month_make_task(p_period,'Week '||n||' compliance ('||to_char(ws,'DD Mon')||' to '||to_char(we,'DD Mon YYYY')||')',we,m.preparer_id,'Weekly',n,NULL);
 INSERT INTO erp_private.work_period_weeks(task_id,work_period_id,week_no,window_start,window_end,created_by) VALUES(tid,p_period,n,ws,we,a.staff_id);
 RETURN tid;
END $$;

CREATE FUNCTION erp_private.month_week_submit(p_task uuid,p_checklist jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.actor(); x erp_private.work_period_weeks; t erp_private.tasks; k text; ck jsonb;
BEGIN
 SELECT * INTO x FROM erp_private.work_period_weeks WHERE task_id=p_task FOR UPDATE;
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=p_task;
 IF x.task_id IS NULL OR a.staff_id IS NULL OR t.assigned_to<>a.staff_id THEN RAISE EXCEPTION 'Only the Assistant assigned to this weekly task submits it.' USING ERRCODE='42501'; END IF;
 IF x.status NOT IN('Open','Returned') THEN RAISE EXCEPTION 'This week is already submitted or cleared.' USING ERRCODE='23514'; END IF;
 ck:=x.checklist;
 FOR k IN SELECT jsonb_object_keys(x.checklist) LOOP ck:=jsonb_set(ck,ARRAY[k],to_jsonb(coalesce((p_checklist->>k)='true',false))); END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_each(ck) WHERE value<>'true'::jsonb) THEN RAISE EXCEPTION 'Tick every checklist item before submitting.' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.work_period_weeks SET status='Submitted',checklist=ck,submitted_by=a.staff_id,submitted_at=now(),return_note=NULL WHERE task_id=p_task;
 UPDATE erp_private.tasks SET status='In Review' WHERE task_id=p_task AND status NOT IN('Completed','Cancelled');
END $$;

CREATE FUNCTION erp_private.month_week_clear(p_task uuid,p_clear boolean,p_note text DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.month_lead(); x erp_private.work_period_weeks; w erp_private.project_work_periods;
BEGIN
 SELECT * INTO x FROM erp_private.work_period_weeks WHERE task_id=p_task FOR UPDATE;
 SELECT * INTO w FROM erp_private.project_work_periods WHERE work_period_id=x.work_period_id;
 IF x.task_id IS NULL OR NOT erp_private.project_allowed(w.project_id) THEN RAISE EXCEPTION 'Choose a weekly task you can review.' USING ERRCODE='42501'; END IF;
 IF x.status<>'Submitted' THEN RAISE EXCEPTION 'The preparer has not submitted this week.' USING ERRCODE='23514'; END IF;
 IF p_clear THEN
  UPDATE erp_private.work_period_weeks SET status='Cleared',cleared_by=a.staff_id,cleared_at=now() WHERE task_id=p_task;
  UPDATE erp_private.tasks SET status='Completed' WHERE task_id=p_task;
 ELSE
  IF length(btrim(coalesce(p_note,'')))<10 THEN RAISE EXCEPTION 'Say what must be corrected (at least 10 characters).' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.work_period_weeks SET status='Returned',return_note=btrim(p_note) WHERE task_id=p_task;
  UPDATE erp_private.tasks SET status='In Progress' WHERE task_id=p_task;
 END IF;
END $$;

CREATE FUNCTION erp_private.month_add_task(p_period uuid,p_name text,p_due date,p_assignee uuid,p_amendment uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members:=erp_private.month_lead(); w erp_private.project_work_periods; kind text;
BEGIN
 SELECT * INTO w FROM erp_private.project_work_periods WHERE work_period_id=p_period;
 IF w.work_period_id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.month_work_meta WHERE work_period_id=p_period) OR NOT erp_private.project_allowed(w.project_id) THEN RAISE EXCEPTION 'Choose a monthly work period you can manage.' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_name,'')))<3 THEN RAISE EXCEPTION 'Name the task.' USING ERRCODE='23514'; END IF;
 kind:=CASE WHEN erp_private.month_closed(p_period) THEN 'Supplementary' ELSE 'Extra' END;
 RETURN erp_private.month_make_task(p_period,p_name,p_due,p_assignee,kind,NULL,p_amendment);
END $$;

-- What the month card and the supervisor exception list show.
CREATE FUNCTION erp_private.month_overview(p_project uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(r ORDER BY (r->>'month_start') DESC,(r->>'client_name')),'[]'::jsonb) FROM (
  SELECT jsonb_build_object('work_period_id',m.work_period_id,'project_id',w.project_id,'client_id',m.client_id,'client_name',c.company_name,
   'month_start',m.month_start,'month_end',w.ends_on,'cleared',erp_private.month_cleared(m.work_period_id),'required',4,
   'closed',erp_private.month_closed(m.work_period_id),
   'flag',CASE WHEN erp_private.month_closed(m.work_period_id) THEN 'Closed'
     WHEN (now() AT TIME ZONE 'Africa/Nairobi')::date>w.ends_on AND erp_private.month_cleared(m.work_period_id)<4 THEN 'Fewer than four clearances at month-end'
     ELSE 'On track' END,
   'weeks',(SELECT coalesce(jsonb_agg(jsonb_build_object('task_id',x.task_id,'week_no',x.week_no,'status',x.status,'window_start',x.window_start,'window_end',x.window_end,'checklist',x.checklist,'return_note',x.return_note,'assigned_to',t.assigned_to,'submitted_by',x.submitted_by) ORDER BY x.week_no),'[]'::jsonb) FROM erp_private.work_period_weeks x JOIN erp_private.tasks t USING(task_id) WHERE x.work_period_id=m.work_period_id),
   'extra_tasks',(SELECT count(*) FROM erp_private.work_period_tasks k WHERE k.work_period_id=m.work_period_id AND k.task_kind IN('Extra','Supplementary')),
   'can_add_extra',(erp_private.month_cleared(m.work_period_id)>=4 AND NOT erp_private.month_closed(m.work_period_id))) r
  FROM erp_private.month_work_meta m JOIN erp_private.project_work_periods w USING(work_period_id) JOIN erp_private.clients c ON c.client_id=m.client_id
  WHERE erp_private.project_allowed(w.project_id) AND (p_project IS NULL OR w.project_id=p_project)) q
$$;
REVOKE ALL ON FUNCTION erp_private.month_lead(),erp_private.month_make_task(uuid,text,date,uuid,text,smallint,uuid),erp_private.month_open(uuid,date,uuid,text),erp_private.month_new_week(uuid),erp_private.month_week_submit(uuid,jsonb),erp_private.month_week_clear(uuid,boolean,text),erp_private.month_add_task(uuid,text,date,uuid,uuid),erp_private.month_overview(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.month_open(uuid,date,uuid,text),erp_private.month_new_week(uuid),erp_private.month_week_submit(uuid,jsonb),erp_private.month_week_clear(uuid,boolean,text),erp_private.month_add_task(uuid,text,date,uuid,uuid),erp_private.month_overview(uuid) TO erp_api;
