-- Filing windows measured from the statutory due date (build 2026-11-10.2750), from the Partner's written instruction of 10 Nov 2026 17:46.
-- The warning window ("due soon") and the late alert are now counted from the client period's STATUTORY return due date (client_periods.return_due_date: the 9th,
-- the 20th, or 30 June/April), found through the filing task's work period and the client period with the same start and end dates. The firm's own INTERNAL
-- deadline is a separate date: it is the period's internal_due_date when one is recorded, otherwise the filing task's own due date. When the internal date has been
-- reached and the statutory date has not yet passed, the filing is Urgent and the person it is assigned to gets one alert. Nothing is blocked.
-- A task whose period has no statutory date recorded keeps the earlier behaviour (its own due date is used and the source is shown as TASK), so no filing drops out of view.
-- The warning/late day counts (3/3, 5/3, 14/3) are unchanged: still Partner-settable defaults that show "not yet confirmed" until a Partner confirms them.

DROP FUNCTION erp_private.filing_state(uuid[]);
CREATE FUNCTION erp_private.filing_state(p_clients uuid[] DEFAULT NULL)
RETURNS TABLE(task_id uuid,project_id uuid,client_id uuid,task_name text,filing_class text,due_date date,days_left integer,warn_days integer,late_days integer,due_source text,internal_due_date date,internal_days_left integer,assigned_to uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT t.task_id,t.project_id,p.client_id,t.task_name,x.cls,
  COALESCE(per.return_due_date,d.due),
  (COALESCE(per.return_due_date,d.due)-((now() AT TIME ZONE 'Africa/Nairobi')::date))::integer,
  erp_private.deadline_int(lower(x.cls)||'_warn_days'),erp_private.deadline_int(lower(x.cls)||'_late_days'),
  CASE WHEN per.return_due_date IS NOT NULL THEN 'PERIOD' ELSE 'TASK' END,
  CASE WHEN per.return_due_date IS NULL THEN NULL ELSE COALESCE(per.internal_due_date,d.due) END,
  CASE WHEN per.return_due_date IS NULL THEN NULL ELSE (COALESCE(per.internal_due_date,d.due)-((now() AT TIME ZONE 'Africa/Nairobi')::date))::integer END,
  t.assigned_to
 FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id
 CROSS JOIN LATERAL(SELECT CASE WHEN t.template_key IN('monthly-paye','monthly-payroll') THEN 'PAYE' WHEN t.template_key LIKE 'monthly-%' THEN 'VAT' WHEN t.template_key LIKE 'annual-%' THEN 'ANNUAL' END AS cls) x
 CROSS JOIN LATERAL(SELECT (t.due_at AT TIME ZONE 'Africa/Nairobi')::date AS due) d
 LEFT JOIN LATERAL(
  SELECT cp.return_due_date,cp.internal_due_date
  FROM erp_private.work_period_tasks wt
  JOIN erp_private.project_work_periods w ON w.work_period_id=wt.work_period_id
  JOIN erp_private.client_periods cp ON cp.client_id=p.client_id AND cp.starts_on=w.starts_on AND cp.ends_on=w.ends_on
  WHERE wt.task_id=t.task_id ORDER BY cp.created_at DESC LIMIT 1) per ON true
 WHERE x.cls IS NOT NULL AND t.deleted_at IS NULL AND t.due_at IS NOT NULL AND t.status NOT IN('Completed','Cancelled')
  AND (p_clients IS NULL OR p.client_id=ANY(p_clients))
$$;
REVOKE EXECUTE ON FUNCTION erp_private.filing_state(uuid[]) FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- Nightly: one "Urgent" notice to the person a filing is assigned to when the firm's internal deadline has been reached but the statutory date has not passed.
CREATE FUNCTION erp_private.filing_urgent_scan() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;n integer:=0;k integer;
BEGIN
 FOR r IN SELECT f.task_id,f.task_name,f.assigned_to,f.due_date,f.internal_due_date,c.company_name
          FROM erp_private.filing_state() f JOIN erp_private.clients c ON c.client_id=f.client_id
          WHERE f.due_source='PERIOD' AND f.assigned_to IS NOT NULL AND f.internal_days_left<=0 AND f.days_left>=0 LOOP
  INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
  VALUES(r.assigned_to,r.task_id,format('URGENT: %s for %s reached the firm''s internal deadline (%s). The KRA due date is %s.',r.task_name,r.company_name,r.internal_due_date,r.due_date),'filing-urgent:'||r.task_id||':'||r.assigned_to)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS k=ROW_COUNT;n:=n+k;
 END LOOP;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION erp_private.filing_urgent_scan() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('pcl-filing-urgent-scan','50 3 * * *','select erp_private.filing_urgent_scan();');
