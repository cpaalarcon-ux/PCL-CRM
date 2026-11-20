-- A project may have one parent upload task for historic periods while its
-- recurring schedule starts with the client's current reporting period.
-- Individual imports and accounting periods remain date-specific.
ALTER TABLE erp_private.project_schedules
 ADD COLUMN catchup_starts_on date,
 ADD COLUMN catchup_ends_on date,
 ADD CONSTRAINT project_schedules_catchup_range CHECK (
  (catchup_starts_on IS NULL AND catchup_ends_on IS NULL) OR
  (catchup_starts_on IS NOT NULL AND catchup_ends_on IS NOT NULL
   AND catchup_starts_on=date_trunc('month',catchup_starts_on::timestamp)::date
   AND catchup_ends_on=(date_trunc('month',catchup_ends_on::timestamp)+interval '1 month -1 day')::date
   AND catchup_ends_on>=catchup_starts_on
   AND catchup_ends_on=date_trunc('month',starts_on::timestamp)::date-1)
 );

ALTER TABLE erp_private.project_schedule_history
 ADD COLUMN catchup_starts_on date,
 ADD COLUMN catchup_ends_on date,
 ADD CONSTRAINT project_schedule_history_catchup_range CHECK (
  (catchup_starts_on IS NULL AND catchup_ends_on IS NULL) OR
  (catchup_starts_on IS NOT NULL AND catchup_ends_on IS NOT NULL
   AND catchup_starts_on=date_trunc('month',catchup_starts_on::timestamp)::date
   AND catchup_ends_on=(date_trunc('month',catchup_ends_on::timestamp)+interval '1 month -1 day')::date
   AND catchup_ends_on>=catchup_starts_on
   AND catchup_ends_on=date_trunc('month',starts_on::timestamp)::date-1)
 );

CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record; current_s record; o record; n integer; total integer:=0; fy_month integer; fy_day integer; opening_status text;
 is_tax boolean; work_kind text; work_start date; work_end date; work_period uuid;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
  RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';
 END IF;
 SELECT c.year_end_month,c.year_end_day,c.opening_balance_status,p.tax_master INTO fy_month,fy_day,opening_status,is_tax
 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(pid::text||':periods',0));
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;

 -- Create one idempotent upload task from the current schedule only. It is a
 -- parent intake task, not a combined tax or ledger period and not evidence.
 SELECT * INTO current_s FROM erp_private.project_schedules
  WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF FOUND AND current_s.catchup_starts_on IS NOT NULL AND
  (opening_status='No opening balances' OR EXISTS(
   SELECT 1 FROM erp_private.ledger_periods lp JOIN erp_private.ledger_journals j USING(period_id)
   WHERE lp.client_id=(SELECT client_id FROM erp_private.projects WHERE project_id=pid)
    AND lp.starts_on<=current_s.starts_on AND lp.ends_on>=current_s.starts_on
    AND j.kind='Opening' AND j.status='Posted')) THEN
  INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,template_key,schedule_version)
  VALUES(pid,current_s.assigned_to,
   'Upload prior periods · '||to_char(current_s.catchup_starts_on,'YYYY-MM')||' to '||to_char(current_s.catchup_ends_on,'YYYY-MM'),
   'One-time catch-up upload for the selected earlier months. Use the approved import templates and retain the actual reporting month on every row. The ERP reviews and reports each month separately. Import workbooks are data sources, not supporting evidence for tax claims or audit conclusions; attach original supporting records separately where required. This task does not combine periods, post journals or file returns.',
   (((now() AT TIME ZONE 'Africa/Nairobi')::date+14)::timestamp+interval '17 hours') AT TIME ZONE 'Africa/Nairobi',
   'catchup-upload',true,'catchup-upload',current_s.version)
  ON CONFLICT(project_id,recurring_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 END IF;

 FOR s IN
  SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL
  UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL
  ORDER BY version
 LOOP
  IF opening_status<>'No opening balances' AND NOT EXISTS(
   SELECT 1 FROM erp_private.ledger_periods lp JOIN erp_private.ledger_journals j USING(period_id)
   JOIN erp_private.projects p ON p.client_id=lp.client_id
   WHERE p.project_id=pid AND lp.starts_on<=s.starts_on AND lp.ends_on>=s.starts_on
   AND j.kind='Opening' AND j.status='Posted') THEN CONTINUE; END IF;
  FOR o IN SELECT * FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at,fy_month,fy_day)
   WHERE current_s.catchup_starts_on IS NULL
    OR period_end<current_s.catchup_starts_on
    OR period_start>current_s.catchup_ends_on
  LOOP
   work_period:=null;
   IF is_tax THEN
    work_kind:=CASE WHEN o.template_key LIKE 'annual-%' THEN 'Annually' WHEN s.frequency IN('Once-off','Quarterly') THEN s.frequency ELSE 'Monthly' END;
    work_start:=CASE WHEN work_kind='Monthly' THEN date_trunc('month',o.period_start::timestamp)::date ELSE o.period_start END;
    work_end:=CASE WHEN work_kind='Monthly' THEN (work_start+interval '1 month -1 day')::date ELSE o.period_end END;
    INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on)
     VALUES(pid,work_kind,work_start,work_end) ON CONFLICT(project_id,period_kind,starts_on) DO NOTHING;
    SELECT work_period_id INTO work_period FROM erp_private.project_work_periods
     WHERE project_id=pid AND period_kind=work_kind AND starts_on=work_start AND status='Open';
    IF work_period IS NULL THEN CONTINUE; END IF;
   END IF;
   INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version,iso_week_year,iso_week_number)
   VALUES(pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
    'Generated from the client reporting schedule. Confirm statutory deadlines and review requirements before filing.',o.due_at,o.template_key||':'||o.period_start::text,
    o.requires_document,o.period_start,o.period_end,o.template_key,s.version,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(isoyear FROM o.period_start)::int END,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(week FROM o.period_start)::int END)
   ON CONFLICT(project_id,recurring_key) DO NOTHING;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
   IF work_period IS NOT NULL THEN
    INSERT INTO erp_private.work_period_tasks(task_id,work_period_id)
     SELECT task_id,work_period FROM erp_private.tasks WHERE project_id=pid AND recurring_key=o.template_key||':'||o.period_start::text
     ON CONFLICT(task_id) DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN total;
END; $$;

REVOKE EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
