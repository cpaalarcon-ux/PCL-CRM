-- Closing yesterday's attendance must not stop today's task timer.
CREATE OR REPLACE FUNCTION erp_private.attendance_timer_close() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF OLD.clock_out IS NULL AND NEW.clock_out IS NOT NULL THEN
 UPDATE erp_private.task_timers SET stopped_at=NEW.clock_out,status='Needs review',notes='Attendance ended before the task timer was reviewed. Confirm actual time manually.'
 WHERE staff_id=NEW.staff_id AND status='Running' AND (started_at AT TIME ZONE 'Africa/Nairobi')::date=OLD.work_date;
END IF;RETURN NEW;END;$$;
CREATE OR REPLACE FUNCTION erp_private.close_missed_attendance() RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r record;cutoff timestamptz;n integer:=0;
BEGIN FOR r IN SELECT a.*,p.last_activity_at FROM erp_private.attendance a LEFT JOIN erp_private.staff_presence p USING(staff_id) WHERE a.clock_in IS NOT NULL AND a.clock_out IS NULL AND a.deleted_at IS NULL AND a.work_date<(now() AT TIME ZONE 'Africa/Nairobi')::date FOR UPDATE OF a LOOP
 cutoff:=greatest(r.clock_in,least(coalesce(r.last_activity_at,r.clock_in),(r.work_date+time '23:59:59') AT TIME ZONE 'Africa/Nairobi'));
 UPDATE erp_private.attendance SET clock_out=cutoff,break_minutes=least(break_minutes,floor(extract(epoch FROM cutoff-clock_in)/60)::integer),status='Missed punch',review_required=true,auto_clocked_out=true,reviewed_by=null,reason='Estimated from last known ERP activity. Manager must confirm actual attendance.' WHERE attendance_id=r.attendance_id;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(r.staff_id,'Attendance was closed with an estimated time. Request Manager review.','auto-clock-out:'||r.attendance_id) ON CONFLICT DO NOTHING;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 SELECT DISTINCT m.staff_id,'Review estimated clock-out for '||s.full_name||'. Confirm actual attendance before reporting.','auto-clock-out-manager:'||r.attendance_id||':'||m.staff_id
 FROM erp_private.staff_members s JOIN erp_private.staff_members m ON m.staff_id=s.manager_id OR
 (s.manager_id IS NULL AND m.category_code='PARTNER' AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access sf JOIN erp_private.staff_firm_access mf USING(firm_id) WHERE sf.staff_id=s.staff_id AND mf.staff_id=m.staff_id))
 WHERE s.staff_id=r.staff_id AND m.access_status='Active' AND m.deleted_at IS NULL AND m.staff_id<>s.staff_id ON CONFLICT DO NOTHING;n:=n+1;
 END LOOP;RETURN n;END;$$;
