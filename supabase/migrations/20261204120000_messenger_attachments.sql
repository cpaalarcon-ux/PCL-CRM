-- Extend the existing discussion data so staff keep their conversations, receipts and calls.
ALTER TABLE erp_private.discussion_messages
 ADD COLUMN has_attachments boolean NOT NULL DEFAULT false,
 ADD COLUMN shared_task_id uuid REFERENCES erp_private.tasks,
 ADD COLUMN shared_document_id uuid REFERENCES erp_private.documents,
 ADD CONSTRAINT discussion_message_attachment_scope UNIQUE (message_id,channel_id,author_id),
 DROP CONSTRAINT discussion_messages_body_check,
 ADD CONSTRAINT discussion_messages_body_check CHECK (length(btrim(body)) <= 4000 AND (length(btrim(body)) > 0 OR has_attachments OR num_nonnulls(shared_task_id,shared_document_id) > 0)),
 ADD CONSTRAINT discussion_single_shared_record CHECK (num_nonnulls(shared_task_id,shared_document_id) <= 1);

CREATE TABLE erp_private.discussion_attachments (
 attachment_id uuid PRIMARY KEY,
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 author_id uuid NOT NULL REFERENCES erp_private.staff_members,
 message_id uuid,
 file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 180),
 mime_type text NOT NULL,
 size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 5 AND 10485760),
 sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (message_id,channel_id,author_id)
  REFERENCES erp_private.discussion_messages(message_id,channel_id,author_id)
);
CREATE INDEX discussion_attachments_by_message ON erp_private.discussion_attachments(message_id) WHERE message_id IS NOT NULL;
ALTER TABLE erp_private.discussion_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.discussion_attachments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.discussion_attachments FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,DELETE ON erp_private.discussion_attachments TO erp_api;
GRANT UPDATE(message_id) ON erp_private.discussion_attachments TO erp_api;
CREATE POLICY discussion_attachment_read ON erp_private.discussion_attachments FOR SELECT TO erp_api
 USING (erp_private.discussion_allowed(channel_id) AND (message_id IS NOT NULL OR author_id=(erp_private.actor()).staff_id));
CREATE POLICY discussion_attachment_add ON erp_private.discussion_attachments FOR INSERT TO erp_api
 WITH CHECK (erp_private.discussion_allowed(channel_id) AND author_id=(erp_private.actor()).staff_id AND message_id IS NULL);
CREATE POLICY discussion_attachment_send ON erp_private.discussion_attachments FOR UPDATE TO erp_api
 USING (erp_private.discussion_allowed(channel_id) AND author_id=(erp_private.actor()).staff_id AND message_id IS NULL)
 WITH CHECK (erp_private.discussion_allowed(channel_id) AND author_id=(erp_private.actor()).staff_id AND message_id IS NOT NULL);
CREATE POLICY discussion_attachment_discard ON erp_private.discussion_attachments FOR DELETE TO erp_api
 USING (erp_private.discussion_allowed(channel_id) AND author_id=(erp_private.actor()).staff_id AND message_id IS NULL);
