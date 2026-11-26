-- Faster messenger updates. Two signals, both carrying no message content, only "something changed, ask the server":
-- 1) a reaction added or removed refreshes the open conversation for everyone looking at it;
-- 2) a new message tells each person who can see that conversation, so their chat list, unread count and alert sound update at once
--    instead of waiting for the next check. The browser then asks the server, which re-checks access as before.
CREATE FUNCTION erp_private.discussion_recipients(p_channel uuid) RETURNS TABLE(staff_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT s.staff_id FROM erp_private.discussion_channels c
 JOIN erp_private.staff_members s ON s.deleted_at IS NULL AND s.access_status = 'Active'
  AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
  AND CASE WHEN c.kind = 'Direct' THEN s.staff_id IN (c.dm_low, c.dm_high)
   WHEN c.kind = 'Group' THEN EXISTS (SELECT 1 FROM erp_private.discussion_group_members g WHERE g.channel_id = c.channel_id AND g.staff_id = s.staff_id AND g.removed_at IS NULL)
   WHEN c.kind = 'Task' THEN s.staff_id IN (SELECT assigned_to FROM erp_private.tasks WHERE task_id = c.task_id UNION SELECT reviewer_id FROM erp_private.task_procedures WHERE task_id = c.task_id)
   ELSE EXISTS (SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id = c.project_id AND a.staff_id = s.staff_id AND a.deleted_at IS NULL) END
 WHERE c.channel_id = p_channel
$$;
REVOKE ALL ON FUNCTION erp_private.discussion_recipients(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION erp_private.discussion_signal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r record;
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  PERFORM realtime.send(jsonb_build_object('sequence', NEW.sequence), 'changed', 'pcl-discussion:' || NEW.channel_id::text, true);
  FOR r IN SELECT staff_id FROM erp_private.discussion_recipients(NEW.channel_id) WHERE staff_id <> NEW.author_id LOOP
   PERFORM realtime.send(jsonb_build_object('channel_id', NEW.channel_id), 'chat', 'pcl-user:' || r.staff_id::text, true);
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;

CREATE FUNCTION erp_private.discussion_reaction_signal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
  PERFORM realtime.send(jsonb_build_object('reaction', true), 'changed', 'pcl-discussion:' || coalesce(NEW.channel_id, OLD.channel_id)::text, true);
 END IF;
 RETURN coalesce(NEW, OLD);
END; $$;
REVOKE ALL ON FUNCTION erp_private.discussion_reaction_signal() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER discussion_reaction_signal AFTER INSERT OR DELETE ON erp_private.discussion_reactions FOR EACH ROW EXECUTE FUNCTION erp_private.discussion_reaction_signal();
