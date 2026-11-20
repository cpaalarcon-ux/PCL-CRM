-- Settings hub (build 2787): one read-only question that counts, for each settings section, how many entries are still a default that nobody has confirmed
-- and how many things wait for someone to approve them. It reads counts only and changes nothing. Settings that belong to restricted files are deliberately not included.
CREATE FUNCTION erp_private.settings_hub()
RETURNS TABLE(section_key text,pending integer,total integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RETURN; END IF;
 RETURN QUERY
 SELECT 'kra_checks',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*)::integer FROM erp_private.kra_check_settings
 UNION ALL SELECT 'deadline_windows',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*)::integer FROM erp_private.deadline_settings
 UNION ALL SELECT 'annual_due_rules',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*)::integer FROM erp_private.annual_due_rules
 UNION ALL SELECT 'incoming_review',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*)::integer FROM erp_private.incoming_settings
 UNION ALL SELECT 'licences',(SELECT count(*) FILTER(WHERE rule_status='Suggested') FROM erp_private.licence_types)::integer+(SELECT count(*) FILTER(WHERE rule_status='Suggested') FROM erp_private.licence_expectations)::integer,
   (SELECT count(*) FILTER(WHERE rule_status<>'Retired') FROM erp_private.licence_types)::integer+(SELECT count(*) FILTER(WHERE rule_status<>'Retired') FROM erp_private.licence_expectations)::integer
 UNION ALL SELECT 'service_profiles',(SELECT count(*) FILTER(WHERE rule_status='Suggested') FROM erp_private.service_checklist_items)::integer+(SELECT count(*) FILTER(WHERE rule_status='Suggested') FROM erp_private.service_references)::integer,
   (SELECT count(*) FILTER(WHERE rule_status<>'Retired') FROM erp_private.service_checklist_items)::integer+(SELECT count(*) FILTER(WHERE rule_status<>'Retired') FROM erp_private.service_references)::integer
 UNION ALL SELECT 'aup_library',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*) FILTER(WHERE rule_status<>'Retired')::integer FROM erp_private.aup_procedure_library
 UNION ALL SELECT 'kyc_rules',count(*) FILTER(WHERE rule_status='Testing')::integer,count(*) FILTER(WHERE rule_status<>'Retired')::integer FROM erp_private.kyc_evidence_rules
 UNION ALL SELECT 'tax_defaults',count(*) FILTER(WHERE rule_status='Suggested')::integer,count(*)::integer FROM erp_private.legal_structure_tax_defaults
 UNION ALL SELECT 'approve_policies',count(*) FILTER(WHERE status='Pending')::integer,count(*)::integer FROM erp_private.system_policies
 UNION ALL SELECT 'approve_tax_rates',count(*) FILTER(WHERE status='Draft')::integer,count(*)::integer FROM erp_private.tax_rates
 UNION ALL SELECT 'approve_chart',count(*) FILTER(WHERE status='Draft')::integer,count(*)::integer FROM erp_private.account_catalog
 UNION ALL SELECT 'approve_statement_lines',count(*) FILTER(WHERE status='Draft')::integer,count(*)::integer FROM erp_private.account_statement_map
 UNION ALL SELECT 'approve_bank_rules',count(*) FILTER(WHERE r.status='Proposed')::integer,count(*) FILTER(WHERE r.status<>'Retired')::integer FROM erp_private.bank_mapping_rules r WHERE erp_private.client_allowed(r.client_id);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.settings_hub() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.settings_hub() TO erp_api;
