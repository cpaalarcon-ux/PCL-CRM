-- Release 0: restricted staging foundation, not an operational ERP release.
-- Do not apply the historical root database_schema.sql before this migration.
-- No browser roles or service_role receive access to this private schema yet.
-- A later reviewed migration must implement authenticated scopes and APIs.
CREATE SCHEMA erp_private;
REVOKE ALL ON SCHEMA erp_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_private REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_private REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA erp_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE erp_private.staff_categories (
  category_code text PRIMARY KEY,
  display_name text NOT NULL UNIQUE,
  hierarchy_level smallint NOT NULL UNIQUE CHECK (hierarchy_level BETWEEN 1 AND 5)
);
INSERT INTO erp_private.staff_categories VALUES
 ('PARTNER','Engagement Partner',1), ('MANAGER','Manager',2),
 ('SUPERVISOR','Audit Supervisor',3), ('ASSISTANT','Audit Assistant',4), ('INTERN','Intern',5);

CREATE TABLE erp_private.firms (
  firm_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_code text NOT NULL UNIQUE CHECK (firm_code ~ '^[A-Z][A-Z0-9]{1,15}$'),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  trading_name text,
  kra_pin text CHECK (kra_pin IS NULL OR kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  email text, phone text, physical_address text,
  invoice_prefix text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);

CREATE TABLE erp_private.staff_members (
  staff_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  staff_identifier text NOT NULL CHECK (btrim(staff_identifier) <> ''),
  login_id text NOT NULL CHECK (login_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$'),
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  category_code text NOT NULL REFERENCES erp_private.staff_categories(category_code),
  manager_id uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
  branch_location text CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  employment_type text NOT NULL CHECK (employment_type IN ('Permanent','Contract','Internship','Consultant')),
  billing_status text NOT NULL DEFAULT 'Billable' CHECK (billing_status IN ('Billable','Partially billable','Non-billable')),
  contract_start_date date, contract_end_date date,
  access_status text NOT NULL DEFAULT 'Pending setup' CHECK (access_status IN ('Pending setup','Active','Inactive')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  CHECK (manager_id IS NULL OR manager_id <> staff_id),
  CHECK (contract_end_date IS NULL OR contract_start_date IS NULL OR contract_end_date >= contract_start_date),
  CHECK ((employment_type NOT IN ('Contract','Internship') AND category_code <> 'INTERN') OR contract_end_date IS NOT NULL),
  CHECK (access_status <> 'Active' OR auth_user_id IS NOT NULL)
);
CREATE UNIQUE INDEX staff_identifier_ci ON erp_private.staff_members (lower(staff_identifier));
CREATE UNIQUE INDEX staff_login_ci ON erp_private.staff_members (lower(login_id));
CREATE INDEX staff_manager_idx ON erp_private.staff_members(manager_id);
CREATE INDEX staff_category_idx ON erp_private.staff_members(category_code);

CREATE TABLE erp_private.staff_firm_access (
  staff_id uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
  firm_id uuid NOT NULL REFERENCES erp_private.firms ON DELETE RESTRICT,
  scope text NOT NULL DEFAULT 'Assigned' CHECK (scope IN ('Assigned','Firm')),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY (staff_id, firm_id)
);
CREATE INDEX staff_firm_by_firm_idx ON erp_private.staff_firm_access(firm_id);
CREATE TABLE erp_private.staff_capabilities (
  staff_id uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
  capability text NOT NULL CHECK (capability IN ('FINANCE','HR','SYSTEM_ADMIN','MLRO')),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY (staff_id, capability)
);

CREATE TABLE erp_private.clients (
  client_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_client_key text UNIQUE,
  company_name text NOT NULL CHECK (btrim(company_name) <> ''),
  trading_name text,
  kra_pin text CHECK (kra_pin IS NULL OR kra_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
  primary_sector text CHECK (primary_sector IN ('Agribusiness','Financial Services','Energy','Healthcare','NGO','Public Sector','SME/Startup','Legal','Education')),
  branch_location text CHECK (branch_location IN ('Nairobi','Bungoma','Kisii','Other')),
  client_category text CHECK (client_category IN ('Corporate','Non-Profit','Public Entity','Individual')),
  incorporation_date date,
  is_pie boolean NOT NULL DEFAULT false,
  sme_audit_exempt boolean NOT NULL DEFAULT false,
  audit_requested boolean NOT NULL DEFAULT false,
  record_status text NOT NULL DEFAULT 'Lead' CHECK (record_status IN ('Lead','Existing','Archived')),
  missing_fields text[] GENERATED ALWAYS AS
    (array_remove(ARRAY[
      CASE WHEN kra_pin IS NULL THEN 'KRA PIN' END,
      CASE WHEN primary_sector IS NULL THEN 'Primary Sector' END,
      CASE WHEN branch_location IS NULL THEN 'Branch Location' END,
      CASE WHEN client_category IS NULL THEN 'Client Category' END
    ], NULL)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz
);
CREATE UNIQUE INDEX client_pin_unique ON erp_private.clients(kra_pin) WHERE kra_pin IS NOT NULL;
CREATE INDEX client_name_search_idx ON erp_private.clients(lower(company_name));
CREATE TABLE erp_private.client_firm_links (
  client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
  firm_id uuid NOT NULL REFERENCES erp_private.firms ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY(client_id, firm_id)
);
CREATE INDEX client_firm_by_firm_idx ON erp_private.client_firm_links(firm_id);
CREATE TABLE erp_private.client_contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (btrim(full_name) <> ''),
  job_title text, email_address text, phone_number text,
  role_in_decision text CHECK (role_in_decision IN ('Decision Maker','Influencer','Billing Contact','Day-to-Day Contact')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz
);
CREATE INDEX client_contacts_client_idx ON erp_private.client_contacts(client_id);

CREATE TABLE erp_private.services (
  service_code text PRIMARY KEY, service_group text NOT NULL,
  service_name text NOT NULL UNIQUE, is_active boolean NOT NULL DEFAULT true
);
INSERT INTO erp_private.services VALUES
 ('AUD-STAT','Audit & Assurance','Statutory Audit',true),
 ('AUD-INT','Audit & Assurance','Internal Audit',true),
 ('AUD-PROJ','Audit & Assurance','Project Assurance',true),
 ('AUD-VFM','Audit & Assurance','Value-for-Money Audit',true),
 ('AUD-GRANT','Audit & Assurance','Donor & Grant Assurance',true),
 ('AUD-RISK','Audit & Assurance','Risk & Control Assurance',true),
 ('TAX-COMP','Tax Services','Tax Compliance (VAT, PAYE, Income Tax)',true),
 ('TAX-DIAG','Tax Services','Tax Diagnostic Reviews',true),
 ('TAX-ADV','Tax Services','Tax Advisory & Strategy',true),
 ('TAX-EXEMPT','Tax Services','KRA Tax Exemption Applications (NGOs)',true),
 ('TAX-TP','Tax Services','Transfer Pricing & International Tax',true),
 ('ACC-BOOK','Accounting & Financial Reporting','Bookkeeping & Outsourced Accounting',true),
 ('ACC-PAY','Accounting & Financial Reporting','Payroll Management',true),
 ('ACC-REP','Accounting & Financial Reporting','IFRS / IPSAS Financial Reporting',true),
 ('ACC-MGMT','Accounting & Financial Reporting','Management Accounting',true),
 ('ACC-CASH','Accounting & Financial Reporting','Cash-flow Forecasting & Financial Modeling',true),
 ('ADV-PLAN','Advisory & Consulting','Business Planning & Strategic Planning',true),
 ('ADV-FOR','Advisory & Consulting','Forensic Investigations',true),
 ('ADV-FEAS','Advisory & Consulting','Feasibility Studies',true),
 ('ADV-CTRL','Advisory & Consulting','Internal Controls Setup & Reviews',true),
 ('ADV-GOV','Advisory & Consulting','Governance & Risk Management',true),
 ('ADV-AML','Advisory & Consulting','AML/CFT (POCAMLA) Support',true),
 ('ADV-LSK','Advisory & Consulting','LSK Trust-Account Compliance',true);

CREATE TABLE erp_private.projects (
  project_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL, handling_firm_id uuid NOT NULL,
  project_name text NOT NULL CHECK (btrim(project_name) <> ''),
  service_code text NOT NULL REFERENCES erp_private.services,
  status text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Active','Archived')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  FOREIGN KEY(client_id, handling_firm_id) REFERENCES erp_private.client_firm_links ON DELETE RESTRICT,
  UNIQUE(project_id, handling_firm_id), UNIQUE(project_id, client_id, handling_firm_id)
);
CREATE INDEX projects_client_firm_idx ON erp_private.projects(client_id,handling_firm_id);
CREATE INDEX projects_firm_idx ON erp_private.projects(handling_firm_id);
CREATE INDEX projects_service_idx ON erp_private.projects(service_code);
CREATE TABLE erp_private.project_assignments (
  project_id uuid NOT NULL, staff_id uuid NOT NULL, handling_firm_id uuid NOT NULL,
  role_on_job text NOT NULL REFERENCES erp_private.staff_categories(category_code),
  start_date date, end_date date,
  allocation_percentage smallint NOT NULL DEFAULT 100 CHECK (allocation_percentage BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  PRIMARY KEY(project_id,staff_id),
  FOREIGN KEY(project_id,handling_firm_id) REFERENCES erp_private.projects(project_id,handling_firm_id) ON DELETE RESTRICT,
  FOREIGN KEY(staff_id,handling_firm_id) REFERENCES erp_private.staff_firm_access ON DELETE RESTRICT,
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);
CREATE INDEX project_assignments_staff_firm_idx ON erp_private.project_assignments(staff_id,handling_firm_id);
CREATE INDEX project_assignments_role_idx ON erp_private.project_assignments(role_on_job);
CREATE TABLE erp_private.tasks (
  task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
  assigned_to uuid,
  task_name text NOT NULL CHECK (btrim(task_name) <> ''),
  description text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','In Review','Blocked','Completed','Cancelled')),
  blocked_reason text,
  recurring_key text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  revision bigint NOT NULL DEFAULT 1, deleted_at timestamptz,
  FOREIGN KEY(project_id,assigned_to) REFERENCES erp_private.project_assignments(project_id,staff_id) ON DELETE RESTRICT,
  UNIQUE(task_id,project_id), UNIQUE(project_id,recurring_key)
);
CREATE INDEX tasks_project_assignee_idx ON erp_private.tasks(project_id,assigned_to);
CREATE INDEX tasks_personal_queue_idx ON erp_private.tasks(assigned_to,due_at) WHERE deleted_at IS NULL AND status NOT IN ('Completed','Cancelled');

CREATE TABLE erp_private.documents (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL, handling_firm_id uuid NOT NULL,
  project_id uuid, task_id uuid,
  category text NOT NULL CHECK (category IN ('Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports')),
  file_name text NOT NULL CHECK (btrim(file_name) <> ''),
  object_key text NOT NULL UNIQUE CHECK (btrim(object_key) <> '' AND object_key !~ '(^/|(^|/)\.\.(/|$)|://)'),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  mime_type text NOT NULL,
  version_group uuid NOT NULL DEFAULT gen_random_uuid(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
  is_locked boolean NOT NULL DEFAULT false,
  uploaded_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  FOREIGN KEY(client_id,handling_firm_id) REFERENCES erp_private.client_firm_links ON DELETE RESTRICT,
  FOREIGN KEY(project_id,client_id,handling_firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id) ON DELETE RESTRICT,
  FOREIGN KEY(task_id,project_id) REFERENCES erp_private.tasks(task_id,project_id) ON DELETE RESTRICT,
  CHECK (task_id IS NULL OR project_id IS NOT NULL),
  UNIQUE(version_group,version)
);
CREATE INDEX documents_client_firm_idx ON erp_private.documents(client_id,handling_firm_id);
CREATE INDEX documents_project_idx ON erp_private.documents(project_id,client_id,handling_firm_id);
CREATE INDEX documents_task_idx ON erp_private.documents(task_id,project_id);
CREATE INDEX documents_uploader_idx ON erp_private.documents(uploaded_by);

CREATE TABLE erp_private.import_batches (
  batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset text NOT NULL CHECK (dataset IN ('Clients','Staff')),
  idempotency_key text NOT NULL UNIQUE,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
  source_row_count integer NOT NULL CHECK (source_row_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  duplicate_count integer NOT NULL DEFAULT 0 CHECK (duplicate_count >= 0),
  rejected_count integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  incomplete_count integer NOT NULL DEFAULT 0 CHECK (incomplete_count BETWEEN 0 AND imported_count),
  status text NOT NULL DEFAULT 'Preview' CHECK (status IN ('Preview','Committed','Rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CHECK (imported_count + duplicate_count + rejected_count <= source_row_count),
  CHECK (status <> 'Committed' OR imported_count + duplicate_count + rejected_count = source_row_count),
  UNIQUE(batch_id,dataset)
);
CREATE INDEX import_batches_uploader_idx ON erp_private.import_batches(uploaded_by);
CREATE TABLE erp_private.import_row_keys (
  dataset text NOT NULL CHECK (dataset IN ('Clients','Staff')),
  row_key text NOT NULL,
  batch_id uuid NOT NULL,
  client_id uuid REFERENCES erp_private.clients ON DELETE RESTRICT,
  staff_id uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
  PRIMARY KEY(dataset,row_key),
  FOREIGN KEY(batch_id,dataset) REFERENCES erp_private.import_batches(batch_id,dataset) ON DELETE RESTRICT,
  CHECK ((dataset = 'Clients' AND client_id IS NOT NULL AND staff_id IS NULL) OR
         (dataset = 'Staff' AND staff_id IS NOT NULL AND client_id IS NULL))
);
CREATE INDEX import_row_batch_idx ON erp_private.import_row_keys(batch_id);
CREATE INDEX import_row_client_idx ON erp_private.import_row_keys(client_id);
CREATE INDEX import_row_staff_idx ON erp_private.import_row_keys(staff_id);

CREATE TABLE erp_private.audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_auth_id uuid,
  database_role text NOT NULL,
  table_name text NOT NULL, action text NOT NULL,
  record_key text NOT NULL, before_values jsonb, after_values jsonb
);
CREATE INDEX audit_events_record_idx ON erp_private.audit_events(table_name,record_key,occurred_at);

CREATE FUNCTION erp_private.reject_delete() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Historical records must be archived, not deleted' USING ERRCODE = '23514'; END;
$$;
CREATE FUNCTION erp_private.reject_audit_change() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'Audit events are append-only' USING ERRCODE = '23514'; END;
$$;
CREATE FUNCTION erp_private.touch_revision() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN NEW.updated_at := now(); NEW.revision := OLD.revision + 1; RETURN NEW; END;
$$;
CREATE FUNCTION erp_private.log_change() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values,after_values)
  VALUES(auth.uid(),current_user,TG_TABLE_NAME,TG_OP,to_jsonb(NEW)->>TG_ARGV[0],
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,to_jsonb(NEW));
  RETURN NEW;
END;
$$;
CREATE FUNCTION erp_private.project_guard() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.handling_firm_id <> OLD.handling_firm_id OR NEW.client_id <> OLD.client_id) THEN
    RAISE EXCEPTION 'A different firm or client requires a new engagement' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'Active' THEN
    RAISE EXCEPTION 'Activation unavailable until KYC, engagement-letter and authenticated approval services are released' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION erp_private.document_guard() RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_locked THEN RAISE EXCEPTION 'Locked evidence cannot be changed; create a new version' USING ERRCODE = '23514'; END IF;
    IF (NEW.object_key,NEW.sha256,NEW.file_size_bytes,NEW.version_group,NEW.version,NEW.client_id,NEW.handling_firm_id,NEW.uploaded_by,NEW.uploaded_at)
       IS DISTINCT FROM (OLD.object_key,OLD.sha256,OLD.file_size_bytes,OLD.version_group,OLD.version,OLD.client_id,OLD.handling_firm_id,OLD.uploaded_by,OLD.uploaded_at) THEN
      RAISE EXCEPTION 'Original evidence identity cannot be overwritten; create a new version' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.category IN ('Permanent File','Signed Engagement Letters','BRS Receipts','Final Reports') THEN NEW.is_locked := true; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER projects_guard BEFORE INSERT OR UPDATE ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.project_guard();
CREATE TRIGGER documents_guard BEFORE INSERT OR UPDATE ON erp_private.documents FOR EACH ROW EXECUTE FUNCTION erp_private.document_guard();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON erp_private.audit_events FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'erp_private' LOOP
    EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tablename);
    EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tablename);
    IF r.tablename NOT IN ('audit_events','staff_categories','services') THEN
      EXECUTE format('CREATE TRIGGER prevent_hard_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tablename);
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('staff_members','staff_id'),('clients','client_id'),('client_contacts','contact_id'),('projects','project_id'),('tasks','task_id')) AS x(tbl,key) LOOP
    EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);
    EXECUTE format('CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
  END LOOP;
END;
$$;
CREATE TRIGGER documents_audit AFTER INSERT OR UPDATE ON erp_private.documents FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('document_id');
REVOKE ALL ON ALL TABLES IN SCHEMA erp_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA erp_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA erp_private FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON SCHEMA erp_private IS 'Restricted Release 0 foundation. No staff API access is enabled. Do not expose through Data API.';
