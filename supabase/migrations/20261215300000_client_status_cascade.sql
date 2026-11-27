-- Client status: Active, Inactive, Dormant, with the effect carried to the client's projects, tasks and invoices.
-- Firm decisions (27 Nov 2026):
--  * Active   = up to date, engagement ongoing. Work runs.
--  * Inactive = no active engagement, can be renewed. The client's open projects and tasks are put on hold: out of work queues, no alerts,
--               no new recurring tasks, no recurring invoices. Set Active again and they come back exactly as they were.
--  * Dormant  = the client has left. The record and all its work are kept, archived and read-only. If the client returns, a Partner
--               chooses to resume the old work or leave it archived and start new work.
--  * A new client starts Active. Manager or Partner: Active and Inactive. Partner only: Dormant and bringing a Dormant client back.
--  * Months spent Inactive or Dormant are never billed automatically. A one-off invoice may still be raised by a Manager or Partner with a reason.
-- Storage is unchanged: Inactive is service_status 'Paused'; Dormant is record_status 'Archived'. 'Cancelled' is no longer offered.
-- Nothing is deleted and no task status is rewritten: a hold marker is placed on the project and task, and lifted on return.

CREATE OR REPLACE FUNCTION erp_private.client_status_of(p_service text,p_record text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_record='Archived' THEN 'Dormant' WHEN p_service<>'Active' THEN 'Inactive' ELSE 'Active' END $$;
CREATE OR REPLACE FUNCTION erp_private.client_is_active(p_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.clients c WHERE c.client_id=p_client AND c.deleted_at IS NULL AND erp_private.client_status_of(c.service_status,c.record_status)='Active') $$;

-- Whether the client took new engagements before it was made Dormant, so that coming back restores it.
ALTER TABLE erp_private.clients ADD COLUMN dormant_prior_accepts boolean;
ALTER TABLE erp_private.projects ADD COLUMN client_hold text CHECK(client_hold IN('Inactive','Dormant','Archived'));
ALTER TABLE erp_private.tasks ADD COLUMN client_hold text CHECK(client_hold IN('Inactive','Dormant','Archived')),
 ADD COLUMN held_at timestamptz, ADD COLUMN redate_needed boolean NOT NULL DEFAULT false;
CREATE INDEX projects_client_hold_idx ON erp_private.projects(client_id) WHERE client_hold IS NOT NULL;
CREATE INDEX tasks_client_hold_idx ON erp_private.tasks(project_id) WHERE client_hold IS NOT NULL;

-- Every status change, kept for good.
CREATE TABLE erp_private.client_status_changes(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id) ON DELETE RESTRICT,
 from_status text NOT NULL CHECK(from_status IN('Active','Inactive','Dormant')),
 to_status text NOT NULL CHECK(to_status IN('Active','Inactive','Dormant')),
 reason text NOT NULL CHECK(length(btrim(reason))>=10),
 old_work text CHECK(old_work IN('Resumed','Left archived')),
 projects_affected integer NOT NULL DEFAULT 0, tasks_affected integer NOT NULL DEFAULT 0,
 changed_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 changed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX client_status_changes_client_idx ON erp_private.client_status_changes(client_id,changed_at DESC);
CREATE INDEX client_status_changes_by_idx ON erp_private.client_status_changes(changed_by);
ALTER TABLE erp_private.client_status_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_status_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY client_status_changes_read ON erp_private.client_status_changes FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
GRANT SELECT ON erp_private.client_status_changes TO erp_api;

-- The stretches of time a client was not Active. Recurring fees are not billed for a period that starts inside one.
CREATE TABLE erp_private.client_hold_periods(
 period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id) ON DELETE RESTRICT,
 status text NOT NULL CHECK(status IN('Inactive','Dormant')),
 started_on date NOT NULL, ended_on date, CHECK(ended_on IS NULL OR ended_on>=started_on));
