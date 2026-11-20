-- Builds 2825 and 2826: three linked, locked versions of a client's annual financial statements, and what each version is linked to.
-- 1. Draft (as prepared from the client's ledger), Audit/Review Adjusted (after the audit or review adjustments), Final Signed (as signed). Each version is an insert-only
--    snapshot of the statements with a digest, so what was reviewed or signed can always be shown exactly as it was. A version is Prepared by one person and Locked by a
--    different one (the Partner for the signed version, unless the firm has only one Partner). A later kind is built only on a locked version of the kind before it.
--    A correction is a new numbered version that supersedes the old one with a reason; versions built on the superseded one are then shown as out of date.
-- 2. Links: the audit file (or review engagement), the adjustment journals, and the KRA notice records (type, date, deadline, response status and evidence stay in the KRA
--    notice record itself). The adjusted version cannot be locked without its adjustment journals (or a recorded statement that there were none) and an audit file or review
--    engagement; the signed version needs an approved audit file or a review engagement.
-- Nothing here changes the ledger, the statements or the audit file.
CREATE TABLE erp_private.statement_versions(
 version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('Draft','Audit/Review Adjusted','Final Signed')),
 seq integer NOT NULL CHECK(seq>=1),
 supersedes_version_id uuid REFERENCES erp_private.statement_versions(version_id) ON DELETE RESTRICT,
 supersede_reason text CHECK(supersede_reason IS NULL OR char_length(btrim(supersede_reason)) BETWEEN 10 AND 500),
 based_on_version_id uuid REFERENCES erp_private.statement_versions(version_id) ON DELETE RESTRICT,
 as_of date NOT NULL,
 snapshot jsonb NOT NULL,
 snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^[0-9a-f]{64}$'),
 ready_at_capture boolean NOT NULL DEFAULT false,
 basis_note text NOT NULL CHECK(char_length(btrim(basis_note)) BETWEEN 10 AND 1000),
 no_adjustments boolean NOT NULL DEFAULT false,
 signed_on date,
 signer_name text CHECK(signer_name IS NULL OR char_length(btrim(signer_name)) BETWEEN 2 AND 160),
 report_reference text CHECK(report_reference IS NULL OR char_length(btrim(report_reference)) BETWEEN 3 AND 200),
 status text NOT NULL DEFAULT 'Prepared' CHECK(status IN('Prepared','Locked')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 locked_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 locked_at timestamptz,
 UNIQUE(period_id,kind,seq),
 CHECK((seq=1)=(supersedes_version_id IS NULL) AND (seq=1 OR supersede_reason IS NOT NULL)),
 CHECK((kind='Draft')=(based_on_version_id IS NULL)),
 CHECK(kind='Audit/Review Adjusted' OR NOT no_adjustments),
 CHECK(kind<>'Final Signed' OR (signed_on IS NOT NULL AND signer_name IS NOT NULL AND report_reference IS NOT NULL)),
 CHECK(kind='Final Signed' OR (signed_on IS NULL AND signer_name IS NULL AND report_reference IS NULL)),
 CHECK((status='Locked')=(locked_by IS NOT NULL AND locked_at IS NOT NULL))
);
CREATE INDEX statement_versions_period_idx ON erp_private.statement_versions(period_id,kind,seq DESC);
CREATE INDEX statement_versions_project_idx ON erp_private.statement_versions(project_id);
CREATE INDEX statement_versions_client_idx ON erp_private.statement_versions(client_id);
CREATE INDEX statement_versions_super_idx ON erp_private.statement_versions(supersedes_version_id) WHERE supersedes_version_id IS NOT NULL;
CREATE INDEX statement_versions_based_idx ON erp_private.statement_versions(based_on_version_id) WHERE based_on_version_id IS NOT NULL;
CREATE INDEX statement_versions_prep_idx ON erp_private.statement_versions(prepared_by);
CREATE INDEX statement_versions_lock_idx ON erp_private.statement_versions(locked_by) WHERE locked_by IS NOT NULL;

CREATE TABLE erp_private.statement_version_links(
 link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version_id uuid NOT NULL REFERENCES erp_private.statement_versions ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 project_id uuid NOT NULL REFERENCES erp_private.projects ON DELETE RESTRICT,
 link_kind text NOT NULL CHECK(link_kind IN('Audit file','Adjustment journal','KRA notice','Review engagement')),
 audit_file_id uuid REFERENCES erp_private.audit_files(audit_file_id) ON DELETE RESTRICT,
 journal_id uuid REFERENCES erp_private.ledger_journals(journal_id) ON DELETE RESTRICT,
 kra_case_id uuid REFERENCES erp_private.kra_cases(case_id) ON DELETE RESTRICT,
 review_project_id uuid REFERENCES erp_private.projects(project_id) ON DELETE RESTRICT,
 note text CHECK(note IS NULL OR char_length(note)<=500),
 linked_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 linked_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 ended_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 end_reason text CHECK(end_reason IS NULL OR char_length(btrim(end_reason)) BETWEEN 10 AND 500),
 CHECK((link_kind='Audit file')=(audit_file_id IS NOT NULL)),
 CHECK((link_kind='Adjustment journal')=(journal_id IS NOT NULL)),
 CHECK((link_kind='KRA notice')=(kra_case_id IS NOT NULL)),
 CHECK((link_kind='Review engagement')=(review_project_id IS NOT NULL)),
 CHECK((ended_at IS NULL)=(ended_by IS NULL AND end_reason IS NULL))
);
CREATE UNIQUE INDEX statement_version_links_live_uidx ON erp_private.statement_version_links(version_id,link_kind,COALESCE(audit_file_id,journal_id,kra_case_id,review_project_id)) WHERE ended_at IS NULL;
CREATE INDEX statement_version_links_version_idx ON erp_private.statement_version_links(version_id);
CREATE INDEX statement_version_links_project_idx ON erp_private.statement_version_links(project_id);
CREATE INDEX statement_version_links_audit_idx ON erp_private.statement_version_links(audit_file_id) WHERE audit_file_id IS NOT NULL;
CREATE INDEX statement_version_links_journal_idx ON erp_private.statement_version_links(journal_id) WHERE journal_id IS NOT NULL;
CREATE INDEX statement_version_links_case_idx ON erp_private.statement_version_links(kra_case_id) WHERE kra_case_id IS NOT NULL;
CREATE INDEX statement_version_links_review_idx ON erp_private.statement_version_links(review_project_id) WHERE review_project_id IS NOT NULL;
CREATE INDEX statement_version_links_by_idx ON erp_private.statement_version_links(linked_by);
CREATE INDEX statement_version_links_ended_idx ON erp_private.statement_version_links(ended_by) WHERE ended_by IS NOT NULL;

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['statement_versions','statement_version_links'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON erp_private.%I TO erp_api',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code NOT IN(''INTERN'',''ADMIN'')) WITH CHECK(erp_private.project_allowed(project_id))',t||'_update',t);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
END LOOP; END $$;
CREATE POLICY statement_versions_insert ON erp_private.statement_versions FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND prepared_by=(erp_private.actor()).staff_id);
CREATE POLICY statement_version_links_insert ON erp_private.statement_version_links FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR') AND linked_by=(erp_private.actor()).staff_id);

