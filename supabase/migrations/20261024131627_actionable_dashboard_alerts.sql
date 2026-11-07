-- The latest user policy keeps login independent of attendance and inactivity.
CREATE OR REPLACE FUNCTION erp_private.touch_session(p_session uuid,p_user uuid,p_activity_age_ms integer DEFAULT NULL,p_token_expiry timestamptz DEFAULT NULL)
RETURNS TABLE(staff_id uuid,last_seen_at timestamptz,expires_at timestamptz) LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$
 UPDATE erp_private.pilot_sessions p SET last_seen_at=CASE WHEN p_activity_age_ms IS NULL THEN p.last_seen_at ELSE greatest(p.last_seen_at,now()-p_activity_age_ms*interval '1 millisecond') END,expires_at=coalesce(p_token_expiry,p.expires_at)
 FROM erp_private.staff_members s,auth.sessions a WHERE p.session_id=p_session AND p.staff_id=s.staff_id AND a.id=p.session_id AND a.user_id=s.auth_user_id
 AND s.auth_user_id=p_user AND s.access_status='Active' AND s.deleted_at IS NULL AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date)
 AND p.revoked_at IS NULL AND (p_token_expiry>now() OR p.expires_at>now()) AND p.issued_at>=s.sessions_invalid_before AND (p_activity_age_ms IS NULL OR p_activity_age_ms>=0)
 RETURNING p.staff_id,p.last_seen_at,p.expires_at
$$;
CREATE OR REPLACE FUNCTION erp_private.actor() RETURNS erp_private.staff_members LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s FROM erp_private.staff_members s JOIN erp_private.pilot_sessions p ON p.staff_id=s.staff_id JOIN auth.sessions a ON a.id=p.session_id AND a.user_id=s.auth_user_id
 WHERE auth.uid() IS NOT NULL AND s.auth_user_id=auth.uid() AND p.session_id=(auth.jwt()->>'session_id')::uuid AND s.access_status='Active' AND s.deleted_at IS NULL
 AND (s.contract_end_date IS NULL OR s.contract_end_date >= (now() AT TIME ZONE 'Africa/Nairobi')::date) AND p.revoked_at IS NULL AND p.expires_at>now() AND p.issued_at>=s.sessions_invalid_before LIMIT 1
$$;
CREATE TABLE erp_private.notification_reads (
 notification_id uuid NOT NULL REFERENCES erp_private.notifications,staff_id uuid NOT NULL REFERENCES erp_private.staff_members,read_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(notification_id,staff_id)
);
ALTER TABLE erp_private.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.notification_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY reads_self ON erp_private.notification_reads FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id);
CREATE POLICY reads_add ON erp_private.notification_reads FOR INSERT TO erp_api WITH CHECK(staff_id=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.notifications n WHERE n.notification_id=notification_reads.notification_id AND n.recipient_id=staff_id));
GRANT SELECT,INSERT ON erp_private.notification_reads TO erp_api;
REVOKE ALL ON erp_private.notification_reads FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX notification_reads_staff_idx ON erp_private.notification_reads(staff_id);
CREATE TABLE erp_private.staff_presence (
 staff_id uuid PRIMARY KEY REFERENCES erp_private.staff_members,session_id uuid NOT NULL,last_seen_at timestamptz NOT NULL DEFAULT now(),last_activity_at timestamptz NOT NULL DEFAULT now(),manual_status text NOT NULL DEFAULT 'Auto' CHECK(manual_status IN ('Auto','Break','Meeting')),break_started_at timestamptz
);
CREATE TABLE erp_private.task_timers (
 staff_id uuid PRIMARY KEY REFERENCES erp_private.staff_members,task_id uuid NOT NULL REFERENCES erp_private.tasks,started_at timestamptz NOT NULL DEFAULT now(),stopped_at timestamptz,paused_at timestamptz,paused_seconds integer NOT NULL DEFAULT 0 CHECK(paused_seconds>=0),
 status text NOT NULL DEFAULT 'Running' CHECK(status IN ('Running','Stopped','Needs review')),timesheet_id uuid REFERENCES erp_private.timesheets,notes text,revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_timer_task_idx ON erp_private.task_timers(task_id);
CREATE INDEX task_timer_timesheet_idx ON erp_private.task_timers(timesheet_id) WHERE timesheet_id IS NOT NULL;
ALTER TABLE erp_private.attendance ADD COLUMN review_required boolean NOT NULL DEFAULT false,ADD COLUMN auto_clocked_out boolean NOT NULL DEFAULT false,ADD COLUMN recorded_break_seconds integer NOT NULL DEFAULT 0 CHECK(recorded_break_seconds>=0);
ALTER TABLE erp_private.attendance ALTER COLUMN break_minutes SET DEFAULT 0;
DO $$DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['staff_presence','task_timers'] LOOP
 EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY self_read ON erp_private.%I FOR SELECT TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.manages(staff_id)))',t);
 EXECUTE format('CREATE POLICY self_write ON erp_private.%I FOR ALL TO erp_api USING(staff_id=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.manages(staff_id))) WITH CHECK(staff_id=(erp_private.actor()).staff_id OR (erp_private.is_leader() AND erp_private.manages(staff_id)))',t);
 END LOOP;END;$$;
