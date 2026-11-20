BEGIN;
DO $$
DECLARE f uuid:=gen_random_uuid();s uuid:=gen_random_uuid();m uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();t uuid;tm uuid;n int;
BEGIN
 INSERT INTO erp_private.firms(firm_id,firm_code,legal_name) VALUES(f,'V6QA','V6 QA fictional firm');
 INSERT INTO erp_private.staff_members(staff_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status)
 VALUES(s,'V6QAS','v6qa.supervisor','V6 QA Supervisor','SUPERVISOR','Permanent','Pending setup'),(m,'V6QAM','v6qa.manager','V6 QA Manager','MANAGER','Permanent','Pending setup'),(a,'V6QAA','v6qa.assistant','V6 QA Assistant','ASSISTANT','Permanent','Pending setup');
 INSERT INTO erp_private.staff_firm_access(staff_id,firm_id) VALUES(s,f),(m,f),(a,f);
 INSERT INTO erp_private.clients(client_id,company_name,owner_staff_id) VALUES(c,'V6 QA Client',s);
 INSERT INTO erp_private.client_firm_links(client_id,firm_id) VALUES(c,f);
 INSERT INTO erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) VALUES(p,c,f,'V6 QA Tax compilation','TAX-COMP',s);
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(p,s,f,'SUPERVISOR'),(p,m,f,'MANAGER'),(p,a,f,'ASSISTANT');
 INSERT INTO erp_private.project_schedules(project_id,frequency,pack,starts_on,ends_on,effective_from,obligations,assigned_to,reviewer_id)
 VALUES(p,'Weekly + Monthly','Tax Compilation','2026-10-01','2026-12-31','2026-10-01',ARRAY['VAT','PAYE'],a,m);
 UPDATE erp_private.project_schedules SET effective_from='2026-10-24',version=2 WHERE project_id=p;
 n:=erp_private.generate_project_tasks(p,'2026-11-20T23:59:00+03:00');IF n<20 THEN RAISE EXCEPTION 'Expected weekly and monthly task pack';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.tasks WHERE project_id=p AND template_key='monthly-vat' AND period_start='2026-10-01') THEN RAISE EXCEPTION 'Current month filing lost after schedule edit';END IF;
 IF erp_private.generate_project_tasks(p,'2026-11-20T23:59:00+03:00')<>0 THEN RAISE EXCEPTION 'Duplicate recurrence generated';END IF;
 SELECT task_id INTO t FROM erp_private.tasks WHERE project_id=p AND template_key='weekly-sales' LIMIT 1;
 INSERT INTO erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,status,reviewed_by,reviewed_at) VALUES(a,p,t,'2026-10-01',3,'QA approved time','Approved',m,now()) RETURNING timesheet_id INTO tm;
 BEGIN UPDATE erp_private.timesheets SET hours=4 WHERE timesheet_id=tm;RAISE EXCEPTION 'Approved time changed';EXCEPTION WHEN check_violation THEN NULL;END;
 INSERT INTO erp_private.timesheets(staff_id,project_id,task_id,work_date,hours,description,status,reviewed_by,reviewed_at,reverses_id) VALUES(a,p,t,'2026-10-01',-3,'QA reversal','Approved',m,now(),tm);
 IF (SELECT sum(hours) FROM erp_private.timesheets WHERE project_id=p)<>0 THEN RAISE EXCEPTION 'Reversal did not offset cost hours';END IF;
 BEGIN UPDATE erp_private.projects SET status='Active' WHERE project_id=p;RAISE EXCEPTION 'Activation gate bypassed';EXCEPTION WHEN check_violation THEN NULL;END;
 PERFORM erp_private.run_workspace_scheduler();
END; $$;
ROLLBACK;
