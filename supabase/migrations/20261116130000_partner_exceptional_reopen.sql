-- Build 2823: Partner exceptional reopen of a confirmed source summary (sales or payroll).
-- A confirmed summary is not edited. The normal ways to change one are an amendment (reversal and replacement) when entries were posted, or a new version.
-- The one exception is a Partner reopening a confirmed summary from which NOTHING has been prepared or posted (no entry, no live amendment, tax period still open).
-- It needs a written reason of at least 30 characters, returns the summary to the preparer, releases its coverage days, and is kept in an insert-only record.
-- The returned summary must be submitted and confirmed again by an independent reviewer as usual. Nothing is deleted.
CREATE TABLE erp_private.record_reopens(
 reopen_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 record_kind text NOT NULL CHECK(record_kind IN('Period import')),
 record_id uuid NOT NULL REFERENCES erp_private.period_imports(import_id) ON DELETE RESTRICT,
 summary_kind text NOT NULL CHECK(summary_kind IN('Sales','Payroll')),
 starts_on date NOT NULL,
 ends_on date NOT NULL,
 prior_status text NOT NULL CHECK(prior_status='Confirmed'),
 prior_reviewed_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 prior_review_note text,
 prior_totals jsonb NOT NULL DEFAULT '{}'::jsonb,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 30 AND 2000),
 reopened_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 reopened_at timestamptz NOT NULL DEFAULT now(),
 sole_partner boolean NOT NULL DEFAULT false,
 CHECK(ends_on>=starts_on)
);
CREATE INDEX record_reopens_record_idx ON erp_private.record_reopens(record_id);
CREATE INDEX record_reopens_client_idx ON erp_private.record_reopens(client_id);
CREATE INDEX record_reopens_project_idx ON erp_private.record_reopens(project_id);
CREATE INDEX record_reopens_by_idx ON erp_private.record_reopens(reopened_by);
ALTER TABLE erp_private.record_reopens ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.record_reopens FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.record_reopens TO erp_api;
CREATE POLICY record_reopens_read ON erp_private.record_reopens FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY record_reopens_insert ON erp_private.record_reopens FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code='PARTNER' AND reopened_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.record_reopens FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.record_reopens_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A reopen record is never edited.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER record_reopens_no_update BEFORE UPDATE ON erp_private.record_reopens FOR EACH ROW EXECUTE FUNCTION erp_private.record_reopens_immutable();
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.record_reopens FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('reopen_id');
REVOKE ALL ON erp_private.record_reopens FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.record_reopens_immutable() FROM PUBLIC,anon,authenticated;

-- Patch the current guard and coverage trigger in place so this migration does not depend on which earlier migration last redefined them.
DO $patch$
DECLARE def text; patched text;
BEGIN
 def:=pg_get_functiondef('erp_private.period_import_guard()'::regprocedure);
 IF position('erp.partner_reopen' IN def)=0 THEN
  patched:=replace(def,$a$ELSIF NEW.status='Superseded' THEN$a$,
   $b$ELSIF NEW.status='Returned' AND OLD.status='Confirmed' THEN
   IF current_setting('erp.partner_reopen',true) IS DISTINCT FROM 'period_import' OR (current_user='erp_api' AND (a.category_code<>'PARTNER' OR NEW.reviewed_by IS DISTINCT FROM a.staff_id)) THEN RAISE EXCEPTION 'Only a Partner can reopen a confirmed summary, through the exceptional reopen.' USING ERRCODE='42501';END IF;
   IF length(btrim(coalesce(NEW.review_note,'')))<30 THEN RAISE EXCEPTION 'Record the reason for the reopen (at least 30 characters).';END IF;
   IF EXISTS(SELECT 1 FROM erp_private.ledger_sources s WHERE s.source_kind='Period import' AND (s.source_key=OLD.import_id::text OR s.source_key LIKE OLD.import_id::text||':%')) THEN RAISE EXCEPTION 'Entries were prepared from this summary. Amend it so the entries are reversed first.' USING ERRCODE='23514';END IF;
  ELSIF NEW.status='Superseded' THEN$b$);
  IF patched=def THEN RAISE EXCEPTION 'period_import_guard: superseded rule not found'; END IF;
  EXECUTE patched;
 END IF;
 def:=pg_get_functiondef('erp_private.reserve_import_days()'::regprocedure);
 IF position('Returned' IN def)=0 THEN
  patched:=replace(def,$a$ELSIF NEW.status='Confirmed' AND OLD.status<>'Confirmed' THEN$a$,
   $b$ELSIF NEW.status='Returned' AND OLD.status='Confirmed' THEN DELETE FROM erp_private.period_import_days WHERE import_id=NEW.import_id;
 ELSIF NEW.status='Confirmed' AND OLD.status<>'Confirmed' THEN$b$);
  IF patched=def THEN RAISE EXCEPTION 'reserve_import_days: confirmed rule not found'; END IF;
  EXECUTE patched;
 END IF;
END
$patch$;
