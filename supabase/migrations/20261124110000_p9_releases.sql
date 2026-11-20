-- Build 2877: record of released P9 tax deduction cards. One row per employee card, insert-only, with a hash of the file.
-- The card holds personal data and is not kept: it can be rebuilt from the confirmed payroll months. Totals are kept so a later change in the payroll can be spotted.
ALTER TABLE erp_private.payroll_access_log DROP CONSTRAINT IF EXISTS payroll_access_log_surface_check;
ALTER TABLE erp_private.payroll_access_log ADD CONSTRAINT payroll_access_log_surface_check CHECK(surface IN('Payroll register','Payroll run','Payroll review','Client confirmation','Confirmation PDF','Payroll file','P9 cards'));

CREATE TABLE erp_private.p9_releases(
 release_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 tax_year integer NOT NULL CHECK(tax_year BETWEEN 2015 AND 2100),
 employee_pin text NOT NULL CHECK(employee_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),
 employee_name text NOT NULL CHECK(char_length(btrim(employee_name)) BETWEEN 1 AND 160),
 months_on_payroll integer NOT NULL CHECK(months_on_payroll BETWEEN 1 AND 12),
 total_chargeable_pay numeric(14,2) NOT NULL CHECK(total_chargeable_pay>=0),
 total_paye numeric(14,2) NOT NULL CHECK(total_paye>=0),
 notes jsonb NOT NULL DEFAULT '[]'::jsonb,
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 generated_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 generated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX p9_releases_client_idx ON erp_private.p9_releases(client_id,tax_year);
CREATE INDEX p9_releases_project_idx ON erp_private.p9_releases(project_id);
CREATE INDEX p9_releases_by_idx ON erp_private.p9_releases(generated_by);
ALTER TABLE erp_private.p9_releases ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.p9_releases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.p9_releases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.p9_releases TO erp_api;
CREATE POLICY p9_releases_read ON erp_private.p9_releases FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY p9_releases_insert ON erp_private.p9_releases FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND generated_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.p9_releases FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.p9_releases_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A released P9 record is never edited.' USING ERRCODE='23514'; END $$;
REVOKE ALL ON FUNCTION erp_private.p9_releases_immutable() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER p9_releases_no_update BEFORE UPDATE ON erp_private.p9_releases FOR EACH ROW EXECUTE FUNCTION erp_private.p9_releases_immutable();
-- The project must belong to the same client, so a card cannot be recorded against another client's project.
CREATE FUNCTION erp_private.p9_releases_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id) THEN RAISE EXCEPTION 'The project must belong to the same client as the P9 record.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.p9_releases_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER p9_releases_guard BEFORE INSERT ON erp_private.p9_releases FOR EACH ROW EXECUTE FUNCTION erp_private.p9_releases_guard();
CREATE TRIGGER audit AFTER INSERT ON erp_private.p9_releases FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('release_id');
COMMENT ON TABLE erp_private.p9_releases IS 'Released P9 tax deduction cards: who, when, which year and employee, the totals and a hash of the file. The card itself is not kept.';
