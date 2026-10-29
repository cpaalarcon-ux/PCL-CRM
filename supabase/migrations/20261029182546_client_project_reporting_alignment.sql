-- Keep recurring work aligned to the client's financial year. Client setup is
-- the canonical source; tasks retain their own dates after they are generated.
CREATE OR REPLACE FUNCTION erp_private.client_financial_year_start(p_on_date date,p_end_month integer,p_end_day integer)
RETURNS date LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE y integer; m integer; d integer; year_end date; previous_end date;
BEGIN
 IF p_on_date IS NULL THEN RETURN NULL; END IF;
 y:=extract(year from p_on_date)::integer;
 m:=greatest(1,least(coalesce(p_end_month,12),12));
 d:=greatest(1,coalesce(p_end_day,31));
 year_end:=make_date(y,m,least(d,extract(day from (make_date(y,m,1)+interval '1 month -1 day'))::integer));
 IF p_on_date>year_end THEN RETURN year_end+1; END IF;
 y:=y-1;
 previous_end:=make_date(y,m,least(d,extract(day from (make_date(y,m,1)+interval '1 month -1 day'))::integer));
 RETURN previous_end+1;
END; $$;

REVOKE ALL ON FUNCTION erp_private.client_financial_year_start(date,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_financial_year_start(date,integer,integer) TO erp_api;

-- Weekly work always uses Monday–Sunday periods, including at month-end.
-- Quarterly and annual work follow the client's saved financial year-end.
CREATE OR REPLACE FUNCTION erp_private.schedule_occurrences(
 freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz,
 year_end_month integer,year_end_day integer
)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH bounds AS (
  SELECT greatest(starts,effective) first_day,ends last_day,coalesce(year_end_month,12) fym,coalesce(year_end_day,31) fyd
 ), months AS (
  SELECT d::date m,(d+interval '1 month -1 day')::date me
  FROM bounds CROSS JOIN LATERAL generate_series(date_trunc('month',first_day::timestamp),last_day::timestamp,interval '1 month') d
 ), weeks AS (
  SELECT w::date monday,(w+interval '6 days')::date sunday
  FROM bounds CROSS JOIN LATERAL generate_series(date_trunc('week',first_day::timestamp),last_day::timestamp,interval '7 days') w
  WHERE (w+interval '6 days')::date>=first_day AND w::date<=last_day
 ), wt(k,n,doc,rev) AS (VALUES
  ('weekly-sales','Upload weekly sales',true,false),('weekly-purchases','Upload weekly purchases',true,false),('weekly-bank','Upload bank transactions',true,false),
  ('weekly-mapping','Map purchases and reconcile bank',false,false),('weekly-review','Review weekly tax compilation',false,true),('weekly-report','Prepare weekly client report',false,false)
 ), mt(k,n,day_due,obligation,rev) AS (VALUES
  ('monthly-compile','Compile monthly tax schedules',15,'',false),('monthly-review','Review monthly tax compilation',15,'',true),('monthly-report','Prepare monthly client report',15,'',false),
  ('monthly-paye','File PAYE return',6,'PAYE',false),('monthly-vat','File VAT return',15,'VAT',false),('monthly-tot','File TOT return',15,'TOT',false),('monthly-mri','Prepare MRI return',15,'MRI',false),
  ('monthly-payroll','Prepare payroll',6,'Payroll',false),('monthly-housing-levy','Review Affordable Housing Levy records',15,'Housing levy',false),
  ('monthly-shif','Review SHIF contributions',15,'SHIF',false),('monthly-nssf','Review NSSF contributions',15,'NSSF',false),
  ('monthly-nita','Review NITA employer levy records',15,'NITA',false),('monthly-fringe-benefit','Review fringe benefit tax records',15,'Fringe benefit',false),
  ('monthly-deemed-interest','Review deemed interest tax records',15,'Deemed interest',false)
 ), tax_occ AS (
  SELECT wt.k template_key,wt.n||' · '||to_char(w.monday,'IYYY-"W"IW') task_name,w.monday period_start,w.sunday period_end,
   greatest(w.monday,starts,effective)::timestamp+interval '3 hours' release_at,least(w.sunday,ends)::timestamp+interval '23 hours 59 minutes' due_at,wt.doc requires_document,wt.rev review_task
  FROM weeks w CROSS JOIN wt,bounds b
  WHERE pack_name='Tax Compilation' AND freq IN('Weekly','Weekly + Monthly','Weekly + Monthly + Annually')
  UNION ALL
  SELECT mt.k template_key,mt.n task_name,m period_start,me period_end,
   greatest(m,starts,effective,CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE m END)::timestamp+interval '3 hours' release_at,
   (m+interval '1 month'+(mt.day_due-1)*interval '1 day')::date::timestamp+interval '23 hours 59 minutes' due_at,false requires_document,mt.rev review_task
  FROM months CROSS JOIN mt,bounds b
  WHERE pack_name='Tax Compilation' AND freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
   AND (mt.obligation='' OR mt.obligation=ANY(obligations))
   AND CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE greatest(m,starts,effective) END<=least(me,ends)
  UNION ALL
  SELECT a.k template_key,a.n task_name,d::date period_start,(d+interval '1 year -1 day')::date period_end,
   greatest((d+a.offset_month*interval '1 month')::date,starts,effective)::timestamp+interval '3 hours' release_at,
   (d+interval '1 year -1 day')::date::timestamp+interval '23 hours 59 minutes' due_at,false requires_document,a.rev review_task
  FROM bounds b
  CROSS JOIN LATERAL generate_series(erp_private.client_financial_year_start(b.first_day,b.fym,b.fyd)::timestamp,b.last_day::timestamp,interval '1 year') d
  CROSS JOIN (VALUES('annual-compile','Prepare annual tax schedules',0,false),('annual-review','Review annual tax compilation',10,true),('annual-report','Prepare annual client report',11,false)) a(k,n,offset_month,rev)
  WHERE pack_name='Tax Compilation' AND freq IN('Annually','Weekly + Monthly + Annually')
   AND (d+a.offset_month*interval '1 month')::date<=ends
 ), ordinary AS (
  SELECT 'Weekly'::text kind,monday ps,sunday pe FROM weeks
  WHERE freq IN('Weekly','Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
  UNION ALL
  SELECT 'Monthly',m,me FROM months WHERE freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
  UNION ALL
  SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date
  FROM bounds b CROSS JOIN LATERAL generate_series(erp_private.client_financial_year_start(b.first_day,b.fym,b.fyd)::timestamp,b.last_day::timestamp,interval '3 months') d
  WHERE freq='Quarterly'
  UNION ALL
  SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date
  FROM bounds b CROSS JOIN LATERAL generate_series(erp_private.client_financial_year_start(b.first_day,b.fym,b.fyd)::timestamp,b.last_day::timestamp,interval '1 year') d
  WHERE freq IN('Annually','Weekly + Monthly + Annually')
  UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), all_occ AS (
  SELECT * FROM tax_occ
  UNION ALL
  SELECT DISTINCT 'general-'||lower(o.kind) template_key,'Complete '||lower(o.kind)||' project work' task_name,o.ps period_start,least(o.pe,ends) period_end,
   greatest(o.ps,starts,effective)::timestamp+interval '3 hours' release_at,least(o.pe,ends)::timestamp+interval '23 hours 59 minutes' due_at,false requires_document,false review_task
  FROM ordinary o WHERE pack_name='General' OR o.kind IN('Quarterly','Once-off')
 )
 SELECT template_key,task_name,period_start,period_end,release_at AT TIME ZONE 'Africa/Nairobi',due_at AT TIME ZONE 'Africa/Nairobi',requires_document,review_task
 FROM all_occ
 WHERE period_start<=ends AND period_end>=greatest(starts,effective)
  AND release_at AT TIME ZONE 'Africa/Nairobi'<=through_at
 ORDER BY release_at,template_key
$$;

REVOKE ALL ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz,integer,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz,integer,integer) TO erp_api;

-- Keep the public scheduler idempotent while supplying the client financial year.
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record; n integer; total integer:=0; fy_month integer; fy_day integer;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
  RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';
 END IF;
 SELECT c.year_end_month,c.year_end_day INTO fy_month,fy_day
 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status<>'Archived' AND c.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 FOR s IN
  SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL
  UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL
  ORDER BY version
 LOOP
  INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version)
  SELECT pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
   'Generated from the client reporting schedule. Confirm statutory deadlines and review requirements before filing.',o.due_at,o.template_key||':'||o.period_start::text,
   o.requires_document,o.period_start,o.period_end,o.template_key,s.version
  FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at,fy_month,fy_day) o
  ON CONFLICT(project_id,recurring_key) DO NOTHING;
  GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
 END LOOP;
 RETURN total;
END; $$;

REVOKE EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
