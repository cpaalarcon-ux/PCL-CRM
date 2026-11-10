-- PCL CRM / ERP tax compliance workflow expansion
-- Additive migration for the existing Engagement -> Tax Project -> Period ->
-- Obligation model. It does not create a parallel UUID-based tax application.
-- Apply only through a reviewed database migration after API changes are ready.
-- New tables are server-only: RLS is enabled and no direct client policies are
-- granted. Never place a Supabase service-role key in browser code.

BEGIN;

-- Controlled obligation dictionary. Statutory due-date rules remain configurable
-- in the obligation profile; the labels below are not a substitute for legal review.
CREATE TABLE IF NOT EXISTS tax_obligation_types (
  obligation_code TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  periodicity TEXT NOT NULL CHECK (periodicity IN ('MONTHLY','ANNUAL')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

INSERT INTO tax_obligation_types (obligation_code, display_name, periodicity)
VALUES
  ('VAT','Value Added Tax','MONTHLY'),
  ('PAYE','Pay As You Earn','MONTHLY'),
  ('WHT','Withholding Tax','MONTHLY'),
  ('INCOME_TAX','Income Tax','ANNUAL')
ON CONFLICT (obligation_code) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tax_project_obligations_type_master_fk'
      AND conrelid = 'tax_project_obligations'::regclass
  ) THEN
    ALTER TABLE tax_project_obligations
      ADD CONSTRAINT tax_project_obligations_type_master_fk
      FOREIGN KEY (tax_type) REFERENCES tax_obligation_types(obligation_code)
      ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$;

-- One tax compliance engagement can be assigned to each client/firm financial
-- year. Explicit dates support non-calendar financial years.
CREATE UNIQUE INDEX IF NOT EXISTS engagements_tax_year_parent_key
  ON engagements (engagement_id, client_id, handling_firm_id);

CREATE TABLE IF NOT EXISTS tax_compliance_years (
  tax_compliance_year_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL,
  client_id BIGINT NOT NULL,
  handling_firm_id BIGINT NOT NULL,
  financial_year INTEGER NOT NULL CHECK (financial_year BETWEEN 1900 AND 2200),
  financial_year_start DATE NOT NULL,
  financial_year_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','ARCHIVED')),
  created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (financial_year_end >= financial_year_start),
  UNIQUE (client_id, handling_firm_id, financial_year),
  UNIQUE (tax_compliance_year_id, engagement_id, client_id, handling_firm_id),
  FOREIGN KEY (engagement_id, client_id, handling_firm_id)
    REFERENCES engagements (engagement_id, client_id, handling_firm_id) ON DELETE RESTRICT
);

ALTER TABLE tax_period_projects
  ADD COLUMN IF NOT EXISTS tax_compliance_year_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tax_period_projects_compliance_year_fk'
      AND conrelid = 'tax_period_projects'::regclass
  ) THEN
    ALTER TABLE tax_period_projects
      ADD CONSTRAINT tax_period_projects_compliance_year_fk
      FOREIGN KEY (tax_compliance_year_id, engagement_id, client_id, handling_firm_id)
      REFERENCES tax_compliance_years
        (tax_compliance_year_id, engagement_id, client_id, handling_firm_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tax_period_projects_compliance_year_idx
  ON tax_period_projects (tax_compliance_year_id, period_start, period_end);

CREATE OR REPLACE FUNCTION validate_tax_period_compliance_year()
RETURNS TRIGGER LANGUAGE plpgsql AS $
DECLARE
  year_start DATE;
  year_end DATE;
BEGIN
  IF NEW.tax_compliance_year_id IS NULL THEN RETURN NEW; END IF;
  SELECT financial_year_start, financial_year_end INTO year_start, year_end
  FROM tax_compliance_years WHERE tax_compliance_year_id = NEW.tax_compliance_year_id;
  IF year_start IS NULL OR NEW.period_start < year_start OR NEW.period_end > year_end THEN
    RAISE EXCEPTION 'Tax period dates must fall within the linked client financial year.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS tax_period_projects_compliance_year_dates ON tax_period_projects;
CREATE TRIGGER tax_period_projects_compliance_year_dates
BEFORE INSERT OR UPDATE OF tax_compliance_year_id, period_start, period_end
ON tax_period_projects
FOR EACH ROW EXECUTE FUNCTION validate_tax_period_compliance_year();

-- Aggregate credit reconciliation is obligation-specific. Only reviewed,
-- applied values enter a tax computation. Credit notes are adjustments to VAT
-- output/input tax, not free-standing generic credits.
CREATE TABLE IF NOT EXISTS tax_credit_entries (
  tax_credit_entry_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL
    REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  credit_type TEXT NOT NULL CHECK (credit_type IN (
    'WITHHOLDING_VAT',
    'WITHHOLDING_INCOME_TAX',
    'INSTALMENT_TAX',
    'CREDIT_BROUGHT_FORWARD',
    'OTHER_TAX_CREDIT'
  )),
  erp_entered_amount NUMERIC(16,2) NOT NULL CHECK (erp_entered_amount >= 0),
  itax_confirmed_amount NUMERIC(16,2),
  variance_amount NUMERIC(16,2) GENERATED ALWAYS AS (
    CASE WHEN itax_confirmed_amount IS NULL THEN NULL
         ELSE round(itax_confirmed_amount - erp_entered_amount, 2) END
  ) STORED,
  applied_amount NUMERIC(16,2),
  verification_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (verification_status IN ('PENDING','DISPUTED','RECONCILED','MANAGER_APPROVED','REJECTED')),
  external_reference TEXT,
  evidence_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  entered_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CHECK (itax_confirmed_amount IS NULL OR itax_confirmed_amount >= 0),
  CHECK (applied_amount IS NULL OR applied_amount >= 0),
  CHECK (
    (verification_status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL AND applied_amount IS NULL)
    OR (verification_status = 'DISPUTED' AND itax_confirmed_amount IS NOT NULL AND variance_amount <> 0 AND reviewed_by_user_id IS NULL AND applied_amount IS NULL)
    OR (verification_status = 'RECONCILED' AND itax_confirmed_amount IS NOT NULL AND variance_amount = 0 AND applied_amount IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (verification_status = 'MANAGER_APPROVED' AND itax_confirmed_amount IS NOT NULL AND variance_amount <> 0 AND applied_amount IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(COALESCE(review_note,''))) > 0)
    OR (verification_status = 'REJECTED' AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(COALESCE(review_note,''))) > 0)
  )
);

