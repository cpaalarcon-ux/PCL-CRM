-- Build 2836: an Engagement Partner outranks the Tax Manager. Anyone who may confirm or approve a tax rule may be overruled in rank by a Partner, so a Partner now passes the
-- same gate. This replaces the 10 Nov 2026 rule that kept VAT, credit (withholding tax) and excise rules away from a Partner who did not also hold the Tax Lead right.
-- Unchanged: the person who prepared a rule still cannot confirm or approve it (tax_rule_lead_guard), a Manager still needs the Tax Manager assignment with the permission
-- switched on, and every approval is recorded under the approver's own name.
CREATE OR REPLACE FUNCTION erp_private.tax_rules_approver() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND (
  (erp_private.actor()).category_code='PARTNER'
  OR EXISTS(SELECT 1 FROM erp_private.staff_capabilities x
         WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability='APPROVE_TAX_RULES' AND x.deleted_at IS NULL
          AND (x.expires_on IS NULL OR x.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date))
  OR ((erp_private.actor()).category_code='MANAGER'
      AND EXISTS(SELECT 1 FROM erp_private.tax_role_permissions rp WHERE rp.permission_key='APPROVE_TAX_RULES' AND rp.role_code='TAX_MANAGER' AND rp.allowed)
      AND EXISTS(SELECT 1 FROM erp_private.engagement_tax_managers e LEFT JOIN erp_private.projects p ON p.project_id=e.project_id
                 WHERE e.staff_id=(erp_private.actor()).staff_id AND e.ended_at IS NULL AND (e.project_id IS NULL OR p.deleted_at IS NULL))))
$$;

CREATE OR REPLACE FUNCTION erp_private.tax_rule_lead_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
 IF NEW.tax_type IN('VAT','Withholding tax','Excise duty') AND (
    (NEW.status='Approved' AND OLD.status IS DISTINCT FROM 'Approved')
    OR (NEW.legal_review_status='Confirmed' AND OLD.legal_review_status IS DISTINCT FROM 'Confirmed')) THEN
  IF NOT erp_private.tax_rules_approver() THEN
   RAISE EXCEPTION '% rules can only be confirmed and approved by an Engagement Partner or by the designated Tax Manager who holds the APPROVE_TAX_RULES permission.',CASE WHEN NEW.tax_type='Excise duty' THEN 'Excise duty' ELSE 'VAT and credit' END USING ERRCODE='42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NEW.created_by=(erp_private.actor()).staff_id THEN
   RAISE EXCEPTION 'The person who prepared this tax rule cannot confirm or approve it.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
