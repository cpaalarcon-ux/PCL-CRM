-- Team workload (staging). One read for Team & HR: each person the caller oversees, their active and overdue tasks, whether they are on
-- approved leave today, and a red-flag when they hold more than 15 active tasks. It is an alert only; nothing is blocked.
-- SECURITY INVOKER: the existing row-level rules decide which people and tasks the caller can see, so a Manager sees only their own team.
CREATE FUNCTION erp_private.team_workload() RETURNS TABLE(staff_id uuid,full_name text,category_code text,active_tasks integer,overdue_tasks integer,on_leave boolean,is_overloaded boolean)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'Supervisor, Manager or Partner required' USING ERRCODE='42501'; END IF;
 RETURN QUERY
 SELECT s.staff_id,s.full_name,s.category_code,
  coalesce(t.active,0)::integer,coalesce(t.overdue,0)::integer,
  EXISTS(SELECT 1 FROM erp_private.leave_requests l WHERE l.staff_id=s.staff_id AND l.status='Approved' AND l.deleted_at IS NULL AND (now() AT TIME ZONE 'Africa/Nairobi')::date BETWEEN l.starts_on AND l.ends_on),
  coalesce(t.active,0)>15
 FROM erp_private.staff_members s
 LEFT JOIN LATERAL (SELECT count(*) active,count(*) FILTER (WHERE k.due_at<now()) overdue FROM erp_private.tasks k
   WHERE k.assigned_to=s.staff_id AND k.deleted_at IS NULL AND k.status NOT IN ('Completed','Cancelled')) t ON true
 WHERE s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'ADMIN'
 ORDER BY coalesce(t.active,0) DESC,s.full_name;
END $$;
REVOKE ALL ON FUNCTION erp_private.team_workload() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.team_workload() TO erp_api;
