-- Supervisors see what Managers see; what they cannot handle is escalated to a Manager or Partner.
--  * Supervisors now see every client and project of the firms they belong to, and the work inside them (tasks, documents, ledger, chat),
--    whoever created it. The rights are unchanged: approvals, reviews and client setup stay with Managers and Partners (is_leader).
--    This replaces the read-only Supervisor policies added earlier the same day.
--  * Assistants and Interns are unchanged: only assigned projects, and only their own tasks.
--  * An escalation is a Supervisor's or Assistant's request to a Manager or Partner on a project or a task. The named Manager (or any Partner)
--    resolves it with a note. Managers and Partners are alerted; the person who raised it is told the outcome.
DROP POLICY IF EXISTS clients_supervisor_read ON erp_private.clients;
DROP POLICY IF EXISTS projects_supervisor_read ON erp_private.projects;
DROP POLICY IF EXISTS client_firms_supervisor_read ON erp_private.client_firm_links;
DROP FUNCTION IF EXISTS erp_private.supervisor_sees_project(uuid);
DROP FUNCTION IF EXISTS erp_private.supervisor_sees_client(uuid);

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
 ((erp_private.actor()).category_code IN('MANAGER','SUPERVISOR') AND (
 NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL) OR
 EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id))))))
$$;

CREATE OR REPLACE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
 AND (erp_private.actor()).category_code<>'INTERN'
 AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR')
 OR EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id)))))
$$;

CREATE TABLE erp_private.escalations(
 escalation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 task_id uuid REFERENCES erp_private.tasks,
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 raised_by uuid NOT NULL REFERENCES erp_private.staff_members,
 requested_manager_id uuid REFERENCES erp_private.staff_members,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Resolved')),
 resolved_by uuid REFERENCES erp_private.staff_members,
 resolved_at timestamptz,
 resolution_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status='Open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL AND length(btrim(coalesce(resolution_note,'')))>=10 AND resolved_by<>raised_by))
);
CREATE UNIQUE INDEX escalations_one_open ON erp_private.escalations(project_id,coalesce(task_id,'00000000-0000-0000-0000-000000000000'::uuid),raised_by) WHERE status='Open';
CREATE INDEX escalations_client_idx ON erp_private.escalations(client_id);
CREATE INDEX escalations_firm_idx ON erp_private.escalations(handling_firm_id,status);
CREATE INDEX escalations_task_idx ON erp_private.escalations(task_id);
CREATE INDEX escalations_raised_by_idx ON erp_private.escalations(raised_by);
CREATE INDEX escalations_manager_idx ON erp_private.escalations(requested_manager_id);
CREATE INDEX escalations_resolved_by_idx ON erp_private.escalations(resolved_by);
ALTER TABLE erp_private.escalations ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.escalations TO erp_api;
CREATE POLICY escalations_read ON erp_private.escalations FOR SELECT TO erp_api
 USING(raised_by=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id)));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.escalations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.escalations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('escalation_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.escalations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE OR REPLACE FUNCTION erp_private.escalation_raise(p_project uuid,p_task uuid,p_reason text,p_manager uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;proj erp_private.projects;tk erp_private.tasks;eid uuid;label text;cname text;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Only a Supervisor or Assistant escalates to a Manager. Managers and Partners decide directly.' USING ERRCODE='42501'; END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<10 OR length(p_reason)>1000 THEN RAISE EXCEPTION 'Say what you cannot handle and what you need decided, in at least 10 characters.' USING ERRCODE='23514'; END IF;
 SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 IF proj.project_id IS NULL OR NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'Escalation unavailable' USING ERRCODE='42501'; END IF;
 IF p_task IS NOT NULL THEN
  SELECT * INTO tk FROM erp_private.tasks WHERE task_id=p_task AND project_id=p_project AND deleted_at IS NULL;
  IF tk.task_id IS NULL OR NOT erp_private.task_allowed(p_task) THEN RAISE EXCEPTION 'Escalation unavailable' USING ERRCODE='42501'; END IF;
  label:=tk.task_name;
 ELSE label:=proj.project_name; END IF;
 IF p_manager IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.review_candidates(proj.client_id) r WHERE r.staff_id=p_manager) THEN RAISE EXCEPTION 'That person is not a Manager or Partner available for this client' USING ERRCODE='23514'; END IF;
 BEGIN
  INSERT INTO erp_private.escalations(client_id,project_id,task_id,handling_firm_id,raised_by,requested_manager_id,reason)
  VALUES(proj.client_id,p_project,p_task,proj.handling_firm_id,a.staff_id,p_manager,btrim(p_reason)) RETURNING escalation_id INTO eid;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'You have already escalated this and it is waiting for a Manager' USING ERRCODE='23505'; END;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=proj.client_id;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 SELECT r.staff_id,'Escalated to you by '||a.full_name||' for '||coalesce(cname,'a client')||' ('||left(label,120)||'): '||left(btrim(p_reason),300)||' Open Home, Waiting for my review.','escalation:'||eid::text||':'||r.staff_id::text
 FROM erp_private.review_candidates(proj.client_id) r
 WHERE p_manager IS NULL OR r.staff_id=p_manager OR r.category_code='PARTNER'
 ON CONFLICT (event_key) DO NOTHING;
 RETURN eid;
