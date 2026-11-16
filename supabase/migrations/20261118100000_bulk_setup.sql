-- Build 2842: bulk client set-up. A Manager or Partner applies one set-up choice to many clients at once (a service engagement from an approved template, or the payroll
-- returns a client files). Each row is checked on its own: rows that pass are applied through the same single-client rules, rows that fail are recorded as skipped with the
-- reason and shown on a separate exceptions list. Nothing here approves or posts anything; independent review is unchanged because every row goes through the existing action.
-- These two tables are the audit record: one run per submission, one row per client and item. They are insert-only (no UPDATE or DELETE grant, and triggers refuse both).
CREATE TABLE erp_private.bulk_setup_runs(
 run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation text NOT NULL CHECK(operation IN('ENGAGEMENT','PAYROLL_RETURNS')),
 parameters jsonb NOT NULL,
 row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 200),
 applied_count integer NOT NULL CHECK(applied_count>=0),
 skipped_count integer NOT NULL CHECK(skipped_count>=0),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(applied_count+skipped_count=row_count)
);
CREATE INDEX bulk_setup_runs_created_by_idx ON erp_private.bulk_setup_runs(created_by,created_at DESC);
CREATE TABLE erp_private.bulk_setup_rows(
 row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 run_id uuid NOT NULL REFERENCES erp_private.bulk_setup_runs ON DELETE RESTRICT,
 row_no integer NOT NULL CHECK(row_no>=1),
 client_id uuid REFERENCES erp_private.clients ON DELETE RESTRICT,
 client_label text CHECK(client_label IS NULL OR char_length(client_label)<=200),
 item text NOT NULL CHECK(char_length(btrim(item)) BETWEEN 1 AND 120),
 outcome text NOT NULL CHECK(outcome IN('Applied','Skipped')),
 reason text CHECK(reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 600),
 record_ref text CHECK(record_ref IS NULL OR char_length(record_ref)<=80),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,row_no),
 CHECK(outcome<>'Skipped' OR reason IS NOT NULL),
 CHECK(outcome<>'Applied' OR (record_ref IS NOT NULL AND client_id IS NOT NULL))
);
CREATE INDEX bulk_setup_rows_client_idx ON erp_private.bulk_setup_rows(client_id,created_at DESC) WHERE client_id IS NOT NULL;
ALTER TABLE erp_private.bulk_setup_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bulk_setup_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bulk_setup_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.bulk_setup_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.bulk_setup_runs TO erp_api;
GRANT SELECT,INSERT ON erp_private.bulk_setup_rows TO erp_api;
CREATE POLICY bsr_read ON erp_private.bulk_setup_runs FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY bsr_insert ON erp_private.bulk_setup_runs FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY bsw_read ON erp_private.bulk_setup_rows FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY bsw_insert ON erp_private.bulk_setup_rows FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND (client_id IS NULL OR erp_private.client_allowed(client_id))
 AND EXISTS(SELECT 1 FROM erp_private.bulk_setup_runs r WHERE r.run_id=bulk_setup_rows.run_id AND r.created_by=(erp_private.actor()).staff_id));
CREATE FUNCTION erp_private.bulk_setup_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A bulk set-up record is part of the audit trail and cannot be changed or removed.' USING ERRCODE='42501'; END;$$;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.bulk_setup_runs FOR EACH ROW EXECUTE FUNCTION erp_private.bulk_setup_immutable();
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.bulk_setup_rows FOR EACH ROW EXECUTE FUNCTION erp_private.bulk_setup_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.bulk_setup_runs FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('run_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.bulk_setup_rows FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('row_id');
