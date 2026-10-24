-- Consolidated STAGING workflows. No public access, real delivery or filing integration.
CREATE FUNCTION erp_private.has_capability(c text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND ((erp_private.actor()).category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_capabilities x WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability=c AND x.deleted_at IS NULL))
$$;
CREATE FUNCTION erp_private.finance_allowed(p uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT erp_private.project_allowed(p) AND (erp_private.has_capability('FINANCE') OR (NOT writing AND erp_private.is_leader()))
$$;

CREATE TABLE erp_private.tax_rates (
 rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rate_key text NOT NULL, tax_type text NOT NULL CHECK(tax_type IN ('VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy')),
 label text NOT NULL, effective_from date NOT NULL,effective_to date NOT NULL, parameters jsonb NOT NULL,source_url text NOT NULL,source_note text NOT NULL,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Approved','Rejected')),created_by uuid NOT NULL REFERENCES erp_private.staff_members,approved_by uuid REFERENCES erp_private.staff_members,approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 CHECK(effective_to>=effective_from),CHECK(status<>'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX tax_rates_period_idx ON erp_private.tax_rates(rate_key,effective_from,effective_to);
CREATE TABLE erp_private.staff_rates (
 rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES erp_private.staff_members,effective_from date NOT NULL,effective_to date NOT NULL,
 cost_rate numeric(16,2) NOT NULL CHECK(cost_rate>=0),billable_rate numeric(16,2) NOT NULL CHECK(billable_rate>=0),created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(effective_to>=effective_from)
);
CREATE INDEX staff_rates_period_idx ON erp_private.staff_rates(staff_id,effective_from,effective_to);
CREATE TABLE erp_private.project_budgets (
 budget_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,agreed_fee numeric(16,2) NOT NULL CHECK(agreed_fee>=0),budgeted_hours numeric(12,2) NOT NULL CHECK(budgeted_hours>=0),
 budgeted_cost numeric(16,2) NOT NULL CHECK(budgeted_cost>=0),effective_from date NOT NULL,reason text NOT NULL,created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,effective_from)
);
CREATE TABLE erp_private.invoices (
 invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,project_id uuid NOT NULL,client_id uuid NOT NULL,firm_id uuid NOT NULL,
 invoice_number text UNIQUE,external_reference text,description text NOT NULL,invoice_date date NOT NULL,due_date date NOT NULL,lines jsonb NOT NULL,
 net_amount numeric(16,2) NOT NULL CHECK(net_amount>0),vat_amount numeric(16,2) NOT NULL CHECK(vat_amount>=0),total_amount numeric(16,2) GENERATED ALWAYS AS (net_amount+vat_amount) STORED,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Posted','Void')),created_by uuid NOT NULL REFERENCES erp_private.staff_members,posted_by uuid REFERENCES erp_private.staff_members,posted_at timestamptz,void_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 FOREIGN KEY(project_id,client_id,firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id),CHECK(due_date>=invoice_date),CHECK(status<>'Posted' OR (invoice_number IS NOT NULL AND posted_by IS NOT NULL)),UNIQUE(invoice_id,project_id,client_id,firm_id)
);
CREATE INDEX invoice_project_idx ON erp_private.invoices(project_id);CREATE INDEX invoice_statement_idx ON erp_private.invoices(client_id,firm_id,invoice_date);
CREATE TABLE erp_private.payments (
 payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,invoice_id uuid NOT NULL,project_id uuid NOT NULL,client_id uuid NOT NULL,firm_id uuid NOT NULL,
 receipt_number text NOT NULL UNIQUE,payment_date date NOT NULL,method text NOT NULL CHECK(method IN ('Cash','M-Pesa','Bank','Cheque')),reference text NOT NULL,
 amount numeric(16,2) NOT NULL CHECK(amount<>0),reverses_id uuid UNIQUE REFERENCES erp_private.payments,reason text,created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(invoice_id,project_id,client_id,firm_id) REFERENCES erp_private.invoices(invoice_id,project_id,client_id,firm_id),CHECK((reverses_id IS NULL AND amount>0) OR (reverses_id IS NOT NULL AND amount<0))
);
CREATE INDEX payment_invoice_idx ON erp_private.payments(invoice_id);CREATE INDEX payment_statement_idx ON erp_private.payments(client_id,firm_id,payment_date);
CREATE TABLE erp_private.number_sequences (firm_id uuid NOT NULL REFERENCES erp_private.firms,kind text NOT NULL,year integer NOT NULL,last_value bigint NOT NULL,PRIMARY KEY(firm_id,kind,year));

CREATE TABLE erp_private.communications (
 communication_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),request_id uuid NOT NULL UNIQUE,reference text NOT NULL UNIQUE,opaque_reference uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL,firm_id uuid NOT NULL,project_id uuid,contact_id uuid REFERENCES erp_private.client_contacts,channel text NOT NULL CHECK(channel IN ('Letter','Email','Call','Meeting','Visit','Internal note')),
 subject text NOT NULL,purpose text NOT NULL,details text NOT NULL,communication_date date NOT NULL,followup_date date,meeting_link text,
 signatory_id uuid NOT NULL REFERENCES erp_private.staff_members,owner_id uuid NOT NULL REFERENCES erp_private.staff_members,status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Waiting','Closed')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links,FOREIGN KEY(project_id,client_id,firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id)
);
CREATE INDEX communications_client_idx ON erp_private.communications(client_id,firm_id);CREATE INDEX communications_project_idx ON erp_private.communications(project_id);