CREATE INDEX client_hold_periods_client_idx ON erp_private.client_hold_periods(client_id,started_on);
CREATE UNIQUE INDEX client_hold_periods_open_idx ON erp_private.client_hold_periods(client_id) WHERE ended_on IS NULL;
ALTER TABLE erp_private.client_hold_periods ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_hold_periods FORCE ROW LEVEL SECURITY;
CREATE POLICY client_hold_periods_read ON erp_private.client_hold_periods FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
GRANT SELECT ON erp_private.client_hold_periods TO erp_api;
-- Active on a day: no hold covers it. The day a client comes back counts as Active.
CREATE OR REPLACE FUNCTION erp_private.client_active_on(p_client uuid,p_day date) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM erp_private.client_hold_periods h WHERE h.client_id=p_client AND h.started_on<=p_day AND (h.ended_on IS NULL OR h.ended_on>p_day)) $$;

-- Held work is out of sight for everyone in ordinary screens. It is read through client_held_work() on the client's own page.
CREATE POLICY tasks_client_hold ON erp_private.tasks AS RESTRICTIVE FOR ALL TO erp_api USING(client_hold IS NULL) WITH CHECK(client_hold IS NULL);

-- Hold markers move only inside client_status_set(). Held tasks cannot be worked on. No new task for a client that is not Active.
CREATE OR REPLACE FUNCTION erp_private.client_hold_task_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE ok boolean:=COALESCE(current_setting('erp.hold_ok',true),'')='1';p record;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.client_hold IS NOT NULL THEN RAISE EXCEPTION 'A new task cannot start on hold' USING ERRCODE='23514'; END IF;
  SELECT pr.client_hold,erp_private.client_status_of(c.service_status,c.record_status) st INTO p FROM erp_private.projects pr JOIN erp_private.clients c ON c.client_id=pr.client_id WHERE pr.project_id=NEW.project_id;
  IF p.st<>'Active' THEN RAISE EXCEPTION 'This client is %; set the client Active before adding work',lower(p.st) USING ERRCODE='23514'; END IF;
  IF p.client_hold IS NOT NULL THEN RAISE EXCEPTION 'This project was left archived when the client returned; start a new project' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.client_hold IS DISTINCT FROM OLD.client_hold OR NEW.held_at IS DISTINCT FROM OLD.held_at THEN
  IF NOT ok THEN RAISE EXCEPTION 'Change the client''s status to put work on hold or bring it back' USING ERRCODE='42501'; END IF;
  -- The working-time clock stops while the task is held and starts again when it comes back.
  IF NEW.client_hold IS NOT NULL AND OLD.client_hold IS NULL AND OLD.status='In Progress' AND OLD.work_started_at IS NOT NULL THEN
   NEW.work_seconds:=OLD.work_seconds+round(erp_private.working_seconds(OLD.work_started_at,now()))::integer;NEW.work_started_at:=NULL;
  ELSIF NEW.client_hold IS NULL AND OLD.client_hold IS NOT NULL AND NEW.status='In Progress' THEN NEW.work_started_at:=now();
  END IF;
 ELSIF OLD.client_hold IS NOT NULL AND NOT ok THEN RAISE EXCEPTION 'This task is on hold because the client is not Active' USING ERRCODE='23514';
 END IF;
 IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN NEW.redate_needed:=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_client_hold_task_guard BEFORE INSERT OR UPDATE ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.client_hold_task_guard();
CREATE OR REPLACE FUNCTION erp_private.client_hold_project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.client_hold IS DISTINCT FROM OLD.client_hold AND COALESCE(current_setting('erp.hold_ok',true),'')<>'1' THEN RAISE EXCEPTION 'Change the client''s status to put work on hold or bring it back' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_client_hold_project_guard BEFORE UPDATE ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.client_hold_project_guard();
-- No time on held work.
CREATE OR REPLACE FUNCTION erp_private.client_hold_time_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.reverses_id IS NULL AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=NEW.task_id AND t.client_hold IS NOT NULL) THEN RAISE EXCEPTION 'This task is on hold because the client is not Active' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_client_hold_time_guard BEFORE INSERT ON erp_private.timesheets FOR EACH ROW EXECUTE FUNCTION erp_private.client_hold_time_guard();

