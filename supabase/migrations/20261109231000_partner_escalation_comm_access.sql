-- Build .109b.
-- 1. Escalate to Partner: a Supervisor, Manager or Partner raises an urgent item. Every other active Partner is alerted and sees it on Home
--    until a Partner (not the person who raised it) answers with a written note of at least 10 characters. Nothing on the work moves.
-- 2. Communication access level on each client. External client communications (letters, emails, calls, meetings, visits) are kept apart from
--    internal notes: Assistants and Interns never record or see external communications; a client set to MANAGERS_AND_PARTNERS also blocks Supervisors.
CREATE TABLE erp_private.partner_escalations (
 escalation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 task_id uuid REFERENCES erp_private.tasks,
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 raised_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 1000),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Answered')),
 answered_by uuid REFERENCES erp_private.staff_members,
 answered_at timestamptz,
 answer_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Open' AND answered_by IS NULL AND answered_at IS NULL AND answer_note IS NULL) OR (status='Answered' AND answered_by IS NOT NULL AND answered_at IS NOT NULL AND length(btrim(answer_note))>=10)),
 CHECK(answered_by IS NULL OR answered_by<>raised_by)
);
CREATE UNIQUE INDEX partner_escalation_open_once ON erp_private.partner_escalations(raised_by,COALESCE(task_id,project_id)) WHERE status='Open';
CREATE INDEX partner_escalation_open_idx ON erp_private.partner_escalations(created_at DESC) WHERE status='Open';
CREATE INDEX partner_escalation_client_idx ON erp_private.partner_escalations(client_id);
CREATE INDEX partner_escalation_project_idx ON erp_private.partner_escalations(project_id);
CREATE INDEX partner_escalation_task_idx ON erp_private.partner_escalations(task_id);
CREATE INDEX partner_escalation_firm_idx ON erp_private.partner_escalations(handling_firm_id);
CREATE INDEX partner_escalation_raised_idx ON erp_private.partner_escalations(raised_by);
CREATE INDEX partner_escalation_answered_idx ON erp_private.partner_escalations(answered_by);
ALTER TABLE erp_private.partner_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.partner_escalations FORCE ROW LEVEL SECURITY;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.partner_escalations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.partner_escalations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('escalation_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.partner_escalations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
GRANT SELECT ON erp_private.partner_escalations TO erp_api;
-- The person who raised it and every Partner can read it. Nobody writes directly; the functions below do.
CREATE POLICY partner_escalations_read ON erp_private.partner_escalations FOR SELECT TO erp_api
 USING(raised_by=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.partner_escalation_raise(p_project uuid,p_task uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;proj erp_private.projects;tk erp_private.tasks;eid uuid;label text;cname text;why text:=btrim(COALESCE(p_reason,''));
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner can escalate to a Partner' USING ERRCODE='42501'; END IF;
 IF length(why)<10 OR length(why)>1000 THEN RAISE EXCEPTION 'Say what needs a Partner and why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT * INTO proj FROM erp_private.projects WHERE project_id=p_project AND deleted_at IS NULL;
 IF proj.project_id IS NULL OR NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'Escalation unavailable' USING ERRCODE='42501'; END IF;
 IF p_task IS NOT NULL THEN
  SELECT * INTO tk FROM erp_private.tasks WHERE task_id=p_task AND project_id=p_project AND deleted_at IS NULL;
  IF tk.task_id IS NULL OR NOT erp_private.task_allowed(p_task) THEN RAISE EXCEPTION 'Escalation unavailable' USING ERRCODE='42501'; END IF;
  label:=tk.task_name;
 ELSE label:=proj.project_name; END IF;
 BEGIN
  INSERT INTO erp_private.partner_escalations(client_id,project_id,task_id,handling_firm_id,raised_by,reason)
  VALUES(proj.client_id,p_project,p_task,proj.handling_firm_id,a.staff_id,why) RETURNING escalation_id INTO eid;
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'You have already escalated this to the Partners and it is waiting for an answer' USING ERRCODE='23505'; END;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=proj.client_id;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT s.staff_id,p_task,'URGENT: escalated to the Partners by '||a.full_name||' for '||COALESCE(cname,'a client')||' ('||left(label,120)||'): '||left(why,300)||' Open Home, Escalated to Partners.','partner-escalation:'||eid::text||':'||s.staff_id::text
 FROM erp_private.staff_members s WHERE s.category_code='PARTNER' AND s.access_status='Active' AND s.deleted_at IS NULL AND s.staff_id<>a.staff_id;
 RETURN eid;
END $$;

CREATE FUNCTION erp_private.partner_escalation_list(p_history boolean DEFAULT false)
RETURNS TABLE(escalation_id uuid,client_id uuid,client_name text,project_id uuid,project_name text,task_id uuid,task_name text,raised_by uuid,raiser_name text,reason text,status text,answered_by uuid,answerer_name text,answered_at timestamptz,answer_note text,created_at timestamptz,revision bigint)
LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT e.escalation_id,e.client_id,c.company_name,e.project_id,p.project_name,e.task_id,k.task_name,e.raised_by,r.full_name,e.reason,e.status,e.answered_by,ab.full_name,e.answered_at,e.answer_note,e.created_at,e.revision
 FROM erp_private.partner_escalations e
 JOIN erp_private.clients c ON c.client_id=e.client_id
 JOIN erp_private.projects p ON p.project_id=e.project_id
 LEFT JOIN erp_private.tasks k ON k.task_id=e.task_id
 JOIN erp_private.staff_members r ON r.staff_id=e.raised_by
 LEFT JOIN erp_private.staff_members ab ON ab.staff_id=e.answered_by
 WHERE p_history OR e.status='Open'
 ORDER BY (e.status='Open') DESC,e.created_at DESC LIMIT 200
$$;

CREATE FUNCTION erp_private.partner_escalation_answer(p_id uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.partner_escalations;why text:=btrim(COALESCE(p_note,''));cname text;
BEGIN
 a:=erp_private.actor();
 IF auth.uid() IS NULL OR a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can answer an escalation to the Partners' USING ERRCODE='42501'; END IF;
 IF length(why)<10 OR length(why)>1000 THEN RAISE EXCEPTION 'Write the decision or instruction in at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM erp_private.partner_escalations WHERE escalation_id=p_id FOR UPDATE;
 IF e.escalation_id IS NULL OR e.status<>'Open' THEN RAISE EXCEPTION 'This was already answered' USING ERRCODE='23514'; END IF;
 IF e.raised_by=a.staff_id THEN RAISE EXCEPTION 'Another Partner must answer an escalation you raised' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.partner_escalations SET status='Answered',answered_by=a.staff_id,answered_at=now(),answer_note=why WHERE escalation_id=p_id;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=e.client_id;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 VALUES(e.raised_by,e.task_id,a.full_name||' answered your escalation for '||COALESCE(cname,'a client')||': '||left(why,300),'partner-escalation-answer:'||p_id::text) ON CONFLICT DO NOTHING;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION erp_private.partner_escalation_raise(uuid,uuid,text),erp_private.partner_escalation_list(boolean),erp_private.partner_escalation_answer(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.partner_escalation_raise(uuid,uuid,text),erp_private.partner_escalation_list(boolean),erp_private.partner_escalation_answer(uuid,text) TO erp_api;

-- Communication access level.
ALTER TABLE erp_private.clients ADD COLUMN comm_access_level text NOT NULL DEFAULT 'SUPERVISORS_AND_ABOVE' CHECK(comm_access_level IN('SUPERVISORS_AND_ABOVE','MANAGERS_AND_PARTNERS'));
CREATE FUNCTION erp_private.comm_access_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.comm_access_level IS DISTINCT FROM OLD.comm_access_level AND COALESCE(current_setting('erp.comm_ok',true),'')<>'1' THEN
  RAISE EXCEPTION 'Use Communication access to change who can record client communications' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_comm_access_guard BEFORE UPDATE ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.comm_access_guard();

CREATE FUNCTION erp_private.client_comm_access_save(p_client uuid,p_level text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;why text:=btrim(COALESCE(p_reason,''));
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can change communication access' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF p_level NOT IN('SUPERVISORS_AND_ABOVE','MANAGERS_AND_PARTNERS') THEN RAISE EXCEPTION 'Choose a valid access level' USING ERRCODE='22023'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='22023'; END IF;
 PERFORM set_config('erp.comm_ok','1',true);
 UPDATE erp_private.clients SET comm_access_level=p_level WHERE client_id=p_client AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'That client is not available' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('ok',true,'level',p_level);
END $$;
REVOKE ALL ON FUNCTION erp_private.client_comm_access_save(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_comm_access_save(uuid,text,text) TO erp_api;

-- May the signed-in person record or see EXTERNAL communications with this client?
CREATE FUNCTION erp_private.comm_external_allowed(p_client uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE (erp_private.actor()).category_code
  WHEN 'PARTNER' THEN true WHEN 'MANAGER' THEN true
  WHEN 'SUPERVISOR' THEN COALESCE((SELECT c.comm_access_level='SUPERVISORS_AND_ABOVE' FROM erp_private.clients c WHERE c.client_id=p_client),false)
  ELSE false END
$$;
REVOKE ALL ON FUNCTION erp_private.comm_external_allowed(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.comm_external_allowed(uuid) TO erp_api;

-- The register keeps Internal notes open to anyone who can already work on the client; every other channel is external.
DROP POLICY comms_read ON erp_private.communications;
DROP POLICY comms_add ON erp_private.communications;
DROP POLICY comms_update ON erp_private.communications;
CREATE POLICY comms_read ON erp_private.communications FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (project_id IS NULL OR erp_private.project_allowed(project_id)) AND (channel='Internal note' OR erp_private.comm_external_allowed(client_id)));
CREATE POLICY comms_add ON erp_private.communications FOR INSERT TO erp_api WITH CHECK(owner_id=(erp_private.actor()).staff_id AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (project_id IS NULL OR erp_private.project_allowed(project_id)) AND (channel='Internal note' OR erp_private.comm_external_allowed(client_id)));
CREATE POLICY comms_update ON erp_private.communications FOR UPDATE TO erp_api USING((owner_id=(erp_private.actor()).staff_id OR erp_private.is_leader()) AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (channel='Internal note' OR erp_private.comm_external_allowed(client_id))) WITH CHECK(erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (channel='Internal note' OR erp_private.comm_external_allowed(client_id)));
