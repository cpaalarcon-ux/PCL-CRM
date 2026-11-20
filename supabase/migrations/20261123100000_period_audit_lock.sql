-- Build 2875: the audit lock for the annual statements.
-- The statements stay DRAFT until the audit is complete. Two ways to lock the pack, both after a Partner has approved the notes (a lock before that is refused):
--   In-house audit: the audit file for the year has been completed and approved in the ERP; a Manager or Partner who did not prepare that audit file locks the pack.
--   External audit: the signed auditor's PDF is a document in the client's vault; a Manager or Partner records the auditor, report date, reference and opinion and attaches it, which locks the pack.
-- A lock records the digest of the statements' figures and of the approved notes, so a later change to either shows as "figures changed after the audit". A lock is never edited; a Partner can
-- end it with a reason, and the pack is then DRAFT again until it is locked again. Nothing here changes the ledger, the statements, the notes or the audit file. No tax rate is stored.
CREATE TABLE erp_private.period_audit_arrangements(
 period_id uuid PRIMARY KEY REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 mode text NOT NULL CHECK(mode IN('In-house audit','External audit','Not audited')),
 note text CHECK(note IS NULL OR char_length(note)<=500),
 set_by uuid NOT NULL REFERENCES erp_private.staff_members,
 set_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1
);
CREATE INDEX period_audit_arr_project_idx ON erp_private.period_audit_arrangements(project_id);
CREATE INDEX period_audit_arr_client_idx ON erp_private.period_audit_arrangements(client_id);
CREATE INDEX period_audit_arr_by_idx ON erp_private.period_audit_arrangements(set_by);
COMMENT ON TABLE erp_private.period_audit_arrangements IS 'Whether a client year is audited in-house, audited by an external auditor, or not audited. Not audited is recorded by a Partner.';

CREATE TABLE erp_private.period_audit_locks(
 lock_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 mode text NOT NULL CHECK(mode IN('In-house audit','External audit')),
 notes_set_id uuid NOT NULL REFERENCES erp_private.period_note_sets(set_id),
 notes_digest text NOT NULL CHECK(notes_digest ~ '^[0-9a-f]{64}$'),
 figures_digest text NOT NULL CHECK(figures_digest ~ '^[0-9a-f]{64}$'),
 audit_file_id uuid REFERENCES erp_private.audit_files(audit_file_id),
 document_id uuid REFERENCES erp_private.documents(document_id),
 document_sha256 text CHECK(document_sha256 IS NULL OR document_sha256 ~ '^[0-9a-f]{64}$'),
 auditor_name text CHECK(auditor_name IS NULL OR char_length(btrim(auditor_name)) BETWEEN 2 AND 160),
 report_reference text NOT NULL CHECK(char_length(btrim(report_reference)) BETWEEN 3 AND 200),
 report_date date NOT NULL,
 opinion text NOT NULL CHECK(opinion IN('Unmodified','Qualified','Adverse','Disclaimer of opinion')),
 locked_by uuid NOT NULL REFERENCES erp_private.staff_members,
 locked_at timestamptz NOT NULL DEFAULT now(),
 sole_partner_approval boolean NOT NULL DEFAULT false,
 ended_at timestamptz,
 ended_by uuid REFERENCES erp_private.staff_members,
 end_reason text CHECK(end_reason IS NULL OR char_length(btrim(end_reason)) BETWEEN 10 AND 500),
 CHECK((mode='In-house audit')=(audit_file_id IS NOT NULL)),
 CHECK((mode='External audit')=(document_id IS NOT NULL AND document_sha256 IS NOT NULL AND auditor_name IS NOT NULL)),
 CHECK((ended_at IS NULL)=(ended_by IS NULL AND end_reason IS NULL)),
 CHECK(NOT sole_partner_approval OR mode='In-house audit')
);
CREATE UNIQUE INDEX period_audit_one_live ON erp_private.period_audit_locks(period_id) WHERE ended_at IS NULL;
CREATE INDEX period_audit_locks_project_idx ON erp_private.period_audit_locks(project_id);
CREATE INDEX period_audit_locks_client_idx ON erp_private.period_audit_locks(client_id);
CREATE INDEX period_audit_locks_notes_idx ON erp_private.period_audit_locks(notes_set_id);
CREATE INDEX period_audit_locks_file_idx ON erp_private.period_audit_locks(audit_file_id) WHERE audit_file_id IS NOT NULL;
CREATE INDEX period_audit_locks_doc_idx ON erp_private.period_audit_locks(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX period_audit_locks_by_idx ON erp_private.period_audit_locks(locked_by);
CREATE INDEX period_audit_locks_ended_idx ON erp_private.period_audit_locks(ended_by) WHERE ended_by IS NOT NULL;
COMMENT ON TABLE erp_private.period_audit_locks IS 'The audit lock on a client year: in-house (completed audit file) or external (signed auditor PDF in the document vault). Tied to digests of the figures and the approved notes.';

DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['period_audit_arrangements','period_audit_locks'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON erp_private.%I TO erp_api',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',t||'_read',t);
 EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader())',t||'_update',t);
 EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
END LOOP; END $$;
CREATE POLICY period_audit_arrangements_add ON erp_private.period_audit_arrangements FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND set_by=(erp_private.actor()).staff_id);
CREATE POLICY period_audit_locks_add ON erp_private.period_audit_locks FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND locked_by=(erp_private.actor()).staff_id);
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_audit_arrangements FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('period_id');
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.period_audit_locks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('lock_id');