CREATE INDEX IF NOT EXISTS tax_credit_entries_obligation_status_idx
  ON tax_credit_entries (tax_project_obligation_id, verification_status, credit_type);

CREATE OR REPLACE FUNCTION protect_reviewed_tax_credit_entry()
RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tax credit records are retained for audit; enter a correcting credit instead.';
  END IF;
  IF OLD.verification_status IN ('RECONCILED','MANAGER_APPROVED','REJECTED')
     AND (NEW.tax_project_obligation_id IS DISTINCT FROM OLD.tax_project_obligation_id
       OR NEW.credit_type IS DISTINCT FROM OLD.credit_type
       OR NEW.erp_entered_amount IS DISTINCT FROM OLD.erp_entered_amount
       OR NEW.itax_confirmed_amount IS DISTINCT FROM OLD.itax_confirmed_amount
       OR NEW.applied_amount IS DISTINCT FROM OLD.applied_amount
       OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
       OR NEW.evidence_document_id IS DISTINCT FROM OLD.evidence_document_id) THEN
    RAISE EXCEPTION 'A reviewed tax credit is immutable; enter a correcting credit and link the history.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS tax_credit_entries_reviewed_immutable ON tax_credit_entries;
CREATE TRIGGER tax_credit_entries_reviewed_immutable
BEFORE UPDATE OR DELETE ON tax_credit_entries
FOR EACH ROW EXECUTE FUNCTION protect_reviewed_tax_credit_entry();

CREATE TABLE IF NOT EXISTS tax_credit_entry_events (
  tax_credit_entry_event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_credit_entry_id BIGINT NOT NULL
    REFERENCES tax_credit_entries(tax_credit_entry_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ENTERED','ITAX_CONFIRMED','RECONCILED','DISPUTED','MANAGER_APPROVED','REJECTED','CORRECTED'
  )),
  event_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_tax_credit_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tax credit history is append-only; create a correction event instead.';
END;
$$;

DROP TRIGGER IF EXISTS tax_credit_events_append_only ON tax_credit_entry_events;
CREATE TRIGGER tax_credit_events_append_only
BEFORE UPDATE OR DELETE ON tax_credit_entry_events
FOR EACH ROW EXECUTE FUNCTION prevent_tax_credit_event_mutation();

CREATE OR REPLACE FUNCTION validate_tax_credit_entry()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  obligation_tax_type TEXT;
  reviewer_level SMALLINT;
