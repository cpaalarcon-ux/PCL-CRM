-- Reuse task revisions, procedure stages, task events and notifications.
CREATE OR REPLACE FUNCTION erp_private.init_task_procedure() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO erp_private.task_procedures(task_id,project_id,profile,prepared_by,reviewer_id)
 VALUES(NEW.task_id,NEW.project_id,
  CASE WHEN NEW.template_key IN('monthly-vat','monthly-paye','monthly-tot','monthly-mri') THEN 'Tax filing'
   WHEN NEW.template_key IN('weekly-review','monthly-review','annual-review') THEN 'Compilation review' ELSE 'Supporting task' END,
  NEW.assigned_to,(SELECT reviewer_id FROM erp_private.project_schedules WHERE project_id=NEW.project_id));
 IF NEW.assigned_to IS NOT NULL THEN
  INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
   VALUES(NEW.assigned_to,NEW.task_id,'New task: '||NEW.task_name,'new-task:'||NEW.task_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION erp_private.workload_right(writing boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM erp_private.actor() a
  WHERE a.category_code IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_area_restrictions x WHERE x.staff_id=a.staff_id AND x.area_code='projects')
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_right_restrictions x WHERE x.staff_id=a.staff_id
    AND (x.right_code='task.view' OR (writing AND x.right_code='task.edit')))
 )
$$;

CREATE FUNCTION erp_private.workload_project_member(pid uuid, sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM erp_private.project_assignments a
  JOIN erp_private.staff_firm_access fa ON fa.staff_id=a.staff_id AND fa.firm_id=a.handling_firm_id AND fa.deleted_at IS NULL
  WHERE a.project_id=pid AND a.staff_id=sid AND a.deleted_at IS NULL
   AND coalesce(a.start_date,'-infinity'::date)<=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND coalesce(a.end_date,'infinity'::date)>=(now() AT TIME ZONE 'Africa/Nairobi')::date
 )
$$;

