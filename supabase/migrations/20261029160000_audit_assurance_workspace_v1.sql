-- Connected Audit & Assurance workspace. The audit TB and adjustments are a
-- separate audit record and never post to the client bookkeeping ledger.
CREATE TABLE erp_private.audit_files (
 audit_file_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL UNIQUE,
 client_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 file_type text NOT NULL CHECK(file_type IN ('First-year','Subsequent-year','Historical demonstration')),
 reporting_framework text NOT NULL,
 framework_status text NOT NULL DEFAULT 'Pending review' CHECK(framework_status IN ('Pending review','Approved')),
 framework_approved_by uuid REFERENCES erp_private.staff_members,
 framework_approved_at timestamptz,
 previous_audit_file_id uuid,
 file_status text NOT NULL DEFAULT 'Draft' CHECK(file_status IN ('Draft','Prepared','In Review','Returned','Approved','Completion','Archived')),
 is_demonstration boolean NOT NULL DEFAULT false,
 demonstration_warning text NOT NULL DEFAULT '',
 source_archive_name text,
 source_archive_sha256 text,
 source_archive_read_only boolean NOT NULL DEFAULT false,
 archive_reason text,
 archived_by uuid REFERENCES erp_private.staff_members,
 archived_at timestamptz,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(project_id,client_id,handling_firm_id) REFERENCES erp_private.projects(project_id,client_id,handling_firm_id),
 UNIQUE(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,client_id,handling_firm_id),
 FOREIGN KEY(previous_audit_file_id,client_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,client_id,handling_firm_id) ON DELETE RESTRICT,
 CHECK(ends_on>=starts_on),
 CHECK((framework_status='Approved' AND framework_approved_by IS NOT NULL AND framework_approved_at IS NOT NULL)
    OR (framework_status='Pending review' AND framework_approved_by IS NULL AND framework_approved_at IS NULL)),
 CHECK((file_status='Archived' AND archived_at IS NOT NULL AND archived_by IS NOT NULL)
    OR (file_status<>'Archived' AND archived_at IS NULL AND archived_by IS NULL)),
 CHECK(NOT is_demonstration OR (demonstration_warning='DEMONSTRATION DATA — NOT A REAL AUDIT / NOT FOR ISSUANCE' AND source_archive_read_only)),
 CHECK(source_archive_sha256 IS NULL OR source_archive_sha256 ~ '^[a-f0-9]{64}$')
);

