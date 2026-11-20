-- Build 2807: the client master keeps where each key fact came from and who checked it.
-- One live fact per client and field. A fact is recorded with its source (a document, an online register check, a prior record, an import, or the client's own
-- statement). A different Supervisor, Manager or Partner then verifies it against that source. A client statement alone is never "verified".
-- A fact is never edited: a changed value supersedes the old one with a reason, and the new one starts unverified. Nothing is deleted.
-- Milestones record when set-up started and when every required fact was first verified, so the time to set up a client can be measured.
CREATE TABLE erp_private.client_field_facts(
 fact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 field_key text NOT NULL CHECK(field_key ~ '^[a-z][a-z0-9_]{1,59}$'),
 value text NOT NULL CHECK(char_length(btrim(value)) BETWEEN 1 AND 500),
 source_kind text NOT NULL CHECK(source_kind IN('Document','Online register','Prior record','Import','Client statement')),
 document_id uuid REFERENCES erp_private.documents ON DELETE RESTRICT,
 source_reference text CHECK(source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 1 AND 300),
 status text NOT NULL DEFAULT 'Recorded' CHECK(status IN('Recorded','Verified','Superseded')),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 verified_by uuid REFERENCES erp_private.staff_members,
 verified_at timestamptz,
 verification_note text CHECK(verification_note IS NULL OR char_length(btrim(verification_note)) BETWEEN 3 AND 500),
 superseded_at timestamptz,
 superseded_by uuid REFERENCES erp_private.staff_members,
 superseded_reason text CHECK(superseded_reason IS NULL OR char_length(btrim(superseded_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(source_kind<>'Document' OR document_id IS NOT NULL),
 CHECK(source_kind NOT IN('Online register','Prior record','Import') OR source_reference IS NOT NULL),
 CHECK(status<>'Verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verification_note IS NOT NULL)),
 CHECK(status<>'Verified' OR source_kind<>'Client statement'),
 CHECK(verified_by IS NULL OR verified_by<>recorded_by),
 CHECK(status<>'Superseded' OR (superseded_at IS NOT NULL AND superseded_by IS NOT NULL AND superseded_reason IS NOT NULL))
);
CREATE UNIQUE INDEX client_field_facts_live_uidx ON erp_private.client_field_facts(client_id,field_key) WHERE status IN('Recorded','Verified');
CREATE INDEX client_field_facts_client_idx ON erp_private.client_field_facts(client_id,field_key,recorded_at);
CREATE INDEX client_field_facts_document_idx ON erp_private.client_field_facts(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX client_field_facts_recorded_by_idx ON erp_private.client_field_facts(recorded_by);
CREATE INDEX client_field_facts_verified_by_idx ON erp_private.client_field_facts(verified_by) WHERE verified_by IS NOT NULL;
CREATE INDEX client_field_facts_superseded_by_idx ON erp_private.client_field_facts(superseded_by) WHERE superseded_by IS NOT NULL;

CREATE TABLE erp_private.client_setup_milestones(
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 milestone text NOT NULL CHECK(milestone IN('Started','Ready')),
 reached_at timestamptz NOT NULL DEFAULT now(),
 reached_by uuid NOT NULL REFERENCES erp_private.staff_members,
 detail jsonb NOT NULL DEFAULT '{}'::jsonb,
 PRIMARY KEY(client_id,milestone)
);
CREATE INDEX client_setup_milestones_by_idx ON erp_private.client_setup_milestones(reached_by);

ALTER TABLE erp_private.client_field_facts ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_field_facts FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_setup_milestones ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_setup_milestones FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_field_facts TO erp_api;
GRANT SELECT,INSERT ON erp_private.client_setup_milestones TO erp_api;
CREATE POLICY facts_read ON erp_private.client_field_facts FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY facts_insert ON erp_private.client_field_facts FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY facts_update ON erp_private.client_field_facts FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY milestones_read ON erp_private.client_setup_milestones FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY milestones_insert ON erp_private.client_setup_milestones FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND reached_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_field_facts FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_setup_milestones FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_field_facts FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('fact_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_field_facts FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.client_field_facts_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE who erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Recorded' THEN RAISE EXCEPTION 'A fact is recorded first and verified separately.' USING ERRCODE='23514'; END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=NEW.document_id AND d.client_id=NEW.client_id) THEN
   RAISE EXCEPTION 'The document does not belong to this client.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.field_key,NEW.value,NEW.source_kind,NEW.document_id,NEW.source_reference,NEW.recorded_by,NEW.recorded_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.field_key,OLD.value,OLD.source_kind,OLD.document_id,OLD.source_reference,OLD.recorded_by,OLD.recorded_at) THEN
  RAISE EXCEPTION 'A recorded fact is never edited. Record the new value; the old one is kept as superseded.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Superseded' THEN RAISE EXCEPTION 'A superseded fact stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status='Verified' AND OLD.status='Recorded' THEN
  IF current_user='erp_api' THEN
   SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id;
   IF who.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner verifies a fact.' USING ERRCODE='23514'; END IF;
   IF NEW.verified_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'Verification is recorded under your own name.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF NEW.status='Superseded' THEN
  IF current_user='erp_api' AND NEW.superseded_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The change is recorded under your own name.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_field_facts_guard BEFORE INSERT OR UPDATE ON erp_private.client_field_facts FOR EACH ROW EXECUTE FUNCTION erp_private.client_field_facts_guard();
