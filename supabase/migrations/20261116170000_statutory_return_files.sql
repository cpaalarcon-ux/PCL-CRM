-- Build 2829: statutory return files (NSSF, SHIF, PAYE P10 Section B/E) built from a confirmed payroll summary.
-- 1. The payroll register holds the identifiers these files need and the payroll summary does not: names split as the agencies want them, ID type,
--    NSSF number, SHA (SHIF) number, payroll number, and the P10 fields (employee type, disability, exemption certificate).
-- 2. Every released file is recorded: layout, month, totals, the reconciliation to the posted journal and a hash of the file. The file itself is not kept
--    (it holds personal data and can be rebuilt from the confirmed summary), but the record shows exactly what was produced, by whom and when. Insert-only.
ALTER TABLE erp_private.client_payroll_people
 ADD COLUMN surname text CHECK(surname IS NULL OR char_length(btrim(surname)) BETWEEN 1 AND 80),
 ADD COLUMN other_names text CHECK(other_names IS NULL OR char_length(btrim(other_names)) BETWEEN 1 AND 120),
 ADD COLUMN id_type text CHECK(id_type IS NULL OR id_type IN('National ID','Passport','Alien ID')),
 ADD COLUMN nssf_number text CHECK(nssf_number IS NULL OR nssf_number ~ '^[A-Za-z0-9/-]{3,20}$'),
 ADD COLUMN sha_number text CHECK(sha_number IS NULL OR sha_number ~ '^[A-Za-z0-9/-]{3,20}$'),
 ADD COLUMN payroll_number text CHECK(payroll_number IS NULL OR char_length(btrim(payroll_number)) BETWEEN 1 AND 30),
 ADD COLUMN p10_employee_type text NOT NULL DEFAULT 'Primary Employee' CHECK(p10_employee_type IN('Primary Employee','Secondary Employee')),
 ADD COLUMN disability boolean NOT NULL DEFAULT false,
 ADD COLUMN exemption_certificate text CHECK(exemption_certificate IS NULL OR char_length(btrim(exemption_certificate)) BETWEEN 1 AND 50),
 ADD CONSTRAINT client_payroll_people_exemption_needs_disability CHECK(exemption_certificate IS NULL OR disability);
CREATE UNIQUE INDEX client_payroll_people_payroll_no_uidx ON erp_private.client_payroll_people(client_id,payroll_number) WHERE payroll_number IS NOT NULL AND status='Active';

CREATE TABLE erp_private.statutory_file_exports(
 export_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 import_id uuid NOT NULL REFERENCES erp_private.period_imports(import_id) ON DELETE RESTRICT,
 journal_id uuid REFERENCES erp_private.ledger_journals(journal_id) ON DELETE RESTRICT,
 file_kind text NOT NULL CHECK(file_kind IN('NSSF','SHIF','PAYE_P10')),
 layout_code text NOT NULL CHECK(char_length(layout_code) BETWEEN 3 AND 80),
 month date NOT NULL,
 row_count integer NOT NULL CHECK(row_count>=0),
 totals jsonb NOT NULL DEFAULT '{}'::jsonb,
 reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
 notes jsonb NOT NULL DEFAULT '[]'::jsonb,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 generated_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX statutory_file_exports_client_idx ON erp_private.statutory_file_exports(client_id,month,file_kind);
CREATE INDEX statutory_file_exports_project_idx ON erp_private.statutory_file_exports(project_id);
CREATE INDEX statutory_file_exports_import_idx ON erp_private.statutory_file_exports(import_id);
CREATE INDEX statutory_file_exports_journal_idx ON erp_private.statutory_file_exports(journal_id);
CREATE INDEX statutory_file_exports_by_idx ON erp_private.statutory_file_exports(generated_by);
ALTER TABLE erp_private.statutory_file_exports ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.statutory_file_exports FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.statutory_file_exports TO erp_api;
CREATE POLICY statutory_exports_read ON erp_private.statutory_file_exports FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY statutory_exports_insert ON erp_private.statutory_file_exports FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND generated_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.statutory_file_exports FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.statutory_exports_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A released statutory file record is never edited.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER statutory_exports_no_update BEFORE UPDATE ON erp_private.statutory_file_exports FOR EACH ROW EXECUTE FUNCTION erp_private.statutory_exports_immutable();
-- The record must belong to one client: the project, summary and journal all have to be this client's, so a file cannot be filed against another client's payroll.
CREATE FUNCTION erp_private.statutory_exports_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id) THEN RAISE EXCEPTION 'The project does not belong to this client.' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.period_imports i WHERE i.import_id=NEW.import_id AND i.client_id=NEW.client_id AND i.kind='Payroll' AND i.status='Confirmed') THEN RAISE EXCEPTION 'A statutory file is released only from a confirmed payroll summary of this client.' USING ERRCODE='23514'; END IF;
 IF NEW.journal_id IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.ledger_journals j WHERE j.journal_id=NEW.journal_id AND j.project_id=NEW.project_id AND j.status='Posted') THEN RAISE EXCEPTION 'A statutory file is released only against a posted payroll journal.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER statutory_exports_guard BEFORE INSERT ON erp_private.statutory_file_exports FOR EACH ROW EXECUTE FUNCTION erp_private.statutory_exports_guard();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.statutory_file_exports FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('export_id');
REVOKE ALL ON erp_private.statutory_file_exports FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.statutory_exports_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.statutory_exports_guard() FROM PUBLIC,anon,authenticated;