-- The one way to change a client's status.
CREATE OR REPLACE FUNCTION erp_private.client_status_set(p_client uuid,p_status text,p_reason text,p_resume boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a record;c record;why text:=btrim(COALESCE(p_reason,''));cur text;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 np integer:=0;nt integer:=0;late jsonb:='[]'::jsonb;work text;
BEGIN
 a:=erp_private.actor();
 IF a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can change a client''s status' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF p_status NOT IN('Active','Inactive','Dormant') THEN RAISE EXCEPTION 'Choose Active, Inactive or Dormant' USING ERRCODE='22023'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=p_client AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That client is not available' USING ERRCODE='22023'; END IF;
 cur:=erp_private.client_status_of(c.service_status,c.record_status);
 IF cur=p_status THEN RAISE EXCEPTION 'This client is already %',p_status USING ERRCODE='23514'; END IF;
 IF (cur='Dormant' OR p_status='Dormant') AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can make a client Dormant or bring a Dormant client back' USING ERRCODE='42501'; END IF;
 IF cur='Dormant' AND p_status='Inactive' THEN RAISE EXCEPTION 'A Dormant client comes back as Active' USING ERRCODE='23514'; END IF;
 PERFORM set_config('erp.lifecycle_ok','1',true);PERFORM set_config('erp.hold_ok','1',true);
 IF p_status='Inactive' THEN
  UPDATE erp_private.clients SET service_status='Paused',lifecycle_reason=why,lifecycle_changed_by=a.staff_id,lifecycle_changed_at=now() WHERE client_id=p_client;
 ELSIF p_status='Dormant' THEN
  UPDATE erp_private.clients SET record_status='Archived',archived_from_status=c.record_status,archive_reason=why,archived_by=a.staff_id,archived_at=now(),dormant_prior_accepts=c.accepts_new_engagements,accepts_new_engagements=false WHERE client_id=p_client;
 ELSIF cur='Dormant' THEN
  UPDATE erp_private.clients SET record_status=COALESCE(c.archived_from_status,'Existing'),archive_reason='',archived_by=NULL,archived_at=NULL,accepts_new_engagements=COALESCE(c.dormant_prior_accepts,c.accepts_new_engagements),dormant_prior_accepts=NULL,
   service_status='Active',lifecycle_reason=why,lifecycle_changed_by=a.staff_id,lifecycle_changed_at=now() WHERE client_id=p_client;
 ELSE
  UPDATE erp_private.clients SET service_status='Active',lifecycle_reason=why,lifecycle_changed_by=a.staff_id,lifecycle_changed_at=now() WHERE client_id=p_client;
 END IF;
 UPDATE erp_private.client_hold_periods SET ended_on=today WHERE client_id=p_client AND ended_on IS NULL;
 IF p_status<>'Active' THEN
  INSERT INTO erp_private.client_hold_periods(client_id,status,started_on) VALUES(p_client,p_status,today);
  -- Put the open work on hold. Work left archived at an earlier return stays as it is.
  WITH u AS (UPDATE erp_private.projects SET client_hold=p_status WHERE client_id=p_client AND deleted_at IS NULL AND status<>'Archived' AND client_hold IS DISTINCT FROM 'Archived' RETURNING 1) SELECT count(*) INTO np FROM u;
  WITH u AS (UPDATE erp_private.tasks t SET client_hold=p_status,held_at=COALESCE(t.held_at,now()) FROM erp_private.projects p
   WHERE p.project_id=t.project_id AND p.client_id=p_client AND t.deleted_at IS NULL AND t.client_hold IS DISTINCT FROM 'Archived'
   AND (t.client_hold IS NOT NULL OR t.status NOT IN('Completed','Cancelled')) RETURNING 1) SELECT count(*) INTO nt FROM u;
 ELSIF cur='Dormant' AND NOT COALESCE(p_resume,true) THEN
  -- The client is back but the old work stays archived. It is kept, hidden and read-only; new projects carry the new engagement.
  work:='Left archived';
  WITH u AS (UPDATE erp_private.projects SET client_hold='Archived' WHERE client_id=p_client AND client_hold IN('Inactive','Dormant') RETURNING 1) SELECT count(*) INTO np FROM u;
  WITH u AS (UPDATE erp_private.tasks t SET client_hold='Archived' FROM erp_private.projects p WHERE p.project_id=t.project_id AND p.client_id=p_client AND t.client_hold IN('Inactive','Dormant') RETURNING 1) SELECT count(*) INTO nt FROM u;
 ELSE
  work:=CASE WHEN cur='Dormant' THEN 'Resumed' END;
  WITH u AS (UPDATE erp_private.projects SET client_hold=NULL WHERE client_id=p_client AND client_hold IN('Inactive','Dormant') RETURNING 1) SELECT count(*) INTO np FROM u;
  -- Tasks come back as they were. One whose due date passed meanwhile is marked for a new date; no overdue alert is sent for it until it is re-dated.
  WITH u AS (UPDATE erp_private.tasks t SET client_hold=NULL,held_at=NULL,redate_needed=(t.due_at IS NOT NULL AND t.due_at<now() AND t.status NOT IN('Completed','Cancelled'))
   FROM erp_private.projects p WHERE p.project_id=t.project_id AND p.client_id=p_client AND t.client_hold IN('Inactive','Dormant')
   RETURNING t.task_id,t.task_name,t.due_at,t.assigned_to,t.redate_needed)
  SELECT count(*),COALESCE(jsonb_agg(jsonb_build_object('task_id',task_id,'task_name',task_name,'due_at',due_at,'assigned_to',assigned_to)) FILTER(WHERE redate_needed),'[]'::jsonb) INTO nt,late FROM u;
 END IF;
 INSERT INTO erp_private.client_status_changes(client_id,from_status,to_status,reason,old_work,projects_affected,tasks_affected,changed_by) VALUES(p_client,cur,p_status,why,work,np,nt,a.staff_id);
 IF p_status='Dormant' THEN
  PERFORM erp_private.alert_partners('client-status:'||p_client||':Dormant:'||floor(extract(epoch FROM now()))::text,
   c.company_name||' was made Dormant by '||COALESCE((SELECT full_name FROM erp_private.staff_members WHERE staff_id=a.staff_id),'a Partner')||'. Reason: '||why);
 END IF;
 IF jsonb_array_length(late)>0 THEN
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(a.staff_id,c.company_name||' is Active again. '||jsonb_array_length(late)||' task(s) passed their due date while the client was not Active. Open the client and give them new dates.',
   'client-redate:'||p_client||':'||floor(extract(epoch FROM now()))::text) ON CONFLICT(event_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('ok',true,'client_id',p_client,'from_status',cur,'status',p_status,'projects',np,'tasks',nt,'old_work',work,'to_redate',late);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_status_set(uuid,text,text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_status_set(uuid,text,text,boolean) TO erp_api;

-- The earlier entry point keeps working and follows the same rules. Cancel is no longer offered.
CREATE OR REPLACE FUNCTION erp_private.client_lifecycle(p_client uuid,p_action text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF p_action='Cancel' THEN RAISE EXCEPTION 'Cancel is no longer used. Set the client Inactive, or Dormant if the client has left' USING ERRCODE='22023'; END IF;
 IF p_action NOT IN('Pause','Resume','Archive','Restore') THEN RAISE EXCEPTION 'Unknown lifecycle action' USING ERRCODE='22023'; END IF;
 RETURN erp_private.client_status_set(p_client,CASE p_action WHEN 'Pause' THEN 'Inactive' WHEN 'Archive' THEN 'Dormant' ELSE 'Active' END,p_reason,true)||jsonb_build_object('action',p_action);
END $$;

-- The held work of one client, for the client's own page. Manager, Partner or Supervisor who can open the client.
CREATE OR REPLACE FUNCTION erp_private.client_held_work(p_client uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a record;
BEGIN
 a:=erp_private.actor();
 IF a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') OR NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'status',(SELECT erp_private.client_status_of(service_status,record_status) FROM erp_private.clients WHERE client_id=p_client),
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('project_id',p.project_id,'project_name',p.project_name,'status',p.status,'client_hold',p.client_hold) ORDER BY p.project_name)
   FROM erp_private.projects p WHERE p.client_id=p_client AND p.deleted_at IS NULL AND p.client_hold IS NOT NULL AND erp_private.firm_allowed(p.handling_firm_id)),'[]'::jsonb),
  'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id',t.task_id,'project_id',t.project_id,'task_name',t.task_name,'status',t.status,'due_at',t.due_at,'assigned_to',t.assigned_to,'assigned_name',s.full_name,'client_hold',t.client_hold,'held_at',t.held_at) ORDER BY t.due_at NULLS LAST)
   FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id LEFT JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to
   WHERE p.client_id=p_client AND t.deleted_at IS NULL AND t.client_hold IS NOT NULL AND erp_private.firm_allowed(p.handling_firm_id)),'[]'::jsonb),
  'to_redate',COALESCE((SELECT jsonb_agg(jsonb_build_object('task_id',t.task_id,'project_id',t.project_id,'task_name',t.task_name,'due_at',t.due_at,'assigned_to',t.assigned_to,'assigned_name',s.full_name) ORDER BY t.due_at)
   FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id LEFT JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to
   WHERE p.client_id=p_client AND t.deleted_at IS NULL AND t.redate_needed AND t.client_hold IS NULL AND t.status NOT IN('Completed','Cancelled')),'[]'::jsonb),
  'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('from_status',h.from_status,'to_status',h.to_status,'reason',h.reason,'old_work',h.old_work,'projects',h.projects_affected,'tasks',h.tasks_affected,'changed_at',h.changed_at,'changed_by',s.full_name) ORDER BY h.changed_at DESC)
   FROM erp_private.client_status_changes h LEFT JOIN erp_private.staff_members s ON s.staff_id=h.changed_by WHERE h.client_id=p_client),'[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_held_work(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_held_work(uuid) TO erp_api;

