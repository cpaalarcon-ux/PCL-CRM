-- Forensic restricted file (joined-practice program, after Step 9), 2026-11-10.
--
-- Partner decision of 2026-11-09 (recorded in ERP_services_partner_decisions): a forensic file is hidden from everyone who is not on the file's
-- access list, including other Partners and administrators. Only the lead Partner and the people the lead adds can see it. It does not appear in
-- any "All work" view; it has its own Forensic Cases area. This overrides "Partners see all work" for forensic files only.
--
-- Design: the forensic file is a separate vault. It does not use the projects, tasks, documents, communications or change-audit tables, so nothing
-- in the ordinary screens, dashboards, counts, timelines or the general audit log can show it. Each table has row security (enabled and forced)
-- that lets a row be read only by someone on the case's access list. Rows are written only by the functions below.
--
-- What it holds (from the Advisory / Forensic note): a mandate record; a litigation hold (set and released, kept as history); an evidence register
-- with SHA-256 and chain of custody; findings that must each be linked to evidence; report versions; a report issued by the lead Partner, which
-- locks the vault; an access list; and an event log of every opening, download and change.
--
-- The forensic standard reference is NOT stored as a fact. It is a placeholder until a Partner records the reference the Compliance Lead has
-- verified in writing. By default (recommended, not yet confirmed) a report cannot be issued while the reference is unverified. A numbered standard
-- that has not been verified is refused in every field that could print on a report.

-- 1. Settings: the open points, each "Default - not yet confirmed" until a Partner confirms it in writing.
CREATE TABLE erp_private.forensic_settings(
 setting_key text PRIMARY KEY,
 label text NOT NULL,
 text_value text NOT NULL,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed')),
 source_note text,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(rule_status='Suggested' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(COALESCE(source_note,'')))>=10)),
 CHECK(rule_status<>'Suggested' OR (confirmed_by IS NULL AND confirmed_at IS NULL))
);
CREATE INDEX forensic_settings_confirmed_by_idx ON erp_private.forensic_settings(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX forensic_settings_updated_by_idx ON erp_private.forensic_settings(updated_by) WHERE updated_by IS NOT NULL;
INSERT INTO erp_private.forensic_settings(setting_key,label,text_value) VALUES
 ('standard_reference','The forensic standard reference printed on a report. It stays a placeholder until the Compliance Lead has verified the reference in writing','[FORENSIC STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]'),
 ('report_needs_verified_standard','YES: a forensic report cannot be issued until the standard reference above is confirmed. NO: it can be issued with the placeholder','YES');
ALTER TABLE erp_private.forensic_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.forensic_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON erp_private.forensic_settings TO erp_api;
CREATE POLICY forensic_settings_read ON erp_private.forensic_settings FOR SELECT TO erp_api USING((erp_private.actor()).category_code='PARTNER');
CREATE POLICY forensic_settings_update ON erp_private.forensic_settings FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.forensic_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF ROW(NEW.setting_key,NEW.label) IS DISTINCT FROM ROW(OLD.setting_key,OLD.label) THEN RAISE EXCEPTION 'A setting cannot be renamed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change or confirm a forensic setting' USING ERRCODE='42501'; END IF;
 IF NEW.text_value IS DISTINCT FROM OLD.text_value THEN
  IF NEW.setting_key='report_needs_verified_standard' AND NEW.text_value NOT IN('YES','NO') THEN RAISE EXCEPTION 'Choose YES or NO' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='standard_reference' THEN
   IF length(btrim(NEW.text_value)) NOT BETWEEN 5 AND 300 THEN RAISE EXCEPTION 'Enter the reference in 5 to 300 characters' USING ERRCODE='23514'; END IF;
   IF NEW.text_value ~* 'isrs[\s-]*4000' THEN RAISE EXCEPTION 'That reference is not used until the Compliance Lead has verified a numbered forensic standard' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'Change the value first; a Partner then records the confirmation' USING ERRCODE='23514'; END IF;
  NEW.rule_status:='Suggested';NEW.confirmed_by:=NULL;NEW.confirmed_at:=NULL;NEW.source_note:=NULL;NEW.updated_by:=v_actor;
 ELSIF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF NEW.rule_status<>'Confirmed' THEN RAISE EXCEPTION 'A confirmation is withdrawn by changing the value' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.source_note,'')))<10 THEN RAISE EXCEPTION 'Say who confirmed this and where it is written (at least 10 characters)' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='standard_reference' AND NEW.text_value ~* 'PENDING COMPLIANCE REVIEW' THEN RAISE EXCEPTION 'Enter the verified standard reference first; the placeholder cannot be confirmed' USING ERRCODE='23514'; END IF;
  NEW.confirmed_at:=now();NEW.updated_by:=v_actor;
 ELSIF ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be edited' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_settings_guard BEFORE UPDATE ON erp_private.forensic_settings FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_settings_guard();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.forensic_settings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.forensic_settings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

-- 2. The vault tables. No change_audit trigger on any of them: the general audit log copies whole rows, which would expose the case.
CREATE SEQUENCE erp_private.forensic_case_seq;
CREATE TABLE erp_private.forensic_cases(
 case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_ref text NOT NULL UNIQUE,
 firm_id uuid NOT NULL REFERENCES erp_private.firms,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 200 AND title !~* 'isrs[\s-]*4000'),
 mandate_text text NOT NULL CHECK(length(btrim(mandate_text)) BETWEEN 20 AND 4000 AND mandate_text !~* 'isrs[\s-]*4000'),
 mandate_date date NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Issued')),
 lead_id uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_by uuid NOT NULL REFERENCES erp_private.staff_members,
 opened_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz,
 issued_by uuid REFERENCES erp_private.staff_members,
 issued_at timestamptz,
 issued_report_id uuid,
 issued_standard_reference text,
 issued_report_sha256 text CHECK(issued_report_sha256 IS NULL OR issued_report_sha256 ~ '^[0-9a-f]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Open' AND locked_at IS NULL AND issued_at IS NULL AND issued_by IS NULL AND issued_report_id IS NULL)
  OR (status='Issued' AND locked_at IS NOT NULL AND issued_at IS NOT NULL AND issued_by IS NOT NULL AND issued_report_id IS NOT NULL AND issued_report_sha256 IS NOT NULL AND issued_standard_reference IS NOT NULL))
);
CREATE INDEX forensic_cases_client_idx ON erp_private.forensic_cases(client_id);
CREATE INDEX forensic_cases_firm_idx ON erp_private.forensic_cases(firm_id);
CREATE INDEX forensic_cases_lead_idx ON erp_private.forensic_cases(lead_id);
CREATE INDEX forensic_cases_opened_by_idx ON erp_private.forensic_cases(opened_by);
CREATE INDEX forensic_cases_issued_by_idx ON erp_private.forensic_cases(issued_by) WHERE issued_by IS NOT NULL;