CREATE TABLE erp_private.audit_account_mappings (
 audit_account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 legacy_account_code text NOT NULL,
 legacy_account_name text NOT NULL,
 audit_area text NOT NULL,
 financial_statement_line text NOT NULL,
 mapping_confidence text NOT NULL DEFAULT 'Confirmed' CHECK(mapping_confidence IN ('Suggested','Confirmed','Reviewer-approved')),
 change_reason text NOT NULL DEFAULT '',
 confirmed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(handling_firm_id,legacy_account_code),
 UNIQUE(audit_account_id,handling_firm_id),
 CHECK((mapping_confidence='Reviewer-approved' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
    OR (mapping_confidence<>'Reviewer-approved' AND reviewer_id IS NULL AND reviewed_at IS NULL))
);

CREATE TABLE erp_private.audit_templates (
 audit_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 template_key text NOT NULL,
 template_version integer NOT NULL DEFAULT 1 CHECK(template_version>0),
 title text NOT NULL,
 source_reference text NOT NULL,
 source_filename text NOT NULL DEFAULT '',
 source_version text NOT NULL DEFAULT '',
 audit_area text NOT NULL,
 standards_reference text NOT NULL,
 effective_from date NOT NULL,
 reporting_framework text NOT NULL,
 applicable_engagements text NOT NULL,
 trigger_condition text NOT NULL,
 required_evidence text NOT NULL,
 review_level text NOT NULL CHECK(review_level IN ('Supervisor','Manager','Partner','EQR if required')),
 template_text text NOT NULL,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Approved','Retired')),
 owner_id uuid NOT NULL REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 rights_cleared boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(handling_firm_id,template_key,template_version),
 CHECK((status='Approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND rights_cleared)
    OR (status<>'Approved' AND approved_by IS NULL AND approved_at IS NULL))
);

CREATE TABLE erp_private.audit_tb_imports (
 audit_tb_import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 source_document_id uuid NOT NULL REFERENCES erp_private.documents,
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 import_signature text NOT NULL CHECK(import_signature ~ '^[a-f0-9]{64}$'),
 sheet_name text NOT NULL,
 period_ends_on date NOT NULL,
 header_row integer NOT NULL CHECK(header_row>0),
 first_data_row integer NOT NULL CHECK(first_data_row>header_row),
 last_data_row integer NOT NULL CHECK(last_data_row>=first_data_row),
 column_mapping jsonb NOT NULL,
 period_kind text NOT NULL CHECK(period_kind IN ('Current','Comparative')),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Confirmed','Superseded')),
 source_row_count integer NOT NULL CHECK(source_row_count>0),
 total_debit numeric(30,12) NOT NULL,
 total_credit numeric(30,12) NOT NULL,
 difference numeric(30,12) GENERATED ALWAYS AS (total_debit-total_credit) STORED,
 imported_by uuid NOT NULL REFERENCES erp_private.staff_members,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 superseded_by uuid REFERENCES erp_private.audit_tb_imports DEFERRABLE INITIALLY DEFERRED,
 superseded_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_tb_import_id,audit_file_id,project_id,handling_firm_id),
 CHECK((status='Confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status='Draft' AND confirmed_by IS NULL AND confirmed_at IS NULL)
    OR (status='Superseded' AND ((confirmed_by IS NULL AND confirmed_at IS NULL) OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)))),
 CHECK((status='Superseded' AND superseded_reason IS NOT NULL)
    OR (status<>'Superseded' AND superseded_by IS NULL AND superseded_reason IS NULL))
);
CREATE UNIQUE INDEX audit_tb_one_active_import ON erp_private.audit_tb_imports(audit_file_id,period_kind) WHERE status IN ('Draft','Confirmed');
CREATE UNIQUE INDEX audit_tb_active_signature ON erp_private.audit_tb_imports(audit_file_id,period_kind,import_signature) WHERE status IN ('Draft','Confirmed');

CREATE TABLE erp_private.audit_tb_lines (
 audit_tb_line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_tb_import_id uuid NOT NULL,
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 source_row integer NOT NULL CHECK(source_row>0),
 legacy_account_code text NOT NULL,
 legacy_account_name text NOT NULL,
 source_debit numeric(30,12) NOT NULL CHECK(source_debit>=0),
 source_credit numeric(30,12) NOT NULL CHECK(source_credit>=0),
 audit_account_id uuid,
 audit_area text,
 financial_statement_line text,
 mapping_confidence text CHECK(mapping_confidence IS NULL OR mapping_confidence IN ('Suggested','Confirmed','Reviewer-approved')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_tb_import_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_tb_imports(audit_tb_import_id,audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(audit_account_id,handling_firm_id) REFERENCES erp_private.audit_account_mappings(audit_account_id,handling_firm_id),
 UNIQUE(audit_tb_import_id,legacy_account_code),
 CHECK(NOT(source_debit>0 AND source_credit>0))
);
CREATE INDEX audit_tb_lines_file_map_idx ON erp_private.audit_tb_lines(audit_file_id,audit_tb_import_id,audit_account_id);

CREATE TABLE erp_private.audit_workpapers (
 audit_workpaper_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 workpaper_ref text NOT NULL,
 audit_area text NOT NULL,
 objective text NOT NULL,
 assertion text NOT NULL,
 linked_risk text NOT NULL,
 standard_reference text NOT NULL,
 planned_procedure text NOT NULL,
 responsible_staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 sample_population text NOT NULL DEFAULT '',
 selection_method text NOT NULL DEFAULT '',
 work_performed text NOT NULL DEFAULT '',
 result text NOT NULL DEFAULT '',
 evidence_reference text NOT NULL DEFAULT '',
 evidence_document_id uuid REFERENCES erp_private.documents,
 deviations text NOT NULL DEFAULT '',
 professional_judgment text NOT NULL DEFAULT '',
 conclusion text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Approved')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 submitted_at timestamptz,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,workpaper_ref),
 UNIQUE(audit_workpaper_id,audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(evidence_document_id,project_id) REFERENCES erp_private.documents(document_id,project_id),
 CHECK(status NOT IN ('Submitted','Approved') OR submitted_at IS NOT NULL),
 CHECK(status<>'Approved' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by))
);
CREATE INDEX audit_workpapers_file_area_idx ON erp_private.audit_workpapers(audit_file_id,audit_area,status);

CREATE TABLE erp_private.audit_workpaper_versions (
 audit_workpaper_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_workpaper_id uuid NOT NULL REFERENCES erp_private.audit_workpapers,
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0),
 action text NOT NULL CHECK(action IN ('Submitted','Returned','Approved')),
 snapshot jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_workpaper_id,audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_workpapers(audit_workpaper_id,audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_workpaper_id,version_number)
);

CREATE TABLE erp_private.audit_completion_items (
 audit_completion_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 item_key text NOT NULL,
 label text NOT NULL,
 status text NOT NULL DEFAULT 'Not started' CHECK(status IN ('Not started','In progress','Prepared','Reviewed')),
 note text NOT NULL DEFAULT '',
 evidence_document_id uuid REFERENCES erp_private.documents,
 prepared_by uuid REFERENCES erp_private.staff_members,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 FOREIGN KEY(evidence_document_id,project_id) REFERENCES erp_private.documents(document_id,project_id),
 UNIQUE(audit_file_id,item_key)
);

-- Cover foreign keys and the file/row paging paths used by the workspace.
CREATE INDEX audit_files_project_scope_idx ON erp_private.audit_files(project_id,client_id,handling_firm_id);
CREATE INDEX audit_files_previous_scope_idx ON erp_private.audit_files(previous_audit_file_id,client_id,handling_firm_id);
CREATE INDEX audit_files_approver_idx ON erp_private.audit_files(framework_approved_by);
CREATE INDEX audit_files_archiver_idx ON erp_private.audit_files(archived_by);
CREATE INDEX audit_files_creator_idx ON erp_private.audit_files(created_by);
CREATE INDEX audit_accounts_confirmer_idx ON erp_private.audit_account_mappings(confirmed_by);
CREATE INDEX audit_accounts_reviewer_idx ON erp_private.audit_account_mappings(reviewer_id);
CREATE INDEX audit_templates_owner_idx ON erp_private.audit_templates(owner_id);
CREATE INDEX audit_templates_approver_idx ON erp_private.audit_templates(approved_by);
CREATE INDEX audit_tb_import_scope_idx ON erp_private.audit_tb_imports(audit_file_id,project_id,handling_firm_id);
CREATE INDEX audit_tb_source_document_idx ON erp_private.audit_tb_imports(source_document_id);
CREATE INDEX audit_tb_importer_idx ON erp_private.audit_tb_imports(imported_by);
CREATE INDEX audit_tb_confirmer_idx ON erp_private.audit_tb_imports(confirmed_by);
CREATE INDEX audit_tb_superseder_idx ON erp_private.audit_tb_imports(superseded_by);
CREATE INDEX audit_tb_lines_import_row_idx ON erp_private.audit_tb_lines(audit_tb_import_id,source_row);
CREATE INDEX audit_tb_lines_import_scope_idx ON erp_private.audit_tb_lines(audit_tb_import_id,audit_file_id,project_id,handling_firm_id);
CREATE INDEX audit_tb_lines_account_scope_idx ON erp_private.audit_tb_lines(audit_account_id,handling_firm_id);
CREATE INDEX audit_workpapers_file_scope_idx ON erp_private.audit_workpapers(audit_file_id,project_id,handling_firm_id);
CREATE INDEX audit_workpapers_responsible_idx ON erp_private.audit_workpapers(responsible_staff_id);
CREATE INDEX audit_workpapers_preparer_idx ON erp_private.audit_workpapers(prepared_by);
CREATE INDEX audit_workpapers_reviewer_idx ON erp_private.audit_workpapers(reviewer_id);
CREATE INDEX audit_workpapers_evidence_idx ON erp_private.audit_workpapers(evidence_document_id,project_id);
CREATE INDEX audit_workpaper_versions_scope_idx ON erp_private.audit_workpaper_versions(audit_workpaper_id,audit_file_id,project_id,handling_firm_id);
CREATE INDEX audit_workpaper_versions_actor_idx ON erp_private.audit_workpaper_versions(actor_id);
CREATE INDEX audit_completion_file_scope_idx ON erp_private.audit_completion_items(audit_file_id,project_id,handling_firm_id);
CREATE INDEX audit_completion_evidence_idx ON erp_private.audit_completion_items(evidence_document_id,project_id);
CREATE INDEX audit_completion_preparer_idx ON erp_private.audit_completion_items(prepared_by);
CREATE INDEX audit_completion_reviewer_idx ON erp_private.audit_completion_items(reviewer_id);

CREATE OR REPLACE FUNCTION erp_private.audit_reject_immutable_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 RAISE EXCEPTION 'Submitted audit snapshots are immutable.' USING ERRCODE='42501';
END; $$;

CREATE OR REPLACE FUNCTION erp_private.audit_template_version_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.status='Approved' THEN RAISE EXCEPTION 'Approved audit templates are locked. Create a new template version.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION erp_private.audit_tb_import_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE old_values jsonb; new_values jsonb;
BEGIN
 old_values=to_jsonb(OLD)-'status'-'confirmed_by'-'confirmed_at'-'superseded_by'-'superseded_reason'-'revision'-'updated_at';
 new_values=to_jsonb(NEW)-'status'-'confirmed_by'-'confirmed_at'-'superseded_by'-'superseded_reason'-'revision'-'updated_at';
 IF old_values IS DISTINCT FROM new_values THEN
  RAISE EXCEPTION 'Imported trial-balance source details are immutable.' USING ERRCODE='42501';
 END IF;
 IF OLD.status='Draft' AND NEW.status='Confirmed'
    AND NEW.confirmed_by IS NOT NULL AND NEW.confirmed_at IS NOT NULL
    AND NEW.superseded_by IS NULL AND NEW.superseded_reason IS NULL THEN RETURN NEW; END IF;
 IF OLD.status IN ('Draft','Confirmed') AND NEW.status='Superseded'
    AND NEW.superseded_reason IS NOT NULL AND NEW.superseded_by IS NULL
    AND NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by
    AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN RETURN NEW; END IF;
 IF OLD.status='Superseded' AND NEW.status='Superseded'
    AND OLD.superseded_by IS NULL AND NEW.superseded_by IS NOT NULL
    AND NEW.superseded_reason IS NOT DISTINCT FROM OLD.superseded_reason
    AND NEW.confirmed_by IS NOT DISTINCT FROM OLD.confirmed_by
    AND NEW.confirmed_at IS NOT DISTINCT FROM OLD.confirmed_at THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Trial-balance history cannot be rewritten.' USING ERRCODE='42501';
END; $$;

CREATE OR REPLACE FUNCTION erp_private.audit_tb_line_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE import_status text;
BEGIN
 IF ROW(NEW.audit_tb_import_id,NEW.audit_file_id,NEW.project_id,NEW.handling_firm_id,NEW.source_row,NEW.legacy_account_code,NEW.legacy_account_name,NEW.source_debit,NEW.source_credit)
    IS DISTINCT FROM ROW(OLD.audit_tb_import_id,OLD.audit_file_id,OLD.project_id,OLD.handling_firm_id,OLD.source_row,OLD.legacy_account_code,OLD.legacy_account_name,OLD.source_debit,OLD.source_credit) THEN
  RAISE EXCEPTION 'Imported trial-balance rows and amounts are immutable.' USING ERRCODE='42501';
 END IF;
 SELECT status INTO import_status FROM erp_private.audit_tb_imports WHERE audit_tb_import_id=OLD.audit_tb_import_id;
 IF import_status IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Confirmed trial-balance mappings are locked.' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END; $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['audit_files','audit_account_mappings','audit_templates','audit_tb_imports','audit_tb_lines','audit_workpapers','audit_workpaper_versions','audit_completion_items'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
END; $$;

CREATE TRIGGER audit_workpaper_version_immutable BEFORE UPDATE OR DELETE ON erp_private.audit_workpaper_versions
 FOR EACH ROW EXECUTE FUNCTION erp_private.audit_reject_immutable_change();
CREATE TRIGGER audit_template_approved_lock BEFORE UPDATE ON erp_private.audit_templates
 FOR EACH ROW EXECUTE FUNCTION erp_private.audit_template_version_guard();
CREATE TRIGGER audit_tb_import_history_guard BEFORE UPDATE ON erp_private.audit_tb_imports
 FOR EACH ROW EXECUTE FUNCTION erp_private.audit_tb_import_guard();
CREATE TRIGGER audit_tb_line_history_guard BEFORE UPDATE ON erp_private.audit_tb_lines
 FOR EACH ROW EXECUTE FUNCTION erp_private.audit_tb_line_guard();
CREATE TRIGGER audit_tb_line_mapping_log AFTER UPDATE ON erp_private.audit_tb_lines
 FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_tb_line_id');

CREATE POLICY audit_file_read ON erp_private.audit_files FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=audit_files.project_id AND p.service_code LIKE 'AUD-%'));
CREATE POLICY audit_file_write ON erp_private.audit_files FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY audit_account_map_read ON erp_private.audit_account_mappings FOR SELECT TO erp_api USING(erp_private.firm_allowed(handling_firm_id));
CREATE POLICY audit_account_map_write ON erp_private.audit_account_mappings FOR ALL TO erp_api USING(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_template_read ON erp_private.audit_templates FOR SELECT TO erp_api USING(erp_private.firm_allowed(handling_firm_id));
CREATE POLICY audit_template_write ON erp_private.audit_templates FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id)) WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id));
CREATE POLICY audit_tb_import_read ON erp_private.audit_tb_imports FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY audit_tb_import_write ON erp_private.audit_tb_imports FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_tb_line_read ON erp_private.audit_tb_lines FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY audit_tb_line_write ON erp_private.audit_tb_lines FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_workpaper_read ON erp_private.audit_workpapers FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY audit_workpaper_write ON erp_private.audit_workpapers FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (prepared_by=(erp_private.actor()).staff_id OR erp_private.project_editor())) WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_workpaper_version_read ON erp_private.audit_workpaper_versions FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY audit_workpaper_version_add ON erp_private.audit_workpaper_versions FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND actor_id=(erp_private.actor()).staff_id);
CREATE POLICY audit_completion_read ON erp_private.audit_completion_items FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY audit_completion_write ON erp_private.audit_completion_items FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

