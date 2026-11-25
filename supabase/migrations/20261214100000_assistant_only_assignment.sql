-- Assignment is for Assistants only. Supervisors, Managers and Partners check, verify, edit and reassign; they do not hold tasks.
-- One rule in the database covers every way a task is created or reassigned (screen, scheduler, templates, bulk tools, handover, claim).
-- Existing tasks are not changed: the rule applies when a task is created or its assignee changes.
CREATE OR REPLACE FUNCTION erp_private.task_assignee_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s erp_private.staff_members;
BEGIN
 IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF NEW.assigned_to IS NULL THEN RAISE EXCEPTION 'Assign this task to an Assistant before saving it.' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=NEW.assigned_to AND deleted_at IS NULL;
 IF s.staff_id IS NULL OR s.category_code<>'ASSISTANT' THEN
  RAISE EXCEPTION 'Tasks are assigned to Assistants only. Supervisors, Managers and Partners review, edit and reassign tasks; they do not hold them.' USING ERRCODE='23514';
 END IF;
 IF s.access_status<>'Active' THEN RAISE EXCEPTION 'Choose an Assistant whose account is active.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.task_assignee_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS task_assignee_guard ON erp_private.tasks;
CREATE TRIGGER task_assignee_guard BEFORE INSERT OR UPDATE OF assigned_to ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.task_assignee_guard();

-- Recurring schedules create tasks for their assignee, so a schedule must name an Assistant too.
CREATE OR REPLACE FUNCTION erp_private.schedule_assignee_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.staff_members s WHERE s.staff_id=NEW.assigned_to AND s.deleted_at IS NULL AND s.category_code='ASSISTANT' AND s.access_status='Active') THEN
  RAISE EXCEPTION 'A recurring schedule must be assigned to an active Assistant.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.schedule_assignee_guard() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS schedule_assignee_guard ON erp_private.project_schedules;
CREATE TRIGGER schedule_assignee_guard BEFORE INSERT OR UPDATE OF assigned_to ON erp_private.project_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.schedule_assignee_guard();

-- Supervisors see and work on every project in the firms they belong to, like Managers. They still cannot reach a firm they have no access to,
-- and client financial and AML limits are unchanged (those use their own rules, not project_allowed).
CREATE OR REPLACE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
 AND (erp_private.actor()).category_code<>'INTERN'
 AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR')
 OR EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id)))))
$$;

-- Forwarding a task hands it to another Assistant. Escalating no longer moves the task: the task stays with its Assistant and the
-- Supervisor, Manager or Partner is told and records their decision in the review.
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.route_task(uuid,uuid,text,text,bigint)'::regprocedure);
 o:=$q$ UPDATE erp_private.tasks SET assigned_to=target_staff,blocked_reason=message WHERE task_id=target_task;$q$;
 n:=$q$ IF operation='Forward' THEN
  IF recipient_category<>'ASSISTANT' THEN RAISE EXCEPTION 'A task is forwarded to an Assistant. Use Escalate to ask a Supervisor, Manager or Partner to look at it.' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.tasks SET assigned_to=target_staff,blocked_reason=message WHERE task_id=target_task;
 ELSE
  UPDATE erp_private.tasks SET blocked_reason=message WHERE task_id=target_task;
 END IF;$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'route_task changed: assignment update not found'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;

-- The reassignment list for tasks offers Assistants only (projects still go to Partners, Managers and Supervisors as owners).
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.workload_candidates(uuid[],boolean)'::regprocedure);
 o:=$q$AND (NOT projects OR s.category_code IN ('PARTNER','MANAGER','SUPERVISOR'))$q$;
 n:=$q$AND ((projects AND s.category_code IN ('PARTNER','MANAGER','SUPERVISOR')) OR (NOT projects AND s.category_code='ASSISTANT'))$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'workload_candidates changed: category rule not found'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;

-- Handover and reallocation move work to an Assistant only.
DO $patch$ DECLARE d text;o text; BEGIN
 d:=pg_get_functiondef('erp_private.handover_candidates(uuid,uuid)'::regprocedure);
 o:=$q$AND s.category_code<>'INTERN'$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'handover_candidates changed'; END IF;
 EXECUTE replace(d,o,$q$AND s.category_code='ASSISTANT'$q$);
 d:=pg_get_functiondef('erp_private.handover_apply(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'handover_apply changed'; END IF;
 d:=replace(d,o,$q$AND s.category_code='ASSISTANT'$q$);
 o:=$q$'Choose another active staff member of this firm'$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'handover_apply message changed'; END IF;
 EXECUTE replace(d,o,$q$'Choose another active staff member of this firm who is an Assistant'$q$);
END $patch$;
