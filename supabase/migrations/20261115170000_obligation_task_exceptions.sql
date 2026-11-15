-- Build 2814: tax work for an obligation the client's verified tax profile does not confirm needs a reason and a Manager's or Partner's approval.
-- An exception covers one client, one obligation and one period. It is requested by one person and decided by a different Manager or Partner;
-- the facts of the request are never edited, an approved exception is ended with a reason, and nothing is deleted.
CREATE TABLE erp_private.obligation_task_exceptions(
 exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 obligation_code text NOT NULL CHECK(length(btrim(obligation_code)) BETWEEN 1 AND 40),
 period_start date NOT NULL,period_end date NOT NULL CHECK(period_end>=period_start),
 state_at_request text NOT NULL CHECK(state_at_request IN('Not registered','Exempt','Needs verification')),
 state_detail text NOT NULL DEFAULT '' CHECK(length(state_detail)<=600),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 15 AND 1000),
 status text NOT NULL DEFAULT 'Requested' CHECK(status IN('Requested','Approved','Rejected','Ended')),
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES erp_private.staff_members,decided_at timestamptz,decision_note text CHECK(decision_note IS NULL OR length(decision_note)<=1000),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,ended_reason text CHECK(ended_reason IS NULL OR length(ended_reason)<=1000),
 revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(decided_by IS NULL OR decided_by<>requested_by),
 CHECK(status NOT IN('Approved','Rejected','Ended') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
 CHECK(status<>'Rejected' OR length(btrim(coalesce(decision_note,'')))>=5),
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND length(btrim(coalesce(ended_reason,'')))>=5))
);
CREATE INDEX obligation_task_exceptions_lookup_idx ON erp_private.obligation_task_exceptions(client_id,obligation_code,status);
CREATE INDEX obligation_task_exceptions_requested_by_idx ON erp_private.obligation_task_exceptions(requested_by);
CREATE INDEX obligation_task_exceptions_decided_by_idx ON erp_private.obligation_task_exceptions(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX obligation_task_exceptions_ended_by_idx ON erp_private.obligation_task_exceptions(ended_by) WHERE ended_by IS NOT NULL;
CREATE UNIQUE INDEX obligation_task_exceptions_open_uidx ON erp_private.obligation_task_exceptions(client_id,obligation_code,period_start,period_end) WHERE status IN('Requested','Approved');
ALTER TABLE erp_private.obligation_task_exceptions ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.obligation_task_exceptions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.obligation_task_exceptions TO erp_api;
CREATE POLICY ote_read ON erp_private.obligation_task_exceptions FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY ote_insert ON erp_private.obligation_task_exceptions FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND requested_by=(erp_private.actor()).staff_id);
CREATE POLICY ote_update ON erp_private.obligation_task_exceptions FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.obligation_task_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.obligation_task_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('exception_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.obligation_task_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.obligation_task_exceptions_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE who erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Requested' THEN RAISE EXCEPTION 'An exception is requested first and decided by someone else.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.obligation_code,NEW.period_start,NEW.period_end,NEW.state_at_request,NEW.state_detail,NEW.reason,NEW.requested_by,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.obligation_code,OLD.period_start,OLD.period_end,OLD.state_at_request,OLD.state_detail,OLD.reason,OLD.requested_by,OLD.requested_at) THEN
  RAISE EXCEPTION 'A requested exception is never edited. Reject or end it and request a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status IN('Rejected','Ended') THEN RAISE EXCEPTION 'A decided exception stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Requested' AND NEW.status IN('Approved','Rejected') THEN
  IF current_user='erp_api' THEN
   SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id;
   IF who.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner decides an obligation exception.' USING ERRCODE='23514'; END IF;
   IF NEW.decided_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'The decision is recorded under your own name.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF OLD.status='Approved' AND NEW.status='Ended' THEN
  IF NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN RAISE EXCEPTION 'The approval stays as it was.' USING ERRCODE='23514'; END IF;
  IF current_user='erp_api' THEN
   SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id;
   IF who.category_code NOT IN('PARTNER','MANAGER') OR NEW.ended_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'A Manager or Partner ends an approved exception under their own name.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER obligation_task_exceptions_guard BEFORE INSERT OR UPDATE ON erp_private.obligation_task_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.obligation_task_exceptions_guard();