CREATE FUNCTION erp_private.workload_tasks(pool boolean, p_firm uuid, p_project uuid, p_search text, p_due date, p_offset integer)
RETURNS TABLE(task_id uuid,task_name text,project_id uuid,project_name text,client_name text,assigned_to uuid,assignee_name text,
 status text,due_at timestamptz,revision bigint,blocker text,total_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT t.task_id,t.task_name,p.project_id,p.project_name,c.company_name,t.assigned_to,s.full_name,
  t.status,t.due_at,t.revision,
  CASE WHEN t.status='In Review' THEN 'Return to preparer before changing this task.'
   WHEN t.status IN ('Completed','Cancelled') OR erp_private.task_is_archived(t.task_id) OR w.stage='Closed' THEN 'This task is audit locked.'
   WHEN w.stage NOT IN ('Pending preparer','Pending client documents') THEN 'Use the task review workflow.' END,
  count(*) over()
 FROM erp_private.actor() a
 JOIN erp_private.tasks t ON t.deleted_at IS NULL
 JOIN erp_private.projects p ON p.project_id=t.project_id AND p.deleted_at IS NULL AND p.status='Active'
 JOIN erp_private.clients c ON c.client_id=p.client_id AND c.deleted_at IS NULL
 LEFT JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to
 LEFT JOIN erp_private.task_procedures w ON w.task_id=t.task_id
 WHERE erp_private.workload_right(false) AND erp_private.firm_allowed(p.handling_firm_id)
  AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
  AND (p_firm IS NULL OR p.handling_firm_id=p_firm) AND (p_project IS NULL OR p.project_id=p_project)
  AND (p_search='' OR strpos(lower(concat_ws(' ',c.company_name,p.project_name,t.task_name)),lower(p_search))>0)
  AND (p_due IS NULL OR (t.due_at AT TIME ZONE 'Africa/Nairobi')::date<=p_due)
  AND ((a.category_code IN ('PARTNER','MANAGER') AND erp_private.project_allowed(p.project_id))
    OR (pool AND erp_private.workload_project_member(p.project_id,a.staff_id)))
  AND (NOT pool OR (t.assigned_to IS NULL AND t.status='Pending' AND coalesce(w.stage,'Pending preparer')='Pending preparer'
   AND NOT erp_private.task_is_archived(t.task_id)))
 ORDER BY t.due_at NULLS LAST,t.task_id LIMIT 100 OFFSET greatest(p_offset,0)
$$;

CREATE FUNCTION erp_private.workload_eligible(pid uuid, sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (
  SELECT 1 FROM erp_private.staff_members s
  WHERE s.staff_id=sid AND s.deleted_at IS NULL AND s.access_status='Active'
   AND s.category_code IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
   AND coalesce(s.contract_end_date,'infinity'::date)>=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND erp_private.workload_project_member(pid,sid)
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_area_restrictions r WHERE r.staff_id=sid AND r.area_code='projects')
   AND NOT EXISTS (SELECT 1 FROM erp_private.staff_right_restrictions r WHERE r.staff_id=sid AND r.right_code='task.view')
 )
$$;

CREATE FUNCTION erp_private.workload_on_leave(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM erp_private.leave_requests l
  WHERE l.staff_id=sid AND l.status='Approved' AND l.deleted_at IS NULL
   AND (now() AT TIME ZONE 'Africa/Nairobi')::date BETWEEN l.starts_on AND l.ends_on)
$$;

CREATE FUNCTION erp_private.workload_candidates(ids uuid[], projects boolean DEFAULT false)
RETURNS TABLE(staff_id uuid, full_name text, category_code text, on_leave boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH affected AS (
  SELECT p.project_id FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
  WHERE p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL
   AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture) AND (
   (projects AND p.project_id=ANY(ids)) OR (NOT projects AND EXISTS (
    SELECT 1 FROM erp_private.tasks t WHERE t.project_id=p.project_id AND t.task_id=ANY(ids) AND t.deleted_at IS NULL
   )))
 )
 SELECT s.staff_id,s.full_name,s.category_code,erp_private.workload_on_leave(s.staff_id)
 FROM erp_private.staff_members s
 WHERE erp_private.workload_right(true) AND erp_private.is_leader() AND EXISTS (SELECT 1 FROM affected)
  AND CASE WHEN projects THEN (SELECT count(*) FROM affected)=cardinality(ids)
   ELSE (SELECT count(*) FROM erp_private.tasks t WHERE t.task_id=ANY(ids) AND t.deleted_at IS NULL
    AND t.project_id IN (SELECT project_id FROM affected))=cardinality(ids) END
  AND (NOT projects OR s.category_code IN ('PARTNER','MANAGER','SUPERVISOR'))
  AND NOT EXISTS (SELECT 1 FROM affected a WHERE NOT erp_private.project_allowed(a.project_id)
    OR NOT erp_private.workload_eligible(a.project_id,s.staff_id))
  AND (projects OR NOT EXISTS (SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=ANY(ids) AND w.reviewer_id=s.staff_id))
 ORDER BY s.full_name,s.staff_id
$$;

CREATE FUNCTION erp_private.workload_apply(items jsonb, operation text, target uuid, why text, requested_status text,
 requested_due date, allow_leave boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members; r record; expected integer; changed integer:=0; destination uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR operation IS NULL OR NOT erp_private.workload_right(true)
  OR (operation<>'claim' AND a.category_code NOT IN ('PARTNER','MANAGER'))
  OR operation NOT IN ('assign','claim','status','due','project_owner') THEN
  RAISE EXCEPTION 'You do not have permission to perform this workload action.' USING ERRCODE='42501';
 END IF;
 expected:=jsonb_array_length(items);
 IF expected IS NULL OR expected<1 OR expected>100 OR expected<>(SELECT count(DISTINCT x.id) FROM jsonb_to_recordset(items) x(id uuid, revision bigint)) THEN
  RAISE EXCEPTION 'Select between 1 and 100 distinct records.' USING ERRCODE='23514';
 END IF;
 IF operation IN ('assign','project_owner') AND (target IS NULL OR length(btrim(coalesce(why,''))) NOT BETWEEN 10 AND 1000) THEN
  RAISE EXCEPTION 'Choose an assignee and enter a reason of 10 to 1,000 characters.' USING ERRCODE='23514';
 END IF;
 IF operation='status' AND (requested_status IS NULL OR requested_status NOT IN ('Pending','In Progress','Waiting on client','Paused','Blocked')
  OR (requested_status IN ('Waiting on client','Paused','Blocked') AND length(btrim(coalesce(why,'')))<3)) THEN
  RAISE EXCEPTION 'Choose an open status and enter the required reason.' USING ERRCODE='23514';
 END IF;
 IF operation='due' AND requested_due IS NULL THEN
  RAISE EXCEPTION 'Choose a due date.' USING ERRCODE='23514';
 END IF;
 destination:=CASE WHEN operation='claim' THEN a.staff_id WHEN operation IN ('assign','project_owner') THEN target END;
 IF destination IS NOT NULL AND erp_private.workload_on_leave(destination) AND allow_leave IS NOT TRUE THEN
  RAISE EXCEPTION 'This person is on approved leave. Confirm the assignment or select someone else.' USING ERRCODE='23514';
 END IF;

 IF operation='project_owner' THEN
  FOR r IN SELECT p.*,x.revision AS expected_revision FROM jsonb_to_recordset(items) x(id uuid,revision bigint)
   JOIN erp_private.projects p ON p.project_id=x.id JOIN erp_private.clients c ON c.client_id=p.client_id
   WHERE p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL
    AND erp_private.firm_allowed(p.handling_firm_id) AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
    AND erp_private.project_allowed(p.project_id) ORDER BY p.project_id FOR UPDATE OF p
  LOOP
   IF r.revision IS DISTINCT FROM r.expected_revision THEN
    RAISE EXCEPTION 'A project changed. Refresh before trying again.' USING ERRCODE='40001';
   END IF;
   IF NOT erp_private.workload_eligible(r.project_id,destination) OR NOT EXISTS (
    SELECT 1 FROM erp_private.staff_members s WHERE s.staff_id=destination AND s.category_code IN ('PARTNER','MANAGER','SUPERVISOR')
   ) THEN RAISE EXCEPTION 'Select an active project lead assigned to every selected project.' USING ERRCODE='42501'; END IF;
   IF r.owner_staff_id IS DISTINCT FROM destination THEN
    UPDATE erp_private.projects SET owner_staff_id=destination WHERE project_id=r.project_id;
    INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
     VALUES(auth.uid(),current_user,'projects','Reassign project owner',r.project_id::text,jsonb_build_object('owner_staff_id',r.owner_staff_id),
     jsonb_build_object('owner_staff_id',destination,'reason',why));
    INSERT INTO erp_private.notifications(recipient_id,message,event_key)
     VALUES(destination,'Project assigned: '||r.project_name,'project-dispatch:'||r.project_id||':'||r.revision);
   END IF;
   changed:=changed+1;
  END LOOP;
 ELSE
  -- Procedure actions lock their procedure before updating the task.
  PERFORM w.task_id FROM erp_private.task_procedures w
   JOIN erp_private.tasks t USING(task_id) JOIN erp_private.projects p ON p.project_id=t.project_id
   JOIN erp_private.clients c ON c.client_id=p.client_id
   WHERE t.task_id IN (SELECT x.id FROM jsonb_to_recordset(items) x(id uuid,revision bigint))
    AND t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL
    AND erp_private.firm_allowed(p.handling_firm_id) AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
    AND CASE WHEN operation='claim' THEN erp_private.workload_project_member(t.project_id,a.staff_id)
     ELSE erp_private.project_allowed(t.project_id) END
   ORDER BY w.task_id FOR UPDATE OF w;
  FOR r IN SELECT t.*,x.revision AS expected_revision FROM jsonb_to_recordset(items) x(id uuid,revision bigint)
   JOIN erp_private.tasks t ON t.task_id=x.id JOIN erp_private.projects p ON p.project_id=t.project_id
   JOIN erp_private.clients c ON c.client_id=p.client_id
   WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL
    AND erp_private.firm_allowed(p.handling_firm_id) AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
    AND CASE WHEN operation='claim' THEN erp_private.workload_project_member(t.project_id,a.staff_id)
     ELSE erp_private.project_allowed(t.project_id) END
   ORDER BY t.task_id FOR UPDATE OF t
  LOOP
   IF r.revision IS DISTINCT FROM r.expected_revision OR (operation='claim' AND r.assigned_to IS NOT NULL) THEN
    RAISE EXCEPTION 'A selected task changed or was claimed. Refresh before trying again.' USING ERRCODE='40001';
   END IF;
   IF r.status='In Review' THEN
    RAISE EXCEPTION 'Return in-review work to the preparer before changing it.' USING ERRCODE='23514';
   END IF;
   IF r.status IN ('Completed','Cancelled') OR erp_private.task_is_archived(r.task_id)
    OR EXISTS (SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=r.task_id
               AND w.stage NOT IN ('Pending preparer','Pending client documents'))
    OR EXISTS (SELECT 1 FROM erp_private.task_review_pool p WHERE p.task_id=r.task_id AND p.review_pool_status='POOL') THEN
    RAISE EXCEPTION 'A task is audit locked or in the review workflow.' USING ERRCODE='23514';
   END IF;
   IF operation='claim' AND (r.status<>'Pending' OR EXISTS(SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=r.task_id AND w.stage<>'Pending preparer')) THEN
    RAISE EXCEPTION 'Only unassigned preparation tasks in Pending status can be claimed.' USING ERRCODE='23514';
   END IF;
   IF destination IS NOT NULL AND (NOT erp_private.workload_eligible(r.project_id,destination)
    OR EXISTS (SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=r.task_id AND w.reviewer_id=destination)) THEN
    RAISE EXCEPTION 'The selected assignee must be active, assigned to each project and independent of its task reviewer.' USING ERRCODE='42501';
   END IF;
   IF destination IS NOT NULL AND r.assigned_to IS DISTINCT FROM destination THEN
    UPDATE erp_private.tasks SET assigned_to=destination WHERE task_id=r.task_id;
    UPDATE erp_private.task_procedures SET prepared_by=destination WHERE task_id=r.task_id AND prepared_by IS DISTINCT FROM destination;
    INSERT INTO erp_private.task_events(task_id,task_title,event_type,from_staff_id,to_staff_id,reason,created_by)
     VALUES(r.task_id,r.task_name,CASE WHEN operation='claim' THEN 'Claimed for preparation'
         WHEN r.assigned_to IS NULL THEN 'Assigned' ELSE 'Reassigned' END,
      r.assigned_to,destination,CASE WHEN operation='claim' THEN 'Claimed from the unassigned preparation pool' ELSE why END,a.staff_id);
    IF operation='assign' THEN
     UPDATE erp_private.document_access_grants g SET revoked_at=now(),revoked_by=a.staff_id,revoke_reason='Task reassigned: '||why
      WHERE g.grantee_id=r.assigned_to AND g.revoked_at IS NULL AND g.expires_at>now() AND EXISTS (
       SELECT 1 FROM erp_private.documents d WHERE d.document_id=g.document_id AND d.task_id=r.task_id
      );
     INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
      VALUES(destination,r.task_id,'Task assigned: '||r.task_name,'task-dispatch:'||r.task_id||':'||r.revision);
    END IF;
   ELSIF operation='status' THEN
    UPDATE erp_private.tasks SET status=requested_status,blocked_reason=nullif(btrim(why),'') WHERE task_id=r.task_id;
   ELSIF operation='due' THEN
    UPDATE erp_private.tasks SET due_at=(requested_due+time '17:00') AT TIME ZONE 'Africa/Nairobi' WHERE task_id=r.task_id;
   END IF;
   changed:=changed+1;
  END LOOP;
 END IF;
 IF changed<>expected THEN
  RAISE EXCEPTION 'Some selections are unavailable. Refresh the workload and try again.' USING ERRCODE='42501';
 END IF;
 RETURN changed;
END; $$;

REVOKE ALL ON FUNCTION erp_private.workload_right(boolean),erp_private.workload_project_member(uuid,uuid),
 erp_private.workload_eligible(uuid,uuid),erp_private.workload_on_leave(uuid),erp_private.workload_tasks(boolean,uuid,uuid,text,date,integer),
 erp_private.workload_candidates(uuid[],boolean),erp_private.workload_apply(jsonb,text,uuid,text,text,date,boolean)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.workload_tasks(boolean,uuid,uuid,text,date,integer),
 erp_private.workload_candidates(uuid[],boolean),erp_private.workload_apply(jsonb,text,uuid,text,text,date,boolean) TO erp_api;

-- The single-task routes and bulk workload use the same review lock.
CREATE FUNCTION erp_private.workload_reassignment_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND (
  OLD.status IN ('In Review','Completed','Cancelled') OR erp_private.task_is_archived(OLD.task_id)
  OR EXISTS (SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=OLD.task_id
   AND w.stage NOT IN ('Pending preparer','Pending client documents'))
 ) THEN
  RAISE EXCEPTION 'In-review work must be returned to the preparer before reassignment. Closed work is audit locked.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER workload_reassignment_guard BEFORE UPDATE OF assigned_to ON erp_private.tasks
 FOR EACH ROW EXECUTE FUNCTION erp_private.workload_reassignment_guard();
REVOKE ALL ON FUNCTION erp_private.workload_reassignment_guard() FROM PUBLIC,anon,authenticated,service_role;
