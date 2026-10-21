-- PCL CRM / ERP production schema (PostgreSQL 15+)
-- Apply through controlled migrations. This schema stores metadata and financial records,
-- not document binaries. Object storage and authenticated API enforcement are mandatory.

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

CREATE TABLE clients (
  client_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_name TEXT NOT NULL,
  trading_name TEXT,
  primary_sector TEXT NOT NULL,
  branch_location TEXT NOT NULL CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  is_pie BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL CHECK (status IN ('Lead','Active','Archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

CREATE TABLE engagements (
  engagement_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
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
  engagement_id BIGINT NOT NULL REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  invoice_number TEXT NOT NULL UNIQUE,
  amount_billed NUMERIC(16,2) NOT NULL CHECK (amount_billed >= 0),
  vat_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  date_issued DATE NOT NULL,
  date_paid DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tax invoices use explicit client-contact, lead and QR relationships. The QR token
-- is opaque: names, phone numbers, tax values and PINs must never be encoded in it.
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

CREATE TABLE invoice_qr_codes (
  invoice_qr_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id BIGINT NOT NULL UNIQUE REFERENCES invoices(invoice_id) ON DELETE RESTRICT,
  lead_id BIGINT NOT NULL REFERENCES leads(lead_id) ON DELETE RESTRICT,
  contact_id BIGINT NOT NULL REFERENCES client_contacts(contact_id) ON DELETE RESTRICT,
  qr_reference TEXT NOT NULL UNIQUE,
  opaque_token TEXT NOT NULL UNIQUE,
  payload_version SMALLINT NOT NULL DEFAULT 1 CHECK (payload_version > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUPERSEDED','REVOKED')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

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
  channel TEXT NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','SMS','QR_TOKEN_COPIED','PORTAL')),
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
-- engagements, invoices and QR events. QR payloads remain in invoice_qr_codes;
-- they must never be copied to message text or contact fields.
CREATE TABLE communication_hub (
  hub_communication_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject TEXT NOT NULL,
  communication_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  communication_type TEXT NOT NULL CHECK (communication_type IN ('EMAIL','PHONE_CALL','MEETING','WHATSAPP','INTERNAL_NOTE','FORMAL_LETTER','QR_EVENT')),
  direction TEXT NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('INBOUND','OUTBOUND','INTERNAL')),
  body TEXT,
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

CREATE INDEX communication_hub_follow_up_open ON communication_hub (follow_up_date, follow_up_assigned_to_user_id) WHERE status = 'OPEN';
CREATE INDEX communication_hub_client_time ON communication_hub (client_id, communication_at DESC);
CREATE INDEX communication_hub_engagement_time ON communication_hub (engagement_id, communication_at DESC);
CREATE INDEX communication_hub_invoice_time ON communication_hub (invoice_id, communication_at DESC);

-- Normalise all links to one client chain before writing a communication.
CREATE OR REPLACE FUNCTION enforce_communication_hub_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  source_client_id BIGINT;
  linked_client_id BIGINT;
  linked_engagement_id BIGINT;
BEGIN
  source_client_id := NEW.client_id;
  IF NEW.engagement_id IS NOT NULL THEN
    SELECT client_id INTO linked_client_id FROM engagements WHERE engagement_id = NEW.engagement_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication engagement does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication engagement must belong to the linked client'; END IF;
    source_client_id := linked_client_id;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN
    SELECT client_id INTO linked_client_id FROM leads WHERE lead_id = NEW.lead_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication lead does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication lead must belong to the linked client'; END IF;
    source_client_id := linked_client_id;
  END IF;
  IF NEW.invoice_id IS NOT NULL THEN
    SELECT e.client_id, i.engagement_id INTO linked_client_id, linked_engagement_id FROM invoices i JOIN engagements e ON e.engagement_id = i.engagement_id WHERE i.invoice_id = NEW.invoice_id;
    IF linked_client_id IS NULL THEN RAISE EXCEPTION 'Communication invoice does not exist'; END IF;
    IF source_client_id IS NOT NULL AND source_client_id IS DISTINCT FROM linked_client_id THEN RAISE EXCEPTION 'Communication invoice must belong to the linked client'; END IF;
    IF NEW.engagement_id IS NOT NULL AND NEW.engagement_id IS DISTINCT FROM linked_engagement_id THEN RAISE EXCEPTION 'Communication invoice must belong to the linked engagement'; END IF;
    source_client_id := linked_client_id;
  END IF;
  IF NEW.client_id IS NULL THEN NEW.client_id := source_client_id; END IF;
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contacts WHERE contact_id = NEW.contact_id AND client_id = NEW.client_id AND is_active) THEN
    RAISE EXCEPTION 'Communication contact must be an active contact of the linked client';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER communication_hub_link_guard
BEFORE INSERT OR UPDATE OF lead_id, client_id, contact_id, engagement_id, invoice_id ON communication_hub
FOR EACH ROW EXECUTE FUNCTION enforce_communication_hub_links();

-- Keep lead, contact and tax-project links in the same client chain. API role checks
-- remain required before a tax invoice can be created, sent or cancelled.
CREATE OR REPLACE FUNCTION enforce_tax_invoice_links()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  expected_client_id BIGINT;
  expected_engagement_id BIGINT;
BEGIN
  SELECT client_id INTO expected_client_id FROM engagements WHERE engagement_id = NEW.engagement_id;
  IF expected_client_id IS NULL THEN RAISE EXCEPTION 'Invoice engagement does not exist'; END IF;
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
BEFORE INSERT OR UPDATE OF engagement_id, tax_project_id, lead_id, contact_id, invoice_type, payment_reference, due_date ON invoices
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
  is_restricted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE documents (
  document_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(client_id) ON DELETE RESTRICT,
  engagement_id BIGINT REFERENCES engagements(engagement_id) ON DELETE RESTRICT,
  category_id BIGINT NOT NULL REFERENCES vault_categories(category_id) ON DELETE RESTRICT,
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
