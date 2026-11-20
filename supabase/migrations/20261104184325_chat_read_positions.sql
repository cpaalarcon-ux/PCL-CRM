-- Read ticks in the messenger. Row security lets a person read only their own read position (discussion_reads), so a sender could
-- not tell whether the other side had read a message. This returns the read positions of the people in a one-to-one chat or a group
-- the caller may open, and nothing for task or project discussions (they have no fixed membership), never a general staff list.
CREATE OR REPLACE FUNCTION erp_private.chat_read_positions(p_channel uuid) RETURNS TABLE(staff_id uuid,last_sequence bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.staff_id,coalesce(r.last_sequence,0)::bigint
 FROM erp_private.discussion_channels c
 CROSS JOIN LATERAL (
  SELECT c.dm_low AS staff_id WHERE c.kind='Direct'
  UNION SELECT c.dm_high WHERE c.kind='Direct'
  UNION SELECT g.staff_id FROM erp_private.discussion_group_members g WHERE c.kind='Group' AND g.channel_id=c.channel_id AND g.removed_at IS NULL
 ) m
 LEFT JOIN erp_private.discussion_reads r ON r.channel_id=c.channel_id AND r.staff_id=m.staff_id
 WHERE c.channel_id=p_channel AND c.kind IN('Direct','Group') AND erp_private.discussion_allowed(c.channel_id)
$$;
REVOKE ALL ON FUNCTION erp_private.chat_read_positions(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.chat_read_positions(uuid) TO erp_api;
