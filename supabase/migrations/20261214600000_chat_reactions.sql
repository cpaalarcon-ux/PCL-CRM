-- Emoji reactions in the messenger. Messages stay immutable (audit rule); a reaction is a separate, light record that its owner may add or
-- take back. Visible and writable only inside conversations the person may open, never in a closed (archived or finished) discussion.
CREATE TABLE erp_private.discussion_reactions (
 message_id uuid NOT NULL REFERENCES erp_private.discussion_messages,
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 emoji text NOT NULL CHECK (emoji IN ('👍','❤️','😂','😮','🙏','✅')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (message_id, staff_id, emoji)
);
CREATE INDEX discussion_reactions_channel_idx ON erp_private.discussion_reactions(channel_id, message_id);
ALTER TABLE erp_private.discussion_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.discussion_reactions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.discussion_reactions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, DELETE ON erp_private.discussion_reactions TO erp_api;
CREATE POLICY discussion_reaction_read ON erp_private.discussion_reactions FOR SELECT TO erp_api
 USING (erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_reaction_add ON erp_private.discussion_reactions FOR INSERT TO erp_api
 WITH CHECK (staff_id = (erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id));
CREATE POLICY discussion_reaction_remove ON erp_private.discussion_reactions FOR DELETE TO erp_api
 USING (staff_id = (erp_private.actor()).staff_id AND erp_private.discussion_allowed(channel_id));

CREATE FUNCTION erp_private.discussion_reaction_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c erp_private.discussion_channels;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM erp_private.discussion_messages m WHERE m.message_id = NEW.message_id AND m.channel_id = NEW.channel_id) THEN
  RAISE EXCEPTION 'The reaction must stay in the message''s conversation' USING ERRCODE = '23514';
 END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id = NEW.channel_id;
 IF c.task_id IS NOT NULL AND EXISTS (SELECT 1 FROM erp_private.task_procedures w JOIN erp_private.tasks t USING (task_id)
    WHERE w.task_id = c.task_id AND (w.stage = 'Closed' OR t.status IN ('Completed', 'Cancelled')))
  OR c.task_id IS NULL AND c.project_id IS NOT NULL AND EXISTS (SELECT 1 FROM erp_private.projects p WHERE p.project_id = c.project_id AND p.status = 'Archived') THEN
  RAISE EXCEPTION 'This conversation is closed' USING ERRCODE = '42501';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION erp_private.discussion_reaction_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.discussion_reaction_guard() TO erp_api;
CREATE TRIGGER discussion_reaction_guard BEFORE INSERT ON erp_private.discussion_reactions FOR EACH ROW EXECUTE FUNCTION erp_private.discussion_reaction_guard();
