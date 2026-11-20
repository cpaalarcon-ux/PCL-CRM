-- Build 2831a: KRA VAT auto-populated return CSVs kept as source evidence, and reconciled to the approved registers.
-- 1. Every uploaded CSV is retained exactly as received (text, hash, file name), per client, period month and KRA section. A corrected upload for the same
--    month and section is a NEW version that supersedes the earlier one with a reason; nothing is overwritten or deleted, so each month's original is kept.
-- 2. The CSV is parsed into lines that keep invoice numbers and PINs as text (leading zeros survive) with the original cells alongside.
-- 3. A reviewer's decision on a difference (explained, register to be corrected, query raised, accepted) is recorded as insert-only history.
-- None of this posts or changes the sales or purchases registers: the CSV is evidence and the reconciliation is a review aid.
CREATE TABLE erp_private.kra_csv_batches(
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 side text NOT NULL CHECK(side IN('Sales','Purchases')),
 section text NOT NULL CHECK(section IN('B','C','D1','E','F','G','H','I')),
 period_month date NOT NULL CHECK(date_trunc('month',period_month)::date=period_month),
 version integer NOT NULL CHECK(version>=1),
 supersedes_batch_id uuid REFERENCES erp_private.kra_csv_batches(batch_id) ON DELETE RESTRICT,
 supersede_reason text CHECK(supersede_reason IS NULL OR char_length(btrim(supersede_reason)) BETWEEN 10 AND 500),
 file_name text NOT NULL CHECK(char_length(btrim(file_name)) BETWEEN 1 AND 200),
 content_text text NOT NULL CHECK(char_length(content_text) BETWEEN 1 AND 4000000),
 content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[0-9a-f]{64}$'),
 line_count integer NOT NULL CHECK(line_count>=0),
 totals jsonb NOT NULL DEFAULT '{}'::jsonb,
 issues jsonb NOT NULL DEFAULT '[]'::jsonb,
 uploaded_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT kra_csv_side_matches_section CHECK((side='Sales')=(section IN('B','C','D1','E'))),
 CONSTRAINT kra_csv_version_chain CHECK((version=1)=(supersedes_batch_id IS NULL) AND (version=1 OR supersede_reason IS NOT NULL)),
 UNIQUE(client_id,side,section,period_month,version),
 UNIQUE(client_id,side,section,period_month,content_sha256)
);
CREATE INDEX kra_csv_batches_project_idx ON erp_private.kra_csv_batches(project_id);
CREATE INDEX kra_csv_batches_supersedes_idx ON erp_private.kra_csv_batches(supersedes_batch_id);
CREATE INDEX kra_csv_batches_by_idx ON erp_private.kra_csv_batches(uploaded_by);
CREATE TABLE erp_private.kra_csv_lines(
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 batch_id uuid NOT NULL REFERENCES erp_private.kra_csv_batches(batch_id) ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 line_no integer NOT NULL CHECK(line_no>=1),
 invoice_no text NOT NULL CHECK(char_length(invoice_no) BETWEEN 1 AND 100),
 original_invoice text,
 invoice_date date,
 party_pin text,
 party_name text,
 description text,
 net numeric(16,2) NOT NULL,
 vat numeric(16,2) NOT NULL,
 vat_derived boolean NOT NULL DEFAULT false,
 vat_category text NOT NULL CHECK(vat_category IN('16%','8%','0%','Exempt')),
 document_type text NOT NULL CHECK(document_type IN('Invoice','Credit note')),
 raw jsonb NOT NULL,
 UNIQUE(batch_id,line_no)
);
CREATE INDEX kra_csv_lines_client_idx ON erp_private.kra_csv_lines(client_id,invoice_no);
CREATE TABLE erp_private.kra_csv_reviews(
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 side text NOT NULL CHECK(side IN('Sales','Purchases')),
 period_month date NOT NULL CHECK(date_trunc('month',period_month)::date=period_month),
 scope_key text NOT NULL CHECK(char_length(scope_key) BETWEEN 1 AND 200),
 difference_kind text NOT NULL CHECK(char_length(difference_kind) BETWEEN 1 AND 60),
 evidence_hash text NOT NULL CHECK(char_length(evidence_hash) BETWEEN 8 AND 128),
 disposition text NOT NULL CHECK(disposition IN('Explained','Register to be corrected','Query raised','Accepted difference')),
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 reviewed_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kra_csv_reviews_client_idx ON erp_private.kra_csv_reviews(client_id,period_month,side,scope_key,reviewed_at DESC);
CREATE INDEX kra_csv_reviews_project_idx ON erp_private.kra_csv_reviews(project_id);
CREATE INDEX kra_csv_reviews_by_idx ON erp_private.kra_csv_reviews(reviewed_by);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['kra_csv_batches','kra_csv_lines','kra_csv_reviews'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT ON erp_private.%I TO erp_api',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN(''INTERN'',''ADMIN''))',t||'_read',t);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
END LOOP; END $$;
CREATE POLICY kra_csv_batches_insert ON erp_private.kra_csv_batches FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND uploaded_by=(erp_private.actor()).staff_id);
CREATE POLICY kra_csv_lines_insert ON erp_private.kra_csv_lines FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY kra_csv_reviews_insert ON erp_private.kra_csv_reviews FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND reviewed_by=(erp_private.actor()).staff_id);
CREATE FUNCTION erp_private.kra_csv_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'Retained KRA CSV evidence is never edited. Upload a corrected file as a new version.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER kra_csv_batches_no_update BEFORE UPDATE ON erp_private.kra_csv_batches FOR EACH ROW EXECUTE FUNCTION erp_private.kra_csv_immutable();
CREATE TRIGGER kra_csv_lines_no_update BEFORE UPDATE ON erp_private.kra_csv_lines FOR EACH ROW EXECUTE FUNCTION erp_private.kra_csv_immutable();
CREATE TRIGGER kra_csv_reviews_no_update BEFORE UPDATE ON erp_private.kra_csv_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.kra_csv_immutable();
-- A new version must follow the latest version for the same client, section and month, and a line must belong to a batch of the same client.
CREATE FUNCTION erp_private.kra_csv_batch_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE latest erp_private.kra_csv_batches;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.deleted_at IS NULL AND p.status<>'Archived') THEN RAISE EXCEPTION 'Use the active project of this client.' USING ERRCODE='23514'; END IF;
 SELECT * INTO latest FROM erp_private.kra_csv_batches b WHERE b.client_id=NEW.client_id AND b.side=NEW.side AND b.section=NEW.section AND b.period_month=NEW.period_month ORDER BY b.version DESC LIMIT 1;
 IF latest.batch_id IS NULL THEN
  IF NEW.version<>1 THEN RAISE EXCEPTION 'The first upload for a month and section is version 1.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.version<>latest.version+1 OR NEW.supersedes_batch_id IS DISTINCT FROM latest.batch_id THEN RAISE EXCEPTION 'A corrected file must supersede the latest version for this month and section.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kra_csv_batch_guard BEFORE INSERT ON erp_private.kra_csv_batches FOR EACH ROW EXECUTE FUNCTION erp_private.kra_csv_batch_guard();
CREATE FUNCTION erp_private.kra_csv_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.kra_csv_batches b WHERE b.batch_id=NEW.batch_id AND b.client_id=NEW.client_id) THEN RAISE EXCEPTION 'The line must belong to a batch of this client.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kra_csv_line_guard BEFORE INSERT ON erp_private.kra_csv_lines FOR EACH ROW EXECUTE FUNCTION erp_private.kra_csv_line_guard();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.kra_csv_batches FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('batch_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.kra_csv_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('review_id');
REVOKE ALL ON FUNCTION erp_private.kra_csv_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.kra_csv_batch_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.kra_csv_line_guard() FROM PUBLIC,anon,authenticated;