CREATE FUNCTION erp_private.statement_version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE per erp_private.ledger_periods;latest erp_private.statement_versions;base erp_private.statement_versions;need text;actor uuid:=(erp_private.actor()).staff_id;cat text:=(erp_private.actor()).category_code;
 links integer;journals integer;af integer;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO per FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF per.period_id IS NULL OR per.project_id<>NEW.project_id OR per.client_id<>NEW.client_id THEN RAISE EXCEPTION 'The financial year does not belong to this engagement.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Prepared' THEN RAISE EXCEPTION 'A statement version starts as prepared and is locked by someone else.' USING ERRCODE='23514'; END IF;
  IF NEW.as_of<per.starts_on OR NEW.as_of>per.ends_on THEN RAISE EXCEPTION 'The as-of date is outside the financial year.' USING ERRCODE='23514'; END IF;
  SELECT * INTO latest FROM erp_private.statement_versions v WHERE v.period_id=NEW.period_id AND v.kind=NEW.kind ORDER BY v.seq DESC LIMIT 1;
  IF latest.version_id IS NULL THEN IF NEW.seq<>1 THEN RAISE EXCEPTION 'The first version of a kind is number 1.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.seq<>latest.seq+1 OR NEW.supersedes_version_id IS DISTINCT FROM latest.version_id THEN RAISE EXCEPTION 'A new version must supersede the latest version of this kind.' USING ERRCODE='23514'; END IF;
  IF NEW.kind<>'Draft' THEN
   need:=CASE NEW.kind WHEN 'Audit/Review Adjusted' THEN 'Draft' ELSE 'Audit/Review Adjusted' END;
   SELECT * INTO base FROM erp_private.statement_versions b WHERE b.version_id=NEW.based_on_version_id;
   IF base.version_id IS NULL OR base.period_id<>NEW.period_id OR base.kind<>need THEN RAISE EXCEPTION 'A % version is built on a % version of the same year.',NEW.kind,need USING ERRCODE='23514'; END IF;
   IF base.status<>'Locked' THEN RAISE EXCEPTION 'The % version must be locked before the next version is built on it.',need USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM erp_private.statement_versions n WHERE n.period_id=base.period_id AND n.kind=base.kind AND n.seq>base.seq) THEN RAISE EXCEPTION 'That % version has been superseded. Build on the latest one.',need USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- The only change a version ever has is being locked.
 IF ROW(NEW.client_id,NEW.project_id,NEW.period_id,NEW.kind,NEW.seq,NEW.supersedes_version_id,NEW.supersede_reason,NEW.based_on_version_id,NEW.as_of,NEW.snapshot,NEW.snapshot_digest,NEW.ready_at_capture,NEW.basis_note,NEW.no_adjustments,NEW.signed_on,NEW.signer_name,NEW.report_reference,NEW.prepared_by,NEW.prepared_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.period_id,OLD.kind,OLD.seq,OLD.supersedes_version_id,OLD.supersede_reason,OLD.based_on_version_id,OLD.as_of,OLD.snapshot,OLD.snapshot_digest,OLD.ready_at_capture,OLD.basis_note,OLD.no_adjustments,OLD.signed_on,OLD.signer_name,OLD.report_reference,OLD.prepared_by,OLD.prepared_at)
 THEN RAISE EXCEPTION 'A statement version is never edited. Prepare a new version that supersedes it.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Locked' THEN RAISE EXCEPTION 'A locked statement version is final.' USING ERRCODE='23514'; END IF;
 IF NEW.status<>'Locked' OR NEW.locked_by IS DISTINCT FROM actor THEN RAISE EXCEPTION 'The lock is recorded against the person who locks it.' USING ERRCODE='23514'; END IF;
 IF actor=OLD.prepared_by AND NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A different Manager or Partner locks the version.' USING ERRCODE='23514'; END IF;
 IF cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner locks a statement version.' USING ERRCODE='23514'; END IF;
 IF OLD.kind='Final Signed' AND cat<>'PARTNER' THEN RAISE EXCEPTION 'The signed version is locked by a Partner.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.statement_versions n WHERE n.period_id=OLD.period_id AND n.kind=OLD.kind AND n.seq>OLD.seq) THEN RAISE EXCEPTION 'This version has been superseded.' USING ERRCODE='23514'; END IF;
 IF OLD.kind<>'Draft' AND NOT OLD.ready_at_capture THEN RAISE EXCEPTION 'The statements were not ready when this version was captured. Resolve the open checks and prepare it again.' USING ERRCODE='23514'; END IF;
 SELECT count(*) FILTER(WHERE link_kind='Adjustment journal'),count(*) FILTER(WHERE link_kind IN('Audit file','Review engagement')),count(*) FILTER(WHERE link_kind='Audit file' AND EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=l.audit_file_id AND f.file_status IN('Approved','Completion','Archived')))
   INTO journals,links,af FROM erp_private.statement_version_links l WHERE l.version_id=OLD.version_id AND l.ended_at IS NULL;
 IF OLD.kind='Audit/Review Adjusted' THEN
  IF links=0 THEN RAISE EXCEPTION 'Link the audit file or the review engagement before locking the adjusted version.' USING ERRCODE='23514'; END IF;
  IF journals=0 AND NOT OLD.no_adjustments THEN RAISE EXCEPTION 'Link the adjustment journals, or record that there were no adjustments, before locking the adjusted version.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.kind='Final Signed' THEN
  IF af=0 AND NOT EXISTS(SELECT 1 FROM erp_private.statement_version_links l WHERE l.version_id=OLD.version_id AND l.ended_at IS NULL AND l.link_kind='Review engagement') THEN RAISE EXCEPTION 'The signed version needs an approved audit file or a review engagement linked to it.' USING ERRCODE='23514'; END IF;
 END IF;
 NEW.locked_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER statement_version_guard BEFORE INSERT OR UPDATE ON erp_private.statement_versions FOR EACH ROW EXECUTE FUNCTION erp_private.statement_version_guard();

