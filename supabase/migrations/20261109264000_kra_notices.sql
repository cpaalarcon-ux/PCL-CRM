-- Step 7 of the joined-practice review (2026-11-09): the KRA notice log, the verification task and the non-compliance flags.
--
-- How it works:
--  * LOG: staff record each KRA notice (reference, type, tax head, period, dates, deadline, summary, a copy of the notice) against a client.
--    The system does NOT create the KRA project. Staff create it by hand from the AUP/KRA template and link it to the notice.
--  * TASK: logging a notice creates one verification task ("verify the notice and tell the client"). It goes to the Manager who owns the
--    client's tax project, otherwise to the client owner, and can then be reassigned in the normal way. It is due 7 calendar days before
--    the deadline. If the notice gave fewer than 7 days, it is due 2 calendar days before the deadline and is marked URGENT.
--    Task rows need a project. The task goes on the linked project, otherwise on the client's tax project. If the client has neither, no task
--    can exist yet: the owner (or the Partners) get a bell notification and flag A stays raised until a project is linked.
--  * DOCUMENT REQUESTS: the documents the notice asks for are listed on the case. Each is MISSING, RECEIVED (with a client document attached)
--    or NOT_APPLICABLE (with a reason a Manager or Partner gives).
--  * FLAGS: four non-compliance flags. A: no tax project or accounting year for the period. B: open case with the deadline within 3 days.
--    C: a requested document still MISSING with the deadline within 2 days. D: responded but not approved and closed after 14 days.
--    A flag cannot be dismissed. It clears only when the action it asks for is done (link the project, respond, attach the document,
--    approve and close). The checks run every night and also straight after each change to a case or a request.
--  * A Partner approves and closes a responded case. Cases are never deleted.
-- The numbers, the severities, the owner rule and the reading of flag D are defaults from the Tax Lead's notes and a suggestion. Each is a
-- setting a Partner can change and mark as confirmed. None is confirmed yet.

-- 1. Settings.
CREATE TABLE erp_private.kra_check_settings(
 setting_key text PRIMARY KEY,
 label text NOT NULL,
 int_value integer,
 text_value text,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed')),
 source_note text,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 updated_by uuid REFERENCES erp_private.staff_members,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((int_value IS NULL)<>(text_value IS NULL)),
 CHECK(rule_status='Suggested' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(COALESCE(source_note,'')))>=10)),
 CHECK(rule_status<>'Suggested' OR (confirmed_by IS NULL AND confirmed_at IS NULL))
);
CREATE INDEX kra_settings_confirmed_by_idx ON erp_private.kra_check_settings(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX kra_settings_updated_by_idx ON erp_private.kra_check_settings(updated_by) WHERE updated_by IS NOT NULL;
INSERT INTO erp_private.kra_check_settings(setting_key,label,int_value,text_value) VALUES
 ('task_lead_days','The verification task is due this many calendar days before the deadline',7,NULL),
 ('urgent_below_days','A notice that gives fewer than this many calendar days is urgent',7,NULL),
 ('urgent_task_lead_days','An urgent task is due this many calendar days before the deadline',2,NULL),
 ('flag_b_days','Flag B: an open case is flagged when the deadline is within this many calendar days',3,NULL),
 ('flag_c_days','Flag C: a requested document is flagged when it is still missing and the deadline is within this many calendar days',2,NULL),
 ('flag_d_days','Flag D: a responded case is flagged when it is not approved and closed after this many calendar days',14,NULL),
 ('flag_d_basis','Flag D counts the days from the date of the response (response) or from the KRA deadline (deadline)',NULL,'response'),
 ('severity_a','Severity of flag A (HIGH, CRITICAL or MEDIUM)',NULL,'HIGH'),
 ('severity_b','Severity of flag B (HIGH, CRITICAL or MEDIUM)',NULL,'CRITICAL'),
 ('severity_c','Severity of flag C (HIGH, CRITICAL or MEDIUM)',NULL,'CRITICAL'),
 ('severity_d','Severity of flag D (HIGH, CRITICAL or MEDIUM)',NULL,'MEDIUM');
ALTER TABLE erp_private.kra_check_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.kra_check_settings FORCE ROW LEVEL SECURITY;
GRANT SELECT,UPDATE ON erp_private.kra_check_settings TO erp_api;
CREATE POLICY kra_settings_read ON erp_private.kra_check_settings FOR SELECT TO erp_api USING(true);
CREATE POLICY kra_settings_update ON erp_private.kra_check_settings FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');

CREATE FUNCTION erp_private.kra_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_changed boolean;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF ROW(NEW.setting_key,NEW.label) IS DISTINCT FROM ROW(OLD.setting_key,OLD.label) THEN RAISE EXCEPTION 'A setting cannot be renamed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can change or confirm a KRA check setting' USING ERRCODE='42501'; END IF;
 IF (NEW.int_value IS NULL)<>(OLD.int_value IS NULL) THEN RAISE EXCEPTION 'This setting holds %', CASE WHEN OLD.int_value IS NULL THEN 'text' ELSE 'a number' END USING ERRCODE='23514'; END IF;
 v_changed:=NEW.int_value IS DISTINCT FROM OLD.int_value OR NEW.text_value IS DISTINCT FROM OLD.text_value;
 IF v_changed THEN
  IF NEW.int_value IS NOT NULL AND (NEW.int_value<1 OR NEW.int_value>90) THEN RAISE EXCEPTION 'Use a number of days from 1 to 90' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key='flag_d_basis' AND NEW.text_value NOT IN('response','deadline') THEN RAISE EXCEPTION 'Flag D counts from the response or the deadline' USING ERRCODE='23514'; END IF;
  IF NEW.setting_key LIKE 'severity\_%' AND NEW.text_value NOT IN('HIGH','CRITICAL','MEDIUM') THEN RAISE EXCEPTION 'Severity is HIGH, CRITICAL or MEDIUM' USING ERRCODE='23514'; END IF;
  IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'Change the value first; a Partner then records the confirmation' USING ERRCODE='23514'; END IF;
  NEW.rule_status:='Suggested';NEW.confirmed_by:=NULL;NEW.confirmed_at:=NULL;NEW.source_note:=NULL;NEW.updated_by:=v_actor;
 ELSIF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF NEW.rule_status<>'Confirmed' THEN RAISE EXCEPTION 'A confirmation is withdrawn by changing the value' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.source_note,'')))<10 THEN RAISE EXCEPTION 'Say who confirmed this and where it is written (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.confirmed_at:=now();NEW.updated_by:=v_actor;
 ELSIF ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be edited' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kra_guard BEFORE UPDATE ON erp_private.kra_check_settings FOR EACH ROW EXECUTE FUNCTION erp_private.kra_settings_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.kra_check_settings FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.kra_check_settings FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.kra_check_settings FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('setting_key');

