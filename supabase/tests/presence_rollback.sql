-- Fictional records; no authentication users or evidence survive this transaction.
BEGIN;
DO $$
DECLARE f uuid:=gen_random_uuid();c uuid:=gen_random_uuid();p uuid:=gen_random_uuid();s uuid:=gen_random_uuid();m uuid:=gen_random_uuid();u uuid:=gen_random_uuid();mu uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();t uuid:=gen_random_uuid();att uuid:=gen_random_uuid();localday date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;late timestamptz;n integer;
BEGIN
 INSERT INTO auth.users(id) VALUES(u),(mu);INSERT INTO auth.sessions(id,user_id) VALUES(sid,u);
 INSERT INTO erp_private.firms(firm_id,firm_code,legal_name) VALUES(f,'P9QA','Fictional presence firm');
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,employment_type,access_status,sessions_invalid_before) VALUES(m,mu,'P9-MANAGER','p9.manager','Fictional attendance manager','MANAGER','Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.staff_members(staff_id,auth_user_id,staff_identifier,login_id,full_name,category_code,manager_id,employment_type,access_status,sessions_invalid_before) VALUES(s,u,'P9-ASSISTANT','p9.assistant','Fictional attendance assistant','ASSISTANT',m,'Permanent','Active',now()-interval '1 day');
 INSERT INTO erp_private.staff_firm_access(staff_id,firm_id) VALUES(s,f),(m,f);
 INSERT INTO erp_private.pilot_sessions(session_id,staff_id,expires_at) VALUES(sid,s,now()+interval '1 hour');
 INSERT INTO erp_private.clients(client_id,company_name,owner_staff_id) VALUES(c,'Fictional presence client',m);
 INSERT INTO erp_private.client_firm_links(client_id,firm_id) VALUES(c,f);
 INSERT INTO erp_private.projects(project_id,client_id,handling_firm_id,project_name,service_code,owner_staff_id) VALUES(p,c,f,'Fictional presence project','TAX-COMP',m);
 INSERT INTO erp_private.project_assignments(project_id,staff_id,handling_firm_id,role_on_job) VALUES(p,s,f,'ASSISTANT');
 INSERT INTO erp_private.tasks(task_id,project_id,assigned_to,task_name) VALUES(t,p,s,'Fictional timer task');
 late:=((localday-1)+time '17:00') AT TIME ZONE 'Africa/Nairobi';
 INSERT INTO erp_private.attendance(attendance_id,staff_id,work_date,clock_in,location,status) VALUES(att,s,localday-1,((localday-1)+time '08:00') AT TIME ZONE 'Africa/Nairobi','Remote','Present');
 INSERT INTO erp_private.staff_presence(staff_id,session_id,last_activity_at) VALUES(s,sid,late);
 INSERT INTO erp_private.task_timers(staff_id,task_id,started_at) VALUES(s,t,now()-interval '1 minute');
 PERFORM erp_private.close_missed_attendance();
 IF NOT EXISTS(SELECT 1 FROM erp_private.attendance WHERE attendance_id=att AND clock_out=late AND review_required AND auto_clocked_out) THEN RAISE EXCEPTION 'Missed attendance not held for review';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.task_timers WHERE staff_id=s AND status='Running') THEN RAISE EXCEPTION 'Yesterday closure stopped today timer';END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.notifications WHERE recipient_id=m AND event_key='auto-clock-out-manager:'||att||':'||m) THEN RAISE EXCEPTION 'Manager not notified';END IF;
 INSERT INTO erp_private.attendance(staff_id,work_date,clock_in,clock_out,location,status) VALUES(s,localday,now()-interval '1 hour',null,'Remote','Present');
 UPDATE erp_private.attendance SET clock_out=now() WHERE staff_id=s AND work_date=localday;
 IF NOT EXISTS(SELECT 1 FROM erp_private.task_timers WHERE staff_id=s AND status='Needs review') THEN RAISE EXCEPTION 'Attendance closure silently billed a timer';END IF;
 IF EXISTS(SELECT 1 FROM erp_private.timesheets WHERE staff_id=s) THEN RAISE EXCEPTION 'Attendance generated billable time';END IF;
 PERFORM set_config('request.jwt.claims',json_build_object('sub',u,'session_id',sid)::text,true);SET LOCAL ROLE erp_api;
 IF (erp_private.actor()).staff_id IS DISTINCT FROM s THEN RAISE EXCEPTION 'Clock out ended login';END IF;
 IF has_table_privilege('anon','erp_private.staff_presence','SELECT') OR has_table_privilege('authenticated','erp_private.task_timers','UPDATE') THEN RAISE EXCEPTION 'Private presence directly exposed';END IF;
 RESET ROLE;
END;$$;
ROLLBACK;
