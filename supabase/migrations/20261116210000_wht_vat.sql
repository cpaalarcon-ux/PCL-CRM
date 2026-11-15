-- Build 2834: withholding VAT, kept apart from ordinary VAT output and input.
-- 1. Supplier side: a withholding VAT certificate received from a customer is recorded as the credit-register entry it already is (WHT_VAT, checked against iTax by a
--    different person). This build adds the link the register lacked: the sales invoices the certificate covers, each with the withholder's PIN, the certificate number and
--    date, the invoice number as text (leading zeros kept), the invoice net amount and the VAT withheld. The credit is claimed in the VAT return only when the invoice
--    lines add up to the credit amount.
-- 2. Withholding-agent side: the schedule of VAT the client withheld from its suppliers. Each line comes from a purchase invoice (picked from the retained KRA purchases CSV,
--    or entered with the evidence that the invoice carries VAT) and the payment date to the supplier. The rate comes from the effective-dated rule KE_WHTVAT_AGENT on the
--    payment date; no rate is held in the code. The amount is stored to the cent and the KRA layout's whole-shilling rounding is applied only when the file is produced.
-- Both are insert-only: a mistaken certificate line is corrected by rejecting the credit and entering it again, and a schedule line is voided with a reason, never edited.
CREATE TABLE erp_private.wht_vat_certificate_lines(
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 credit_id uuid NOT NULL REFERENCES erp_private.tax_credit_entries(credit_id) ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 withholder_pin text NOT NULL CHECK(withholder_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 withholder_name text NOT NULL CHECK(char_length(btrim(withholder_name)) BETWEEN 2 AND 200),
 certificate_no text NOT NULL CHECK(char_length(btrim(certificate_no)) BETWEEN 1 AND 60),
 certificate_date date NOT NULL,
 invoice_no text NOT NULL CHECK(char_length(btrim(invoice_no)) BETWEEN 1 AND 40),
 invoice_date date NOT NULL,
 invoice_net numeric(16,2) NOT NULL CHECK(invoice_net>0),
 vat_withheld numeric(16,2) NOT NULL CHECK(vat_withheld>0),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 entered_at timestamptz NOT NULL DEFAULT now(),
 CHECK(certificate_date>=invoice_date)
);
CREATE UNIQUE INDEX wht_vat_cert_line_uidx ON erp_private.wht_vat_certificate_lines(credit_id,lower(btrim(invoice_no)),lower(btrim(certificate_no)));
CREATE INDEX wht_vat_cert_credit_idx ON erp_private.wht_vat_certificate_lines(credit_id);
CREATE INDEX wht_vat_cert_client_idx ON erp_private.wht_vat_certificate_lines(client_id,lower(btrim(invoice_no)));
CREATE INDEX wht_vat_cert_project_idx ON erp_private.wht_vat_certificate_lines(project_id);
CREATE INDEX wht_vat_cert_by_idx ON erp_private.wht_vat_certificate_lines(entered_by);

CREATE TABLE erp_private.wht_vat_agent_lines(
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 period_month date NOT NULL CHECK(date_trunc('month',period_month)::date=period_month),
 supplier_pin text NOT NULL CHECK(supplier_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 supplier_name text NOT NULL CHECK(char_length(btrim(supplier_name)) BETWEEN 2 AND 200),
 invoice_no text NOT NULL CHECK(char_length(btrim(invoice_no)) BETWEEN 1 AND 40),
 invoice_date date NOT NULL,
 invoice_net numeric(16,2) NOT NULL CHECK(invoice_net>0),
 payment_date date NOT NULL,
 rate_id uuid NOT NULL REFERENCES erp_private.tax_rates(rate_id) ON DELETE RESTRICT,
 rate numeric(7,3) NOT NULL CHECK(rate>0 AND rate<=100),
 vat_withheld numeric(16,2) NOT NULL CHECK(vat_withheld>=0),
 vat_basis text NOT NULL CHECK(vat_basis IN('KRA purchases CSV','Invoice sighted')),
 csv_line_id uuid REFERENCES erp_private.kra_csv_lines(line_id) ON DELETE RESTRICT,
 evidence_reference text NOT NULL CHECK(char_length(btrim(evidence_reference)) BETWEEN 3 AND 500),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Voided')),
 void_reason text,
 voided_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 voided_at timestamptz,
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(invoice_date<=payment_date),
 CHECK(date_trunc('month',payment_date)::date=period_month),
 CHECK((vat_basis='KRA purchases CSV')=(csv_line_id IS NOT NULL)),
 CHECK(status<>'Voided' OR (void_reason IS NOT NULL AND char_length(btrim(void_reason))>=10 AND voided_by IS NOT NULL AND voided_at IS NOT NULL))
);
-- The same supplier invoice paid on the same day is one line while it is live (the KRA workbook rejects duplicate rows).
CREATE UNIQUE INDEX wht_vat_agent_live_uidx ON erp_private.wht_vat_agent_lines(client_id,supplier_pin,lower(btrim(invoice_no)),payment_date) WHERE status='Active';
CREATE INDEX wht_vat_agent_month_idx ON erp_private.wht_vat_agent_lines(client_id,period_month,status);
CREATE INDEX wht_vat_agent_project_idx ON erp_private.wht_vat_agent_lines(project_id);
CREATE INDEX wht_vat_agent_rate_idx ON erp_private.wht_vat_agent_lines(rate_id);
CREATE INDEX wht_vat_agent_csv_idx ON erp_private.wht_vat_agent_lines(csv_line_id) WHERE csv_line_id IS NOT NULL;
CREATE INDEX wht_vat_agent_by_idx ON erp_private.wht_vat_agent_lines(prepared_by);
CREATE INDEX wht_vat_agent_void_idx ON erp_private.wht_vat_agent_lines(voided_by) WHERE voided_by IS NOT NULL;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['wht_vat_certificate_lines','wht_vat_agent_lines'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN(''INTERN'',''ADMIN''))',t||'_read',t);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
END LOOP; END $$;
GRANT SELECT,INSERT ON erp_private.wht_vat_certificate_lines TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.wht_vat_agent_lines TO erp_api;
CREATE POLICY wht_vat_certificate_lines_insert ON erp_private.wht_vat_certificate_lines FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND entered_by=(erp_private.actor()).staff_id);
CREATE POLICY wht_vat_agent_lines_insert ON erp_private.wht_vat_agent_lines FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND prepared_by=(erp_private.actor()).staff_id);
CREATE POLICY wht_vat_agent_lines_void ON erp_private.wht_vat_agent_lines FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));

