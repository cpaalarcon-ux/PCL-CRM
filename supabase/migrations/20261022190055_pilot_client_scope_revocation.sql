-- Removing a firm's access must also remove access to client profiles created by that manager.
CREATE OR REPLACE FUNCTION erp_private.client_allowed(c uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.clients x WHERE x.client_id=c AND x.deleted_at IS NULL
 AND (erp_private.actor()).category_code<>'INTERN' AND
 ((erp_private.actor()).category_code='PARTNER' OR
 (x.owner_staff_id=(erp_private.actor()).staff_id AND (
 NOT EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL) OR
 EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c AND l.deleted_at IS NULL AND erp_private.firm_allowed(l.firm_id)))) OR
 EXISTS(SELECT 1 FROM erp_private.projects e WHERE e.client_id=c AND erp_private.project_allowed(e.project_id)) OR
 (erp_private.is_leader() AND EXISTS(SELECT 1 FROM erp_private.client_firm_links l
 JOIN erp_private.staff_firm_access a ON a.firm_id=l.firm_id
 WHERE l.client_id=c AND l.deleted_at IS NULL AND a.deleted_at IS NULL AND a.staff_id=(erp_private.actor()).staff_id AND a.scope='Firm'))))
$$;
