-- System Administrators and admin-created chat groups (4 Nov 2026 UAT).
-- Up to three System Administrators run the system: staff logins and chat groups. They have their own category, are not
-- part of the Partner / Manager / Supervisor ladder, and see no client, project, task, document or ledger record.
-- A Partner creates and manages System Administrator accounts. Chat groups are created and staffed only by a System Administrator;
-- members chat in them like any conversation (messages stay immutable) and a System Administrator cannot read a group they are not in.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.staff_categories'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%hierarchy_level%' LOOP
  EXECUTE format('ALTER TABLE erp_private.staff_categories DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
ALTER TABLE erp_private.staff_categories ADD CONSTRAINT staff_categories_hierarchy_level_check CHECK(hierarchy_level BETWEEN 1 AND 6);
INSERT INTO erp_private.staff_categories(category_code,display_name,hierarchy_level) VALUES('ADMIN','System Administrator',6) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION erp_private.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((erp_private.actor()).category_code='ADMIN',false)
$$;
REVOKE ALL ON FUNCTION erp_private.is_admin() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.is_admin() TO erp_api;

-- Only a Partner manages System Administrator accounts, and at most three may be active.
CREATE OR REPLACE FUNCTION erp_private.admin_account_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF (NEW.category_code='ADMIN' OR (TG_OP='UPDATE' AND OLD.category_code='ADMIN')) AND current_user='erp_api' AND a.category_code IS DISTINCT FROM 'PARTNER' THEN
  RAISE EXCEPTION 'Only the Engagement Partner can manage System Administrator accounts' USING ERRCODE='42501';
 END IF;
 IF NEW.category_code='ADMIN' AND NEW.deleted_at IS NULL AND NEW.access_status<>'Inactive'
  AND (SELECT count(*) FROM erp_private.staff_members x WHERE x.category_code='ADMIN' AND x.deleted_at IS NULL AND x.access_status<>'Inactive' AND x.staff_id<>NEW.staff_id)>=3 THEN
  RAISE EXCEPTION 'A firm has at most three active System Administrators' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.admin_account_guard() FROM PUBLIC;GRANT EXECUTE ON FUNCTION erp_private.admin_account_guard() TO erp_api;
CREATE TRIGGER admin_account_guard BEFORE INSERT OR UPDATE ON erp_private.staff_members FOR EACH ROW EXECUTE FUNCTION erp_private.admin_account_guard();

-- A System Administrator never holds client work.
CREATE OR REPLACE FUNCTION erp_private.no_admin_assignment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.staff_members s WHERE s.staff_id=NEW.staff_id AND s.category_code='ADMIN') THEN
  RAISE EXCEPTION 'A System Administrator cannot be assigned to client work' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.no_admin_assignment() FROM PUBLIC;GRANT EXECUTE ON FUNCTION erp_private.no_admin_assignment() TO erp_api;
CREATE TRIGGER no_admin_assignment BEFORE INSERT OR UPDATE ON erp_private.project_assignments FOR EACH ROW EXECUTE FUNCTION erp_private.no_admin_assignment();

-- Logins: a System Administrator manages Supervisor, Assistant and Intern accounts, as a Manager does, without the reporting line.
ALTER POLICY staff_read ON erp_private.staff_members USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR erp_private.is_admin()));
ALTER POLICY staff_insert ON erp_private.staff_members WITH CHECK(
 (erp_private.actor()).category_code='PARTNER'
 OR ((erp_private.actor()).category_code='MANAGER' AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN') AND manager_id=(erp_private.actor()).staff_id)
 OR (erp_private.is_admin() AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN')));
ALTER POLICY staff_update ON erp_private.staff_members USING(erp_private.manages(staff_id) OR (erp_private.is_admin() AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN'))) WITH CHECK(
 (erp_private.actor()).category_code='PARTNER'
 OR (erp_private.manages(staff_id) AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN'))
 OR (erp_private.is_admin() AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN')));
CREATE OR REPLACE FUNCTION erp_private.staff_is_ordinary(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.staff_members s WHERE s.staff_id=target AND s.category_code IN('SUPERVISOR','ASSISTANT','INTERN') AND s.deleted_at IS NULL)
$$;
REVOKE ALL ON FUNCTION erp_private.staff_is_ordinary(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.staff_is_ordinary(uuid) TO erp_api;
ALTER POLICY staff_firms_read ON erp_private.staff_firm_access USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id))) AND (erp_private.firm_allowed(firm_id) OR erp_private.is_admin()));
ALTER POLICY staff_firms_write ON erp_private.staff_firm_access
 USING((erp_private.manages(staff_id) AND erp_private.firm_allowed(firm_id)) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id)))
 WITH CHECK((erp_private.manages(staff_id) AND erp_private.firm_allowed(firm_id)) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id)));

