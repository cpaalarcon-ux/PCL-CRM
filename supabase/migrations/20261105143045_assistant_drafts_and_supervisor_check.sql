-- Assistants prepare, Supervisors check, Managers and Partners approve.
-- * Assistants and Supervisors may propose a client chart of accounts and may create their own DRAFT client account
--   mappings (opening trial balance). A mapping only becomes Active when a different Manager or Partner posts the journal.
-- * A Supervisor, Manager or Partner (never the preparer) records a CHECK on a chart version or a submitted journal.
-- * Work prepared by an Assistant or Intern cannot be approved or posted until it has been checked, and the person who
--   checked it cannot also approve it. Work prepared by a Supervisor, Manager or Partner goes straight to approval.

ALTER TABLE erp_private.client_chart_versions
 ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN IF NOT EXISTS checked_at timestamptz,
 ADD COLUMN IF NOT EXISTS check_note text;
ALTER TABLE erp_private.ledger_journals
 ADD COLUMN IF NOT EXISTS checked_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN IF NOT EXISTS checked_at timestamptz,
 ADD COLUMN IF NOT EXISTS check_note text;

CREATE OR REPLACE FUNCTION erp_private.is_junior_preparer(p_staff_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.staff_members WHERE staff_id=p_staff_id AND category_code IN ('ASSISTANT','INTERN'));
$$;
REVOKE ALL ON FUNCTION erp_private.is_junior_preparer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.is_junior_preparer(uuid) TO erp_api;

-- ---------------------------------------------------------------- client chart of accounts
DROP POLICY IF EXISTS client_chart_versions_insert ON erp_private.client_chart_versions;
CREATE POLICY client_chart_versions_insert ON erp_private.client_chart_versions FOR INSERT
 WITH CHECK (erp_private.client_allowed(client_id)
  AND (erp_private.actor()).category_code = ANY (ARRAY['PARTNER','MANAGER','SUPERVISOR','ASSISTANT'])
  AND prepared_by=(erp_private.actor()).staff_id AND status='Draft');
DROP POLICY IF EXISTS client_chart_versions_check ON erp_private.client_chart_versions;
CREATE POLICY client_chart_versions_check ON erp_private.client_chart_versions FOR UPDATE
 USING (erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code='SUPERVISOR')
 WITH CHECK (erp_private.client_allowed(client_id));