CREATE FUNCTION erp_private.kra_int(p_key text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT int_value FROM erp_private.kra_check_settings WHERE setting_key=p_key
$$;
CREATE FUNCTION erp_private.kra_txt(p_key text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT text_value FROM erp_private.kra_check_settings WHERE setting_key=p_key
$$;

-- 2. The notice log.
CREATE TABLE erp_private.kra_cases(
 case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 notice_reference text NOT NULL CHECK(length(btrim(notice_reference))>=3),
 notice_type text NOT NULL CHECK(notice_type IN('Audit notice','Assessment','Demand','Objection decision','Other')),
 tax_head text NOT NULL CHECK(tax_head IN('Income tax','VAT','PAYE','Withholding tax','Excise','Other')),
 period_start date NOT NULL,
 period_end date NOT NULL,
 notice_date date NOT NULL,
 received_on date NOT NULL,
 deadline_date date NOT NULL,
 summary text NOT NULL CHECK(length(btrim(summary))>=10),
 notice_document_id uuid REFERENCES erp_private.documents,
 project_id uuid REFERENCES erp_private.projects,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Responded','Closed','Cancelled')),
 responded_on date,
 responded_by uuid REFERENCES erp_private.staff_members,
 return_note text,
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 close_note text,
 verification_task_id uuid REFERENCES erp_private.tasks,
 task_owner_id uuid REFERENCES erp_private.staff_members,
 task_due_on date,
 task_urgent boolean NOT NULL DEFAULT false,
 task_basis text,
 logged_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(period_end>=period_start),
 CHECK(deadline_date>=notice_date),
 CHECK(status<>'Open' OR (responded_on IS NULL AND responded_by IS NULL)),
 CHECK(status<>'Responded' OR (responded_on IS NOT NULL AND responded_by IS NOT NULL)),
 CHECK(status<>'Closed' OR (responded_on IS NOT NULL AND closed_by IS NOT NULL AND closed_at IS NOT NULL)),
 CHECK(status<>'Cancelled' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND length(btrim(COALESCE(close_note,'')))>=10)),
 CHECK(status IN('Closed','Cancelled') OR (closed_by IS NULL AND closed_at IS NULL)),
 CHECK(return_note IS NULL OR length(btrim(return_note))>=10),
 CHECK(verification_task_id IS NULL OR (task_owner_id IS NOT NULL AND task_due_on IS NOT NULL AND task_basis IS NOT NULL))
);
CREATE UNIQUE INDEX kra_cases_ref_unique ON erp_private.kra_cases(client_id,lower(btrim(notice_reference))) WHERE status<>'Cancelled';
CREATE INDEX kra_cases_deadline_idx ON erp_private.kra_cases(deadline_date) WHERE status IN('Open','Responded');
CREATE INDEX kra_cases_firm_idx ON erp_private.kra_cases(handling_firm_id);
CREATE INDEX kra_cases_logged_by_idx ON erp_private.kra_cases(logged_by);
CREATE INDEX kra_cases_project_idx ON erp_private.kra_cases(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX kra_cases_document_idx ON erp_private.kra_cases(notice_document_id) WHERE notice_document_id IS NOT NULL;
CREATE INDEX kra_cases_task_idx ON erp_private.kra_cases(verification_task_id) WHERE verification_task_id IS NOT NULL;
CREATE INDEX kra_cases_task_owner_idx ON erp_private.kra_cases(task_owner_id) WHERE task_owner_id IS NOT NULL;
CREATE INDEX kra_cases_responded_by_idx ON erp_private.kra_cases(responded_by) WHERE responded_by IS NOT NULL;
CREATE INDEX kra_cases_closed_by_idx ON erp_private.kra_cases(closed_by) WHERE closed_by IS NOT NULL;

-- 3. Documents the notice asks for.
CREATE TABLE erp_private.kra_case_requests(
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.kra_cases,
 description text NOT NULL CHECK(length(btrim(description))>=5),
 needed_by date,
 status text NOT NULL DEFAULT 'MISSING' CHECK(status IN('MISSING','RECEIVED','NOT_APPLICABLE')),
 document_id uuid REFERENCES erp_private.documents,
 received_on date,
 received_by uuid REFERENCES erp_private.staff_members,
 na_reason text,
 na_by uuid REFERENCES erp_private.staff_members,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='RECEIVED')=(document_id IS NOT NULL)),
 CHECK(status<>'RECEIVED' OR (received_on IS NOT NULL AND received_by IS NOT NULL)),
 CHECK(status='RECEIVED' OR (received_on IS NULL AND received_by IS NULL)),
 CHECK((status='NOT_APPLICABLE')=(na_reason IS NOT NULL AND na_by IS NOT NULL)),
 CHECK(na_reason IS NULL OR length(btrim(na_reason))>=10)
);
CREATE INDEX kra_requests_case_idx ON erp_private.kra_case_requests(case_id,status);
CREATE INDEX kra_requests_document_idx ON erp_private.kra_case_requests(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX kra_requests_created_by_idx ON erp_private.kra_case_requests(created_by);
CREATE INDEX kra_requests_received_by_idx ON erp_private.kra_case_requests(received_by) WHERE received_by IS NOT NULL;
CREATE INDEX kra_requests_na_by_idx ON erp_private.kra_case_requests(na_by) WHERE na_by IS NOT NULL;

-- 4. Non-compliance flags. Written only by the checks below; staff cannot insert, edit or dismiss a flag.
CREATE TABLE erp_private.kra_compliance_flags(
 flag_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES erp_private.kra_cases,
 flag_code text NOT NULL CHECK(flag_code IN('A','B','C','D')),
 severity text NOT NULL CHECK(severity IN('CRITICAL','HIGH','MEDIUM')),
 detail text NOT NULL,
 action_needed text NOT NULL,
 raised_on date NOT NULL,
 status text NOT NULL DEFAULT 'Open' CHECK(status IN('Open','Resolved')),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES erp_private.staff_members,
 resolved_how text CHECK(resolved_how IN('Action taken','Nightly check')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Open')=(resolved_at IS NULL)),
 CHECK((status='Open')=(resolved_how IS NULL)),
 CHECK(resolved_by IS NULL OR status='Resolved')
);
CREATE UNIQUE INDEX kra_flags_one_open ON erp_private.kra_compliance_flags(case_id,flag_code) WHERE status='Open';
CREATE INDEX kra_flags_open_idx ON erp_private.kra_compliance_flags(severity,raised_on) WHERE status='Open';
CREATE INDEX kra_flags_resolved_by_idx ON erp_private.kra_compliance_flags(resolved_by) WHERE resolved_by IS NOT NULL;

-- Helpers read by the policies and triggers.
CREATE FUNCTION erp_private.kra_case_allowed(p_case uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT erp_private.client_allowed(c.client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
  FROM erp_private.kra_cases c WHERE c.case_id=p_case),false)
$$;
-- Is this a current document filed for this client? Definer rights: document row security hides files from staff who did not upload them.
CREATE FUNCTION erp_private.kra_document_ok(p_document uuid,p_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=p_document AND d.client_id=p_client AND d.deleted_at IS NULL AND d.archived_at IS NULL AND d.category<>'KYC Pending')
$$;
CREATE FUNCTION erp_private.kra_client_documents(p_client uuid) RETURNS TABLE(document_id uuid,file_name text,category text,uploaded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT d.document_id,d.file_name,d.category,d.uploaded_at FROM erp_private.documents d
 WHERE d.client_id=p_client AND d.deleted_at IS NULL AND d.archived_at IS NULL AND d.category<>'KYC Pending'
  AND erp_private.client_allowed(p_client) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')
 ORDER BY d.uploaded_at DESC LIMIT 200
$$;

-- Does this firm handle this client? Definer rights: the link table is hidden from some staff.
CREATE FUNCTION erp_private.kra_firm_handles(p_client uuid,p_firm uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=p_client AND l.firm_id=p_firm)
$$;

-- When must the verification task be done, and is the notice urgent? Counted in calendar days.
CREATE FUNCTION erp_private.kra_task_plan(p_received date,p_deadline date,p_today date) RETURNS TABLE(due_on date,urgent boolean,days_given integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT GREATEST(p_deadline-(CASE WHEN (p_deadline-p_received)<erp_private.kra_int('urgent_below_days') THEN erp_private.kra_int('urgent_task_lead_days') ELSE erp_private.kra_int('task_lead_days') END),p_today),
  (p_deadline-p_received)<erp_private.kra_int('urgent_below_days'),(p_deadline-p_received)
$$;

-- Guard: the case.
CREATE FUNCTION erp_private.kra_case_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_today date;v_sys boolean;v_leader boolean;
 v_task_cols text[]:=ARRAY['verification_task_id','task_owner_id','task_due_on','task_urgent','task_basis','updated_at','revision'];
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 v_sys:=current_user<>'erp_api' AND COALESCE(current_setting('kra.system',true),'')='1';
 v_leader:=v_cat IN('PARTNER','MANAGER');
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL THEN
   IF v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Only a Partner, Manager, Supervisor or Assistant can log a KRA notice' USING ERRCODE='42501'; END IF;
   IF NEW.logged_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person logging the notice must be the signed-in user' USING ERRCODE='42501'; END IF;
  END IF;
  NEW.received_on:=COALESCE(NEW.received_on,v_today);
  IF NEW.status<>'Open' THEN RAISE EXCEPTION 'A new notice starts as Open' USING ERRCODE='23514'; END IF;
  IF NEW.verification_task_id IS NOT NULL OR NEW.task_owner_id IS NOT NULL OR NEW.task_due_on IS NOT NULL OR NEW.task_urgent OR NEW.task_basis IS NOT NULL THEN
   RAISE EXCEPTION 'The verification task is created by the system' USING ERRCODE='23514'; END IF;
  IF NEW.received_on>v_today THEN RAISE EXCEPTION 'The date received cannot be in the future' USING ERRCODE='23514'; END IF;
  IF NEW.notice_date>NEW.received_on THEN RAISE EXCEPTION 'The notice date cannot be after the date received' USING ERRCODE='23514'; END IF;
  IF NOT erp_private.kra_firm_handles(NEW.client_id,NEW.handling_firm_id) THEN
   RAISE EXCEPTION 'That firm does not handle this client' USING ERRCODE='23514'; END IF;
  IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'The linked project must be a project of this client' USING ERRCODE='23514'; END IF;
  IF NEW.notice_document_id IS NOT NULL AND NOT erp_private.kra_document_ok(NEW.notice_document_id,NEW.client_id) THEN
   RAISE EXCEPTION 'The copy of the notice must be a document filed for this client' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

 IF ROW(NEW.case_id,NEW.client_id,NEW.handling_firm_id,NEW.logged_by,NEW.created_at,NEW.received_on) IS DISTINCT FROM ROW(OLD.case_id,OLD.client_id,OLD.handling_firm_id,OLD.logged_by,OLD.created_at,OLD.received_on) THEN
  RAISE EXCEPTION 'The client, firm, date received and the person who logged a notice cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('Closed','Cancelled') THEN RAISE EXCEPTION 'This case is %; it can no longer change',lower(OLD.status) USING ERRCODE='23514'; END IF;
 IF v_sys THEN
  IF (to_jsonb(NEW)-v_task_cols) IS DISTINCT FROM (to_jsonb(OLD)-v_task_cols) THEN RAISE EXCEPTION 'A system update may only set the verification task' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.verification_task_id,NEW.task_owner_id,NEW.task_due_on,NEW.task_urgent,NEW.task_basis) IS DISTINCT FROM ROW(OLD.verification_task_id,OLD.task_owner_id,OLD.task_due_on,OLD.task_urgent,OLD.task_basis) THEN
  RAISE EXCEPTION 'The verification task is managed by the system' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Your account cannot change a KRA case' USING ERRCODE='42501'; END IF;

 IF NEW.project_id IS DISTINCT FROM OLD.project_id AND NEW.project_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.client_id=NEW.client_id AND p.deleted_at IS NULL) THEN
  RAISE EXCEPTION 'The linked project must be a project of this client' USING ERRCODE='23514'; END IF;
 IF NEW.notice_document_id IS DISTINCT FROM OLD.notice_document_id AND NEW.notice_document_id IS NOT NULL AND NOT erp_private.kra_document_ok(NEW.notice_document_id,NEW.client_id) THEN
  RAISE EXCEPTION 'The copy of the notice must be a document filed for this client' USING ERRCODE='23514'; END IF;

 IF NEW.status=OLD.status THEN
  IF OLD.status='Open' THEN
   IF v_actor IS NOT NULL AND NOT v_leader AND OLD.logged_by<>v_actor THEN RAISE EXCEPTION 'Only a Manager, a Partner or the person who logged the notice can edit it' USING ERRCODE='42501'; END IF;
   IF ROW(NEW.responded_on,NEW.responded_by,NEW.closed_by,NEW.closed_at,NEW.close_note) IS DISTINCT FROM ROW(OLD.responded_on,OLD.responded_by,OLD.closed_by,OLD.closed_at,OLD.close_note) THEN
    RAISE EXCEPTION 'Use Mark as responded to record the response' USING ERRCODE='23514'; END IF;
   RETURN NEW;
  END IF;
  -- Responded: only the project link can change.
  IF ROW(NEW.notice_reference,NEW.notice_type,NEW.tax_head,NEW.period_start,NEW.period_end,NEW.notice_date,NEW.deadline_date,NEW.summary,NEW.notice_document_id,NEW.responded_on,NEW.responded_by,NEW.return_note,NEW.closed_by,NEW.closed_at,NEW.close_note)
     IS DISTINCT FROM ROW(OLD.notice_reference,OLD.notice_type,OLD.tax_head,OLD.period_start,OLD.period_end,OLD.notice_date,OLD.deadline_date,OLD.summary,OLD.notice_document_id,OLD.responded_on,OLD.responded_by,OLD.return_note,OLD.closed_by,OLD.closed_at,OLD.close_note) THEN
   RAISE EXCEPTION 'A responded case cannot be edited; a Manager or Partner can return it to Open first' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;

 -- A change of status must not also edit the notice.
 IF ROW(NEW.notice_reference,NEW.notice_type,NEW.tax_head,NEW.period_start,NEW.period_end,NEW.notice_date,NEW.deadline_date,NEW.summary,NEW.notice_document_id,NEW.project_id)
    IS DISTINCT FROM ROW(OLD.notice_reference,OLD.notice_type,OLD.tax_head,OLD.period_start,OLD.period_end,OLD.notice_date,OLD.deadline_date,OLD.summary,OLD.notice_document_id,OLD.project_id) THEN
  RAISE EXCEPTION 'Change the status and the notice details in separate steps' USING ERRCODE='23514'; END IF;
 IF OLD.status='Open' AND NEW.status='Responded' THEN
  IF NEW.responded_on IS NULL THEN RAISE EXCEPTION 'Record the date the response was sent to KRA' USING ERRCODE='23514'; END IF;
  IF NEW.responded_on>v_today OR NEW.responded_on<OLD.received_on THEN RAISE EXCEPTION 'The response date must be between the date received and today' USING ERRCODE='23514'; END IF;
  NEW.responded_by:=COALESCE(v_actor,NEW.responded_by);
 ELSIF OLD.status='Responded' AND NEW.status='Closed' THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve and close a KRA case' USING ERRCODE='42501'; END IF;
  NEW.closed_by:=COALESCE(v_actor,NEW.closed_by);NEW.closed_at:=now();
 ELSIF OLD.status='Responded' AND NEW.status='Open' THEN
  IF v_actor IS NOT NULL AND NOT v_leader THEN RAISE EXCEPTION 'Only a Manager or Partner can return a responded case to Open' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.return_note,'')))<10 THEN RAISE EXCEPTION 'Say why the case is returned to Open (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.responded_on:=NULL;NEW.responded_by:=NULL;
 ELSIF NEW.status='Cancelled' THEN
  IF v_actor IS NOT NULL AND NOT v_leader THEN RAISE EXCEPTION 'Only a Manager or Partner can cancel a case logged in error' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.close_note,'')))<10 THEN RAISE EXCEPTION 'Say why the case is cancelled (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.closed_by:=COALESCE(v_actor,NEW.closed_by);NEW.closed_at:=now();
 ELSE
  RAISE EXCEPTION 'That change of status is not allowed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Guard: the document requests.
