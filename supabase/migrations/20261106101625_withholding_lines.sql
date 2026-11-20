-- Withholding tax lines. One line is one payment that tax was withheld from: either a purchase row (professional fees, contractual fees and
-- similar, entered on the purchases screen) or a schedule entry for payments that are not purchases (dividends, interest, royalties, rent to
-- non-residents and the like). The monthly withholding return and the withholding journal read these lines, so nothing is counted twice.
CREATE TABLE erp_private.withholding_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES erp_private.projects(project_id),
  client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
  source text NOT NULL CHECK (source IN ('Purchase row','Schedule')),
  row_id uuid REFERENCES erp_private.workbook_rows(row_id),
  payee_name text NOT NULL CHECK (length(btrim(payee_name)) > 0 AND length(payee_name) <= 200),
  payee_pin text NOT NULL DEFAULT '' CHECK (length(payee_pin) <= 20),
  payee_residency text NOT NULL CHECK (payee_residency IN ('Resident','Non-resident')),
  payment_date date NOT NULL,
  payment_code text NOT NULL,
  payment_label text NOT NULL,
  rate_id uuid,
  rate numeric(7,3) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  rate_status text NOT NULL,
  taxable_amount numeric(14,2) NOT NULL CHECK (taxable_amount > 0),
  tax_withheld numeric(14,2) NOT NULL CHECK (tax_withheld >= 0),
  invoice_reference text NOT NULL DEFAULT '' CHECK (length(invoice_reference) <= 100),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) >= 3 AND length(evidence_reference) <= 500),
  eligibility_confirmed boolean NOT NULL CHECK (eligibility_confirmed),
  counter_account text,
  certificate_issued boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Voided')),
  void_reason text,
  voided_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  journal_id uuid REFERENCES erp_private.ledger_journals(journal_id),
  prepared_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source <> 'Purchase row' OR row_id IS NOT NULL),
  CHECK (status <> 'Voided' OR (void_reason IS NOT NULL AND voided_by IS NOT NULL))
);
-- A purchase row has at most one live withholding line.
CREATE UNIQUE INDEX withholding_lines_row_live ON erp_private.withholding_lines(row_id) WHERE row_id IS NOT NULL AND status = 'Active';
CREATE INDEX withholding_lines_project_idx ON erp_private.withholding_lines(project_id, payment_date) WHERE status = 'Active';
CREATE INDEX withholding_lines_client_idx ON erp_private.withholding_lines(client_id);
CREATE INDEX withholding_lines_prepared_idx ON erp_private.withholding_lines(prepared_by);
CREATE INDEX withholding_lines_voided_idx ON erp_private.withholding_lines(voided_by) WHERE voided_by IS NOT NULL;
CREATE INDEX withholding_lines_journal_idx ON erp_private.withholding_lines(journal_id) WHERE journal_id IS NOT NULL;

-- Once a line is in a journal its figures are fixed; only the certificate flag may change. Correct it with a reversal.
CREATE FUNCTION erp_private.withholding_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = erp_private, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  IF OLD.journal_id IS NOT NULL AND (
       NEW.status IS DISTINCT FROM OLD.status OR NEW.taxable_amount IS DISTINCT FROM OLD.taxable_amount OR NEW.tax_withheld IS DISTINCT FROM OLD.tax_withheld
       OR NEW.rate IS DISTINCT FROM OLD.rate OR NEW.payment_code IS DISTINCT FROM OLD.payment_code OR NEW.payment_date IS DISTINCT FROM OLD.payment_date
       OR NEW.journal_id IS DISTINCT FROM OLD.journal_id OR NEW.counter_account IS DISTINCT FROM OLD.counter_account) THEN
    RAISE EXCEPTION 'This withholding line is in a journal. Correct it with a reversal.' USING ERRCODE = '42501';
  END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.source IS DISTINCT FROM OLD.source OR NEW.row_id IS DISTINCT FROM OLD.row_id THEN
    RAISE EXCEPTION 'The project and source of a withholding line cannot change.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER withholding_line_guard BEFORE UPDATE ON erp_private.withholding_lines FOR EACH ROW EXECUTE FUNCTION erp_private.withholding_line_guard();

ALTER TABLE erp_private.withholding_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.withholding_lines FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON erp_private.withholding_lines TO erp_api;
CREATE POLICY withholding_lines_select ON erp_private.withholding_lines FOR SELECT TO erp_api
  USING (erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code <> 'INTERN');
CREATE POLICY withholding_lines_insert ON erp_private.withholding_lines FOR INSERT TO erp_api
  WITH CHECK (erp_private.project_allowed(project_id) AND prepared_by = (erp_private.actor()).staff_id AND (erp_private.actor()).category_code <> 'INTERN');
CREATE POLICY withholding_lines_update ON erp_private.withholding_lines FOR UPDATE TO erp_api
  USING (erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code <> 'INTERN')
  WITH CHECK (erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code <> 'INTERN');
