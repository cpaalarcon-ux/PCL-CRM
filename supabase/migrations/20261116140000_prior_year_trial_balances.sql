-- Build 2824: prior-year trial balances as inputs to the comparatives.
-- An opening trial balance (balances at the start of a year), a year-end trial balance (balances at its end) and a year's activity are different things.
-- A Manager or Partner records each as a numbered version for a client and a date; a new version supersedes the old one and nothing is deleted.
-- Comparatives built from them go through the same Partner approval as typed comparatives. Where a trial balance is missing, that statement is "Not available",
-- never zero.
CREATE TABLE erp_private.client_year_tbs(
 tb_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 tb_kind text NOT NULL CHECK(tb_kind IN('Year-end','Opening')),
 as_of date NOT NULL CHECK(as_of>=DATE '2000-01-01'),
 closing_state text NOT NULL CHECK(closing_state IN('Before year-end close','After year-end close')),
 version integer NOT NULL CHECK(version>=1),
 status text NOT NULL DEFAULT 'Current' CHECK(status IN('Current','Superseded')),
 source_reference text NOT NULL CHECK(char_length(btrim(source_reference)) BETWEEN 10 AND 500),
 row_count integer NOT NULL CHECK(row_count>=1),
 total_debit numeric(18,2) NOT NULL CHECK(total_debit>=0),
 total_credit numeric(18,2) NOT NULL CHECK(total_credit>=0),
 digest text NOT NULL CHECK(digest ~ '^[0-9a-f]{64}$'),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 entered_at timestamptz NOT NULL DEFAULT now(),
 superseded_at timestamptz,
 UNIQUE(client_id,tb_kind,as_of,version),
 CHECK(abs(total_debit-total_credit)<0.01),
 CHECK(tb_kind<>'Opening' OR closing_state='After year-end close'),
 CHECK(status<>'Superseded' OR superseded_at IS NOT NULL)
);
CREATE UNIQUE INDEX client_year_tbs_one_current ON erp_private.client_year_tbs(client_id,tb_kind,as_of) WHERE status='Current';
CREATE INDEX client_year_tbs_project_idx ON erp_private.client_year_tbs(project_id);
CREATE INDEX client_year_tbs_entered_idx ON erp_private.client_year_tbs(entered_by);
CREATE TABLE erp_private.client_year_tb_rows(
 tb_id uuid NOT NULL REFERENCES erp_private.client_year_tbs ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 account_code text NOT NULL REFERENCES erp_private.account_catalog(code),
 debit numeric(18,2) NOT NULL DEFAULT 0 CHECK(debit>=0 AND debit<1000000000000),
 credit numeric(18,2) NOT NULL DEFAULT 0 CHECK(credit>=0 AND credit<1000000000000),
 PRIMARY KEY(tb_id,account_code),
 CHECK(debit=0 OR credit=0)
);
CREATE INDEX client_year_tb_rows_client_idx ON erp_private.client_year_tb_rows(client_id);
CREATE INDEX client_year_tb_rows_account_idx ON erp_private.client_year_tb_rows(account_code);
ALTER TABLE erp_private.client_year_tbs ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_year_tbs FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_year_tb_rows ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_year_tb_rows FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_year_tbs TO erp_api;
GRANT SELECT,INSERT ON erp_private.client_year_tb_rows TO erp_api;
REVOKE ALL ON erp_private.client_year_tbs,erp_private.client_year_tb_rows FROM PUBLIC,anon,authenticated;
CREATE POLICY client_year_tbs_read ON erp_private.client_year_tbs FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY client_year_tbs_insert ON erp_private.client_year_tbs FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND entered_by=(erp_private.actor()).staff_id);
CREATE POLICY client_year_tbs_update ON erp_private.client_year_tbs FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY client_year_tb_rows_read ON erp_private.client_year_tb_rows FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY client_year_tb_rows_insert ON erp_private.client_year_tb_rows FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_year_tbs FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_year_tb_rows FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_year_tbs FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('tb_id');
CREATE FUNCTION erp_private.client_year_tbs_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.client_id,NEW.project_id,NEW.tb_kind,NEW.as_of,NEW.closing_state,NEW.version,NEW.source_reference,NEW.row_count,NEW.total_debit,NEW.total_credit,NEW.digest,NEW.entered_by,NEW.entered_at)
   IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.tb_kind,OLD.as_of,OLD.closing_state,OLD.version,OLD.source_reference,OLD.row_count,OLD.total_debit,OLD.total_credit,OLD.digest,OLD.entered_by,OLD.entered_at) THEN
   RAISE EXCEPTION 'A recorded trial balance is never edited. Record a new version.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Superseded' OR NEW.status<>'Superseded' THEN RAISE EXCEPTION 'A trial balance version can only be superseded.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status<>'Current' OR NEW.version<>coalesce((SELECT max(version) FROM erp_private.client_year_tbs WHERE client_id=NEW.client_id AND tb_kind=NEW.tb_kind AND as_of=NEW.as_of),0)+1 THEN
  RAISE EXCEPTION 'Versions are numbered in order and start as current.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_year_tbs_guard BEFORE INSERT OR UPDATE ON erp_private.client_year_tbs FOR EACH ROW EXECUTE FUNCTION erp_private.client_year_tbs_guard();
REVOKE ALL ON FUNCTION erp_private.client_year_tbs_guard() FROM PUBLIC,anon,authenticated;

-- Comparatives built from recorded trial balances say so, and name the versions they used.
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.period_comparative_sets'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%source_kind%' LOOP
  EXECUTE format('ALTER TABLE erp_private.period_comparative_sets DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.period_comparative_sets ADD CONSTRAINT period_comparative_sets_source_kind_check CHECK(source_kind IN('Signed prior-year financial statements','Prior-year accounting records outside the ERP','Management accounts','Recorded prior-year trial balances'));
ALTER TABLE erp_private.period_comparative_sets ADD COLUMN source_tb_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];
