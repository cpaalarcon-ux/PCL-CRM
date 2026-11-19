-- Build 2903: resumable form drafts. A staff member's own unfinished form (a journal entry, a client set-up form) is kept on the server so it survives a closed tab, a sign-out or a change of computer.
-- A draft is private to its owner, is never an approval, task or ledger record, and changes nothing else. It is removed when the form is submitted or when the owner discards it.
-- Passwords, tokens and other secrets are refused by the server and again by a guard here. The audit log records that a draft was created, saved, resumed or discarded, never what it contained (no change_audit trigger on this table).
CREATE TABLE erp_private.staff_form_drafts(
 draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 form_kind text NOT NULL CHECK(form_kind ~ '^[a-z][a-z0-9_]{2,39}$'),
 subject_key text NOT NULL CHECK(char_length(subject_key) BETWEEN 1 AND 200),
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 1 AND 200),
 client_id uuid REFERENCES erp_private.clients,
 project_id uuid REFERENCES erp_private.projects,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=100000),
 created_at timestamptz NOT NULL DEFAULT now(),
 saved_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(staff_id,form_kind,subject_key)
);
CREATE INDEX staff_form_drafts_owner_idx ON erp_private.staff_form_drafts(staff_id,saved_at DESC);
CREATE INDEX staff_form_drafts_client_idx ON erp_private.staff_form_drafts(client_id) WHERE client_id IS NOT NULL;
CREATE INDEX staff_form_drafts_project_idx ON erp_private.staff_form_drafts(project_id) WHERE project_id IS NOT NULL;
COMMENT ON TABLE erp_private.staff_form_drafts IS 'A person''s own unfinished forms. Private to the owner, never an approval or ledger record, never holds secrets. No change_audit trigger: the audit log must not copy the contents.';
ALTER TABLE erp_private.staff_form_drafts ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.staff_form_drafts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.staff_form_drafts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON erp_private.staff_form_drafts TO erp_api;
-- Only the owner sees or changes a draft, and only while they can still see the client and project it names.
CREATE POLICY form_drafts_read ON erp_private.staff_form_drafts FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id AND (project_id IS NULL OR erp_private.project_allowed(project_id)) AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY form_drafts_add ON erp_private.staff_form_drafts FOR INSERT TO erp_api WITH CHECK(staff_id=(erp_private.actor()).staff_id AND (project_id IS NULL OR erp_private.project_allowed(project_id)) AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY form_drafts_change ON erp_private.staff_form_drafts FOR UPDATE TO erp_api USING(staff_id=(erp_private.actor()).staff_id) WITH CHECK(staff_id=(erp_private.actor()).staff_id AND (project_id IS NULL OR erp_private.project_allowed(project_id)) AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY form_drafts_remove ON erp_private.staff_form_drafts FOR DELETE TO erp_api USING(staff_id=(erp_private.actor()).staff_id);
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.staff_form_drafts FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.staff_form_drafts_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.staff_id,NEW.form_kind,NEW.subject_key,NEW.client_id,NEW.project_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.staff_id,OLD.form_kind,OLD.subject_key,OLD.client_id,OLD.project_id,OLD.created_at) THEN
   RAISE EXCEPTION 'A draft keeps its owner, form and client. Start a new draft instead.' USING ERRCODE='23514';
  END IF;
  NEW.saved_at:=now();
 END IF;
 IF NEW.project_id IS NOT NULL AND NEW.client_id IS DISTINCT FROM (SELECT p.client_id FROM erp_private.projects p WHERE p.project_id=NEW.project_id) THEN
  RAISE EXCEPTION 'The draft must name the same client as its project.' USING ERRCODE='23514';
 END IF;
 -- A name that looks like a password, token or key is never kept in a draft.
 IF NEW.payload::text ~* '"[^"]*(passw|passcode|secret|token|api[_-]?key|authori[sz]ation|credential)[^"]*"\s*:' THEN
  RAISE EXCEPTION 'A draft cannot hold passwords, tokens or other secrets.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_form_drafts_guard BEFORE INSERT OR UPDATE ON erp_private.staff_form_drafts FOR EACH ROW EXECUTE FUNCTION erp_private.staff_form_drafts_guard();
