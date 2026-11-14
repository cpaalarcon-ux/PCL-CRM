-- Who can see and manage clients and projects.
--  * Partners and Managers see every client and every project in the firms they have been given, whoever created it or is assigned to it,
--    and keep their full rights over all of it (edit, assign, review). The older "Firm scope" switch no longer limits a Manager.
--  * Supervisors see the same clients, their firm links and their projects, read-only. Their rights to change or work on a project are
--    unchanged: they still need to own it or be assigned to it.
--  * A client that has no firm link yet is visible to every Partner and Manager, so a newly created client is never hidden.
-- Interns, and anyone without access to the firm, see what they did before.
CREATE OR REPLACE FUNCTION erp_private.client_allowed(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.clients x WHERE x.client_id=c AND x.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR x.is_uat_fixture)
 AND (erp_private.actor()).category_code<>'INTERN' AND
 ((erp_private.actor()).category_code='PARTNER' OR
 (x.owner_staff_id=(erp_private.actor()).staff_id AND (
 NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL) OR
 EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id)))) OR
 EXISTS(SELECT 1 FROM erp_private.projects e WHERE e.client_id=c AND erp_private.project_allowed(e.project_id)) OR
 (erp_private.is_leader() AND (
 NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL) OR
 EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id))))))
$$;

CREATE OR REPLACE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
 AND (erp_private.actor()).category_code<>'INTERN'
 AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code='PARTNER'
 OR erp_private.is_leader()
 OR (erp_private.project_editor() AND e.owner_staff_id=(erp_private.actor()).staff_id)
 OR EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id)))))
$$;

-- Read-only sight for Supervisors.
CREATE OR REPLACE FUNCTION erp_private.supervisor_sees_client(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce((erp_private.actor()).category_code='SUPERVISOR',false) AND EXISTS(SELECT 1 FROM erp_private.clients x WHERE x.client_id=c AND x.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR x.is_uat_fixture)
 AND (NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL) OR
 EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id))))
$$;
CREATE OR REPLACE FUNCTION erp_private.supervisor_sees_project(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce((erp_private.actor()).category_code='SUPERVISOR',false) AND EXISTS(SELECT 1 FROM erp_private.projects e
 WHERE e.project_id=p AND e.deleted_at IS NULL AND erp_private.firm_allowed(e.handling_firm_id) AND erp_private.supervisor_sees_client(e.client_id))
$$;
REVOKE ALL ON FUNCTION erp_private.supervisor_sees_client(uuid),erp_private.supervisor_sees_project(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.supervisor_sees_client(uuid),erp_private.supervisor_sees_project(uuid) TO erp_api;
CREATE POLICY clients_supervisor_read ON erp_private.clients FOR SELECT TO erp_api USING(erp_private.supervisor_sees_client(client_id));
CREATE POLICY projects_supervisor_read ON erp_private.projects FOR SELECT TO erp_api USING(erp_private.supervisor_sees_project(project_id));
CREATE POLICY client_firms_supervisor_read ON erp_private.client_firm_links FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.supervisor_sees_client(client_id) AND erp_private.firm_allowed(firm_id));

-- Reviewers: every Partner, and every Manager with access to a firm the client is linked to; a client with no firm link yet goes to all of them.
CREATE OR REPLACE FUNCTION erp_private.review_candidates(p_client_id uuid) RETURNS TABLE(staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT DISTINCT s.staff_id,s.full_name,s.category_code FROM erp_private.staff_members s
 WHERE erp_private.client_allowed(p_client_id) AND s.deleted_at IS NULL AND s.access_status='Active'
 AND s.category_code IN('PARTNER','MANAGER') AND s.staff_id<>(erp_private.actor()).staff_id
 AND (s.category_code='PARTNER'
 OR NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=p_client_id AND l.deleted_at IS NULL)
 OR EXISTS(SELECT 1 FROM erp_private.client_firm_links l JOIN erp_private.staff_firm_access f ON f.firm_id=l.firm_id AND f.deleted_at IS NULL
 WHERE l.client_id=p_client_id AND l.deleted_at IS NULL AND f.staff_id=s.staff_id));
$$;
