-- Task and project handover (4 Nov 2026 UAT). An assistant does not see clients or projects they are not assigned to.
-- When assigned work cannot be finished, they tick a handover on the task (or the whole project) and write a narration.
-- A Supervisor, Manager or Partner of the firm then reallocates it to another staff member, or declines it. Those three
-- roles can also reallocate directly. Every move is recorded: handover row, task event, notification.
CREATE TABLE erp_private.task_handovers(
 handover_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 task_id uuid REFERENCES erp_private.tasks,
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 narration text NOT NULL CHECK(length(btrim(narration)) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'Requested' CHECK(status IN('Requested','Reallocated','Declined')),
 new_assignee_id uuid REFERENCES erp_private.staff_members,
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 decision_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status='Requested' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
 CHECK(status<>'Reallocated' OR (new_assignee_id IS NOT NULL AND new_assignee_id<>requested_by)),
 CHECK(status<>'Declined' OR length(btrim(coalesce(decision_note,'')))>=10)
);
CREATE UNIQUE INDEX task_handovers_one_open ON erp_private.task_handovers(project_id,coalesce(task_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE status='Requested';
CREATE INDEX task_handovers_firm_idx ON erp_private.task_handovers(handling_firm_id,status);
CREATE INDEX task_handovers_requested_by_idx ON erp_private.task_handovers(requested_by);
CREATE INDEX task_handovers_task_idx ON erp_private.task_handovers(task_id);
CREATE INDEX task_handovers_new_assignee_idx ON erp_private.task_handovers(new_assignee_id);
CREATE INDEX task_handovers_decided_by_idx ON erp_private.task_handovers(decided_by);
ALTER TABLE erp_private.task_handovers ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.task_handovers TO erp_api;
CREATE POLICY task_handovers_read ON erp_private.task_handovers FOR SELECT TO erp_api
 USING(requested_by=(erp_private.actor()).staff_id OR (erp_private.project_editor() AND erp_private.firm_allowed(handling_firm_id)));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.task_handovers FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.task_handovers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('handover_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.task_handovers FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

-- Staff who may take the work: active, with access to the project's handling firm, not interns, not the person handing over.
CREATE OR REPLACE FUNCTION erp_private.handover_candidates(p_project uuid,p_exclude uuid DEFAULT NULL)
RETURNS TABLE(staff_id uuid,full_name text,category_code text,open_tasks bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.staff_id,s.full_name,s.category_code,
  (SELECT count(*) FROM erp_private.tasks t WHERE t.assigned_to=s.staff_id AND t.deleted_at IS NULL AND t.status NOT IN('Completed','Cancelled')) AS open_tasks
 FROM erp_private.projects p
 JOIN erp_private.staff_firm_access f ON f.firm_id=p.handling_firm_id AND f.deleted_at IS NULL
 JOIN erp_private.staff_members s ON s.staff_id=f.staff_id
 WHERE p.project_id=p_project AND p.deleted_at IS NULL AND erp_private.project_editor() AND erp_private.firm_allowed(p.handling_firm_id)
  AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'INTERN'
  AND s.staff_id IS DISTINCT FROM p_exclude
 ORDER BY s.full_name;
$$;

-- Internal: move one task, or every open task of a project, from one person to another.
CREATE OR REPLACE FUNCTION erp_private.handover_apply(p_project uuid,p_task uuid,p_from uuid,p_to uuid,p_by uuid,p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE proj erp_private.projects;target erp_private.staff_members;moved integer:=0;t erp_private.tasks;
BEGIN
 SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 SELECT s.* INTO target FROM erp_private.staff_members s JOIN erp_private.staff_firm_access f ON f.staff_id=s.staff_id AND f.firm_id=proj.handling_firm_id AND f.deleted_at IS NULL
  WHERE s.staff_id=p_to AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'INTERN';
 IF proj.project_id IS NULL OR target.staff_id IS NULL OR p_to=p_from THEN RAISE EXCEPTION 'Choose another active staff member of this firm' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(p_project,p_to,proj.handling_firm_id,target.category_code)
  ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL;
 FOR t IN SELECT * FROM erp_private.tasks WHERE project_id=p_project AND deleted_at IS NULL AND status NOT IN('Completed','Cancelled')
   AND assigned_to=p_from AND (p_task IS NULL OR task_id=p_task) FOR UPDATE LOOP
  UPDATE erp_private.tasks SET assigned_to=p_to WHERE task_id=t.task_id;
  INSERT INTO erp_private.task_events(task_id,task_title,event_type,from_staff_id,to_staff_id,reason,created_by) VALUES(t.task_id,t.task_name,'Forwarded',p_from,p_to,'Handover: '||p_reason,p_by);
  INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(p_to,t.task_id,'Reallocated to you: '||t.task_name||' — '||p_reason,gen_random_uuid()::text);
  moved:=moved+1;
 END LOOP;
 IF p_task IS NULL THEN
  -- Whole project: the previous person no longer has the job (their finished tasks stay on record).
  UPDATE erp_private.project_assignments SET deleted_at=now() WHERE project_id=p_project AND staff_id=p_from AND deleted_at IS NULL;
 END IF; -- a single task: the previous person keeps the project assignment while they hold other work on it
 RETURN moved;
END;$$;

CREATE OR REPLACE FUNCTION erp_private.handover_request(p_project uuid,p_task uuid,p_narration text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;proj erp_private.projects;tk erp_private.tasks;hid uuid;n integer;label text;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Handover unavailable' USING ERRCODE='42501'; END IF;
 IF p_narration IS NULL OR length(btrim(p_narration))<10 OR length(p_narration)>1000 THEN RAISE EXCEPTION 'Write a narration of at least 10 characters: what is done, what is left, what the next person needs.' USING ERRCODE='22023'; END IF;
 SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 IF proj.project_id IS NULL OR proj.status='Archived' THEN RAISE EXCEPTION 'Choose an open project' USING ERRCODE='22023'; END IF;
 IF p_task IS NOT NULL THEN
  SELECT * INTO tk FROM erp_private.tasks WHERE task_id=p_task AND project_id=p_project AND deleted_at IS NULL;
  IF tk.task_id IS NULL OR tk.assigned_to IS DISTINCT FROM a.staff_id OR tk.status IN('Completed','Cancelled') THEN RAISE EXCEPTION 'You can hand over only your own open task' USING ERRCODE='42501'; END IF;
  label:=tk.task_name;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM erp_private.project_assignments x WHERE x.project_id=p_project AND x.staff_id=a.staff_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'You can hand over only a project you are assigned to' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.tasks x WHERE x.project_id=p_project AND x.assigned_to=a.staff_id AND x.deleted_at IS NULL AND x.status NOT IN('Completed','Cancelled')) THEN RAISE EXCEPTION 'You have no open task on this project to hand over' USING ERRCODE='22023'; END IF;
  label:='the whole project';
 END IF;
 BEGIN
  INSERT INTO erp_private.task_handovers(project_id,task_id,handling_firm_id,requested_by,narration) VALUES(p_project,p_task,proj.handling_firm_id,a.staff_id,btrim(p_narration)) RETURNING handover_id INTO hid;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'A handover for this work is already waiting for a decision' USING ERRCODE='23505'; END;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT s.staff_id,p_task,'Handover requested by '||a.full_name||' for '||label||' — '||btrim(p_narration),gen_random_uuid()::text
 FROM erp_private.staff_members s JOIN erp_private.staff_firm_access f ON f.staff_id=s.staff_id AND f.firm_id=proj.handling_firm_id AND f.deleted_at IS NULL
 WHERE s.category_code IN('PARTNER','MANAGER','SUPERVISOR') AND s.deleted_at IS NULL AND s.access_status='Active' AND s.staff_id<>a.staff_id;
 RETURN hid;
END;$$;

CREATE OR REPLACE FUNCTION erp_private.handover_decide(p_handover uuid,p_decision text,p_new_assignee uuid,p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;h erp_private.task_handovers;moved integer:=0;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR NOT erp_private.project_editor() THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can decide a handover' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM erp_private.task_handovers WHERE handover_id=p_handover FOR UPDATE;
 IF h.handover_id IS NULL OR NOT erp_private.firm_allowed(h.handling_firm_id) THEN RAISE EXCEPTION 'Handover unavailable' USING ERRCODE='42501'; END IF;
 IF h.status<>'Requested' THEN RAISE EXCEPTION 'This handover was already decided' USING ERRCODE='40001'; END IF;
 IF h.requested_by=a.staff_id THEN RAISE EXCEPTION 'Another Supervisor, Manager or Partner must decide your handover' USING ERRCODE='42501'; END IF;
 IF p_decision='Declined' THEN
  IF p_note IS NULL OR length(btrim(p_note))<10 THEN RAISE EXCEPTION 'Say why the handover is declined (at least 10 characters)' USING ERRCODE='22023'; END IF;
  UPDATE erp_private.task_handovers SET status='Declined',decided_by=a.staff_id,decided_at=now(),decision_note=btrim(p_note) WHERE handover_id=p_handover;
  INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(h.requested_by,h.task_id,'Handover declined by '||a.full_name||' — '||btrim(p_note),gen_random_uuid()::text);
  RETURN 0;
 END IF;
 IF p_decision<>'Reallocated' THEN RAISE EXCEPTION 'Choose reallocate or decline' USING ERRCODE='22023'; END IF;
 moved:=erp_private.handover_apply(h.project_id,h.task_id,h.requested_by,p_new_assignee,a.staff_id,h.narration);
 IF moved=0 THEN RAISE EXCEPTION 'Nothing open is left to reallocate; decline the handover instead' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.task_handovers SET status='Reallocated',new_assignee_id=p_new_assignee,decided_by=a.staff_id,decided_at=now(),decision_note=nullif(btrim(coalesce(p_note,'')),'') WHERE handover_id=p_handover;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(h.requested_by,h.task_id,'Handover accepted by '||a.full_name||': reallocated to another staff member.',gen_random_uuid()::text);
 RETURN moved;
END;$$;

-- Direct reallocation by a Supervisor, Manager or Partner (no request needed). It is recorded as a handover in the same table.
CREATE OR REPLACE FUNCTION erp_private.handover_reallocate(p_project uuid,p_task uuid,p_from uuid,p_to uuid,p_note text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;proj erp_private.projects;moved integer;from_id uuid:=p_from;tk erp_private.tasks;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR NOT erp_private.project_editor() THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can reallocate work' USING ERRCODE='42501'; END IF;
 IF p_note IS NULL OR length(btrim(p_note))<10 OR length(p_note)>1000 THEN RAISE EXCEPTION 'Write a reason of at least 10 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 IF proj.project_id IS NULL OR proj.status='Archived' OR NOT erp_private.firm_allowed(proj.handling_firm_id) THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='42501'; END IF;
 IF p_task IS NOT NULL THEN
  SELECT * INTO tk FROM erp_private.tasks WHERE task_id=p_task AND project_id=p_project AND deleted_at IS NULL AND status NOT IN('Completed','Cancelled');
  IF tk.task_id IS NULL OR tk.assigned_to IS NULL THEN RAISE EXCEPTION 'Choose an open, assigned task' USING ERRCODE='22023'; END IF;
  from_id:=tk.assigned_to;
 ELSIF from_id IS NULL THEN RAISE EXCEPTION 'Choose whose project work is being reallocated' USING ERRCODE='22023'; END IF;
 moved:=erp_private.handover_apply(p_project,p_task,from_id,p_to,a.staff_id,btrim(p_note));
 IF moved=0 THEN RAISE EXCEPTION 'No open task was found to reallocate' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.task_handovers(project_id,task_id,handling_firm_id,requested_by,narration,status,new_assignee_id,decided_by,decided_at,decision_note)
  VALUES(p_project,p_task,proj.handling_firm_id,from_id,btrim(p_note),'Reallocated',p_to,a.staff_id,now(),'Direct reallocation');
 RETURN moved;
END;$$;

REVOKE ALL ON FUNCTION erp_private.handover_candidates(uuid,uuid),erp_private.handover_apply(uuid,uuid,uuid,uuid,uuid,text),
 erp_private.handover_request(uuid,uuid,text),erp_private.handover_decide(uuid,text,uuid,text),erp_private.handover_reallocate(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.handover_candidates(uuid,uuid),erp_private.handover_request(uuid,uuid,text),
 erp_private.handover_decide(uuid,text,uuid,text),erp_private.handover_reallocate(uuid,uuid,uuid,uuid,text) TO erp_api;
