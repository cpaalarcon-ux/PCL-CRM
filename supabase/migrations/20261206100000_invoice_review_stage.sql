-- Invoice workflow, step A: prepare, submit, check, post.
-- A draft invoice now carries a review stage (Draft, Submitted, Checked). The invoice status stays Draft until it is posted, so every
-- existing rule that reads status (statements, payments, VAT lock, immutability of posted invoices) is untouched. The stage matters only
-- while the invoice is a draft; posted and void invoices keep the default value and it is ignored.
ALTER TABLE erp_private.invoices
 ADD COLUMN review_stage text NOT NULL DEFAULT 'Draft' CHECK (review_stage IN ('Draft','Submitted','Checked')),
 ADD COLUMN submitted_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN submitted_at timestamptz,
 ADD COLUMN checked_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN checked_at timestamptz,
 ADD COLUMN return_note text,
 ADD COLUMN review_override_reason text;

-- The database repeats the rules the Edge function applies, so a different route to the table cannot skip them.
--  * Posting needs a Checked draft.
--  * The person who created or submitted the draft cannot post it, and the person who submitted it cannot check it,
--    unless a reason of at least 10 characters is recorded (the Edge function allows that only to a Partner).
--  * A submitted or checked draft cannot have its content changed; it must be returned to Draft first.
CREATE FUNCTION erp_private.invoice_review_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE why text:=btrim(COALESCE(NEW.review_override_reason,''));
BEGIN
 IF OLD.status<>'Draft' THEN RETURN NEW; END IF;
 IF NEW.status='Posted' THEN
  IF OLD.review_stage<>'Checked' THEN RAISE EXCEPTION 'Check the invoice before posting it.' USING ERRCODE='23514'; END IF;
  IF NEW.posted_by IN (OLD.created_by,OLD.submitted_by) AND length(why)<10 THEN
   RAISE EXCEPTION 'The person who prepared an invoice cannot post it.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='Void' THEN RETURN NEW; END IF;
 IF NEW.review_stage<>OLD.review_stage THEN
  IF OLD.review_stage='Draft' AND NEW.review_stage='Submitted' THEN
   IF NEW.submitted_by IS NULL THEN RAISE EXCEPTION 'Record who submitted the invoice.' USING ERRCODE='23514'; END IF;
  ELSIF OLD.review_stage='Submitted' AND NEW.review_stage='Checked' THEN
   IF NEW.checked_by IS NULL THEN RAISE EXCEPTION 'Record who checked the invoice.' USING ERRCODE='23514'; END IF;
   IF NEW.checked_by IS NOT DISTINCT FROM OLD.submitted_by AND length(why)<10 THEN
    RAISE EXCEPTION 'The person who submitted an invoice cannot check it.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.review_stage='Draft' AND OLD.review_stage IN ('Submitted','Checked') THEN
   IF length(btrim(COALESCE(NEW.return_note,'')))<3 THEN RAISE EXCEPTION 'Give a reason for returning the invoice.' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid invoice review step.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.review_stage<>'Draft' AND (NEW.lines,NEW.net_amount,NEW.vat_amount,NEW.description,NEW.invoice_date,NEW.due_date,NEW.external_reference)
   IS DISTINCT FROM (OLD.lines,OLD.net_amount,OLD.vat_amount,OLD.description,OLD.invoice_date,OLD.due_date,OLD.external_reference) THEN
  RAISE EXCEPTION 'Return the invoice to Draft before changing it.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER invoice_review_guard BEFORE UPDATE ON erp_private.invoices FOR EACH ROW EXECUTE FUNCTION erp_private.invoice_review_guard();
REVOKE ALL ON FUNCTION erp_private.invoice_review_guard() FROM PUBLIC,anon,authenticated,service_role,erp_api;
