-- Permission boundary for in-app task notices: authorised task participants only.
GRANT INSERT ON erp_private.notifications TO erp_api;
CREATE POLICY notifications_task_insert ON erp_private.notifications FOR INSERT TO erp_api WITH CHECK(
 (task_id IS NOT NULL AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=notifications.task_id AND (notifications.recipient_id=t.assigned_to OR EXISTS(SELECT 1 FROM erp_private.task_procedures w WHERE w.task_id=t.task_id AND w.reviewer_id=notifications.recipient_id))))
 OR (task_id IS NULL AND erp_private.is_leader() AND erp_private.manages(recipient_id))
);
