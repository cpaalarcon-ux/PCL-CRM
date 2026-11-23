-- Manager staff scope (access alignment, step 4).
-- A Manager could only see and manage staff who report to her, so a Manager with no direct reports saw nobody on Staff & access and could not
-- assign or reassign anyone. A Manager now also sees and manages every active Supervisor, Assistant and Intern who shares an active firm with her.
-- Partners and other Managers are never reached this way. Only the staff list, firm links, staff updates and the area and right restrictions move.
-- Attendance, leave, credentials, performance reviews and pay rates keep the reporting-line check, because they hold more sensitive data.
CREATE FUNCTION erp_private.manager_staff_scope(target uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((erp_private.actor()).category_code='MANAGER',false) AND target<>(erp_private.actor()).staff_id AND EXISTS(
  SELECT 1 FROM erp_private.staff_members t
  WHERE t.staff_id=target AND t.deleted_at IS NULL AND t.category_code IN ('SUPERVISOR','ASSISTANT','INTERN')
   AND EXISTS(SELECT 1 FROM erp_private.staff_firm_access ta
    JOIN erp_private.staff_firm_access aa ON aa.firm_id=ta.firm_id AND aa.staff_id=(erp_private.actor()).staff_id AND aa.deleted_at IS NULL
    JOIN erp_private.firms f ON f.firm_id=ta.firm_id AND f.deleted_at IS NULL AND f.is_active
    WHERE ta.staff_id=t.staff_id AND ta.deleted_at IS NULL))
$$;
REVOKE ALL ON FUNCTION erp_private.manager_staff_scope(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.manager_staff_scope(uuid) TO erp_api;

ALTER POLICY staff_read ON erp_private.staff_members USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR erp_private.is_admin() OR erp_private.manager_staff_scope(staff_id)));
ALTER POLICY staff_update ON erp_private.staff_members USING(erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id) OR (erp_private.is_admin() AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN'))) WITH CHECK(
 (erp_private.actor()).category_code='PARTNER'
 OR ((erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id)) AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN'))
 OR (erp_private.is_admin() AND category_code IN ('SUPERVISOR','ASSISTANT','INTERN')));
ALTER POLICY staff_firms_read ON erp_private.staff_firm_access USING(deleted_at IS NULL AND (staff_id=(erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id))) AND (erp_private.firm_allowed(firm_id) OR erp_private.is_admin()));
ALTER POLICY staff_firms_write ON erp_private.staff_firm_access
 USING(((erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id)) AND erp_private.firm_allowed(firm_id)) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id)))
 WITH CHECK(((erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id)) AND erp_private.firm_allowed(firm_id)) OR (erp_private.is_admin() AND erp_private.staff_is_ordinary(staff_id)));
ALTER POLICY staff_area_restrictions_read ON erp_private.staff_area_restrictions USING (staff_id = (erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id));
ALTER POLICY staff_area_restrictions_insert ON erp_private.staff_area_restrictions WITH CHECK ((erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id)) AND created_by = (erp_private.actor()).staff_id);
ALTER POLICY staff_area_restrictions_delete ON erp_private.staff_area_restrictions USING (erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id));
ALTER POLICY staff_right_restrictions_read ON erp_private.staff_right_restrictions USING (staff_id = (erp_private.actor()).staff_id OR erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id));
ALTER POLICY staff_right_restrictions_insert ON erp_private.staff_right_restrictions WITH CHECK ((erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id)) AND created_by = (erp_private.actor()).staff_id);
ALTER POLICY staff_right_restrictions_delete ON erp_private.staff_right_restrictions USING (erp_private.manages(staff_id) OR erp_private.manager_staff_scope(staff_id));
