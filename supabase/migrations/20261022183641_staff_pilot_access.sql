-- Staff pilot. Only a server-side NOLOGIN role can use the private schema.
CREATE ROLE erp_api NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT erp_api TO postgres;
GRANT USAGE ON SCHEMA erp_private TO erp_api;
ALTER TABLE erp_private.staff_members ADD COLUMN sessions_invalid_before timestamptz NOT NULL DEFAULT now();
ALTER TABLE erp_private.clients ADD COLUMN owner_staff_id uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT;
CREATE INDEX clients_owner_idx ON erp_private.clients(owner_staff_id);
ALTER TABLE erp_private.projects ADD COLUMN owner_staff_id uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT;
CREATE INDEX projects_owner_idx ON erp_private.projects(owner_staff_id);
CREATE TABLE erp_private.pilot_sessions (
 session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 issued_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX pilot_sessions_staff_idx ON erp_private.pilot_sessions(staff_id);
CREATE TABLE erp_private.setup_tokens (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 issued_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 consumed_at timestamptz, revoked_at timestamptz
);
CREATE INDEX setup_tokens_staff_idx ON erp_private.setup_tokens(staff_id);
CREATE INDEX setup_tokens_issuer_idx ON erp_private.setup_tokens(issued_by);
CREATE TABLE erp_private.auth_limits (
 bucket_hash text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL
);
CREATE TABLE erp_private.document_access_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 actor_auth_id uuid NOT NULL, action text NOT NULL CHECK(action IN ('UPLOAD','DOWNLOAD')),
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_access_document_idx ON erp_private.document_access_events(document_id,occurred_at);
CREATE TRIGGER document_access_immutable BEFORE UPDATE OR DELETE ON erp_private.document_access_events
 FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

-- These internal SECURITY DEFINER lookups avoid recursive policies. They are not
-- exposed as RPCs. Every lookup starts with a live, authenticated staff session.
CREATE FUNCTION erp_private.actor() RETURNS erp_private.staff_members
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s FROM erp_private.staff_members s
 JOIN erp_private.pilot_sessions p ON p.staff_id=s.staff_id
 JOIN auth.sessions a ON a.id=p.session_id AND a.user_id=s.auth_user_id
 WHERE auth.uid() IS NOT NULL AND s.auth_user_id=auth.uid()
 AND p.session_id=(auth.jwt()->>'session_id')::uuid
 AND s.access_status='Active' AND s.deleted_at IS NULL
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND p.revoked_at IS NULL AND p.expires_at>now() AND p.last_seen_at>now()-interval '20 minutes'
 AND p.issued_at>=s.sessions_invalid_before LIMIT 1
$$;
CREATE FUNCTION erp_private.is_leader() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER'),false)
$$;
CREATE FUNCTION erp_private.firm_allowed(f uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((erp_private.actor()).category_code='PARTNER',false) OR EXISTS(
 SELECT 1 FROM erp_private.staff_firm_access a JOIN erp_private.firms f0 ON f0.firm_id=a.firm_id
 WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=f AND a.deleted_at IS NULL AND f0.deleted_at IS NULL AND f0.is_active)
$$;
CREATE FUNCTION erp_private.manages(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH RECURSIVE chain AS (
 SELECT s.staff_id,s.manager_id,ARRAY[s.staff_id] AS path FROM erp_private.staff_members s WHERE s.staff_id=target AND s.deleted_at IS NULL
 UNION ALL SELECT s.staff_id,s.manager_id,c.path||s.staff_id FROM erp_private.staff_members s
 JOIN chain c ON s.staff_id=c.manager_id WHERE NOT s.staff_id=ANY(c.path) AND cardinality(c.path)<20
 ) SELECT coalesce((erp_private.actor()).category_code='PARTNER',false) OR
 (coalesce((erp_private.actor()).category_code='MANAGER',false) AND target<>(erp_private.actor()).staff_id AND
 EXISTS(SELECT 1 FROM chain WHERE manager_id=(erp_private.actor()).staff_id))
$$;
CREATE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL
 AND (erp_private.actor()).category_code<>'INTERN' AND erp_private.firm_allowed(e.handling_firm_id)
 AND ((erp_private.actor()).category_code='PARTNER' OR (erp_private.is_leader() AND e.owner_staff_id=(erp_private.actor()).staff_id) OR EXISTS(
 SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id))) OR EXISTS(
 SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=(erp_private.actor()).staff_id
 AND f.firm_id=e.handling_firm_id AND f.deleted_at IS NULL AND f.scope='Firm' AND erp_private.is_leader())))
