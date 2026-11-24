-- Client team: more than one named person per client.
-- A Manager or Partner names, for a client (and, if needed, for one project of that client):
--   PREPARER         the person who prepares the work (several allowed; the earliest named is the default for new work)
--   REVIEWER         the independent reviewer (several allowed)
--   MLRO             the MLRO or MLROs who look after the client's POCAMLA work (client level only; routes the work, it does not restrict who may decide)
--   WORKSTREAM_OWNER the owner of one workstream: SALES, PURCHASES, BANK, PAYROLL, VAT or INCOME_TAX
-- Scheduled tasks are routed to the workstream owner when one is named (a project owner first, then the client owner), and otherwise
-- keep going to the project's own preparer exactly as before. Nothing here widens access to client records: access still comes from
-- the existing rules (firm, project assignment, onboarding allocation). The Team screen asks for an onboarding allocation when one is needed.
CREATE TABLE erp_private.client_team_members (
 team_member_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
 project_id uuid REFERENCES erp_private.projects(project_id),
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members(staff_id),
 role text NOT NULL CHECK(role IN('PREPARER','REVIEWER','MLRO','WORKSTREAM_OWNER')),
 workstream text CHECK(workstream IN('SALES','PURCHASES','BANK','PAYROLL','VAT','INCOME_TAX')),
 assigned_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id),
 assigned_at timestamptz NOT NULL DEFAULT now(),
 note text,
 ended_at timestamptz,ended_by uuid REFERENCES erp_private.staff_members(staff_id),end_reason text,
 CHECK((role='WORKSTREAM_OWNER')=(workstream IS NOT NULL)),
 CHECK(role<>'MLRO' OR project_id IS NULL),
 CHECK((ended_at IS NULL)=(ended_by IS NULL)),
 CHECK(ended_at IS NULL OR length(btrim(COALESCE(end_reason,'')))>=5)
);
CREATE UNIQUE INDEX client_team_members_open ON erp_private.client_team_members(client_id,COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid),staff_id,role,COALESCE(workstream,'')) WHERE ended_at IS NULL;
CREATE INDEX client_team_members_client ON erp_private.client_team_members(client_id) WHERE ended_at IS NULL;
CREATE INDEX client_team_members_staff ON erp_private.client_team_members(staff_id) WHERE ended_at IS NULL;
CREATE INDEX client_team_members_project ON erp_private.client_team_members(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX client_team_members_by ON erp_private.client_team_members(assigned_by);
CREATE INDEX client_team_members_ended_by ON erp_private.client_team_members(ended_by);
ALTER TABLE erp_private.client_team_members ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_team_members FORCE ROW LEVEL SECURITY;
CREATE POLICY client_team_read ON erp_private.client_team_members FOR SELECT TO erp_api USING(erp_private.is_leader() OR staff_id=(erp_private.actor()).staff_id OR erp_private.client_allowed(client_id));
CREATE POLICY client_team_add ON erp_private.client_team_members FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND assigned_by=(erp_private.actor()).staff_id AND ended_at IS NULL);
CREATE POLICY client_team_end ON erp_private.client_team_members FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
GRANT SELECT,INSERT,UPDATE ON erp_private.client_team_members TO erp_api;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_team_members FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_team_members FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('team_member_id');

-- Who may hold which role, and where. A team row changes only by being ended, once, with a reason.
CREATE FUNCTION erp_private.client_team_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s erp_private.staff_members; pr erp_private.projects;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended team entry is never edited.' USING ERRCODE='23514'; END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.staff_id IS DISTINCT FROM OLD.staff_id OR NEW.role IS DISTINCT FROM OLD.role
   OR NEW.workstream IS DISTINCT FROM OLD.workstream OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at OR NEW.note IS DISTINCT FROM OLD.note THEN
   RAISE EXCEPTION 'A team entry changes only by being ended.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=NEW.staff_id;
 IF s.staff_id IS NULL OR s.deleted_at IS NOT NULL OR s.access_status<>'Active' OR (s.contract_end_date IS NOT NULL AND s.contract_end_date<(now() AT TIME ZONE 'Africa/Nairobi')::date) THEN
  RAISE EXCEPTION 'Choose an active member of staff.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.clients WHERE client_id=NEW.client_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'That client is not available.' USING ERRCODE='23514'; END IF;
 IF NEW.role IN('PREPARER','WORKSTREAM_OWNER') AND s.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN
  RAISE EXCEPTION 'A preparer or workstream owner is a Partner, Manager, Supervisor or Assistant.' USING ERRCODE='23514'; END IF;
 IF NEW.role='REVIEWER' AND s.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN
  RAISE EXCEPTION 'A reviewer is a Partner, Manager or Supervisor.' USING ERRCODE='23514'; END IF;
 IF NEW.role='MLRO' AND NOT (s.category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_capabilities c WHERE c.staff_id=s.staff_id AND c.capability='MLRO' AND c.deleted_at IS NULL AND (c.expires_on IS NULL OR c.expires_on>=current_date))) THEN
  RAISE EXCEPTION 'Only a Partner or a member of staff who holds the MLRO right can be named as the client''s MLRO.' USING ERRCODE='23514'; END IF;
 -- Separation of duties: the person who prepares or owns a workstream for a client cannot also review it or act as its MLRO, and the other way round.
 IF EXISTS(SELECT 1 FROM erp_private.client_team_members m WHERE m.client_id=NEW.client_id AND m.staff_id=NEW.staff_id AND m.ended_at IS NULL
  AND ((NEW.role IN('PREPARER','WORKSTREAM_OWNER') AND m.role IN('REVIEWER','MLRO')) OR (NEW.role IN('REVIEWER','MLRO') AND m.role IN('PREPARER','WORKSTREAM_OWNER')))) THEN
  RAISE EXCEPTION 'The same person cannot prepare the work and also review it or act as the client''s MLRO. Name someone else, or end the other role first.' USING ERRCODE='23514'; END IF;
 IF NEW.project_id IS NOT NULL THEN
  SELECT * INTO pr FROM erp_private.projects WHERE project_id=NEW.project_id;
  IF pr.project_id IS NULL OR pr.deleted_at IS NOT NULL OR pr.status='Archived' OR pr.client_id<>NEW.client_id THEN
   RAISE EXCEPTION 'Choose an open project of this client.' USING ERRCODE='23514'; END IF;
  IF s.category_code<>'PARTNER' AND NOT EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=s.staff_id AND a.firm_id=pr.handling_firm_id AND a.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'That person does not work in the firm that handles this project.' USING ERRCODE='23514'; END IF;
 ELSIF s.category_code<>'PARTNER' AND EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=NEW.client_id AND l.deleted_at IS NULL)
  AND NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l JOIN erp_private.staff_firm_access a ON a.firm_id=l.firm_id AND a.staff_id=s.staff_id AND a.deleted_at IS NULL WHERE l.client_id=NEW.client_id AND l.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'That person does not work in a firm that handles this client.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER team_guard BEFORE INSERT OR UPDATE ON erp_private.client_team_members FOR EACH ROW EXECUTE FUNCTION erp_private.client_team_guard();
