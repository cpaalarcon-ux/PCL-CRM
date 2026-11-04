-- Read side of the handover flow: names and labels for the requests the caller may see (their own, or their firm's if
-- they are a Supervisor, Manager or Partner). Staff, client and project rows are otherwise private, so labels come from here.
CREATE OR REPLACE FUNCTION erp_private.handover_queue(p_open_only boolean DEFAULT true,p_project uuid DEFAULT NULL,p_task uuid DEFAULT NULL)
RETURNS TABLE(handover_id uuid,project_id uuid,task_id uuid,project_name text,client_name text,task_name text,requested_by uuid,requester_name text,
 requester_category text,narration text,status text,new_assignee_name text,decided_by_name text,decision_note text,decided_at timestamptz,created_at timestamptz,revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT h.handover_id,h.project_id,h.task_id,p.project_name,c.company_name,t.task_name,h.requested_by,r.full_name,r.category_code,h.narration,h.status,
  n.full_name,d.full_name,h.decision_note,h.decided_at,h.created_at,h.revision
 FROM erp_private.task_handovers h
 JOIN erp_private.projects p ON p.project_id=h.project_id
 JOIN erp_private.clients c ON c.client_id=p.client_id
 JOIN erp_private.staff_members r ON r.staff_id=h.requested_by
 LEFT JOIN erp_private.tasks t ON t.task_id=h.task_id
 LEFT JOIN erp_private.staff_members n ON n.staff_id=h.new_assignee_id
 LEFT JOIN erp_private.staff_members d ON d.staff_id=h.decided_by
 WHERE (erp_private.actor()).staff_id IS NOT NULL
  AND (h.requested_by=(erp_private.actor()).staff_id OR (erp_private.project_editor() AND erp_private.firm_allowed(h.handling_firm_id)))
  AND (NOT p_open_only OR h.status='Requested')
  AND (p_project IS NULL OR h.project_id=p_project) AND (p_task IS NULL OR h.task_id=p_task)
 ORDER BY (h.status='Requested') DESC,h.created_at DESC
 LIMIT 200;
$$;
REVOKE ALL ON FUNCTION erp_private.handover_queue(boolean,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.handover_queue(boolean,uuid,uuid) TO erp_api;