GRANT SELECT,INSERT,UPDATE ON erp_private.audit_files,erp_private.audit_account_mappings,erp_private.audit_templates,erp_private.audit_tb_imports,erp_private.audit_tb_lines,erp_private.audit_workpapers,erp_private.audit_completion_items TO erp_api;
GRANT SELECT,INSERT ON erp_private.audit_workpaper_versions TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.audit_reject_immutable_change() TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.audit_template_version_guard() TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.audit_tb_import_guard() TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.audit_tb_line_guard() TO erp_api;

CREATE TRIGGER audit_files_revision BEFORE UPDATE ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER audit_account_mappings_revision BEFORE UPDATE ON erp_private.audit_account_mappings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER audit_templates_revision BEFORE UPDATE ON erp_private.audit_templates FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER audit_tb_imports_revision BEFORE UPDATE ON erp_private.audit_tb_imports FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER audit_workpapers_revision BEFORE UPDATE ON erp_private.audit_workpapers FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER audit_completion_revision BEFORE UPDATE ON erp_private.audit_completion_items FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE TRIGGER audit_files_log AFTER INSERT OR UPDATE ON erp_private.audit_files FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_file_id');
CREATE TRIGGER audit_accounts_log AFTER INSERT OR UPDATE ON erp_private.audit_account_mappings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_account_id');
CREATE TRIGGER audit_templates_log AFTER INSERT OR UPDATE ON erp_private.audit_templates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_template_id');
CREATE TRIGGER audit_tb_imports_log AFTER INSERT OR UPDATE ON erp_private.audit_tb_imports FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_tb_import_id');
CREATE TRIGGER audit_workpapers_log AFTER INSERT OR UPDATE ON erp_private.audit_workpapers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_workpaper_id');
CREATE TRIGGER audit_completion_log AFTER INSERT OR UPDATE ON erp_private.audit_completion_items FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_completion_item_id');