CREATE TABLE erp_private.client_compliance (
 client_id uuid PRIMARY KEY REFERENCES erp_private.clients,entity_type text NOT NULL DEFAULT 'Company' CHECK(entity_type IN ('Company','Partnership','Sole proprietor','Other')),
 risk_rating text NOT NULL DEFAULT 'Medium' CHECK(risk_rating IN ('Low','Medium','High')),is_pep boolean NOT NULL DEFAULT false,
 sanctions_date date,sanctions_result text,conflict_checked boolean NOT NULL DEFAULT false,incorporation_document uuid REFERENCES erp_private.documents,pin_document uuid REFERENCES erp_private.documents,
 directors_document uuid REFERENCES erp_private.documents,members_document uuid REFERENCES erp_private.documents,bo_document uuid REFERENCES erp_private.documents,
 verified_by uuid REFERENCES erp_private.staff_members,verified_at timestamptz,edd_approved_by uuid REFERENCES erp_private.staff_members,edd_approved_at timestamptz,
 review_due date,notes text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);
CREATE TABLE erp_private.beneficial_owners (
 owner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,full_name text NOT NULL,identity_reference text NOT NULL,kra_pin text,
 ownership_percentage numeric(7,4) NOT NULL CHECK(ownership_percentage BETWEEN 0 AND 100),control_basis text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);
CREATE INDEX beneficial_client_idx ON erp_private.beneficial_owners(client_id);
CREATE TABLE erp_private.engagement_controls (
 project_id uuid PRIMARY KEY REFERENCES erp_private.projects,signed_letter_id uuid REFERENCES erp_private.documents,letter_verified_by uuid REFERENCES erp_private.staff_members,
 letter_expires_on date,stage text NOT NULL DEFAULT 'Scoping' CHECK(stage IN ('Scoping','Proposal','Accepted','Planning','Fieldwork','Manager Review','EQR','Finalized')),
 eqr_required boolean NOT NULL DEFAULT false,eqr_reviewer_id uuid REFERENCES erp_private.staff_members,eqr_document_id uuid REFERENCES erp_private.documents,eqr_cleared_by uuid REFERENCES erp_private.staff_members,
 finalized_by uuid REFERENCES erp_private.staff_members,finalized_at timestamptz,notes text NOT NULL DEFAULT '',updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);

