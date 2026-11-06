-- Replacing old invoice-by-invoice sales with category totals. The wizard shows the counts, prepares a draft reversal of every posted sales
-- journal built from the old rows (a different Manager or Partner reviews and posts it in the usual journal flow), and only then archives the
-- old batches. Rows are never deleted. The credit-note answer given at the start is kept here and the new totals import must use the same one.
CREATE TABLE erp_private.legacy_sales_replacements(
 replacement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES erp_private.projects(project_id),
 client_id uuid NOT NULL REFERENCES erp_private.clients(client_id),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 credit_basis text NOT NULL CHECK(credit_basis IN('After credit notes','Before credit notes')),
 batch_ids uuid[] NOT NULL,
 row_count integer NOT NULL CHECK(row_count>=0),
 net numeric(18,2) NOT NULL,vat numeric(18,2) NOT NULL,gross numeric(18,2) NOT NULL,
 journals jsonb NOT NULL DEFAULT '[]'::jsonb,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 2000),
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Complete')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 completed_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 completed_at timestamptz,
 CHECK(ends_on>=starts_on),
 CHECK(status<>'Complete' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE UNIQUE INDEX legacy_sales_replacements_one_open ON erp_private.legacy_sales_replacements(project_id) WHERE status='Open';
CREATE INDEX legacy_sales_replacements_project_idx ON erp_private.legacy_sales_replacements(project_id,starts_on,ends_on);
CREATE INDEX legacy_sales_replacements_client_idx ON erp_private.legacy_sales_replacements(client_id);
CREATE INDEX legacy_sales_replacements_prepared_idx ON erp_private.legacy_sales_replacements(prepared_by);
CREATE INDEX legacy_sales_replacements_completed_idx ON erp_private.legacy_sales_replacements(completed_by) WHERE completed_by IS NOT NULL;

-- What was counted and decided is fixed. While open, only the list of prepared reversals may grow; completion is one-way.
CREATE FUNCTION erp_private.legacy_sales_replacement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=erp_private,pg_temp AS $$
BEGIN
 IF OLD.status='Complete' THEN RAISE EXCEPTION 'A completed replacement cannot be changed.' USING ERRCODE='42501'; END IF;
 IF (NEW.project_id,NEW.client_id,NEW.starts_on,NEW.ends_on,NEW.credit_basis,NEW.batch_ids,NEW.row_count,NEW.net,NEW.vat,NEW.gross,NEW.reason,NEW.prepared_by,NEW.prepared_at)
   IS DISTINCT FROM (OLD.project_id,OLD.client_id,OLD.starts_on,OLD.ends_on,OLD.credit_basis,OLD.batch_ids,OLD.row_count,OLD.net,OLD.vat,OLD.gross,OLD.reason,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'The counted rows, reason and credit-note answer of a replacement cannot change.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_sales_replacement_guard BEFORE UPDATE ON erp_private.legacy_sales_replacements FOR EACH ROW EXECUTE FUNCTION erp_private.legacy_sales_replacement_guard();
CREATE TRIGGER legacy_sales_replacements_audit AFTER INSERT OR UPDATE ON erp_private.legacy_sales_replacements FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('replacement_id');

ALTER TABLE erp_private.legacy_sales_replacements ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.legacy_sales_replacements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.legacy_sales_replacements FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON erp_private.legacy_sales_replacements TO erp_api;
CREATE POLICY legacy_sales_replacements_read ON erp_private.legacy_sales_replacements FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY legacy_sales_replacements_add ON erp_private.legacy_sales_replacements FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND prepared_by=(erp_private.actor()).staff_id AND status='Open');
CREATE POLICY legacy_sales_replacements_change ON erp_private.legacy_sales_replacements FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'));

-- Archiving an import batch is allowed by an earlier migration (archive columns and policies), but the original "immutable" trigger on
-- workbook_batches still rejected every update, so no batch could ever be archived (staging has none). Keep batches append-only except for
-- the one-way archive columns: once archived, a batch is frozen.
DROP TRIGGER immutable ON erp_private.workbook_batches;
CREATE FUNCTION erp_private.workbook_batch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=erp_private,pg_temp AS $$
BEGIN
 IF OLD.archived_at IS NOT NULL THEN RAISE EXCEPTION 'An archived import cannot be changed.' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'archived_at'-'archived_by'-'archive_reason') IS DISTINCT FROM (to_jsonb(OLD)-'archived_at'-'archived_by'-'archive_reason') THEN
  RAISE EXCEPTION 'Imported batches cannot be edited. Archive the batch and import a corrected file.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.workbook_batches FOR EACH ROW EXECUTE FUNCTION erp_private.workbook_batch_guard();
