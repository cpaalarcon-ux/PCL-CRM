CREATE OR REPLACE FUNCTION erp_private.run_workspace_scheduler() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE scheduled_project record;pending_task record;generated_count integer:=0;escalated integer:=0;
BEGIN
 FOR scheduled_project IN SELECT project_id FROM erp_private.project_schedules WHERE enabled AND deleted_at IS NULL LOOP
 generated_count:=generated_count+erp_private.generate_project_tasks(scheduled_project.project_id);END LOOP;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT DISTINCT r.staff_id,t.task_id,'Overdue task: '||t.task_name,'overdue:'||t.task_id::text||':'||r.staff_id::text
 FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id
 LEFT JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 CROSS JOIN LATERAL(SELECT t.assigned_to staff_id UNION SELECT s.reviewer_id) r
 WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status<>'Archived' AND t.due_at<now()-interval '5 minutes'
 AND t.status NOT IN ('Completed','Cancelled') AND r.staff_id IS NOT NULL ON CONFLICT(event_key) DO NOTHING;
 FOR pending_task IN SELECT t.*,s.reviewer_id,p.handling_firm_id,r.category_code FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 JOIN erp_private.staff_members r ON r.staff_id=s.reviewer_id
 JOIN erp_private.staff_firm_access fa ON fa.staff_id=r.staff_id AND fa.firm_id=p.handling_firm_id AND fa.deleted_at IS NULL
 WHERE t.requires_document AND t.status IN ('Pending','In Progress','Blocked') AND t.due_at<now() AND t.deleted_at IS NULL
 AND p.deleted_at IS NULL AND p.status<>'Archived' AND s.enabled AND s.deleted_at IS NULL AND r.access_status='Active' AND r.deleted_at IS NULL
 AND r.category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND t.assigned_to<>s.reviewer_id
 AND (r.contract_end_date IS NULL OR r.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.task_id=t.task_id AND d.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM erp_private.notifications n WHERE n.event_key='missing-document:'||t.task_id::text)
 LOOP
 UPDATE erp_private.tasks SET assigned_to=pending_task.reviewer_id,blocked_reason='Escalated automatically: required client document is overdue.' WHERE task_id=pending_task.task_id;
 INSERT INTO erp_private.task_events(task_id,event_type,from_staff_id,to_staff_id,reason) VALUES(pending_task.task_id,'Missing documents',pending_task.assigned_to,pending_task.reviewer_id,'Required upload is overdue.');
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(pending_task.reviewer_id,pending_task.task_id,'Missing document: '||pending_task.task_name,'missing-document:'||pending_task.task_id::text);
 escalated:=escalated+1;
 END LOOP;
 RETURN jsonb_build_object('generated',generated_count,'escalated',escalated);
END; $$;
;