CREATE TABLE erp_private.tax_cases (
 case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,kind text NOT NULL CHECK(kind IN ('VAT','PAYE','Company','Partnership','Individual')),
 starts_on date NOT NULL,ends_on date NOT NULL,rate_id uuid REFERENCES erp_private.tax_rates,inputs jsonb NOT NULL DEFAULT '{}',result jsonb NOT NULL DEFAULT '{}',review_snapshot jsonb,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Locked','Filed')),prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,review_note text,filing_date date,source_document_id uuid REFERENCES erp_private.documents,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 CHECK(ends_on>=starts_on),CHECK(status NOT IN ('Locked','Filed') OR (reviewed_by IS NOT NULL AND review_snapshot IS NOT NULL)),CHECK(status<>'Filed' OR filing_date IS NOT NULL),UNIQUE(project_id,kind,starts_on,ends_on)
);
CREATE INDEX tax_case_project_idx ON erp_private.tax_cases(project_id,starts_on,ends_on);
CREATE TABLE erp_private.tax_row_reviews (
 row_id uuid PRIMARY KEY REFERENCES erp_private.workbook_rows,project_id uuid NOT NULL REFERENCES erp_private.projects,source_revision bigint NOT NULL,
 decision text NOT NULL CHECK(decision IN ('Eligible','Excluded','Confirmed','Unresolved')),deductible_percentage numeric(7,4) NOT NULL DEFAULT 0 CHECK(deductible_percentage BETWEEN 0 AND 100),
 reason text NOT NULL,reviewed_by uuid NOT NULL REFERENCES erp_private.staff_members,updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1
);
CREATE INDEX tax_row_project_idx ON erp_private.tax_row_reviews(project_id);
CREATE TABLE erp_private.tax_findings (
 finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,case_id uuid REFERENCES erp_private.tax_cases,summary text NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Resolved')),resolution text,raised_by uuid NOT NULL REFERENCES erp_private.staff_members,resolved_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);
CREATE INDEX tax_findings_project_idx ON erp_private.tax_findings(project_id);

CREATE TABLE erp_private.leave_requests (
 leave_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES erp_private.staff_members,leave_type text NOT NULL CHECK(leave_type IN ('Annual','Sick','Study','Maternity / Paternity')),
 starts_on date NOT NULL,ends_on date NOT NULL,working_days integer NOT NULL CHECK(working_days>0),reason text NOT NULL,busy_season boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected','Cancelled')),reviewed_by uuid REFERENCES erp_private.staff_members,review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,CHECK(ends_on>=starts_on)
);
CREATE INDEX leave_staff_idx ON erp_private.leave_requests(staff_id,starts_on,ends_on);
CREATE TABLE erp_private.attendance (
 attendance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES erp_private.staff_members,work_date date NOT NULL,
 clock_in timestamptz,clock_out timestamptz,break_minutes integer NOT NULL DEFAULT 60 CHECK(break_minutes BETWEEN 0 AND 480),location text NOT NULL,
 status text NOT NULL CHECK(status IN ('Present','Late','On leave','Missed punch')),reason text,reviewed_by uuid REFERENCES erp_private.staff_members,leave_id uuid REFERENCES erp_private.leave_requests,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz,
 CHECK(clock_out IS NULL OR clock_out>=clock_in),UNIQUE(staff_id,work_date)
);
CREATE TABLE erp_private.staff_credentials (
 credential_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),staff_id uuid NOT NULL REFERENCES erp_private.staff_members,credential_type text NOT NULL CHECK(credential_type IN ('CPA paper','ICPAK membership','CPD','Degree','Induction')),
 description text NOT NULL,status text NOT NULL CHECK(status IN ('In progress','Passed','Expired')),issue_date date NOT NULL,expiry_date date,cpd_hours numeric(8,2) NOT NULL DEFAULT 0 CHECK(cpd_hours>=0),evidence_reference text NOT NULL,
 verified_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);