END;$$;

CREATE OR REPLACE FUNCTION erp_private.escalation_resolve(p_escalation uuid,p_note text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.escalations;cname text;mname text;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR NOT erp_private.is_leader() THEN RAISE EXCEPTION 'Only a Manager or Partner resolves an escalation' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM erp_private.escalations WHERE escalation_id=p_escalation FOR UPDATE;
 IF e.escalation_id IS NULL OR NOT erp_private.firm_allowed(e.handling_firm_id) THEN RAISE EXCEPTION 'Escalation unavailable' USING ERRCODE='42501'; END IF;
 IF e.status<>'Open' THEN RAISE EXCEPTION 'This escalation was already resolved' USING ERRCODE='23505'; END IF;
 IF e.raised_by=a.staff_id THEN RAISE EXCEPTION 'Another Manager or Partner must resolve your escalation' USING ERRCODE='42501'; END IF;
 IF e.requested_manager_id IS NOT NULL AND e.requested_manager_id<>a.staff_id AND a.category_code<>'PARTNER' THEN
  SELECT full_name INTO mname FROM erp_private.staff_members WHERE staff_id=e.requested_manager_id;
  RAISE EXCEPTION 'This was escalated to % . Only that Manager or a Partner can resolve it.',coalesce(mname,'another Manager') USING ERRCODE='42501';
 END IF;
 IF p_note IS NULL OR length(btrim(p_note))<10 OR length(p_note)>1000 THEN RAISE EXCEPTION 'Write the decision or instruction in at least 10 characters.' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.escalations SET status='Resolved',resolved_by=a.staff_id,resolved_at=now(),resolution_note=btrim(p_note) WHERE escalation_id=p_escalation;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=e.client_id;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 VALUES(e.raised_by,'Your escalation for '||coalesce(cname,'a client')||' was answered by '||a.full_name||': '||left(btrim(p_note),300),'escalation-answer:'||e.escalation_id::text) ON CONFLICT (event_key) DO NOTHING;
END;$$;

-- Open escalations the caller raised, or can answer. history=true also returns resolved ones the caller raised or answered.
CREATE OR REPLACE FUNCTION erp_private.escalation_list(p_history boolean DEFAULT false)
RETURNS TABLE(escalation_id uuid,client_id uuid,client_name text,project_id uuid,project_name text,task_id uuid,task_name text,raised_by uuid,raiser_name text,requested_manager_id uuid,manager_name text,reason text,status text,resolved_by_name text,resolved_at timestamptz,resolution_note text,created_at timestamptz,sent_to_me boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT e.escalation_id,e.client_id,c.company_name,e.project_id,p.project_name,e.task_id,t.task_name,e.raised_by,rs.full_name,e.requested_manager_id,ms.full_name,e.reason,e.status,vs.full_name,e.resolved_at,e.resolution_note,e.created_at,
  (e.requested_manager_id=(erp_private.actor()).staff_id)
 FROM erp_private.escalations e JOIN erp_private.clients c ON c.client_id=e.client_id JOIN erp_private.projects p ON p.project_id=e.project_id
 LEFT JOIN erp_private.tasks t ON t.task_id=e.task_id JOIN erp_private.staff_members rs ON rs.staff_id=e.raised_by
 LEFT JOIN erp_private.staff_members ms ON ms.staff_id=e.requested_manager_id LEFT JOIN erp_private.staff_members vs ON vs.staff_id=e.resolved_by
 WHERE (erp_private.actor()).staff_id IS NOT NULL AND (p_history OR e.status='Open') AND c.deleted_at IS NULL AND p.deleted_at IS NULL
 AND (e.raised_by=(erp_private.actor()).staff_id
  OR (erp_private.is_leader() AND erp_private.firm_allowed(e.handling_firm_id)
   AND (e.requested_manager_id IS NULL OR e.requested_manager_id=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code='PARTNER')))
 ORDER BY e.created_at DESC LIMIT 200;
$$;
REVOKE ALL ON FUNCTION erp_private.escalation_raise(uuid,uuid,text,uuid),erp_private.escalation_resolve(uuid,text),erp_private.escalation_list(boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.escalation_raise(uuid,uuid,text,uuid),erp_private.escalation_resolve(uuid,text),erp_private.escalation_list(boolean) TO erp_api;