CREATE FUNCTION erp_private.period_audit_arrangement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;cat text:=(erp_private.actor()).category_code;me uuid:=(erp_private.actor()).staff_id;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The audit arrangement must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its audit arrangement can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF NEW.set_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'The arrangement is recorded against the person who sets it.' USING ERRCODE='23514'; END IF;
 IF NEW.mode='Not audited' AND cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner records that a year is not audited.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF OLD.mode='Not audited' AND NEW.mode<>OLD.mode AND cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner changes a year recorded as not audited.' USING ERRCODE='23514'; END IF;
  IF NEW.mode IS DISTINCT FROM OLD.mode AND EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit. A Partner ends the lock before the arrangement is changed.' USING ERRCODE='23514'; END IF;
  NEW.revision=OLD.revision+1;NEW.set_at=now();
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_audit_arrangement_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_audit_arrangement_guard BEFORE INSERT OR UPDATE ON erp_private.period_audit_arrangements FOR EACH ROW EXECUTE FUNCTION erp_private.period_audit_arrangement_guard();

CREATE FUNCTION erp_private.period_audit_lock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;n erp_private.period_note_sets;f erp_private.audit_files;d erp_private.documents;
 cat text:=(erp_private.actor()).category_code;me uuid:=(erp_private.actor()).staff_id;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
  IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The audit lock must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
  IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed.' USING ERRCODE='23514'; END IF;
  IF cat NOT IN('PARTNER','MANAGER') OR NEW.locked_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'A Manager or Partner locks the pack, in their own name.' USING ERRCODE='23514'; END IF;
  IF NEW.ended_at IS NOT NULL THEN RAISE EXCEPTION 'A lock starts live.' USING ERRCODE='23514'; END IF;
  SELECT * INTO n FROM erp_private.period_note_sets WHERE set_id=NEW.notes_set_id;
  IF n.set_id IS NULL OR n.period_id<>NEW.period_id OR n.status<>'Approved' OR n.digest<>NEW.notes_digest THEN RAISE EXCEPTION 'A Partner must approve the notes, and they must match the figures, before the pack is locked.' USING ERRCODE='23514'; END IF;
  IF NEW.report_date>current_date THEN RAISE EXCEPTION 'The report date cannot be in the future.' USING ERRCODE='23514'; END IF;
  IF NEW.mode='In-house audit' THEN
   SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=NEW.audit_file_id;
   IF f.audit_file_id IS NULL OR f.client_id<>NEW.client_id OR f.starts_on>p.ends_on OR f.ends_on<p.starts_on THEN RAISE EXCEPTION 'Choose this client''s audit file that covers the financial year.' USING ERRCODE='23514'; END IF;
   IF f.is_demonstration THEN RAISE EXCEPTION 'A demonstration audit file cannot lock a real pack.' USING ERRCODE='23514'; END IF;
   IF f.file_status NOT IN('Approved','Completion') THEN RAISE EXCEPTION 'The audit file must be completed and approved before it locks the pack.' USING ERRCODE='23514'; END IF;
   IF f.created_by=me THEN
    IF NOT NEW.sole_partner_approval OR cat<>'PARTNER' OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A Manager or Partner who did not prepare the audit file locks the pack, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
   ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner locks an audit file they prepared.' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.document_id;
   IF d.document_id IS NULL OR d.client_id<>NEW.client_id OR d.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'The signed audit report must be a document in this client''s vault.' USING ERRCODE='23514'; END IF;
   IF d.mime_type<>'application/pdf' THEN RAISE EXCEPTION 'The signed audit report must be a PDF.' USING ERRCODE='23514'; END IF;
   IF d.sha256<>NEW.document_sha256 THEN RAISE EXCEPTION 'The document has changed since it was chosen. Choose it again.' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- The only change a lock ever has is being ended by a Partner, with a reason.
 IF (NEW.lock_id,NEW.period_id,NEW.project_id,NEW.client_id,NEW.mode,NEW.notes_set_id,NEW.notes_digest,NEW.figures_digest,NEW.audit_file_id,NEW.document_id,NEW.document_sha256,NEW.auditor_name,NEW.report_reference,NEW.report_date,NEW.opinion,NEW.locked_by,NEW.locked_at,NEW.sole_partner_approval)
    IS DISTINCT FROM (OLD.lock_id,OLD.period_id,OLD.project_id,OLD.client_id,OLD.mode,OLD.notes_set_id,OLD.notes_digest,OLD.figures_digest,OLD.audit_file_id,OLD.document_id,OLD.document_sha256,OLD.auditor_name,OLD.report_reference,OLD.report_date,OLD.opinion,OLD.locked_by,OLD.locked_at,OLD.sole_partner_approval)
 THEN RAISE EXCEPTION 'An audit lock is never edited. A Partner ends it with a reason and it is locked again.' USING ERRCODE='23514'; END IF;
 IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'This lock has already ended.' USING ERRCODE='23514'; END IF;
 IF cat<>'PARTNER' OR NEW.ended_by IS DISTINCT FROM me OR NEW.ended_at IS NULL THEN RAISE EXCEPTION 'Only a Partner ends an audit lock, in their own name.' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=OLD.period_id;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_audit_lock_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_audit_lock_guard BEFORE INSERT OR UPDATE ON erp_private.period_audit_locks FOR EACH ROW EXECUTE FUNCTION erp_private.period_audit_lock_guard();

-- While the pack is locked the notes are frozen: no new version can be prepared, approved or returned.
CREATE FUNCTION erp_private.period_note_set_lock_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.period_audit_locks l WHERE l.period_id=NEW.period_id AND l.ended_at IS NULL) THEN RAISE EXCEPTION 'The pack is locked by an audit, so its notes cannot change. A Partner ends the lock first.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_note_set_lock_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_note_set_lock_guard BEFORE INSERT OR UPDATE ON erp_private.period_note_sets FOR EACH ROW EXECUTE FUNCTION erp_private.period_note_set_lock_guard();
