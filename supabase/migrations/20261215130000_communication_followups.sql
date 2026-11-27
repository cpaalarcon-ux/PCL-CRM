-- A follow-up is a request until it has a task. The task owns its workflow and deadline.
CREATE TABLE erp_private.communication_followups (
 followup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 message_id uuid NOT NULL REFERENCES erp_private.discussion_messages,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 200),
 summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 3 AND 2000),
 requested_due_on date NOT NULL,
 task_id uuid UNIQUE REFERENCES erp_private.tasks,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE (message_id,project_id)
);
CREATE INDEX communication_followups_project_idx ON erp_private.communication_followups(project_id);

ALTER TABLE erp_private.communication_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.communication_followups FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.communication_followups FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE(task_id) ON erp_private.communication_followups TO erp_api;

CREATE POLICY followup_read ON erp_private.communication_followups FOR SELECT TO erp_api USING (
 erp_private.project_allowed(project_id) AND (
  erp_private.discussion_allowed(channel_id)
  OR EXISTS (SELECT 1 FROM erp_private.tasks t WHERE t.task_id=communication_followups.task_id AND t.deleted_at IS NULL)
 )
);
CREATE POLICY followup_request ON erp_private.communication_followups FOR INSERT TO erp_api WITH CHECK (
 requested_by=(erp_private.actor()).staff_id AND task_id IS NULL AND erp_private.project_allowed(project_id)
 AND EXISTS (SELECT 1 FROM erp_private.discussion_messages m JOIN erp_private.discussion_channels c USING(channel_id)
  WHERE m.message_id=communication_followups.message_id AND m.channel_id=communication_followups.channel_id
  AND (c.project_id IS NULL OR c.project_id=communication_followups.project_id))
);
CREATE POLICY followup_convert ON erp_private.communication_followups FOR UPDATE TO erp_api USING (
 task_id IS NULL AND erp_private.project_editor() AND erp_private.project_allowed(project_id) AND erp_private.discussion_allowed(channel_id)
) WITH CHECK (
 erp_private.project_editor() AND erp_private.project_allowed(project_id) AND erp_private.discussion_allowed(channel_id)
 AND EXISTS (SELECT 1 FROM erp_private.tasks t WHERE t.task_id=communication_followups.task_id AND t.project_id=communication_followups.project_id AND t.deleted_at IS NULL)
);
CREATE TRIGGER communication_followups_audit AFTER INSERT OR UPDATE ON erp_private.communication_followups
 FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('followup_id');
