-- Credit notes for the firm's own invoices (billing step B).
-- A Manager or Partner prepares and submits; a different Partner issues. An issued credit note lowers what the client owes on the invoice.
-- Invoices here create no ledger journals, so a credit note only changes the client balance; it never touches the posted invoice itself.
-- Correct a mistake in a posted invoice with a credit note, then a new invoice. Existing purchase credit-note requests (credit_note_requests) are separate and untouched.
CREATE TABLE erp_private.invoice_credit_notes (
 credit_note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,
 invoice_id uuid NOT NULL,project_id uuid NOT NULL,client_id uuid NOT NULL,firm_id uuid NOT NULL,
 credit_note_number text UNIQUE,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Issued','Void')),
 reason_code text NOT NULL CHECK(reason_code IN ('Billing error','Service not delivered','Fee agreed down','Duplicate invoice','Other')),
 reason text NOT NULL CHECK(length(btrim(reason))>=5),
 credit_date date NOT NULL,
 lines jsonb NOT NULL,
 net_amount numeric(16,2) NOT NULL CHECK(net_amount>0),vat_amount numeric(16,2) NOT NULL CHECK(vat_amount>=0),
 total_amount numeric(16,2) GENERATED ALWAYS AS (net_amount+vat_amount) STORED,
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,submitted_at timestamptz,return_note text,
 issued_by uuid REFERENCES erp_private.staff_members,issued_at timestamptz,review_override_reason text,
 void_reason text,voided_by uuid REFERENCES erp_private.staff_members,voided_at timestamptz,
 etims_credit_note_no text,etims_issued_on date,etims_recorded_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 FOREIGN KEY(invoice_id,project_id,client_id,firm_id) REFERENCES erp_private.invoices(invoice_id,project_id,client_id,firm_id),
 CHECK(status NOT IN ('Issued') OR (credit_note_number IS NOT NULL AND issued_by IS NOT NULL AND issued_at IS NOT NULL)),
 CHECK(status<>'Void' OR length(btrim(COALESCE(void_reason,'')))>=5),
 UNIQUE(firm_id,etims_credit_note_no)
);
CREATE INDEX invoice_credit_notes_invoice_idx ON erp_private.invoice_credit_notes(invoice_id);
CREATE INDEX invoice_credit_notes_client_idx ON erp_private.invoice_credit_notes(client_id,firm_id,credit_date);
CREATE INDEX invoice_credit_notes_prepared_idx ON erp_private.invoice_credit_notes(prepared_by);
CREATE INDEX invoice_credit_notes_issued_idx ON erp_private.invoice_credit_notes(issued_by);