-- A certificate line belongs to a live WHT_VAT credit of the same client and engagement that has not yet been claimed in a return.
CREATE FUNCTION erp_private.wht_vat_certificate_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE c erp_private.tax_credit_entries;
BEGIN
 SELECT * INTO c FROM erp_private.tax_credit_entries WHERE credit_id=NEW.credit_id;
 IF c.credit_id IS NULL OR c.credit_type<>'WHT_VAT' THEN RAISE EXCEPTION 'Invoice lines belong to a withholding VAT credit.' USING ERRCODE='23514'; END IF;
 IF c.client_id<>NEW.client_id OR c.project_id<>NEW.project_id THEN RAISE EXCEPTION 'The credit belongs to another client or engagement.' USING ERRCODE='23514'; END IF;
 IF c.status='REJECTED' THEN RAISE EXCEPTION 'A rejected credit is closed.' USING ERRCODE='23514'; END IF;
 IF c.claimed_in_case_id IS NOT NULL THEN RAISE EXCEPTION 'Release the credit from the return before changing the invoices it covers.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wht_vat_certificate_guard BEFORE INSERT ON erp_private.wht_vat_certificate_lines FOR EACH ROW EXECUTE FUNCTION erp_private.wht_vat_certificate_guard();
CREATE FUNCTION erp_private.wht_vat_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A withholding VAT certificate line is never edited. Reject the credit and enter it again.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER wht_vat_certificate_no_update BEFORE UPDATE ON erp_private.wht_vat_certificate_lines FOR EACH ROW EXECUTE FUNCTION erp_private.wht_vat_immutable();

-- A schedule line belongs to the client's project; a CSV line must be a purchases line of the same client; the only change allowed afterwards is voiding it with a reason.
CREATE FUNCTION erp_private.wht_vat_agent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.deleted_at IS NULL AND p.status<>'Archived') THEN RAISE EXCEPTION 'Use the active project of this client.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Active' THEN RAISE EXCEPTION 'A schedule line starts as active.' USING ERRCODE='23514'; END IF;
  IF NEW.csv_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.kra_csv_lines l JOIN erp_private.kra_csv_batches b ON b.batch_id=l.batch_id WHERE l.line_id=NEW.csv_line_id AND l.client_id=NEW.client_id AND b.side='Purchases') THEN RAISE EXCEPTION 'The KRA line must be a purchases line of this client.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Voided' THEN RAISE EXCEPTION 'A voided schedule line is closed.' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.client_id,NEW.project_id,NEW.period_month,NEW.supplier_pin,NEW.supplier_name,NEW.invoice_no,NEW.invoice_date,NEW.invoice_net,NEW.payment_date,NEW.rate_id,NEW.rate,NEW.vat_withheld,NEW.vat_basis,NEW.csv_line_id,NEW.evidence_reference,NEW.prepared_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.period_month,OLD.supplier_pin,OLD.supplier_name,OLD.invoice_no,OLD.invoice_date,OLD.invoice_net,OLD.payment_date,OLD.rate_id,OLD.rate,OLD.vat_withheld,OLD.vat_basis,OLD.csv_line_id,OLD.evidence_reference,OLD.prepared_by,OLD.created_at)
 THEN RAISE EXCEPTION 'A schedule line is never edited: void it with a reason and enter it again.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Voided' THEN RAISE EXCEPTION 'The only change to a schedule line is voiding it.' USING ERRCODE='23514'; END IF;
 IF NEW.voided_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The voiding is recorded against the person who does it.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wht_vat_agent_guard BEFORE INSERT OR UPDATE ON erp_private.wht_vat_agent_lines FOR EACH ROW EXECUTE FUNCTION erp_private.wht_vat_agent_guard();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.wht_vat_agent_lines FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('line_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.wht_vat_certificate_lines FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('line_id');
REVOKE ALL ON FUNCTION erp_private.wht_vat_certificate_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.wht_vat_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.wht_vat_agent_guard() FROM PUBLIC,anon,authenticated;