CREATE FUNCTION erp_private.kra_request_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_case erp_private.kra_cases;v_today date;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 SELECT * INTO v_case FROM erp_private.kra_cases c WHERE c.case_id=NEW.case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'This case is not available to your account' USING ERRCODE='42501'; END IF;
 IF v_case.status<>'Open' THEN RAISE EXCEPTION 'Requests can change only while the case is open' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Your account cannot change a KRA case' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND NEW.created_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person adding the request must be the signed-in user' USING ERRCODE='42501'; END IF;
  IF NEW.status<>'MISSING' THEN RAISE EXCEPTION 'A new request starts as missing' USING ERRCODE='23514'; END IF;
  NEW.needed_by:=COALESCE(NEW.needed_by,v_case.deadline_date);
  RETURN NEW;
 END IF;
 IF ROW(NEW.request_id,NEW.case_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.request_id,OLD.case_id,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'The case and creator of a request cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.status=OLD.status THEN
  IF OLD.status<>'MISSING' AND ROW(NEW.description,NEW.needed_by,NEW.document_id,NEW.na_reason) IS DISTINCT FROM ROW(OLD.description,OLD.needed_by,OLD.document_id,OLD.na_reason) THEN
   RAISE EXCEPTION 'Return the request to missing before changing it' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.status='MISSING' AND NEW.status='RECEIVED' THEN
  IF NEW.document_id IS NULL OR NOT erp_private.kra_document_ok(NEW.document_id,v_case.client_id) THEN
   RAISE EXCEPTION 'Attach a document filed for this client' USING ERRCODE='23514'; END IF;
  NEW.received_on:=v_today;NEW.received_by:=COALESCE(v_actor,NEW.received_by);
 ELSIF OLD.status='MISSING' AND NEW.status='NOT_APPLICABLE' THEN
  IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can mark a requested document not applicable' USING ERRCODE='42501'; END IF;
  IF length(btrim(COALESCE(NEW.na_reason,'')))<10 THEN RAISE EXCEPTION 'Say why it is not applicable (at least 10 characters)' USING ERRCODE='23514'; END IF;
  NEW.na_by:=COALESCE(v_actor,NEW.na_by);
 ELSIF NEW.status='MISSING' THEN
  NEW.document_id:=NULL;NEW.received_on:=NULL;NEW.received_by:=NULL;NEW.na_reason:=NULL;NEW.na_by:=NULL;
 ELSE
  RAISE EXCEPTION 'Return the request to missing first' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- The checks. kra_flag_check says why a flag applies to a case today, or NULL when it does not.
CREATE FUNCTION erp_private.kra_flag_check(p_case uuid,p_code text,p_today date) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
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
 END IF;
 RETURN NULL;
END $$;

-- Raise the flags that apply and clear the ones that no longer do, for one case.
CREATE FUNCTION erp_private.kra_sync_flags(p_case uuid,p_today date) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_today date;v_actor uuid;v_code text;v_detail text;f erp_private.kra_compliance_flags;c erp_private.kra_cases;v_action text;v_new uuid;v_raised integer:=0;r record;v_name text;
BEGIN
 v_today:=COALESCE(p_today,(now() AT TIME ZONE 'Africa/Nairobi')::date);
 v_actor:=(erp_private.actor()).staff_id;
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=p_case;
 IF NOT FOUND THEN RETURN 0; END IF;
 SELECT company_name INTO v_name FROM erp_private.clients WHERE client_id=c.client_id;
 FOREACH v_code IN ARRAY ARRAY['A','B','C','D'] LOOP
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

-- The verification task. Created once, as soon as the case is open and a project and an owner exist.
CREATE FUNCTION erp_private.kra_ensure_task(p_case uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c erp_private.kra_cases;v_today date;v_master uuid;v_host uuid;v_firm uuid;v_owner uuid;v_basis text;v_task uuid;v_plan record;v_name text;v_title text;r record;v_reason text;v_cat text;
BEGIN
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.status<>'Open' OR c.verification_task_id IS NOT NULL THEN RETURN c.verification_task_id; END IF;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 SELECT p.project_id INTO v_master FROM erp_private.projects p WHERE p.client_id=c.client_id AND p.handling_firm_id=c.handling_firm_id AND p.tax_master AND p.deleted_at IS NULL AND p.status<>'Archived' ORDER BY p.created_at LIMIT 1;
 SELECT p.project_id INTO v_host FROM erp_private.projects p WHERE p.project_id=c.project_id AND p.deleted_at IS NULL AND p.status<>'Archived';
 v_host:=COALESCE(v_host,v_master);
 SELECT p.handling_firm_id INTO v_firm FROM erp_private.projects p WHERE p.project_id=v_host;
 -- Owner: the Manager who owns the client's tax project, else a Manager assigned to it, else the client owner.
 -- The person must be active and have access to the firm that holds the project, because a task is assigned within a project.
 SELECT m.staff_id INTO v_owner FROM erp_private.projects p JOIN erp_private.staff_members m ON m.staff_id=p.owner_staff_id
  WHERE p.project_id=v_master AND m.category_code='MANAGER' AND m.deleted_at IS NULL AND m.access_status='Active'
   AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=m.staff_id AND f.firm_id=v_firm AND f.deleted_at IS NULL);
 v_basis:='Manager who owns the client''s tax project';
 IF v_owner IS NULL THEN
  SELECT m.staff_id INTO v_owner FROM erp_private.project_assignments a JOIN erp_private.staff_members m ON m.staff_id=a.staff_id
   WHERE a.project_id=v_master AND a.role_on_job='MANAGER' AND a.deleted_at IS NULL AND m.deleted_at IS NULL AND m.access_status='Active'
    AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=m.staff_id AND f.firm_id=v_firm AND f.deleted_at IS NULL) ORDER BY a.created_at LIMIT 1;
  v_basis:='Manager assigned to the client''s tax project';
 END IF;
 IF v_owner IS NULL THEN
  SELECT m.staff_id INTO v_owner FROM erp_private.clients cl JOIN erp_private.staff_members m ON m.staff_id=cl.owner_staff_id
   WHERE cl.client_id=c.client_id AND m.deleted_at IS NULL AND m.access_status='Active' AND m.category_code<>'INTERN'
    AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=m.staff_id AND f.firm_id=v_firm AND f.deleted_at IS NULL);
  v_basis:='Client owner';
 END IF;
 IF v_host IS NULL OR v_owner IS NULL THEN
  v_reason:=CASE WHEN v_host IS NULL THEN 'nohost' ELSE 'noowner' END;
  SELECT company_name INTO v_name FROM erp_private.clients WHERE client_id=c.client_id;
  FOR r IN SELECT m.staff_id FROM erp_private.staff_members m WHERE m.deleted_at IS NULL AND m.access_status='Active' AND m.category_code='PARTNER' LOOP
   INSERT INTO erp_private.notifications(recipient_id,message,event_key)
    VALUES(r.staff_id,left('KRA notice '||c.notice_reference||' for '||COALESCE(v_name,'a client')||': no verification task yet. '||
     CASE WHEN v_host IS NULL THEN 'The client has no project to hold it. Create the project from the KRA template and link it to the case.' ELSE 'No Manager or client owner could be found to give it to.' END,300),
     'kra-notask:'||c.case_id||':'||v_reason||':'||r.staff_id) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN NULL;
 END IF;
 SELECT category_code INTO v_cat FROM erp_private.staff_members WHERE staff_id=v_owner;
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(v_host,v_owner,v_firm,v_cat)
  ON CONFLICT(project_id,staff_id) DO UPDATE SET deleted_at=NULL;
 SELECT * INTO v_plan FROM erp_private.kra_task_plan(c.received_on,c.deadline_date,v_today);
 v_title:=(CASE WHEN v_plan.urgent THEN 'URGENT: ' ELSE '' END)||'Verify KRA notice '||c.notice_reference||' and tell the client';
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,status)
  VALUES(v_host,v_owner,left(v_title,200),
   'Check the '||c.notice_type||' ('||c.tax_head||', '||to_char(c.period_start,'DD Mon YYYY')||' to '||to_char(c.period_end,'DD Mon YYYY')||') against the client''s records, then tell the client what KRA is asking for. The response is due to KRA by '||to_char(c.deadline_date,'DD Mon YYYY')||
   CASE WHEN v_plan.urgent THEN '. The notice gave only '||v_plan.days_given||' day(s), so this task is urgent.' ELSE '.' END,
   (v_plan.due_on::text||'T17:00:00+03:00')::timestamptz,'Pending') RETURNING task_id INTO v_task;
 PERFORM set_config('kra.system','1',true);
 UPDATE erp_private.kra_cases SET verification_task_id=v_task,task_owner_id=v_owner,task_due_on=v_plan.due_on,task_urgent=v_plan.urgent,task_basis=v_basis WHERE case_id=c.case_id;
 PERFORM set_config('kra.system','',true);
 RETURN v_task;
