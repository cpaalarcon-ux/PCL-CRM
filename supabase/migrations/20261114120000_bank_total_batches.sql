-- Build 2799: monthly bank totals and adjustments, read from the firm's five-bank workbook (sheet BANK INPUTS) as it is.
-- A review working per client and financial year: statement credits, bank charges and finance costs by bank and month, and the non-trade credits,
-- bounced cheques and trade receipt corrections that adjust the credits to trade collections. It feeds no ledger entry, no return and no statement line.
-- A Manager or Partner who did not prepare it confirms it; a confirmed batch is never edited, only withdrawn with a reason.
CREATE TABLE erp_private.bank_total_batches(
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 starts_on date NOT NULL, -- 1 January of the financial year
 ends_on date NOT NULL, -- 31 December
 source_document_id uuid REFERENCES erp_private.documents,
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object'),
 result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(result)='object'),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Confirmed','Withdrawn')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 confirm_note text CHECK(confirm_note IS NULL OR char_length(btrim(confirm_note)) BETWEEN 10 AND 500),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdrawn_reason text CHECK(withdrawn_reason IS NULL OR char_length(btrim(withdrawn_reason)) BETWEEN 10 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(ends_on>=starts_on),
 CHECK(status<>'Confirmed' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND confirm_note IS NOT NULL)),
 CHECK(status<>'Withdrawn' OR (withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND withdrawn_reason IS NOT NULL))
);
CREATE UNIQUE INDEX bank_total_batches_live_uq ON erp_private.bank_total_batches(client_id,starts_on) WHERE status<>'Withdrawn';
CREATE INDEX bank_total_batches_source_document_idx ON erp_private.bank_total_batches(source_document_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX bank_total_batches_created_by_idx ON erp_private.bank_total_batches(created_by);
CREATE INDEX bank_total_batches_confirmed_by_idx ON erp_private.bank_total_batches(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX bank_total_batches_withdrawn_by_idx ON erp_private.bank_total_batches(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
ALTER TABLE erp_private.bank_total_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bank_total_batches FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.bank_total_batches TO erp_api;
CREATE POLICY bank_total_read ON erp_private.bank_total_batches FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY bank_total_insert ON erp_private.bank_total_batches FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY bank_total_update ON erp_private.bank_total_batches FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.bank_total_batches FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.bank_total_batches FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('batch_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.bank_total_batches FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.bank_total_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF ROW(NEW.batch_id,NEW.client_id,NEW.starts_on,NEW.ends_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.batch_id,OLD.client_id,OLD.starts_on,OLD.ends_on,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'The client, year and preparer of a batch cannot change.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Withdrawn' THEN RAISE EXCEPTION 'A withdrawn batch cannot be changed.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Confirmed' AND NEW.status<>'Withdrawn' THEN RAISE EXCEPTION 'A confirmed batch cannot be edited. Withdraw it and prepare a new one.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Confirmed' AND ROW(NEW.inputs,NEW.result,NEW.source_document_id,NEW.confirmed_by,NEW.confirmed_at,NEW.confirm_note) IS DISTINCT FROM ROW(OLD.inputs,OLD.result,OLD.source_document_id,OLD.confirmed_by,OLD.confirmed_at,OLD.confirm_note) THEN
  RAISE EXCEPTION 'Withdrawing a confirmed batch changes nothing else about it.' USING ERRCODE='23514';
 END IF;
 IF NEW.status='Confirmed' AND OLD.status='Draft' THEN
  IF (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can confirm a bank totals batch.' USING ERRCODE='23514'; END IF;
  IF NEW.created_by=(erp_private.actor()).staff_id OR NEW.confirmed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The person who prepared a batch cannot confirm it.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='Withdrawn' AND (erp_private.actor()).category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can withdraw a bank totals batch.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Draft' AND ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.confirm_note,NEW.withdrawn_by,NEW.withdrawn_at,NEW.withdrawn_reason) IS DISTINCT FROM ROW(NULL::uuid,NULL::timestamptz,NULL::text,NULL::uuid,NULL::timestamptz,NULL::text) THEN
  RAISE EXCEPTION 'A draft batch has no review or withdrawal details.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bank_total_guard BEFORE UPDATE ON erp_private.bank_total_batches FOR EACH ROW EXECUTE FUNCTION erp_private.bank_total_guard();
