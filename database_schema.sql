-- PCL CRM / ERP production schema (PostgreSQL 15+)
-- Apply through controlled migrations. This schema stores metadata and financial records,
-- not document binaries. Object storage and authenticated API enforcement are mandatory.
--
-- Multi-firm rule: a lead is opened under exactly one handling firm. That firm is
-- immutable after creation and every engagement child record inherits it. A change
-- of firm is therefore a new lead and a new engagement, never an update in place.

CREATE TABLE firms (
  firm_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  legal_name TEXT NOT NULL,
  trading_name TEXT,
  firm_code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (legal_name)
);

CREATE TABLE roles (
  role_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_name TEXT NOT NULL UNIQUE,
  hierarchy_level SMALLINT NOT NULL CHECK (hierarchy_level BETWEEN 1 AND 5),
  can_view_fees BOOLEAN NOT NULL DEFAULT FALSE,
  can_sign_off BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE users (
  user_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_id BIGINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  manager_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  staff_identifier TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  branch_location TEXT CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_firm_access (
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  can_manage_all_firm_records BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, firm_id)
);

CREATE TABLE clients (
  client_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  default_firm_id BIGINT REFERENCES firms(firm_id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  trading_name TEXT,
  primary_sector TEXT NOT NULL,
  branch_location TEXT NOT NULL CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  is_pie BOOLEAN NOT NULL DEFAULT FALSE,
  incorporation_date DATE,
  sme_audit_exempt BOOLEAN NOT NULL DEFAULT FALSE,
  sme_audit_exemption_basis TEXT,
  etims_onboarding_required BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('Lead','Active','Archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE engagements (
  engagement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  service_type TEXT NOT NULL,
  lifecycle_stage TEXT NOT NULL CHECK (lifecycle_stage IN ('New Lead','Scoping & KYC','Proposal Sent','EL Signed','Active Engagement','WIP / Billing','Closed / Archived')),
  potential_pie BOOLEAN NOT NULL DEFAULT FALSE,
  conflict_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  signed_el_document_id BIGINT,
  icpak_reference_no TEXT,
  eqr_status TEXT NOT NULL DEFAULT 'Not Required' CHECK (eqr_status IN ('Not Required','Pending','Cleared')),
  icpak_sync_status TEXT NOT NULL DEFAULT 'Not Exported' CHECK (icpak_sync_status IN ('Not Exported','Exported','Final Report Uploaded')),
  activated_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE service_templates (
  template_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_name TEXT NOT NULL UNIQUE,
  service_type TEXT NOT NULL,
  requires_pie BOOLEAN NOT NULL DEFAULT FALSE,
  is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE template_tasks (
  template_task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES service_templates(template_id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  assigned_role_name TEXT NOT NULL,
  sequence_no SMALLINT NOT NULL CHECK (sequence_no > 0),
  dependency_sequence_no SMALLINT,
  requires_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  is_hard_gate BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (template_id, sequence_no)
);

-- Client-level statutory work is scheduled independently from an engagement:
-- it can therefore be managed even where an SME audit exemption is active.
CREATE TABLE statutory_compliance_task_templates (
  statutory_template_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_code TEXT NOT NULL UNIQUE CHECK (task_code IN ('BRS_ANNUAL_RETURN_FILING','ETIMS_ONBOARDING')),
  task_name TEXT NOT NULL UNIQUE,
  assigned_position TEXT NOT NULL,
  requires_locked_evidence BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_statutory_compliance_tasks (
  statutory_task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  statutory_template_id BIGINT NOT NULL REFERENCES statutory_compliance_task_templates(statutory_template_id) ON DELETE RESTRICT,
  compliance_year SMALLINT NOT NULL,
  due_date DATE NOT NULL,
  activation_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Open','In Progress','Completed','Blocked','Cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, statutory_template_id, compliance_year)
);

INSERT INTO statutory_compliance_task_templates (task_code, task_name, assigned_position, requires_locked_evidence)
VALUES
  ('BRS_ANNUAL_RETURN_FILING','BRS Annual Return Filing','Practice Administration',TRUE),
  ('ETIMS_ONBOARDING','eTIMS Onboarding','Tax Manager',FALSE)
ON CONFLICT (task_code) DO UPDATE SET
  task_name = EXCLUDED.task_name,
  assigned_position = EXCLUDED.assigned_position,
  requires_locked_evidence = EXCLUDED.requires_locked_evidence;

CREATE TABLE active_engagement_tasks (
  task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  template_task_id BIGINT REFERENCES template_tasks(template_task_id) ON DELETE SET NULL,
  task_name TEXT NOT NULL,
  assigned_to BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_role_name TEXT NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Completed','Blocked','Rejected')),
  dependency_task_id BIGINT REFERENCES active_engagement_tasks(task_id) ON DELETE SET NULL,
  is_hard_gate BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ
);

CREATE TABLE staff_rates (
  rate_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  standard_cost_rate NUMERIC(14,2) NOT NULL CHECK (standard_cost_rate >= 0),
  billable_rate NUMERIC(14,2) NOT NULL CHECK (billable_rate >= 0),
  effective_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= effective_date),
  UNIQUE (user_id, effective_date)
);

CREATE TABLE engagement_financials (
  financial_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL UNIQUE REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  agreed_fee NUMERIC(16,2) NOT NULL CHECK (agreed_fee >= 0),
  budgeted_hours NUMERIC(12,2) NOT NULL CHECK (budgeted_hours >= 0),
  budgeted_cost NUMERIC(16,2) NOT NULL CHECK (budgeted_cost >= 0),
  billing_status TEXT NOT NULL DEFAULT 'Unbilled' CHECK (billing_status IN ('Unbilled','Partially Billed','Fully Billed','Paid')),
  supplementary_fee NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (supplementary_fee >= 0),
  loss_decision TEXT CHECK (loss_decision IN ('Write off overrun','Issue supplementary invoice')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE timesheets (
  timesheet_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT REFERENCES firms(firm_id) ON DELETE RESTRICT,
  user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  former_staff_identifier TEXT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  task_id BIGINT REFERENCES active_engagement_tasks(task_id) ON DELETE RESTRICT,
  date_logged DATE NOT NULL,
  hours_spent NUMERIC(8,2) NOT NULL,
  description TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'Standard' CHECK (entry_type IN ('Standard','Reversal','Leave')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted','Approved','Rejected','Approved Leave')),
  approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  cost_rate_at_approval NUMERIC(14,2),
  reversal_of_timesheet_id BIGINT REFERENCES timesheets(timesheet_id) ON DELETE RESTRICT,
  rejection_reason TEXT,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((entry_type = 'Standard' AND hours_spent > 0 AND engagement_id IS NOT NULL AND task_id IS NOT NULL) OR (entry_type = 'Reversal' AND hours_spent < 0 AND engagement_id IS NOT NULL AND task_id IS NOT NULL) OR (entry_type = 'Leave' AND hours_spent > 0 AND engagement_id IS NULL AND task_id IS NULL)),
  CHECK (status <> 'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND cost_rate_at_approval IS NOT NULL)),
  CHECK (entry_type <> 'Reversal' OR reversal_of_timesheet_id IS NOT NULL)
);

CREATE TABLE invoices (
  invoice_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  amount_billed NUMERIC(16,2) NOT NULL CHECK (amount_billed >= 0),
  vat_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  date_issued DATE NOT NULL,
  date_paid DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tax invoices use explicit client-contact and lead relationships. Billing references
-- remain on the invoice; controlled QR references belong to the Communication Hub.
CREATE TABLE client_contacts (
  contact_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  full_name TEXT NOT NULL,
  job_title TEXT,
  email_address TEXT,
  phone_number TEXT,
  role_in_decision TEXT CHECK (role_in_decision IN ('Decision Maker','Influencer','Billing Contact','Day-to-Day Contact')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX client_contacts_one_primary
ON client_contacts (client_id) WHERE is_primary AND is_active;

CREATE TABLE leads (
  lead_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  primary_contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  requested_service TEXT NOT NULL,
  branch_location TEXT NOT NULL CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  stage TEXT NOT NULL CHECK (stage IN ('New Lead','Scoping & KYC','Proposal Sent','EL Signed','Active Engagement','WIP / Billing','Closed / Archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE engagements
  ADD COLUMN source_lead_id BIGINT REFERENCES leads(lead_id) ON DELETE RESTRICT;

-- The lead determines the legal firm that accepts and performs the work. It cannot
-- be swapped after saving because that would change the accepting engagement.
CREATE OR REPLACE FUNCTION enforce_lead_firm_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.handling_firm_id IS NULL THEN
    RAISE EXCEPTION 'A lead requires a handling firm';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.handling_firm_id IS DISTINCT FROM OLD.handling_firm_id THEN
    RAISE EXCEPTION 'A lead handling firm is immutable. Create a separate lead and engagement for another firm.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_handling_firm_immutable
BEFORE INSERT OR UPDATE OF handling_firm_id ON leads
FOR EACH ROW EXECUTE FUNCTION enforce_lead_firm_immutability();

CREATE OR REPLACE FUNCTION enforce_engagement_firm()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  lead_firm_id BIGINT;
BEGIN
  IF NEW.handling_firm_id IS NULL THEN
    RAISE EXCEPTION 'An engagement requires a handling firm';
  END IF;
  IF NEW.source_lead_id IS NOT NULL THEN
    SELECT handling_firm_id INTO lead_firm_id FROM leads WHERE lead_id = NEW.source_lead_id;
    IF lead_firm_id IS NULL OR lead_firm_id IS DISTINCT FROM NEW.handling_firm_id THEN
      RAISE EXCEPTION 'Engagement firm must match its source lead firm';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.handling_firm_id IS DISTINCT FROM OLD.handling_firm_id THEN
    RAISE EXCEPTION 'Engagement firm is immutable. Create a separate engagement for another firm.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagements_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, source_lead_id ON engagements
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_firm();

CREATE TABLE tax_projects (
  tax_project_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL UNIQUE REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  billing_frequency TEXT NOT NULL CHECK (billing_frequency IN ('One-off','Monthly Retainer','Quarterly','Annually')),
  fee_per_billing_period NUMERIC(16,2) CHECK (fee_per_billing_period >= 0),
  first_invoice_date DATE,
  next_invoice_date DATE,
  payment_terms_days INTEGER NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 1 AND 365),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((billing_frequency = 'One-off') OR (fee_per_billing_period > 0 AND first_invoice_date IS NOT NULL))
);

ALTER TABLE invoices
  ADD COLUMN tax_project_id BIGINT REFERENCES tax_projects(tax_project_id) ON DELETE RESTRICT,
  ADD COLUMN lead_id BIGINT REFERENCES leads(lead_id) ON DELETE RESTRICT,
  ADD COLUMN contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  ADD COLUMN invoice_type TEXT NOT NULL DEFAULT 'Standard Invoice' CHECK (invoice_type IN ('Standard Invoice','Tax Invoice','Credit Note')),
  ADD COLUMN service_description TEXT,
  ADD COLUMN tax_period_start DATE,
  ADD COLUMN tax_period_end DATE,
  ADD COLUMN due_date DATE,
  ADD COLUMN payment_reference TEXT,
  ADD COLUMN invoice_status TEXT NOT NULL DEFAULT 'Issued' CHECK (invoice_status IN ('Draft','Issued','Partially Paid','Paid','Overdue','Reconciliation Review','Cancelled')),
  ADD COLUMN sent_at TIMESTAMPTZ,
  ADD COLUMN scheduled_from_tax_project BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT invoices_tax_period_dates CHECK (tax_period_end IS NULL OR tax_period_start IS NULL OR tax_period_end >= tax_period_start),
  ADD CONSTRAINT invoices_due_date CHECK (due_date IS NULL OR due_date >= date_issued);

CREATE TABLE invoice_payments (
  invoice_payment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
  amount_received NUMERIC(16,2) NOT NULL CHECK (amount_received > 0),
  date_received DATE NOT NULL,
  payment_reference TEXT NOT NULL,
  match_status TEXT NOT NULL CHECK (match_status IN ('MATCHED','REVIEW','REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_communications (
  communication_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
  contact_id BIGINT NOT NULL REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','SMS','PORTAL')),
  recipient_address TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'COMPOSED' CHECK (delivery_status IN ('COMPOSED','SENT','DELIVERED','FAILED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX invoices_tax_project_status ON invoices (tax_project_id, invoice_status, due_date);
CREATE INDEX invoice_payments_invoice ON invoice_payments (invoice_id, date_received);
CREATE INDEX invoice_communications_invoice ON invoice_communications (invoice_id, created_at);

-- Centralized communication hub. This is the relational equivalent of the
-- x_pcl_communication_hub model: one history across leads, contacts,
-- engagements and invoices. Formal-letter QR payloads remain in the dedicated
-- communication QR register; they must never be copied to message text or contact fields.
CREATE TABLE communication_hub (
  hub_communication_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  communication_reference TEXT UNIQUE,
  communication_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  communication_type TEXT NOT NULL CHECK (communication_type IN ('EMAIL','PHONE_CALL','MEETING','WHATSAPP','INTERNAL_NOTE','FORMAL_LETTER','QR_EVENT')),
  direction TEXT NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  body TEXT,
  firm_name TEXT,
  purpose TEXT,
  signatory_reference TEXT,
  logged_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  follow_up_date DATE,
  follow_up_assigned_to_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','NO_ACTION_REQUIRED')),
  lead_id BIGINT REFERENCES leads(lead_id) ON DELETE RESTRICT,
  client_id BIGINT REFERENCES clients(client_id) ON DELETE RESTRICT,
  contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  invoice_id BIGINT REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
  service_offered TEXT,
  branch_location TEXT CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((follow_up_date IS NULL AND follow_up_assigned_to_user_id IS NULL) OR (follow_up_date IS NOT NULL AND follow_up_assigned_to_user_id IS NOT NULL))
);

CREATE TABLE communication_qr_codes (
  communication_qr_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hub_communication_id BIGINT NOT NULL UNIQUE REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  communication_reference TEXT NOT NULL UNIQUE,
  opaque_token TEXT NOT NULL UNIQUE,
  payload_version SMALLINT NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX communication_hub_follow_up_open ON communication_hub (follow_up_date, follow_up_assigned_to_user_id) WHERE status = 'OPEN';
CREATE INDEX communication_hub_client_time ON communication_hub (client_id, communication_at DESC);
CREATE INDEX communication_hub_engagement_time ON communication_hub (engagement_id, communication_at DESC);
CREATE INDEX communication_hub_invoice_time ON communication_hub (invoice_id, communication_at DESC);
CREATE INDEX communication_qr_codes_status ON communication_qr_codes (status, generated_at DESC);

-- Normalise all links to one client chain before writing a communication.
CREATE OR REPLACE FUNCTION enforce_communication_hub_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_client_id BIGINT;
  source_firm_id BIGINT;
  linked_client_id BIGINT;
  linked_firm_id BIGINT;
  linked_engagement_id BIGINT;
BEGIN
  source_client_id := NEW.client_id;
  source_firm_id := NEW.handling_firm_id;
  IF NEW.engagement_id IS NOT NULL THEN
    SELECT client_id, handling_firm_id INTO linked_client_id, linked_firm_id FROM engagements WHERE engagement_id = NEW.engagement_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication engagement does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication engagement must belong to the linked client'; END IF;
    IF source_firm_id IS NOT NULL AND source_firm_id IS DISTINCT FROM linked_firm_id THEN RAISE EXCEPTION 'Communication firm must match the linked engagement firm'; END IF;
    source_client_id := linked_client_id;
    source_firm_id := linked_firm_id;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN
    SELECT client_id, handling_firm_id INTO linked_client_id, linked_firm_id FROM leads WHERE lead_id = NEW.lead_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication lead does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication lead must belong to the linked client'; END IF;
    IF source_firm_id IS NOT NULL AND source_firm_id IS DISTINCT FROM linked_firm_id THEN RAISE EXCEPTION 'Communication firm must match the linked lead firm'; END IF;
    source_client_id := linked_client_id;
    source_firm_id := linked_firm_id;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT e.client_id, i.engagement_id, i.handling_firm_id INTO linked_client_id, linked_engagement_id, linked_firm_id FROM invoices i JOIN engagements e ON e.engagement_id = i.engagement_id WHERE i.invoice_id = NEW.invoice_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication invoice does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication invoice must belong to the linked client'; END IF;
    IF NEW.engagement_id IS NOT NULL AND NEW.engagement_id IS DISTINCT FROM linked_engagement_id THEN RAISE EXCEPTION 'Communication invoice must belong to the linked engagement'; END IF;
    IF source_firm_id IS NOT NULL AND source_firm_id IS DISTINCT FROM linked_firm_id THEN RAISE EXCEPTION 'Communication firm must match the linked invoice firm'; END IF;
    source_client_id := linked_client_id;
    source_firm_id := linked_firm_id;
  END IF;
  IF NEW.client_id IS NULL THEN NEW.client_id := source_client_id; END IF;
  IF NEW.handling_firm_id IS NULL THEN NEW.handling_firm_id := source_firm_id; END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contacts WHERE contact_id = NEW.contact_id AND client_id = NEW.client_id AND is_active) THEN
    RAISE EXCEPTION 'Communication contact must be an active contact of the linked client';
  END IF;
  IF NEW.communication_reference IS NOT NULL AND (
    NEW.client_id IS NULL OR
    NEW.handling_firm_id IS NULL OR
    NULLIF(trim(COALESCE(NEW.purpose, '')), '') IS NULL OR
    NULLIF(trim(COALESCE(NEW.signatory_reference, '')), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'A QR communication reference requires a linked client, firm, purpose and approved signatory reference';
  END IF;
  SELECT legal_name INTO NEW.firm_name FROM firms WHERE firm_id = NEW.handling_firm_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER communication_hub_link_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, lead_id, client_id, contact_id, engagement_id, invoice_id, communication_reference, purpose, signatory_reference ON communication_hub
FOR EACH ROW EXECUTE FUNCTION enforce_communication_hub_links();

CREATE OR REPLACE FUNCTION enforce_communication_qr_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  hub_reference TEXT;
  hub_client_id BIGINT;
  hub_firm_id BIGINT;
  hub_purpose TEXT;
  hub_signatory TEXT;
BEGIN
  SELECT communication_reference, client_id, handling_firm_id, purpose, signatory_reference
    INTO hub_reference, hub_client_id, hub_firm_id, hub_purpose, hub_signatory
  FROM communication_hub
  WHERE hub_communication_id = NEW.hub_communication_id;
  IF hub_reference IS DISTINCT FROM NEW.communication_reference OR hub_client_id IS NULL OR
     hub_firm_id IS NULL OR
     NULLIF(trim(COALESCE(hub_purpose, '')), '') IS NULL OR
     NULLIF(trim(COALESCE(hub_signatory, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Communication QR must match a fully controlled communication reference.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER communication_qr_link_guard
BEFORE INSERT OR UPDATE OF hub_communication_id, communication_reference ON communication_qr_codes
FOR EACH ROW EXECUTE FUNCTION enforce_communication_qr_links();

-- Keep lead, contact and tax-project links in the same client chain. API role checks
-- remain required before a tax invoice can be created, sent or cancelled.
CREATE OR REPLACE FUNCTION enforce_tax_invoice_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_client_id BIGINT;
  expected_firm_id BIGINT;
  expected_engagement_id BIGINT;
BEGIN
  SELECT client_id, handling_firm_id INTO expected_client_id, expected_firm_id FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF expected_client_id IS NULL THEN RAISE EXCEPTION 'Invoice engagement does not exist'; END IF;
  IF NEW.handling_firm_id IS DISTINCT FROM expected_firm_id THEN
    RAISE EXCEPTION 'Invoice firm must match the engagement handling firm';
  END IF;
  IF NEW.tax_project_id IS NOT NULL THEN
    SELECT engagement_id INTO expected_engagement_id FROM tax_projects WHERE tax_project_id = NEW.tax_project_id;
    IF expected_engagement_id IS DISTINCT FROM NEW.engagement_id THEN RAISE EXCEPTION 'Tax project must belong to the invoice engagement'; END IF;
  END IF;
  IF NEW.lead_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM leads WHERE lead_id = NEW.lead_id AND client_id = expected_client_id) THEN
    RAISE EXCEPTION 'Invoice lead must belong to the engagement client';
  END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contacts WHERE contact_id = NEW.contact_id AND client_id = expected_client_id AND is_active) THEN
    RAISE EXCEPTION 'Invoice contact must be an active contact of the engagement client';
  END IF;
  IF NEW.invoice_type = 'Tax Invoice' AND (NEW.tax_project_id IS NULL OR NEW.lead_id IS NULL OR NEW.contact_id IS NULL OR NEW.payment_reference IS NULL OR NEW.due_date IS NULL) THEN
    RAISE EXCEPTION 'Tax invoice requires tax project, lead, contact, payment reference and due date';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoices_tax_link_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id, tax_project_id, lead_id, contact_id, invoice_type, payment_reference, due_date ON invoices
FOR EACH ROW EXECUTE FUNCTION enforce_tax_invoice_links();

-- Payment references are reconciled without changing the net invoice amount used by WIP.
CREATE OR REPLACE FUNCTION refresh_tax_invoice_payment_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_invoice_id BIGINT;
  gross_total NUMERIC(16,2);
  received_total NUMERIC(16,2);
  review_exists BOOLEAN;
BEGIN
  target_invoice_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
  SELECT amount_billed + vat_amount INTO gross_total FROM invoices WHERE invoice_id = target_invoice_id;
  SELECT COALESCE(SUM(amount_received),0), BOOL_OR(match_status = 'REVIEW') INTO received_total, review_exists
  FROM invoice_payments WHERE invoice_id = target_invoice_id AND match_status <> 'REJECTED';
  UPDATE invoices SET invoice_status = CASE
    WHEN invoice_status = 'Cancelled' THEN 'Cancelled'
    WHEN COALESCE(review_exists,FALSE) THEN 'Reconciliation Review'
    WHEN received_total >= gross_total THEN 'Paid'
    WHEN received_total > 0 THEN 'Partially Paid'
    WHEN due_date < CURRENT_DATE THEN 'Overdue'
    ELSE 'Issued'
  END,
  date_paid = CASE WHEN received_total >= gross_total THEN COALESCE(date_paid, CURRENT_DATE) ELSE date_paid END
  WHERE invoice_id = target_invoice_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER invoice_payments_refresh_status
AFTER INSERT OR UPDATE OR DELETE ON invoice_payments
FOR EACH ROW EXECUTE FUNCTION refresh_tax_invoice_payment_status();

CREATE TABLE vault_categories (
  category_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  category_name TEXT NOT NULL UNIQUE,
  is_restricted BOOLEAN NOT NULL DEFAULT FALSE,
  force_lock_documents BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO vault_categories (category_name, is_restricted, force_lock_documents)
VALUES ('BRS Acknowledgment Receipts', TRUE, TRUE)
ON CONFLICT (category_name) DO UPDATE SET
  is_restricted = EXCLUDED.is_restricted,
  force_lock_documents = EXCLUDED.force_lock_documents;

CREATE TABLE documents (
  document_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  category_id BIGINT NOT NULL REFERENCES vault_categories(category_id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL DEFAULT 'GENERAL' CHECK (document_type IN ('GENERAL','BRS_ACKNOWLEDGMENT','KYC','ENGAGEMENT_LETTER','FINAL_AUDIT_REPORT')),
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  file_size_mb NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (file_size_mb >= 0),
  uploaded_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_by_external BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  version_no INTEGER NOT NULL DEFAULT 1 CHECK (version_no > 0),
  supersedes_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  CHECK ((uploaded_by IS NOT NULL) <> uploaded_by_external)
);

CREATE TABLE communication_attachments (
  hub_communication_id BIGINT NOT NULL REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  PRIMARY KEY (hub_communication_id, document_id)
);

CREATE TABLE document_access_logs (
  log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  external_actor_reference TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('VIEW','DOWNLOAD','UPLOAD','DELETE','DELETE_BLOCKED','OVERWRITE_BLOCKED','ICPAK_EXPORT_PREPARED')),
  action_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address INET,
  CHECK (user_id IS NOT NULL OR external_actor_reference IS NOT NULL)
);

CREATE TABLE notification_templates (
  template_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_code TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','IN_APP','SMS')),
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE system_alerts (
  alert_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_code TEXT NOT NULL REFERENCES notification_templates(alert_code) ON DELETE RESTRICT,
  recipient_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  recipient_role_name TEXT,
  related_record_type TEXT NOT NULL,
  related_record_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','RESOLVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CHECK (recipient_user_id IS NOT NULL OR recipient_role_name IS NOT NULL)
);

CREATE TABLE alert_preferences (
  preference_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  alert_code TEXT NOT NULL REFERENCES notification_templates(alert_code) ON DELETE CASCADE,
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, alert_code)
);

-- HR and staffing. The ERP records professional competence and availability;
-- payroll calculations and statutory deductions remain in a specialist payroll system.
ALTER TABLE users ADD COLUMN contract_end_date DATE;

CREATE TABLE staff_credentials (
  credential_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  credential_type TEXT NOT NULL CHECK (credential_type IN ('CPA_PAPER','ICPAK_MEMBERSHIP','CPD_SEMINAR','DEGREE')),
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','PASSED','EXPIRED')),
  issue_date DATE,
  expiry_date DATE,
  cpd_hours_earned NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (cpd_hours_earned >= 0),
  document_id BIGINT REFERENCES documents(document_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE leave_requests (
  leave_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  leave_type TEXT NOT NULL CHECK (leave_type IN ('ANNUAL','SICK','STUDY','MATERNITY_PATERNITY')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  total_days INTEGER NOT NULL CHECK (total_days > 0),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  blackout_risk BOOLEAN NOT NULL DEFAULT FALSE,
  blackout_override BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ,
  CHECK (end_date >= start_date)
);

CREATE TABLE staff_assignments (
  assignment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  role_on_job TEXT NOT NULL CHECK (role_on_job IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT','INTERN')),
  planned_start_date DATE NOT NULL,
  planned_end_date DATE NOT NULL,
  allocation_percentage SMALLINT NOT NULL CHECK (allocation_percentage BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (planned_end_date >= planned_start_date)
);

CREATE TABLE performance_reviews (
  review_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  reviewer_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  reviewee_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  technical_score SMALLINT NOT NULL CHECK (technical_score BETWEEN 1 AND 5),
  punctuality_score SMALLINT NOT NULL CHECK (punctuality_score BETWEEN 1 AND 5),
  workpaper_score SMALLINT NOT NULL CHECK (workpaper_score BETWEEN 1 AND 5),
  comments TEXT,
  review_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (reviewer_id <> reviewee_id)
);

-- A busy-season request must be escalated. The API must still verify the approver's role.
CREATE OR REPLACE FUNCTION mark_busy_season_leave()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_year INTEGER;
BEGIN
  FOR target_year IN (EXTRACT(YEAR FROM NEW.start_date)::INTEGER)..(EXTRACT(YEAR FROM NEW.end_date)::INTEGER) LOOP
    IF daterange(NEW.start_date, NEW.end_date, '[]') && daterange(make_date(target_year,1,15), make_date(target_year,4,30), '[]') THEN
      NEW.blackout_risk := TRUE;
      NEW.blackout_override := FALSE;
    END IF;
  END LOOP;
  NEW.total_days := (NEW.end_date - NEW.start_date) + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_requests_busy_season
BEFORE INSERT OR UPDATE OF start_date, end_date ON leave_requests
FOR EACH ROW EXECUTE FUNCTION mark_busy_season_leave();

CREATE INDEX staff_assignments_user_dates ON staff_assignments (user_id, planned_start_date, planned_end_date);
CREATE INDEX leave_requests_user_dates ON leave_requests (user_id, start_date, end_date);
CREATE INDEX staff_credentials_expiry ON staff_credentials (expiry_date);

-- Help desk and client / staff support. Requester references are modelled explicitly
-- rather than with a polymorphic foreign key, preserving referential integrity.
CREATE TABLE tickets (
  ticket_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  ticket_number TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  requester_type TEXT NOT NULL CHECK (requester_type IN ('CLIENT','STAFF')),
  requester_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  requester_client_id BIGINT REFERENCES clients(client_id) ON DELETE SET NULL,
  assigned_to BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE SET NULL,
  priority TEXT NOT NULL CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','PENDING_CLIENT','PENDING_STAFF','RESOLVED','CLOSED')),
  category TEXT NOT NULL CHECK (category IN ('IT','AUDIT_SOFTWARE','TAX','BILLING','CLIENT_DOCS','ATTENDANCE')),
  vault_document_id BIGINT REFERENCES documents(document_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  sla_due_at TIMESTAMPTZ NOT NULL,
  sla_breached_at TIMESTAMPTZ,
  CHECK ((requester_type = 'STAFF' AND requester_user_id IS NOT NULL AND requester_client_id IS NULL) OR (requester_type = 'CLIENT' AND requester_client_id IS NOT NULL AND requester_user_id IS NULL))
);

CREATE TABLE ticket_comments (
  comment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  external_author_reference TEXT,
  message TEXT NOT NULL,
  is_internal_note BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_document_id BIGINT REFERENCES documents(document_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT NULL OR external_author_reference IS NOT NULL)
);

CREATE TABLE knowledge_base (
  article_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('IT','TAX','AUDIT')),
  is_client_visible BOOLEAN NOT NULL DEFAULT FALSE,
  views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
  created_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX tickets_sla_open ON tickets (sla_due_at) WHERE status IN ('OPEN','IN_PROGRESS','PENDING_CLIENT','PENDING_STAFF');
CREATE INDEX tickets_engagement ON tickets (engagement_id);

-- Attendance is distinct from the timesheet: it proves presence and work location,
-- while timesheets allocate effort to client work. IP checks are evaluated only by
-- the authenticated server, using this controlled allow-list.
CREATE TABLE approved_network_ranges (
  network_range_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  location_name TEXT NOT NULL,
  network_cidr CIDR NOT NULL UNIQUE,
  network_type TEXT NOT NULL CHECK (network_type IN ('OFFICE','CLIENT_SITE','APPROVED_REMOTE')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE attendance_logs (
  attendance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  work_date DATE NOT NULL,
  clock_in_time TIMESTAMPTZ,
  clock_out_time TIMESTAMPTZ,
  work_location TEXT NOT NULL CHECK (work_location IN ('NAIROBI_OFFICE','BUNGOMA_OFFICE','KISII_OFFICE','CLIENT_SITE','REMOTE','ON_LEAVE')),
  ip_address INET,
  status TEXT NOT NULL CHECK (status IN ('PRESENT','LATE','ABSENT','HALF_DAY','ON_LEAVE','MISSED_PUNCH')),
  total_hours_worked NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (total_hours_worked >= 0),
  requires_manager_review BOOLEAN NOT NULL DEFAULT FALSE,
  leave_id BIGINT REFERENCES leave_requests(leave_id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_date),
  CHECK ((status = 'ON_LEAVE' AND clock_in_time IS NULL AND clock_out_time IS NULL AND leave_id IS NOT NULL) OR status <> 'ON_LEAVE'),
  CHECK (clock_out_time IS NULL OR clock_in_time IS NOT NULL),
  CHECK (clock_out_time IS NULL OR clock_out_time >= clock_in_time)
);

CREATE TABLE attendance_exceptions (
  exception_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_id BIGINT NOT NULL REFERENCES attendance_logs(attendance_id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL CHECK (exception_type IN ('LATENESS','OVERTIME','EARLY_DEPARTURE','MISSED_PUNCH')),
  minutes_variance INTEGER NOT NULL DEFAULT 0 CHECK (minutes_variance >= 0),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attendance_id, exception_type)
);

CREATE TABLE client_site_visits (
  visit_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  check_in_time TIMESTAMPTZ NOT NULL,
  check_out_time TIMESTAMPTZ,
  gps_coordinates TEXT,
  supervisor_signoff BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out_time IS NULL OR check_out_time >= check_in_time)
);

CREATE INDEX attendance_logs_user_date ON attendance_logs (user_id, work_date);
CREATE INDEX attendance_exceptions_pending ON attendance_exceptions (status) WHERE status = 'PENDING';
CREATE INDEX client_site_visits_engagement ON client_site_visits (engagement_id, check_in_time);

-- 08:15 is the lateness threshold; the workday is 08:00–17:00 in Africa/Nairobi.
-- This trigger calculates time, flags a remote network that is not on the approved
-- allow-list, and creates a lateness or overtime exception when applicable.
CREATE OR REPLACE FUNCTION classify_attendance_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  late_minutes INTEGER;
  overtime_minutes INTEGER;
  local_clock_in TIME;
  local_clock_out TIME;
BEGIN
  IF NEW.status = 'ON_LEAVE' THEN
    NEW.total_hours_worked := 0;
    RETURN NEW;
  END IF;
  IF NEW.clock_in_time IS NOT NULL THEN
    local_clock_in := (NEW.clock_in_time AT TIME ZONE 'Africa/Nairobi')::TIME;
    late_minutes := GREATEST(0, EXTRACT(EPOCH FROM (local_clock_in - TIME '08:15'))::INTEGER / 60);
    IF late_minutes > 0 THEN NEW.status := 'LATE'; ELSE NEW.status := 'PRESENT'; END IF;
  END IF;
  IF NEW.clock_out_time IS NOT NULL AND NEW.clock_in_time IS NOT NULL THEN
    NEW.total_hours_worked := ROUND(EXTRACT(EPOCH FROM (NEW.clock_out_time - NEW.clock_in_time))::NUMERIC / 3600, 2);
    local_clock_out := (NEW.clock_out_time AT TIME ZONE 'Africa/Nairobi')::TIME;
    IF NEW.status = 'PRESENT' AND NEW.total_hours_worked < 4 THEN NEW.status := 'HALF_DAY'; END IF;
  END IF;
  IF NEW.work_location = 'REMOTE' AND NOT EXISTS (SELECT 1 FROM approved_network_ranges n WHERE n.is_active AND NEW.ip_address <<= n.network_cidr) THEN
    NEW.requires_manager_review := TRUE;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_logs_classify
BEFORE INSERT OR UPDATE OF clock_in_time, clock_out_time, work_location, ip_address, status ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION classify_attendance_log();

CREATE OR REPLACE FUNCTION add_attendance_exception()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  late_minutes INTEGER;
  overtime_minutes INTEGER;
BEGIN
  IF NEW.clock_in_time IS NOT NULL THEN
    late_minutes := GREATEST(0, EXTRACT(EPOCH FROM (((NEW.clock_in_time AT TIME ZONE 'Africa/Nairobi')::TIME) - TIME '08:15'))::INTEGER / 60);
    IF late_minutes > 0 THEN
      INSERT INTO attendance_exceptions (attendance_id, exception_type, minutes_variance)
      VALUES (NEW.attendance_id, 'LATENESS', late_minutes)
      ON CONFLICT (attendance_id, exception_type) DO NOTHING;
    END IF;
  END IF;
  IF NEW.clock_out_time IS NOT NULL AND EXTRACT(MONTH FROM NEW.work_date) BETWEEN 1 AND 4 THEN
    overtime_minutes := GREATEST(0, EXTRACT(EPOCH FROM (((NEW.clock_out_time AT TIME ZONE 'Africa/Nairobi')::TIME) - TIME '18:00'))::INTEGER / 60);
    IF overtime_minutes > 0 THEN
      INSERT INTO attendance_exceptions (attendance_id, exception_type, minutes_variance)
      VALUES (NEW.attendance_id, 'OVERTIME', overtime_minutes)
      ON CONFLICT (attendance_id, exception_type) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attendance_logs_create_exceptions
AFTER INSERT OR UPDATE OF clock_in_time, clock_out_time ON attendance_logs
FOR EACH ROW EXECUTE FUNCTION add_attendance_exception();

-- Approved leave reserves each date in attendance and blocks duplicate clock-ins.
CREATE OR REPLACE FUNCTION sync_approved_leave_to_attendance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'APPROVED' THEN
    INSERT INTO attendance_logs (user_id, work_date, work_location, status, total_hours_worked, leave_id, approved_by)
    SELECT NEW.user_id, day::DATE, 'ON_LEAVE', 'ON_LEAVE', 0, NEW.leave_id, NEW.approved_by
    FROM generate_series(NEW.start_date, NEW.end_date, INTERVAL '1 day') AS day
    ON CONFLICT (user_id, work_date) DO UPDATE SET
      clock_in_time = NULL,
      clock_out_time = NULL,
      work_location = 'ON_LEAVE',
      status = 'ON_LEAVE',
      total_hours_worked = 0,
      leave_id = EXCLUDED.leave_id,
      approved_by = EXCLUDED.approved_by,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leave_requests_sync_attendance
AFTER INSERT OR UPDATE OF status, start_date, end_date ON leave_requests
FOR EACH ROW EXECUTE FUNCTION sync_approved_leave_to_attendance();

-- Run this function at 00:05 daily. The scheduler then sends an alert to the
-- staff member and Audit Supervisor for each newly flagged missed punch.
CREATE OR REPLACE FUNCTION flag_missed_attendance_punches()
RETURNS SETOF attendance_logs LANGUAGE plpgsql AS $$
BEGIN
  UPDATE attendance_logs
  SET status = 'MISSED_PUNCH', requires_manager_review = TRUE, updated_at = now()
  WHERE clock_in_time IS NOT NULL
    AND clock_out_time IS NULL
    AND work_date < (now() AT TIME ZONE 'Africa/Nairobi')::DATE
    AND status NOT IN ('ON_LEAVE','MISSED_PUNCH');
  INSERT INTO attendance_exceptions (attendance_id, exception_type, minutes_variance, reason)
  SELECT attendance_id, 'MISSED_PUNCH', 0, 'Clock-out was not captured before end of day.'
  FROM attendance_logs WHERE status = 'MISSED_PUNCH'
  ON CONFLICT (attendance_id, exception_type) DO NOTHING;
  RETURN QUERY SELECT * FROM attendance_logs WHERE status = 'MISSED_PUNCH';
END;
$$;

CREATE OR REPLACE VIEW v_attendance_timesheet_gaps AS
WITH attendance_by_week AS (
  SELECT user_id, date_trunc('week', work_date)::DATE AS week_start, SUM(total_hours_worked) AS attendance_hours
  FROM attendance_logs
  WHERE status IN ('PRESENT','LATE','HALF_DAY') AND clock_out_time IS NOT NULL
  GROUP BY user_id, date_trunc('week', work_date)::DATE
), timesheet_by_week AS (
  SELECT user_id, date_trunc('week', date_logged)::DATE AS week_start, SUM(hours_spent) AS timesheet_hours
  FROM timesheets
  WHERE entry_type = 'Standard' AND status IN ('Submitted','Approved')
  GROUP BY user_id, date_trunc('week', date_logged)::DATE
)
SELECT a.user_id, a.week_start, a.attendance_hours, COALESCE(t.timesheet_hours, 0) AS timesheet_hours,
       a.attendance_hours - COALESCE(t.timesheet_hours, 0) AS hours_gap
FROM attendance_by_week a
LEFT JOIN timesheet_by_week t ON t.user_id = a.user_id AND t.week_start = a.week_start
WHERE a.attendance_hours - COALESCE(t.timesheet_hours, 0) > 0.25;

CREATE OR REPLACE VIEW v_busy_season_burnout_risk AS
SELECT user_id, date_trunc('week', work_date)::DATE AS week_start, SUM(total_hours_worked) AS attendance_hours
FROM attendance_logs
WHERE EXTRACT(MONTH FROM work_date) BETWEEN 1 AND 4
  AND status IN ('PRESENT','LATE','HALF_DAY')
GROUP BY user_id, date_trunc('week', work_date)::DATE
HAVING SUM(total_hours_worked) > 60;

-- Approved time is immutable. Corrections are new, negative reversal entries.
CREATE OR REPLACE FUNCTION enforce_timesheet_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'Approved' AND (
    NEW.hours_spent IS DISTINCT FROM OLD.hours_spent OR
    NEW.date_logged IS DISTINCT FROM OLD.date_logged OR
    NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR
    NEW.task_id IS DISTINCT FROM OLD.task_id OR
    NEW.description IS DISTINCT FROM OLD.description OR
    NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Approved timesheets are locked. Create a reversal entry instead.';
  END IF;
  IF NEW.status = 'Approved' AND OLD.status <> 'Approved' THEN
    NEW.is_locked := TRUE;
    NEW.approved_at := COALESCE(NEW.approved_at, now());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER timesheets_lock_after_approval
BEFORE UPDATE ON timesheets
FOR EACH ROW EXECUTE FUNCTION enforce_timesheet_lock();

-- Locked reports cannot be deleted or overwritten. Create a new version instead.
CREATE OR REPLACE FUNCTION enforce_document_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.is_locked THEN
    RAISE EXCEPTION 'Locked document cannot be deleted. Upload a new version.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.is_locked THEN
    RAISE EXCEPTION 'Locked document cannot be overwritten. Upload a new version.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER documents_no_delete_locked
BEFORE DELETE ON documents
FOR EACH ROW EXECUTE FUNCTION enforce_document_lock();

CREATE TRIGGER documents_no_overwrite_locked
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION enforce_document_lock();

-- Policy folders lock their contents on entry. A BRS receipt cannot be filed
-- elsewhere, and an acknowledgement cannot subsequently be deleted or altered.
CREATE OR REPLACE FUNCTION enforce_document_category_controls()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  category_locks BOOLEAN := FALSE;
BEGIN
  SELECT force_lock_documents INTO category_locks
  FROM vault_categories WHERE category_id = NEW.category_id;
  IF NEW.document_type = 'BRS_ACKNOWLEDGMENT' AND NOT category_locks THEN
    RAISE EXCEPTION 'BRS acknowledgement receipts must be stored in the locked BRS Acknowledgment Receipts category';
  END IF;
  IF category_locks OR NEW.document_type = 'KYC' THEN NEW.is_locked := TRUE; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_category_control_guard
BEFORE INSERT OR UPDATE OF category_id, document_type ON documents
FOR EACH ROW EXECUTE FUNCTION enforce_document_category_controls();

-- Production WIP query. Rate is frozen at approval and used for historical accuracy.
CREATE VIEW v_engagement_wip AS
SELECT
  e.engagement_id,
  c.company_name,
  c.primary_sector,
  c.branch_location,
  ef.agreed_fee,
  ef.budgeted_hours,
  COALESCE(SUM(t.hours_spent) FILTER (WHERE t.status = 'Approved'), 0) AS actual_hours,
  COALESCE(SUM(t.hours_spent * t.cost_rate_at_approval) FILTER (WHERE t.status = 'Approved'), 0) AS actual_cost,
  COALESCE((SELECT SUM(i.amount_billed) FROM invoices i WHERE i.engagement_id = e.engagement_id), 0) AS total_billed
FROM engagements e
JOIN clients c ON c.client_id = e.client_id
LEFT JOIN engagement_financials ef ON ef.engagement_id = e.engagement_id
LEFT JOIN timesheets t ON t.engagement_id = e.engagement_id
GROUP BY e.engagement_id, c.company_name, c.primary_sector, c.branch_location, ef.agreed_fee, ef.budgeted_hours;

-- The API must apply role checks before exposing this view. Hide fee/cost/rate fields
-- for Audit Supervisors, Audit Assistants and Interns. Use signed object-storage URLs
-- with a maximum 60-second expiry for approved document downloads.

-- ICPAK-aligned audit workspace. These are annual client files built only for
-- activated Statutory Audit engagements. They record audit evidence metadata;
-- the actual evidence remains in the secured document-vault object store.
CREATE TABLE audit_files (
  audit_file_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  reporting_year_end DATE NOT NULL,
  audit_file_type TEXT NOT NULL CHECK (audit_file_type IN ('FIRST_TIME','SUBSEQUENT')),
  file_status TEXT NOT NULL DEFAULT 'PLANNING' CHECK (file_status IN ('PLANNING','FIELDWORK','MANAGER_REVIEW','PARTNER_REVIEW','ARCHIVED')),
  previous_audit_file_id BIGINT REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  file_reference TEXT,
  archived_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, reporting_year_end),
  CHECK ((file_status = 'ARCHIVED') = (archived_at IS NOT NULL)),
  CHECK (previous_audit_file_id IS NULL OR previous_audit_file_id <> audit_file_id)
);

CREATE TABLE audit_planning_controls (
  audit_planning_control_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  planning_area TEXT NOT NULL CHECK (planning_area IN ('Overall audit strategy and plan','Client acceptance and continuance','Time budgets','Materiality','Analytical review','Understanding the entity and environment','Internal controls','Risk assessment and response','Fraud risk','Brought-forward points','Permanent-file review')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETE','REVIEWED')),
  conclusion TEXT NOT NULL,
  planned_response_or_evidence_reference TEXT,
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, planning_area)
);

CREATE TABLE audit_trial_balances (
  audit_trial_balance_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL UNIQUE REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  total_debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  difference NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_balanced BOOLEAN NOT NULL DEFAULT FALSE,
  imported_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replacement_requested_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  replacement_reason TEXT
);

CREATE TABLE audit_trial_balance_lines (
  audit_trial_balance_line_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_trial_balance_id BIGINT NOT NULL REFERENCES audit_trial_balances(audit_trial_balance_id) ON DELETE RESTRICT,
  account_number TEXT NOT NULL,
  account_description TEXT NOT NULL,
  current_year_debit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (current_year_debit >= 0),
  current_year_credit NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (current_year_credit >= 0),
  prior_year_debit NUMERIC(18,2),
  prior_year_credit NUMERIC(18,2),
  mapped_audit_area TEXT CHECK (mapped_audit_area IN ('Intangible Assets','Property, Plant & Equipment','Inventories','Trade & Other Receivables','Cash & Bank Balances','Related Party Disclosures','Trade & Other Payables','Borrowings','Current Tax','Deferred Tax','Capital & Reserves','Commitments & Contingencies','Directors'' Emoluments & Transactions','Cash Flow Statement','Income','Expenditure')),
  mapped_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_trial_balance_id, account_number)
);

CREATE TABLE audit_workpapers (
  audit_workpaper_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  audit_area TEXT NOT NULL CHECK (audit_area IN ('Intangible Assets','Property, Plant & Equipment','Inventories','Trade & Other Receivables','Cash & Bank Balances','Related Party Disclosures','Trade & Other Payables','Borrowings','Current Tax','Deferred Tax','Capital & Reserves','Commitments & Contingencies','Directors'' Emoluments & Transactions','Cash Flow Statement','Income','Expenditure')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','PREPARED','REVIEWED')),
  work_performed TEXT NOT NULL,
  observations_and_conclusion TEXT NOT NULL,
  evidence_reference TEXT,
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, audit_area)
);

CREATE TABLE audit_completion_items (
  audit_completion_item_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  item_type TEXT NOT NULL CHECK (item_type IN ('Overall audit conclusion','Calling-over checklist','Partner review','Team debrief','Senior attention points','Client meeting agenda','Unadjusted errors','Carry-forward points','Subsequent events','Going concern','Draft financial statements','Management letter','Signed representation letter','Management letter cover letter')),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','PREPARED','REVIEWED','COMPLETE')),
  note TEXT NOT NULL,
  document_reference TEXT,
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, item_type)
);

CREATE TABLE audit_file_attachments (
  audit_file_attachment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  vault_reference TEXT NOT NULL,
  is_permanent BOOLEAN NOT NULL DEFAULT FALSE,
  rolled_forward_from_attachment_id BIGINT REFERENCES audit_file_attachments(audit_file_attachment_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, vault_reference)
);

CREATE INDEX audit_files_engagement_period ON audit_files (engagement_id, reporting_year_end DESC);
CREATE INDEX audit_tb_lines_mapping ON audit_trial_balance_lines (audit_trial_balance_id, mapped_audit_area);
CREATE INDEX audit_file_attachments_roll_forward ON audit_file_attachments (audit_file_id, is_permanent);

-- Recalculate the balancing state after every line change. The API must permit
-- financial-statement generation and ICPAK export only when is_balanced is true
-- and no account remains unmapped.
CREATE OR REPLACE FUNCTION refresh_audit_trial_balance_totals()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_tb_id BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN target_tb_id := OLD.audit_trial_balance_id;
  ELSE target_tb_id := NEW.audit_trial_balance_id;
  END IF;
  UPDATE audit_trial_balances tb
  SET total_debit = COALESCE((SELECT SUM(current_year_debit) FROM audit_trial_balance_lines WHERE audit_trial_balance_id = target_tb_id), 0),
      total_credit = COALESCE((SELECT SUM(current_year_credit) FROM audit_trial_balance_lines WHERE audit_trial_balance_id = target_tb_id), 0)
  WHERE tb.audit_trial_balance_id = target_tb_id;
  UPDATE audit_trial_balances
  SET difference = total_debit - total_credit,
      is_balanced = abs(total_debit - total_credit) < 0.01
  WHERE audit_trial_balance_id = target_tb_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_tb_lines_refresh_totals
AFTER INSERT OR UPDATE OR DELETE ON audit_trial_balance_lines
FOR EACH ROW EXECUTE FUNCTION refresh_audit_trial_balance_totals();

-- Archive is a hard close. It is restricted to the Engagement Partner and only
-- after mandatory planning, a balanced/mapped TB, prepared workpapers, required
-- completion evidence and PIE EQR clearance. Production middleware must also
-- assert that each child record belongs to an open audit file before edits.
CREATE OR REPLACE FUNCTION enforce_audit_file_archive()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  missing_planning BOOLEAN;
  missing_completion BOOLEAN;
  tb_ready BOOLEAN;
  workpaper_ready BOOLEAN;
  eqr_ready BOOLEAN;
BEGIN
  IF OLD.file_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'Archived audit files are immutable. Create a subsequent annual audit file.';
  END IF;
  IF NEW.file_status <> 'ARCHIVED' THEN RETURN NEW; END IF;
  IF NEW.archived_by_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.archived_by_user_id AND r.role_name = 'Engagement Partner'
  ) THEN RAISE EXCEPTION 'Only the Engagement Partner can archive an audit file.'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM (VALUES ('Overall audit strategy and plan'),('Client acceptance and continuance'),('Materiality'),('Risk assessment and response'),('Fraud risk')) required(area)
    WHERE NOT EXISTS (SELECT 1 FROM audit_planning_controls p WHERE p.audit_file_id = NEW.audit_file_id AND p.planning_area = required.area AND p.status IN ('COMPLETE','REVIEWED'))
  ) INTO missing_planning;
  SELECT EXISTS (
    SELECT 1 FROM (VALUES ('Overall audit conclusion'),('Calling-over checklist'),('Partner review'),('Subsequent events'),('Going concern'),('Signed representation letter')) required(item_type)
    WHERE NOT EXISTS (SELECT 1 FROM audit_completion_items c WHERE c.audit_file_id = NEW.audit_file_id AND c.item_type = required.item_type AND c.status IN ('COMPLETE','REVIEWED'))
  ) INTO missing_completion;
  SELECT EXISTS (SELECT 1 FROM audit_trial_balances tb WHERE tb.audit_file_id = NEW.audit_file_id AND tb.is_balanced)
         AND NOT EXISTS (SELECT 1 FROM audit_trial_balance_lines l JOIN audit_trial_balances tb ON tb.audit_trial_balance_id = l.audit_trial_balance_id WHERE tb.audit_file_id = NEW.audit_file_id AND l.mapped_audit_area IS NULL)
  INTO tb_ready;
  SELECT EXISTS (SELECT 1 FROM audit_workpapers w WHERE w.audit_file_id = NEW.audit_file_id AND w.status IN ('PREPARED','REVIEWED')) INTO workpaper_ready;
  SELECT NOT e.potential_pie OR e.eqr_status = 'Cleared' FROM engagements e WHERE e.engagement_id = NEW.engagement_id INTO eqr_ready;
  IF missing_planning OR missing_completion OR NOT tb_ready OR NOT workpaper_ready OR NOT COALESCE(eqr_ready, FALSE) THEN
    RAISE EXCEPTION 'Audit file cannot be archived until all closure controls are complete.';
  END IF;
  NEW.archived_at := COALESCE(NEW.archived_at, now());
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_files_archive_gate
BEFORE UPDATE OF file_status ON audit_files
FOR EACH ROW EXECUTE FUNCTION enforce_audit_file_archive();

CREATE VIEW v_audit_file_readiness AS
SELECT af.audit_file_id, af.engagement_id, af.reporting_year_end, af.file_status,
       tb.is_balanced AS trial_balance_balanced,
       COALESCE((SELECT bool_and(l.mapped_audit_area IS NOT NULL) FROM audit_trial_balance_lines l WHERE l.audit_trial_balance_id = tb.audit_trial_balance_id), FALSE) AS trial_balance_fully_mapped,
       EXISTS (SELECT 1 FROM audit_workpapers w WHERE w.audit_file_id = af.audit_file_id AND w.status IN ('PREPARED','REVIEWED')) AS has_prepared_workpaper,
       e.eqr_status
FROM audit_files af
JOIN engagements e ON e.engagement_id = af.engagement_id
LEFT JOIN audit_trial_balances tb ON tb.audit_file_id = af.audit_file_id;

-- Engagement channels and self-hosted virtual meetings.
-- Google Meet is the first managed provider. The external link is encrypted by
-- the API and returned only after channel and handling-firm checks. A Jitsi room
-- slug remains available for a later self-hosted provider.
CREATE TABLE engagement_channels (
  channel_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  parent_channel_id BIGINT REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type IN ('ENGAGEMENT','FIELDWORK_TEAM','MANAGER_REVIEW','PARTNER_REVIEW','TAX_COMPLIANCE')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE','ENGAGEMENT_TEAM')),
  created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ,
  UNIQUE (engagement_id, channel_name)
);

CREATE TABLE engagement_channel_members (
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  membership_role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (membership_role IN ('OWNER','HOST','MEMBER','READ_ONLY')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE channel_appointments (
  appointment_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','COMPLETED','CANCELLED')),
  attendee_note TEXT,
  created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE meeting_sessions (
  meeting_session_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  appointment_id BIGINT UNIQUE REFERENCES channel_appointments(appointment_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  meeting_provider TEXT NOT NULL DEFAULT 'GOOGLE_MEET' CHECK (meeting_provider IN ('JITSI_SELF_HOSTED','GOOGLE_MEET','ZOOM','MICROSOFT_TEAMS','PLUG_N_MEET')),
  external_meeting_id TEXT,
  join_url_ciphertext TEXT,
  room_slug TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','LIVE','ENDED','CANCELLED')),
  host_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  scheduled_start_at TIMESTAMPTZ NOT NULL,
  scheduled_end_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  minutes_hub_communication_id BIGINT UNIQUE REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  recording_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scheduled_end_at > scheduled_start_at),
  CHECK ((status <> 'ENDED') OR ended_at IS NOT NULL)
);

CREATE TABLE engagement_channel_messages (
  channel_message_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  meeting_session_id BIGINT REFERENCES meeting_sessions(meeting_session_id) ON DELETE SET NULL,
  author_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'MESSAGE' CHECK (message_type IN ('MESSAGE','SYSTEM','MEETING')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX engagement_channels_engagement ON engagement_channels (engagement_id, archived_at);
CREATE INDEX channel_appointments_schedule ON channel_appointments (channel_id, starts_at, status);
CREATE INDEX meeting_sessions_status ON meeting_sessions (handling_firm_id, status, scheduled_start_at);
CREATE INDEX engagement_channel_messages_timeline ON engagement_channel_messages (channel_id, created_at);

CREATE OR REPLACE FUNCTION enforce_engagement_channel_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_firm_id BIGINT;
  source_engagement_id BIGINT;
BEGIN
  SELECT handling_firm_id INTO source_firm_id FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF source_firm_id IS NULL OR source_firm_id <> NEW.handling_firm_id THEN
    RAISE EXCEPTION 'Channel and meeting records must inherit the handling firm of their engagement.';
  END IF;
  IF TG_TABLE_NAME = 'engagement_channels' AND NEW.parent_channel_id IS NOT NULL THEN
    SELECT engagement_id INTO source_engagement_id FROM engagement_channels WHERE channel_id = NEW.parent_channel_id;
    IF source_engagement_id IS DISTINCT FROM NEW.engagement_id THEN
      RAISE EXCEPTION 'A sub-channel must belong to the same engagement as its parent channel.';
    END IF;
  END IF;
  IF TG_TABLE_NAME IN ('channel_appointments','meeting_sessions') THEN
    SELECT engagement_id INTO source_engagement_id FROM engagement_channels WHERE channel_id = NEW.channel_id;
    IF source_engagement_id IS DISTINCT FROM NEW.engagement_id THEN
      RAISE EXCEPTION 'Channel appointment or meeting must use the channel engagement.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_channels_firm_guard
BEFORE INSERT OR UPDATE OF engagement_id, handling_firm_id, parent_channel_id ON engagement_channels
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_channel_chain();
CREATE TRIGGER channel_appointments_firm_guard
BEFORE INSERT OR UPDATE OF engagement_id, handling_firm_id, channel_id ON channel_appointments
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_channel_chain();
CREATE TRIGGER meeting_sessions_firm_guard
BEFORE INSERT OR UPDATE OF engagement_id, handling_firm_id, channel_id ON meeting_sessions
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_channel_chain();

-- Production-readiness controls: immutable audit history, controlled master data,
-- transaction correlation, firm/branch isolation, privacy operations and the
-- restricted external client portal. Apply these additions through a reviewed
-- migration before exposing the ERP to production data.

CREATE TABLE service_catalog (
  service_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  service_code TEXT NOT NULL UNIQUE,
  service_name TEXT NOT NULL UNIQUE,
  service_line TEXT NOT NULL CHECK (service_line IN ('AUDIT','TAX','ACCOUNTING','ADVISORY')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retired_at TIMESTAMPTZ
);

ALTER TABLE service_templates ADD COLUMN IF NOT EXISTS service_id BIGINT REFERENCES service_catalog(service_id) ON DELETE RESTRICT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS requested_service_id BIGINT REFERENCES service_catalog(service_id) ON DELETE RESTRICT;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS primary_service_id BIGINT REFERENCES service_catalog(service_id) ON DELETE RESTRICT;

CREATE TABLE engagement_services (
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  service_id BIGINT NOT NULL REFERENCES service_catalog(service_id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (engagement_id, service_id)
);

CREATE UNIQUE INDEX engagement_services_one_primary
ON engagement_services (engagement_id) WHERE is_primary;

-- Retire records rather than deleting evidence, finance or operational history.
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE client_contacts ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE engagements ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE active_engagement_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE active_engagement_tasks ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE active_engagement_tasks ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE timesheets ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE audit_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE audit_files ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE audit_files ADD COLUMN IF NOT EXISTS delete_reason TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS deleted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS delete_reason TEXT;

CREATE TABLE system_change_log (
  change_log_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firm_id BIGINT REFERENCES firms(firm_id) ON DELETE RESTRICT,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('INSERT','UPDATE','SOFT_DELETE','RESTORE','SUPERSEDE','STATUS_CHANGE')),
  before_value JSONB,
  after_value JSONB,
  changed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  change_reason TEXT,
  correlation_id UUID,
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX system_change_log_record ON system_change_log (record_type, record_id, changed_at DESC);
CREATE INDEX system_change_log_firm_time ON system_change_log (firm_id, changed_at DESC);

CREATE OR REPLACE FUNCTION prevent_system_change_log_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'System change log is append-only.';
END;
$$;

DROP TRIGGER IF EXISTS system_change_log_immutable ON system_change_log;
CREATE TRIGGER system_change_log_immutable
BEFORE UPDATE OR DELETE ON system_change_log
FOR EACH ROW EXECUTE FUNCTION prevent_system_change_log_mutation();

CREATE OR REPLACE FUNCTION reject_hard_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Hard deletion is not permitted. Archive, reverse or supersede the record instead.';
END;
$$;

CREATE OR REPLACE FUNCTION write_system_change_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  before_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  after_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  action_name TEXT;
  actor_id BIGINT := NULLIF(current_setting('app.user_id', true), '')::BIGINT;
  tenant_firm_id BIGINT;
  business_record_id TEXT;
BEGIN
  tenant_firm_id := NULLIF(COALESCE(after_row ->> TG_ARGV[0], before_row ->> TG_ARGV[0]), '')::BIGINT;
  business_record_id := COALESCE(after_row ->> TG_ARGV[1], before_row ->> TG_ARGV[1]);
  action_name := CASE
    WHEN TG_OP = 'INSERT' THEN 'INSERT'
    WHEN COALESCE(after_row ->> 'deleted_at', '') <> '' AND COALESCE(before_row ->> 'deleted_at', '') = '' THEN 'SOFT_DELETE'
    WHEN COALESCE(after_row ->> 'deleted_at', '') = '' AND COALESCE(before_row ->> 'deleted_at', '') <> '' THEN 'RESTORE'
    ELSE 'UPDATE'
  END;
  INSERT INTO system_change_log (firm_id, record_type, record_id, action_type, before_value, after_value, changed_by_user_id, change_reason, correlation_id, ip_address, user_agent)
  VALUES (
    tenant_firm_id, TG_ARGV[2], COALESCE(business_record_id, 'unknown'), action_name,
    before_row, after_row, actor_id, NULLIF(current_setting('app.change_reason', true), ''),
    NULLIF(current_setting('app.correlation_id', true), '')::UUID,
    NULLIF(current_setting('app.ip_address', true), '')::INET,
    NULLIF(current_setting('app.user_agent', true), '')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS clients_no_hard_delete ON clients;
CREATE TRIGGER clients_no_hard_delete BEFORE DELETE ON clients FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS users_no_hard_delete ON users;
CREATE TRIGGER users_no_hard_delete BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS client_contacts_no_hard_delete ON client_contacts;
CREATE TRIGGER client_contacts_no_hard_delete BEFORE DELETE ON client_contacts FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS leads_no_hard_delete ON leads;
CREATE TRIGGER leads_no_hard_delete BEFORE DELETE ON leads FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS engagements_no_hard_delete ON engagements;
CREATE TRIGGER engagements_no_hard_delete BEFORE DELETE ON engagements FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS active_engagement_tasks_no_hard_delete ON active_engagement_tasks;
CREATE TRIGGER active_engagement_tasks_no_hard_delete BEFORE DELETE ON active_engagement_tasks FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS timesheets_no_hard_delete ON timesheets;
CREATE TRIGGER timesheets_no_hard_delete BEFORE DELETE ON timesheets FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS invoices_no_hard_delete ON invoices;
CREATE TRIGGER invoices_no_hard_delete BEFORE DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS documents_no_hard_delete ON documents;
CREATE TRIGGER documents_no_hard_delete BEFORE DELETE ON documents FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS audit_files_no_hard_delete ON audit_files;
CREATE TRIGGER audit_files_no_hard_delete BEFORE DELETE ON audit_files FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();
DROP TRIGGER IF EXISTS tickets_no_hard_delete ON tickets;
CREATE TRIGGER tickets_no_hard_delete BEFORE DELETE ON tickets FOR EACH ROW EXECUTE FUNCTION reject_hard_delete();

DROP TRIGGER IF EXISTS clients_change_log ON clients;
CREATE TRIGGER clients_change_log AFTER INSERT OR UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION write_system_change_log('default_firm_id','client_id','CLIENT');
DROP TRIGGER IF EXISTS leads_change_log ON leads;
CREATE TRIGGER leads_change_log AFTER INSERT OR UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','lead_id','LEAD');
DROP TRIGGER IF EXISTS engagements_change_log ON engagements;
CREATE TRIGGER engagements_change_log AFTER INSERT OR UPDATE ON engagements FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','engagement_id','ENGAGEMENT');
DROP TRIGGER IF EXISTS timesheets_change_log ON timesheets;
CREATE TRIGGER timesheets_change_log AFTER INSERT OR UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','timesheet_id','TIMESHEET');
DROP TRIGGER IF EXISTS invoices_change_log ON invoices;
CREATE TRIGGER invoices_change_log AFTER INSERT OR UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','invoice_id','INVOICE');
DROP TRIGGER IF EXISTS documents_change_log ON documents;
CREATE TRIGGER documents_change_log AFTER INSERT OR UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','document_id','DOCUMENT');
DROP TRIGGER IF EXISTS audit_files_change_log ON audit_files;
CREATE TRIGGER audit_files_change_log AFTER INSERT OR UPDATE ON audit_files FOR EACH ROW EXECUTE FUNCTION write_system_change_log('handling_firm_id','audit_file_id','AUDIT_FILE');

-- One activation command is correlated and idempotent. The API must create the
-- run, engagement, financial baseline, workflow tasks and outbox events inside
-- one database transaction, then mark the run COMPLETED before COMMIT.
CREATE TABLE engagement_activation_runs (
  activation_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key UUID NOT NULL UNIQUE,
  source_lead_id BIGINT NOT NULL REFERENCES leads(lead_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'STARTED' CHECK (status IN ('STARTED','COMPLETED','ROLLED_BACK','FAILED')),
  failure_detail TEXT,
  created_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE transaction_outbox (
  outbox_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  correlation_id UUID NOT NULL,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id BIGINT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  failure_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (correlation_id, event_type, aggregate_type, aggregate_id)
);

CREATE TABLE user_branch_access (
  user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  branch_location TEXT NOT NULL CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  can_manage_all_branch_records BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, firm_id, branch_location)
);

CREATE OR REPLACE FUNCTION app_user_id()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::BIGINT;
$$;

CREATE OR REPLACE FUNCTION app_has_firm_access(target_firm_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_firm_access ufa
    WHERE ufa.user_id = app_user_id() AND ufa.firm_id = target_firm_id
  );
$$;

CREATE OR REPLACE FUNCTION app_has_branch_access(target_firm_id BIGINT, target_branch TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_firm_access ufa
    WHERE ufa.user_id = app_user_id() AND ufa.firm_id = target_firm_id AND ufa.can_manage_all_firm_records
  ) OR EXISTS (
    SELECT 1 FROM user_branch_access uba
    WHERE uba.user_id = app_user_id() AND uba.firm_id = target_firm_id
      AND (uba.can_manage_all_branch_records OR uba.branch_location = target_branch)
  );
$$;

DROP POLICY IF EXISTS opportunities_by_firm_access ON opportunities;
DROP POLICY IF EXISTS engagement_contracts_by_firm_access ON engagement_contracts;
DROP POLICY IF EXISTS engagements_by_firm_access ON engagements;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_engagement_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_change_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_by_firm_branch ON clients FOR ALL
USING (app_has_branch_access(default_firm_id, branch_location))
WITH CHECK (app_has_branch_access(default_firm_id, branch_location));
CREATE POLICY contacts_by_client_access ON client_contacts FOR ALL
USING (EXISTS (SELECT 1 FROM clients c WHERE c.client_id = client_contacts.client_id AND app_has_branch_access(c.default_firm_id, c.branch_location)))
WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.client_id = client_contacts.client_id AND app_has_branch_access(c.default_firm_id, c.branch_location)));
CREATE POLICY leads_by_firm_branch ON leads FOR ALL
USING (app_has_branch_access(handling_firm_id, branch_location))
WITH CHECK (app_has_branch_access(handling_firm_id, branch_location));
CREATE POLICY engagements_by_firm_access ON engagements FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY tasks_by_engagement_access ON active_engagement_tasks FOR ALL
USING (EXISTS (SELECT 1 FROM engagements e WHERE e.engagement_id = active_engagement_tasks.engagement_id AND app_has_firm_access(e.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.engagement_id = active_engagement_tasks.engagement_id AND app_has_firm_access(e.handling_firm_id)));
CREATE POLICY timesheets_by_firm_access ON timesheets FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY invoices_by_firm_access ON invoices FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY documents_by_firm_access ON documents FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY audit_files_by_firm_access ON audit_files FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY tickets_by_firm_access ON tickets FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY opportunities_by_firm_access ON opportunities FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY engagement_contracts_by_firm_access ON engagement_contracts FOR ALL
USING (app_has_firm_access(handling_firm_id))
WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY system_change_log_read_by_firm ON system_change_log FOR SELECT
USING (app_has_firm_access(firm_id));
CREATE POLICY system_change_log_append_by_firm ON system_change_log FOR INSERT
WITH CHECK (firm_id IS NULL OR app_has_firm_access(firm_id));

-- Client portal: portal accounts are limited to explicitly granted clients. They
-- never receive staff, workpaper, internal-note or unapproved-document access.
CREATE TABLE client_portal_accounts (
  portal_account_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contact_id BIGINT NOT NULL UNIQUE REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  login_identifier TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED','ACTIVE','SUSPENDED','REVOKED')),
  mfa_required BOOLEAN NOT NULL DEFAULT TRUE,
  last_authenticated_at TIMESTAMPTZ,
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE client_portal_access (
  portal_account_id BIGINT NOT NULL REFERENCES client_portal_accounts(portal_account_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  granted_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (portal_account_id, client_id)
);

CREATE TABLE portal_pbc_requests (
  portal_pbc_request_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  requested_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  request_title TEXT NOT NULL,
  request_detail TEXT,
  upload_token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  single_use BOOLEAN NOT NULL DEFAULT TRUE,
  consumed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UPLOADED','EXPIRED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE documents ADD COLUMN IF NOT EXISTS client_released_at TIMESTAMPTZ;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS client_released_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS client_release_note TEXT;

CREATE OR REPLACE FUNCTION enforce_client_document_release()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.client_released_at IS NOT NULL AND (NOT NEW.is_locked OR NEW.client_released_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'Only a locked final document with a recorded releasing user can be released to the client portal.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_client_release_guard ON documents;
CREATE TRIGGER documents_client_release_guard
BEFORE INSERT OR UPDATE OF client_released_at, client_released_by_user_id, is_locked ON documents
FOR EACH ROW EXECUTE FUNCTION enforce_client_document_release();

CREATE TABLE data_retention_policies (
  retention_policy_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  record_category TEXT NOT NULL UNIQUE,
  retention_basis TEXT NOT NULL,
  retention_period_months INTEGER NOT NULL CHECK (retention_period_months > 0),
  disposal_method TEXT NOT NULL CHECK (disposal_method IN ('DELETE','ANONYMISE','PSEUDONYMISE','ARCHIVE_RESTRICTED')),
  approved_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE legal_holds (
  legal_hold_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firm_id BIGINT REFERENCES firms(firm_id) ON DELETE RESTRICT,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  placed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  released_at TIMESTAMPTZ
);

CREATE TABLE data_subject_requests (
  request_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT REFERENCES clients(client_id) ON DELETE RESTRICT,
  contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  request_type TEXT NOT NULL CHECK (request_type IN ('ACCESS','CORRECTION','ERASURE','RESTRICTION','OBJECTION','PORTABILITY')),
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','VERIFYING_IDENTITY','UNDER_REVIEW','FULFILLED','PARTIALLY_FULFILLED','REFUSED','CLOSED')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_at TIMESTAMPTZ,
  decision_reason TEXT,
  legal_hold_checked_at TIMESTAMPTZ,
  decided_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ
);

CREATE TABLE privacy_incidents (
  privacy_incident_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT REFERENCES firms(firm_id) ON DELETE RESTRICT,
  incident_reference TEXT NOT NULL UNIQUE,
  detected_at TIMESTAMPTZ NOT NULL,
  reported_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONTAINED','ASSESSING','NOTIFIED','CLOSED')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  affected_data_description TEXT NOT NULL,
  containment_actions TEXT,
  odpc_notification_due_at TIMESTAMPTZ,
  odpc_notified_at TIMESTAMPTZ,
  data_subject_notification_due_at TIMESTAMPTZ,
  data_subject_notified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);

CREATE TABLE backup_restore_tests (
  backup_restore_test_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  backup_reference TEXT NOT NULL,
  backup_created_at TIMESTAMPTZ NOT NULL,
  restore_started_at TIMESTAMPTZ NOT NULL,
  restore_completed_at TIMESTAMPTZ,
  result TEXT NOT NULL CHECK (result IN ('PASSED','FAILED','PARTIAL')),
  recovery_point_achieved_at TIMESTAMPTZ,
  evidence_reference TEXT NOT NULL,
  tested_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  notes TEXT
);

CREATE INDEX portal_pbc_open_expiry ON portal_pbc_requests (status, expires_at) WHERE status = 'OPEN';
CREATE INDEX privacy_incidents_deadline ON privacy_incidents (status, odpc_notification_due_at) WHERE status <> 'CLOSED';
CREATE INDEX data_subject_requests_status ON data_subject_requests (status, due_at);

CREATE OR REPLACE FUNCTION app_portal_account_id()
RETURNS BIGINT LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.portal_account_id', true), '')::BIGINT;
$$;

CREATE OR REPLACE FUNCTION app_portal_has_client_access(target_client_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM client_portal_access cpa
    JOIN client_portal_accounts cpae ON cpae.portal_account_id = cpa.portal_account_id
    WHERE cpa.portal_account_id = app_portal_account_id()
      AND cpa.client_id = target_client_id
      AND cpa.revoked_at IS NULL
      AND cpae.status = 'ACTIVE'
  );
$$;

CREATE OR REPLACE VIEW v_client_portal_invoices WITH (security_barrier = true) AS
SELECT i.invoice_id, i.invoice_number, i.service_description, i.amount_billed, i.vat_amount,
       i.date_issued, i.due_date, i.invoice_status, i.date_paid, i.payment_reference,
       e.client_id, e.engagement_id
FROM invoices i
JOIN engagements e ON e.engagement_id = i.engagement_id
WHERE i.deleted_at IS NULL AND app_portal_has_client_access(e.client_id);

CREATE OR REPLACE VIEW v_client_portal_engagement_status WITH (security_barrier = true) AS
SELECT e.engagement_id, e.client_id,
       CASE e.lifecycle_stage
         WHEN 'Active Engagement' THEN 'Work in progress'
         WHEN 'WIP / Billing' THEN 'Completion and billing in progress'
         WHEN 'Closed / Archived' THEN 'Completed'
         ELSE 'Engagement setup in progress'
       END AS client_visible_status,
       e.activated_at, e.finalized_at
FROM engagements e
WHERE e.deleted_at IS NULL AND app_portal_has_client_access(e.client_id);

CREATE OR REPLACE VIEW v_client_portal_final_reports WITH (security_barrier = true) AS
SELECT d.document_id, d.client_id, d.engagement_id, d.file_name, d.version_no,
       d.client_released_at, d.client_release_note
FROM documents d
WHERE d.deleted_at IS NULL AND d.client_released_at IS NOT NULL
  AND app_portal_has_client_access(d.client_id);

INSERT INTO notification_templates (alert_code, channel, subject_template, body_template, is_mandatory) VALUES
  ('PRIVACY_INCIDENT_OPEN','IN_APP','Privacy incident opened','Contain the incident, assess affected data and assign the incident owner.',TRUE),
  ('PRIVACY_INCIDENT_ODPC_DUE','EMAIL','ODPC notification deadline','A privacy incident requires urgent notification assessment.',TRUE),
  ('DATA_SUBJECT_REQUEST_DUE','EMAIL','Data-subject request due','Review the request, retention basis and legal holds before disposition.',TRUE),
  ('BACKUP_RESTORE_TEST_DUE','IN_APP','Backup restore test due','Run and evidence a controlled restore test.',TRUE)
ON CONFLICT (alert_code) DO NOTHING;

-- CRM qualification, opportunity, routing and contract-renewal extension.
-- The terms below deliberately distinguish legal firms from branches: a firm owns
-- the engagement, a branch delivers it, a service line describes the work and a
-- specialist queue performs controlled routing.
ALTER TABLE leads
  ADD COLUMN lead_source TEXT CHECK (lead_source IN ('Referral','Website','Networking','Existing Client (Cross-sell)','Tender')),
  ADD COLUMN lead_temperature TEXT NOT NULL DEFAULT 'Cold' CHECK (lead_temperature IN ('Cold','Warm','Hot')),
  ADD COLUMN expected_close_date DATE,
  ADD COLUMN opportunity_owner_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN next_activity_type TEXT,
  ADD COLUMN next_activity_due_date DATE;

CREATE TABLE routing_rules (
  routing_rule_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  branch_location TEXT NOT NULL CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  primary_sector TEXT,
  service_line TEXT NOT NULL CHECK (service_line IN ('Audit','Tax','Accounting','Advisory')),
  requested_service TEXT,
  branch_owner_role_name TEXT NOT NULL,
  specialist_team_name TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 999),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX routing_rules_match ON routing_rules (handling_firm_id, branch_location, primary_sector, service_line, priority)
WHERE is_active;

ALTER TABLE leads
  ADD COLUMN routing_rule_id BIGINT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL;

CREATE TABLE opportunities (
  opportunity_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_lead_id BIGINT NOT NULL UNIQUE REFERENCES leads(lead_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  routing_rule_id BIGINT REFERENCES routing_rules(routing_rule_id) ON DELETE SET NULL,
  opportunity_status TEXT NOT NULL CHECK (opportunity_status IN ('QUALIFIED','QUOTATION_SENT','CONTRACT_ACCEPTED','CONVERTED_TO_ENGAGEMENT','LOST','CLOSED')),
  probability_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (probability_percent BETWEEN 0 AND 100),
  estimated_fee NUMERIC(16,2) CHECK (estimated_fee >= 0),
  expected_close_date DATE,
  owner_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  qualified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  converted_engagement_id BIGINT UNIQUE REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  lost_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX opportunities_firm_status ON opportunities (handling_firm_id, opportunity_status, expected_close_date);

CREATE OR REPLACE FUNCTION enforce_opportunity_lead_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE lead_firm_id BIGINT; lead_client_id BIGINT;
BEGIN
  SELECT handling_firm_id, client_id INTO lead_firm_id, lead_client_id FROM leads WHERE lead_id = NEW.source_lead_id;
  IF lead_firm_id IS DISTINCT FROM NEW.handling_firm_id OR lead_client_id IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'Opportunity must inherit both handling firm and client from its source lead';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.handling_firm_id IS DISTINCT FROM OLD.handling_firm_id THEN
    RAISE EXCEPTION 'Opportunity firm is immutable. Create a separate lead and opportunity for another firm.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunities_lead_chain_guard
BEFORE INSERT OR UPDATE OF source_lead_id, handling_firm_id, client_id ON opportunities
FOR EACH ROW EXECUTE FUNCTION enforce_opportunity_lead_chain();

ALTER TABLE engagements
  ADD COLUMN renewal_of_engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT;

CREATE TABLE engagement_contracts (
  contract_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  engagement_id BIGINT NOT NULL UNIQUE REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  contract_type TEXT NOT NULL CHECK (contract_type IN ('ONE_OFF','ANNUAL_AUDIT','RECURRING_RETAINER')),
  contract_status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (contract_status IN ('DRAFT','ACCEPTED','SUPERSEDED','EXPIRED','CANCELLED')),
  signed_el_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  effective_date DATE,
  expiry_date DATE,
  renewal_opportunity_id BIGINT REFERENCES opportunities(opportunity_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  CHECK (expiry_date IS NULL OR effective_date IS NULL OR expiry_date >= effective_date),
  CHECK (contract_type = 'ONE_OFF' OR (effective_date IS NOT NULL AND expiry_date IS NOT NULL))
);

CREATE INDEX engagement_contracts_renewal ON engagement_contracts (handling_firm_id, expiry_date)
WHERE contract_status = 'ACCEPTED';

CREATE OR REPLACE FUNCTION enforce_contract_engagement_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE engagement_firm_id BIGINT;
BEGIN
  SELECT handling_firm_id INTO engagement_firm_id FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF engagement_firm_id IS DISTINCT FROM NEW.handling_firm_id THEN
    RAISE EXCEPTION 'Contract handling firm must match its engagement handling firm';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.contract_status = 'ACCEPTED' AND NEW.signed_el_document_id IS DISTINCT FROM OLD.signed_el_document_id THEN
    RAISE EXCEPTION 'A signed Engagement Letter is immutable. Create a renewal or superseding contract instead.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER engagement_contracts_chain_guard
BEFORE INSERT OR UPDATE ON engagement_contracts
FOR EACH ROW EXECUTE FUNCTION enforce_contract_engagement_chain();

ALTER TABLE communication_hub
  ADD COLUMN activity_type TEXT CHECK (activity_type IN ('QUALIFYING_CALL','SCOPING_MEETING','PROPOSAL_FOLLOW_UP','CLIENT_VISIT','FIELDWORK_VISIT','EL_NEGOTIATION','PBC_REQUEST','GENERAL'));

INSERT INTO notification_templates (alert_code, channel, subject_template, body_template, is_mandatory) VALUES
  ('OPPORTUNITY_NEXT_ACTIVITY_MISSING','IN_APP','Opportunity next activity missing','A Warm or Hot opportunity requires a controlled next activity and due date.',TRUE),
  ('OPPORTUNITY_FOLLOW_UP_DUE','EMAIL','Opportunity follow-up due','The recorded next activity is due or overdue.',TRUE),
  ('CONTRACT_RENEWAL_60','EMAIL','Contract renewal planning required','Contract expiry is within 60 days. Plan renewal, KYC refresh and acceptance checks.',TRUE),
  ('CONTRACT_RENEWAL_30','EMAIL','Contract renewal action required','Contract expiry is within 30 days. Start a separate renewal opportunity and new EL cycle.',TRUE)
ON CONFLICT (alert_code) DO NOTHING;

CREATE OR REPLACE VIEW v_crm_pipeline_analytics AS
SELECT l.handling_firm_id, l.branch_location, c.primary_sector, l.requested_service,
       l.lead_source, l.lead_temperature, l.stage,
       o.opportunity_status, o.probability_percent, o.expected_close_date,
       (l.stage IN ('Active Engagement','WIP / Billing','Closed / Archived')) AS converted_to_engagement
FROM leads l
JOIN clients c ON c.client_id = l.client_id
LEFT JOIN opportunities o ON o.source_lead_id = l.lead_id;

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY opportunities_by_firm_access ON opportunities
USING (EXISTS (
  SELECT 1 FROM user_firm_access ufa
  WHERE ufa.firm_id = opportunities.handling_firm_id
    AND ufa.user_id = NULLIF(current_setting('app.user_id', true), '')::BIGINT
));

ALTER TABLE engagement_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY engagement_contracts_by_firm_access ON engagement_contracts
USING (EXISTS (
  SELECT 1 FROM user_firm_access ufa
  WHERE ufa.firm_id = engagement_contracts.handling_firm_id
    AND ufa.user_id = NULLIF(current_setting('app.user_id', true), '')::BIGINT
));

-- All engagement-linked operational records carry a denormalised firm key for
-- fast row-level security and reporting. The trigger stops cross-firm children
-- even if a caller tampers with an API payload.
CREATE OR REPLACE FUNCTION enforce_engagement_child_firm()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE expected_firm_id BIGINT;
BEGIN
  IF NEW.engagement_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT handling_firm_id INTO expected_firm_id
  FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF expected_firm_id IS NULL THEN
    RAISE EXCEPTION 'Engagement does not exist or has no handling firm';
  END IF;
  IF NEW.handling_firm_id IS DISTINCT FROM expected_firm_id THEN
    RAISE EXCEPTION 'Child record firm must match the engagement handling firm';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER timesheets_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON timesheets
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER documents_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON documents
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER staff_assignments_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON staff_assignments
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER performance_reviews_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON performance_reviews
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER tickets_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON tickets
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER client_site_visits_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON client_site_visits
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE TRIGGER audit_files_handling_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON audit_files
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_child_firm();

CREATE INDEX engagements_handling_firm_stage ON engagements (handling_firm_id, lifecycle_stage);
CREATE INDEX leads_handling_firm_stage ON leads (handling_firm_id, stage);
CREATE INDEX invoices_handling_firm_status ON invoices (handling_firm_id, invoice_status, due_date);
CREATE INDEX communication_hub_handling_firm_time ON communication_hub (handling_firm_id, communication_at DESC);
CREATE INDEX documents_handling_firm ON documents (handling_firm_id, engagement_id);
CREATE INDEX audit_files_handling_firm ON audit_files (handling_firm_id, engagement_id);
CREATE INDEX tickets_handling_firm ON tickets (handling_firm_id, status, sla_due_at);

-- Production APIs must set the acting user in the transaction context, then apply
-- this policy family (or equivalent application record rules) to every firm-owned
-- table. Users with global partner access receive explicit rows for all firms.
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
CREATE POLICY engagements_by_firm_access ON engagements
USING (EXISTS (
  SELECT 1 FROM user_firm_access ufa
  WHERE ufa.firm_id = engagements.handling_firm_id
    AND ufa.user_id = NULLIF(current_setting('app.user_id', true), '')::BIGINT
));

-- General-audit fieldwork controls. These tables retain the evidence trail that
-- sits between planning and completion: source provenance, reconciliation,
-- sample finalisation, detailed testing and the treatment of exceptions.
CREATE TABLE audit_population_controls (
  audit_population_control_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  audit_area TEXT NOT NULL,
  population_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('NATIVE_SYSTEM_EXTRACT','CLIENT_SCHEDULE','EXTERNAL_CONFIRMATION','PHYSICAL_COUNT_RECORD','OTHER_SUPPORTING_RECORD')),
  source_system_or_module TEXT NOT NULL,
  report_parameters TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  generated_by_reference TEXT NOT NULL,
  row_count BIGINT NOT NULL CHECK (row_count > 0),
  control_total NUMERIC(18,2) NOT NULL,
  tb_gl_reference TEXT NOT NULL,
  reporting_period TEXT NOT NULL,
  vault_source_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','CONTROLLED','REJECTED')),
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, audit_area, population_name)
);

CREATE TABLE audit_reconciliations (
  audit_reconciliation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  audit_population_control_id BIGINT NOT NULL REFERENCES audit_population_controls(audit_population_control_id) ON DELETE RESTRICT,
  control_reference TEXT NOT NULL,
  account_description TEXT NOT NULL,
  opening_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  additions NUMERIC(18,2) NOT NULL DEFAULT 0,
  reductions NUMERIC(18,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(18,2) NOT NULL,
  tb_gl_balance NUMERIC(18,2) NOT NULL,
  difference NUMERIC(18,2) NOT NULL,
  clearance_reference TEXT,
  prepared_by_reference TEXT NOT NULL,
  reviewed_by_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CLEARED','EXCEPTION')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, control_reference)
);

CREATE TABLE audit_samples (
  audit_sample_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  audit_population_control_id BIGINT NOT NULL REFERENCES audit_population_controls(audit_population_control_id) ON DELETE RESTRICT,
  audit_area TEXT NOT NULL,
  sample_reference TEXT NOT NULL,
  selection_stage TEXT NOT NULL DEFAULT 'PROVISIONAL' CHECK (selection_stage IN ('PROVISIONAL','FINAL','TESTED_NO_EXCEPTION','EXCEPTION')),
  selection_rationale TEXT NOT NULL,
  document_reference TEXT,
  counterparty_or_item_reference TEXT,
  item_description TEXT NOT NULL,
  amount NUMERIC(18,2),
  assertion TEXT NOT NULL,
  procedure_performed TEXT NOT NULL,
  evidence_reference TEXT,
  target_workpaper_reference TEXT,
  physical_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, sample_reference)
);

CREATE TABLE audit_exceptions (
  audit_exception_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  audit_file_id BIGINT NOT NULL REFERENCES audit_files(audit_file_id) ON DELETE RESTRICT,
  exception_reference TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('CONTROL_DEFICIENCY','ADJUSTED_MISSTATEMENT','UNADJUSTED_MISSTATEMENT','SCOPE_LIMITATION','OTHER_AUDIT_MATTER')),
  related_reference TEXT,
  workpaper_reference TEXT,
  amount NUMERIC(18,2),
  nature TEXT NOT NULL,
  affected_assertion TEXT,
  management_explanation TEXT,
  further_audit_procedure TEXT,
  management_response_or_correction TEXT,
  balance_sheet_dr NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance_sheet_cr NUMERIC(18,2) NOT NULL DEFAULT 0,
  profit_or_loss_dr NUMERIC(18,2) NOT NULL DEFAULT 0,
  profit_or_loss_cr NUMERIC(18,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLEARED','ADJUSTED','REPORTED_AS_UNADJUSTED')),
  reporting_implication TEXT,
  conclusion TEXT NOT NULL,
  prepared_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (audit_file_id, exception_reference)
);

CREATE INDEX audit_population_controls_file_area ON audit_population_controls (audit_file_id, audit_area);
CREATE INDEX audit_reconciliations_file_population ON audit_reconciliations (audit_file_id, audit_population_control_id);
CREATE INDEX audit_samples_file_population ON audit_samples (audit_file_id, audit_population_control_id, selection_stage);
CREATE INDEX audit_exceptions_file_status ON audit_exceptions (audit_file_id, status);

CREATE OR REPLACE FUNCTION validate_audit_population_control()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CONTROLLED' AND (
    NEW.row_count <= 0 OR NEW.control_total IS NULL OR
    NULLIF(trim(NEW.report_parameters), '') IS NULL OR
    NULLIF(trim(NEW.generated_by_reference), '') IS NULL OR
    NULLIF(trim(NEW.tb_gl_reference), '') IS NULL OR
    NULLIF(trim(NEW.reporting_period), '') IS NULL OR
    NULLIF(trim(NEW.vault_source_reference), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'A controlled audit population requires provenance, control total, TB/GL bridge and vault reference.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_population_control_gate
BEFORE INSERT OR UPDATE ON audit_population_controls
FOR EACH ROW EXECUTE FUNCTION validate_audit_population_control();

CREATE OR REPLACE FUNCTION validate_audit_reconciliation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.closing_balance := NEW.opening_balance + NEW.additions - NEW.reductions;
  NEW.difference := NEW.closing_balance - NEW.tb_gl_balance;
  IF NEW.status = 'CLEARED' AND (
    abs(NEW.difference) >= 0.01 OR
    NULLIF(trim(COALESCE(NEW.clearance_reference, '')), '') IS NULL OR
    NULLIF(trim(NEW.prepared_by_reference), '') IS NULL OR
    NULLIF(trim(NEW.reviewed_by_reference), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'A cleared reconciliation must balance to zero and contain its clearance, preparer and reviewer.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_population_controls p
    WHERE p.audit_population_control_id = NEW.audit_population_control_id
      AND p.audit_file_id = NEW.audit_file_id
  ) THEN
    RAISE EXCEPTION 'The reconciliation population must belong to the same audit file.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_reconciliation_gate
BEFORE INSERT OR UPDATE ON audit_reconciliations
FOR EACH ROW EXECUTE FUNCTION validate_audit_reconciliation();

CREATE OR REPLACE FUNCTION enforce_audit_sample_finalisation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE population_ready BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_population_controls p
    WHERE p.audit_population_control_id = NEW.audit_population_control_id
      AND p.audit_file_id = NEW.audit_file_id
      AND p.audit_area = NEW.audit_area
  ) THEN
    RAISE EXCEPTION 'The sample must use a source population from the same audit file and audit area.';
  END IF;
  IF NEW.selection_stage <> 'PROVISIONAL' THEN
    SELECT p.status = 'CONTROLLED' AND EXISTS (
      SELECT 1 FROM audit_reconciliations r
      WHERE r.audit_file_id = NEW.audit_file_id
        AND r.audit_population_control_id = p.audit_population_control_id
        AND r.status = 'CLEARED' AND abs(r.difference) < 0.01
    ) INTO population_ready
    FROM audit_population_controls p
    WHERE p.audit_population_control_id = NEW.audit_population_control_id;
    IF NOT COALESCE(population_ready, FALSE) THEN
      RAISE EXCEPTION 'Final or tested samples require a controlled source population and cleared TB/GL reconciliation.';
    END IF;
  END IF;
  IF NEW.selection_stage = 'TESTED_NO_EXCEPTION' AND NULLIF(trim(COALESCE(NEW.evidence_reference, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A tested sample requires an evidence reference.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_sample_finalisation_gate
BEFORE INSERT OR UPDATE ON audit_samples
FOR EACH ROW EXECUTE FUNCTION enforce_audit_sample_finalisation();

CREATE OR REPLACE FUNCTION validate_audit_exception_disposition()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'REPORTED_AS_UNADJUSTED' AND (
    NULLIF(trim(COALESCE(NEW.reporting_implication, '')), '') IS NULL OR
    NULLIF(trim(NEW.conclusion), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'A reported unadjusted error requires a reporting implication and conclusion.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER audit_exception_disposition_gate
BEFORE INSERT OR UPDATE ON audit_exceptions
FOR EACH ROW EXECUTE FUNCTION validate_audit_exception_disposition();

-- Replaces the earlier archive check with the controlled fieldwork gate.
CREATE OR REPLACE FUNCTION enforce_audit_file_archive()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  missing_planning BOOLEAN;
  missing_completion BOOLEAN;
  tb_ready BOOLEAN;
  workpaper_ready BOOLEAN;
  fieldwork_ready BOOLEAN;
  eqr_ready BOOLEAN;
BEGIN
  IF OLD.file_status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'Archived audit files are immutable. Create a subsequent annual audit file.';
  END IF;
  IF NEW.file_status <> 'ARCHIVED' THEN RETURN NEW; END IF;
  IF NEW.archived_by_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = NEW.archived_by_user_id AND r.role_name = 'Engagement Partner'
  ) THEN RAISE EXCEPTION 'Only the Engagement Partner can archive an audit file.'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM (VALUES ('Overall audit strategy and plan'),('Client acceptance and continuance'),('Materiality'),('Risk assessment and response'),('Fraud risk')) required(area)
    WHERE NOT EXISTS (SELECT 1 FROM audit_planning_controls p WHERE p.audit_file_id = NEW.audit_file_id AND p.planning_area = required.area AND p.status IN ('COMPLETE','REVIEWED'))
  ) INTO missing_planning;
  SELECT EXISTS (
    SELECT 1 FROM (VALUES ('Overall audit conclusion'),('Calling-over checklist'),('Partner review'),('Subsequent events'),('Going concern'),('Signed representation letter')) required(item_type)
    WHERE NOT EXISTS (SELECT 1 FROM audit_completion_items c WHERE c.audit_file_id = NEW.audit_file_id AND c.item_type = required.item_type AND c.status IN ('COMPLETE','REVIEWED'))
  ) INTO missing_completion;
  SELECT EXISTS (SELECT 1 FROM audit_trial_balances tb WHERE tb.audit_file_id = NEW.audit_file_id AND tb.is_balanced)
     AND NOT EXISTS (SELECT 1 FROM audit_trial_balance_lines l JOIN audit_trial_balances tb ON tb.audit_trial_balance_id = l.audit_trial_balance_id WHERE tb.audit_file_id = NEW.audit_file_id AND l.mapped_audit_area IS NULL)
  INTO tb_ready;
  SELECT EXISTS (SELECT 1 FROM audit_workpapers w WHERE w.audit_file_id = NEW.audit_file_id AND w.status IN ('PREPARED','REVIEWED')) INTO workpaper_ready;
  SELECT EXISTS (SELECT 1 FROM audit_population_controls p WHERE p.audit_file_id = NEW.audit_file_id)
     AND NOT EXISTS (SELECT 1 FROM audit_population_controls p WHERE p.audit_file_id = NEW.audit_file_id AND p.status <> 'CONTROLLED')
     AND NOT EXISTS (SELECT 1 FROM audit_population_controls p WHERE p.audit_file_id = NEW.audit_file_id AND NOT EXISTS (SELECT 1 FROM audit_reconciliations r WHERE r.audit_file_id = NEW.audit_file_id AND r.audit_population_control_id = p.audit_population_control_id AND r.status = 'CLEARED' AND abs(r.difference) < 0.01))
     AND NOT EXISTS (SELECT 1 FROM audit_samples s WHERE s.audit_file_id = NEW.audit_file_id AND s.selection_stage = 'PROVISIONAL')
     AND NOT EXISTS (SELECT 1 FROM audit_samples s WHERE s.audit_file_id = NEW.audit_file_id AND s.selection_stage = 'EXCEPTION' AND NOT EXISTS (SELECT 1 FROM audit_exceptions x WHERE x.audit_file_id = NEW.audit_file_id AND x.related_reference = s.sample_reference AND x.status <> 'OPEN'))
     AND NOT EXISTS (SELECT 1 FROM audit_exceptions x WHERE x.audit_file_id = NEW.audit_file_id AND x.status = 'OPEN')
  INTO fieldwork_ready;
  SELECT NOT e.potential_pie OR e.eqr_status = 'Cleared' FROM engagements e WHERE e.engagement_id = NEW.engagement_id INTO eqr_ready;
  IF missing_planning OR missing_completion OR NOT tb_ready OR NOT workpaper_ready OR NOT COALESCE(fieldwork_ready, FALSE) OR NOT COALESCE(eqr_ready, FALSE) THEN
    RAISE EXCEPTION 'Audit file cannot be archived until planning, TB, fieldwork, completion and quality controls are complete.';
  END IF;
  NEW.archived_at := COALESCE(NEW.archived_at, now());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE VIEW v_audit_file_readiness AS
SELECT af.audit_file_id, af.engagement_id, af.reporting_year_end, af.file_status,
       tb.is_balanced AS trial_balance_balanced,
       COALESCE((SELECT bool_and(l.mapped_audit_area IS NOT NULL) FROM audit_trial_balance_lines l WHERE l.audit_trial_balance_id = tb.audit_trial_balance_id), FALSE) AS trial_balance_fully_mapped,
       EXISTS (SELECT 1 FROM audit_workpapers w WHERE w.audit_file_id = af.audit_file_id AND w.status IN ('PREPARED','REVIEWED')) AS has_prepared_workpaper,
       EXISTS (SELECT 1 FROM audit_population_controls p WHERE p.audit_file_id = af.audit_file_id AND p.status = 'CONTROLLED') AS has_controlled_population,
       NOT EXISTS (SELECT 1 FROM audit_population_controls p WHERE p.audit_file_id = af.audit_file_id AND NOT EXISTS (SELECT 1 FROM audit_reconciliations r WHERE r.audit_file_id = af.audit_file_id AND r.audit_population_control_id = p.audit_population_control_id AND r.status = 'CLEARED' AND abs(r.difference) < 0.01)) AS all_populations_reconciled,
       NOT EXISTS (SELECT 1 FROM audit_samples s WHERE s.audit_file_id = af.audit_file_id AND s.selection_stage = 'PROVISIONAL') AS no_provisional_samples,
       NOT EXISTS (SELECT 1 FROM audit_exceptions x WHERE x.audit_file_id = af.audit_file_id AND x.status = 'OPEN') AS no_open_exceptions,
       e.eqr_status
FROM audit_files af
JOIN engagements e ON e.engagement_id = af.engagement_id
LEFT JOIN audit_trial_balances tb ON tb.audit_file_id = af.audit_file_id;

-- Engagement-channel RLS follows the shared firm-access helper declared with
-- the production row-level access controls above.
ALTER TABLE engagement_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY engagement_channels_by_firm_access ON engagement_channels FOR ALL
USING (app_has_firm_access(handling_firm_id)) WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY channel_appointments_by_firm_access ON channel_appointments FOR ALL
USING (app_has_firm_access(handling_firm_id)) WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY meeting_sessions_by_firm_access ON meeting_sessions FOR ALL
USING (app_has_firm_access(handling_firm_id)) WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY engagement_channel_members_by_channel_access ON engagement_channel_members FOR ALL
USING (EXISTS (SELECT 1 FROM engagement_channels c WHERE c.channel_id = engagement_channel_members.channel_id AND app_has_firm_access(c.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM engagement_channels c WHERE c.channel_id = engagement_channel_members.channel_id AND app_has_firm_access(c.handling_firm_id)));
CREATE POLICY engagement_channel_messages_by_channel_access ON engagement_channel_messages FOR ALL
USING (EXISTS (SELECT 1 FROM engagement_channels c WHERE c.channel_id = engagement_channel_messages.channel_id AND app_has_firm_access(c.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM engagement_channels c WHERE c.channel_id = engagement_channel_messages.channel_id AND app_has_firm_access(c.handling_firm_id)));

-- Statutory-compliance automation and the optional SME audit exemption.
ALTER TABLE service_templates ADD COLUMN IF NOT EXISTS is_audit_workflow BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE active_engagement_tasks ADD COLUMN IF NOT EXISTS workflow_family TEXT NOT NULL DEFAULT 'GENERAL';

CREATE OR REPLACE FUNCTION validate_sme_audit_exemption()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sme_audit_exempt AND NEW.is_pie THEN
    RAISE EXCEPTION 'A PIE client cannot be marked SME Audit Exempt';
  END IF;
  IF NEW.sme_audit_exempt AND COALESCE(trim(NEW.sme_audit_exemption_basis), '') = '' THEN
    RAISE EXCEPTION 'Record the approved SME audit-exemption basis before enabling the exemption';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_sme_audit_exemption_guard ON clients;
CREATE TRIGGER clients_sme_audit_exemption_guard
BEFORE INSERT OR UPDATE OF sme_audit_exempt, sme_audit_exemption_basis, is_pie ON clients
FOR EACH ROW EXECUTE FUNCTION validate_sme_audit_exemption();

CREATE OR REPLACE FUNCTION prevent_exempt_audit_workflow()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE exempt_client BOOLEAN := FALSE;
DECLARE audit_template BOOLEAN := FALSE;
BEGIN
  SELECT c.sme_audit_exempt INTO exempt_client
  FROM engagements e JOIN clients c ON c.client_id = e.client_id
  WHERE e.engagement_id = NEW.engagement_id;
  SELECT st.is_audit_workflow INTO audit_template
  FROM template_tasks tt JOIN service_templates st ON st.template_id = tt.template_id
  WHERE tt.template_task_id = NEW.template_task_id;
  IF COALESCE(exempt_client, FALSE) AND (NEW.workflow_family = 'AUDIT' OR COALESCE(audit_template, FALSE)) THEN
    RAISE EXCEPTION 'Statutory-audit workflow creation is blocked while the client has an active SME audit exemption';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS active_tasks_sme_audit_exemption_guard ON active_engagement_tasks;
CREATE TRIGGER active_tasks_sme_audit_exemption_guard
BEFORE INSERT OR UPDATE OF engagement_id, template_task_id, workflow_family ON active_engagement_tasks
FOR EACH ROW EXECUTE FUNCTION prevent_exempt_audit_workflow();

CREATE OR REPLACE FUNCTION incorporation_anniversary(p_incorporation_date DATE, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS DATE LANGUAGE plpgsql STABLE AS $$
DECLARE
  target_year INTEGER;
  target_month INTEGER;
  target_day INTEGER;
  last_day INTEGER;
  anniversary DATE;
BEGIN
  IF p_incorporation_date IS NULL THEN RETURN NULL; END IF;
  target_year := EXTRACT(YEAR FROM p_as_of);
  target_month := EXTRACT(MONTH FROM p_incorporation_date);
  target_day := EXTRACT(DAY FROM p_incorporation_date);
  last_day := EXTRACT(DAY FROM (date_trunc('month', make_date(target_year, target_month, 1)) + INTERVAL '1 month - 1 day'));
  anniversary := make_date(target_year, target_month, LEAST(target_day, last_day));
  IF anniversary < p_as_of THEN
    target_year := target_year + 1;
    last_day := EXTRACT(DAY FROM (date_trunc('month', make_date(target_year, target_month, 1)) + INTERVAL '1 month - 1 day'));
    anniversary := make_date(target_year, target_month, LEAST(target_day, last_day));
  END IF;
  RETURN anniversary;
END;
$$;

CREATE OR REPLACE FUNCTION generate_due_brs_annual_return_tasks(p_run_date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE created_count INTEGER;
BEGIN
  INSERT INTO client_statutory_compliance_tasks (client_id, statutory_template_id, compliance_year, due_date, activation_date, status)
  SELECT c.client_id, template.statutory_template_id, EXTRACT(YEAR FROM schedule.due_date)::SMALLINT,
         schedule.due_date, schedule.due_date - 30,
         CASE WHEN p_run_date >= schedule.due_date - 30 THEN 'Open' ELSE 'Scheduled' END
  FROM clients c
  CROSS JOIN (SELECT statutory_template_id FROM statutory_compliance_task_templates WHERE task_code = 'BRS_ANNUAL_RETURN_FILING' AND is_active) template
  CROSS JOIN LATERAL (SELECT incorporation_anniversary(c.incorporation_date, p_run_date) AS due_date) schedule
  WHERE c.incorporation_date IS NOT NULL
    AND c.status = 'Active'
    AND c.deleted_at IS NULL
    AND p_run_date BETWEEN schedule.due_date - 30 AND schedule.due_date
  ON CONFLICT (client_id, statutory_template_id, compliance_year) DO NOTHING;
  GET DIAGNOSTICS created_count = ROW_COUNT;
  RETURN created_count;
END;
$$;

CREATE OR REPLACE FUNCTION queue_etims_onboarding_task()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE template_id_value BIGINT;
BEGIN
  IF NEW.etims_onboarding_required THEN
    SELECT statutory_template_id INTO template_id_value FROM statutory_compliance_task_templates WHERE task_code = 'ETIMS_ONBOARDING' AND is_active;
    IF template_id_value IS NOT NULL THEN
      INSERT INTO client_statutory_compliance_tasks (client_id, statutory_template_id, compliance_year, due_date, activation_date, status)
      VALUES (NEW.client_id, template_id_value, EXTRACT(YEAR FROM CURRENT_DATE)::SMALLINT, CURRENT_DATE, CURRENT_DATE, 'Open')
      ON CONFLICT (client_id, statutory_template_id, compliance_year) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_queue_etims_onboarding ON clients;
CREATE TRIGGER clients_queue_etims_onboarding
AFTER INSERT OR UPDATE OF etims_onboarding_required ON clients
FOR EACH ROW EXECUTE FUNCTION queue_etims_onboarding_task();

ALTER TABLE client_statutory_compliance_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS client_statutory_tasks_by_client_access ON client_statutory_compliance_tasks;
CREATE POLICY client_statutory_tasks_by_client_access ON client_statutory_compliance_tasks FOR ALL
USING (EXISTS (SELECT 1 FROM clients c WHERE c.client_id = client_statutory_compliance_tasks.client_id AND app_has_branch_access(c.default_firm_id, c.branch_location)))
WITH CHECK (EXISTS (SELECT 1 FROM clients c WHERE c.client_id = client_statutory_compliance_tasks.client_id AND app_has_branch_access(c.default_firm_id, c.branch_location)));

-- AML/CFT client due-diligence controls. These records contain sensitive personal
-- data and are deliberately server-side only; do not store them in browser localStorage.
CREATE TABLE compliance_policy_settings (
  compliance_policy_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  firm_id BIGINT NOT NULL UNIQUE REFERENCES firms(firm_id) ON DELETE RESTRICT,
  cdd_retention_years SMALLINT NOT NULL DEFAULT 7 CHECK (cdd_retention_years BETWEEN 1 AND 20),
  suspicious_activity_escalation_hours SMALLINT NOT NULL DEFAULT 48 CHECK (suspicious_activity_escalation_hours BETWEEN 1 AND 168),
  high_risk_refresh_months SMALLINT NOT NULL DEFAULT 12 CHECK (high_risk_refresh_months BETWEEN 1 AND 60),
  approved_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  policy_version TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_kyc_profiles (
  client_id BIGINT PRIMARY KEY REFERENCES clients(client_id) ON DELETE RESTRICT,
  risk_rating TEXT NOT NULL DEFAULT 'Medium' CHECK (risk_rating IN ('Low','Medium','High')),
  kyc_complete BOOLEAN NOT NULL DEFAULT FALSE,
  pep_flag BOOLEAN NOT NULL DEFAULT FALSE,
  edd_required BOOLEAN NOT NULL DEFAULT FALSE,
  edd_partner_approved_by BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  edd_partner_approved_at TIMESTAMPTZ,
  sanctions_screened_at TIMESTAMPTZ,
  sanctions_screening_result TEXT NOT NULL DEFAULT 'NOT_SCREENED' CHECK (sanctions_screening_result IN ('NOT_SCREENED','CLEAR','POTENTIAL_MATCH','CONFIRMED_MATCH')),
  kyc_last_refreshed_at TIMESTAMPTZ,
  kyc_next_refresh_due_at DATE,
  client_contact_hold BOOLEAN NOT NULL DEFAULT FALSE,
  relationship_ended_at TIMESTAMPTZ,
  retention_until DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT pep_flag OR edd_required)
);

CREATE TABLE beneficial_owners (
  beneficial_owner_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  full_name_ciphertext TEXT NOT NULL,
  national_id_ciphertext TEXT,
  kra_pin_ciphertext TEXT,
  ownership_percentage NUMERIC(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  ownership_or_control_basis TEXT NOT NULL,
  pep_flag BOOLEAN NOT NULL DEFAULT FALSE,
  sanctions_screening_result TEXT NOT NULL DEFAULT 'NOT_SCREENED' CHECK (sanctions_screening_result IN ('NOT_SCREENED','CLEAR','POTENTIAL_MATCH','CONFIRMED_MATCH')),
  verified_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  ceased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE client_kyc_document_checks (
  kyc_document_check_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  document_requirement TEXT NOT NULL CHECK (document_requirement IN ('CERTIFICATE_OF_INCORPORATION','KRA_PIN','CR12','REGISTER_OF_MEMBERS','BENEFICIAL_OWNERSHIP_EVIDENCE')),
  verified_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  expires_at DATE,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, document_requirement, document_id)
);

CREATE TABLE compliance_alerts (
  compliance_alert_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('KYC_INCOMPLETE','KYC_REFRESH_DUE','PAYMENT_PATTERN','SANCTIONS_MATCH','PEP_EDD','SUSPICION_REPORTED')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('Low','Medium','High','Critical')),
  details_ciphertext TEXT NOT NULL,
  recipient_role TEXT NOT NULL DEFAULT 'Money Laundering Reporting Officer',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','RESOLVED','DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE suspicion_reports (
  suspicion_report_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  report_reference TEXT NOT NULL UNIQUE,
  suspicion_ciphertext TEXT NOT NULL,
  submitted_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','MLRO_REVIEW','MLRO_APPROVED','REPORTED','CLOSED')),
  mlro_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  mlro_decision_at TIMESTAMPTZ,
  goaml_export_status TEXT NOT NULL DEFAULT 'NOT_READY' CHECK (goaml_export_status IN ('NOT_READY','READY','EXPORTED','CONFIRMED')),
  goaml_reference_ciphertext TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION client_kyc_can_activate(p_client_id BIGINT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
    FROM client_kyc_profiles profile
    WHERE profile.client_id = p_client_id
      AND profile.kyc_complete
      AND profile.sanctions_screening_result = 'CLEAR'
      AND (NOT profile.pep_flag OR (profile.edd_partner_approved_by IS NOT NULL AND profile.edd_partner_approved_at IS NOT NULL))
      AND NOT EXISTS (
        SELECT 1 FROM (VALUES ('CERTIFICATE_OF_INCORPORATION'),('KRA_PIN'),('CR12'),('REGISTER_OF_MEMBERS')) required(requirement)
        WHERE NOT EXISTS (
          SELECT 1 FROM client_kyc_document_checks check_row
          WHERE check_row.client_id = p_client_id AND check_row.document_requirement = required.requirement
            AND check_row.is_current AND check_row.verified_at IS NOT NULL
        )
      )
      AND EXISTS (SELECT 1 FROM beneficial_owners owner_row WHERE owner_row.client_id = p_client_id AND owner_row.ceased_at IS NULL AND owner_row.verified_at IS NOT NULL)
  );
$$;

CREATE OR REPLACE FUNCTION enforce_engagement_kyc_gate()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lifecycle_stage = 'Active Engagement' AND NOT client_kyc_can_activate(NEW.client_id) THEN
    RAISE EXCEPTION 'KYC Incomplete: Cannot activate engagement under the client due-diligence policy.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagements_kyc_activation_guard ON engagements;
CREATE TRIGGER engagements_kyc_activation_guard
BEFORE INSERT OR UPDATE OF lifecycle_stage, client_id ON engagements
FOR EACH ROW EXECUTE FUNCTION enforce_engagement_kyc_gate();

CREATE OR REPLACE FUNCTION apply_suspicion_contact_hold()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('MLRO_APPROVED','REPORTED') AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('MLRO_APPROVED','REPORTED')) THEN
    UPDATE client_kyc_profiles SET client_contact_hold = TRUE, updated_at = now() WHERE client_id = NEW.client_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER suspicion_reports_contact_hold
AFTER INSERT OR UPDATE OF status ON suspicion_reports
FOR EACH ROW EXECUTE FUNCTION apply_suspicion_contact_hold();

CREATE OR REPLACE FUNCTION current_user_has_mlro_or_partner_access()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u JOIN roles r ON r.role_id = u.role_id
    WHERE u.user_id = app_user_id() AND r.role_name IN ('Engagement Partner','Money Laundering Reporting Officer')
  );
$$;

CREATE OR REPLACE FUNCTION prevent_tipping_off_communications()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction = 'OUTBOUND' AND NEW.communication_type <> 'INTERNAL_NOTE'
     AND EXISTS (SELECT 1 FROM client_kyc_profiles WHERE client_id = NEW.client_id AND client_contact_hold)
     AND NOT current_user_has_mlro_or_partner_access() THEN
    RAISE EXCEPTION 'Client-facing communications are restricted by a confidential compliance hold.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS communication_hub_tipping_off_guard ON communication_hub;
CREATE TRIGGER communication_hub_tipping_off_guard
BEFORE INSERT ON communication_hub
FOR EACH ROW EXECUTE FUNCTION prevent_tipping_off_communications();

CREATE OR REPLACE FUNCTION prevent_tipping_off_invoices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE invoice_client_id BIGINT;
BEGIN
  SELECT client_id INTO invoice_client_id FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF EXISTS (SELECT 1 FROM client_kyc_profiles WHERE client_id = invoice_client_id AND client_contact_hold)
     AND NOT current_user_has_mlro_or_partner_access() THEN
    RAISE EXCEPTION 'Invoice generation is restricted by a confidential compliance hold.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_tipping_off_guard ON invoices;
CREATE TRIGGER invoices_tipping_off_guard
BEFORE INSERT ON invoices
FOR EACH ROW EXECUTE FUNCTION prevent_tipping_off_invoices();

ALTER TABLE client_kyc_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE beneficial_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_kyc_document_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE suspicion_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kyc_profiles_restricted ON client_kyc_profiles;
DROP POLICY IF EXISTS beneficial_owners_restricted ON beneficial_owners;
DROP POLICY IF EXISTS kyc_document_checks_restricted ON client_kyc_document_checks;
DROP POLICY IF EXISTS compliance_alerts_restricted ON compliance_alerts;
DROP POLICY IF EXISTS suspicion_reports_restricted ON suspicion_reports;
CREATE POLICY kyc_profiles_restricted ON client_kyc_profiles FOR ALL
USING (current_user_has_mlro_or_partner_access()) WITH CHECK (current_user_has_mlro_or_partner_access());
CREATE POLICY beneficial_owners_restricted ON beneficial_owners FOR ALL
USING (current_user_has_mlro_or_partner_access()) WITH CHECK (current_user_has_mlro_or_partner_access());
CREATE POLICY kyc_document_checks_restricted ON client_kyc_document_checks FOR ALL
USING (current_user_has_mlro_or_partner_access()) WITH CHECK (current_user_has_mlro_or_partner_access());
CREATE POLICY compliance_alerts_restricted ON compliance_alerts FOR ALL
USING (current_user_has_mlro_or_partner_access()) WITH CHECK (current_user_has_mlro_or_partner_access());
CREATE POLICY suspicion_reports_restricted ON suspicion_reports FOR ALL
USING (current_user_has_mlro_or_partner_access()) WITH CHECK (current_user_has_mlro_or_partner_access());

-- Recurring Task Engine V2 --------------------------------------------------
-- Times are evaluated in Africa/Nairobi. `due_at` carries the exact deadline;
-- `due_date` remains for older reporting views. A recurring run is immutable
-- once it has generated tasks, which makes a Monday-to-Sunday sprint auditable.
ALTER TABLE active_engagement_tasks
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recurring_group_id BIGINT,
  ADD COLUMN IF NOT EXISTS recurrence_code TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_period_start DATE,
  ADD COLUMN IF NOT EXISTS recurrence_period_end DATE,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS overdue_at TIMESTAMPTZ;

ALTER TABLE tax_projects
  ADD COLUMN IF NOT EXISTS reporting_year_end DATE;

CREATE TABLE IF NOT EXISTS recurring_task_templates (
  recurring_task_template_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_code TEXT NOT NULL UNIQUE,
  task_name TEXT NOT NULL,
  recurrence_frequency TEXT NOT NULL CHECK (recurrence_frequency IN ('WEEKLY','MONTHLY','QUARTERLY','ANNUAL')),
  service_scope TEXT NOT NULL DEFAULT 'TAX',
  assigned_role_name TEXT NOT NULL,
  escalation_role_name TEXT NOT NULL,
  trigger_rule JSONB NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recurring_task_runs (
  recurring_group_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recurring_task_template_id BIGINT NOT NULL REFERENCES recurring_task_templates(recurring_task_template_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  triggered_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  UNIQUE (recurring_task_template_id, handling_firm_id, period_start)
);

ALTER TABLE active_engagement_tasks
  ADD CONSTRAINT active_tasks_recurring_group_fk
  FOREIGN KEY (recurring_group_id) REFERENCES recurring_task_runs(recurring_group_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS active_recurring_task_once_per_period
  ON active_engagement_tasks (engagement_id, recurrence_code, recurrence_period_start)
  WHERE is_recurring;

CREATE INDEX IF NOT EXISTS active_tasks_recurring_overdue
  ON active_engagement_tasks (is_overdue, due_at)
  WHERE is_recurring AND status <> 'Completed';

INSERT INTO recurring_task_templates
  (task_code, task_name, recurrence_frequency, service_scope, assigned_role_name, escalation_role_name, trigger_rule)
VALUES
  ('WEEKLY_TAX_HEALTH_CHECK','Weekly Tax Health Check','WEEKLY','TAX','Tax Assistant','Tax Supervisor',
   '{"trigger":"Monday 00:01 Africa/Nairobi","due":"Sunday 23:59 Africa/Nairobi","overdue_scan":"next Monday 00:05"}'::jsonb),
  ('START_PAYROLL_PROCESSING','Start Payroll Processing','MONTHLY','TAX','Tax Assistant','Tax Manager',
   '{"trigger_day":22,"due_day":25,"not_started_alert_day":23}'::jsonb),
  ('FILE_PAYE_RETURN','File PAYE Return','MONTHLY','TAX','Tax Assistant','Tax Manager',
   '{"trigger_day":6,"due_day":7,"kra_deadline_day":9,"critical_after_due":true}'::jsonb),
  ('FILE_VAT_TOT_RETURN','File VAT / TOT Return','MONTHLY','TAX','Tax Assistant','Tax Manager',
   '{"trigger_day":15,"due_day":18,"kra_deadline_day":20,"critical_after_due":true}'::jsonb),
  ('PREPARE_ANNUAL_INCOME_TAX','Prepare Annual Income Tax','ANNUAL','TAX','Tax Assistant','Engagement Partner',
   '{"trigger":"2 months before KRA deadline","due":"6 months after reporting year-end","partner_escalation":"1 month before deadline"}'::jsonb),
  ('VERIFY_ETIMS_COMPLIANCE','Verify eTIMS Compliance','QUARTERLY','TAX','Tax Assistant','Tax Manager',
   '{"trigger":"1 Jan/Apr/Jul/Oct","due_day":15,"client_risk_action":"Tax At Risk if non-compliant"}'::jsonb)
ON CONFLICT (task_code) DO UPDATE SET
  task_name = EXCLUDED.task_name,
  trigger_rule = EXCLUDED.trigger_rule,
  assigned_role_name = EXCLUDED.assigned_role_name,
  escalation_role_name = EXCLUDED.escalation_role_name,
  is_active = TRUE;

INSERT INTO notification_templates (alert_code, channel, subject_template, body_template, is_mandatory) VALUES
  ('WEEKLY_TAX_TASK_OVERDUE','EMAIL','Weekly tax task overdue','The prior-week Tax Health Check remains incomplete and requires immediate action.',TRUE),
  ('PAYROLL_NOT_STARTED','IN_APP','Payroll processing has not started','The monthly payroll task has not started by the internal control date.',TRUE),
  ('PAYE_CRITICAL_OVERDUE','EMAIL','PAYE return is critically overdue','The PAYE return is not submitted by the internal due date.',TRUE),
  ('VAT_TOT_CRITICAL_OVERDUE','EMAIL','VAT / TOT return is critically overdue','The VAT or TOT return is not submitted by the internal due date.',TRUE),
  ('ANNUAL_TAX_PARTNER_ESCALATION','EMAIL','Annual income tax preparation needs Partner attention','Annual income tax preparation has not started one month before its due date.',TRUE),
  ('ETIMS_TAX_AT_RISK','IN_APP','Client tax compliance at risk','The quarterly eTIMS review is incomplete or non-compliant.',TRUE)
ON CONFLICT (alert_code) DO NOTHING;

-- Creates one task run per firm and period, then one controlled task per
-- active tax engagement. It is idempotent, so a scheduler retry is safe.
CREATE OR REPLACE FUNCTION create_recurring_tax_tasks(
  p_task_code TEXT,
  p_period_start DATE,
  p_period_end DATE,
  p_due_at TIMESTAMPTZ,
  p_triggered_at TIMESTAMPTZ DEFAULT now(),
  p_engagement_id BIGINT DEFAULT NULL
) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE created_count INTEGER := 0;
BEGIN
  WITH template_row AS (
    SELECT recurring_task_template_id, task_code, task_name, assigned_role_name
    FROM recurring_task_templates WHERE task_code = p_task_code AND is_active
  ), eligible AS (
    SELECT e.engagement_id, e.handling_firm_id
    FROM engagements e
    JOIN tax_projects tp ON tp.engagement_id = e.engagement_id AND tp.is_active
    WHERE e.lifecycle_stage IN ('Active Engagement','WIP / Billing')
      AND e.deleted_at IS NULL
      AND (p_engagement_id IS NULL OR e.engagement_id = p_engagement_id)
  ), task_runs AS (
    INSERT INTO recurring_task_runs (recurring_task_template_id, handling_firm_id, period_start, period_end, triggered_at, due_at)
    SELECT tr.recurring_task_template_id, el.handling_firm_id, p_period_start, p_period_end, p_triggered_at, p_due_at
    FROM template_row tr CROSS JOIN (SELECT DISTINCT handling_firm_id FROM eligible) el
    ON CONFLICT (recurring_task_template_id, handling_firm_id, period_start) DO UPDATE
      SET due_at = EXCLUDED.due_at
    RETURNING recurring_group_id, recurring_task_template_id, handling_firm_id
  ), inserted AS (
    INSERT INTO active_engagement_tasks
      (engagement_id, task_name, assigned_role_name, due_date, due_at, status,
       is_recurring, recurring_group_id, recurrence_code, recurrence_period_start, recurrence_period_end)
    SELECT el.engagement_id, tr.task_name, tr.assigned_role_name, p_due_at::date, p_due_at,
           'Pending', TRUE, run.recurring_group_id, tr.task_code, p_period_start, p_period_end
    FROM eligible el
    JOIN task_runs run ON run.handling_firm_id = el.handling_firm_id
    CROSS JOIN template_row tr
    ON CONFLICT (engagement_id, recurrence_code, recurrence_period_start) WHERE is_recurring DO NOTHING
    RETURNING task_id
  ) SELECT count(*) INTO created_count FROM inserted;
  RETURN created_count;
END;
$$;

CREATE OR REPLACE FUNCTION generate_recurring_tax_tasks(p_run_at TIMESTAMPTZ DEFAULT now())
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE
  local_day DATE := (p_run_at AT TIME ZONE 'Africa/Nairobi')::date;
  week_start DATE := date_trunc('week', (p_run_at AT TIME ZONE 'Africa/Nairobi'))::date;
  month_end DATE := (date_trunc('month', local_day)::date + INTERVAL '1 month - 1 day')::date;
  due_at TIMESTAMPTZ;
  total_created INTEGER := 0;
  annual_row RECORD;
BEGIN
  IF EXTRACT(ISODOW FROM local_day) = 1 THEN
    due_at := ((week_start + 6) + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('WEEKLY_TAX_HEALTH_CHECK', week_start, week_start + 6, due_at, p_run_at);
  END IF;
  IF EXTRACT(DAY FROM local_day) = 22 THEN
    due_at := (make_date(EXTRACT(YEAR FROM local_day)::INT, EXTRACT(MONTH FROM local_day)::INT, LEAST(25, EXTRACT(DAY FROM month_end)::INT)) + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('START_PAYROLL_PROCESSING', date_trunc('month', local_day)::date, month_end, due_at, p_run_at);
  END IF;
  IF EXTRACT(DAY FROM local_day) = 6 THEN
    due_at := (make_date(EXTRACT(YEAR FROM local_day)::INT, EXTRACT(MONTH FROM local_day)::INT, LEAST(7, EXTRACT(DAY FROM month_end)::INT)) + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('FILE_PAYE_RETURN', date_trunc('month', local_day)::date, month_end, due_at, p_run_at);
  END IF;
  IF EXTRACT(DAY FROM local_day) = 15 THEN
    due_at := (make_date(EXTRACT(YEAR FROM local_day)::INT, EXTRACT(MONTH FROM local_day)::INT, LEAST(18, EXTRACT(DAY FROM month_end)::INT)) + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('FILE_VAT_TOT_RETURN', date_trunc('month', local_day)::date, month_end, due_at, p_run_at);
  END IF;
  IF EXTRACT(MONTH FROM local_day) IN (1,4,7,10) AND EXTRACT(DAY FROM local_day) = 1 THEN
    due_at := (make_date(EXTRACT(YEAR FROM local_day)::INT, EXTRACT(MONTH FROM local_day)::INT, 15) + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('VERIFY_ETIMS_COMPLIANCE', local_day, local_day + 14, due_at, p_run_at);
  END IF;
  -- Each annual task has its own statutory period because tax year ends vary.
  FOR annual_row IN
    SELECT e.engagement_id, e.handling_firm_id, tp.reporting_year_end,
           (tp.reporting_year_end + INTERVAL '6 months')::date AS tax_due_date
    FROM engagements e JOIN tax_projects tp ON tp.engagement_id = e.engagement_id
    WHERE tp.is_active AND tp.reporting_year_end IS NOT NULL
      AND e.lifecycle_stage IN ('Active Engagement','WIP / Billing') AND e.deleted_at IS NULL
      AND local_day = ((tp.reporting_year_end + INTERVAL '6 months - 2 months')::date)
  LOOP
    due_at := (annual_row.tax_due_date + time '23:59') AT TIME ZONE 'Africa/Nairobi';
    total_created := total_created + create_recurring_tax_tasks('PREPARE_ANNUAL_INCOME_TAX', local_day, annual_row.tax_due_date, due_at, p_run_at, annual_row.engagement_id);
  END LOOP;
  RETURN total_created;
END;
$$;

CREATE OR REPLACE FUNCTION flag_overdue_recurring_tasks(p_run_at TIMESTAMPTZ DEFAULT now())
RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE affected_count INTEGER := 0;
BEGIN
  WITH overdue AS (
    UPDATE active_engagement_tasks task
       SET is_overdue = TRUE, overdue_at = COALESCE(task.overdue_at, p_run_at)
      FROM engagements e
     WHERE task.engagement_id = e.engagement_id
       AND task.is_recurring
       AND task.status NOT IN ('Completed','Rejected')
       AND task.due_at < p_run_at
       AND NOT task.is_overdue
    RETURNING task.task_id, task.recurrence_code
  ), alerts AS (
    INSERT INTO system_alerts (alert_code, recipient_role_name, related_record_type, related_record_id)
    SELECT 'WEEKLY_TAX_TASK_OVERDUE', role_name, 'Active Engagement Task', task_id
    FROM overdue CROSS JOIN (VALUES ('Tax Assistant'), ('Tax Supervisor')) recipients(role_name)
    WHERE recurrence_code = 'WEEKLY_TAX_HEALTH_CHECK'
    RETURNING alert_id
  ) SELECT count(*) INTO affected_count FROM overdue;
  RETURN affected_count;
END;
$$;

-- Production scheduler (choose pg_cron, a queue worker, or the hosting
-- platform scheduler; do not rely on a browser being open):
-- 00:01 Monday Africa/Nairobi: SELECT generate_recurring_tax_tasks(now());
-- 00:05 Monday Africa/Nairobi: SELECT flag_overdue_recurring_tasks(now());
-- Daily 00:01 Africa/Nairobi: SELECT generate_recurring_tax_tasks(now());
-- Daily 00:05 Africa/Nairobi: SELECT flag_overdue_recurring_tasks(now());

-- Odoo-style Discuss controls -----------------------------------------------
-- Functional channel type (fieldwork / manager review) remains separate from
-- conversation type (public channel / private group / direct chat).
ALTER TABLE engagement_channels
  ADD COLUMN IF NOT EXISTS conversation_type TEXT NOT NULL DEFAULT 'GROUP'
    CHECK (conversation_type IN ('CHANNEL','GROUP','CHAT')),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS group_public_role_id BIGINT REFERENCES roles(role_id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS engagement_channel_role_access (
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  role_id BIGINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  can_join BOOLEAN NOT NULL DEFAULT TRUE,
  auto_subscribe BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, role_id)
);

ALTER TABLE engagement_channel_messages
  ADD COLUMN IF NOT EXISTS source_hub_communication_id BIGINT REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reply_to_message_id BIGINT REFERENCES engagement_channel_messages(channel_message_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_sequence BIGINT;

CREATE TABLE IF NOT EXISTS communication_channel_cross_posts (
  cross_post_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  hub_communication_id BIGINT NOT NULL REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  channel_message_id BIGINT REFERENCES engagement_channel_messages(channel_message_id) ON DELETE SET NULL,
  mentioned_by_user_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hub_communication_id, channel_id)
);

-- Transactional outbox lets the API publish a message after commit. A WebSocket
-- or SSE gateway consumes it; polling remains only a fallback for old clients.
CREATE TABLE IF NOT EXISTS channel_event_outbox (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES engagement_channels(channel_id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL CHECK (event_type IN ('MESSAGE_CREATED','MEMBERSHIP_CHANGED','MEETING_CHANGED')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION auto_subscribe_channel_members()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO engagement_channel_members (channel_id, user_id, membership_role)
  SELECT NEW.channel_id, assignment.user_id,
         CASE WHEN assignment.role_on_job IN ('PARTNER','MANAGER') THEN 'OWNER' ELSE 'MEMBER' END
  FROM staff_assignments assignment
  JOIN users staff ON staff.user_id = assignment.user_id AND staff.is_active
  JOIN engagement_channel_role_access access_rule ON access_rule.channel_id = NEW.channel_id
    AND access_rule.role_id = staff.role_id AND access_rule.auto_subscribe
  WHERE assignment.engagement_id = NEW.engagement_id
  ON CONFLICT (channel_id, user_id) DO UPDATE SET removed_at = NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_channel_auto_subscribe ON engagement_channels;
CREATE TRIGGER engagement_channel_auto_subscribe
AFTER INSERT ON engagement_channels
FOR EACH ROW EXECUTE FUNCTION auto_subscribe_channel_members();

CREATE OR REPLACE FUNCTION publish_channel_message_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO channel_event_outbox (channel_id, event_type, payload)
  VALUES (NEW.channel_id, 'MESSAGE_CREATED', jsonb_build_object('channel_message_id', NEW.channel_message_id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS engagement_channel_message_outbox ON engagement_channel_messages;
CREATE TRIGGER engagement_channel_message_outbox
AFTER INSERT ON engagement_channel_messages
FOR EACH ROW EXECUTE FUNCTION publish_channel_message_event();

-- API contract: GET/POST /api/channels/{channelId}/messages; subscribe to
-- /ws/channels or /api/channels/{channelId}/events (SSE). Authenticate first,
-- check firm access, then active membership or an allowed role before returning
-- a message, a meeting link, or a cross-post.

-- Secure Email-to-ERP module -------------------------------------------------
-- Credentials are never kept in these tables. Store a reference to a secret
-- held in the deployment's secret manager, rotate it there, and audit every
-- inbound sync and outbound send.
CREATE TABLE IF NOT EXISTS mail_server_configurations (
  mail_server_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  configuration_name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND_IMAP','OUTBOUND_SMTP')),
  hostname TEXT NOT NULL,
  port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
  security_mode TEXT NOT NULL CHECK (security_mode IN ('SSL_TLS','STARTTLS')),
  username_reference TEXT NOT NULL,
  secret_reference TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_tested_at TIMESTAMPTZ,
  last_successful_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (handling_firm_id, configuration_name, direction)
);

CREATE TABLE IF NOT EXISTS email_aliases (
  email_alias_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  alias_address TEXT NOT NULL UNIQUE,
  route_module TEXT NOT NULL CHECK (route_module IN ('COMMUNICATION_HUB','HELPDESK','TAX_QUEUE','AUDIT_QUEUE')),
  route_role_name TEXT,
  default_priority TEXT CHECK (default_priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_role_access (
  role_id BIGINT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
  can_view_global_inbox BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_server_config BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_aliases BOOLEAN NOT NULL DEFAULT FALSE,
  can_send_as_firm BOOLEAN NOT NULL DEFAULT FALSE,
  can_reply_assigned_client_only BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (role_id)
);

CREATE TABLE IF NOT EXISTS email_threads (
  email_thread_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  client_id BIGINT REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  contact_id BIGINT REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  subject_normalized TEXT NOT NULL,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_messages (
  email_message_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_thread_id BIGINT NOT NULL REFERENCES email_threads(email_thread_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  hub_communication_id BIGINT UNIQUE REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  email_alias_id BIGINT REFERENCES email_aliases(email_alias_id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  internet_message_id TEXT NOT NULL UNIQUE,
  in_reply_to_message_id TEXT,
  references_header TEXT,
  from_address TEXT NOT NULL,
  to_addresses TEXT[] NOT NULL,
  cc_addresses TEXT[] NOT NULL DEFAULT '{}',
  subject TEXT NOT NULL,
  body_text TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  delivery_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (delivery_status IN ('RECEIVED','QUEUED','SENT','FAILED','BOUNCED')),
  routed_role_name TEXT,
  raw_message_storage_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_sync_runs (
  email_sync_run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mail_server_id BIGINT NOT NULL REFERENCES mail_server_configurations(mail_server_id) ON DELETE RESTRICT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  messages_fetched INTEGER NOT NULL DEFAULT 0,
  messages_routed INTEGER NOT NULL DEFAULT 0,
  failure_detail TEXT
);

CREATE INDEX IF NOT EXISTS email_threads_firm_client ON email_threads (handling_firm_id, client_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_thread_time ON email_messages (email_thread_id, received_at);
CREATE INDEX IF NOT EXISTS email_messages_alias_queue ON email_messages (email_alias_id, routed_role_name, delivery_status);

CREATE OR REPLACE FUNCTION enforce_email_thread_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source_firm BIGINT;
BEGIN
  IF NEW.engagement_id IS NOT NULL THEN
    SELECT handling_firm_id INTO source_firm FROM engagements WHERE engagement_id = NEW.engagement_id;
    IF source_firm IS NULL OR source_firm <> NEW.handling_firm_id THEN
      RAISE EXCEPTION 'Email thread must inherit the immutable handling firm of its engagement.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_thread_firm_guard ON email_threads;
CREATE TRIGGER email_thread_firm_guard
BEFORE INSERT OR UPDATE OF handling_firm_id, engagement_id ON email_threads
FOR EACH ROW EXECUTE FUNCTION enforce_email_thread_chain();

CREATE OR REPLACE FUNCTION enforce_email_message_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE thread_firm BIGINT;
BEGIN
  SELECT handling_firm_id INTO thread_firm FROM email_threads WHERE email_thread_id = NEW.email_thread_id;
  IF thread_firm IS NULL OR thread_firm <> NEW.handling_firm_id THEN
    RAISE EXCEPTION 'Email message firm must match its email thread.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_message_firm_guard ON email_messages;
CREATE TRIGGER email_message_firm_guard
BEFORE INSERT OR UPDATE OF email_thread_id, handling_firm_id ON email_messages
FOR EACH ROW EXECUTE FUNCTION enforce_email_message_chain();

-- Inbound worker contract: use IMAP IDLE where available or poll through a
-- background worker every 2–5 minutes; de-duplicate on internet_message_id;
-- create / update EmailThread, CommunicationHub and EmailMessage in one DB
-- transaction; then route using email_aliases. Outbound replies must set
-- In-Reply-To and References from the original internet_message_id before SMTP.

-- Tax Project Workspace V2 ---------------------------------------------------
-- An engagement is the commercial container. A tax-period project is the
-- controlled work file for one reporting period, and it has one or more
-- obligation records. This prevents VAT, PAYE, WHT and annual income tax from
-- being treated as one shared status merely because they serve the same client.

CREATE TABLE IF NOT EXISTS client_tax_profiles (
  client_id BIGINT PRIMARY KEY REFERENCES clients(client_id) ON DELETE RESTRICT,
  taxpayer_pin TEXT NOT NULL UNIQUE CHECK (taxpayer_pin = upper(trim(taxpayer_pin)) AND taxpayer_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  legal_name_verified TEXT NOT NULL,
  taxpayer_pin_verified_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  taxpayer_pin_verified_at TIMESTAMPTZ NOT NULL,
  financial_year_start DATE,
  financial_year_end DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((financial_year_start IS NULL AND financial_year_end IS NULL) OR financial_year_end >= financial_year_start)
);

CREATE TABLE IF NOT EXISTS tax_period_projects (
  tax_period_project_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_id BIGINT NOT NULL REFERENCES tax_projects(tax_project_id) ON DELETE RESTRICT,
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  project_reference TEXT NOT NULL UNIQUE,
  period_kind TEXT NOT NULL CHECK (period_kind IN ('MONTHLY','ANNUAL')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  revision_no SMALLINT NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  status TEXT NOT NULL DEFAULT 'IDENTITY_REVIEW' CHECK (status IN ('IDENTITY_REVIEW','DATA_COLLECTION','IN_REVIEW','AWAITING_CLIENT_CONFIRMATION','MANAGER_APPROVAL','PARTNER_APPROVAL','READY_FOR_FILING','FILED','AMENDED','CANCELLED')),
  identity_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (identity_status IN ('PENDING','VERIFIED','REJECTED')),
  client_identity_locked_at TIMESTAMPTZ,
  client_confirmation_required BOOLEAN NOT NULL DEFAULT FALSE,
  client_confirmation_communication_id BIGINT REFERENCES communication_hub(hub_communication_id) ON DELETE RESTRICT,
  partner_escalation_required BOOLEAN NOT NULL DEFAULT FALSE,
  amended_from_tax_period_project_id BIGINT REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  amendment_reason TEXT,
  locked_at TIMESTAMPTZ,
  created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK ((amended_from_tax_period_project_id IS NULL) OR amendment_reason IS NOT NULL),
  UNIQUE (engagement_id, period_kind, period_start, period_end, revision_no)
);

CREATE TABLE IF NOT EXISTS tax_project_obligations (
  tax_project_obligation_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  tax_type TEXT NOT NULL CHECK (tax_type IN ('VAT','PAYE','WHT','INCOME_TAX')),
  obligation_frequency TEXT NOT NULL CHECK (obligation_frequency IN ('MONTHLY','ANNUAL')),
  external_due_date DATE,
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED','DATA_COLLECTION','IN_REVIEW','READY_FOR_FILING','FILED','AMENDED','NOT_APPLICABLE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tax_period_project_id, tax_type),
  CHECK ((tax_type = 'INCOME_TAX' AND obligation_frequency = 'ANNUAL') OR (tax_type <> 'INCOME_TAX' AND obligation_frequency = 'MONTHLY'))
);

CREATE TABLE IF NOT EXISTS tax_workpaper_versions (
  tax_workpaper_version_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  vault_document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  version_no SMALLINT NOT NULL CHECK (version_no > 0),
  content_hash TEXT NOT NULL,
  prepared_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (tax_period_project_id, version_no),
  UNIQUE (tax_period_project_id, content_hash)
);

CREATE TABLE IF NOT EXISTS tax_upload_batches (
  tax_upload_batch_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  handling_firm_id BIGINT NOT NULL REFERENCES firms(firm_id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL CHECK (source_type IN ('SALES_ETIMS_Z','PURCHASES_ETIMS','BANK_STATEMENT','PAYROLL_INPUT','WHT_SCHEDULE','TB_SCHEDULES')),
  period_key DATE NOT NULL,
  vault_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  source_reference TEXT NOT NULL,
  file_hash TEXT,
  record_count INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  no_activity BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK (status IN ('STAGED','ACCEPTED','REJECTED','SUPERSEDED')),
  supersedes_tax_upload_batch_id BIGINT REFERENCES tax_upload_batches(tax_upload_batch_id) ON DELETE RESTRICT,
  created_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((no_activity AND source_reference <> '') OR (NOT no_activity AND vault_document_id IS NOT NULL AND file_hash IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS tax_upload_batches_active_period_source
  ON tax_upload_batches (tax_project_obligation_id, source_type, period_key)
  WHERE status <> 'SUPERSEDED';
CREATE UNIQUE INDEX IF NOT EXISTS tax_upload_batches_client_file_hash
  ON tax_upload_batches (handling_firm_id, file_hash)
  WHERE file_hash IS NOT NULL AND status <> 'SUPERSEDED';

CREATE TABLE IF NOT EXISTS tax_period_project_tasks (
  tax_period_project_task_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  task_name TEXT NOT NULL,
  assigned_role_name TEXT NOT NULL,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','BLOCKED','CANCELLED')),
  recurrence_source TEXT NOT NULL CHECK (recurrence_source IN ('OBLIGATION_TEMPLATE','MANUAL_EXCEPTION')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tax_project_approvals (
  tax_project_approval_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  approval_stage TEXT NOT NULL CHECK (approval_stage IN ('CLIENT_IDENTITY','TECHNICAL_REVIEW','CLIENT_CONFIRMATION','FILING_AUTHORIZATION','PARTNER_ESCALATION','FILING_EVIDENCE','AMENDMENT_OPENED')),
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  requested_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  approved_by_user_id BIGINT REFERENCES users(user_id) ON DELETE RESTRICT,
  decision_note TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'PENDING' AND approved_by_user_id IS NULL AND decided_at IS NULL) OR (status IN ('APPROVED','REJECTED') AND approved_by_user_id IS NOT NULL AND decided_at IS NOT NULL)),
  UNIQUE (tax_period_project_id, approval_stage)
);

CREATE TABLE IF NOT EXISTS tax_filing_submissions (
  tax_filing_submission_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_project_obligation_id BIGINT NOT NULL UNIQUE REFERENCES tax_project_obligations(tax_project_obligation_id) ON DELETE RESTRICT,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  filing_reference TEXT NOT NULL,
  filing_date DATE NOT NULL,
  acknowledgement_document_id BIGINT REFERENCES documents(document_id) ON DELETE RESTRICT,
  filed_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payment_reference TEXT,
  payment_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A filing is evidenced operationally by its iTax reference and actual filing
-- date. An acknowledgement PDF may be stored when available but is never a
-- prerequisite for recording a completed filing.
ALTER TABLE tax_filing_submissions ADD COLUMN IF NOT EXISTS filing_date DATE;
UPDATE tax_filing_submissions SET filing_date = filed_at::date WHERE filing_date IS NULL;
ALTER TABLE tax_filing_submissions ALTER COLUMN filing_date SET NOT NULL;
ALTER TABLE tax_filing_submissions ALTER COLUMN acknowledgement_document_id DROP NOT NULL;

-- Tax workpapers are structured data and are therefore Excel workbooks.
-- Supporting evidence is deliberately separate and restricted to PDF so a
-- review can distinguish calculations from documentary proof.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS mime_type TEXT;

CREATE TABLE IF NOT EXISTS tax_project_task_evidence (
  tax_project_task_evidence_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tax_period_project_task_id BIGINT NOT NULL REFERENCES tax_period_project_tasks(tax_period_project_task_id) ON DELETE RESTRICT,
  tax_period_project_id BIGINT NOT NULL REFERENCES tax_period_projects(tax_period_project_id) ON DELETE RESTRICT,
  vault_document_id BIGINT NOT NULL REFERENCES documents(document_id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL,
  uploaded_by_user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tax_period_project_task_id, content_hash)
);

CREATE OR REPLACE FUNCTION enforce_tax_project_file_formats()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  original_file_name TEXT;
  original_mime_type TEXT;
BEGIN
  IF TG_TABLE_NAME = 'tax_upload_batches' THEN
    IF NEW.no_activity THEN RETURN NEW; END IF;
    SELECT lower(file_name), lower(COALESCE(mime_type, '')) INTO original_file_name, original_mime_type
    FROM documents WHERE document_id = NEW.vault_document_id;
    IF original_file_name !~ '\\.(xlsx|xls|xlsm)$' THEN
      RAISE EXCEPTION 'Tax Project source data and working papers must be Excel workbooks (.xlsx, .xls or .xlsm).';
    END IF;
    IF original_mime_type <> '' AND original_mime_type NOT IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/vnd.ms-excel.sheet.macroenabled.12') THEN
      RAISE EXCEPTION 'Tax Project workbook MIME type is not an approved Excel format.';
    END IF;
  ELSE
    SELECT lower(file_name), lower(COALESCE(mime_type, '')) INTO original_file_name, original_mime_type
    FROM documents WHERE document_id = NEW.vault_document_id;
    IF original_file_name !~ '\\.pdf$' OR (original_mime_type <> '' AND original_mime_type <> 'application/pdf') THEN
      RAISE EXCEPTION 'Tax task evidence must be a PDF document.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_upload_batches_excel_only ON tax_upload_batches;
CREATE TRIGGER tax_upload_batches_excel_only
BEFORE INSERT OR UPDATE OF vault_document_id, no_activity ON tax_upload_batches
FOR EACH ROW EXECUTE FUNCTION enforce_tax_project_file_formats();

DROP TRIGGER IF EXISTS tax_task_evidence_pdf_only ON tax_project_task_evidence;
CREATE TRIGGER tax_task_evidence_pdf_only
BEFORE INSERT OR UPDATE OF vault_document_id ON tax_project_task_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_tax_project_file_formats();

CREATE OR REPLACE FUNCTION enforce_tax_task_evidence_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  task_project_id BIGINT;
  project_client_id BIGINT;
  project_firm_id BIGINT;
  document_client_id BIGINT;
  document_firm_id BIGINT;
BEGIN
  SELECT obligation.tax_period_project_id INTO task_project_id
  FROM tax_period_project_tasks task
  JOIN tax_project_obligations obligation ON obligation.tax_project_obligation_id = task.tax_project_obligation_id
  WHERE task.tax_period_project_task_id = NEW.tax_period_project_task_id;
  SELECT client_id, handling_firm_id INTO project_client_id, project_firm_id
  FROM tax_period_projects WHERE tax_period_project_id = NEW.tax_period_project_id;
  SELECT client_id, handling_firm_id INTO document_client_id, document_firm_id
  FROM documents WHERE document_id = NEW.vault_document_id;
  IF task_project_id IS NULL OR task_project_id <> NEW.tax_period_project_id OR project_client_id IS NULL OR document_client_id <> project_client_id OR document_firm_id <> project_firm_id THEN
    RAISE EXCEPTION 'Tax task evidence must belong to the task, project, client and handling firm chain.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_task_evidence_chain_guard ON tax_project_task_evidence;
CREATE TRIGGER tax_task_evidence_chain_guard
BEFORE INSERT OR UPDATE OF tax_period_project_task_id, tax_period_project_id, vault_document_id ON tax_project_task_evidence
FOR EACH ROW EXECUTE FUNCTION enforce_tax_task_evidence_chain();

CREATE OR REPLACE FUNCTION enforce_tax_filing_acknowledgement_format()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  original_file_name TEXT;
  original_mime_type TEXT;
BEGIN
  IF NEW.acknowledgement_document_id IS NULL THEN RETURN NEW; END IF;
  SELECT lower(file_name), lower(COALESCE(mime_type, '')) INTO original_file_name, original_mime_type
  FROM documents WHERE document_id = NEW.acknowledgement_document_id;
  IF original_file_name !~ '\\.pdf$' OR (original_mime_type <> '' AND original_mime_type <> 'application/pdf') THEN
    RAISE EXCEPTION 'An optional iTax acknowledgement or tax payment receipt must be stored as a PDF document.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_filing_acknowledgement_pdf_only ON tax_filing_submissions;
CREATE TRIGGER tax_filing_acknowledgement_pdf_only
BEFORE INSERT OR UPDATE OF acknowledgement_document_id ON tax_filing_submissions
FOR EACH ROW EXECUTE FUNCTION enforce_tax_filing_acknowledgement_format();

CREATE OR REPLACE FUNCTION enforce_tax_filing_date()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.filing_date IS NULL OR NEW.filing_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'Record the actual filing date; it cannot be blank or in the future.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_filing_date_guard ON tax_filing_submissions;
CREATE TRIGGER tax_filing_date_guard
BEFORE INSERT OR UPDATE OF filing_date ON tax_filing_submissions
FOR EACH ROW EXECUTE FUNCTION enforce_tax_filing_date();

CREATE OR REPLACE FUNCTION enforce_tax_period_project_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE parent_engagement_id BIGINT;
DECLARE expected_client_id BIGINT;
DECLARE expected_firm_id BIGINT;
BEGIN
  SELECT project.engagement_id INTO parent_engagement_id FROM tax_projects project WHERE project.tax_project_id = NEW.tax_project_id;
  SELECT engagement.client_id, engagement.handling_firm_id INTO expected_client_id, expected_firm_id FROM engagements engagement WHERE engagement.engagement_id = NEW.engagement_id;
  IF parent_engagement_id IS NULL OR parent_engagement_id <> NEW.engagement_id THEN
    RAISE EXCEPTION 'Tax period project must belong to the engagement of its Tax Project container.';
  END IF;
  IF expected_client_id IS NULL OR expected_client_id <> NEW.client_id OR expected_firm_id <> NEW.handling_firm_id THEN
    RAISE EXCEPTION 'Tax period project client and handling firm must match the immutable engagement chain.';
  END IF;
  IF NOT client_kyc_can_activate(NEW.client_id) THEN
    RAISE EXCEPTION 'KYC Incomplete: Tax Project cannot be opened until client due diligence is complete.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.client_identity_locked_at IS NOT NULL AND (NEW.engagement_id IS DISTINCT FROM OLD.engagement_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.handling_firm_id IS DISTINCT FROM OLD.handling_firm_id OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end) THEN
    RAISE EXCEPTION 'Client, firm and reporting period are locked after tax identity approval. Create a controlled amendment instead.';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.locked_at IS NOT NULL AND NOT (NEW.status = 'AMENDED' AND NEW.client_id = OLD.client_id AND NEW.engagement_id = OLD.engagement_id AND NEW.handling_firm_id = OLD.handling_firm_id AND NEW.period_start = OLD.period_start AND NEW.period_end = OLD.period_end) THEN
    RAISE EXCEPTION 'Filed Tax Projects are locked. Create a linked amendment rather than changing the original.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_period_project_chain_guard ON tax_period_projects;
CREATE TRIGGER tax_period_project_chain_guard
BEFORE INSERT OR UPDATE ON tax_period_projects
FOR EACH ROW EXECUTE FUNCTION enforce_tax_period_project_chain();

CREATE OR REPLACE FUNCTION enforce_tax_upload_batch_chain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE project_firm_id BIGINT;
DECLARE project_locked_at TIMESTAMPTZ;
DECLARE obligation_project_id BIGINT;
BEGIN
  SELECT handling_firm_id, locked_at INTO project_firm_id, project_locked_at FROM tax_period_projects WHERE tax_period_project_id = NEW.tax_period_project_id;
  SELECT tax_period_project_id INTO obligation_project_id FROM tax_project_obligations WHERE tax_project_obligation_id = NEW.tax_project_obligation_id;
  IF project_firm_id IS NULL OR project_firm_id <> NEW.handling_firm_id OR obligation_project_id IS NULL OR obligation_project_id <> NEW.tax_period_project_id THEN
    RAISE EXCEPTION 'Tax upload batch must inherit its Tax Project firm and obligation.';
  END IF;
  IF project_locked_at IS NOT NULL THEN RAISE EXCEPTION 'The tax period is locked; create a controlled amendment before adding source data.'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_upload_batches_chain_guard ON tax_upload_batches;
CREATE TRIGGER tax_upload_batches_chain_guard
BEFORE INSERT OR UPDATE ON tax_upload_batches
FOR EACH ROW EXECUTE FUNCTION enforce_tax_upload_batch_chain();

CREATE OR REPLACE FUNCTION enforce_tax_project_approval_segregation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE project_creator BIGINT;
BEGIN
  SELECT created_by_user_id INTO project_creator FROM tax_period_projects WHERE tax_period_project_id = NEW.tax_period_project_id;
  IF NEW.approved_by_user_id IS NOT NULL AND (NEW.approved_by_user_id = NEW.requested_by_user_id OR NEW.approved_by_user_id = project_creator) THEN
    RAISE EXCEPTION 'Tax Project approval requires an independent approver.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tax_project_approval_segregation_guard ON tax_project_approvals;
CREATE TRIGGER tax_project_approval_segregation_guard
BEFORE INSERT OR UPDATE ON tax_project_approvals
FOR EACH ROW EXECUTE FUNCTION enforce_tax_project_approval_segregation();

ALTER TABLE client_tax_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_period_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_project_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_workpaper_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_period_project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_project_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_filing_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_project_task_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_tax_profiles_by_client_access ON client_tax_profiles FOR ALL
USING (EXISTS (SELECT 1 FROM clients client WHERE client.client_id = client_tax_profiles.client_id AND app_has_branch_access(client.default_firm_id, client.branch_location)))
WITH CHECK (EXISTS (SELECT 1 FROM clients client WHERE client.client_id = client_tax_profiles.client_id AND app_has_branch_access(client.default_firm_id, client.branch_location)));
CREATE POLICY tax_period_projects_by_firm_access ON tax_period_projects FOR ALL
USING (app_has_firm_access(handling_firm_id)) WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY tax_project_obligations_by_firm_access ON tax_project_obligations FOR ALL
USING (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_obligations.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_obligations.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)));
CREATE POLICY tax_workpaper_versions_by_firm_access ON tax_workpaper_versions FOR ALL
USING (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_workpaper_versions.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_workpaper_versions.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)));
CREATE POLICY tax_upload_batches_by_firm_access ON tax_upload_batches FOR ALL
USING (app_has_firm_access(handling_firm_id)) WITH CHECK (app_has_firm_access(handling_firm_id));
CREATE POLICY tax_period_project_tasks_by_firm_access ON tax_period_project_tasks FOR ALL
USING (EXISTS (SELECT 1 FROM tax_project_obligations obligation JOIN tax_period_projects project ON project.tax_period_project_id = obligation.tax_period_project_id WHERE obligation.tax_project_obligation_id = tax_period_project_tasks.tax_project_obligation_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_project_obligations obligation JOIN tax_period_projects project ON project.tax_period_project_id = obligation.tax_period_project_id WHERE obligation.tax_project_obligation_id = tax_period_project_tasks.tax_project_obligation_id AND app_has_firm_access(project.handling_firm_id)));
CREATE POLICY tax_project_approvals_by_firm_access ON tax_project_approvals FOR ALL
USING (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_approvals.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_approvals.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)));
CREATE POLICY tax_filing_submissions_by_firm_access ON tax_filing_submissions FOR ALL
USING (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_filing_submissions.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_filing_submissions.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)));
CREATE POLICY tax_project_task_evidence_by_firm_access ON tax_project_task_evidence FOR ALL
USING (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_task_evidence.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)))
WITH CHECK (EXISTS (SELECT 1 FROM tax_period_projects project WHERE project.tax_period_project_id = tax_project_task_evidence.tax_period_project_id AND app_has_firm_access(project.handling_firm_id)));
