ALTER TABLE erp_private.task_events ADD COLUMN task_title text;
CREATE FUNCTION erp_private.task_recipient_candidates(target_task uuid)
RETURNS TABLE(staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.staff_id,s.full_name,s.category_code FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id
 JOIN erp_private.staff_firm_access f ON f.firm_id=p.handling_firm_id AND f.deleted_at IS NULL
 JOIN erp_private.staff_members s ON s.staff_id=f.staff_id
 WHERE auth.uid() IS NOT NULL AND erp_private.task_allowed(target_task) AND t.task_id=target_task
 AND s.staff_id IS DISTINCT FROM t.assigned_to AND s.deleted_at IS NULL AND s.access_status='Active'
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND (erp_private.project_editor() OR s.category_code IN ('PARTNER','MANAGER','SUPERVISOR')
 OR ((erp_private.actor()).category_code<>'INTERN' AND EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=t.project_id AND a.staff_id=s.staff_id AND a.deleted_at IS NULL)))
$$;
CREATE FUNCTION erp_private.route_task(target_task uuid,target_staff uuid,operation text,message text,expected_revision bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_row erp_private.staff_members;task_row erp_private.tasks;firm_id uuid;recipient_category text;event_kind text;
BEGIN
 actor_row:=erp_private.actor();
 IF auth.uid() IS NULL OR actor_row.staff_id IS NULL OR NOT erp_private.task_allowed(target_task) THEN RAISE EXCEPTION 'Task unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO task_row FROM erp_private.tasks WHERE task_id=target_task FOR UPDATE;
 IF task_row.revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'Task changed; refresh first' USING ERRCODE='40001';END IF;
 IF operation IS NULL OR operation NOT IN ('Forward','Escalate') OR message IS NULL OR length(btrim(message))<3 OR length(message)>1000 OR task_row.status IN ('Completed','Cancelled') THEN RAISE EXCEPTION 'Open task, routing action and message required' USING ERRCODE='23514';END IF;
 IF NOT erp_private.project_editor() AND task_row.assigned_to<>actor_row.staff_id THEN RAISE EXCEPTION 'Only your own task can be routed' USING ERRCODE='42501';END IF;
 SELECT c.category_code INTO recipient_category FROM erp_private.task_recipient_candidates(target_task) c WHERE c.staff_id=target_staff;
 IF recipient_category IS NULL OR (operation='Escalate' AND recipient_category NOT IN ('PARTNER','MANAGER','SUPERVISOR')) THEN RAISE EXCEPTION 'Choose an authorised recipient' USING ERRCODE='42501';END IF;
 SELECT handling_firm_id INTO firm_id FROM erp_private.projects WHERE project_id=task_row.project_id;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(task_row.project_id,target_staff,firm_id,recipient_category)
 ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL;
 UPDATE erp_private.tasks SET assigned_to=target_staff,blocked_reason=message WHERE task_id=target_task;
 event_kind:=CASE operation WHEN 'Forward' THEN 'Forwarded' ELSE 'Escalated' END;
 INSERT INTO erp_private.task_events(task_id,task_title,event_type,from_staff_id,to_staff_id,reason,created_by)
 VALUES(target_task,task_row.task_name,event_kind,task_row.assigned_to,target_staff,message,actor_row.staff_id);
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 VALUES(target_staff,target_task,event_kind||' by '||actor_row.full_name||': '||task_row.task_name||' — '||message,gen_random_uuid()::text);
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.task_recipient_candidates(uuid),erp_private.route_task(uuid,uuid,text,text,bigint) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.task_recipient_candidates(uuid),erp_private.route_task(uuid,uuid,text,text,bigint) TO erp_api;
ALTER POLICY events_read ON erp_private.task_events USING(erp_private.task_allowed(task_id) OR from_staff_id=(erp_private.actor()).staff_id OR created_by=(erp_private.actor()).staff_id);
;