REVOKE ALL ON FUNCTION erp_private.client_team_guard() FROM PUBLIC,anon,authenticated,erp_api;

-- People a Manager or Partner may name, by role. Staff records are visible only along the reporting line, so this narrow
-- function returns just what the Team screen needs: active people in the firms the signed-in person works in.
CREATE FUNCTION erp_private.client_team_candidates() RETURNS TABLE(staff_id uuid,full_name text,category_code text,is_mlro boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.staff_id,s.full_name,s.category_code,
  (s.category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_capabilities c WHERE c.staff_id=s.staff_id AND c.capability='MLRO' AND c.deleted_at IS NULL AND (c.expires_on IS NULL OR c.expires_on>=current_date))) AS is_mlro
 FROM erp_private.staff_members s
 WHERE erp_private.is_leader() AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
 AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND ((erp_private.actor()).category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=s.staff_id AND a.deleted_at IS NULL AND erp_private.firm_allowed(a.firm_id)))
$$;
REVOKE ALL ON FUNCTION erp_private.client_team_candidates() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.client_team_candidates() TO erp_api;

-- Which workstream does a scheduled task belong to? One list, used by the routing below and by the Team screen.
CREATE FUNCTION erp_private.team_workstream(k text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE
  WHEN k='weekly-sales' THEN 'SALES'
  WHEN k='weekly-purchases' THEN 'PURCHASES'
  WHEN k='weekly-bank' THEN 'BANK'
  WHEN k IN('monthly-payroll','monthly-paye','monthly-nssf','monthly-shif','monthly-housing-levy','monthly-nita') THEN 'PAYROLL'
  WHEN k IN('monthly-vat','monthly-tot') THEN 'VAT'
  WHEN k IN('monthly-mri','monthly-deemed-interest','monthly-fringe-benefit') OR k LIKE 'annual-%' THEN 'INCOME_TAX'
 END
$$;
GRANT EXECUTE ON FUNCTION erp_private.team_workstream(text) TO erp_api;

-- Route a newly generated scheduled task to the workstream owner. The project's own preparer stays the fallback, review tasks are
-- not touched, and a person who does not work in the project's firm is skipped. The owner is added to the project when needed.
CREATE FUNCTION erp_private.team_route_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE ws text; owner uuid; pr record;
BEGIN
 IF NEW.template_key IS NULL OR NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
 ws:=erp_private.team_workstream(NEW.template_key);
 IF ws IS NULL THEN RETURN NEW; END IF;
 SELECT p.client_id,p.handling_firm_id INTO pr FROM erp_private.projects p WHERE p.project_id=NEW.project_id;
 IF pr.client_id IS NULL THEN RETURN NEW; END IF;
 SELECT m.staff_id INTO owner FROM erp_private.client_team_members m JOIN erp_private.staff_members s ON s.staff_id=m.staff_id
  WHERE m.client_id=pr.client_id AND m.role='WORKSTREAM_OWNER' AND m.workstream=ws AND m.ended_at IS NULL AND (m.project_id=NEW.project_id OR m.project_id IS NULL)
   AND s.deleted_at IS NULL AND s.access_status='Active' AND (s.contract_end_date IS NULL OR s.contract_end_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
   AND (s.category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a WHERE a.staff_id=m.staff_id AND a.firm_id=pr.handling_firm_id AND a.deleted_at IS NULL))
  ORDER BY (m.project_id IS NOT NULL) DESC,m.assigned_at,m.team_member_id LIMIT 1;
 IF owner IS NULL OR owner=NEW.assigned_to THEN RETURN NEW; END IF;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job)
  SELECT NEW.project_id,s.staff_id,pr.handling_firm_id,s.category_code FROM erp_private.staff_members s WHERE s.staff_id=owner
  ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL WHERE erp_private.project_assignments.deleted_at IS NOT NULL;
 NEW.assigned_to:=owner;
 RETURN NEW;
END $$;
-- Named to run after the tax-obligation gates, so a task those gates drop never adds anyone to the project.
CREATE TRIGGER zz_team_route_task BEFORE INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.team_route_task();
REVOKE ALL ON FUNCTION erp_private.team_route_task() FROM PUBLIC,anon,authenticated,erp_api;
