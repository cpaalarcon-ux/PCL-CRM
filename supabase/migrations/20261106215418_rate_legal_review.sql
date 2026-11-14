-- Rate register upgrade: structured legal citation, legal-review status, and a SEPT placeholder.
-- No tax rate is created or changed here. A rate with a Pending legal review may be tested on staging
-- but cannot be approved, and a return that relies on it cannot be submitted.

ALTER TABLE erp_private.tax_rates DROP CONSTRAINT tax_rates_tax_type_check;
ALTER TABLE erp_private.tax_rates ADD CONSTRAINT tax_rates_tax_type_check CHECK(tax_type IN ('VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy','Turnover tax','Rental income tax','Capital gains tax','NSSF','Relief / deduction','Interest benchmark','Significant economic presence tax'));

ALTER TABLE erp_private.tax_rates
 ADD COLUMN legal_citation text,
 ADD COLUMN legal_review_status text NOT NULL DEFAULT 'Not required' CHECK(legal_review_status IN ('Not required','Pending','Confirmed')),
 ADD COLUMN legal_review_note text,
 ADD COLUMN legal_review_reference text,
 ADD COLUMN legal_reviewed_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN legal_reviewed_at timestamptz,
 ADD CONSTRAINT tax_rates_legal_confirmed_chk CHECK(legal_review_status<>'Confirmed' OR (legal_reviewed_by IS NOT NULL AND legal_reviewed_at IS NOT NULL AND length(btrim(coalesce(legal_review_reference,'')))>=10)),
 ADD CONSTRAINT tax_rates_legal_pending_chk CHECK(legal_review_status<>'Pending' OR length(btrim(coalesce(legal_review_note,'')))>=10);

CREATE OR REPLACE FUNCTION erp_private.rate_legal_review_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.status='Approved' AND OLD.status<>'Approved' AND NEW.legal_review_status='Pending' THEN
  RAISE EXCEPTION 'This rate is pending legal review by the Tax Lead and cannot be approved' USING ERRCODE='23514';
 END IF;
 IF NEW.legal_review_status='Confirmed' AND OLD.legal_review_status IS DISTINCT FROM 'Confirmed' THEN
  IF (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN
   RAISE EXCEPTION 'Only an Engagement Partner may record the Tax Lead confirmation' USING ERRCODE='42501';
  END IF;
  IF NEW.legal_reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN
   RAISE EXCEPTION 'Legal review recorder mismatch' USING ERRCODE='42501';
  END IF;
 END IF;
 IF OLD.legal_review_status='Confirmed' AND NEW.legal_review_status<>'Confirmed' THEN
  RAISE EXCEPTION 'A confirmed legal review cannot be withdrawn; create a new dated version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION erp_private.rate_legal_review_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.rate_legal_review_guard() TO erp_api;
CREATE TRIGGER rate_legal_review_guard BEFORE UPDATE ON erp_private.tax_rates FOR EACH ROW EXECUTE FUNCTION erp_private.rate_legal_review_guard();

-- The TOT rate stays usable for staging tests but is flagged until the Tax Lead confirms it in writing.
UPDATE erp_private.tax_rates
 SET legal_review_status='Pending',
     legal_review_note='TOT rate and the KES 1 million to 25 million turnover band await the Tax Lead written confirmation against the current Finance Act.'
 WHERE rate_key='KE_TOT' AND status IN ('Draft','Testing') AND deleted_at IS NULL;

-- SEPT placeholder: no rate is stored. The Tax Lead must supply the rate and legal source first.
INSERT INTO erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,legal_review_status,legal_review_note)
SELECT 'KE_SEPT','Significant economic presence tax','Significant economic presence tax (rate pending)',DATE '2026-01-01',DATE '2026-12-31','{}'::jsonb,'','Placeholder row. No rate, base or dates have been confirmed.','Draft','Pending','Rate, taxable base and effective dates await the Tax Lead written confirmation. Do not enter a figure until it is supplied with its legal source.'
WHERE NOT EXISTS(SELECT 1 FROM erp_private.tax_rates WHERE rate_key='KE_SEPT');
