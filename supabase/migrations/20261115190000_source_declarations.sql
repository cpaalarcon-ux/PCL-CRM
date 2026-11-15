-- Build 2817: a documented "nothing to report" declaration for one client, obligation, source and month.
-- It can satisfy a period's source-completeness check. It never files, acknowledges or approves a return: filing and acknowledgement stay separate steps.
-- The facts of a declaration are never edited. It is ended with a reason, and nothing is deleted.
CREATE TABLE erp_private.source_declarations(
 declaration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 source_key text NOT NULL CHECK(source_key IN('sales','purchases','bank','payroll')),
 obligation_code text NOT NULL CHECK(length(btrim(obligation_code)) BETWEEN 1 AND 40),
 period_month date NOT NULL CHECK(extract(day FROM period_month)=1),
 declarant_name text NOT NULL CHECK(length(btrim(declarant_name)) BETWEEN 3 AND 200),
 declared_on date NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 15 AND 1000),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Ended')),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,recorded_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,ended_reason text CHECK(ended_reason IS NULL OR length(ended_reason)<=1000),
 revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND length(btrim(coalesce(ended_reason,'')))>=5))
);
CREATE INDEX source_declarations_project_idx ON erp_private.source_declarations(project_id,period_month,status);
CREATE INDEX source_declarations_client_idx ON erp_private.source_declarations(client_id);
CREATE INDEX source_declarations_recorded_by_idx ON erp_private.source_declarations(recorded_by);
CREATE INDEX source_declarations_ended_by_idx ON erp_private.source_declarations(ended_by) WHERE ended_by IS NOT NULL;
CREATE UNIQUE INDEX source_declarations_active_uidx ON erp_private.source_declarations(project_id,source_key,obligation_code,period_month) WHERE status='Active';
ALTER TABLE erp_private.source_declarations ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.source_declarations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.source_declarations TO erp_api;
CREATE POLICY sd_read ON erp_private.source_declarations FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY sd_insert ON erp_private.source_declarations FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY sd_update ON erp_private.source_declarations FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.source_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.source_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('declaration_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.source_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.source_declarations_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE who erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Active' THEN RAISE EXCEPTION 'A declaration is recorded as Active and ended later with a reason.' USING ERRCODE='23514'; END IF;
  IF NEW.declared_on>current_date+1 THEN RAISE EXCEPTION 'The declaration date cannot be in the future.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.project_id,NEW.source_key,NEW.obligation_code,NEW.period_month,NEW.declarant_name,NEW.declared_on,NEW.reason,NEW.recorded_by,NEW.recorded_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.source_key,OLD.obligation_code,OLD.period_month,OLD.declarant_name,OLD.declared_on,OLD.reason,OLD.recorded_by,OLD.recorded_at) THEN
  RAISE EXCEPTION 'A declaration is never edited. End it with a reason and record a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Ended' THEN RAISE EXCEPTION 'An ended declaration stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Ended' THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' THEN
  SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id;
  IF NEW.ended_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'A declaration is ended under your own name.' USING ERRCODE='23514'; END IF;
  IF who.category_code NOT IN('PARTNER','MANAGER') AND OLD.recorded_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'The person who recorded a declaration, a Manager or a Partner ends it.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_declarations_guard BEFORE INSERT OR UPDATE ON erp_private.source_declarations FOR EACH ROW EXECUTE FUNCTION erp_private.source_declarations_guard();