$$;
CREATE FUNCTION erp_private.client_allowed(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.clients x WHERE x.client_id=c AND x.deleted_at IS NULL
 AND (erp_private.actor()).category_code<>'INTERN' AND
 ((erp_private.actor()).category_code='PARTNER' OR x.owner_staff_id=(erp_private.actor()).staff_id OR
 EXISTS(SELECT 1 FROM erp_private.projects e WHERE e.client_id=c AND erp_private.project_allowed(e.project_id)) OR
 (erp_private.is_leader() AND EXISTS(SELECT 1 FROM erp_private.client_firm_links l
 JOIN erp_private.staff_firm_access a ON a.firm_id=l.firm_id
 WHERE l.client_id=c AND l.deleted_at IS NULL AND a.deleted_at IS NULL AND a.staff_id=(erp_private.actor()).staff_id AND a.scope='Firm'))))
$$;
CREATE FUNCTION erp_private.task_allowed(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.tasks x JOIN erp_private.projects p ON p.project_id=x.project_id
 JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE x.task_id=t AND x.deleted_at IS NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL
 AND erp_private.firm_allowed(p.handling_firm_id)
 AND ((x.assigned_to=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.project_assignments a
 WHERE a.project_id=x.project_id AND a.staff_id=x.assigned_to AND a.deleted_at IS NULL)) OR
 ((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND erp_private.project_allowed(x.project_id))))