CREATE TABLE erp_private.forensic_access(
 access_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 staff_id uuid NOT NULL REFERENCES erp_private.staff_members,
 level text NOT NULL CHECK(level IN('Lead','Investigator','Viewer')),
 added_by uuid NOT NULL REFERENCES erp_private.staff_members,
 added_at timestamptz NOT NULL DEFAULT now(),
 removed_by uuid REFERENCES erp_private.staff_members,
 removed_at timestamptz,
 removed_reason text,
 CHECK((removed_at IS NULL)=(removed_by IS NULL) AND (removed_at IS NULL)=(removed_reason IS NULL)),
 CHECK(removed_reason IS NULL OR length(btrim(removed_reason))>=10)
);
CREATE UNIQUE INDEX forensic_access_one_active ON erp_private.forensic_access(case_id,staff_id) WHERE removed_at IS NULL;
CREATE UNIQUE INDEX forensic_access_one_lead ON erp_private.forensic_access(case_id) WHERE level='Lead' AND removed_at IS NULL;
CREATE INDEX forensic_access_staff_idx ON erp_private.forensic_access(staff_id) WHERE removed_at IS NULL;
CREATE INDEX forensic_access_added_by_idx ON erp_private.forensic_access(added_by);
CREATE INDEX forensic_access_removed_by_idx ON erp_private.forensic_access(removed_by) WHERE removed_by IS NOT NULL;

CREATE TABLE erp_private.forensic_evidence(
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 evidence_no integer NOT NULL CHECK(evidence_no>0),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 5 AND 1000),
 source_note text NOT NULL CHECK(length(btrim(source_note)) BETWEEN 5 AND 500),
 obtained_on date NOT NULL,
 file_name text NOT NULL CHECK(length(btrim(file_name)) BETWEEN 1 AND 255),
 object_key text NOT NULL UNIQUE,
 file_size_bytes bigint NOT NULL CHECK(file_size_bytes>0 AND file_size_bytes<=20971520),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 mime_type text NOT NULL,
 added_by uuid NOT NULL REFERENCES erp_private.staff_members,
 added_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdrawn_reason text,
 CHECK((withdrawn_at IS NULL)=(withdrawn_by IS NULL) AND (withdrawn_at IS NULL)=(withdrawn_reason IS NULL)),
 CHECK(withdrawn_reason IS NULL OR length(btrim(withdrawn_reason))>=10),
 UNIQUE(case_id,evidence_no)
);
CREATE UNIQUE INDEX forensic_evidence_case_sha ON erp_private.forensic_evidence(case_id,sha256) WHERE withdrawn_at IS NULL;
CREATE INDEX forensic_evidence_added_by_idx ON erp_private.forensic_evidence(added_by);
CREATE INDEX forensic_evidence_withdrawn_by_idx ON erp_private.forensic_evidence(withdrawn_by) WHERE withdrawn_by IS NOT NULL;

CREATE TABLE erp_private.forensic_custody(
 custody_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 evidence_id uuid NOT NULL REFERENCES erp_private.forensic_evidence,
 event_type text NOT NULL CHECK(event_type IN('Received','Transferred','Examined','Copied','Sealed','Returned')),
 from_holder text CHECK(from_holder IS NULL OR length(btrim(from_holder)) BETWEEN 2 AND 200),
 to_holder text CHECK(to_holder IS NULL OR length(btrim(to_holder)) BETWEEN 2 AND 200),
 note text CHECK(note IS NULL OR length(note)<=1000),
 event_at timestamptz NOT NULL,
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(event_type<>'Transferred' OR (from_holder IS NOT NULL AND to_holder IS NOT NULL))
);
CREATE INDEX forensic_custody_case_idx ON erp_private.forensic_custody(case_id);
CREATE INDEX forensic_custody_evidence_idx ON erp_private.forensic_custody(evidence_id,event_at);
CREATE INDEX forensic_custody_recorded_by_idx ON erp_private.forensic_custody(recorded_by);

CREATE TABLE erp_private.forensic_findings(
 finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 seq integer NOT NULL CHECK(seq>0),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 200 AND title !~* 'isrs[\s-]*4000'),
 description text NOT NULL CHECK(length(btrim(description)) BETWEEN 20 AND 4000 AND description !~* 'isrs[\s-]*4000'),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdrawn_reason text,
 CHECK((withdrawn_at IS NULL)=(withdrawn_by IS NULL) AND (withdrawn_at IS NULL)=(withdrawn_reason IS NULL)),
 CHECK(withdrawn_reason IS NULL OR length(btrim(withdrawn_reason))>=10),
 UNIQUE(case_id,seq)
);
CREATE INDEX forensic_findings_recorded_by_idx ON erp_private.forensic_findings(recorded_by);
CREATE INDEX forensic_findings_withdrawn_by_idx ON erp_private.forensic_findings(withdrawn_by) WHERE withdrawn_by IS NOT NULL;
CREATE TABLE erp_private.forensic_finding_evidence(
 finding_id uuid NOT NULL REFERENCES erp_private.forensic_findings,
 evidence_id uuid NOT NULL REFERENCES erp_private.forensic_evidence,
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 PRIMARY KEY(finding_id,evidence_id)
);
CREATE INDEX forensic_finding_evidence_evidence_idx ON erp_private.forensic_finding_evidence(evidence_id);
CREATE INDEX forensic_finding_evidence_case_idx ON erp_private.forensic_finding_evidence(case_id);

CREATE TABLE erp_private.forensic_reports(
 report_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 version integer NOT NULL CHECK(version>0),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 20 AND 100000 AND body !~* 'isrs[\s-]*4000'),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 saved_by uuid NOT NULL REFERENCES erp_private.staff_members,
 saved_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(case_id,version)
);
CREATE INDEX forensic_reports_saved_by_idx ON erp_private.forensic_reports(saved_by);
ALTER TABLE erp_private.forensic_cases ADD CONSTRAINT forensic_cases_issued_report_fk FOREIGN KEY(issued_report_id) REFERENCES erp_private.forensic_reports(report_id);
CREATE INDEX forensic_cases_issued_report_idx ON erp_private.forensic_cases(issued_report_id) WHERE issued_report_id IS NOT NULL;

