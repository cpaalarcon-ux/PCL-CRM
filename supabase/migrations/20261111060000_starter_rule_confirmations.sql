-- Written confirmations for bank starter rules that depend on a tax ruling (build 2788). Today that is one rule: excise duty on bank charges to expense 51070.
-- A Partner RECORDS that the Tax Lead has confirmed in writing: who confirmed, the date of the written confirmation, and where it is written. Claude never records one.
-- Recording does not apply the rule to any client. It only lets a preparer copy the starter into a client as a PROPOSED rule, which a different Manager or Partner must still approve.
-- A confirmation is never edited or deleted. It can be WITHDRAWN with a reason, which locks the starter again for new copies (rules already copied are unchanged and keep their own approval).
CREATE TABLE erp_private.starter_rule_confirmations(
 confirmation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rule_key text NOT NULL CHECK(rule_key IN('excise-duty')),
 account_code text NOT NULL REFERENCES erp_private.account_catalog(code),
 confirmed_by_name text NOT NULL CHECK(char_length(btrim(confirmed_by_name)) BETWEEN 2 AND 120),
 confirmed_on date NOT NULL CHECK(confirmed_on<=((now() AT TIME ZONE 'Africa/Nairobi')::date)),
 source_note text NOT NULL CHECK(char_length(btrim(source_note)) BETWEEN 10 AND 500),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'Confirmed' CHECK(status IN('Confirmed','Withdrawn')),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdrawn_reason text CHECK(withdrawn_reason IS NULL OR char_length(btrim(withdrawn_reason)) BETWEEN 10 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Confirmed' AND withdrawn_by IS NULL AND withdrawn_at IS NULL AND withdrawn_reason IS NULL) OR (status='Withdrawn' AND withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL))
);
CREATE UNIQUE INDEX starter_rule_confirmations_live_uq ON erp_private.starter_rule_confirmations(rule_key) WHERE status='Confirmed';
CREATE INDEX starter_rule_confirmations_account_idx ON erp_private.starter_rule_confirmations(account_code);
CREATE INDEX starter_rule_confirmations_recorded_by_idx ON erp_private.starter_rule_confirmations(recorded_by);
CREATE INDEX starter_rule_confirmations_withdrawn_by_idx ON erp_private.starter_rule_confirmations(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
ALTER TABLE erp_private.starter_rule_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.starter_rule_confirmations FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.starter_rule_confirmations TO erp_api;
CREATE POLICY starter_confirm_read ON erp_private.starter_rule_confirmations FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY starter_confirm_insert ON erp_private.starter_rule_confirmations FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY starter_confirm_update ON erp_private.starter_rule_confirmations FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.starter_confirm_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF ROW(NEW.confirmation_id,NEW.rule_key,NEW.account_code,NEW.confirmed_by_name,NEW.confirmed_on,NEW.source_note,NEW.recorded_by,NEW.recorded_at)
    IS DISTINCT FROM ROW(OLD.confirmation_id,OLD.rule_key,OLD.account_code,OLD.confirmed_by_name,OLD.confirmed_on,OLD.source_note,OLD.recorded_by,OLD.recorded_at) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be edited. Withdraw it and record a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Withdrawn' THEN RAISE EXCEPTION 'A withdrawn confirmation cannot be changed.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Withdrawn' THEN RAISE EXCEPTION 'The only change allowed is to withdraw a confirmation.' USING ERRCODE='23514'; END IF;
 IF (erp_private.actor()).staff_id IS NOT NULL AND NEW.withdrawn_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The person withdrawing must be the signed-in Partner.' USING ERRCODE='42501'; END IF;
 NEW.withdrawn_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER starter_confirm_guard BEFORE UPDATE ON erp_private.starter_rule_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.starter_confirm_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.starter_rule_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.starter_rule_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.starter_rule_confirmations FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('confirmation_id');
