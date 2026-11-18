-- Build 2890: report notes and the report-pack register.
-- ledger_report_notes: for one report (month, quarter, year to date or year end, as at a date) the three notes staff write: Client highlights and Information required (both print on the report and are part of what a reviewer
-- signs off) and Internal notes (never printed, never part of the signed-off report). Notes are saved as versions; a saved version is never edited, so the history is kept.
-- ledger_report_packs: a register of every report file or assembled annual pack that was produced, by the fingerprint of what it holds. A pack is Draft while checks were open, Generated when every check passed, Signed when its
-- sign-off exists (the approved report review, the live audit lock, or a recorded sign-off by a Manager or Partner who did not generate it) and Filed once a person records that it went out, with a reference.
-- ledger_report_pack_events: the sign-off and filing events, insert-only. Nothing here posts a journal, approves a report or changes a figure.

CREATE TABLE erp_private.ledger_report_notes(
 note_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 report_kind text NOT NULL CHECK(report_kind IN('Month','Quarter','Year to date','Year end')),
 as_of date NOT NULL,
 version integer NOT NULL CHECK(version>=1),
 client_highlights text NOT NULL DEFAULT '' CHECK(char_length(client_highlights)<=3000),
 information_required text NOT NULL DEFAULT '' CHECK(char_length(information_required)<=3000),
 internal_notes text NOT NULL DEFAULT '' CHECK(char_length(internal_notes)<=3000),
 saved_by uuid NOT NULL REFERENCES erp_private.staff_members,
 saved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(period_id,report_kind,as_of,version)
);
CREATE INDEX ledger_report_notes_project_idx ON erp_private.ledger_report_notes(project_id);
CREATE INDEX ledger_report_notes_client_idx ON erp_private.ledger_report_notes(client_id);
CREATE INDEX ledger_report_notes_saved_by_idx ON erp_private.ledger_report_notes(saved_by);
COMMENT ON TABLE erp_private.ledger_report_notes IS 'Notes on one report: Client highlights and Information required print and are signed off with the report; Internal notes never print. Saved as versions, never edited.';
ALTER TABLE erp_private.ledger_report_notes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.ledger_report_notes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ledger_report_notes FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.ledger_report_notes TO erp_api;
CREATE POLICY ledger_report_notes_read ON erp_private.ledger_report_notes FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ledger_report_notes_add ON erp_private.ledger_report_notes FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND saved_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ledger_report_notes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT ON erp_private.ledger_report_notes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('note_id');

CREATE FUNCTION erp_private.ledger_report_note_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Report notes cannot be edited. Save them again as a new version.' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its report notes can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The notes must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
 IF NEW.as_of<p.starts_on OR NEW.as_of>p.ends_on THEN RAISE EXCEPTION 'The report date must be inside the financial year.' USING ERRCODE='23514'; END IF;
 IF NEW.version<>coalesce((SELECT max(version) FROM erp_private.ledger_report_notes d WHERE d.period_id=NEW.period_id AND d.report_kind=NEW.report_kind AND d.as_of=NEW.as_of),0)+1 THEN RAISE EXCEPTION 'Refresh and try again: the version number is out of date.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.ledger_report_note_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ledger_report_note_guard BEFORE INSERT OR UPDATE ON erp_private.ledger_report_notes FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_report_note_guard();

CREATE TABLE erp_private.ledger_report_packs(
 pack_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 pack_kind text NOT NULL CHECK(pack_kind IN('Monthly filing pack','Annual filing pack','Point-in-time status')),
 report_kind text CHECK(report_kind IS NULL OR report_kind IN('Month','Quarter','Year to date','Year end')),
 as_of date NOT NULL,
 file_format text NOT NULL CHECK(file_format IN('xlsx','pdf')),
 file_name text NOT NULL CHECK(char_length(file_name) BETWEEN 3 AND 240),
 status_word text NOT NULL CHECK(char_length(status_word) BETWEEN 1 AND 40),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 is_final boolean NOT NULL,
 review_id uuid REFERENCES erp_private.ledger_report_reviews,
 lock_id uuid REFERENCES erp_private.period_audit_locks,
 generated_by uuid NOT NULL REFERENCES erp_private.staff_members,
 generated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((pack_kind='Annual filing pack')=(report_kind IS NULL)),
 CHECK(pack_kind<>'Monthly filing pack' OR report_kind='Month'),
 CHECK(pack_kind<>'Point-in-time status' OR report_kind IN('Quarter','Year to date','Year end')),
 CHECK(pack_kind='Annual filing pack' OR file_format='xlsx'),
 CHECK(review_id IS NULL OR (is_final AND pack_kind<>'Annual filing pack')),
 CHECK(lock_id IS NULL OR (is_final AND pack_kind='Annual filing pack'))
);
CREATE UNIQUE INDEX ledger_report_packs_content_uq ON erp_private.ledger_report_packs(period_id,pack_kind,coalesce(report_kind,''),as_of,file_format,fingerprint,is_final);
CREATE INDEX ledger_report_packs_project_idx ON erp_private.ledger_report_packs(project_id);
CREATE INDEX ledger_report_packs_client_idx ON erp_private.ledger_report_packs(client_id);
CREATE INDEX ledger_report_packs_generated_idx ON erp_private.ledger_report_packs(generated_by);
CREATE INDEX ledger_report_packs_review_idx ON erp_private.ledger_report_packs(review_id) WHERE review_id IS NOT NULL;
CREATE INDEX ledger_report_packs_lock_idx ON erp_private.ledger_report_packs(lock_id) WHERE lock_id IS NOT NULL;
COMMENT ON TABLE erp_private.ledger_report_packs IS 'Register of produced report files and assembled annual packs, by the fingerprint of what they hold. Insert-only.';
ALTER TABLE erp_private.ledger_report_packs ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.ledger_report_packs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ledger_report_packs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.ledger_report_packs TO erp_api;
CREATE POLICY ledger_report_packs_read ON erp_private.ledger_report_packs FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ledger_report_packs_add ON erp_private.ledger_report_packs FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND generated_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ledger_report_packs FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT ON erp_private.ledger_report_packs FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('pack_id');