BEGIN
  SELECT tax_type INTO obligation_tax_type
  FROM tax_project_obligations
  WHERE tax_project_obligation_id = NEW.tax_project_obligation_id;

  IF obligation_tax_type IS NULL THEN
    RAISE EXCEPTION 'Tax obligation was not found.';
  END IF;

  IF NEW.credit_type = 'WITHHOLDING_VAT' AND obligation_tax_type <> 'VAT' THEN
    RAISE EXCEPTION 'Withholding VAT credits can only be recorded against a VAT obligation.';
  END IF;
  IF NEW.credit_type IN ('WITHHOLDING_INCOME_TAX','INSTALMENT_TAX')
     AND obligation_tax_type <> 'INCOME_TAX' THEN
    RAISE EXCEPTION 'Income-tax withholding and instalment credits can only be recorded against an Income Tax obligation.';
  END IF;
  IF NEW.credit_type = 'CREDIT_BROUGHT_FORWARD' AND obligation_tax_type NOT IN ('VAT','INCOME_TAX') THEN
    RAISE EXCEPTION 'Brought-forward credits are enabled only for VAT and Income Tax in this workflow.';
  END IF;
  IF NEW.credit_type = 'OTHER_TAX_CREDIT' AND obligation_tax_type NOT IN ('VAT','INCOME_TAX') THEN
    RAISE EXCEPTION 'Other tax credits are not enabled for this obligation type.';
  END IF;

  IF NEW.verification_status IN ('RECONCILED','MANAGER_APPROVED','REJECTED') THEN
    IF NEW.reviewed_by_user_id = NEW.entered_by_user_id THEN
      RAISE EXCEPTION 'Credit entry review must be performed by a different user.';
    END IF;
    IF NEW.evidence_document_id IS NULL AND length(trim(COALESCE(NEW.external_reference,''))) = 0 THEN
      RAISE EXCEPTION 'Credit review requires a document or iTax reference.';
    END IF;
  END IF;

  IF NEW.verification_status = 'RECONCILED'
     AND NEW.applied_amount IS DISTINCT FROM NEW.itax_confirmed_amount THEN
    RAISE EXCEPTION 'A reconciled credit must apply the iTax-confirmed amount.';
  END IF;

  IF NEW.verification_status = 'MANAGER_APPROVED' THEN
    SELECT r.hierarchy_level INTO reviewer_level
    FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.reviewed_by_user_id AND u.is_active;
    IF reviewer_level IS NULL OR reviewer_level > 2 THEN
      RAISE EXCEPTION 'Only an active Manager or Partner may approve a credit variance.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_credit_entries_validate ON tax_credit_entries;
CREATE TRIGGER tax_credit_entries_validate
BEFORE INSERT OR UPDATE ON tax_credit_entries
FOR EACH ROW EXECUTE FUNCTION validate_tax_credit_entry();

-- Source totals are written by the authenticated server importer, tied to the
-- accepted batch and its hash. Raw workbook rows stay in the existing import
-- pipeline; this table contains only the summarized tax inputs used in snapshots.
CREATE TABLE IF NOT EXISTS tax_obligation_source_totals (
  tax_obligation_source_total_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL
    REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  tax_upload_batch_id BIGINT NOT NULL
    REFERENCES tax_upload_batches(tax_upload_batch_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'SALES_ETIMS_Z','PURCHASES_ETIMS','BANK_STATEMENT','PAYROLL_INPUT','WHT_SCHEDULE','TB_SCHEDULES'
  )),
  taxable_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (taxable_amount >= 0),
  gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  output_tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (output_tax_amount >= 0),
  deductible_input_tax_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (deductible_input_tax_amount >= 0),
  source_row_count INTEGER NOT NULL DEFAULT 0 CHECK (source_row_count >= 0),
  source_hash TEXT NOT NULL,
  recorded_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tax_project_obligation_id, tax_upload_batch_id)
);

CREATE INDEX IF NOT EXISTS tax_obligation_source_totals_period_idx
  ON tax_obligation_source_totals (tax_project_obligation_id, source_type, recorded_at DESC);

CREATE OR REPLACE FUNCTION validate_tax_obligation_source_total()
RETURNS TRIGGER LANGUAGE plpgsql AS $
DECLARE
  batch_obligation_id BIGINT;
  batch_source_type TEXT;
  batch_status TEXT;
BEGIN
  SELECT tax_project_obligation_id, source_type, status
    INTO batch_obligation_id, batch_source_type, batch_status
  FROM tax_upload_batches WHERE tax_upload_batch_id = NEW.tax_upload_batch_id;
  IF batch_obligation_id IS DISTINCT FROM NEW.tax_project_obligation_id
     OR batch_source_type IS DISTINCT FROM NEW.source_type
     OR batch_status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'Source totals must match an accepted upload batch for the same obligation and source.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS tax_obligation_source_totals_validate ON tax_obligation_source_totals;
CREATE TRIGGER tax_obligation_source_totals_validate
BEFORE INSERT OR UPDATE ON tax_obligation_source_totals
FOR EACH ROW EXECUTE FUNCTION validate_tax_obligation_source_total();

