-- Build 2847: the Partner's choice about what "Healthy" means on a client card.
-- By default (no row, or the latest row says false) a client is Healthy when it is work-ready: KYC verified, KRA PIN recorded in the right format, an engagement created
-- with a Manager or Partner assigned, and a verified signed engagement letter. The Chart of Accounts and the other set-up sections are shown as progress, never as a blocker.
-- A Partner may choose to add "the client Chart of Accounts is approved" to the Healthy test. It is a dated record, never edited: each choice is a new row with a reason, and the latest row is in force.
-- This changes only what the card shows. It does not change activation, mapping, posting or reporting rules.
CREATE TABLE erp_private.client_status_policy(
 policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 require_chart boolean NOT NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 set_by uuid NOT NULL REFERENCES erp_private.staff_members,
 set_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX client_status_policy_at_idx ON erp_private.client_status_policy(set_at DESC);
CREATE INDEX client_status_policy_by_idx ON erp_private.client_status_policy(set_by);
ALTER TABLE erp_private.client_status_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_status_policy FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.client_status_policy TO erp_api;
-- Everyone signed in can read the current choice (it decides what every card shows); only a Partner records one, under their own name.
CREATE POLICY std_read ON erp_private.client_status_policy FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY std_insert ON erp_private.client_status_policy FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND set_by=(erp_private.actor()).staff_id);
CREATE FUNCTION erp_private.client_status_policy_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A recorded choice is part of the history and cannot be changed or removed. Record a new one.' USING ERRCODE='42501'; END;$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.client_status_policy FOR EACH ROW EXECUTE FUNCTION erp_private.client_status_policy_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.client_status_policy FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('policy_id');
