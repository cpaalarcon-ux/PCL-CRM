-- Preserve client financial-year scheduling while linking generated tax tasks
-- to their reporting periods. The prior schedule replacement stopped creating
-- project_work_periods and also omitted the ISO-week index fields.
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record;o record;wp uuid;n integer;total integer:=0;fy_month integer;fy_day integer;is_tax boolean;kind text;ps date;pe date;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
  RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(pid::text||':periods',0));
 SELECT p.tax_master,c.year_end_month,c.year_end_day INTO is_tax,fy_month,fy_day
 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status<>'Archived' AND c.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 FOR s IN
  SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL
  UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL
  ORDER BY version
 LOOP
  FOR o IN SELECT * FROM erp_private.schedule_occurrences(
   s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at,fy_month,fy_day
  ) LOOP
   wp:=null;
   IF is_tax THEN
    kind:=CASE WHEN o.template_key LIKE 'annual-%' THEN 'Annually' WHEN s.frequency IN('Once-off','Quarterly') THEN s.frequency ELSE 'Monthly' END;
    -- A weekly period can begin on the previous month's Monday (for example,
    -- a 1 September start may have a week beginning 31 August). Bucket it in
    -- the first month in which this schedule is actually effective.
    ps:=CASE WHEN kind='Monthly' THEN date_trunc('month',greatest(o.period_start,s.starts_on,s.effective_from)::timestamp)::date ELSE o.period_start END;
    pe:=CASE WHEN kind='Monthly' THEN (ps+interval '1 month -1 day')::date ELSE o.period_end END;
    INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on)
    VALUES(pid,kind,ps,pe) ON CONFLICT(project_id,period_kind,starts_on) DO NOTHING;
    SELECT work_period_id INTO wp FROM erp_private.project_work_periods
    WHERE project_id=pid AND period_kind=kind AND starts_on=ps AND status='Open';
    IF wp IS NULL THEN CONTINUE; END IF;
   END IF;
   INSERT INTO erp_private.tasks(
    project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,
    period_start,period_end,template_key,schedule_version,iso_week_year,iso_week_number
   ) VALUES (
    pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
    'Generated from the client reporting schedule. Confirm statutory deadlines and review requirements before filing.',
    o.due_at,o.template_key||':'||o.period_start::text,o.requires_document,o.period_start,o.period_end,
    o.template_key,s.version,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(isoyear FROM o.period_start)::integer END,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(week FROM o.period_start)::integer END
   ) ON CONFLICT(project_id,recurring_key) DO NOTHING;
   GET DIAGNOSTICS n=ROW_COUNT;total:=total+n;
   IF wp IS NOT NULL THEN
    INSERT INTO erp_private.work_period_tasks(task_id,work_period_id)
    SELECT task_id,wp FROM erp_private.tasks
    WHERE project_id=pid AND recurring_key=o.template_key||':'||o.period_start::text
    ON CONFLICT(task_id) DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN total;
END; $$;

REVOKE EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