-- Chat groups.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.discussion_channels'::regclass AND contype='c' LOOP
  EXECUTE format('ALTER TABLE erp_private.discussion_channels DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
ALTER TABLE erp_private.discussion_channels
 ADD CONSTRAINT discussion_channels_kind_check CHECK(kind IN('Project','Task','Direct','Group')),
 ADD CONSTRAINT discussion_channels_title_check CHECK(length(title) BETWEEN 1 AND 200),
 ADD CONSTRAINT discussion_channels_shape_check CHECK(
  (kind='Project' AND project_id IS NOT NULL AND task_id IS NULL AND dm_low IS NULL AND dm_high IS NULL)
  OR (kind='Task' AND project_id IS NOT NULL AND task_id IS NOT NULL AND dm_low IS NULL AND dm_high IS NULL)
  OR (kind='Direct' AND project_id IS NULL AND task_id IS NULL AND dm_low IS NOT NULL AND dm_high IS NOT NULL AND dm_low<dm_high)
  OR (kind='Group' AND project_id IS NULL AND task_id IS NULL AND dm_low IS NULL AND dm_high IS NULL));
CREATE TABLE erp_private.discussion_group_members(
 channel_id uuid NOT NULL REFERENCES erp_private.discussion_channels,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 added_by uuid NOT NULL REFERENCES erp_private.staff_members,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,removed_by uuid REFERENCES erp_private.staff_members,
 PRIMARY KEY(channel_id,staff_id)
);
CREATE INDEX discussion_group_members_staff_idx ON erp_private.discussion_group_members(staff_id) WHERE removed_at IS NULL;
CREATE INDEX discussion_group_members_added_by_idx ON erp_private.discussion_group_members(added_by);
CREATE INDEX discussion_group_members_removed_by_idx ON erp_private.discussion_group_members(removed_by) WHERE removed_by IS NOT NULL;
ALTER TABLE erp_private.discussion_group_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.discussion_group_members TO erp_api;
CREATE POLICY discussion_group_members_read ON erp_private.discussion_group_members FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.is_admin());
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.discussion_group_members FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('channel_id');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.discussion_group_members FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

