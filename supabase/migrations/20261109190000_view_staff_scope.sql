-- View Staff: who a signed-in person may look at in Time & Attendance, Team & HR and Projects & Tasks.
--  * Assistants, Interns and Administrators: only themselves. Any person asked for is ignored.
--  * Supervisors: themselves and everyone who reports to them, directly or through others (the "reports to" field).
--    Asking for anyone else is refused.
--  * Managers and Partners: every active member of staff except system administrators.
-- Pass NULL for the whole group the role may see ("My Team" for a Supervisor, "All Staff" for a Manager or Partner).
CREATE OR REPLACE FUNCTION erp_private.view_staff_ids(p_target uuid DEFAULT NULL) RETURNS TABLE(staff_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 IF a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RETURN QUERY SELECT a.staff_id; RETURN; END IF;
 IF a.category_code='SUPERVISOR' THEN
  RETURN QUERY WITH RECURSIVE down AS (
    SELECT s.staff_id FROM erp_private.staff_members s WHERE s.manager_id=a.staff_id AND s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'ADMIN'
    UNION SELECT s.staff_id FROM erp_private.staff_members s JOIN down d ON s.manager_id=d.staff_id WHERE s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'ADMIN'),
   everyone AS (SELECT a.staff_id UNION SELECT d.staff_id FROM down d)
   SELECT e.staff_id FROM everyone e WHERE p_target IS NULL OR e.staff_id=p_target;
  IF p_target IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'That person is not in your team' USING ERRCODE='42501'; END IF;
  RETURN;
 END IF;
 RETURN QUERY SELECT s.staff_id FROM erp_private.staff_members s WHERE s.deleted_at IS NULL AND s.access_status='Active' AND s.category_code<>'ADMIN' AND (p_target IS NULL OR s.staff_id=p_target);
 IF p_target IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'That person is not available' USING ERRCODE='22023'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.view_staff_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.view_staff_ids(uuid) TO erp_api;

-- The people the dropdown offers (always the same set the scope function allows).
CREATE OR REPLACE FUNCTION erp_private.view_staff_options() RETURNS TABLE(staff_id uuid,full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.staff_id,s.full_name,s.category_code FROM erp_private.staff_members s WHERE s.staff_id IN(SELECT v.staff_id FROM erp_private.view_staff_ids(NULL) v) ORDER BY s.full_name
$$;
REVOKE EXECUTE ON FUNCTION erp_private.view_staff_options() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.view_staff_options() TO erp_api;