-- Background jobs leave held work alone: no generated tasks, no overdue, missing-document or stuck alerts, no recurring invoices.
DO $do$
DECLARE def text;nd text;
BEGIN
 def:=pg_get_functiondef('erp_private.run_workspace_scheduler()'::regprocedure);
 nd:=replace(def,$r$AND cl.service_status='Active' AND cl.record_status<>'Archived' LOOP$r$,$r$AND cl.service_status='Active' AND cl.record_status<>'Archived' AND pr.client_hold IS NULL LOOP$r$);
 IF nd=def THEN RAISE EXCEPTION 'scheduler: task generation patch not applied'; END IF;def:=nd;
 nd:=replace(def,$r$AND t.status NOT IN ('Completed','Cancelled') AND r.staff_id IS NOT NULL ON CONFLICT$r$,$r$AND t.status NOT IN ('Completed','Cancelled') AND t.client_hold IS NULL AND NOT t.redate_needed AND r.staff_id IS NOT NULL ON CONFLICT$r$);
 IF nd=def THEN RAISE EXCEPTION 'scheduler: overdue patch not applied'; END IF;def:=nd;
 nd:=replace(def,$r$WHERE t.requires_document AND t.status IN ('Pending','In Progress','Blocked')$r$,$r$WHERE t.client_hold IS NULL AND t.requires_document AND t.status IN ('Pending','In Progress','Blocked')$r$);
 IF nd=def THEN RAISE EXCEPTION 'scheduler: missing-document patch not applied'; END IF;
 EXECUTE nd;
 def:=pg_get_functiondef('erp_private.stuck_task_scan()'::regprocedure);
 nd:=replace(def,$r$WHERE t.status='In Progress' AND t.work_started_at IS NOT NULL$r$,$r$WHERE t.client_hold IS NULL AND t.status='In Progress' AND t.work_started_at IS NOT NULL$r$);
 IF nd=def THEN RAISE EXCEPTION 'stuck scan patch not applied'; END IF;
 EXECUTE nd;
 def:=pg_get_functiondef('erp_private.run_recurring_fee_drafts()'::regprocedure);
 nd:=replace(def,$r$WHERE f.status='Active' AND p.status='Active' AND p.deleted_at IS NULL LOOP$r$,$r$WHERE f.status='Active' AND p.status='Active' AND p.deleted_at IS NULL AND p.client_hold IS NULL AND erp_private.client_is_active(p.client_id) LOOP$r$);
 IF nd=def THEN RAISE EXCEPTION 'recurring fees: client status patch not applied'; END IF;def:=nd;
 -- A period that starts while the client was not Active is skipped for good, so coming back does not bill the gap.
 nd:=replace(def,$r$OR made>=12;$r$,$r$OR made>=12;
   CONTINUE WHEN NOT erp_private.client_active_on(s.client_id,pstart);$r$);
 IF nd=def THEN RAISE EXCEPTION 'recurring fees: gap patch not applied'; END IF;
 EXECUTE nd;