CREATE OR REPLACE FUNCTION erp_private.discussion_allowed(cid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND EXISTS(SELECT 1 FROM erp_private.discussion_channels c WHERE c.channel_id=cid AND
 CASE c.kind WHEN 'Direct' THEN (erp_private.actor()).staff_id IN(c.dm_low,c.dm_high)
 WHEN 'Group' THEN EXISTS(SELECT 1 FROM erp_private.discussion_group_members m WHERE m.channel_id=c.channel_id AND m.staff_id=(erp_private.actor()).staff_id AND m.removed_at IS NULL)
 WHEN 'Task' THEN erp_private.task_allowed(c.task_id) AND EXISTS(SELECT 1 FROM erp_private.tasks t WHERE t.task_id=c.task_id AND t.project_id=c.project_id)
 ELSE erp_private.project_allowed(c.project_id) END)
$$;

CREATE OR REPLACE FUNCTION erp_private.discussion_notify(mid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m erp_private.discussion_messages;c erp_private.discussion_channels;r record;
BEGIN
 SELECT * INTO m FROM erp_private.discussion_messages WHERE message_id=mid;
 IF NOT FOUND OR m.author_id IS DISTINCT FROM (erp_private.actor()).staff_id OR NOT erp_private.discussion_allowed(m.channel_id) THEN RAISE EXCEPTION 'Message unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id=m.channel_id;
 FOR r IN SELECT s.staff_id FROM erp_private.staff_members s WHERE s.staff_id<>m.author_id AND s.deleted_at IS NULL AND s.access_status='Active'
 AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND CASE WHEN c.kind='Direct' THEN s.staff_id IN(c.dm_low,c.dm_high)
 WHEN c.kind='Group' THEN EXISTS(SELECT 1 FROM erp_private.discussion_group_members g WHERE g.channel_id=c.channel_id AND g.staff_id=s.staff_id AND g.removed_at IS NULL)
 WHEN c.kind='Task' THEN s.staff_id IN(SELECT assigned_to FROM erp_private.tasks WHERE task_id=c.task_id UNION SELECT reviewer_id FROM erp_private.task_procedures WHERE task_id=c.task_id)
 ELSE EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=c.project_id AND a.staff_id=s.staff_id AND a.deleted_at IS NULL) END
 LOOP
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(r.staff_id,c.task_id,'New message in an internal discussion. Open Comms → Internal chat.','discussion:'||m.message_id::text||':'||r.staff_id::text) ON CONFLICT DO NOTHING;
 END LOOP;
END;$$;

-- Directory for the group builder: active staff, names and roles only. Admin only.
CREATE OR REPLACE FUNCTION erp_private.chat_staff_directory() RETURNS TABLE(staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.staff_id,s.full_name,s.category_code FROM erp_private.staff_members s
 WHERE erp_private.is_admin() AND s.deleted_at IS NULL AND s.access_status='Active' AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
 ORDER BY s.full_name
$$;
CREATE OR REPLACE FUNCTION erp_private.chat_group_create(p_title text,p_members uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;cid uuid;n integer;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code<>'ADMIN' THEN RAISE EXCEPTION 'Only a System Administrator can create a chat group' USING ERRCODE='42501'; END IF;
 IF p_title IS NULL OR length(btrim(p_title))<2 OR length(p_title)>100 THEN RAISE EXCEPTION 'Name the group (2 to 100 characters)' USING ERRCODE='22023'; END IF;
 SELECT count(DISTINCT s.staff_id) INTO n FROM erp_private.staff_members s WHERE s.staff_id=ANY(coalesce(p_members,'{}')) AND s.deleted_at IS NULL AND s.access_status='Active';
 IF n<2 THEN RAISE EXCEPTION 'Choose at least two active members' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.discussion_channels(kind,title,created_by) VALUES('Group',btrim(p_title),a.staff_id) RETURNING channel_id INTO cid;
 INSERT INTO erp_private.discussion_group_members(channel_id,staff_id,added_by) SELECT DISTINCT cid,s.staff_id,a.staff_id FROM erp_private.staff_members s WHERE s.staff_id=ANY(p_members) AND s.deleted_at IS NULL AND s.access_status='Active';
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) SELECT m.staff_id,'You were added to the chat group “'||btrim(p_title)||'”. Open the chat button at the top.',gen_random_uuid()::text FROM erp_private.discussion_group_members m WHERE m.channel_id=cid;
 RETURN cid;
END;$$;
CREATE OR REPLACE FUNCTION erp_private.chat_group_members_set(p_channel uuid,p_add uuid[],p_remove uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;c erp_private.discussion_channels;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code<>'ADMIN' THEN RAISE EXCEPTION 'Only a System Administrator can change a chat group' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM erp_private.discussion_channels WHERE channel_id=p_channel AND kind='Group';
 IF c.channel_id IS NULL THEN RAISE EXCEPTION 'Chat group unavailable' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.discussion_group_members SET removed_at=now(),removed_by=a.staff_id WHERE channel_id=p_channel AND staff_id=ANY(coalesce(p_remove,'{}')) AND removed_at IS NULL;
 WITH ins AS (
  INSERT INTO erp_private.discussion_group_members(channel_id,staff_id,added_by)
  SELECT p_channel,s.staff_id,a.staff_id FROM erp_private.staff_members s WHERE s.staff_id=ANY(coalesce(p_add,'{}')) AND s.deleted_at IS NULL AND s.access_status='Active'
  ON CONFLICT(channel_id,staff_id) DO UPDATE SET removed_at=NULL,removed_by=NULL,added_by=excluded.added_by,added_at=now() WHERE erp_private.discussion_group_members.removed_at IS NOT NULL
  RETURNING staff_id)
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) SELECT staff_id,'You were added to the chat group “'||c.title||'”. Open the chat button at the top.',gen_random_uuid()::text FROM ins;
END;$$;
-- Groups and member lists for the administrator (names only, never messages), and the member list of a group for its members.
CREATE OR REPLACE FUNCTION erp_private.chat_group_overview(p_channel uuid DEFAULT NULL) RETURNS TABLE(channel_id uuid,title text,created_at timestamptz,staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT c.channel_id,c.title,c.created_at,s.staff_id,s.full_name,s.category_code
 FROM erp_private.discussion_channels c JOIN erp_private.discussion_group_members m ON m.channel_id=c.channel_id AND m.removed_at IS NULL JOIN erp_private.staff_members s ON s.staff_id=m.staff_id
 WHERE c.kind='Group' AND (p_channel IS NULL OR c.channel_id=p_channel)
  AND (erp_private.is_admin() OR EXISTS(SELECT 1 FROM erp_private.discussion_group_members me WHERE me.channel_id=c.channel_id AND me.staff_id=(erp_private.actor()).staff_id AND me.removed_at IS NULL))
 ORDER BY c.created_at DESC,s.full_name
$$;
REVOKE ALL ON FUNCTION erp_private.chat_staff_directory(),erp_private.chat_group_create(text,uuid[]),erp_private.chat_group_members_set(uuid,uuid[],uuid[]),erp_private.chat_group_overview(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.chat_staff_directory(),erp_private.chat_group_create(text,uuid[]),erp_private.chat_group_members_set(uuid,uuid[],uuid[]),erp_private.chat_group_overview(uuid) TO erp_api;