CREATE TRIGGER timer_revision BEFORE UPDATE ON erp_private.task_timers FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER timer_audit AFTER INSERT OR UPDATE ON erp_private.task_timers FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('staff_id');
CREATE TRIGGER timer_no_delete BEFORE DELETE ON erp_private.task_timers FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
GRANT SELECT,INSERT,UPDATE ON erp_private.staff_presence,erp_private.task_timers TO erp_api;
REVOKE ALL ON erp_private.staff_presence,erp_private.task_timers FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION erp_private.attendance_timer_close() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL THEN UPDATE erp_private.task_timers SET stopped_at=NEW.clock_out,status='Needs review',notes='Attendance ended before the task timer was reviewed. Confirm actual time manually.' WHERE staff_id=NEW.staff_id AND status='Running';END IF;RETURN NEW;END;$$;
CREATE TRIGGER attendance_timer_close AFTER UPDATE ON erp_private.attendance FOR EACH ROW EXECUTE FUNCTION erp_private.attendance_timer_close();
REVOKE ALL ON FUNCTION erp_private.attendance_timer_close() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.attendance_timer_close() TO erp_api;
CREATE FUNCTION erp_private.close_missed_attendance() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r record;cutoff timestamptz;n integer:=0;
BEGIN FOR r IN SELECT a.*,p.last_activity_at FROM erp_private.attendance a LEFT JOIN erp_private.staff_presence p USING(staff_id) WHERE a.clock_in IS NOT NULL AND a.clock_out IS NULL AND a.deleted_at IS NULL AND a.work_date<(now() AT TIME ZONE 'Africa/Nairobi')::date FOR UPDATE OF a LOOP
 cutoff:=greatest(r.clock_in,least(coalesce(r.last_activity_at,r.clock_in),(r.work_date+time '23:59:59') AT TIME ZONE 'Africa/Nairobi'));
 UPDATE erp_private.attendance SET clock_out=cutoff,break_minutes=least(break_minutes,floor(extract(epoch FROM cutoff-clock_in)/60)::integer),status='Missed punch',review_required=true,auto_clocked_out=true,reviewed_by=null,reason='Estimated from last known ERP activity. Manager must confirm actual attendance.' WHERE attendance_id=r.attendance_id;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,'Attendance was closed with an estimated time. Request Manager review.','auto-clock-out:'||r.attendance_id) ON CONFLICT DO NOTHING;n:=n+1;
 END LOOP;RETURN n;END;$$;
REVOKE ALL ON FUNCTION erp_private.close_missed_attendance() FROM PUBLIC,anon,authenticated,service_role,erp_api;
SELECT cron.schedule('pcl-missed-attendance','*/5 * * * *','select erp_private.close_missed_attendance();');
