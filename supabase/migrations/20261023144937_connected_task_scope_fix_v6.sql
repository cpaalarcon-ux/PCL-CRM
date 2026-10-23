-- Evaluate access from the new task's parent and assignment, not a lookup of its
-- not-yet-visible task_id. This supports INSERT RETURNING and ON CONFLICT safely.
CREATE FUNCTION erp_private.task_scope(pid uuid,assignee uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE p.project_id=pid AND p.deleted_at IS NULL AND c.deleted_at IS NULL AND erp_private.firm_allowed(p.handling_firm_id)
 AND ((assignee=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.project_assignments a
 WHERE a.project_id=pid AND a.staff_id=assignee AND a.deleted_at IS NULL))
 OR ((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND erp_private.project_allowed(pid))))
$$;
REVOKE EXECUTE ON FUNCTION erp_private.task_scope(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.task_scope(uuid,uuid) TO erp_api;
ALTER POLICY tasks_read ON erp_private.tasks USING(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to));
ALTER POLICY tasks_update ON erp_private.tasks USING(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to)) WITH CHECK(deleted_at IS NULL AND erp_private.task_scope(project_id,assigned_to));
;