CREATE INDEX credentials_staff_idx ON erp_private.staff_credentials(staff_id,expiry_date);
CREATE TABLE erp_private.performance_reviews (
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 technical_score integer NOT NULL CHECK(technical_score BETWEEN 1 AND 5),punctuality_score integer NOT NULL CHECK(punctuality_score BETWEEN 1 AND 5),workpaper_score integer NOT NULL CHECK(workpaper_score BETWEEN 1 AND 5),comments text NOT NULL,
 reviewed_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),CHECK(staff_id<>reviewed_by)
);
CREATE INDEX performance_staff_idx ON erp_private.performance_reviews(staff_id);CREATE INDEX performance_project_idx ON erp_private.performance_reviews(project_id);
CREATE TABLE erp_private.support_tickets (
 ticket_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,requester_id uuid NOT NULL REFERENCES erp_private.staff_members,
 assigned_to uuid NOT NULL REFERENCES erp_private.staff_members,project_id uuid REFERENCES erp_private.projects,subject text NOT NULL,description text NOT NULL,
 category text NOT NULL CHECK(category IN ('IT','Audit software','Tax','Billing','Client documents','Attendance')),
 priority text NOT NULL CHECK(priority IN ('Low','Medium','High','Critical')),status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','In progress','Pending requester','Resolved','Closed')),
 sla_due_at timestamptz NOT NULL,first_response_at timestamptz,resolved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,deleted_at timestamptz
);
CREATE INDEX support_requester_idx ON erp_private.support_tickets(requester_id);CREATE INDEX support_assignee_idx ON erp_private.support_tickets(assigned_to,sla_due_at);
CREATE TABLE erp_private.ticket_replies (
 reply_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),ticket_id uuid NOT NULL REFERENCES erp_private.support_tickets,staff_id uuid NOT NULL REFERENCES erp_private.staff_members,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_replies_ticket_idx ON erp_private.ticket_replies(ticket_id);

-- Every new record type is private, audited and protected from hard deletion.
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT * FROM (VALUES ('tax_rates','rate_id'),('staff_rates','rate_id'),('project_budgets','budget_id'),('invoices','invoice_id'),('payments','payment_id'),('communications','communication_id'),('client_compliance','client_id'),('beneficial_owners','owner_id'),('engagement_controls','project_id'),('tax_cases','case_id'),('tax_row_reviews','row_id'),('tax_findings','finding_id'),('leave_requests','leave_id'),('attendance','attendance_id'),('staff_credentials','credential_id'),('performance_reviews','review_id'),('support_tickets','ticket_id'),('ticket_replies','reply_id')) AS x(tbl,key) LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
 EXECUTE format('CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
 EXECUTE format('GRANT SELECT,INSERT ON erp_private.%I TO erp_api',r.tbl);
 IF r.tbl NOT IN ('staff_rates','project_budgets','payments','performance_reviews','ticket_replies') THEN
 EXECUTE format('GRANT UPDATE ON erp_private.%I TO erp_api',r.tbl);
 EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);
 ELSE EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change()',r.tbl);END IF;
 END LOOP;
