-- Client lifecycle and contact routing.
--  * A client can be Paused, Resumed, Cancelled (service status) or Archived (record status). Nothing is ever deleted.
--  * Paused, Cancelled and Archived clients get no new generated tasks, and no project can be activated for them.
--  * Pause, Resume and Cancel: Manager or Partner (only a Partner can reinstate a Cancelled client). Archive and Restore: Partner only.
--  * Every change needs a written reason of at least 10 characters. The columns are changed only through client_lifecycle().
--  * Two routing fields say which saved client contact receives document requests and which receives reports.
ALTER TABLE erp_private.clients
 ADD COLUMN service_status text NOT NULL DEFAULT 'Active' CHECK (service_status IN ('Active','Paused','Cancelled')),
 ADD COLUMN lifecycle_reason text NOT NULL DEFAULT '',
 ADD COLUMN lifecycle_changed_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 ADD COLUMN lifecycle_changed_at timestamptz,
 ADD COLUMN archived_from_status text CHECK (archived_from_status IN ('Lead','Existing')),
 ADD COLUMN archive_reason text NOT NULL DEFAULT '',
 ADD COLUMN archived_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 ADD COLUMN archived_at timestamptz,
 ADD COLUMN doc_request_contact_id uuid REFERENCES erp_private.client_contacts(contact_id) ON DELETE RESTRICT,
 ADD COLUMN report_delivery_contact_id uuid REFERENCES erp_private.client_contacts(contact_id) ON DELETE RESTRICT;
CREATE INDEX clients_service_status_idx ON erp_private.clients(service_status) WHERE service_status<>'Active';
CREATE INDEX clients_lifecycle_changed_by_idx ON erp_private.clients(lifecycle_changed_by);
CREATE INDEX clients_archived_by_idx ON erp_private.clients(archived_by);
CREATE INDEX clients_doc_contact_idx ON erp_private.clients(doc_request_contact_id);
CREATE INDEX clients_report_contact_idx ON erp_private.clients(report_delivery_contact_id);

-- The lifecycle columns move only inside client_lifecycle(), which sets a transaction-local flag.
CREATE OR REPLACE FUNCTION erp_private.client_lifecycle_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.service_status<>'Active' OR NEW.record_status='Archived' THEN RAISE EXCEPTION 'A new client starts Active; use Pause, Cancel or Archive afterwards' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.service_status,NEW.lifecycle_reason,NEW.lifecycle_changed_by,NEW.lifecycle_changed_at,NEW.archived_from_status,NEW.archive_reason,NEW.archived_by,NEW.archived_at)
    IS DISTINCT FROM (OLD.service_status,OLD.lifecycle_reason,OLD.lifecycle_changed_by,OLD.lifecycle_changed_at,OLD.archived_from_status,OLD.archive_reason,OLD.archived_by,OLD.archived_at)
    OR (NEW.record_status='Archived') IS DISTINCT FROM (OLD.record_status='Archived') THEN
  IF COALESCE(current_setting('erp.lifecycle_ok',true),'')<>'1' THEN RAISE EXCEPTION 'Use Pause, Resume, Cancel, Archive or Restore to change a client''s lifecycle' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_client_lifecycle_guard BEFORE INSERT OR UPDATE ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.client_lifecycle_guard();

-- No project can be activated for a client that is not Active.
CREATE OR REPLACE FUNCTION erp_private.client_lifecycle_project_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c record;
BEGIN
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'Active') THEN
  SELECT service_status,record_status INTO c FROM erp_private.clients WHERE client_id=NEW.client_id;
  IF c.record_status='Archived' THEN RAISE EXCEPTION 'This client is archived; restore it before starting new work' USING ERRCODE='23514'; END IF;
  IF c.service_status<>'Active' THEN RAISE EXCEPTION 'This client is %; resume it before starting new work',lower(c.service_status) USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER b_client_lifecycle_project_guard BEFORE INSERT OR UPDATE ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.client_lifecycle_project_guard();

-- The scheduler creates no new tasks for a client that is not Active.
DO $do$
DECLARE def text;nd text;
BEGIN
 def:=pg_get_functiondef('erp_private.run_workspace_scheduler()'::regprocedure);
 nd:=replace(def,'AND cl.deleted_at IS NULL LOOP',$r$AND cl.deleted_at IS NULL AND cl.service_status='Active' AND cl.record_status<>'Archived' LOOP$r$);
 IF nd=def THEN RAISE EXCEPTION 'scheduler definition changed; patch not applied'; END IF;
 EXECUTE nd;
END $do$;

