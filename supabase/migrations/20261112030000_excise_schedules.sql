-- Build 2794: excise schedule. For one client and one calendar month, the quantities or values sold and the excise duty worked out from the dated excise rule.
-- A review working only: it feeds no return, no filing and no ledger. The figures come from the rule (product code, unit, rate); none is stored here except as the
-- snapshot of what the person was shown. A Manager or Partner who did not prepare it reviews it; a reviewed schedule is never edited, only withdrawn with a reason.
CREATE TABLE erp_private.excise_schedules(
 schedule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='array' AND jsonb_array_length(inputs) BETWEEN 1 AND 40),
 result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object'),
 total_duty numeric(18,2) NOT NULL DEFAULT 0 CHECK(total_duty>=0),
 rules_status text NOT NULL DEFAULT 'TESTING' CHECK(rules_status IN('TESTING','CONFIRMED','UNCONFIRMED')),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Reviewed','Withdrawn')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text CHECK(review_note IS NULL OR char_length(btrim(review_note)) BETWEEN 10 AND 500),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdrawn_reason text CHECK(withdrawn_reason IS NULL OR char_length(btrim(withdrawn_reason)) BETWEEN 10 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(ends_on>=starts_on),
 CHECK(status<>'Reviewed' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_note IS NOT NULL)),
 CHECK(status<>'Withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL))
);
CREATE UNIQUE INDEX excise_schedules_live_uq ON erp_private.excise_schedules(client_id,starts_on) WHERE status<>'Withdrawn';
CREATE INDEX excise_schedules_created_by_idx ON erp_private.excise_schedules(created_by);
CREATE INDEX excise_schedules_reviewed_by_idx ON erp_private.excise_schedules(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX excise_schedules_withdrawn_by_idx ON erp_private.excise_schedules(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
ALTER TABLE erp_private.excise_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.excise_schedules FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.excise_schedules TO erp_api;
CREATE POLICY excise_schedule_read ON erp_private.excise_schedules FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY excise_schedule_insert ON erp_private.excise_schedules FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY excise_schedule_update ON erp_private.excise_schedules FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.excise_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.excise_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('schedule_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.excise_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.excise_schedule_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF ROW(NEW.schedule_id,NEW.client_id,NEW.starts_on,NEW.ends_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.schedule_id,OLD.client_id,OLD.starts_on,OLD.ends_on,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'The client, month and preparer of a schedule cannot change.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Withdrawn' THEN RAISE EXCEPTION 'A withdrawn schedule cannot be changed.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Reviewed' AND NEW.status<>'Withdrawn' THEN RAISE EXCEPTION 'A reviewed schedule cannot be edited. Withdraw it and prepare a new one.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Reviewed' AND ROW(NEW.inputs,NEW.result,NEW.total_duty,NEW.rules_status,NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM ROW(OLD.inputs,OLD.result,OLD.total_duty,OLD.rules_status,OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) THEN
  RAISE EXCEPTION 'Withdrawing a reviewed schedule changes nothing else about it.' USING ERRCODE='23514';
 END IF;
 IF NEW.status='Reviewed' AND OLD.status='Draft' THEN
  IF (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can review an excise schedule.' USING ERRCODE='23514'; END IF;
  IF NEW.created_by=(erp_private.actor()).staff_id OR NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The person who prepared a schedule cannot review it.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='Withdrawn' AND (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can withdraw an excise schedule.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Draft' AND ROW(NEW.reviewed_by,NEW.reviewed_at,NEW.review_note,NEW.withdrawn_by,NEW.withdrawn_at,NEW.withdrawn_reason) IS DISTINCT FROM ROW(NULL::uuid,NULL::timestamptz,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text) THEN
  RAISE EXCEPTION 'A draft schedule has no review or withdrawal details.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER excise_schedule_guard BEFORE UPDATE ON erp_private.excise_schedules FOR EACH ROW EXECUTE FUNCTION erp_private.excise_schedule_guard();