END $do$;

-- 'Cancelled' is retired. Any client still marked so becomes Inactive (none exist in production at the time of writing).
DO $do$ BEGIN
 PERFORM set_config('erp.lifecycle_ok','1',true);
 INSERT INTO erp_private.client_hold_periods(client_id,status,started_on)
  SELECT client_id,erp_private.client_status_of(service_status,record_status),COALESCE((CASE WHEN record_status='Archived' THEN archived_at ELSE lifecycle_changed_at END AT TIME ZONE 'Africa/Nairobi')::date,current_date)
  FROM erp_private.clients WHERE deleted_at IS NULL AND erp_private.client_status_of(service_status,record_status)<>'Active';
 UPDATE erp_private.clients SET service_status='Paused' WHERE service_status='Cancelled';
END $do$;

-- Invoices. No recurring invoice while the client is not Active. A one-off invoice (for example a final bill) may be raised by a
-- Manager or Partner who gives a reason; the reason is kept on the invoice. Receipts, credit notes and statements are not affected.
ALTER TABLE erp_private.invoices ADD COLUMN inactive_client_reason text, ADD COLUMN inactive_client_status text CHECK(inactive_client_status IN('Inactive','Dormant'));
CREATE OR REPLACE FUNCTION erp_private.client_status_invoice_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE st text;why text:=btrim(COALESCE(current_setting('erp.inactive_invoice_reason',true),''));
BEGIN
 SELECT erp_private.client_status_of(service_status,record_status) INTO st FROM erp_private.clients WHERE client_id=NEW.client_id;
 IF st IS NULL OR st='Active' THEN NEW.inactive_client_reason:=NULL;NEW.inactive_client_status:=NULL;RETURN NEW; END IF;
 IF NEW.recurring_fee_schedule_id IS NOT NULL THEN RAISE EXCEPTION 'This client is %; recurring invoices are not raised until the client is Active again',lower(st) USING ERRCODE='23514'; END IF;
 IF (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'This client is %; only a Manager or Partner can raise an invoice for it',lower(st) USING ERRCODE='42501'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'This client is %; give the reason for this invoice in at least 10 characters',lower(st) USING ERRCODE='22023'; END IF;
 NEW.inactive_client_reason:=why;NEW.inactive_client_status:=st;
 RETURN NEW;
END $$;
CREATE TRIGGER a_client_status_invoice_guard BEFORE INSERT ON erp_private.invoices FOR EACH ROW EXECUTE FUNCTION erp_private.client_status_invoice_guard();

-- The client register can list the Dormant archive on its own. Active and Inactive never include Dormant clients.
DO $do$
DECLARE r record;nd text;n integer:=0;
BEGIN
 FOR r IN SELECT p.oid,pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='erp_private' AND p.proname='client_register' LOOP
  nd:=replace(r.def,$r$AND (p_archived OR c.record_status<>'Archived')$r$,$r$AND (p_archived OR p_service='Dormant' OR c.record_status<>'Archived')$r$);
  nd:=replace(nd,$r$AND (p_service IS NULL OR c.service_status=p_service)$r$,$r$AND (p_service IS NULL OR (p_service='Dormant' AND c.record_status='Archived') OR (p_service<>'Dormant' AND c.service_status=p_service AND c.record_status<>'Archived'))$r$);
  IF nd=r.def OR position($r$p_service='Dormant' AND c.record_status='Archived'$r$ IN nd)=0 OR position($r$p_archived OR p_service='Dormant'$r$ IN nd)=0 THEN RAISE EXCEPTION 'client register patch not applied'; END IF;
  EXECUTE nd;n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'expected one client_register function, found %',n; END IF;
END $do$;

-- The project guard speaks in the new words.
CREATE OR REPLACE FUNCTION erp_private.client_lifecycle_project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c record;
BEGIN
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'Active') THEN
  SELECT service_status,record_status INTO c FROM erp_private.clients WHERE client_id=NEW.client_id;
  IF c.record_status='Archived' THEN RAISE EXCEPTION 'This client is dormant; a Partner must set it Active before new work starts' USING ERRCODE='23514'; END IF;
  IF c.service_status<>'Active' THEN RAISE EXCEPTION 'This client is inactive; set it Active before starting new work' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