END $$;

-- When the deadline moves, the task moves with it.
CREATE FUNCTION erp_private.kra_retime_task(p_case uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c erp_private.kra_cases;v_plan record;v_today date;v_status text;v_name text;
BEGIN
 SELECT * INTO c FROM erp_private.kra_cases WHERE case_id=p_case FOR UPDATE;
 IF NOT FOUND OR c.status<>'Open' OR c.verification_task_id IS NULL THEN RETURN; END IF;
 SELECT status,task_name INTO v_status,v_name FROM erp_private.tasks WHERE task_id=c.verification_task_id;
 IF v_status IS NULL OR v_status IN('Completed','Cancelled') THEN RETURN; END IF;
 v_today:=(now() AT TIME ZONE 'Africa/Nairobi')::date;
 SELECT * INTO v_plan FROM erp_private.kra_task_plan(c.received_on,c.deadline_date,v_today);
 UPDATE erp_private.tasks SET due_at=(v_plan.due_on::text||'T17:00:00+03:00')::timestamptz,
  task_name=left((CASE WHEN v_plan.urgent THEN 'URGENT: ' ELSE '' END)||'Verify KRA notice '||c.notice_reference||' and tell the client',200)
  WHERE task_id=c.verification_task_id;
 PERFORM set_config('kra.system','1',true);
 UPDATE erp_private.kra_cases SET task_due_on=v_plan.due_on,task_urgent=v_plan.urgent WHERE case_id=c.case_id;
 PERFORM set_config('kra.system','',true);
END $$;

-- After a case changes.
CREATE FUNCTION erp_private.kra_case_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF COALESCE(current_setting('kra.system',true),'')='1' THEN RETURN NULL; END IF;
 IF TG_OP='INSERT' THEN
  PERFORM erp_private.kra_ensure_task(NEW.case_id);
 ELSIF NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.deadline_date IS DISTINCT FROM OLD.deadline_date THEN
  IF NEW.verification_task_id IS NULL THEN PERFORM erp_private.kra_ensure_task(NEW.case_id); ELSE PERFORM erp_private.kra_retime_task(NEW.case_id); END IF;
 END IF;
 PERFORM erp_private.kra_sync_flags(NEW.case_id,NULL);
 RETURN NULL;
END $$;
CREATE FUNCTION erp_private.kra_request_after() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM erp_private.kra_sync_flags(NEW.case_id,NULL);
 RETURN NULL;
END $$;

-- Every night, and on demand for a Manager or Partner: make sure every open case has its task, then refresh every flag.
CREATE FUNCTION erp_private.kra_run_checks(p_today date DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_today date;r record;v_cases integer:=0;v_raised integer:=0;v_tasks integer:=0;v_before uuid;v_after uuid;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can run the KRA checks' USING ERRCODE='42501'; END IF;
 v_today:=COALESCE(p_today,(now() AT TIME ZONE 'Africa/Nairobi')::date);
 FOR r IN SELECT c.case_id,c.verification_task_id FROM erp_private.kra_cases c
   WHERE c.status IN('Open','Responded') OR EXISTS(SELECT 1 FROM erp_private.kra_compliance_flags f WHERE f.case_id=c.case_id AND f.status='Open') ORDER BY c.deadline_date LOOP
  v_cases:=v_cases+1;
  v_before:=r.verification_task_id;
  v_after:=erp_private.kra_ensure_task(r.case_id);
  IF v_before IS NULL AND v_after IS NOT NULL THEN v_tasks:=v_tasks+1; END IF;
  v_raised:=v_raised+erp_private.kra_sync_flags(r.case_id,v_today);
 END LOOP;
 RETURN jsonb_build_object('cases_checked',v_cases,'flags_raised',v_raised,'tasks_created',v_tasks);
END $$;

-- The Partner banner and its list: open flags on cases the signed-in user may see.
CREATE FUNCTION erp_private.kra_flag_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'open_flags',count(*),'cases_flagged',count(DISTINCT f.case_id),
  'critical',(count(*) FILTER(WHERE f.severity='CRITICAL')),'critical_cases',count(DISTINCT f.case_id) FILTER(WHERE f.severity='CRITICAL'),
  'high',(count(*) FILTER(WHERE f.severity='HIGH')),'medium',(count(*) FILTER(WHERE f.severity='MEDIUM')))
 FROM erp_private.kra_compliance_flags f WHERE f.status='Open' AND erp_private.kra_case_allowed(f.case_id)
$$;
CREATE FUNCTION erp_private.kra_flag_list(p_severity text DEFAULT NULL)
RETURNS TABLE(flag_id uuid,case_id uuid,flag_code text,severity text,detail text,action_needed text,raised_on date,client_id uuid,client_name text,notice_reference text,deadline_date date,case_status text,days_left integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT f.flag_id,f.case_id,f.flag_code,f.severity,f.detail,f.action_needed,f.raised_on,c.client_id,cl.company_name,c.notice_reference,c.deadline_date,c.status,
  c.deadline_date-(now() AT TIME ZONE 'Africa/Nairobi')::date
 FROM erp_private.kra_compliance_flags f JOIN erp_private.kra_cases c ON c.case_id=f.case_id JOIN erp_private.clients cl ON cl.client_id=c.client_id
 WHERE f.status='Open' AND erp_private.kra_case_allowed(f.case_id) AND (p_severity IS NULL OR f.severity=p_severity)
 ORDER BY (f.severity='CRITICAL') DESC,(f.severity='HIGH') DESC,c.deadline_date,f.flag_code LIMIT 200
$$;

-- Counts for the release checks. Managers and Partners only.
CREATE FUNCTION erp_private.kra_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'kra_cases_open',(SELECT count(*) FROM erp_private.kra_cases c WHERE c.status IN('Open','Responded') AND erp_private.is_leader()),
  'kra_flags_open',(SELECT count(*) FROM erp_private.kra_compliance_flags f WHERE f.status='Open' AND erp_private.is_leader()),
  'kra_flags_critical',(SELECT count(*) FROM erp_private.kra_compliance_flags f WHERE f.status='Open' AND f.severity='CRITICAL' AND erp_private.is_leader()),
  'kra_settings_unconfirmed',(SELECT count(*) FROM erp_private.kra_check_settings s WHERE s.rule_status='Suggested' AND erp_private.is_leader()))
$$;

-- Triggers.
CREATE TRIGGER kra_guard BEFORE INSERT OR UPDATE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.kra_case_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('case_id');
CREATE TRIGGER kra_after AFTER INSERT OR UPDATE ON erp_private.kra_cases FOR EACH ROW EXECUTE FUNCTION erp_private.kra_case_after();
CREATE TRIGGER kra_guard BEFORE INSERT OR UPDATE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.kra_request_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('request_id');
CREATE TRIGGER kra_after AFTER INSERT OR UPDATE ON erp_private.kra_case_requests FOR EACH ROW EXECUTE FUNCTION erp_private.kra_request_after();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.kra_compliance_flags FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.kra_compliance_flags FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.kra_compliance_flags FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('flag_id');

-- Row security.
ALTER TABLE erp_private.kra_cases ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.kra_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.kra_case_requests ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.kra_case_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.kra_compliance_flags ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.kra_compliance_flags FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.kra_cases,erp_private.kra_case_requests TO erp_api;
GRANT SELECT ON erp_private.kra_compliance_flags TO erp_api;
CREATE POLICY kra_cases_read ON erp_private.kra_cases FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT'));
CREATE POLICY kra_cases_add ON erp_private.kra_cases FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT') AND logged_by=(erp_private.actor()).staff_id);
CREATE POLICY kra_cases_update ON erp_private.kra_cases FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT')) WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER','SUPERVISOR','ASSISTANT'));
CREATE POLICY kra_requests_read ON erp_private.kra_case_requests FOR SELECT TO erp_api USING(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_requests_add ON erp_private.kra_case_requests FOR INSERT TO erp_api WITH CHECK(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_requests_update ON erp_private.kra_case_requests FOR UPDATE TO erp_api USING(erp_private.kra_case_allowed(case_id)) WITH CHECK(erp_private.kra_case_allowed(case_id));
CREATE POLICY kra_flags_read ON erp_private.kra_compliance_flags FOR SELECT TO erp_api USING(erp_private.kra_case_allowed(case_id));

-- The service profile now says what is built.
UPDATE erp_private.service_profiles SET engine_state='Built',note='Staff create the project from the template and amend the scope to the notice and the engagement letter. The procedures engine, the notice log, the verification task and the four non-compliance flags are built. The task rules and flag thresholds are defaults the Tax Lead has not confirmed.' WHERE service_code='TAX-KRA';

-- The nightly check, at 03:30 Nairobi time (00:30 UTC).
SELECT cron.schedule('pcl-kra-checks','30 0 * * *','select erp_private.kra_run_checks();');

REVOKE EXECUTE ON FUNCTION erp_private.kra_settings_guard(),erp_private.kra_case_guard(),erp_private.kra_request_guard(),erp_private.kra_case_after(),erp_private.kra_request_after(),
 erp_private.kra_int(text),erp_private.kra_txt(text),erp_private.kra_case_allowed(uuid),erp_private.kra_document_ok(uuid,uuid),erp_private.kra_firm_handles(uuid,uuid),erp_private.kra_client_documents(uuid),erp_private.kra_task_plan(date,date,date),
 erp_private.kra_flag_check(uuid,text,date),erp_private.kra_sync_flags(uuid,date),erp_private.kra_ensure_task(uuid),erp_private.kra_retime_task(uuid),erp_private.kra_run_checks(date),
 erp_private.kra_flag_counts(),erp_private.kra_flag_list(text),erp_private.kra_counts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.kra_int(text),erp_private.kra_txt(text),erp_private.kra_case_allowed(uuid),erp_private.kra_document_ok(uuid,uuid),erp_private.kra_firm_handles(uuid,uuid),erp_private.kra_client_documents(uuid),erp_private.kra_task_plan(date,date,date),
 erp_private.kra_run_checks(date),erp_private.kra_flag_counts(),erp_private.kra_flag_list(text),erp_private.kra_counts() TO erp_api;