$$;
CREATE FUNCTION erp_private.document_allowed(c uuid,f uuid,p uuid,t uuid,cat text,writing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT erp_private.firm_allowed(f) AND (
 (erp_private.is_leader() AND erp_private.client_allowed(c)) OR
 ((erp_private.actor()).category_code='SUPERVISOR' AND erp_private.project_allowed(p)
 AND cat IN ('Current Year Audit','Tax Returns','Working Papers','PBC Documents')) OR
 ((erp_private.actor()).category_code IN ('ASSISTANT','INTERN') AND cat='Working Papers'
 AND (NOT writing OR (erp_private.actor()).category_code='ASSISTANT')
 AND EXISTS(SELECT 1 FROM erp_private.tasks x WHERE x.task_id=t AND x.assigned_to=(erp_private.actor()).staff_id AND erp_private.task_allowed(t))))
$$;

GRANT SELECT ON erp_private.staff_categories,erp_private.services,erp_private.firms,
 erp_private.staff_members,erp_private.staff_firm_access,erp_private.clients,erp_private.client_firm_links,
 erp_private.client_contacts,erp_private.projects,erp_private.project_assignments,erp_private.tasks,erp_private.documents TO erp_api;
GRANT INSERT,UPDATE ON erp_private.firms,erp_private.staff_members,erp_private.staff_firm_access,
 erp_private.clients,erp_private.client_firm_links,erp_private.projects,erp_private.project_assignments,erp_private.tasks TO erp_api;
GRANT INSERT ON erp_private.documents,erp_private.audit_events,erp_private.document_access_events TO erp_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA erp_private TO erp_api;
CREATE POLICY categories_read ON erp_private.staff_categories FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY services_read ON erp_private.services FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY firms_read ON erp_private.firms FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.firm_allowed(firm_id));
CREATE POLICY firms_insert ON erp_private.firms FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY firms_update ON erp_private.firms FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY staff_read ON erp_private.staff_members FOR SELECT TO erp_api USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)));
CREATE POLICY staff_insert ON erp_private.staff_members FOR INSERT TO erp_api WITH CHECK(
 (erp_private.actor()).category_code='PARTNER' OR ((erp_private.actor()).category_code='MANAGER' AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN') AND manager_id=(erp_private.actor()).staff_id));
CREATE POLICY staff_update ON erp_private.staff_members FOR UPDATE TO erp_api USING(erp_private.manages(staff_id)) WITH CHECK(
 (erp_private.actor()).category_code='PARTNER' OR (erp_private.manages(staff_id) AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN')));
CREATE POLICY staff_firms_read ON erp_private.staff_firm_access FOR SELECT TO erp_api USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)) AND erp_private.firm_allowed(firm_id));
CREATE POLICY staff_firms_write ON erp_private.staff_firm_access FOR ALL TO erp_api USING(erp_private.manages(staff_id) AND erp_private.firm_allowed(firm_id)) WITH CHECK(erp_private.manages(staff_id) AND erp_private.firm_allowed(firm_id));
CREATE POLICY clients_read ON erp_private.clients FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY clients_insert ON erp_private.clients FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND owner_staff_id=(erp_private.actor()).staff_id);
CREATE POLICY clients_update ON erp_private.clients FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY client_firms_read ON erp_private.client_firm_links FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.client_allowed(client_id) AND erp_private.firm_allowed(firm_id));
CREATE POLICY client_firms_write ON erp_private.client_firm_links FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND erp_private.firm_allowed(firm_id));
CREATE POLICY contacts_read ON erp_private.client_contacts FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.client_allowed(client_id));
CREATE POLICY projects_read ON erp_private.projects FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY projects_insert ON erp_private.projects FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND owner_staff_id=(erp_private.actor()).staff_id AND erp_private.client_allowed(client_id) AND erp_private.firm_allowed(handling_firm_id));
CREATE POLICY projects_update ON erp_private.projects FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY assignments_read ON erp_private.project_assignments FOR SELECT TO erp_api USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.project_allowed(project_id)));
CREATE POLICY assignments_insert ON erp_private.project_assignments FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id) AND erp_private.firm_allowed(handling_firm_id) AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)));
CREATE POLICY assignments_update ON erp_private.project_assignments FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY tasks_read ON erp_private.tasks FOR SELECT TO erp_api USING(erp_private.task_allowed(task_id));
CREATE POLICY tasks_insert ON erp_private.tasks FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY tasks_update ON erp_private.tasks FOR UPDATE TO erp_api USING(erp_private.task_allowed(task_id)) WITH CHECK(erp_private.task_allowed(task_id));
CREATE POLICY documents_read ON erp_private.documents FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false));
CREATE POLICY documents_insert ON erp_private.documents FOR INSERT TO erp_api WITH CHECK(uploaded_by=(erp_private.actor()).staff_id AND erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,true));
CREATE POLICY audit_append ON erp_private.audit_events FOR INSERT TO erp_api WITH CHECK(actor_auth_id=auth.uid() AND database_role='erp_api' AND (erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY access_append ON erp_private.document_access_events FOR INSERT TO erp_api WITH CHECK(actor_auth_id=auth.uid() AND (erp_private.actor()).staff_id IS NOT NULL);

-- Even direct server-role DML cannot promote staff or rewrite task ownership via status updates.
CREATE FUNCTION erp_private.pilot_change_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF current_user <> 'erp_api' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='staff_members' AND TG_OP='UPDATE' THEN
  IF (NEW.staff_id,NEW.staff_identifier,NEW.auth_user_id,NEW.login_id,NEW.sessions_invalid_before,NEW.manager_id)
   IS DISTINCT FROM (OLD.staff_id,OLD.staff_identifier,OLD.auth_user_id,OLD.login_id,OLD.sessions_invalid_before,OLD.manager_id) THEN
   RAISE EXCEPTION 'Identity and reporting-line changes require the account service' USING ERRCODE='42501'; END IF;
  IF (erp_private.actor()).category_code='MANAGER' AND (OLD.category_code IN ('PARTNER','MANAGER') OR NEW.category_code IN ('PARTNER','MANAGER')) THEN
   RAISE EXCEPTION 'Managers cannot grant elevated staff categories' USING ERRCODE='42501'; END IF;
 END IF;
 IF TG_TABLE_NAME='tasks' AND TG_OP='UPDATE' AND NOT erp_private.is_leader() THEN
  IF (to_jsonb(NEW)-ARRAY['status','blocked_reason','updated_at','revision']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','blocked_reason','updated_at','revision']) THEN
   RAISE EXCEPTION 'Only task status and blocked reason may be changed' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER pilot_staff_guard BEFORE UPDATE ON erp_private.staff_members FOR EACH ROW EXECUTE FUNCTION erp_private.pilot_change_guard();
CREATE TRIGGER pilot_task_guard BEFORE UPDATE ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.pilot_change_guard();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='erp_private' LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tablename);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tablename);
 END LOOP;
END; $$;
REVOKE ALL ON ALL TABLES IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private TO erp_api;
COMMENT ON SCHEMA erp_private IS 'Staff pilot: server-only erp_api role, verified live sessions and row-level scope policies. Not exposed through Data API.';