END; $$;
ALTER TABLE erp_private.number_sequences ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.number_sequences TO erp_api;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA erp_private TO erp_api;
CREATE POLICY sequence_scope ON erp_private.number_sequences FOR ALL TO erp_api USING(erp_private.firm_allowed(firm_id)) WITH CHECK(erp_private.firm_allowed(firm_id));
CREATE POLICY rates_read ON erp_private.tax_rates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY rates_add ON erp_private.tax_rates FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY rates_update ON erp_private.tax_rates FOR UPDATE TO erp_api USING(erp_private.is_leader() AND status='Draft') WITH CHECK(erp_private.is_leader());
CREATE POLICY staff_rates_read ON erp_private.staff_rates FOR SELECT TO erp_api USING(erp_private.is_leader() AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)));
CREATE POLICY staff_rates_add ON erp_private.staff_rates FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY budgets_read ON erp_private.project_budgets FOR SELECT TO erp_api USING(erp_private.finance_allowed(project_id));
CREATE POLICY budgets_add ON erp_private.project_budgets FOR INSERT TO erp_api WITH CHECK(erp_private.finance_allowed(project_id,true) AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY invoices_read ON erp_private.invoices FOR SELECT TO erp_api USING(erp_private.finance_allowed(project_id));
CREATE POLICY invoices_add ON erp_private.invoices FOR INSERT TO erp_api WITH CHECK(erp_private.finance_allowed(project_id,true) AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY invoices_update ON erp_private.invoices FOR UPDATE TO erp_api USING(erp_private.finance_allowed(project_id,true)) WITH CHECK(erp_private.finance_allowed(project_id,true));
CREATE POLICY payments_read ON erp_private.payments FOR SELECT TO erp_api USING(erp_private.finance_allowed(project_id));
CREATE POLICY payments_add ON erp_private.payments FOR INSERT TO erp_api WITH CHECK(erp_private.finance_allowed(project_id,true) AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY comms_read ON erp_private.communications FOR SELECT TO erp_api USING(deleted_at IS NULL AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (project_id IS NULL OR erp_private.project_allowed(project_id)));
CREATE POLICY comms_add ON erp_private.communications FOR INSERT TO erp_api WITH CHECK(owner_id=(erp_private.actor()).staff_id AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id) AND (project_id IS NULL OR erp_private.project_allowed(project_id)));
CREATE POLICY comms_update ON erp_private.communications FOR UPDATE TO erp_api USING((owner_id=(erp_private.actor()).staff_id OR erp_private.is_leader()) AND erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.firm_allowed(firm_id) AND erp_private.client_allowed(client_id));
CREATE POLICY compliance_scope ON erp_private.client_compliance FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY owners_scope ON erp_private.beneficial_owners FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY engagement_read ON erp_private.engagement_controls FOR SELECT TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id));
CREATE POLICY engagement_write ON erp_private.engagement_controls FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY case_read ON erp_private.tax_cases FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY case_write ON erp_private.tax_cases FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (prepared_by=(erp_private.actor()).staff_id OR erp_private.project_editor())) WITH CHECK(erp_private.project_allowed(project_id));
CREATE POLICY tax_review_read ON erp_private.tax_row_reviews FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY tax_review_write ON erp_private.tax_row_reviews FOR ALL TO erp_api USING(erp_private.project_editor() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id) AND reviewed_by=(erp_private.actor()).staff_id);
CREATE POLICY findings_scope ON erp_private.tax_findings FOR ALL TO erp_api USING(erp_private.project_allowed(project_id)) WITH CHECK(erp_private.project_allowed(project_id));
CREATE POLICY leave_read ON erp_private.leave_requests FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY leave_add ON erp_private.leave_requests FOR INSERT TO erp_api WITH CHECK(staff_id=(erp_private.actor()).staff_id AND status='Pending' AND reviewed_by IS NULL);
CREATE POLICY leave_update ON erp_private.leave_requests FOR UPDATE TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)) WITH CHECK(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY attendance_read ON erp_private.attendance FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY attendance_write ON erp_private.attendance FOR ALL TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)) WITH CHECK(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY credentials_scope ON erp_private.staff_credentials FOR ALL TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id)) WITH CHECK(staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id));
CREATE POLICY performance_read ON erp_private.performance_reviews FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR (erp_private.manages(staff_id) AND erp_private.project_allowed(project_id)));
CREATE POLICY performance_add ON erp_private.performance_reviews FOR INSERT TO erp_api WITH CHECK(erp_private.project_editor() AND erp_private.project_allowed(project_id) AND reviewed_by=(erp_private.actor()).staff_id);
CREATE POLICY tickets_read ON erp_private.support_tickets FOR SELECT TO erp_api USING(requester_id=(erp_private.actor()).staff_id OR assigned_to=(erp_private.actor()).staff_id OR ((erp_private.actor()).category_code='PARTNER'));
CREATE POLICY tickets_add ON erp_private.support_tickets FOR INSERT TO erp_api WITH CHECK(requester_id=(erp_private.actor()).staff_id);
CREATE POLICY tickets_update ON erp_private.support_tickets FOR UPDATE TO erp_api USING(requester_id=(erp_private.actor()).staff_id OR assigned_to=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code='PARTNER') WITH CHECK(requester_id=(erp_private.actor()).staff_id OR assigned_to=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code='PARTNER');
CREATE POLICY replies_read ON erp_private.ticket_replies FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.support_tickets t WHERE t.ticket_id=ticket_replies.ticket_id));
CREATE POLICY replies_add ON erp_private.ticket_replies FOR INSERT TO erp_api WITH CHECK(staff_id=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.support_tickets t WHERE t.ticket_id=ticket_replies.ticket_id));
GRANT INSERT,UPDATE ON erp_private.client_contacts TO erp_api;
CREATE POLICY contacts_write ON erp_private.client_contacts FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