CREATE FUNCTION erp_private.statement_version_link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v erp_private.statement_versions;per erp_private.ledger_periods;actor uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO v FROM erp_private.statement_versions WHERE version_id=NEW.version_id;
  IF v.version_id IS NULL OR v.client_id<>NEW.client_id OR v.project_id<>NEW.project_id THEN RAISE EXCEPTION 'The link must belong to the same client and engagement as the version.' USING ERRCODE='23514'; END IF;
  SELECT * INTO per FROM erp_private.ledger_periods WHERE period_id=v.period_id;
  -- The records that make up the statements cannot change once the version is locked; a KRA notice can still be noted against it.
  IF v.status='Locked' AND NEW.link_kind<>'KRA notice' THEN RAISE EXCEPTION 'A locked version keeps the audit file and journals it was locked with.' USING ERRCODE='23514'; END IF;
  IF NEW.link_kind='Adjustment journal' THEN
   IF v.kind<>'Audit/Review Adjusted' THEN RAISE EXCEPTION 'Adjustment journals are linked to the adjusted version.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM erp_private.ledger_journals j WHERE j.journal_id=NEW.journal_id AND j.period_id=v.period_id AND j.status='Posted') THEN RAISE EXCEPTION 'Link a posted journal of the same financial year.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.link_kind='Audit file' THEN
   IF v.kind='Draft' THEN RAISE EXCEPTION 'The audit file is linked to the adjusted and signed versions.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=NEW.audit_file_id AND f.client_id=NEW.client_id AND f.starts_on<=per.ends_on AND f.ends_on>=per.starts_on) THEN RAISE EXCEPTION 'Link an audit file of this client that covers the financial year.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.link_kind='Review engagement' THEN
   IF v.kind='Draft' THEN RAISE EXCEPTION 'The review engagement is linked to the adjusted and signed versions.' USING ERRCODE='23514'; END IF;
   IF NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.review_project_id AND p.client_id=NEW.client_id AND p.deleted_at IS NULL) THEN RAISE EXCEPTION 'Link an engagement of this client.' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM erp_private.kra_cases c WHERE c.case_id=NEW.kra_case_id AND c.client_id=NEW.client_id) THEN RAISE EXCEPTION 'Link a KRA notice record of this client.' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.ended_at IS NOT NULL THEN RAISE EXCEPTION 'A link starts live.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.version_id,NEW.client_id,NEW.project_id,NEW.link_kind,NEW.audit_file_id,NEW.journal_id,NEW.kra_case_id,NEW.review_project_id,NEW.note,NEW.linked_by,NEW.linked_at)
    IS DISTINCT FROM ROW(OLD.version_id,OLD.client_id,OLD.project_id,OLD.link_kind,OLD.audit_file_id,OLD.journal_id,OLD.kra_case_id,OLD.review_project_id,OLD.note,OLD.linked_by,OLD.linked_at)
 THEN RAISE EXCEPTION 'A link is never edited. End it with a reason and add the right one.' USING ERRCODE='23514'; END IF;
 IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'This link has already ended.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.statement_versions v WHERE v.version_id=OLD.version_id AND v.status='Locked') THEN RAISE EXCEPTION 'A locked version keeps its links.' USING ERRCODE='23514'; END IF;
 IF NEW.ended_by IS DISTINCT FROM actor OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'The ending is recorded against the person who does it.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER statement_version_link_guard BEFORE INSERT OR UPDATE ON erp_private.statement_version_links FOR EACH ROW EXECUTE FUNCTION erp_private.statement_version_link_guard();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.statement_versions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('version_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.statement_version_links FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('link_id');
REVOKE ALL ON FUNCTION erp_private.statement_version_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.statement_version_link_guard() FROM PUBLIC,anon,authenticated;
