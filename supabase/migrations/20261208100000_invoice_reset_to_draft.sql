-- Invoice workflow, step C: reset a posted invoice to draft (exceptional, Partner only).
-- Corrections normally go by credit note and a new invoice. A reset is for a posted invoice that has not gone anywhere yet: no payment,
-- no credit note, and no eTIMS reference. It is off for every firm until a Partner turns the firm setting on.
--  * The invoice keeps its number. When it is posted again it takes the same number, not the next one.
--  * It returns to Draft with its review stage reset, so it must be submitted, checked and posted again by two different people.
--  * The reason, the Partner and the time are recorded on the invoice; every change is also written to the audit log.
ALTER TABLE erp_private.firms
 ADD COLUMN allow_invoice_reset_to_draft boolean NOT NULL DEFAULT false;

ALTER TABLE erp_private.invoices
 ADD COLUMN reset_count integer NOT NULL DEFAULT 0,
 ADD COLUMN last_reset_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN last_reset_at timestamptz,
 ADD COLUMN last_reset_reason text;

-- All the rules for a reset live in one function. suite_guard calls it for a Posted -> Draft change, and nothing else may make that change.
CREATE FUNCTION erp_private.invoice_reset_check(o erp_private.invoices, n erp_private.invoices) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE why text:=btrim(COALESCE(n.last_reset_reason,'')); allowed text[]:=ARRAY['status','review_stage','submitted_by','submitted_at','checked_by','checked_at',
  'return_note','review_override_reason','reset_count','last_reset_by','last_reset_at','last_reset_reason','revision','updated_at','total_amount'];
BEGIN
 IF (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner can reset a posted invoice to draft.' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE((SELECT f.allow_invoice_reset_to_draft FROM erp_private.firms f WHERE f.firm_id=o.firm_id),false) THEN
  RAISE EXCEPTION 'Resetting a posted invoice to draft is switched off for this firm.' USING ERRCODE='23514'; END IF;
 IF length(why)<10 THEN RAISE EXCEPTION 'Give the reason for the reset (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF n.last_reset_by IS DISTINCT FROM (erp_private.actor()).staff_id OR n.reset_count IS DISTINCT FROM o.reset_count+1 THEN
  RAISE EXCEPTION 'Record who reset the invoice.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.payments p WHERE p.invoice_id=o.invoice_id) THEN
  RAISE EXCEPTION 'This invoice has a payment recorded against it. Correct it with a credit note instead of resetting it.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.invoice_credit_notes c WHERE c.invoice_id=o.invoice_id AND c.status<>'Void' AND c.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'This invoice has a credit note. Void the credit note first, or correct the invoice with a further credit note.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.invoice_etims e WHERE e.invoice_id=o.invoice_id) THEN
  RAISE EXCEPTION 'An eTIMS reference is recorded for this invoice, so it cannot be reset. Correct it with a credit note.' USING ERRCODE='23514'; END IF;
 IF n.review_stage<>'Draft' THEN RAISE EXCEPTION 'A reset invoice must go through submit, check and post again.' USING ERRCODE='23514'; END IF;
 IF n.invoice_number IS DISTINCT FROM o.invoice_number THEN RAISE EXCEPTION 'A reset invoice keeps its number.' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(n)-allowed) IS DISTINCT FROM (to_jsonb(o)-allowed) THEN RAISE EXCEPTION 'A reset changes only the invoice status and its review record.' USING ERRCODE='23514'; END IF;
END $$;
REVOKE ALL ON FUNCTION erp_private.invoice_reset_check(erp_private.invoices,erp_private.invoices) FROM PUBLIC,anon,authenticated,service_role,erp_api;
-- suite_guard runs as the calling role (SECURITY INVOKER), so that role needs to execute the check; the check only raises or returns.
GRANT EXECUTE ON FUNCTION erp_private.invoice_reset_check(erp_private.invoices,erp_private.invoices) TO erp_api;

-- suite_guard refused every change from Posted except to Void. Let it pass a Posted -> Draft change only after invoice_reset_check has accepted it.
DO $$
DECLARE d text; o text; n text;
BEGIN
 d:=pg_get_functiondef('erp_private.suite_guard()'::regprocedure);
 o:=$q$ ELSIF TG_TABLE_NAME='invoices' THEN
$q$;
 n:=$q$ ELSIF TG_TABLE_NAME='invoices' THEN
  IF OLD.status='Posted' AND NEW.status='Draft' THEN PERFORM erp_private.invoice_reset_check(OLD,NEW); RETURN NEW; END IF;
$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'suite_guard changed: reset patch not applied'; END IF;
 EXECUTE replace(d,o,n);
END $$;

-- A posted invoice that is posted again keeps the number it already has; posting stays blocked until the review stage is Checked.
-- (The Edge function reuses invoice_number; the unique constraint on invoice_number still holds.)