CREATE FUNCTION erp_private.suite_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='tax_rates' THEN
  IF OLD.status='Approved' THEN RAISE EXCEPTION 'Approved rate versions are immutable' USING ERRCODE='23514';END IF;
  IF NEW.status='Approved' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='invoices' THEN
  IF OLD.status<>'Draft' AND (to_jsonb(NEW)-ARRAY['status','void_reason','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','void_reason','revision','updated_at']) THEN RAISE EXCEPTION 'Posted invoice is immutable' USING ERRCODE='23514';END IF;
  IF OLD.status='Void' OR (OLD.status='Posted' AND NEW.status<>'Void') THEN RAISE EXCEPTION 'Invalid invoice transition' USING ERRCODE='23514';END IF;
  IF (NEW.client_id,NEW.firm_id,NEW.project_id,NEW.created_by,NEW.request_id) IS DISTINCT FROM (OLD.client_id,OLD.firm_id,OLD.project_id,OLD.created_by,OLD.request_id) THEN RAISE EXCEPTION 'Invoice identity is immutable' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='tax_cases' THEN
  IF OLD.status IN ('Locked','Filed') AND (to_jsonb(NEW)-ARRAY['status','filing_date','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','filing_date','revision','updated_at']) THEN RAISE EXCEPTION 'Locked tax snapshot cannot change' USING ERRCODE='23514';END IF;
  IF OLD.status='Filed' OR (OLD.status='Locked' AND NEW.status<>'Filed') THEN RAISE EXCEPTION 'Tax file is locked' USING ERRCODE='23514';END IF;
  IF (NEW.project_id,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.prepared_by) IS DISTINCT FROM (OLD.project_id,OLD.kind,OLD.starts_on,OLD.ends_on,OLD.prepared_by) THEN RAISE EXCEPTION 'Tax period identity is immutable' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER suite_guard BEFORE UPDATE ON erp_private.tax_rates FOR EACH ROW EXECUTE FUNCTION erp_private.suite_guard();
CREATE TRIGGER suite_guard BEFORE UPDATE ON erp_private.invoices FOR EACH ROW EXECUTE FUNCTION erp_private.suite_guard();
CREATE TRIGGER suite_guard BEFORE UPDATE ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.suite_guard();

CREATE FUNCTION erp_private.tax_period_open(p uuid,s date,e date) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM erp_private.tax_cases c WHERE c.project_id=p AND c.status IN ('Submitted','Locked','Filed') AND c.starts_on<=e AND c.ends_on>=s)
$$;
CREATE FUNCTION erp_private.import_period_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b erp_private.workbook_batches;
BEGIN
 IF TG_TABLE_NAME='workbook_batches' THEN
  IF NOT erp_private.tax_period_open(NEW.project_id,NEW.period_start,NEW.period_end) THEN RAISE EXCEPTION 'Return is submitted or locked' USING ERRCODE='23514';END IF;
 ELSE
  SELECT * INTO b FROM erp_private.workbook_batches WHERE batch_id=NEW.batch_id;
  IF b.batch_id IS NOT NULL AND NOT erp_private.tax_period_open(NEW.project_id,b.period_start,b.period_end) THEN RAISE EXCEPTION 'Return is submitted or locked' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER import_period_guard BEFORE INSERT ON erp_private.workbook_batches FOR EACH ROW EXECUTE FUNCTION erp_private.import_period_guard();
