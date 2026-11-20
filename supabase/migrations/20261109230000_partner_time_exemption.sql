-- Partner time exemption (build .109a). A recorded exception to "the person who prepares cannot approve":
--  * Only a Partner's OWN time, and only after a Partner has signed PARTNER_TIME_POLICY in the ERP. Until then a Partner's time follows the normal route.
--  * The entry is saved Approved and locked, flagged is_auto_approved, with a system note. It never reaches a review queue.
--  * Other Partners see it in a read-only Partner time list. A correction is a reversing entry by a SECOND Partner with a written reason; the original is never edited.
--  * Partners are not counted as overloaded on Team & HR.
INSERT INTO erp_private.system_policies(policy_code,policy_name,statement) VALUES
 ('PARTNER_TIME_POLICY','Partner Time Policy','I authorize that a Partner''s own time entries are approved and locked when saved and are flagged as auto-approved. They do not wait in a review queue. Other Partners can see them in a read-only list, and a correction can be made only by a second Partner, with a written reason.');

ALTER TABLE erp_private.timesheets ADD COLUMN is_auto_approved boolean NOT NULL DEFAULT false;
DO $do$
DECLARE c record;
BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.timesheets'::regclass AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%reviewed_by <> staff_id%' LOOP
  EXECUTE format('ALTER TABLE erp_private.timesheets DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $do$;
ALTER TABLE erp_private.timesheets
 ADD CONSTRAINT timesheets_reviewer_differs CHECK(reviewed_by IS NULL OR reviewed_by<>staff_id OR is_auto_approved),
 ADD CONSTRAINT timesheets_auto_shape CHECK(NOT is_auto_approved OR (status='Approved' AND reviewed_by=staff_id AND reviewed_at IS NOT NULL AND reverses_id IS NULL));
CREATE INDEX timesheets_auto_idx ON erp_private.timesheets(work_date DESC) WHERE is_auto_approved;

-- True for a Partner while PARTNER_TIME_POLICY is signed off.
CREATE FUNCTION erp_private.partner_time_exempt() RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (erp_private.actor()).category_code='PARTNER' AND EXISTS(SELECT 1 FROM erp_private.system_policies WHERE policy_code='PARTNER_TIME_POLICY' AND status='Signed_Off')
$$;
REVOKE ALL ON FUNCTION erp_private.partner_time_exempt() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.partner_time_exempt() TO erp_api;

CREATE OR REPLACE FUNCTION erp_private.timesheet_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE orig record;
BEGIN
 IF TG_OP='UPDATE' AND OLD.status='Approved' THEN RAISE EXCEPTION 'Approved time is locked; use a reversal' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.staff_id,NEW.project_id,NEW.task_id,NEW.reverses_id) IS DISTINCT FROM (OLD.staff_id,OLD.project_id,OLD.task_id,OLD.reverses_id) THEN
  RAISE EXCEPTION 'Timesheet identity cannot change' USING ERRCODE='23514'; END IF;
 IF NEW.work_date>(now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'Time cannot be recorded in the future' USING ERRCODE='23514'; END IF;
 IF current_user='erp_api' AND NEW.is_auto_approved AND NEW.staff_id IS DISTINCT FROM (erp_private.actor()).staff_id THEN
  RAISE EXCEPTION 'Only a Partner''s own time can be auto-approved' USING ERRCODE='42501'; END IF;
 IF current_user='erp_api' AND NEW.staff_id=(erp_private.actor()).staff_id THEN
  IF NEW.is_auto_approved THEN
   IF NOT erp_private.partner_time_exempt() THEN RAISE EXCEPTION 'Partner time is not auto-approved until a Partner signs the Partner Time Policy' USING ERRCODE='42501'; END IF;
   IF NEW.status<>'Approved' OR NEW.reviewed_by IS DISTINCT FROM NEW.staff_id OR NEW.reviewed_at IS NULL OR NEW.reverses_id IS NOT NULL THEN
    RAISE EXCEPTION 'Auto-approved Partner time must be saved as approved by the Partner themselves' USING ERRCODE='42501'; END IF;
  ELSIF NEW.status NOT IN ('Draft','Submitted') OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.reverses_id IS NOT NULL THEN RAISE EXCEPTION 'Staff cannot approve their own time' USING ERRCODE='42501'; END IF;
 ELSIF current_user='erp_api' THEN
  IF NOT erp_private.is_leader() OR NOT erp_private.project_allowed(NEW.project_id) OR NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id
   OR NEW.status NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Manager review is required' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND (OLD.status<>'Submitted' OR (NEW.hours,NEW.work_date,NEW.description,NEW.billable) IS DISTINCT FROM (OLD.hours,OLD.work_date,OLD.description,OLD.billable)) THEN
   RAISE EXCEPTION 'Review submitted time without changing the work logged' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.reverses_id IS NOT NULL THEN
  SELECT t.* INTO orig FROM erp_private.timesheets t WHERE t.timesheet_id=NEW.reverses_id AND t.status='Approved'
   AND t.reverses_id IS NULL AND (t.staff_id,t.project_id,t.task_id,t.work_date,t.hours)=(NEW.staff_id,NEW.project_id,NEW.task_id,NEW.work_date,-NEW.hours);
  IF NOT FOUND THEN RAISE EXCEPTION 'Reversal must offset an approved entry exactly' USING ERRCODE='23514'; END IF;
  -- A correction to a Partner's auto-approved time needs a second Partner and a written reason.
  IF orig.is_auto_approved AND current_user='erp_api' THEN
   IF (erp_private.actor()).category_code<>'PARTNER' OR (erp_private.actor()).staff_id=orig.staff_id THEN
    RAISE EXCEPTION 'A second Partner must correct a Partner''s auto-approved time' USING ERRCODE='42501'; END IF;
   IF length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Record the reason for the correction in at least 10 characters' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END; $$;

-- Read-only list for Partners: auto-approved Partner time, newest first. A Partner sees their own and other Partners' entries.
CREATE FUNCTION erp_private.partner_time_list(p_days integer DEFAULT 90)
RETURNS TABLE(timesheet_id uuid,staff_id uuid,staff_name text,project_id uuid,project_name text,client_name text,work_date date,hours numeric,billable boolean,description text,created_at timestamptz,reversed boolean,own boolean)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a record;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can see Partner time' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT t.timesheet_id,t.staff_id,s.full_name,t.project_id,p.project_name,c.company_name,t.work_date,t.hours,t.billable,t.description,t.created_at,
  EXISTS(SELECT 1 FROM erp_private.timesheets r WHERE r.reverses_id=t.timesheet_id),t.staff_id=a.staff_id
 FROM erp_private.timesheets t
 JOIN erp_private.staff_members s ON s.staff_id=t.staff_id
 JOIN erp_private.projects p ON p.project_id=t.project_id
 JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE t.is_auto_approved AND t.deleted_at IS NULL AND t.work_date>=(now() AT TIME ZONE 'Africa/Nairobi')::date-GREATEST(1,LEAST(COALESCE(p_days,90),730))
 ORDER BY t.work_date DESC,t.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION erp_private.partner_time_list(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.partner_time_list(integer) TO erp_api;

-- Partners are not counted as overloaded.
DO $do$
DECLARE def text;nd text;
BEGIN
 def:=pg_get_functiondef('erp_private.team_workload()'::regprocedure);
 nd:=replace(def,'coalesce(t.active,0)>15','(coalesce(t.active,0)>15 AND s.category_code<>''PARTNER'')');
 IF nd=def THEN RAISE EXCEPTION 'team_workload definition changed; patch not applied'; END IF;
 EXECUTE nd;
END $do$;