-- Functions that read tasks with the owner's rights (so past row security) also leave held work out:
-- the access check used across the system, the workload and deadline lists, the review pool, handovers and the open-task counts.
DO $do$
DECLARE x record;r record;nd text;n integer;
BEGIN
 FOR x IN SELECT * FROM (VALUES
  ('task_allowed','WHERE x.task_id=t AND x.deleted_at IS NULL','WHERE x.task_id=t AND x.client_hold IS NULL AND x.deleted_at IS NULL'),
  ('workload_tasks','JOIN erp_private.tasks t ON t.deleted_at IS NULL','JOIN erp_private.tasks t ON t.client_hold IS NULL AND t.deleted_at IS NULL'),
  ('team_rank','k.assigned_to=m.staff_id AND k.deleted_at IS NULL','k.assigned_to=m.staff_id AND k.client_hold IS NULL AND k.deleted_at IS NULL'),
  ('handover_candidates','t.assigned_to=s.staff_id AND t.deleted_at IS NULL','t.assigned_to=s.staff_id AND t.client_hold IS NULL AND t.deleted_at IS NULL'),
  ('handover_apply','WHERE project_id=p_project AND deleted_at IS NULL AND status NOT IN(''Completed'',''Cancelled'')','WHERE project_id=p_project AND client_hold IS NULL AND deleted_at IS NULL AND status NOT IN(''Completed'',''Cancelled'')'),
  ('refresh_review_pool','WHERE t.deleted_at IS NULL AND t.status NOT IN (''Completed'',''Cancelled'') AND w.stage=''Pending supervisor review''','WHERE t.client_hold IS NULL AND t.deleted_at IS NULL AND t.status NOT IN (''Completed'',''Cancelled'') AND w.stage=''Pending supervisor review'''),
  ('filing_state','JOIN erp_private.projects p ON p.project_id=t.project_id','JOIN erp_private.projects p ON p.project_id=t.project_id AND t.client_hold IS NULL')
 ) AS v(fn,old,new) LOOP
  n:=0;
  FOR r IN SELECT p.oid,pg_get_functiondef(p.oid) def FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE ns.nspname='erp_private' AND p.proname=x.fn LOOP
   nd:=replace(r.def,x.old,x.new);
   IF nd=r.def THEN RAISE EXCEPTION 'held-work patch not applied to %',x.fn; END IF;
   EXECUTE nd;n:=n+1;
  END LOOP;
  IF n<>1 THEN RAISE EXCEPTION 'expected one function named %, found %',x.fn,n; END IF;
 END LOOP;
END $do$;