CREATE TRIGGER import_period_guard BEFORE INSERT OR UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.import_period_guard();
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.has_capability(text),erp_private.finance_allowed(uuid,boolean),erp_private.tax_period_open(uuid,date,date) TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.project_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c erp_private.client_compliance;e erp_private.engagement_controls;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.handling_firm_id<>OLD.handling_firm_id OR NEW.client_id<>OLD.client_id) THEN RAISE EXCEPTION 'A different firm or client requires a new engagement' USING ERRCODE='23514';END IF;
 IF NEW.status='Active' THEN
  SELECT * INTO c FROM erp_private.client_compliance WHERE client_id=NEW.client_id;
  SELECT * INTO e FROM erp_private.engagement_controls WHERE project_id=NEW.project_id;
  IF c.verified_by IS NULL OR c.review_due IS NULL OR c.review_due<current_date OR ((c.is_pep OR c.risk_rating='High') AND c.edd_approved_by IS NULL) OR e.signed_letter_id IS NULL OR e.letter_verified_by IS NULL OR (e.letter_expires_on IS NOT NULL AND e.letter_expires_on<current_date) THEN RAISE EXCEPTION 'Verified current KYC, enhanced review where required, and a verified signed engagement letter are required' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;

CREATE FUNCTION erp_private.run_suite_scheduler() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record;
BEGIN
 UPDATE erp_private.attendance SET status='Missed punch' WHERE clock_in IS NOT NULL AND clock_out IS NULL AND status IN ('Present','Late') AND work_date<(now() AT TIME ZONE 'Africa/Nairobi')::date;
 UPDATE erp_private.support_tickets SET status='Closed' WHERE status='Resolved' AND resolved_at<now()-interval '48 hours';
 FOR r IN SELECT t.*,s.manager_id FROM erp_private.support_tickets t JOIN erp_private.staff_members s ON s.staff_id=t.assigned_to WHERE t.first_response_at IS NULL AND t.status NOT IN ('Closed','Resolved') AND t.sla_due_at<now() LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.assigned_to,'Support SLA overdue: '||r.subject,'ticket-due:'||r.ticket_id) ON CONFLICT(event_key) DO NOTHING;
  IF r.manager_id IS NOT NULL THEN INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.manager_id,'Team support SLA overdue: '||r.subject,'ticket-manager:'||r.ticket_id) ON CONFLICT(event_key) DO NOTHING;END IF;
 END LOOP;
 FOR r IN SELECT c.*,s.manager_id FROM erp_private.staff_credentials c JOIN erp_private.staff_members s USING(staff_id) WHERE c.expiry_date BETWEEN current_date AND current_date+30 AND c.deleted_at IS NULL LOOP
  INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,'Credential renewal due: '||r.description,'credential:'||r.credential_id||':'||r.expiry_date) ON CONFLICT(event_key) DO NOTHING;
 END LOOP;
 FOR r IN SELECT e.*,p.owner_staff_id,p.project_name FROM erp_private.engagement_controls e JOIN erp_private.projects p USING(project_id) WHERE e.letter_expires_on BETWEEN current_date AND current_date+30 AND p.deleted_at IS NULL LOOP
  IF r.owner_staff_id IS NOT NULL THEN INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.owner_staff_id,'Engagement letter renewal due: '||r.project_name,'renewal:'||r.project_id||':'||r.letter_expires_on) ON CONFLICT(event_key) DO NOTHING;END IF;
 END LOOP;
END; $$;
REVOKE ALL ON FUNCTION erp_private.run_suite_scheduler() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('suite-hourly-controls','5 * * * *','select erp_private.run_suite_scheduler()');