CREATE FUNCTION erp_private.ledger_report_pack_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;DECLARE r erp_private.ledger_report_reviews;DECLARE k erp_private.period_audit_locks;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'A registered pack is never edited.' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The pack must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
 IF NEW.as_of<p.starts_on OR NEW.as_of>p.ends_on THEN RAISE EXCEPTION 'The pack date must be inside the financial year.' USING ERRCODE='23514'; END IF;
 IF NEW.review_id IS NOT NULL THEN
  SELECT * INTO r FROM erp_private.ledger_report_reviews WHERE review_id=NEW.review_id;
  IF NOT FOUND OR r.period_id<>NEW.period_id OR r.report_kind IS DISTINCT FROM NEW.report_kind OR r.as_of<>NEW.as_of OR r.status<>'Approved' OR r.snapshot_digest<>NEW.fingerprint OR r.reviewed_by IS NULL OR r.reviewed_by=r.prepared_by THEN
   RAISE EXCEPTION 'The sign-off named on this pack is not an approved review of exactly these figures.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.lock_id IS NOT NULL THEN
  SELECT * INTO k FROM erp_private.period_audit_locks WHERE lock_id=NEW.lock_id;
  IF NOT FOUND OR k.period_id<>NEW.period_id OR k.ended_at IS NOT NULL THEN RAISE EXCEPTION 'The audit lock named on this pack is not live for this ledger year.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.ledger_report_pack_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ledger_report_pack_guard BEFORE INSERT OR UPDATE ON erp_private.ledger_report_packs FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_report_pack_guard();

CREATE TABLE erp_private.ledger_report_pack_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 pack_id uuid NOT NULL REFERENCES erp_private.ledger_report_packs,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 event text NOT NULL CHECK(event IN('Signed','Filed')),
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 filed_on date,
 reference text CHECK(reference IS NULL OR char_length(btrim(reference)) BETWEEN 3 AND 200),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
 sole_partner_approval boolean NOT NULL DEFAULT false,
 UNIQUE(pack_id,event),
 CHECK(event<>'Filed' OR (filed_on IS NOT NULL AND reference IS NOT NULL)),
 CHECK(event='Signed' OR NOT sole_partner_approval)
);
CREATE INDEX ledger_report_pack_events_project_idx ON erp_private.ledger_report_pack_events(project_id);
CREATE INDEX ledger_report_pack_events_actor_idx ON erp_private.ledger_report_pack_events(actor_id);
COMMENT ON TABLE erp_private.ledger_report_pack_events IS 'Sign-off and filing of a registered pack, each at most once, under the signed-in person''s name. Insert-only.';
ALTER TABLE erp_private.ledger_report_pack_events ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.ledger_report_pack_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ledger_report_pack_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON erp_private.ledger_report_pack_events TO erp_api;
CREATE POLICY ledger_report_pack_events_read ON erp_private.ledger_report_pack_events FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY ledger_report_pack_events_add ON erp_private.ledger_report_pack_events FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND actor_id=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ledger_report_pack_events FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT ON erp_private.ledger_report_pack_events FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('event_id');

CREATE FUNCTION erp_private.ledger_report_pack_event_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE k erp_private.ledger_report_packs;DECLARE actor_cat text:=(erp_private.actor()).category_code;
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'A pack event is never edited.' USING ERRCODE='23514'; END IF;
 SELECT * INTO k FROM erp_private.ledger_report_packs WHERE pack_id=NEW.pack_id;
 IF NOT FOUND OR k.project_id<>NEW.project_id THEN RAISE EXCEPTION 'That pack does not belong to this project.' USING ERRCODE='23514'; END IF;
 IF NOT k.is_final THEN RAISE EXCEPTION 'A draft pack cannot be signed or filed. Generate it again once every check passes.' USING ERRCODE='23514'; END IF;
 IF NEW.event='Signed' THEN
  IF k.review_id IS NOT NULL OR k.lock_id IS NOT NULL THEN RAISE EXCEPTION 'This pack was signed off already, through its report review or its audit lock.' USING ERRCODE='23514'; END IF;
  IF actor_cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner signs the pack.' USING ERRCODE='23514'; END IF;
  IF NEW.actor_id=k.generated_by THEN
   IF actor_cat<>'PARTNER' OR NOT NEW.sole_partner_approval OR NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'Someone else signs a pack you generated, unless you are your firm''s only Partner.' USING ERRCODE='23514'; END IF;
  ELSIF NEW.sole_partner_approval THEN RAISE EXCEPTION 'That flag is set only when a sole Partner signs what they generated.' USING ERRCODE='23514';
  END IF;
 ELSE
  IF k.review_id IS NULL AND k.lock_id IS NULL AND NOT EXISTS(SELECT 1 FROM erp_private.ledger_report_pack_events e WHERE e.pack_id=NEW.pack_id AND e.event='Signed') THEN RAISE EXCEPTION 'A pack is filed only after it is signed.' USING ERRCODE='23514'; END IF;
  IF NEW.filed_on>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The filing date cannot be in the future.' USING ERRCODE='23514'; END IF;
  IF NEW.filed_on<k.as_of THEN RAISE EXCEPTION 'A pack cannot be filed before the date it reports on.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.ledger_report_pack_event_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER ledger_report_pack_event_guard BEFORE INSERT OR UPDATE ON erp_private.ledger_report_pack_events FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_report_pack_event_guard();