-- Credit notes are recorded as signed VAT adjustments with evidence and reviewer
-- approval. Output VAT credit notes reduce net VAT; input VAT credit notes reverse
-- a previously claimed deduction and therefore increase net VAT payable.
CREATE TABLE IF NOT EXISTS tax_period_adjustments (
  tax_period_adjustment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL
    REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN (
    'OUTPUT_VAT_CREDIT_NOTE','INPUT_VAT_CREDIT_NOTE','OTHER_VAT_ADJUSTMENT'
  )),
  signed_amount NUMERIC(16,2) NOT NULL,
  source_reference TEXT NOT NULL,
  effective_date DATE NOT NULL,
  reason TEXT NOT NULL,
  evidence_document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  entered_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  CHECK ((adjustment_type = 'OUTPUT_VAT_CREDIT_NOTE' AND signed_amount <= 0)
      OR (adjustment_type = 'INPUT_VAT_CREDIT_NOTE' AND signed_amount >= 0)
      OR adjustment_type = 'OTHER_VAT_ADJUSTMENT'),
  CHECK ((status = 'PENDING' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
      OR (status IN ('APPROVED','REJECTED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL AND length(trim(COALESCE(review_note,''))) > 0))
);

CREATE INDEX IF NOT EXISTS tax_period_adjustments_obligation_status_idx
  ON tax_period_adjustments (tax_project_obligation_id, status, adjustment_type);

CREATE OR REPLACE FUNCTION validate_tax_period_adjustment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  obligation_tax_type TEXT;
  reviewer_level SMALLINT;
BEGIN
  SELECT tax_type INTO obligation_tax_type
  FROM tax_project_obligations
  WHERE tax_project_obligation_id = NEW.tax_project_obligation_id;

  IF obligation_tax_type <> 'VAT' THEN
    RAISE EXCEPTION 'Credit-note and VAT adjustments require a VAT obligation.';
  END IF;
  IF NEW.status IN ('APPROVED','REJECTED') THEN
    IF NEW.reviewed_by_user_id = NEW.entered_by_user_id THEN
      RAISE EXCEPTION 'Adjustment review must be performed by a different user.';
    END IF;
    SELECT r.hierarchy_level INTO reviewer_level
    FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.reviewed_by_user_id AND u.is_active;
    IF reviewer_level IS NULL OR reviewer_level > 2 THEN
      RAISE EXCEPTION 'Only an active Manager or Partner may approve or reject a VAT adjustment.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_period_adjustments_validate ON tax_period_adjustments;
CREATE TRIGGER tax_period_adjustments_validate
BEFORE INSERT OR UPDATE ON tax_period_adjustments
FOR EACH ROW EXECUTE FUNCTION validate_tax_period_adjustment();

CREATE OR REPLACE FUNCTION prevent_approved_tax_adjustment_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tax adjustments are retained for audit; enter a correcting adjustment instead.';
  END IF;
  IF OLD.status IN ('APPROVED','REJECTED') THEN
    RAISE EXCEPTION 'Reviewed tax adjustments are immutable; enter a correcting adjustment.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS tax_period_adjustments_immutable_review ON tax_period_adjustments;
CREATE TRIGGER tax_period_adjustments_immutable_review
BEFORE UPDATE OR DELETE ON tax_period_adjustments
FOR EACH ROW EXECUTE FUNCTION prevent_approved_tax_adjustment_mutation();

-- Each calculation run is an immutable, versioned snapshot. The server records
-- the exact accepted source batch hashes and approved credits used. VAT is capped
-- at zero payable; any excess eligible credits are kept as a separate balance.
CREATE TABLE IF NOT EXISTS tax_computation_snapshots (
  tax_computation_snapshot_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL
    REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  snapshot_no INTEGER NOT NULL CHECK (snapshot_no > 0),
  formula_version TEXT NOT NULL,
  source_manifest JSONB NOT NULL,
  inputs_payload JSONB NOT NULL,
  results_payload JSONB NOT NULL,
  output_vat_amount NUMERIC(16,2) CHECK (output_vat_amount >= 0),
  deductible_input_vat_amount NUMERIC(16,2) CHECK (deductible_input_vat_amount >= 0),
  approved_vat_credits_applied NUMERIC(16,2) CHECK (approved_vat_credits_applied >= 0),
  approved_vat_adjustments NUMERIC(16,2),
  vat_payable NUMERIC(16,2) CHECK (vat_payable >= 0),
  vat_excess_credit NUMERIC(16,2) CHECK (vat_excess_credit >= 0),
  review_status TEXT NOT NULL DEFAULT 'PREPARED'
    CHECK (review_status IN ('PREPARED','REVIEWED','APPROVED')),
  computed_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  UNIQUE (tax_project_obligation_id, snapshot_no),
  CHECK ((vat_payable IS NULL AND vat_excess_credit IS NULL)
      OR (vat_payable IS NOT NULL AND vat_excess_credit IS NOT NULL AND NOT (vat_payable > 0 AND vat_excess_credit > 0))),
  CHECK ((review_status = 'PREPARED' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
      OR (review_status IN ('REVIEWED','APPROVED') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS tax_computation_snapshots_obligation_idx
  ON tax_computation_snapshots (tax_project_obligation_id, snapshot_no DESC);

CREATE OR REPLACE FUNCTION validate_tax_computation_snapshot()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  obligation_tax_type TEXT;
  reviewer_level SMALLINT;
BEGIN
  SELECT tax_type INTO obligation_tax_type
  FROM tax_project_obligations
  WHERE tax_project_obligation_id = NEW.tax_project_obligation_id;

  IF NEW.output_vat_amount IS NOT NULL AND obligation_tax_type <> 'VAT' THEN
    RAISE EXCEPTION 'VAT calculation fields can only be used for a VAT obligation.';
  END IF;
  IF NEW.review_status IN ('REVIEWED','APPROVED') THEN
    IF NEW.reviewed_by_user_id = NEW.computed_by_user_id THEN
      RAISE EXCEPTION 'A tax computation must be reviewed by a different user.';
    END IF;
    IF NEW.review_status = 'APPROVED' THEN
      SELECT r.hierarchy_level INTO reviewer_level
      FROM users u JOIN roles r ON r.role_id = u.role_id
      WHERE u.user_id = NEW.reviewed_by_user_id AND u.is_active;
      IF reviewer_level IS NULL OR reviewer_level > 2 THEN
        RAISE EXCEPTION 'Only an active Manager or Partner may approve a tax computation.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_computation_snapshots_validate ON tax_computation_snapshots;
CREATE TRIGGER tax_computation_snapshots_validate
BEFORE INSERT OR UPDATE ON tax_computation_snapshots
FOR EACH ROW EXECUTE FUNCTION validate_tax_computation_snapshot();

CREATE OR REPLACE FUNCTION protect_tax_computation_snapshot_inputs()
RETURNS TRIGGER LANGUAGE plpgsql AS $
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tax computation snapshots are retained for audit; create a new version instead.';
  END IF;
  IF NEW.tax_project_obligation_id IS DISTINCT FROM OLD.tax_project_obligation_id
     OR NEW.snapshot_no IS DISTINCT FROM OLD.snapshot_no
     OR NEW.formula_version IS DISTINCT FROM OLD.formula_version
     OR NEW.source_manifest IS DISTINCT FROM OLD.source_manifest
     OR NEW.inputs_payload IS DISTINCT FROM OLD.inputs_payload
     OR NEW.results_payload IS DISTINCT FROM OLD.results_payload
     OR NEW.output_vat_amount IS DISTINCT FROM OLD.output_vat_amount
     OR NEW.deductible_input_vat_amount IS DISTINCT FROM OLD.deductible_input_vat_amount
     OR NEW.approved_vat_credits_applied IS DISTINCT FROM OLD.approved_vat_credits_applied
     OR NEW.approved_vat_adjustments IS DISTINCT FROM OLD.approved_vat_adjustments
     OR NEW.vat_payable IS DISTINCT FROM OLD.vat_payable
     OR NEW.vat_excess_credit IS DISTINCT FROM OLD.vat_excess_credit
     OR NEW.computed_by_user_id IS DISTINCT FROM OLD.computed_by_user_id
     OR NEW.computed_at IS DISTINCT FROM OLD.computed_at THEN
    RAISE EXCEPTION 'Calculation inputs and outputs are immutable; create a new snapshot version.';
  END IF;
  IF OLD.review_status = 'PREPARED' AND NEW.review_status NOT IN ('PREPARED','REVIEWED') THEN
    RAISE EXCEPTION 'Review a prepared computation before approving it.';
  END IF;
  IF OLD.review_status = 'REVIEWED' AND NEW.review_status NOT IN ('REVIEWED','APPROVED') THEN
    RAISE EXCEPTION 'A reviewed computation can only be approved.';
  END IF;
  IF OLD.review_status = 'APPROVED' AND NEW.review_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'An approved computation is immutable; prepare a new version.';
  END IF;
  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS tax_computation_snapshots_inputs_immutable ON tax_computation_snapshots;
CREATE TRIGGER tax_computation_snapshots_inputs_immutable
BEFORE UPDATE OR DELETE ON tax_computation_snapshots
FOR EACH ROW EXECUTE FUNCTION protect_tax_computation_snapshot_inputs();

-- Filing records may remain pending acknowledgment after iTax submission, but a
-- period cannot be marked FILED/locked until the PDF is attached or a Manager or
-- Partner records a reasoned exception. The original filing remains immutable;
-- amendments create new periods and link their filings to the original submission.
ALTER TABLE tax_filing_submissions
  ADD COLUMN IF NOT EXISTS evidence_status TEXT NOT NULL DEFAULT 'PENDING_ACKNOWLEDGEMENT',
  ADD COLUMN IF NOT EXISTS manager_exception_reason TEXT,
  ADD COLUMN IF NOT EXISTS exception_approved_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS exception_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_filing_submission_id BIGINT REFERENCES tax_filing_submissions(tax_filing_submission_id) ON DELETE RESTRICT;

UPDATE tax_filing_submissions
SET evidence_status = 'ACKNOWLEDGEMENT_RECEIVED'
WHERE acknowledgement_document_id IS NOT NULL
  AND evidence_status = 'PENDING_ACKNOWLEDGEMENT';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tax_filing_submissions_evidence_state_ck'
      AND conrelid = 'tax_filing_submissions'::regclass
  ) THEN
    ALTER TABLE tax_filing_submissions
      ADD CONSTRAINT tax_filing_submissions_evidence_state_ck CHECK (
        (evidence_status = 'PENDING_ACKNOWLEDGEMENT'
          AND acknowledgement_document_id IS NULL
          AND manager_exception_reason IS NULL
          AND exception_approved_by_user_id IS NULL
          AND exception_approved_at IS NULL)
        OR
        (evidence_status = 'ACKNOWLEDGEMENT_RECEIVED'
          AND acknowledgement_document_id IS NOT NULL
          AND manager_exception_reason IS NULL
          AND exception_approved_by_user_id IS NULL
          AND exception_approved_at IS NULL)
        OR
        (evidence_status = 'MANAGER_EXCEPTION'
          AND acknowledgement_document_id IS NULL
          AND length(trim(COALESCE(manager_exception_reason,''))) > 0
          AND exception_approved_by_user_id IS NOT NULL
          AND exception_approved_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tax_filing_original_submission_once_idx
  ON tax_filing_submissions (original_filing_submission_id)
  WHERE original_filing_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_tax_filing_evidence_and_amendment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  approver_level SMALLINT;
  period_parent_id BIGINT;
  period_status TEXT;
  period_locked_at TIMESTAMPTZ;
  original_period_id BIGINT;
  original_obligation_type TEXT;
  new_obligation_type TEXT;
  original_period_start DATE;
  original_period_end DATE;
  new_period_start DATE;
  new_period_end DATE;
BEGIN
  IF NEW.evidence_status = 'ACKNOWLEDGEMENT_RECEIVED'
     AND NEW.acknowledgement_document_id IS NULL THEN
    RAISE EXCEPTION 'Attach the KRA acknowledgement PDF before marking evidence received.';
  END IF;
  IF NEW.evidence_status = 'MANAGER_EXCEPTION' THEN
    SELECT r.hierarchy_level INTO approver_level
    FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.exception_approved_by_user_id AND u.is_active;
    IF approver_level IS NULL OR approver_level > 2 THEN
      RAISE EXCEPTION 'Only an active Manager or Partner may approve missing-acknowledgment evidence.';
    END IF;
    IF NEW.exception_approved_by_user_id = NEW.filed_by_user_id THEN
      RAISE EXCEPTION 'The filer cannot approve their own missing-acknowledgment exception.';
    END IF;
  END IF;

  SELECT p.tax_period_project_id, p.status, p.locked_at, p.amended_from_tax_period_project_id,
         p.period_start, p.period_end, o.tax_type
    INTO period_parent_id, period_status, period_locked_at, original_period_id,
         new_period_start, new_period_end, new_obligation_type
  FROM tax_project_obligations o
  JOIN tax_period_projects p ON p.tax_period_project_id = o.tax_period_project_id
  WHERE o.tax_project_obligation_id = NEW.tax_project_obligation_id;

  IF period_parent_id IS DISTINCT FROM NEW.tax_period_project_id THEN
    RAISE EXCEPTION 'Filing submission and obligation must belong to the same tax period.';
  END IF;

  IF period_locked_at IS NOT NULL AND TG_OP = 'UPDATE'
     AND (NEW.filing_reference IS DISTINCT FROM OLD.filing_reference
       OR NEW.filing_date IS DISTINCT FROM OLD.filing_date
       OR NEW.acknowledgement_document_id IS DISTINCT FROM OLD.acknowledgement_document_id
       OR NEW.evidence_status IS DISTINCT FROM OLD.evidence_status
       OR NEW.original_filing_submission_id IS DISTINCT FROM OLD.original_filing_submission_id) THEN
    RAISE EXCEPTION 'A locked filing cannot be edited; use a controlled amendment.';
  END IF;

  IF original_period_id IS NOT NULL AND NEW.original_filing_submission_id IS NULL THEN
    RAISE EXCEPTION 'An amendment filing must link to the original filed submission.';
  END IF;

  IF NEW.original_filing_submission_id IS NOT NULL THEN
    SELECT op.tax_period_project_id, op.period_start, op.period_end, oo.tax_type
      INTO period_parent_id, original_period_start, original_period_end, original_obligation_type
    FROM tax_filing_submissions fs
    JOIN tax_project_obligations oo ON oo.tax_project_obligation_id = fs.tax_project_obligation_id
    JOIN tax_period_projects op ON op.tax_period_project_id = fs.tax_period_project_id
    WHERE fs.tax_filing_submission_id = NEW.original_filing_submission_id
      AND fs.evidence_status IN ('ACKNOWLEDGEMENT_RECEIVED','MANAGER_EXCEPTION');

    IF period_parent_id IS DISTINCT FROM original_period_id
       OR original_obligation_type IS DISTINCT FROM new_obligation_type
       OR original_period_start IS DISTINCT FROM new_period_start
       OR original_period_end IS DISTINCT FROM new_period_end THEN
      RAISE EXCEPTION 'Amendment filing must link to the matching original obligation and period.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_filing_submissions_evidence_guard ON tax_filing_submissions;
CREATE TRIGGER tax_filing_submissions_evidence_guard
BEFORE INSERT OR UPDATE ON tax_filing_submissions
FOR EACH ROW EXECUTE FUNCTION validate_tax_filing_evidence_and_amendment();

CREATE OR REPLACE FUNCTION enforce_tax_period_filing_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  obligation_count INTEGER;
  incomplete_count INTEGER;
BEGIN
  IF NEW.status = 'FILED' AND NEW.locked_at IS NOT NULL
     AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.locked_at IS NULL) THEN
    SELECT count(*) INTO obligation_count
    FROM tax_project_obligations
    WHERE tax_period_project_id = NEW.tax_period_project_id
      AND status <> 'NOT_APPLICABLE';

    SELECT count(*) INTO incomplete_count
    FROM tax_project_obligations o
    WHERE o.tax_period_project_id = NEW.tax_period_project_id
      AND o.status <> 'NOT_APPLICABLE'
      AND (o.status <> 'FILED' OR NOT EXISTS (
        SELECT 1 FROM tax_filing_submissions fs
        WHERE fs.tax_project_obligation_id = o.tax_project_obligation_id
          AND fs.tax_period_project_id = NEW.tax_period_project_id
          AND fs.evidence_status IN ('ACKNOWLEDGEMENT_RECEIVED','MANAGER_EXCEPTION')
      ));

    IF obligation_count = 0 OR incomplete_count > 0 THEN
      RAISE EXCEPTION 'A tax period cannot be locked until each applicable obligation is filed and has acknowledgment evidence or an approved Manager exception.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_period_projects_filing_lock_guard ON tax_period_projects;
CREATE TRIGGER tax_period_projects_filing_lock_guard
BEFORE UPDATE OF status, locked_at ON tax_period_projects
FOR EACH ROW EXECUTE FUNCTION enforce_tax_period_filing_lock();

CREATE OR REPLACE FUNCTION protect_locked_tax_period_identity()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.handling_firm_id IS DISTINCT FROM OLD.handling_firm_id
       OR NEW.period_kind IS DISTINCT FROM OLD.period_kind
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.revision_no IS DISTINCT FROM OLD.revision_no
       OR NEW.amended_from_tax_period_project_id IS DISTINCT FROM OLD.amended_from_tax_period_project_id
       OR NEW.locked_at IS DISTINCT FROM OLD.locked_at
       OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status = 'FILED' AND NEW.status = 'AMENDED')) THEN
      RAISE EXCEPTION 'A filed tax period is locked; make a controlled amendment instead.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_period_projects_locked_identity_guard ON tax_period_projects;
CREATE TRIGGER tax_period_projects_locked_identity_guard
BEFORE UPDATE ON tax_period_projects
FOR EACH ROW EXECUTE FUNCTION protect_locked_tax_period_identity();

-- Billable support services use approved prices and the existing invoice ledger.
-- Closing a ticket does not create a tax invoice unless the approved fee and the
-- required engagement are present; no second invoice numbering system is added.
CREATE TABLE IF NOT EXISTS support_services (
  support_service_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_code TEXT NOT NULL UNIQUE,
  service_name TEXT NOT NULL UNIQUE,
  is_billable BOOLEAN NOT NULL DEFAULT FALSE,
  default_fee NUMERIC(16,2) CHECK (default_fee IS NULL OR default_fee >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  effective_from DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS support_ticket_billing (
  support_ticket_billing_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL UNIQUE REFERENCES tickets(ticket_id) ON DELETE RESTRICT,
  support_service_id BIGINT NOT NULL REFERENCES support_services(support_service_id) ON DELETE RESTRICT,
  is_billable BOOLEAN NOT NULL,
  quoted_fee NUMERIC(16,2) CHECK (quoted_fee IS NULL OR quoted_fee >= 0),
  approved_fee NUMERIC(16,2) CHECK (approved_fee IS NULL OR approved_fee >= 0),
  billing_status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (billing_status IN ('NON_BILLABLE','PENDING_APPROVAL','APPROVED','READY_FOR_INVOICE','INVOICED','CANCELLED')),
  approved_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  approved_at TIMESTAMPTZ,
  invoice_id BIGINT UNIQUE REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
  billing_note TEXT,
  created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (NOT is_billable AND billing_status = 'NON_BILLABLE' AND approved_fee IS NULL AND invoice_id IS NULL)
    OR
    (is_billable AND billing_status <> 'NON_BILLABLE')
  ),
  CHECK (
    (billing_status = 'PENDING_APPROVAL' AND approved_by_user_id IS NULL AND approved_at IS NULL)
    OR billing_status = 'CANCELLED'
    OR (billing_status IN ('APPROVED','READY_FOR_INVOICE','INVOICED') AND approved_fee IS NOT NULL AND approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CHECK ((billing_status = 'INVOICED' AND invoice_id IS NOT NULL) OR (billing_status <> 'INVOICED' AND invoice_id IS NULL))
);

CREATE OR REPLACE FUNCTION validate_support_ticket_billing()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ticket_requester_type TEXT;
  ticket_engagement_id BIGINT;
  ticket_firm_id BIGINT;
  service_billable BOOLEAN;
  invoice_engagement_id BIGINT;
  invoice_firm_id BIGINT;
  invoice_amount NUMERIC(16,2);
  reviewer_level SMALLINT;
BEGIN
  SELECT requester_type, engagement_id, handling_firm_id
    INTO ticket_requester_type, ticket_engagement_id, ticket_firm_id
  FROM tickets WHERE ticket_id = NEW.ticket_id;

  SELECT is_billable INTO service_billable
  FROM support_services WHERE support_service_id = NEW.support_service_id AND is_active;

  IF service_billable IS NULL THEN
    RAISE EXCEPTION 'Choose an active support service.';
  END IF;
  IF service_billable IS DISTINCT FROM NEW.is_billable THEN
    RAISE EXCEPTION 'The ticket billing flag must match the selected service catalog entry.';
  END IF;
  IF NEW.is_billable AND ticket_requester_type <> 'CLIENT' THEN
    RAISE EXCEPTION 'Only client-requested tickets may generate client billing.';
  END IF;

  IF NEW.billing_status IN ('APPROVED','READY_FOR_INVOICE','INVOICED') THEN
    IF NEW.approved_by_user_id = NEW.created_by_user_id THEN
      RAISE EXCEPTION 'Support fee approval must be performed by a different user.';
    END IF;
    SELECT r.hierarchy_level INTO reviewer_level
    FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.approved_by_user_id AND u.is_active;
    IF reviewer_level IS NULL OR reviewer_level > 2 THEN
      RAISE EXCEPTION 'Only an active Manager or Partner may approve a billable support fee.';
    END IF;
  END IF;

  IF NEW.billing_status = 'INVOICED' THEN
    IF ticket_engagement_id IS NULL THEN
      RAISE EXCEPTION 'Link the support ticket to an active engagement before invoicing.';
    END IF;
    SELECT engagement_id, handling_firm_id, amount_billed
      INTO invoice_engagement_id, invoice_firm_id, invoice_amount
    FROM invoices WHERE invoice_id = NEW.invoice_id;
    IF invoice_engagement_id IS DISTINCT FROM ticket_engagement_id
       OR invoice_firm_id IS DISTINCT FROM ticket_firm_id
       OR invoice_amount IS DISTINCT FROM NEW.approved_fee THEN
      RAISE EXCEPTION 'Support invoice must use the same engagement, firm and approved pre-VAT fee.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_ticket_billing_validate ON support_ticket_billing;
CREATE TRIGGER support_ticket_billing_validate
BEFORE INSERT OR UPDATE ON support_ticket_billing
FOR EACH ROW EXECUTE FUNCTION validate_support_ticket_billing();

-- AUP / KRA notice register foundations. These tables track the notice and
-- agreed procedures; report generation and Section 59 ZIP-pack export remain a
-- separate implementation phase and are not claimed as complete here.
CREATE TABLE IF NOT EXISTS tax_notices (
  tax_notice_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  notice_reference TEXT NOT NULL,
  statutory_reference TEXT,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('SECTION_59','ETIMS_VALIDATION','AUDIT_QUERY','OTHER_KRA_NOTICE')),
  received_date DATE NOT NULL,
  response_due_date DATE,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','UNDER_REVIEW','RESPONDED','CLOSED')),
  notice_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handling_firm_id, notice_reference),
  FOREIGN KEY (engagement_id, client_id, handling_firm_id)
    REFERENCES engagements (engagement_id, client_id, handling_firm_id) ON DELETE RESTRICT,
  CHECK (response_due_date IS NULL OR response_due_date >= received_date)
);

CREATE TABLE IF NOT EXISTS tax_notice_procedures (
  tax_notice_procedure_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_notice_id BIGINT NOT NULL REFERENCES tax_notices(tax_notice_id) ON DELETE RESTRICT,
  procedure_no INTEGER NOT NULL CHECK (procedure_no > 0),
  procedure_description TEXT NOT NULL,
  assigned_to_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED'
    CHECK (status IN ('NOT_STARTED','IN_PROGRESS','READY_FOR_REVIEW','APPROVED','RETURNED')),
  UNIQUE (tax_notice_id, procedure_no)
);

CREATE TABLE IF NOT EXISTS tax_notice_procedure_results (
  tax_notice_procedure_result_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_notice_procedure_id BIGINT NOT NULL
    REFERENCES tax_notice_procedures(tax_notice_procedure_id) ON DELETE RESTRICT,
  result_description TEXT NOT NULL,
  conclusion TEXT,
  evidence_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  prepared_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT
);

-- These records contain tax, credit, filing, support and notice information.
-- No anon/authenticated direct table access is granted; use authorized server
-- APIs that enforce firm, client, assignment and maker-checker scope.
ALTER TABLE tax_obligation_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_compliance_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_credit_entry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_obligation_source_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_period_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_computation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_notice_procedures ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_notice_procedure_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE tax_obligation_types, tax_compliance_years, tax_credit_entries,
  tax_credit_entry_events, tax_obligation_source_totals, tax_period_adjustments,
  tax_computation_snapshots, support_services, support_ticket_billing, tax_notices,
  tax_notice_procedures, tax_notice_procedure_results
FROM PUBLIC, anon, authenticated;

COMMIT;
