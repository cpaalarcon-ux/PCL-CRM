-- Build 2782: KRA case upgrades, first slice (from the KRA case management section of the Partner's note of 11 Nov 2026).
--  * A work stage on every case: Received, Triage, In progress, Internal review, Approved to send (open cases), then Submitted to KRA, Awaiting KRA,
--    Further information requested, Dispute or appeal, Resolved (after the response). The legal status (Open, Responded, Closed, Cancelled) is unchanged,
--    so "responded" still does not mean "closed": a Partner approves and closes.
--  * Submission details (date and time, channel, KRA reference, optional acknowledgment document) are required to mark a case as responded,
--    and a case cannot be submitted while a requested document is still missing.
--  * A communications log and an automatic timeline (stage changes, submissions, documents received, status changes).
--  * Flag E: an internal Partner alert when an open case is within N days of its deadline. N is 7 (the Partner's answer) and stays "Suggested" until a Partner confirms it.
-- Not built here: several tax heads and periods per case, provisional-client intake, a rule register with Partner sign-off, case task templates. No tax rule, rate or day count is stored.

CREATE TABLE erp_private.kra_case_progress(
 case_id uuid PRIMARY KEY REFERENCES erp_private.kra_cases,
 stage text NOT NULL DEFAULT 'Received' CHECK(stage IN('Received','Triage','In progress','Internal review','Approved to send','Submitted to KRA','Awaiting KRA','Further information requested','Dispute or appeal','Resolved')),
 stage_changed_at timestamptz NOT NULL DEFAULT now(),
 stage_changed_by uuid REFERENCES erp_private.staff_members,
 submitted_at timestamptz,
 submission_channel text CHECK(submission_channel IS NULL OR submission_channel IN('iTax portal','Email','Hand delivery','Courier','Other')),
 submission_reference text CHECK(submission_reference IS NULL OR char_length(btrim(submission_reference)) BETWEEN 3 AND 200),
 ack_document_id uuid REFERENCES erp_private.documents,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1
);
CREATE INDEX kra_progress_changed_by_idx ON erp_private.kra_case_progress(stage_changed_by) WHERE stage_changed_by IS NOT NULL;
CREATE INDEX kra_progress_ack_idx ON erp_private.kra_case_progress(ack_document_id) WHERE ack_document_id IS NOT NULL;
CREATE INDEX kra_progress_stage_idx ON erp_private.kra_case_progress(stage);
INSERT INTO erp_private.kra_case_progress(case_id,stage,submitted_at)
 SELECT c.case_id,CASE c.status WHEN 'Responded' THEN 'Submitted to KRA' WHEN 'Closed' THEN 'Resolved' ELSE 'Received' END,
        CASE WHEN c.responded_on IS NOT NULL THEN c.responded_on::timestamptz ELSE NULL END
 FROM erp_private.kra_cases c;

CREATE TABLE erp_private.kra_case_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.kra_cases,
 kind text NOT NULL CHECK(kind IN('Email','Call','Meeting','Letter','Note','Stage','Status','Submission','Document')),
 happened_at timestamptz NOT NULL DEFAULT now(),
 recorded_by uuid REFERENCES erp_private.staff_members,
 participants text CHECK(participants IS NULL OR char_length(participants)<=300),
 summary text NOT NULL CHECK(char_length(btrim(summary)) BETWEEN 3 AND 2000),
 document_id uuid REFERENCES erp_private.documents,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX kra_events_case_idx ON erp_private.kra_case_events(case_id,happened_at);
CREATE INDEX kra_events_by_idx ON erp_private.kra_case_events(recorded_by) WHERE recorded_by IS NOT NULL;
CREATE INDEX kra_events_doc_idx ON erp_private.kra_case_events(document_id) WHERE document_id IS NOT NULL;

-- Settings: the Partner alert and its severity. Both are defaults until a Partner confirms them.
INSERT INTO erp_private.kra_check_settings(setting_key,label,int_value,text_value) VALUES
 ('escalation_days','Flag E (Partner alert): an open case is flagged when the deadline is within this many calendar days. This is an internal service level, not the KRA deadline',7,NULL),
 ('severity_e','Severity of flag E (HIGH, CRITICAL or MEDIUM)',NULL,'HIGH');
ALTER TABLE erp_private.kra_compliance_flags DROP CONSTRAINT kra_compliance_flags_flag_code_check;
ALTER TABLE erp_private.kra_compliance_flags ADD CONSTRAINT kra_compliance_flags_flag_code_check CHECK(flag_code IN('A','B','C','D','E'));

-- A progress row for every new case.
CREATE FUNCTION erp_private.kra_progress_init() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 INSERT INTO erp_private.kra_case_progress(case_id) VALUES(NEW.case_id) ON CONFLICT DO NOTHING;
 INSERT INTO erp_private.kra_case_events(case_id,kind,recorded_by,summary) VALUES(NEW.case_id,'Status',NEW.logged_by,'Notice logged (stage: Received)');
 RETURN NULL;
END $$;
CREATE TRIGGER kra_progress_init AFTER INSERT ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.kra_progress_init();

-- Submitting needs the requested documents in, and the submission details.
CREATE FUNCTION erp_private.kra_submission_gate() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_missing text;v_n integer;p erp_private.kra_case_progress;
BEGIN
 IF OLD.status='Open' AND NEW.status='Responded' AND (erp_private.actor()).staff_id IS NOT NULL THEN
  SELECT count(*),string_agg(r.description,'; ' ORDER BY r.created_at) INTO v_n,v_missing FROM erp_private.kra_case_requests r WHERE r.case_id=NEW.case_id AND r.status='MISSING';
  IF v_n>0 THEN RAISE EXCEPTION '% requested document(s) are still missing (%). Attach them, or have a Manager or Partner mark them not applicable with a reason, before submitting to KRA.',v_n,left(v_missing,300) USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM erp_private.kra_case_progress WHERE case_id=NEW.case_id;
  IF NOT FOUND OR p.submitted_at IS NULL OR p.submission_channel IS NULL OR p.submission_reference IS NULL THEN
   RAISE EXCEPTION 'Record the submission date and time, the channel and the KRA reference before the case is marked as submitted.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kra_submission_gate BEFORE UPDATE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.kra_submission_gate();

-- The stage follows the status. These are written by the system, never typed.
CREATE FUNCTION erp_private.kra_progress_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_stage text;v_text text;p erp_private.kra_case_progress;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
 PERFORM set_config('kra.progress_sync','1',true);
 IF NEW.status='Responded' THEN
  SELECT * INTO p FROM erp_private.kra_case_progress WHERE case_id=NEW.case_id;
  v_stage:='Submitted to KRA';
  v_text:='Submitted to KRA'||COALESCE(' by '||p.submission_channel,'')||COALESCE(', reference '||p.submission_reference,'');
 ELSIF NEW.status='Open' THEN v_stage:='In progress';v_text:='Returned to open: '||COALESCE(NEW.return_note,'');
 ELSIF NEW.status='Closed' THEN v_stage:='Resolved';v_text:='Approved and closed by a Partner';
 ELSE v_stage:=NULL;v_text:='Cancelled: '||COALESCE(NEW.close_note,''); END IF;
 IF v_stage IS NOT NULL THEN
  UPDATE erp_private.kra_case_progress SET stage=v_stage,stage_changed_at=now(),stage_changed_by=(erp_private.actor()).staff_id WHERE case_id=NEW.case_id;
 END IF;
 INSERT INTO erp_private.kra_case_events(case_id,kind,recorded_by,summary) VALUES(NEW.case_id,CASE WHEN NEW.status='Responded' THEN 'Submission' ELSE 'Status' END,(erp_private.actor()).staff_id,left(v_text,2000));
 PERFORM set_config('kra.progress_sync','',true);
 RETURN NULL;
END $$;
CREATE TRIGGER kra_progress_sync AFTER UPDATE OF status ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.kra_progress_sync();

-- Who may set which stage, and what may be edited.
CREATE FUNCTION erp_private.kra_progress_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_status text;v_client uuid;v_leader boolean;
BEGIN
 IF NEW.case_id IS DISTINCT FROM OLD.case_id THEN RAISE EXCEPTION 'The case of a progress record cannot change' USING ERRCODE='23514'; END IF;
 IF COALESCE(current_setting('kra.progress_sync',true),'')='1' THEN RETURN NEW; END IF;
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;v_leader:=v_cat IN('PARTNER','MANAGER');
 IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Your account cannot change a KRA case' USING ERRCODE='42501'; END IF;
 SELECT c.status,c.client_id INTO v_status,v_client FROM erp_private.kra_cases c WHERE c.case_id=NEW.case_id;
 IF v_status IN('Closed','Cancelled') THEN RAISE EXCEPTION 'This case is %; it can no longer change',lower(v_status) USING ERRCODE='23514'; END IF;
 IF NEW.stage IS DISTINCT FROM OLD.stage THEN
  IF v_actor IS NOT NULL THEN
   IF v_status='Open' AND NEW.stage NOT IN('Received','Triage','In progress','Internal review','Approved to send') THEN RAISE EXCEPTION 'An open case cannot be given the stage "%": submitting it to KRA does that',NEW.stage USING ERRCODE='23514'; END IF;
   IF v_status='Responded' AND NEW.stage NOT IN('Awaiting KRA','Further information requested','Dispute or appeal','Resolved') THEN RAISE EXCEPTION 'A submitted case cannot be given the stage "%"',NEW.stage USING ERRCODE='23514'; END IF;
   IF NEW.stage IN('Approved to send','Resolved') AND NOT v_leader THEN RAISE EXCEPTION 'Only a Manager or Partner can set the stage "%"',NEW.stage USING ERRCODE='42501'; END IF;
  END IF;
  NEW.stage_changed_at:=now();NEW.stage_changed_by:=COALESCE(v_actor,NEW.stage_changed_by);
 END IF;
 IF ROW(NEW.submitted_at,NEW.submission_channel,NEW.submission_reference,NEW.ack_document_id) IS DISTINCT FROM ROW(OLD.submitted_at,OLD.submission_channel,OLD.submission_reference,OLD.ack_document_id) THEN
  IF v_status='Responded' AND v_actor IS NOT NULL AND NOT v_leader AND ROW(NEW.submitted_at,NEW.submission_channel,NEW.submission_reference) IS DISTINCT FROM ROW(OLD.submitted_at,OLD.submission_channel,OLD.submission_reference) THEN
   RAISE EXCEPTION 'Only a Manager or Partner can correct the submission details after the case was submitted' USING ERRCODE='42501'; END IF;
  IF NEW.submitted_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'The submission time cannot be in the future' USING ERRCODE='23514'; END IF;
  IF NEW.ack_document_id IS NOT NULL AND NEW.ack_document_id IS DISTINCT FROM OLD.ack_document_id AND NOT erp_private.kra_document_ok(NEW.ack_document_id,v_client) THEN
   RAISE EXCEPTION 'The acknowledgment must be a document filed for this client' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kra_progress_guard BEFORE UPDATE ON erp_private.kra_case_progress FOR EACH ROW EXECUTE FUNCTION erp_private.kra_progress_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.kra_case_progress FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.kra_case_progress FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.kra_case_progress FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('case_id');

-- A stage change, or an acknowledgment, goes on the timeline.
CREATE FUNCTION erp_private.kra_progress_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.stage IS DISTINCT FROM OLD.stage AND COALESCE(current_setting('kra.progress_sync',true),'')<>'1' THEN
  INSERT INTO erp_private.kra_case_events(case_id,kind,recorded_by,summary) VALUES(NEW.case_id,'Stage',(erp_private.actor()).staff_id,'Stage: '||OLD.stage||' to '||NEW.stage);
 END IF;
 IF NEW.ack_document_id IS DISTINCT FROM OLD.ack_document_id AND NEW.ack_document_id IS NOT NULL THEN
  INSERT INTO erp_private.kra_case_events(case_id,kind,recorded_by,summary,document_id) VALUES(NEW.case_id,'Document',(erp_private.actor()).staff_id,'KRA acknowledgment saved',NEW.ack_document_id);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER kra_progress_event AFTER UPDATE ON erp_private.kra_case_progress FOR EACH ROW EXECUTE FUNCTION erp_private.kra_progress_event();

-- Documents received or marked not applicable go on the timeline.
CREATE FUNCTION erp_private.kra_request_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NEW.status IS DISTINCT FROM OLD.status THEN
  INSERT INTO erp_private.kra_case_events(case_id,kind,recorded_by,summary,document_id) VALUES(NEW.case_id,'Document',(erp_private.actor()).staff_id,
   left(CASE NEW.status WHEN 'RECEIVED' THEN 'Document received: ' WHEN 'NOT_APPLICABLE' THEN 'Marked not applicable: ' ELSE 'Document needed again: ' END||NEW.description,2000),NEW.document_id);
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER kra_request_event AFTER UPDATE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.kra_request_event();

-- The communications log: staff add emails, calls, meetings, letters and notes. The system adds the rest. Entries are never changed or removed.
CREATE FUNCTION erp_private.kra_event_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;c erp_private.kra_cases;
BEGIN
 IF TG_OP IN('UPDATE','DELETE') THEN RAISE EXCEPTION 'The case timeline is only added to; an entry cannot be changed or removed.' USING ERRCODE='23514'; END IF;
 IF pg_trigger_depth()>=2 THEN RETURN NEW; END IF;
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF v_actor IS NULL OR v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Your account cannot add to a KRA case' USING ERRCODE='42501'; END IF;
 IF NEW.kind NOT IN('Email','Call','Meeting','Letter','Note') THEN RAISE EXCEPTION 'Staff add emails, calls, meetings, letters and notes; the system adds the other entries.' USING ERRCODE='23514'; END IF;
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=NEW.case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That KRA case is unavailable.' USING ERRCODE='23514'; END IF;
 IF c.status IN('Closed','Cancelled') THEN RAISE EXCEPTION 'This case is %; it can no longer change',lower(c.status) USING ERRCODE='23514'; END IF;
 IF NEW.document_id IS NOT NULL AND NOT erp_private.kra_document_ok(NEW.document_id,c.client_id) THEN RAISE EXCEPTION 'The attachment must be a document filed for this client' USING ERRCODE='23514'; END IF;
 IF NEW.happened_at>now()+interval '5 minutes' THEN RAISE EXCEPTION 'The time of the contact cannot be in the future' USING ERRCODE='23514'; END IF;
 NEW.recorded_by:=v_actor;NEW.created_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER kra_event_guard BEFORE INSERT OR UPDATE OR DELETE ON erp_private.kra_case_events FOR EACH ROW EXECUTE FUNCTION erp_private.kra_event_guard();

-- Flag E joins the checks. The two functions below replace the Step 7 versions; only flag E and its action text are new.
CREATE OR REPLACE FUNCTION erp_private.kra_flag_check(p_case uuid,p_code text,p_today date) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c erp_private.kra_cases;d integer;n integer;v_basis text;v_from date;
BEGIN
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=p_case;
 IF NOT FOUND OR c.status NOT IN('Open','Responded') THEN RETURN NULL; END IF;
 d:=c.deadline_date-p_today;
 IF p_code='A' THEN
  IF EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=c.project_id AND p.deleted_at IS NULL) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.projects p JOIN erp_private.project_work_periods w ON w.project_id=p.project_id
     WHERE p.client_id=c.client_id AND p.tax_master AND p.deleted_at IS NULL AND w.starts_on<=c.period_end AND w.ends_on>=c.period_start) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.ledger_periods l WHERE l.client_id=c.client_id AND l.starts_on<=c.period_end AND l.ends_on>=c.period_start) THEN RETURN NULL; END IF;
  RETURN 'No tax project or accounting year is linked to this notice for '||to_char(c.period_start,'DD Mon YYYY')||' to '||to_char(c.period_end,'DD Mon YYYY')||'.';
 ELSIF p_code='B' THEN
  IF c.status<>'Open' OR d>erp_private.kra_int('flag_b_days') THEN RETURN NULL; END IF;
  RETURN CASE WHEN d<0 THEN 'The deadline passed '||(-d)||' day(s) ago and the case is still open.'
   WHEN d=0 THEN 'The deadline is today and the case is still open.' ELSE 'The deadline is in '||d||' day(s) and the case is still open.' END;
 ELSIF p_code='C' THEN
  IF c.status<>'Open' OR d>erp_private.kra_int('flag_c_days') THEN RETURN NULL; END IF;
  SELECT count(*) INTO n FROM erp_private.kra_case_requests r WHERE r.case_id=c.case_id AND r.status='MISSING';
  IF n=0 THEN RETURN NULL; END IF;
  RETURN n||' requested document(s) are still missing with '||CASE WHEN d<0 THEN 'the deadline passed '||(-d)||' day(s) ago.' WHEN d=0 THEN 'the deadline today.' ELSE 'the deadline in '||d||' day(s).' END;
 ELSIF p_code='D' THEN
  IF c.status<>'Responded' THEN RETURN NULL; END IF;
  v_basis:=erp_private.kra_txt('flag_d_basis');
  v_from:=CASE WHEN v_basis='deadline' THEN c.deadline_date ELSE c.responded_on END;
  n:=p_today-v_from;
  IF n<erp_private.kra_int('flag_d_days') THEN RETURN NULL; END IF;
  RETURN 'The case was responded to but no Partner has approved and closed it, '||n||' day(s) after '||CASE WHEN v_basis='deadline' THEN 'the KRA deadline.' ELSE 'the response.' END;
 ELSIF p_code='E' THEN
  IF c.status<>'Open' OR d>erp_private.kra_int('escalation_days') THEN RETURN NULL; END IF;
  RETURN CASE WHEN d<0 THEN 'The deadline passed '||(-d)||' day(s) ago and the case has not been submitted to KRA.'
   WHEN d=0 THEN 'The deadline is today and the case has not been submitted to KRA.' ELSE 'The deadline is in '||d||' day(s) and the case has not been submitted to KRA.' END
   ||CASE WHEN c.task_owner_id IS NULL THEN ' No one is assigned to it.' ELSE '' END;
 END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION erp_private.kra_sync_flags(p_case uuid,p_today date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_today date;v_actor uuid;v_code text;v_detail text;f erp_private.kra_compliance_flags;c erp_private.kra_cases;v_action text;v_new uuid;v_raised integer:=0;r record;v_name text;
BEGIN
 v_today:=COALESCE(p_today,(now() AT TIME ZONE 'Africa/Nairobi')::date);
 v_actor:=(erp_private.actor()).staff_id;
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=p_case;
 IF NOT FOUND THEN RETURN 0; END IF;
 SELECT company_name INTO v_name FROM erp_private.clients WHERE client_id=c.client_id;
 FOREACH v_code IN ARRAY ARRAY['A','B','C','D','E'] LOOP
  v_detail:=erp_private.kra_flag_check(p_case,v_code,v_today);
  SELECT * INTO f FROM erp_private.kra_compliance_flags WHERE case_id=p_case AND flag_code=v_code AND status='Open';
  IF v_detail IS NULL THEN
   IF FOUND THEN
    UPDATE erp_private.kra_compliance_flags SET status='Resolved',resolved_at=now(),resolved_by=v_actor,resolved_how=CASE WHEN v_actor IS NULL THEN 'Nightly check' ELSE 'Action taken' END WHERE flag_id=f.flag_id;
   END IF;
  ELSIF NOT FOUND THEN
   v_action:=CASE v_code
    WHEN 'A' THEN 'Create the project from the KRA template and link it to this case, or link the tax project or accounting year for this period.'
    WHEN 'B' THEN 'Mark the case as responded once the response is sent, or have a Manager or Partner correct the deadline if KRA extended it.'
    WHEN 'C' THEN 'Attach the missing document to the request, or have a Manager or Partner mark it not applicable with a reason.'
    WHEN 'E' THEN 'Tax Lead or Partner: check that the case has an owner and will be submitted to KRA before the deadline. This is an internal alert, separate from the KRA deadline.'
    ELSE 'A Partner approves and closes the case.' END;
   INSERT INTO erp_private.kra_compliance_flags(case_id,flag_code,severity,detail,action_needed,raised_on)
    VALUES(p_case,v_code,erp_private.kra_txt('severity_'||lower(v_code)),v_detail,v_action,v_today) RETURNING flag_id INTO v_new;
   v_raised:=v_raised+1;
   FOR r IN SELECT m.staff_id FROM erp_private.staff_members m WHERE m.deleted_at IS NULL AND m.access_status='Active' AND (m.category_code='PARTNER' OR (v_code<>'D' AND m.staff_id=c.task_owner_id)) LOOP
    INSERT INTO erp_private.notifications(recipient_id,message,event_key)
     VALUES(r.staff_id,left('KRA notice '||c.notice_reference||' for '||COALESCE(v_name,'a client')||' (flag '||v_code||'): '||v_detail,300),'kra-flag:'||v_new||':'||r.staff_id) ON CONFLICT DO NOTHING;
   END LOOP;
  END IF;
 END LOOP;
 RETURN v_raised;
END $$;

ALTER TABLE erp_private.kra_case_progress ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.kra_case_progress FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.kra_case_events ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.kra_case_events FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.kra_case_progress TO erp_api;
GRANT UPDATE(stage,submitted_at,submission_channel,submission_reference,ack_document_id) ON erp_private.kra_case_progress TO erp_api;
GRANT SELECT,INSERT ON erp_private.kra_case_events TO erp_api;
CREATE POLICY kra_progress_read ON erp_private.kra_case_progress FOR SELECT TO erp_api USING(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_progress_update ON erp_private.kra_case_progress FOR UPDATE TO erp_api USING(erp_private.kra_case_allowed(case_id)) WITH CHECK(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_events_read ON erp_private.kra_case_events FOR SELECT TO erp_api USING(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_events_insert ON erp_private.kra_case_events FOR INSERT TO erp_api WITH CHECK(erp_private.kra_case_allowed(case_id));

-- The KPI cards: counts over the cases the signed-in person may see.
CREATE FUNCTION erp_private.kra_dashboard() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH base AS (SELECT c.case_id,c.status,c.deadline_date,c.task_owner_id,p.stage,
   (c.deadline_date-(now() AT TIME ZONE 'Africa/Nairobi')::date) AS d,
   EXISTS(SELECT 1 FROM erp_private.kra_case_requests r WHERE r.case_id=c.case_id AND r.status='MISSING') AS missing_docs
  FROM erp_private.kra_cases c JOIN erp_private.kra_case_progress p ON p.case_id=c.case_id WHERE erp_private.kra_case_allowed(c.case_id))
 SELECT jsonb_build_object(
  'overdue',count(*) FILTER(WHERE status='Open' AND d<0),
  'due_soon',count(*) FILTER(WHERE status='Open' AND d BETWEEN 0 AND erp_private.kra_int('escalation_days')),
  'unassigned',count(*) FILTER(WHERE status IN('Open','Responded') AND task_owner_id IS NULL),
  'missing_documents',count(*) FILTER(WHERE status='Open' AND missing_docs),
  'awaiting_kra',count(*) FILTER(WHERE status='Responded' AND stage IN('Submitted to KRA','Awaiting KRA','Further information requested','Dispute or appeal')),
  'open',count(*) FILTER(WHERE status='Open'),
  'escalation_days',erp_private.kra_int('escalation_days'))
 FROM base
$$;
REVOKE ALL ON FUNCTION erp_private.kra_progress_init(),erp_private.kra_submission_gate(),erp_private.kra_progress_sync(),erp_private.kra_progress_guard(),erp_private.kra_progress_event(),erp_private.kra_request_event(),erp_private.kra_event_guard(),erp_private.kra_dashboard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.kra_progress_init(),erp_private.kra_submission_gate(),erp_private.kra_progress_sync(),erp_private.kra_progress_guard(),erp_private.kra_progress_event(),erp_private.kra_request_event(),erp_private.kra_event_guard(),erp_private.kra_dashboard() TO erp_api;
