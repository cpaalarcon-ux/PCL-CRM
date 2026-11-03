-- Keep client tax positions separate from recurring service scope. Profiles may
-- record withholding appointments, credits and transaction-triggered taxes;
-- only supported recurring work is released by the project scheduler.
ALTER TABLE erp_private.project_schedules DROP CONSTRAINT IF EXISTS project_schedules_obligations_check;
ALTER TABLE erp_private.project_schedules ADD CONSTRAINT project_schedules_obligations_check
 CHECK(obligations <@ ARRAY['VAT','PAYE','TOT','Payroll','Income Tax','MRI','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest']::text[]);

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
 ('monthly-paye','File PAYE return',6,'PAYE',false),('monthly-vat','File VAT return',15,'VAT',false),('monthly-tot','File TOT return',15,'TOT',false),('monthly-mri','Prepare MRI return',15,'MRI',false),
 ('monthly-payroll','Prepare payroll',6,'Payroll',false),('monthly-housing-levy','Review Affordable Housing Levy records',15,'Housing levy',false),
 ('monthly-shif','Review SHIF contributions',15,'SHIF',false),('monthly-nssf','Review NSSF contributions',15,'NSSF',false),
 ('monthly-nita','Review NITA employer levy records',15,'NITA',false),('monthly-fringe-benefit','Review fringe benefit tax records',15,'Fringe benefit',false),
 ('monthly-deemed-interest','Review deemed interest tax records',15,'Deemed interest',false)),
 tax_occ AS (
 SELECT wt.k,wt.n||' · '||to_char(monday,'IYYY-"W"IW') ps_name,ps,pe,ps::timestamp+interval '3 hours' rel,pe::timestamp+interval '23 hours 59 minutes' due,wt.doc,wt.rev
 FROM week_segments CROSS JOIN wt WHERE pack_name='Tax Compilation'
 UNION ALL
 SELECT mt.k,mt.n,m,me,greatest(m,starts,effective,CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE m END)::timestamp+interval '3 hours',
 (m+interval '1 month'+(mt.day_due-1)*interval '1 day')::date::timestamp+interval '23 hours 59 minutes',false,mt.rev
 FROM months CROSS JOIN mt WHERE pack_name='Tax Compilation' AND freq IN('Monthly','Weekly + Monthly','Weekly + Monthly + Annually') AND (mt.obligation='' OR mt.obligation=ANY(obligations))
 AND CASE WHEN mt.k='monthly-payroll' THEN m+21 ELSE greatest(m,starts,effective) END<=least(me,ends)
 UNION ALL
 SELECT a.k,a.n,d::date,(d+interval '1 year -1 day')::date,greatest((d+a.offset_month*interval '1 month')::date,starts,effective)::timestamp+interval '3 hours',(d+interval '1 year -1 day')::date::timestamp+interval '23 hours 59 minutes',false,a.rev
 FROM bounds,generate_series(date_trunc('year',first_day::timestamp),last_day::timestamp,interval '1 year') d CROSS JOIN (VALUES('annual-compile','Prepare annual tax schedules',0,false),('annual-review','Review annual tax compilation',10,true),('annual-report','Prepare annual client report',11,false)) a(k,n,offset_month,rev)
 WHERE pack_name='Tax Compilation' AND freq IN('Annually','Weekly + Monthly + Annually') AND (d+a.offset_month*interval '1 month')::date<=ends
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

-- MRI has an existing tax-case calculation and is now released as a filing
-- workflow, with its return period required to match the task's monthly period.
CREATE OR REPLACE FUNCTION erp_private.init_task_procedure() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 INSERT INTO erp_private.task_procedures(task_id,project_id,profile,prepared_by,reviewer_id)
 VALUES(NEW.task_id,NEW.project_id,CASE WHEN NEW.template_key IN('monthly-vat','monthly-paye','monthly-tot','monthly-mri') THEN 'Tax filing' WHEN NEW.template_key IN('weekly-review','monthly-review','annual-review') THEN 'Compilation review' ELSE 'Supporting task' END,NEW.assigned_to,(SELECT reviewer_id FROM erp_private.project_schedules WHERE project_id=NEW.project_id));
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(NEW.assigned_to,NEW.task_id,'New task: '||NEW.task_name,'new-task:'||NEW.task_id) ON CONFLICT DO NOTHING;RETURN NEW;
END;$$;

CREATE FUNCTION erp_private.mri_filing_task_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t erp_private.tasks;c erp_private.tax_cases;
BEGIN
 SELECT * INTO t FROM erp_private.tasks WHERE task_id=NEW.task_id;
 IF t.template_key='monthly-mri' THEN
  IF NEW.profile<>'Tax filing' THEN RAISE EXCEPTION 'MRI filing review must use the tax filing workflow' USING ERRCODE='23514';END IF;
  IF NEW.case_id IS NOT NULL THEN
   SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.case_id;
   IF c.project_id IS DISTINCT FROM NEW.project_id OR c.kind<>'MRI' OR c.starts_on IS DISTINCT FROM t.period_start OR c.ends_on IS DISTINCT FROM t.period_end THEN RAISE EXCEPTION 'MRI tax case and return period must match this task' USING ERRCODE='23514';END IF;
  END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER mri_filing_task_guard BEFORE INSERT OR UPDATE ON erp_private.task_procedures FOR EACH ROW EXECUTE FUNCTION erp_private.mri_filing_task_guard();
REVOKE ALL ON FUNCTION erp_private.mri_filing_task_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.mri_filing_task_guard() TO erp_api;
