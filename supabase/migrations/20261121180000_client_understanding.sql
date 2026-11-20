-- Build 2867: "Understanding the Client" and the Permanent File PDF.
-- The narrative is kept as numbered versions. A Draft is edited by the preparer; submitting it sends it to a different Manager or Partner (the sole active Partner may approve their own, and it is recorded).
-- An approved version is never edited. A newer approved version supersedes it with a reason, so the history stays. Nothing is deleted.
-- Each Permanent File PDF that is filed is recorded here with a fingerprint of what it contained, so the screen can say when the file is out of date.
CREATE TABLE erp_private.client_understanding(
 understanding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 version integer NOT NULL CHECK(version>=1),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Submitted','Approved','Superseded')),
 sections jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(sections)='object' AND pg_column_size(sections)<=60000),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,prepared_at timestamptz NOT NULL DEFAULT now(),
 submitted_by uuid REFERENCES erp_private.staff_members,submitted_at timestamptz,
 returned_by uuid REFERENCES erp_private.staff_members,returned_at timestamptz,
 return_note text CHECK(return_note IS NULL OR char_length(btrim(return_note)) BETWEEN 3 AND 500),
 approved_by uuid REFERENCES erp_private.staff_members,approved_at timestamptz,
 sole_partner_approval boolean NOT NULL DEFAULT false,
 superseded_by uuid REFERENCES erp_private.staff_members,superseded_at timestamptz,
 superseded_reason text CHECK(superseded_reason IS NULL OR char_length(btrim(superseded_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(client_id,version),
 CHECK(status NOT IN('Submitted','Approved','Superseded') OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status NOT IN('Approved','Superseded') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(status<>'Superseded' OR (superseded_by IS NOT NULL AND superseded_at IS NOT NULL AND superseded_reason IS NOT NULL)),
 CHECK(approved_by IS NULL OR sole_partner_approval OR (approved_by<>prepared_by AND approved_by<>submitted_by))
);
CREATE UNIQUE INDEX client_understanding_open_uidx ON erp_private.client_understanding(client_id) WHERE status IN('Draft','Submitted');
CREATE UNIQUE INDEX client_understanding_approved_uidx ON erp_private.client_understanding(client_id) WHERE status='Approved';
CREATE INDEX client_understanding_prep_idx ON erp_private.client_understanding(prepared_by);
CREATE INDEX client_understanding_sub_idx ON erp_private.client_understanding(submitted_by) WHERE submitted_by IS NOT NULL;
CREATE INDEX client_understanding_ret_idx ON erp_private.client_understanding(returned_by) WHERE returned_by IS NOT NULL;
CREATE INDEX client_understanding_app_idx ON erp_private.client_understanding(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX client_understanding_sup_idx ON erp_private.client_understanding(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE FUNCTION erp_private.client_understanding_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' THEN RAISE EXCEPTION 'A new version of the understanding starts as a draft.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='Superseded' THEN RAISE EXCEPTION 'A superseded version is history and cannot change.' USING ERRCODE='23514'; END IF;
 IF (NEW.understanding_id,NEW.client_id,NEW.version,NEW.prepared_by,NEW.prepared_at) IS DISTINCT FROM (OLD.understanding_id,OLD.client_id,OLD.version,OLD.prepared_by,OLD.prepared_at)
  THEN RAISE EXCEPTION 'The identity of a version cannot change.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Approved' THEN
  IF NEW.status<>'Superseded' OR NEW.sections IS DISTINCT FROM OLD.sections OR (NEW.approved_by,NEW.approved_at,NEW.submitted_by,NEW.submitted_at) IS DISTINCT FROM (OLD.approved_by,OLD.approved_at,OLD.submitted_by,OLD.submitted_at)
   THEN RAISE EXCEPTION 'An approved version is not edited. Record a newer version and approve it; the old one is then superseded with a reason.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Submitted' THEN
  IF NEW.sections IS DISTINCT FROM OLD.sections THEN RAISE EXCEPTION 'A submitted version cannot be edited. Return it to the preparer first.' USING ERRCODE='23514'; END IF;
  IF NEW.status NOT IN('Submitted','Draft','Approved') THEN RAISE EXCEPTION 'A submitted version is approved or returned.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Draft' THEN
  IF NEW.status NOT IN('Draft','Submitted') THEN RAISE EXCEPTION 'A draft is submitted before it is approved.' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
 RETURN NEW;
END $$;
CREATE TRIGGER client_understanding_guard BEFORE INSERT OR UPDATE ON erp_private.client_understanding FOR EACH ROW EXECUTE FUNCTION erp_private.client_understanding_guard();

CREATE TABLE erp_private.permanent_file_issues(
 issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 document_id uuid NOT NULL UNIQUE REFERENCES erp_private.documents ON DELETE RESTRICT,
 understanding_id uuid NOT NULL REFERENCES erp_private.client_understanding ON DELETE RESTRICT,
 facts_digest text NOT NULL CHECK(facts_digest ~ '^[0-9a-f]{64}$'),
 fact_count integer NOT NULL CHECK(fact_count>=0),
 aml_stage text,
 issued_by uuid NOT NULL REFERENCES erp_private.staff_members,issued_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX permanent_file_issues_client_idx ON erp_private.permanent_file_issues(client_id,issued_at DESC);
CREATE INDEX permanent_file_issues_und_idx ON erp_private.permanent_file_issues(understanding_id);
CREATE INDEX permanent_file_issues_by_idx ON erp_private.permanent_file_issues(issued_by);
CREATE FUNCTION erp_private.permanent_file_issues_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A filed Permanent File record is history and cannot change.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER permanent_file_issues_guard BEFORE UPDATE ON erp_private.permanent_file_issues FOR EACH ROW EXECUTE FUNCTION erp_private.permanent_file_issues_guard();

ALTER TABLE erp_private.client_understanding ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_understanding FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.permanent_file_issues ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.permanent_file_issues FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_understanding TO erp_api;
GRANT SELECT,INSERT ON erp_private.permanent_file_issues TO erp_api;
CREATE POLICY client_understanding_read ON erp_private.client_understanding FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY client_understanding_insert ON erp_private.client_understanding FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND prepared_by=(erp_private.actor()).staff_id);
CREATE POLICY client_understanding_update ON erp_private.client_understanding FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR')) WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR'));
CREATE POLICY permanent_file_issues_read ON erp_private.permanent_file_issues FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY permanent_file_issues_insert ON erp_private.permanent_file_issues FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND issued_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_understanding FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.permanent_file_issues FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_understanding FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('understanding_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.permanent_file_issues FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('issue_id');
