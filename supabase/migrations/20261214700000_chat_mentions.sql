-- @mentions in the messenger. Messages stay immutable; a mention is a separate record written once, in the same request as the message,
-- only for people who can actually open that conversation. A mention also raises a notification for the person named.
CREATE TABLE erp_private.discussion_mentions (
 message_id uuid NOT NULL REFERENCES erp_private.discussion_messages,
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (message_id, staff_id)
);
CREATE INDEX discussion_mentions_staff_idx ON erp_private.discussion_mentions(staff_id, channel_id);
ALTER TABLE erp_private.discussion_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.discussion_mentions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.discussion_mentions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON erp_private.discussion_mentions TO erp_api;
CREATE POLICY discussion_mention_read ON erp_private.discussion_mentions FOR SELECT TO erp_api
 USING (erp_private.discussion_allowed(channel_id));

-- Who can be mentioned in a conversation: the same people who would be notified of a new message in it.
CREATE FUNCTION erp_private.discussion_mentionable(p_channel uuid) RETURNS TABLE(staff_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT s.staff_id, s.full_name FROM erp_private.discussion_channels c
 JOIN erp_private.staff_members s ON s.deleted_at IS NULL AND s.access_status = 'Active'
  AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
  AND s.staff_id <> (erp_private.actor()).staff_id
  AND CASE WHEN c.kind = 'Direct' THEN s.staff_id IN (c.dm_low, c.dm_high)
   WHEN c.kind = 'Group' THEN EXISTS (SELECT 1 FROM erp_private.discussion_group_members g WHERE g.channel_id = c.channel_id AND g.staff_id = s.staff_id AND g.removed_at IS NULL)
   WHEN c.kind = 'Task' THEN s.staff_id IN (SELECT assigned_to FROM erp_private.tasks WHERE task_id = c.task_id UNION SELECT reviewer_id FROM erp_private.task_procedures WHERE task_id = c.task_id)
   ELSE EXISTS (SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id = c.project_id AND a.staff_id = s.staff_id AND a.deleted_at IS NULL) END
 WHERE c.channel_id = p_channel AND erp_private.discussion_allowed(c.channel_id)
 ORDER BY s.full_name
$$;
REVOKE ALL ON FUNCTION erp_private.discussion_mentionable(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION erp_private.discussion_mentionable(uuid) TO erp_api;

-- Record the mentions of a message the caller has just written. Refuses anyone who is not mentionable in that conversation.
CREATE FUNCTION erp_private.discussion_mention(mid uuid, ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE m erp_private.discussion_messages; c erp_private.discussion_channels; who text;
BEGIN
 SELECT * INTO m FROM erp_private.discussion_messages WHERE message_id = mid;
 IF NOT FOUND OR m.author_id IS DISTINCT FROM (erp_private.actor()).staff_id OR NOT erp_private.discussion_allowed(m.channel_id) THEN
  RAISE EXCEPTION 'Message unavailable' USING ERRCODE = '42501';
 END IF;
 IF coalesce(cardinality(ids), 0) = 0 THEN RETURN; END IF;
 IF cardinality(ids) > 10 THEN RAISE EXCEPTION 'Mention up to ten people in one message' USING ERRCODE = '23514'; END IF;
 IF EXISTS (SELECT 1 FROM unnest(ids) u WHERE u NOT IN (SELECT staff_id FROM erp_private.discussion_mentionable(m.channel_id))) THEN
  RAISE EXCEPTION 'You can only mention people who are part of this conversation' USING ERRCODE = '23514';
 END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id = m.channel_id;
 SELECT full_name INTO who FROM erp_private.staff_members WHERE staff_id = m.author_id;
 INSERT INTO erp_private.discussion_mentions(message_id, channel_id, staff_id) SELECT mid, m.channel_id, u FROM unnest(ids) u ON CONFLICT DO NOTHING;
 INSERT INTO erp_private.notifications(recipient_id, task_id, message, event_key)
  SELECT u, c.task_id, coalesce(who, 'A colleague') || ' mentioned you in an internal discussion. Open Comms → Internal chat.', 'mention:' || mid::text || ':' || u::text
  FROM unnest(ids) u ON CONFLICT DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION erp_private.discussion_mention(uuid, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION erp_private.discussion_mention(uuid, uuid[]) TO erp_api;