CREATE OR REPLACE FUNCTION erp_private.client_chart_version_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF (NEW.client_id,NEW.effective_from,NEW.entity_type,NEW.packs,NEW.accounts,NEW.extra_accounts,NEW.note,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM (OLD.client_id,OLD.effective_from,OLD.entity_type,OLD.packs,OLD.accounts,OLD.extra_accounts,OLD.note,OLD.prepared_by,OLD.prepared_at) THEN
  RAISE EXCEPTION 'A client chart version cannot be edited; propose a new version' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft chart version can be checked, approved or returned' USING ERRCODE='23514'; END IF;
 IF NEW.status='Draft' THEN
  -- a check: nothing else changes
  IF NEW.checked_by IS NOT DISTINCT FROM OLD.checked_by THEN RAISE EXCEPTION 'Only a draft chart version can be checked, approved or returned' USING ERRCODE='23514'; END IF;
  IF (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) THEN
   RAISE EXCEPTION 'A check does not decide the chart' USING ERRCODE='23514';
  END IF;
  IF OLD.checked_by IS NOT NULL OR NEW.checked_at IS NULL OR length(btrim(coalesce(NEW.check_note,'')))<10 THEN
   RAISE EXCEPTION 'Record the check conclusion (at least 10 characters). A chart that was already checked cannot be checked again' USING ERRCODE='23514';
  END IF;
  IF current_user='erp_api' AND (a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') OR a.staff_id=OLD.prepared_by OR NEW.checked_by IS DISTINCT FROM a.staff_id) THEN
   RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the preparer must check the client chart' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.status NOT IN('Approved','Returned') THEN RAISE EXCEPTION 'Only a draft chart version can be checked, approved or returned' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' AND (
    (a.category_code NOT IN('PARTNER','MANAGER') AND NOT (NEW.status='Returned' AND a.category_code='SUPERVISOR'))
    OR a.staff_id=OLD.prepared_by OR NEW.reviewed_by IS DISTINCT FROM a.staff_id) THEN
  RAISE EXCEPTION 'A different Manager or Partner must review the client chart' USING ERRCODE='42501';
 END IF;
 IF NEW.status='Approved' AND erp_private.is_junior_preparer(OLD.prepared_by) THEN
  IF OLD.checked_by IS NULL THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner must check a chart prepared by an Assistant before it is approved' USING ERRCODE='23514'; END IF;
  IF OLD.checked_by=NEW.reviewed_by THEN RAISE EXCEPTION 'The person who checked this chart cannot also approve it' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$$;

-- ---------------------------------------------------------------- draft client account mappings
DROP POLICY IF EXISTS client_account_map_draft_insert ON erp_private.client_account_mappings;
CREATE POLICY client_account_map_draft_insert ON erp_private.client_account_mappings FOR INSERT
 WITH CHECK (erp_private.client_allowed(client_id)
  AND (erp_private.actor()).category_code IN ('ASSISTANT','SUPERVISOR')
  AND status='Draft' AND created_by=(erp_private.actor()).staff_id AND approved_by IS NULL AND approved_at IS NULL);
DROP POLICY IF EXISTS client_account_map_draft_update ON erp_private.client_account_mappings;
CREATE POLICY client_account_map_draft_update ON erp_private.client_account_mappings FOR UPDATE
 USING (erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN ('ASSISTANT','SUPERVISOR')
  AND status='Draft' AND created_by=(erp_private.actor()).staff_id)
 WITH CHECK (erp_private.client_allowed(client_id) AND status='Draft' AND created_by=(erp_private.actor()).staff_id
  AND approved_by IS NULL AND approved_at IS NULL);

-- ---------------------------------------------------------------- journals
-- The shared ledger guard keeps its rules; two lines are widened so a check can be recorded on a submitted journal and a
-- Supervisor can return one. The replacement fails loudly if the original text is not found.
DO $patch$
DECLARE def text; patched text;
BEGIN
 def:=pg_get_functiondef('erp_private.ledger_row_guard()'::regprocedure);
 patched:=replace(def,
  $a$IF OLD.status='Submitted' AND NEW.status NOT IN ('Posted','Returned') THEN RAISE EXCEPTION 'Independent reviewer must post or return this journal';END IF;$a$,
  $b$IF OLD.status='Submitted' AND NEW.status NOT IN ('Posted','Returned') AND NOT (NEW.status='Submitted' AND NEW.checked_by IS DISTINCT FROM OLD.checked_by) THEN RAISE EXCEPTION 'Independent reviewer must post or return this journal';END IF;$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: submitted-journal rule not found'; END IF;
 def:=patched;
 patched:=replace(def,
  $a$IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR a.staff_id IN (NEW.prepared_by,NEW.last_prepared_by)) THEN RAISE EXCEPTION 'A different Manager or Partner must review' USING ERRCODE='42501';END IF;$a$,
  $b$IF current_user='erp_api' AND ((a.category_code NOT IN ('PARTNER','MANAGER') AND NOT (NEW.status='Returned' AND a.category_code='SUPERVISOR')) OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR a.staff_id IN (NEW.prepared_by,NEW.last_prepared_by)) THEN RAISE EXCEPTION 'A different Manager or Partner must review' USING ERRCODE='42501';END IF;$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: reviewer rule not found'; END IF;
 EXECUTE patched;
END
$patch$;

CREATE OR REPLACE FUNCTION erp_private.ledger_check_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.checked_by IS NOT NULL OR NEW.checked_at IS NOT NULL OR NEW.check_note IS NOT NULL THEN RAISE EXCEPTION 'A new journal has not been checked' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 a:=erp_private.actor();
 -- A check belongs to one submission: sending the journal back or submitting it again clears it.
 IF (NEW.status IN ('Draft','Returned') AND OLD.status<>NEW.status) OR (NEW.status='Submitted' AND OLD.status<>'Submitted') THEN
  NEW.checked_by:=NULL;NEW.checked_at:=NULL;NEW.check_note:=NULL;
  RETURN NEW;
 END IF;
 IF NEW.status='Submitted' AND OLD.status='Submitted' AND NEW.checked_by IS DISTINCT FROM OLD.checked_by THEN
  IF OLD.checked_by IS NOT NULL OR NEW.checked_at IS NULL OR length(btrim(coalesce(NEW.check_note,'')))<10 THEN
   RAISE EXCEPTION 'Record the check conclusion (at least 10 characters). A journal that was already checked cannot be checked again' USING ERRCODE='23514';
  END IF;
  IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR NEW.checked_by IS DISTINCT FROM a.staff_id OR a.staff_id IN (NEW.prepared_by,NEW.last_prepared_by)) THEN
   RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the preparer must check this journal' USING ERRCODE='42501';
  END IF;
 ELSIF OLD.status='Submitted' AND NEW.status='Submitted' AND (NEW.checked_at,NEW.check_note) IS DISTINCT FROM (OLD.checked_at,OLD.check_note) THEN
  RAISE EXCEPTION 'A recorded check cannot be changed' USING ERRCODE='23514';
 END IF;
 IF NEW.status='Posted' AND OLD.status='Submitted' AND (erp_private.is_junior_preparer(NEW.prepared_by) OR erp_private.is_junior_preparer(NEW.last_prepared_by)) THEN
  IF NEW.checked_by IS NULL THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner must check this entry, prepared by an Assistant, before it is approved and posted' USING ERRCODE='23514'; END IF;
  IF NEW.checked_by=NEW.reviewed_by THEN RAISE EXCEPTION 'The person who checked this entry cannot also approve and post it' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$$;
DROP TRIGGER IF EXISTS ledger_check_guard ON erp_private.ledger_journals;
CREATE TRIGGER ledger_check_guard BEFORE INSERT OR UPDATE ON erp_private.ledger_journals FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_check_guard();
