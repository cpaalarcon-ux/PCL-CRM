-- Recurrence is based on Nairobi calendar periods, independently of cron's UTC clock.
CREATE FUNCTION erp_private.schedule_occurrences(freq text,pack_name text,starts date,ends date,effective date,obligations text[],through_at timestamptz)
RETURNS TABLE(template_key text,task_name text,period_start date,period_end date,release_at timestamptz,due_at timestamptz,requires_document boolean,review_task boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH periods AS (
 SELECT 'Weekly'::text kind,d::date first_day,(d+interval '6 days')::date last_day FROM generate_series(date_trunc('week',starts::timestamp),ends::timestamp,interval '7 days') d
 WHERE freq IN ('Weekly','Weekly + Monthly')
 UNION ALL SELECT 'Monthly',d::date,(d+interval '1 month -1 day')::date FROM generate_series(date_trunc('month',starts::timestamp),ends::timestamp,interval '1 month') d
 WHERE freq IN ('Monthly','Weekly + Monthly')
 UNION ALL SELECT 'Quarterly',d::date,(d+interval '3 months -1 day')::date FROM generate_series(date_trunc('quarter',starts::timestamp),ends::timestamp,interval '3 months') d WHERE freq='Quarterly'
 UNION ALL SELECT 'Annually',d::date,(d+interval '1 year -1 day')::date FROM generate_series(date_trunc('year',starts::timestamp),ends::timestamp,interval '1 year') d WHERE freq='Annually'
 UNION ALL SELECT 'Once-off',starts,ends WHERE freq='Once-off'
 ), templates(key,label,kind,release_day,due_day,doc,review,obligation) AS (VALUES
 ('weekly-sales','Upload weekly sales','Weekly',0,6,true,false,''),
 ('weekly-purchases','Upload weekly purchases','Weekly',0,6,true,false,''),
 ('weekly-bank','Upload bank transactions','Weekly',0,6,true,false,''),
 ('weekly-mapping','Map purchases and reconcile bank','Weekly',0,6,false,false,''),
 ('weekly-review','Review weekly tax compilation','Weekly',0,6,false,true,''),
 ('weekly-report','Prepare weekly client report','Weekly',0,6,false,false,''),
 ('monthly-compile','Compile monthly tax schedules','Monthly',1,5,false,false,''),
 ('monthly-review','Review monthly tax compilation','Monthly',1,6,false,true,''),
 ('monthly-report','Prepare monthly client report','Monthly',1,7,false,false,''),
 ('monthly-paye','File PAYE return','Monthly',6,7,false,false,'PAYE'),
 ('monthly-vat','File VAT return','Monthly',15,18,false,false,'VAT'),
 ('monthly-tot','File TOT return','Monthly',15,18,false,false,'TOT'),
 ('monthly-payroll','Prepare payroll','Monthly',22,25,false,false,'Payroll')),
 occurrences AS (
 SELECT t.key,t.label,p.first_day,p.last_day,
 CASE WHEN p.kind='Weekly' THEN p.first_day::timestamp+interval '1 minute'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.release_day-1)*interval '1 day'+interval '1 minute' END rel,
 CASE WHEN p.kind='Weekly' THEN p.last_day::timestamp+interval '23 hours 59 minutes'
 ELSE p.first_day::timestamp+CASE WHEN t.key='monthly-payroll' THEN interval '0 month' ELSE interval '1 month' END+(t.due_day-1)*interval '1 day'+interval '23 hours 59 minutes' END due,
 t.doc,t.review FROM periods p JOIN templates t ON t.kind=p.kind
 WHERE pack_name='Tax Compilation' AND (t.obligation='' OR t.obligation=ANY(obligations))
 UNION ALL
 SELECT 'general-'||lower(p.kind),'Complete '||lower(p.kind)||' project work',p.first_day,p.last_day,
 greatest(p.first_day,starts)::timestamp+interval '1 minute',least(p.last_day,ends)::timestamp+interval '23 hours 59 minutes',false,false
 FROM periods p WHERE pack_name='General' OR p.kind IN ('Once-off','Quarterly','Annually')
 ) SELECT key,label,first_day,last_day,
 greatest(rel,starts::timestamp+interval '1 minute') AT TIME ZONE 'Africa/Nairobi',due AT TIME ZONE 'Africa/Nairobi',doc,review
 FROM occurrences WHERE last_day>=starts AND first_day<=ends AND (effective<=starts OR first_day>=effective)
 AND (greatest(rel,starts::timestamp+interval '1 minute') AT TIME ZONE 'Africa/Nairobi')<=through_at
 ORDER BY rel,key
