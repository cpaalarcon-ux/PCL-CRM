-- Colleagues' names inside a chat. Row security lets an Assistant, Supervisor or Intern read only their own staff row, so names of the
-- other side of a conversation came back empty. This returns names only for people who are part of a conversation the caller may open
-- (the other party of a one-to-one chat, group members, and anyone who has written in it), never a general staff directory.
CREATE OR REPLACE FUNCTION erp_private.chat_people(p_channel uuid DEFAULT NULL) RETURNS TABLE(staff_id uuid,full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT DISTINCT s.staff_id,s.full_name FROM erp_private.discussion_channels c
 JOIN erp_private.staff_members s ON s.deleted_at IS NULL AND (
  (c.kind='Direct' AND s.staff_id IN(c.dm_low,c.dm_high))
  OR (c.kind='Group' AND EXISTS(SELECT 1 FROM erp_private.discussion_group_members m WHERE m.channel_id=c.channel_id AND m.staff_id=s.staff_id))
  OR EXISTS(SELECT 1 FROM erp_private.discussion_messages x WHERE x.channel_id=c.channel_id AND x.author_id=s.staff_id))
 WHERE (p_channel IS NULL OR c.channel_id=p_channel) AND erp_private.discussion_allowed(c.channel_id)
$$;
REVOKE ALL ON FUNCTION erp_private.chat_people(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.chat_people(uuid) TO erp_api;