ALTER TABLE erp_private.invoice_credit_notes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.invoice_credit_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_notes_read ON erp_private.invoice_credit_notes FOR SELECT TO erp_api USING(erp_private.finance_allowed(project_id));
CREATE POLICY credit_notes_add ON erp_private.invoice_credit_notes FOR INSERT TO erp_api WITH CHECK(erp_private.finance_allowed(project_id,true) AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY credit_notes_update ON erp_private.invoice_credit_notes FOR UPDATE TO erp_api USING(erp_private.finance_allowed(project_id,true)) WITH CHECK(erp_private.finance_allowed(project_id,true));
GRANT SELECT,INSERT,UPDATE ON erp_private.invoice_credit_notes TO erp_api;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.invoice_credit_notes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.invoice_credit_notes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('credit_note_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.invoice_credit_notes FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

-- What has been credited on an invoice. Issued credit notes lower the balance; drafts and submitted ones are counted only when checking
-- that the credits together cannot exceed the invoice.
CREATE FUNCTION erp_private.invoice_credited(inv uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(sum(total_amount),0) FROM erp_private.invoice_credit_notes WHERE invoice_id=inv AND status='Issued' AND deleted_at IS NULL
$$;
CREATE FUNCTION erp_private.invoice_credit_committed(inv uuid,except_id uuid DEFAULT NULL) RETURNS numeric LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT COALESCE(sum(total_amount),0) FROM erp_private.invoice_credit_notes WHERE invoice_id=inv AND status IN ('Draft','Submitted','Issued') AND deleted_at IS NULL AND credit_note_id IS DISTINCT FROM except_id
$$;
GRANT EXECUTE ON FUNCTION erp_private.invoice_credited(uuid),erp_private.invoice_credit_committed(uuid,uuid) TO erp_api;

-- The database repeats the Edge rules so no other route can break them:
--  * only a posted invoice can be credited, and credits together cannot exceed it;
--  * an issued credit note cannot exceed what the client still owes on the invoice (so a paid invoice is handled by reversing the payment first);
--  * content freezes once submitted; only the issuing step, a void with a reason, and a one-time eTIMS reference change an issued note;
--  * the person who prepared a credit note cannot issue it, unless a reason of at least 10 characters is recorded (the Edge function allows that only to a Partner).
CREATE FUNCTION erp_private.invoice_credit_note_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE inv erp_private.invoices;owed numeric;why text:=btrim(COALESCE(NEW.review_override_reason,''));
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO inv FROM erp_private.invoices WHERE invoice_id=NEW.invoice_id;
  IF inv.status IS DISTINCT FROM 'Posted' THEN RAISE EXCEPTION 'Only a posted invoice can be credited.' USING ERRCODE='23514'; END IF;
  IF NEW.credit_date<inv.invoice_date THEN RAISE EXCEPTION 'The credit note date cannot be before the invoice date.' USING ERRCODE='23514'; END IF;
  IF (NEW.net_amount+NEW.vat_amount)+erp_private.invoice_credit_committed(NEW.invoice_id)>inv.total_amount THEN RAISE EXCEPTION 'Credit notes together cannot exceed the invoice.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Void' THEN RAISE EXCEPTION 'A void credit note cannot change.' USING ERRCODE='23514'; END IF;
 IF OLD.status<>'Draft' AND (NEW.reason_code,NEW.reason,NEW.credit_date,NEW.lines,NEW.net_amount,NEW.vat_amount) IS DISTINCT FROM (OLD.reason_code,OLD.reason,OLD.credit_date,OLD.lines,OLD.net_amount,OLD.vat_amount) THEN
  RAISE EXCEPTION 'A submitted or issued credit note cannot be changed. Return it to Draft first.' USING ERRCODE='23514'; END IF;
 IF (NEW.invoice_id,NEW.project_id,NEW.client_id,NEW.firm_id,NEW.request_id,NEW.prepared_by) IS DISTINCT FROM (OLD.invoice_id,OLD.project_id,OLD.client_id,OLD.firm_id,OLD.request_id,OLD.prepared_by) THEN
  RAISE EXCEPTION 'Credit note identity is immutable.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Draft' THEN
  SELECT * INTO inv FROM erp_private.invoices WHERE invoice_id=NEW.invoice_id;
  IF (NEW.net_amount+NEW.vat_amount)+erp_private.invoice_credit_committed(NEW.invoice_id,NEW.credit_note_id)>inv.total_amount THEN RAISE EXCEPTION 'Credit notes together cannot exceed the invoice.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Draft' AND NEW.status='Submitted' THEN RETURN NEW; END IF;
 IF OLD.status='Submitted' AND NEW.status='Draft' THEN
  IF length(btrim(COALESCE(NEW.return_note,'')))<3 THEN RAISE EXCEPTION 'Give a reason for returning the credit note.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status IN ('Draft','Submitted') AND NEW.status='Void' THEN RETURN NEW; END IF;
 IF OLD.status='Submitted' AND NEW.status='Issued' THEN
  IF NEW.issued_by IN (OLD.prepared_by) AND length(why)<10 THEN RAISE EXCEPTION 'The person who prepared a credit note cannot issue it.' USING ERRCODE='23514'; END IF;
  SELECT * INTO inv FROM erp_private.invoices WHERE invoice_id=NEW.invoice_id;
  owed:=inv.total_amount-COALESCE((SELECT sum(amount) FROM erp_private.payments WHERE invoice_id=NEW.invoice_id),0)-erp_private.invoice_credited(NEW.invoice_id);
  IF (NEW.net_amount+NEW.vat_amount)>owed THEN RAISE EXCEPTION 'A credit note cannot exceed what the client still owes on the invoice. Reverse or refund the payment first.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Issued' AND NEW.status='Void' THEN
  IF OLD.etims_credit_note_no IS NOT NULL THEN RAISE EXCEPTION 'This credit note is recorded on eTIMS. Reverse it in eTIMS instead of voiding it here.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Issued' AND NEW.status='Issued' THEN
  IF OLD.etims_credit_note_no IS NOT NULL AND NEW.etims_credit_note_no IS DISTINCT FROM OLD.etims_credit_note_no THEN RAISE EXCEPTION 'The eTIMS reference cannot be changed once recorded.' USING ERRCODE='23514'; END IF;
  IF (NEW.credit_note_number,NEW.issued_by,NEW.issued_at,NEW.review_override_reason) IS DISTINCT FROM (OLD.credit_note_number,OLD.issued_by,OLD.issued_at,OLD.review_override_reason) THEN RAISE EXCEPTION 'An issued credit note cannot change.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'Invalid credit note step.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER invoice_credit_note_guard BEFORE INSERT OR UPDATE ON erp_private.invoice_credit_notes FOR EACH ROW EXECUTE FUNCTION erp_private.invoice_credit_note_guard();
REVOKE ALL ON FUNCTION erp_private.invoice_credit_note_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- An invoice with an issued credit note cannot be voided: void the credit note first (or credit it fully and leave it posted).
CREATE FUNCTION erp_private.invoice_void_credit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.status='Void' AND OLD.status<>'Void' AND erp_private.invoice_credited(OLD.invoice_id)>0 THEN
  RAISE EXCEPTION 'This invoice has an issued credit note. Void the credit note before voiding the invoice.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_void_credit_guard BEFORE UPDATE ON erp_private.invoices FOR EACH ROW EXECUTE FUNCTION erp_private.invoice_void_credit_guard();
REVOKE ALL ON FUNCTION erp_private.invoice_void_credit_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