$$;
CREATE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now()) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s erp_private.project_schedules;n integer;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
 RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status<>'Archived' AND c.deleted_at IS NULL) THEN RETURN 0;END IF;
 INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version)
 SELECT pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
 'Generated from project schedule. Internal work target; confirm statutory obligations before filing.',o.due_at,o.template_key||':'||o.period_start::text,
 o.requires_document,o.period_start,o.period_end,o.template_key,s.version
 FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at) o
 ON CONFLICT(project_id,recurring_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END; $$;
CREATE FUNCTION erp_private.run_workspace_scheduler() RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p record;t record;n integer:=0;escalated integer:=0;
BEGIN
 FOR p IN SELECT project_id FROM erp_private.project_schedules WHERE enabled AND deleted_at IS NULL LOOP
 n:=n+erp_private.generate_project_tasks(p.project_id);END LOOP;
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key)
 SELECT DISTINCT r.staff_id,t.task_id,'Overdue task: '||t.task_name,'overdue:'||t.task_id::text||':'||r.staff_id::text
 FROM erp_private.tasks t JOIN erp_private.projects p ON p.project_id=t.project_id
 LEFT JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 CROSS JOIN LATERAL(SELECT t.assigned_to staff_id UNION SELECT s.reviewer_id) r
 WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status<>'Archived' AND t.due_at<now()-interval '5 minutes'
 AND t.status NOT IN ('Completed','Cancelled') AND r.staff_id IS NOT NULL ON CONFLICT(event_key) DO NOTHING;
 FOR t IN SELECT t.*,s.reviewer_id,p.handling_firm_id,r.category_code FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id JOIN erp_private.project_schedules s ON s.project_id=p.project_id
 JOIN erp_private.staff_members r ON r.staff_id=s.reviewer_id
 JOIN erp_private.staff_firm_access fa ON fa.staff_id=r.staff_id AND fa.firm_id=p.handling_firm_id AND fa.deleted_at IS NULL
 WHERE t.requires_document AND t.status IN ('Pending','In Progress','Blocked') AND t.due_at<now() AND t.deleted_at IS NULL
 AND p.deleted_at IS NULL AND p.status<>'Archived' AND s.enabled AND s.deleted_at IS NULL AND r.access_status='Active' AND r.deleted_at IS NULL
 AND r.category_code IN ('PARTNER','MANAGER','SUPERVISOR') AND t.assigned_to<>s.reviewer_id
 AND (r.contract_end_date IS NULL OR r.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.task_id=t.task_id AND d.deleted_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM erp_private.notifications n WHERE n.event_key='missing-document:'||t.task_id::text)
 LOOP
 UPDATE erp_private.tasks SET assigned_to=t.reviewer_id,blocked_reason='Escalated automatically: required client document is overdue.' WHERE task_id=t.task_id;
 INSERT INTO erp_private.task_events(task_id,event_type,from_staff_id,to_staff_id,reason) VALUES(t.task_id,'Missing documents',t.assigned_to,t.reviewer_id,'Required upload is overdue.');
 INSERT INTO erp_private.notifications(recipient_id,task_id,message,event_key) VALUES(t.reviewer_id,t.task_id,'Missing document: '||t.task_name,'missing-document:'||t.task_id::text);
 escalated:=escalated+1;
 END LOOP;
 RETURN jsonb_build_object('generated',n,'escalated',escalated);
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz),erp_private.generate_project_tasks(uuid,timestamptz),erp_private.run_workspace_scheduler() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.schedule_occurrences(text,text,date,date,date,text[],timestamptz),erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule('pcl-workspace-tasks','* * * * *','select erp_private.run_workspace_scheduler();');
;

