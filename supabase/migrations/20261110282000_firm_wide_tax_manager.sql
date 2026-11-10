-- Build 2772: firm-wide Tax Managers, as many as the firm needs. The Partner's answers of 10 Nov 2026 23:15 and 23:17: choose a Tax Manager once so that he handles
-- all clients, instead of choosing per client engagement, and a firm may have many (larger firms have many staff). An assignment with no engagement (project_id NULL)
-- covers every client and engagement. The per-engagement assignments from build 2770 keep working, and an engagement may now have several Tax Managers.
-- The only limit is that one person is not assigned twice to the same scope. Nothing here approves a rule or switches a permission on.
ALTER TABLE erp_private.engagement_tax_managers ALTER COLUMN project_id DROP NOT NULL;
DROP INDEX erp_private.engagement_tax_manager_one_live;
CREATE UNIQUE INDEX engagement_tax_manager_one_per_scope ON erp_private.engagement_tax_managers(staff_id,coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE ended_at IS NULL;
COMMENT ON COLUMN erp_private.engagement_tax_managers.project_id IS 'NULL means the Tax Manager of the whole firm: every client and engagement.';

-- A firm-wide row has no engagement to test, so the read rule lets a Partner or Manager see it.
DROP POLICY engagement_tax_managers_read ON erp_private.engagement_tax_managers;
CREATE POLICY engagement_tax_managers_read ON erp_private.engagement_tax_managers FOR SELECT TO erp_api
 USING((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND (project_id IS NULL OR erp_private.project_allowed(project_id)));

CREATE OR REPLACE FUNCTION erp_private.tax_manager_assign(p_project uuid,p_staff uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;t erp_private.staff_members;rid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner assigns the Tax Manager.' USING ERRCODE='42501'; END IF;
 IF p_project IS NOT NULL AND NOT erp_private.project_allowed(p_project) THEN RAISE EXCEPTION 'That engagement is unavailable to your account.' USING ERRCODE='42501'; END IF;
 SELECT * INTO t FROM erp_private.staff_members WHERE staff_id=p_staff AND deleted_at IS NULL;
 IF t.staff_id IS NULL OR t.access_status<>'Active' THEN RAISE EXCEPTION 'Choose an active staff member.' USING ERRCODE='23514'; END IF;
 IF t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'The Tax Manager is a Manager. A Supervisor, Assistant or Intern cannot hold this role.' USING ERRCODE='23514'; END IF;
 IF char_length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why this Manager is the Tax Manager (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.engagement_tax_managers WHERE staff_id=p_staff AND project_id IS NOT DISTINCT FROM p_project AND ended_at IS NULL) THEN RAISE EXCEPTION 'That Manager is already a Tax Manager for this scope. Choose another Manager or another engagement.' USING ERRCODE='23505'; END IF;
 INSERT INTO erp_private.engagement_tax_managers(project_id,staff_id,assigned_by,reason) VALUES(p_project,p_staff,a.staff_id,btrim(p_reason)) RETURNING assignment_id INTO rid;
 RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION erp_private.tax_manager_end(p_assignment uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;g erp_private.engagement_tax_managers;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner ends a Tax Manager assignment.' USING ERRCODE='42501'; END IF;
 SELECT * INTO g FROM erp_private.engagement_tax_managers WHERE assignment_id=p_assignment AND ended_at IS NULL FOR UPDATE;
 IF g.assignment_id IS NULL THEN RAISE EXCEPTION 'That assignment is not current.' USING ERRCODE='23514'; END IF;
 IF g.project_id IS NOT NULL AND NOT erp_private.project_allowed(g.project_id) THEN RAISE EXCEPTION 'That engagement is unavailable to your account.' USING ERRCODE='42501'; END IF;
 IF char_length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why the assignment ends (at least 10 characters).' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.engagement_tax_managers SET ended_at=now(),ended_by=a.staff_id,end_reason=btrim(p_reason) WHERE assignment_id=p_assignment;
END $$;

-- The gate: a firm-wide assignment counts, as does any current engagement assignment. Everything else is as in build 2770 / 2771.
CREATE OR REPLACE FUNCTION erp_private.tax_rules_approver() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND (
  EXISTS(SELECT 1 FROM erp_private.staff_capabilities x
         WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability='APPROVE_TAX_RULES' AND x.deleted_at IS NULL
          AND (x.expires_on IS NULL OR x.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date))
  OR ((erp_private.actor()).category_code='MANAGER'
      AND EXISTS(SELECT 1 FROM erp_private.tax_role_permissions rp WHERE rp.permission_key='APPROVE_TAX_RULES' AND rp.role_code='TAX_MANAGER' AND rp.allowed)
      AND EXISTS(SELECT 1 FROM erp_private.engagement_tax_managers e LEFT JOIN erp_private.projects p ON p.project_id=e.project_id
                 WHERE e.staff_id=(erp_private.actor()).staff_id AND e.ended_at IS NULL AND (e.project_id IS NULL OR p.deleted_at IS NULL))))
$$;