CREATE OR REPLACE FUNCTION erp_private.client_lifecycle(p_client uuid,p_action text,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a record;c record;why text:=btrim(COALESCE(p_reason,''));open_n integer;st text;
BEGIN
 a:=erp_private.actor();
 IF a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can change a client''s lifecycle' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN('Pause','Resume','Cancel','Archive','Restore') THEN RAISE EXCEPTION 'Unknown lifecycle action' USING ERRCODE='22023'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Write the reason in at least 10 characters' USING ERRCODE='22023'; END IF;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=p_client AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That client is not available' USING ERRCODE='22023'; END IF;
 PERFORM set_config('erp.lifecycle_ok','1',true);
 IF p_action IN('Archive','Restore') AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can archive or restore a client' USING ERRCODE='42501'; END IF;
 IF p_action<>'Restore' AND c.record_status='Archived' THEN RAISE EXCEPTION 'This client is archived; restore it first' USING ERRCODE='23514'; END IF;
 IF p_action='Pause' THEN
  IF c.service_status<>'Active' THEN RAISE EXCEPTION 'Only an Active client can be paused' USING ERRCODE='23514'; END IF;
  st:='Paused';
 ELSIF p_action='Resume' THEN
  IF c.service_status='Active' THEN RAISE EXCEPTION 'This client is already Active' USING ERRCODE='23514'; END IF;
  IF c.service_status='Cancelled' AND a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can reinstate a cancelled client' USING ERRCODE='42501'; END IF;
  st:='Active';
 ELSIF p_action='Cancel' THEN
  IF c.service_status='Cancelled' THEN RAISE EXCEPTION 'This client is already cancelled' USING ERRCODE='23514'; END IF;
  st:='Cancelled';
 END IF;
 IF p_action IN('Pause','Resume','Cancel') THEN
  UPDATE erp_private.clients SET service_status=st,lifecycle_reason=why,lifecycle_changed_by=a.staff_id,lifecycle_changed_at=now() WHERE client_id=p_client;
 ELSIF p_action='Archive' THEN
  SELECT count(*) INTO open_n FROM erp_private.projects WHERE client_id=p_client AND deleted_at IS NULL AND status='Active';
  IF open_n>0 THEN RAISE EXCEPTION 'This client still has % active project(s); archive or complete them first',open_n USING ERRCODE='23514'; END IF;
  UPDATE erp_private.clients SET record_status='Archived',archived_from_status=c.record_status,archive_reason=why,archived_by=a.staff_id,archived_at=now(),accepts_new_engagements=false WHERE client_id=p_client;
 ELSE
  IF c.record_status<>'Archived' THEN RAISE EXCEPTION 'This client is not archived' USING ERRCODE='23514'; END IF;
  UPDATE erp_private.clients SET record_status=COALESCE(c.archived_from_status,'Existing'),archive_reason='',archived_by=NULL,archived_at=NULL,
   lifecycle_reason=why,lifecycle_changed_by=a.staff_id,lifecycle_changed_at=now() WHERE client_id=p_client;
 END IF;
 IF p_action='Cancel' THEN
  PERFORM erp_private.alert_partners('client-lifecycle:'||p_client||':Cancel:'||floor(extract(epoch FROM now()))::text,
   c.company_name||' was cancelled by '||COALESCE((SELECT full_name FROM erp_private.staff_members WHERE staff_id=a.staff_id),'a leader')||'. Reason: '||why);
 END IF;
 RETURN jsonb_build_object('ok',true,'client_id',p_client,'action',p_action);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_lifecycle(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_lifecycle(uuid,text,text) TO erp_api;

-- Contact routing: pick which saved contact of this client receives document requests and reports.
CREATE OR REPLACE FUNCTION erp_private.client_routing_save(p_client uuid,p_doc uuid,p_report uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a record;
BEGIN
 a:=erp_private.actor();
 IF NOT erp_private.is_leader() THEN RAISE EXCEPTION 'Only a Manager or Partner can set contact routing' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF p_doc IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_contacts WHERE contact_id=p_doc AND client_id=p_client AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose a saved contact of this client for document requests' USING ERRCODE='22023'; END IF;
 IF p_report IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.client_contacts WHERE contact_id=p_report AND client_id=p_client AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Choose a saved contact of this client for report delivery' USING ERRCODE='22023'; END IF;
 UPDATE erp_private.clients SET doc_request_contact_id=p_doc,report_delivery_contact_id=p_report WHERE client_id=p_client AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'That client is not available' USING ERRCODE='22023'; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_routing_save(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_routing_save(uuid,uuid,uuid) TO erp_api;
