-- Existing engagement history is preserved. Calendar segmentation changes take
-- effect from this week; no historical weekly catch-up is inferred on migration.
ALTER TABLE erp_private.projects ADD COLUMN weekly_cutover_on date;
UPDATE erp_private.projects SET weekly_cutover_on=(now() AT TIME ZONE 'Africa/Nairobi')::date WHERE deleted_at IS NULL;
CREATE OR REPLACE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH bounds AS (SELECT greatest(starts,effective) first_day,ends last_day), months AS (
 SELECT d::date m,(d+interval '1 month -1 day')::date me FROM bounds,generate_series(date_trunc('month',first_day::timestamp),last_day::timestamp,interval '1 month') d
 ), week_segments AS (
 SELECT greatest(w::date,m,starts,effective) ps,least((w+interval '6 days')::date,me,ends) pe,w::date monday
 FROM months CROSS JOIN LATERAL generate_series(date_trunc('week',m::timestamp),me::timestamp,interval '7 days') w
 WHERE freq IN('Weekly','Monthly','Weekly + Monthly','Weekly + Monthly + Annually') AND least((w+interval '6 days')::date,me,ends)>=greatest(w::date,m,starts,effective)
 ), wt(k,n,doc,rev) AS (VALUES
 ('weekly-sales','Upload weekly sales',true,false),('weekly-purchases','Upload weekly purchases',true,false),('weekly-bank','Upload bank transactions',true,false),
 ('weekly-mapping','Map purchases and reconcile bank',false,false),('weekly-review','Review weekly tax compilation',false,true),('weekly-report','Prepare weekly client report',false,false)),
 mt(k,n,day_due,obligation,rev) AS (VALUES
 ('monthly-compile','Compile monthly tax schedules',15,'',false),('monthly-review','Review monthly tax compilation',15,'',true),('monthly-report','Prepare monthly client report',15,'',false),
 ('monthly-paye','File PAYE return',6,'PAYE',false),('monthly-vat','File VAT return',15,'VAT',false),('monthly-tot','File TOT return',15,'TOT',false),('monthly-payroll','Prepare payroll',6,'Payroll',false)),
 tax_occ AS (
 SELECT wt.k,wt.n||' · '||to_char(monday,'IYYY-"W"IW') ps_name,ps,pe,ps::timestamp+interval '3 hours' rel,pe::timestamp+interval '23 hours 59 minutes' due,wt.doc,wt.rev
 FROM week_segments CROSS JOIN wt WHERE pack_name='Tax Compilation'
 UNION ALL
 SELECT mt.k,mt.n,m,me,greatest(m,starts,effective,CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE m END)::timestamp+interval '3 hours',
 (m+interval '1 month'+(mt.day_due-1)*interval '1 day')::date::timestamp+interval '23 hours 59 minutes',false,mt.rev
 FROM months CROSS JOIN mt WHERE pack_name='Tax Compilation' AND freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually') AND (mt.obligation='' OR mt.obligation=ANY(obligations))
 AND CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE greatest(m,starts,effective) END<=least(me,ends)
 UNION ALL
 SELECT a.k,a.n,d::date,(d+interval '1 year -1 day')::date,greatest((d+a.offset_month*interval '1 month')::date,starts,effective)::timestamp+interval '3 hours',(d+interval '1 year -1 day')::timestamp+interval '23 hours 59 minutes',false,a.rev
 FROM bounds,generate_series(date_trunc('year',first_day::timestamp),last_day::timestamp,interval '1 year') d CROSS JOIN (VALUES('annual-compile','Prepare annual tax schedules',0,false),('annual-review','Review annual tax compilation',10,true),('annual-report','Prepare annual client report',11,false)) a(k,n,offset_month,rev) WHERE pack_name='Tax Compilation' AND freq IN('Annually','Weekly + Monthly + Annually') AND (d+a.offset_month*interval '1 month')::date<=ends
 ), ordinary AS (
 SELECT 'Weekly'::text kind,d::date ps,(d+interval '6 days')::date pe FROM bounds,generate_series(date_trunc('week',first_day::timestamp),last_day::timestamp,interval '7 days') d WHERE freq IN('Weekly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Monthly',d::date,(d+interval '1 month -1 day')::date FROM bounds,generate_series(date_trunc('month',first_day::timestamp),last_day::timestamp,interval '1 month') d WHERE freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date FROM bounds,generate_series(date_trunc('quarter',first_day::timestamp),last_day::timestamp,interval '3 months') d WHERE freq='Quarterly'
 UNION ALL SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date FROM bounds,generate_series(date_trunc('year',first_day::timestamp),last_day::timestamp,interval '1 year') d WHERE freq IN('Annually','Weekly + Monthly + Annually')
 UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), all_occ AS (
 SELECT * FROM tax_occ UNION ALL
 SELECT DISTINCT 'general-'||lower(kind),'Complete '||lower(kind)||' project work',greatest(ps,starts,effective),least(pe,ends),greatest(ps,starts,effective)::timestamp+interval '3 hours',least(pe,ends)::timestamp+interval '23 hours 59 minutes',false,false FROM ordinary WHERE pack_name='General' OR kind IN('Quarterly','Once-off')
 ) SELECT k,ps_name,ps,pe,rel AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,rev FROM all_occ
 WHERE ps<=ends AND pe>=greatest(starts,effective) AND rel AT TIME ZONE 'Africa/Nairobi'<=through_at ORDER BY rel,k
$$;
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record;o record;wp uuid;n integer;total integer:=0;is_tax boolean;kind text;ps date;pe date;cutover date;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(pid::text||':periods',0));
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM erp_private.projects WHERE project_id=pid AND deleted_at IS NULL AND status<>'Archived') THEN RETURN 0;END IF;
 SELECT tax_master,weekly_cutover_on INTO is_tax,cutover FROM erp_private.projects WHERE project_id=pid;
 FOR s IN SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL ORDER BY version LOOP
 FOR o IN SELECT * FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at) WHERE cutover IS NULL OR template_key NOT LIKE 'weekly-%' OR period_end>=cutover LOOP
 wp:=null;
 IF is_tax THEN
  kind:=CASE WHEN o.template_key LIKE 'annual-%' THEN 'Annually' WHEN s.frequency IN('Once-off','Quarterly') THEN s.frequency ELSE 'Monthly' END;
  ps:=CASE WHEN kind='Monthly' THEN date_trunc('month',o.period_start::timestamp)::date ELSE o.period_start END;
  pe:=CASE WHEN kind='Monthly' THEN (ps+interval '1 month -1 day')::date ELSE o.period_end END;
  INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on) VALUES(pid,kind,ps,pe) ON CONFLICT(project_id,period_kind,starts_on) DO NOTHING;
  SELECT work_period_id INTO wp FROM erp_private.project_work_periods WHERE project_id=pid AND period_kind=kind AND starts_on=ps AND status='Open';
  IF wp IS NULL THEN CONTINUE;END IF;
 END IF;
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version,iso_week_year,iso_week_number)
 VALUES(pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
 'Generated from the approved service schedule. Internal target; statutory deadline and client approval remain separate controls.',o.due_at,o.template_key||':'||o.period_start::text,o.requires_document,o.period_start,o.period_end,o.template_key,s.version,
 CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(isoyear FROM o.period_start)::int END,CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(week FROM o.period_start)::int END)
 ON CONFLICT(project_id,recurring_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;total:=total+n;
 IF wp IS NOT NULL THEN INSERT INTO erp_private.work_period_tasks(task_id,work_period_id) SELECT task_id,wp FROM erp_private.tasks WHERE project_id=pid AND recurring_key=o.template_key||':'||o.period_start::text ON CONFLICT(task_id) DO NOTHING;END IF;
 END LOOP;END LOOP;RETURN total;
END;$$;