CREATE TABLE erp_private.forensic_holds(
 hold_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 action text NOT NULL CHECK(action IN('Set','Released')),
 note text NOT NULL CHECK(length(btrim(note))>=10),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forensic_holds_case_idx ON erp_private.forensic_holds(case_id,recorded_at);
CREATE INDEX forensic_holds_recorded_by_idx ON erp_private.forensic_holds(recorded_by);

CREATE TABLE erp_private.forensic_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.forensic_cases,
 event_type text NOT NULL,
 evidence_id uuid REFERENCES erp_private.forensic_evidence,
 detail text,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX forensic_events_case_idx ON erp_private.forensic_events(case_id,occurred_at DESC);
CREATE INDEX forensic_events_actor_idx ON erp_private.forensic_events(actor_id);
CREATE INDEX forensic_events_evidence_idx ON erp_private.forensic_events(evidence_id) WHERE evidence_id IS NOT NULL;

-- 3. Who is on the list. All reads below use these two helpers.
CREATE FUNCTION erp_private.forensic_level(p_case uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT x.level FROM erp_private.forensic_access x WHERE x.case_id=p_case AND x.removed_at IS NULL AND x.staff_id=(erp_private.actor()).staff_id LIMIT 1
$$;
CREATE FUNCTION erp_private.forensic_on_list(p_case uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT erp_private.forensic_level(p_case) IS NOT NULL
$$;

-- 4. Row security: a row is readable only by someone on the case's access list. Nobody can write a table directly.
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['forensic_cases','forensic_access','forensic_evidence','forensic_custody','forensic_findings','forensic_finding_evidence','forensic_reports','forensic_holds','forensic_events'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
  EXECUTE format('CREATE POLICY %I ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.forensic_on_list(case_id))',t||'_read',t);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
 END LOOP;
END $$;

-- 5. Guards. Append-only tables never change. The case, access, evidence and finding rows change only in the narrow ways below.
CREATE FUNCTION erp_private.forensic_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'This forensic record is append-only and cannot be changed' USING ERRCODE='23514'; END $$;
CREATE TRIGGER forensic_custody_append BEFORE UPDATE ON erp_private.forensic_custody FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_append_only();
CREATE TRIGGER forensic_reports_append BEFORE UPDATE ON erp_private.forensic_reports FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_append_only();
CREATE TRIGGER forensic_holds_append BEFORE UPDATE ON erp_private.forensic_holds FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_append_only();
CREATE TRIGGER forensic_events_append BEFORE UPDATE ON erp_private.forensic_events FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_append_only();
CREATE TRIGGER forensic_finding_evidence_append BEFORE UPDATE ON erp_private.forensic_finding_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_append_only();

CREATE FUNCTION erp_private.forensic_cases_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'A forensic file is changed only through its own functions' USING ERRCODE='42501';
END $$;
-- The functions below run as the table owner, so this trigger stops only direct writes by the application role.
CREATE TRIGGER forensic_cases_direct BEFORE INSERT OR UPDATE ON erp_private.forensic_cases FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_cases_guard();

CREATE FUNCTION erp_private.forensic_cases_update_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF ROW(NEW.case_id,NEW.case_ref,NEW.firm_id,NEW.client_id,NEW.title,NEW.mandate_text,NEW.mandate_date,NEW.opened_by,NEW.opened_at)
  IS DISTINCT FROM ROW(OLD.case_id,OLD.case_ref,OLD.firm_id,OLD.client_id,OLD.title,OLD.mandate_text,OLD.mandate_date,OLD.opened_by,OLD.opened_at) THEN
  RAISE EXCEPTION 'The client, firm, title and mandate of a forensic file cannot be changed' USING ERRCODE='23514'; END IF;
 IF OLD.status='Issued' THEN
  IF ROW(NEW.status,NEW.locked_at,NEW.issued_by,NEW.issued_at,NEW.issued_report_id,NEW.issued_standard_reference,NEW.issued_report_sha256)
   IS DISTINCT FROM ROW(OLD.status,OLD.locked_at,OLD.issued_by,OLD.issued_at,OLD.issued_report_id,OLD.issued_standard_reference,OLD.issued_report_sha256) THEN
   RAISE EXCEPTION 'This forensic file is locked: the report has been issued' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status='Open' AND NEW.lead_id IS DISTINCT FROM OLD.lead_id THEN NULL;
 ELSIF NEW.status NOT IN('Open','Issued') THEN RAISE EXCEPTION 'Invalid status' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_cases_update BEFORE UPDATE ON erp_private.forensic_cases FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_cases_update_guard();

CREATE FUNCTION erp_private.forensic_access_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF ROW(NEW.access_id,NEW.case_id,NEW.staff_id,NEW.added_by,NEW.added_at) IS DISTINCT FROM ROW(OLD.access_id,OLD.case_id,OLD.staff_id,OLD.added_by,OLD.added_at) THEN
  RAISE EXCEPTION 'An access entry cannot be re-pointed' USING ERRCODE='23514'; END IF;
 IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A removed access entry cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.level IS DISTINCT FROM OLD.level AND (OLD.level='Lead' OR NEW.level='Lead') AND COALESCE(current_setting('erp.forensic_transfer',true),'')<>'on' THEN
  RAISE EXCEPTION 'The lead Partner changes only through a transfer of the lead' USING ERRCODE='23514'; END IF;
 IF NEW.removed_at IS NOT NULL AND OLD.level='Lead' AND COALESCE(current_setting('erp.forensic_transfer',true),'')<>'on' THEN
  RAISE EXCEPTION 'The lead Partner cannot be removed; transfer the lead first' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_access_update BEFORE UPDATE ON erp_private.forensic_access FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_access_guard();

CREATE FUNCTION erp_private.forensic_withdraw_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE o jsonb;n jsonb;
BEGIN
 o:=to_jsonb(OLD)-'withdrawn_by'-'withdrawn_at'-'withdrawn_reason';n:=to_jsonb(NEW)-'withdrawn_by'-'withdrawn_at'-'withdrawn_reason';
 IF o IS DISTINCT FROM n THEN RAISE EXCEPTION 'Only a withdrawal can be recorded on this forensic record' USING ERRCODE='23514'; END IF;
 IF OLD.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Already withdrawn' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_evidence_update BEFORE UPDATE ON erp_private.forensic_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_withdraw_guard();
CREATE TRIGGER forensic_findings_update BEFORE UPDATE ON erp_private.forensic_findings FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_withdraw_guard();

-- Nothing may be added to a locked file except custody entries, holds, access changes and events.
CREATE FUNCTION erp_private.forensic_open_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.forensic_cases c WHERE c.case_id=NEW.case_id AND c.status<>'Open') THEN
  RAISE EXCEPTION 'This forensic file is locked: the report has been issued' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_evidence_open BEFORE INSERT ON erp_private.forensic_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_open_guard();
CREATE TRIGGER forensic_findings_open BEFORE INSERT ON erp_private.forensic_findings FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_open_guard();
CREATE TRIGGER forensic_finding_evidence_open BEFORE INSERT ON erp_private.forensic_finding_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_open_guard();
CREATE TRIGGER forensic_reports_open BEFORE INSERT ON erp_private.forensic_reports FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_open_guard();

CREATE FUNCTION erp_private.forensic_same_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_TABLE_NAME='forensic_finding_evidence' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.forensic_findings f WHERE f.finding_id=NEW.finding_id AND f.case_id=NEW.case_id)
   OR NOT EXISTS(SELECT 1 FROM erp_private.forensic_evidence e WHERE e.evidence_id=NEW.evidence_id AND e.case_id=NEW.case_id) THEN
   RAISE EXCEPTION 'A finding can cite only evidence in the same forensic file' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='forensic_custody' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.forensic_evidence e WHERE e.evidence_id=NEW.evidence_id AND e.case_id=NEW.case_id) THEN
   RAISE EXCEPTION 'That evidence is not in this forensic file' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER forensic_finding_evidence_case BEFORE INSERT ON erp_private.forensic_finding_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_same_case_guard();
CREATE TRIGGER forensic_custody_case BEFORE INSERT ON erp_private.forensic_custody FOR EACH ROW EXECUTE FUNCTION erp_private.forensic_same_case_guard();

-- 6. The event log helper (internal; not callable by the application role).
CREATE FUNCTION erp_private.forensic_log(p_case uuid,p_type text,p_evidence uuid,p_detail text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
 INSERT INTO erp_private.forensic_events(case_id,event_type,evidence_id,detail,actor_id) VALUES(p_case,p_type,p_evidence,left(p_detail,500),(erp_private.actor()).staff_id)
$$;
CREATE FUNCTION erp_private.forensic_setting_text(p_key text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT text_value FROM erp_private.forensic_settings WHERE setting_key=p_key
$$;
-- A refusal that does not reveal whether the file exists.
CREATE FUNCTION erp_private.forensic_need(p_case uuid,p_writer boolean,p_lead boolean,p_open boolean) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_level text;v_status text;
BEGIN
 v_level:=erp_private.forensic_level(p_case);
 IF v_level IS NULL THEN RAISE EXCEPTION 'That forensic file is not available to you' USING ERRCODE='42501'; END IF;
 IF p_lead AND v_level<>'Lead' THEN RAISE EXCEPTION 'Only the lead Partner can do this' USING ERRCODE='42501'; END IF;
 IF p_writer AND v_level NOT IN('Lead','Investigator') THEN RAISE EXCEPTION 'You have read-only access to this forensic file' USING ERRCODE='42501'; END IF;
 IF p_open THEN
  SELECT status INTO v_status FROM erp_private.forensic_cases WHERE case_id=p_case;
  IF v_status<>'Open' THEN RAISE EXCEPTION 'This forensic file is locked: the report has been issued' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN v_level;
END $$;

-- 7. Open a file. Only a Partner can; that Partner becomes the lead and the first person on the list.
CREATE FUNCTION erp_private.forensic_case_open(p_case uuid,p_client uuid,p_firm uuid,p_title text,p_mandate text,p_mandate_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_ref text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can open a forensic file' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l JOIN erp_private.firms f ON f.firm_id=l.firm_id WHERE l.client_id=p_client AND l.firm_id=p_firm AND l.deleted_at IS NULL AND f.deleted_at IS NULL AND f.is_active) THEN
  RAISE EXCEPTION 'Choose a handling firm that serves this client' USING ERRCODE='23514'; END IF;
 IF p_mandate_date IS NULL OR p_mandate_date>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The mandate date cannot be in the future' USING ERRCODE='23514'; END IF;
 v_ref:='FOR-'||to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY')||'-'||lpad(nextval('erp_private.forensic_case_seq')::text,4,'0');
 INSERT INTO erp_private.forensic_cases(case_id,case_ref,firm_id,client_id,title,mandate_text,mandate_date,lead_id,opened_by)
 VALUES(p_case,v_ref,p_firm,p_client,btrim(p_title),btrim(p_mandate),p_mandate_date,a.staff_id,a.staff_id);
 INSERT INTO erp_private.forensic_access(case_id,staff_id,level,added_by) VALUES(p_case,a.staff_id,'Lead',a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'File opened',NULL,v_ref);
 RETURN jsonb_build_object('case_id',p_case,'case_ref',v_ref);
END $$;

-- 8. The people on the list. Only the lead Partner changes it. Administrators and Interns can never be added.
CREATE FUNCTION erp_private.forensic_access_add(p_case uuid,p_staff uuid,p_level text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;s erp_private.staff_members;v_firm uuid;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF p_level NOT IN('Investigator','Viewer') THEN RAISE EXCEPTION 'Choose Investigator or Viewer' USING ERRCODE='22023'; END IF;
 SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=p_staff AND access_status='Active' AND deleted_at IS NULL;
 IF s.staff_id IS NULL THEN RAISE EXCEPTION 'That person is not an active member of staff' USING ERRCODE='23514'; END IF;
 IF s.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Administrators and Interns cannot be added to a forensic file' USING ERRCODE='23514'; END IF;
 SELECT firm_id INTO v_firm FROM erp_private.forensic_cases WHERE case_id=p_case;
 IF s.category_code<>'PARTNER' AND NOT EXISTS(SELECT 1 FROM erp_private.staff_firm_access x WHERE x.staff_id=p_staff AND x.firm_id=v_firm AND x.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'That person does not work in the firm that handles this file' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.forensic_access WHERE case_id=p_case AND staff_id=p_staff AND removed_at IS NULL) THEN RAISE EXCEPTION 'That person is already on the list' USING ERRCODE='23505'; END IF;
 INSERT INTO erp_private.forensic_access(case_id,staff_id,level,added_by) VALUES(p_case,p_staff,p_level,a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'Person added',NULL,s.full_name||' as '||p_level);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_access_level(p_case uuid,p_staff uuid,p_level text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE x erp_private.forensic_access;n text;
BEGIN
 PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF p_level NOT IN('Investigator','Viewer') THEN RAISE EXCEPTION 'Choose Investigator or Viewer' USING ERRCODE='22023'; END IF;
 SELECT * INTO x FROM erp_private.forensic_access WHERE case_id=p_case AND staff_id=p_staff AND removed_at IS NULL;
 IF x.access_id IS NULL THEN RAISE EXCEPTION 'That person is not on the list' USING ERRCODE='23514'; END IF;
 IF x.level='Lead' THEN RAISE EXCEPTION 'The lead Partner changes only through a transfer of the lead' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.forensic_access SET level=p_level WHERE access_id=x.access_id;
 SELECT full_name INTO n FROM erp_private.staff_members WHERE staff_id=p_staff;
 PERFORM erp_private.forensic_log(p_case,'Access level changed',NULL,n||' is now '||p_level);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_access_remove(p_case uuid,p_staff uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;x erp_private.forensic_access;n text;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT * INTO x FROM erp_private.forensic_access WHERE case_id=p_case AND staff_id=p_staff AND removed_at IS NULL;
 IF x.access_id IS NULL THEN RAISE EXCEPTION 'That person is not on the list' USING ERRCODE='23514'; END IF;
 IF x.level='Lead' THEN RAISE EXCEPTION 'The lead Partner cannot be removed; transfer the lead first' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.forensic_access SET removed_by=a.staff_id,removed_at=now(),removed_reason=btrim(p_reason) WHERE access_id=x.access_id;
 SELECT full_name INTO n FROM erp_private.staff_members WHERE staff_id=p_staff;
 PERFORM erp_private.forensic_log(p_case,'Person removed',NULL,n||': '||btrim(p_reason));
 RETURN jsonb_build_object('ok',true);
END $$;
-- Hand the lead to another Partner (for example when the lead leaves). The new lead is added to the list if needed; the old lead stays as an Investigator.
CREATE FUNCTION erp_private.forensic_lead_transfer(p_case uuid,p_new uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;s erp_private.staff_members;old_x erp_private.forensic_access;new_x erp_private.forensic_access;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM erp_private.staff_members WHERE staff_id=p_new AND access_status='Active' AND deleted_at IS NULL AND category_code='PARTNER';
 IF s.staff_id IS NULL OR s.staff_id=a.staff_id THEN RAISE EXCEPTION 'Choose another active Partner' USING ERRCODE='23514'; END IF;
 PERFORM set_config('erp.forensic_transfer','on',true);
 SELECT * INTO old_x FROM erp_private.forensic_access WHERE case_id=p_case AND staff_id=a.staff_id AND removed_at IS NULL;
 SELECT * INTO new_x FROM erp_private.forensic_access WHERE case_id=p_case AND staff_id=p_new AND removed_at IS NULL;
 UPDATE erp_private.forensic_access SET level='Investigator' WHERE access_id=old_x.access_id;
 IF new_x.access_id IS NULL THEN INSERT INTO erp_private.forensic_access(case_id,staff_id,level,added_by) VALUES(p_case,p_new,'Lead',a.staff_id);
 ELSE UPDATE erp_private.forensic_access SET level='Lead' WHERE access_id=new_x.access_id; END IF;
 UPDATE erp_private.forensic_cases SET lead_id=p_new WHERE case_id=p_case;
 PERFORM set_config('erp.forensic_transfer','off',true);
 PERFORM erp_private.forensic_log(p_case,'Lead transferred',NULL,s.full_name||': '||btrim(p_reason));
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_staff_options(p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_firm uuid;
BEGIN
 PERFORM erp_private.forensic_need(p_case,false,true,false);
 SELECT firm_id INTO v_firm FROM erp_private.forensic_cases WHERE case_id=p_case;
 RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('staff_id',s.staff_id,'full_name',s.full_name,'category_code',s.category_code) ORDER BY s.full_name)
  FROM erp_private.staff_members s WHERE s.access_status='Active' AND s.deleted_at IS NULL AND s.category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
  AND (s.category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access x WHERE x.staff_id=s.staff_id AND x.firm_id=v_firm AND x.deleted_at IS NULL))
  AND NOT EXISTS(SELECT 1 FROM erp_private.forensic_access y WHERE y.case_id=p_case AND y.staff_id=s.staff_id AND y.removed_at IS NULL)),'[]'::jsonb);
END $$;

-- 9. Evidence, custody, findings, report, hold.
CREATE FUNCTION erp_private.forensic_evidence_register(p_evidence uuid,p_case uuid,p_description text,p_source text,p_obtained_on date,p_file_name text,p_object_key text,p_size bigint,p_sha256 text,p_mime text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_no int;v_dup int;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,true,false,true);
 IF p_object_key IS NULL OR p_object_key NOT LIKE 'forensic/'||p_case::text||'/%' THEN RAISE EXCEPTION 'The file is not stored under this forensic file' USING ERRCODE='23514'; END IF;
 IF p_obtained_on IS NULL OR p_obtained_on>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'The date obtained cannot be in the future' USING ERRCODE='23514'; END IF;
 SELECT evidence_no INTO v_dup FROM erp_private.forensic_evidence WHERE case_id=p_case AND sha256=p_sha256 AND withdrawn_at IS NULL LIMIT 1;
 IF v_dup IS NOT NULL THEN RAISE EXCEPTION 'This file is already evidence item % in this forensic file', v_dup USING ERRCODE='23505'; END IF;
 SELECT COALESCE(max(evidence_no),0)+1 INTO v_no FROM erp_private.forensic_evidence WHERE case_id=p_case;
 INSERT INTO erp_private.forensic_evidence(evidence_id,case_id,evidence_no,description,source_note,obtained_on,file_name,object_key,file_size_bytes,sha256,mime_type,added_by)
 VALUES(p_evidence,p_case,v_no,btrim(p_description),btrim(p_source),p_obtained_on,p_file_name,p_object_key,p_size,p_sha256,p_mime,a.staff_id);
 INSERT INTO erp_private.forensic_custody(case_id,evidence_id,event_type,to_holder,note,event_at,recorded_by) VALUES(p_case,p_evidence,'Received',a.full_name,btrim(p_source),now(),a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'Evidence added',p_evidence,'Item '||v_no||': '||p_file_name);
 RETURN jsonb_build_object('evidence_id',p_evidence,'evidence_no',v_no,'sha256',p_sha256);
END $$;
CREATE FUNCTION erp_private.forensic_evidence_withdraw(p_evidence uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.forensic_evidence;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.forensic_evidence WHERE evidence_id=p_evidence;
 IF e.evidence_id IS NULL THEN RAISE EXCEPTION 'That forensic file is not available to you' USING ERRCODE='42501'; END IF;
 PERFORM erp_private.forensic_need(e.case_id,false,true,true);
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='23514'; END IF;
 IF e.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Already withdrawn' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.forensic_finding_evidence fe JOIN erp_private.forensic_findings f ON f.finding_id=fe.finding_id WHERE fe.evidence_id=p_evidence AND f.withdrawn_at IS NULL) THEN
  RAISE EXCEPTION 'A finding still cites this evidence; withdraw the finding first' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.forensic_evidence SET withdrawn_by=a.staff_id,withdrawn_at=now(),withdrawn_reason=btrim(p_reason) WHERE evidence_id=p_evidence;
 PERFORM erp_private.forensic_log(e.case_id,'Evidence withdrawn',p_evidence,'Item '||e.evidence_no||': '||btrim(p_reason));
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_custody_add(p_evidence uuid,p_event text,p_from text,p_to text,p_note text,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;e erp_private.forensic_evidence;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO e FROM erp_private.forensic_evidence WHERE evidence_id=p_evidence;
 IF e.evidence_id IS NULL THEN RAISE EXCEPTION 'That forensic file is not available to you' USING ERRCODE='42501'; END IF;
 PERFORM erp_private.forensic_need(e.case_id,true,false,false);
 IF e.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'This evidence has been withdrawn' USING ERRCODE='23514'; END IF;
 IF p_event NOT IN('Transferred','Examined','Copied','Sealed','Returned') THEN RAISE EXCEPTION 'Choose Transferred, Examined, Copied, Sealed or Returned' USING ERRCODE='22023'; END IF;
 IF p_at IS NOT NULL AND p_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'A custody entry cannot be dated in the future' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.forensic_custody(case_id,evidence_id,event_type,from_holder,to_holder,note,event_at,recorded_by)
 VALUES(e.case_id,p_evidence,p_event,NULLIF(btrim(COALESCE(p_from,'')),''),NULLIF(btrim(COALESCE(p_to,'')),''),NULLIF(btrim(COALESCE(p_note,'')),''),COALESCE(p_at,now()),a.staff_id);
 PERFORM erp_private.forensic_log(e.case_id,'Custody: '||p_event,p_evidence,'Item '||e.evidence_no);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_finding_add(p_case uuid,p_title text,p_description text,p_evidence uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_id uuid:=gen_random_uuid();v_seq int;v_ids uuid[];v_good int;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,true,false,true);
 SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(COALESCE(p_evidence,'{}'::uuid[])) x;
 IF COALESCE(array_length(v_ids,1),0)=0 THEN RAISE EXCEPTION 'A finding must cite at least one item of evidence' USING ERRCODE='23514'; END IF;
 SELECT count(*) INTO v_good FROM erp_private.forensic_evidence e WHERE e.case_id=p_case AND e.evidence_id=ANY(v_ids) AND e.withdrawn_at IS NULL;
 IF v_good<>array_length(v_ids,1) THEN RAISE EXCEPTION 'Every cited item must be live evidence in this forensic file' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(seq),0)+1 INTO v_seq FROM erp_private.forensic_findings WHERE case_id=p_case;
 INSERT INTO erp_private.forensic_findings(finding_id,case_id,seq,title,description,recorded_by) VALUES(v_id,p_case,v_seq,btrim(p_title),btrim(p_description),a.staff_id);
 INSERT INTO erp_private.forensic_finding_evidence(finding_id,evidence_id,case_id) SELECT v_id,x,p_case FROM unnest(v_ids) x;
 PERFORM erp_private.forensic_log(p_case,'Finding added',NULL,'Finding '||v_seq);
 RETURN jsonb_build_object('finding_id',v_id,'seq',v_seq);
END $$;
CREATE FUNCTION erp_private.forensic_finding_withdraw(p_finding uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.forensic_findings;
BEGIN
 a:=erp_private.actor();
 SELECT * INTO f FROM erp_private.forensic_findings WHERE finding_id=p_finding;
 IF f.finding_id IS NULL THEN RAISE EXCEPTION 'That forensic file is not available to you' USING ERRCODE='42501'; END IF;
 PERFORM erp_private.forensic_need(f.case_id,false,true,true);
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='23514'; END IF;
 IF f.withdrawn_at IS NOT NULL THEN RAISE EXCEPTION 'Already withdrawn' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.forensic_findings SET withdrawn_by=a.staff_id,withdrawn_at=now(),withdrawn_reason=btrim(p_reason) WHERE finding_id=p_finding;
 PERFORM erp_private.forensic_log(f.case_id,'Finding withdrawn',NULL,'Finding '||f.seq||': '||btrim(p_reason));
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_report_save(p_case uuid,p_body text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_ver int;v_id uuid:=gen_random_uuid();
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,true,false,true);
 IF length(btrim(COALESCE(p_body,'')))<20 THEN RAISE EXCEPTION 'The report needs at least 20 characters' USING ERRCODE='23514'; END IF;
 IF p_body ~* 'isrs[\s-]*4000' THEN RAISE EXCEPTION 'That standard reference is not used until the Compliance Lead has verified a numbered forensic standard' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(max(version),0)+1 INTO v_ver FROM erp_private.forensic_reports WHERE case_id=p_case;
 INSERT INTO erp_private.forensic_reports(report_id,case_id,version,body,sha256,saved_by) VALUES(v_id,p_case,v_ver,btrim(p_body),encode(sha256(convert_to(btrim(p_body),'UTF8')),'hex'),a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'Report saved',NULL,'Version '||v_ver);
 RETURN jsonb_build_object('report_id',v_id,'version',v_ver);
END $$;
-- Only the lead Partner issues. Issuing records the standard reference as it stands and locks the vault.
CREATE FUNCTION erp_private.forensic_report_issue(p_case uuid,p_confirm boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;r erp_private.forensic_reports;v_ref text;v_status text;v_need text;v_hash text;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,true);
 IF a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can issue a forensic report' USING ERRCODE='42501'; END IF;
 IF NOT COALESCE(p_confirm,false) THEN RAISE EXCEPTION 'Confirm that you have read the report and the findings' USING ERRCODE='23514'; END IF;
 SELECT * INTO r FROM erp_private.forensic_reports WHERE case_id=p_case ORDER BY version DESC LIMIT 1;
 IF r.report_id IS NULL THEN RAISE EXCEPTION 'Save the report first' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.forensic_evidence WHERE case_id=p_case AND withdrawn_at IS NULL) THEN RAISE EXCEPTION 'Add at least one item of evidence first' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.forensic_findings WHERE case_id=p_case AND withdrawn_at IS NULL) THEN RAISE EXCEPTION 'Record at least one finding first' USING ERRCODE='23514'; END IF;
 v_need:=erp_private.forensic_setting_text('report_needs_verified_standard');
 SELECT text_value,rule_status INTO v_ref,v_status FROM erp_private.forensic_settings WHERE setting_key='standard_reference';
 IF v_need='YES' AND v_status<>'Confirmed' THEN
  RAISE EXCEPTION 'The forensic standard reference has not been verified by the Compliance Lead. A Partner records it in Settings first' USING ERRCODE='23514'; END IF;
 v_hash:=encode(sha256(convert_to(r.body||E'\n'||v_ref,'UTF8')),'hex');
 UPDATE erp_private.forensic_cases SET status='Issued',locked_at=now(),issued_by=a.staff_id,issued_at=now(),issued_report_id=r.report_id,issued_standard_reference=v_ref,issued_report_sha256=v_hash WHERE case_id=p_case;
 PERFORM erp_private.forensic_log(p_case,'Report issued',NULL,'Version '||r.version||'; standard reference '||CASE WHEN v_status='Confirmed' THEN 'verified' ELSE 'not verified' END);
 RETURN jsonb_build_object('report_id',r.report_id,'version',r.version,'sha256',v_hash,'standard_reference',v_ref,'standard_verified',v_status='Confirmed');
END $$;
CREATE FUNCTION erp_private.forensic_hold_set(p_case uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_last text;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Say what is held and why (at least 10 characters)' USING ERRCODE='23514'; END IF;
 SELECT action INTO v_last FROM erp_private.forensic_holds WHERE case_id=p_case ORDER BY recorded_at DESC,hold_id DESC LIMIT 1;
 IF v_last='Set' THEN RAISE EXCEPTION 'A litigation hold is already in force' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.forensic_holds(case_id,action,note,recorded_by) VALUES(p_case,'Set',btrim(p_note),a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'Litigation hold set',NULL,NULL);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION erp_private.forensic_hold_release(p_case uuid,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_last text;
BEGIN
 a:=erp_private.actor();PERFORM erp_private.forensic_need(p_case,false,true,false);
 IF length(btrim(COALESCE(p_reason,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters' USING ERRCODE='23514'; END IF;
 SELECT action INTO v_last FROM erp_private.forensic_holds WHERE case_id=p_case ORDER BY recorded_at DESC,hold_id DESC LIMIT 1;
 IF v_last IS DISTINCT FROM 'Set' THEN RAISE EXCEPTION 'No litigation hold is in force' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.forensic_holds(case_id,action,note,recorded_by) VALUES(p_case,'Released',btrim(p_reason),a.staff_id);
 PERFORM erp_private.forensic_log(p_case,'Litigation hold released',NULL,NULL);
 RETURN jsonb_build_object('ok',true);
END $$;

-- 10. Reading. The list shows only the files the signed-in person is on; the file shows everything to anyone on its list.
CREATE FUNCTION erp_private.forensic_list() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('case_id',c.case_id,'case_ref',c.case_ref,'title',c.title,'client_id',c.client_id,'client_name',cl.company_name,'firm_id',c.firm_id,'firm_code',f.firm_code,
  'status',c.status,'my_level',x.level,'lead_name',ld.full_name,'opened_at',c.opened_at,'issued_at',c.issued_at,
  'evidence_count',(SELECT count(*) FROM erp_private.forensic_evidence e WHERE e.case_id=c.case_id AND e.withdrawn_at IS NULL),
  'finding_count',(SELECT count(*) FROM erp_private.forensic_findings g WHERE g.case_id=c.case_id AND g.withdrawn_at IS NULL),
  'hold_active',COALESCE((SELECT h.action='Set' FROM erp_private.forensic_holds h WHERE h.case_id=c.case_id ORDER BY h.recorded_at DESC,h.hold_id DESC LIMIT 1),false)) ORDER BY c.opened_at DESC),'[]'::jsonb)
 FROM erp_private.forensic_cases c
 JOIN erp_private.forensic_access x ON x.case_id=c.case_id AND x.removed_at IS NULL AND x.staff_id=(erp_private.actor()).staff_id
 JOIN erp_private.clients cl ON cl.client_id=c.client_id JOIN erp_private.firms f ON f.firm_id=c.firm_id JOIN erp_private.staff_members ld ON ld.staff_id=c.lead_id
$$;
CREATE FUNCTION erp_private.forensic_get(p_case uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_level text;c erp_private.forensic_cases;v_out jsonb;
BEGIN
 v_level:=erp_private.forensic_need(p_case,false,false,false);
 SELECT * INTO c FROM erp_private.forensic_cases WHERE case_id=p_case;
 PERFORM erp_private.forensic_log(p_case,'File opened for viewing',NULL,NULL);
 v_out:=jsonb_build_object(
  'my_level',v_level,
  'case',jsonb_build_object('case_id',c.case_id,'case_ref',c.case_ref,'title',c.title,'mandate_text',c.mandate_text,'mandate_date',c.mandate_date,'status',c.status,'client_id',c.client_id,
   'client_name',(SELECT company_name FROM erp_private.clients WHERE client_id=c.client_id),'firm_id',c.firm_id,'firm_code',(SELECT firm_code FROM erp_private.firms WHERE firm_id=c.firm_id),
   'lead_id',c.lead_id,'lead_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=c.lead_id),'opened_at',c.opened_at,'locked_at',c.locked_at,'issued_at',c.issued_at,
   'issued_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=c.issued_by),'issued_report_id',c.issued_report_id,'issued_standard_reference',c.issued_standard_reference,'issued_report_sha256',c.issued_report_sha256),
  'access',COALESCE((SELECT jsonb_agg(jsonb_build_object('access_id',x.access_id,'staff_id',x.staff_id,'full_name',s.full_name,'category_code',s.category_code,'level',x.level,'added_at',x.added_at,
    'added_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=x.added_by),'removed_at',x.removed_at,'removed_reason',x.removed_reason) ORDER BY x.removed_at NULLS FIRST,x.added_at)
    FROM erp_private.forensic_access x JOIN erp_private.staff_members s ON s.staff_id=x.staff_id WHERE x.case_id=p_case),'[]'::jsonb),
  'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('evidence_id',e.evidence_id,'evidence_no',e.evidence_no,'description',e.description,'source_note',e.source_note,'obtained_on',e.obtained_on,'file_name',e.file_name,
    'file_size_bytes',e.file_size_bytes,'sha256',e.sha256,'mime_type',e.mime_type,'added_at',e.added_at,'added_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=e.added_by),
    'withdrawn_at',e.withdrawn_at,'withdrawn_reason',e.withdrawn_reason,
    'custody',COALESCE((SELECT jsonb_agg(jsonb_build_object('custody_id',k.custody_id,'event_type',k.event_type,'from_holder',k.from_holder,'to_holder',k.to_holder,'note',k.note,'event_at',k.event_at,
      'recorded_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=k.recorded_by)) ORDER BY k.event_at,k.recorded_at) FROM erp_private.forensic_custody k WHERE k.evidence_id=e.evidence_id),'[]'::jsonb)) ORDER BY e.evidence_no)
    FROM erp_private.forensic_evidence e WHERE e.case_id=p_case),'[]'::jsonb),
  'findings',COALESCE((SELECT jsonb_agg(jsonb_build_object('finding_id',g.finding_id,'seq',g.seq,'title',g.title,'description',g.description,'recorded_at',g.recorded_at,
    'recorded_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=g.recorded_by),'withdrawn_at',g.withdrawn_at,'withdrawn_reason',g.withdrawn_reason,
    'evidence_nos',COALESCE((SELECT jsonb_agg(e.evidence_no ORDER BY e.evidence_no) FROM erp_private.forensic_finding_evidence fe JOIN erp_private.forensic_evidence e ON e.evidence_id=fe.evidence_id WHERE fe.finding_id=g.finding_id),'[]'::jsonb)) ORDER BY g.seq)
    FROM erp_private.forensic_findings g WHERE g.case_id=p_case),'[]'::jsonb),
  'reports',COALESCE((SELECT jsonb_agg(jsonb_build_object('report_id',r.report_id,'version',r.version,'sha256',r.sha256,'saved_at',r.saved_at,
    'saved_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=r.saved_by),'issued',r.report_id=c.issued_report_id) ORDER BY r.version DESC) FROM erp_private.forensic_reports r WHERE r.case_id=p_case),'[]'::jsonb),
  'report_body',(SELECT r.body FROM erp_private.forensic_reports r WHERE r.case_id=p_case ORDER BY r.version DESC LIMIT 1),
  'holds',COALESCE((SELECT jsonb_agg(jsonb_build_object('action',h.action,'note',h.note,'recorded_at',h.recorded_at,'recorded_by_name',(SELECT full_name FROM erp_private.staff_members WHERE staff_id=h.recorded_by)) ORDER BY h.recorded_at,h.hold_id) FROM erp_private.forensic_holds h WHERE h.case_id=p_case),'[]'::jsonb),
  'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type',q.event_type,'detail',q.detail,'occurred_at',q.occurred_at,'actor_name',q.actor_name,'evidence_id',q.evidence_id) ORDER BY q.occurred_at DESC)
    FROM (SELECT ev.event_type,ev.detail,ev.occurred_at,ev.evidence_id,(SELECT full_name FROM erp_private.staff_members WHERE staff_id=ev.actor_id) actor_name FROM erp_private.forensic_events ev WHERE ev.case_id=p_case ORDER BY ev.occurred_at DESC LIMIT 200) q),'[]'::jsonb),
  'standard',jsonb_build_object('reference',(SELECT text_value FROM erp_private.forensic_settings WHERE setting_key='standard_reference'),
    'status',(SELECT rule_status FROM erp_private.forensic_settings WHERE setting_key='standard_reference'),
    'needs_verified',erp_private.forensic_setting_text('report_needs_verified_standard')='YES'));
 RETURN v_out;
END $$;
-- The server asks for the stored file only through this function, which checks the list and records the download.
CREATE FUNCTION erp_private.forensic_evidence_file(p_evidence uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE e erp_private.forensic_evidence;
BEGIN
 SELECT * INTO e FROM erp_private.forensic_evidence WHERE evidence_id=p_evidence;
 IF e.evidence_id IS NULL OR NOT erp_private.forensic_on_list(e.case_id) THEN RAISE EXCEPTION 'That forensic file is not available to you' USING ERRCODE='42501'; END IF;
 PERFORM erp_private.forensic_log(e.case_id,'Evidence downloaded',p_evidence,'Item '||e.evidence_no||': '||e.file_name);
 RETURN jsonb_build_object('object_key',e.object_key,'file_name',e.file_name,'mime_type',e.mime_type,'sha256',e.sha256);
END $$;

-- 11. The service profile now points at the built file. An ordinary ADV-FOR project is still an ordinary (unrestricted) project.
UPDATE erp_private.service_profiles SET engine_state='Built',
 note='The forensic file is built as a separate vault (Forensic files in the menu): access list, evidence with SHA-256 and chain of custody, findings tied to evidence, litigation hold, report issued by the lead Partner and locked. A project of this service is an ordinary project and is NOT restricted; record forensic work in a forensic file. The standard reference stays a placeholder until the Compliance Lead verifies it.'
 WHERE service_code='ADV-FOR';

-- 12. Grants: callable functions go to the application role; helpers and guards are not callable.
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS sig,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='erp_private' AND p.proname LIKE 'forensic\_%' LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.sig);
  IF r.proname IN('forensic_settings_guard','forensic_append_only','forensic_cases_guard','forensic_cases_update_guard','forensic_access_guard','forensic_withdraw_guard','forensic_open_guard','forensic_same_case_guard','forensic_log','forensic_setting_text','forensic_need') THEN
   EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM erp_api',r.sig);
  ELSE
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO erp_api',r.sig);
  END IF;
 END LOOP;
END $$;
