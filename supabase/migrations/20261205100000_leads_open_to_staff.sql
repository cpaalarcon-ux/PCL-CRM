-- Leads are open to Assistants and Supervisors as well as Managers and Partners.
-- Visibility is unchanged in shape: Partners see every lead in their firms; everyone else sees the leads they own,
-- their reports' leads (Managers only) and any lead in a firm where they hold Firm-wide access.
-- Assistants add leads; Supervisors, Managers and Partners also update them (framework sections 4 and 15.8).
-- Converting a lead into a client stays with Managers and Partners (enforced in the Edge function and by clients_insert).
DROP POLICY leads_read ON erp_private.leads;
DROP POLICY leads_add ON erp_private.leads;
DROP POLICY leads_update ON erp_private.leads;
CREATE POLICY leads_read ON erp_private.leads FOR SELECT TO erp_api USING(deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture)
 AND coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT'),false)
 AND erp_private.firm_allowed(firm_id)
 AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id
 OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a
 WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm')));
CREATE POLICY leads_add ON erp_private.leads FOR INSERT TO erp_api WITH CHECK(
 coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR','ASSISTANT'),false)
 AND erp_private.firm_allowed(firm_id) AND owner_id=(erp_private.actor()).staff_id AND stage<>'Converted' AND client_id IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture));
CREATE POLICY leads_update ON erp_private.leads FOR UPDATE TO erp_api USING(deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture)
 AND coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR'),false)
 AND erp_private.firm_allowed(firm_id)
 AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id
 OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a
 WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm')))
 WITH CHECK(coalesce((erp_private.actor()).category_code IN ('PARTNER','MANAGER','SUPERVISOR'),false)
 AND erp_private.firm_allowed(firm_id)
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture));
