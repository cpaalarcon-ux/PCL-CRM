-- Settings register (build 2837): one read-only list of every configuration record that has a lifecycle, and the change history behind it.
-- Reads only. It changes no record and no status. Managers and Partners only; anyone else gets nothing.
-- Per-client records (client mappings, client chart versions) belong to Client > Setup, so only the firm-wide settings are listed here.
CREATE FUNCTION erp_private.settings_register()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members; r jsonb;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RETURN '[]'::jsonb; END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY x->>'area',x->>'label'),'[]'::jsonb) INTO r FROM (
  SELECT jsonb_build_object('area','tax_rate','record_id',t.rate_id::text,'group_key',t.rate_key,'label',t.label,'code',t.rate_key,'native_status',t.status,'version',NULL,
   'effective_from',t.effective_from,'effective_to',t.effective_to,'expires_on',NULL,'approved_by',erp_private.staff_name(t.approved_by),'approved_at',t.approved_at,'prepared_by',erp_private.staff_name(t.created_by),'revision',t.revision,
   'extra',jsonb_build_object('has_figures',(t.parameters IS NOT NULL AND t.parameters<>'{}'::jsonb),'legal_review_status',t.legal_review_status,'has_source',(COALESCE(btrim(t.source_url),'')<>'' OR COALESCE(btrim(t.source_note),'')<>''),'tax_type',t.tax_type,'is_test',COALESCE(t.is_test,false))) x
   FROM erp_private.tax_rates t WHERE t.deleted_at IS NULL
  UNION ALL
  SELECT jsonb_build_object('area','service_template','record_id',s.template_id::text,'group_key',s.template_code,'label',s.name,'code',s.template_code,'native_status',s.status,'version',s.version,
   'effective_from',NULL,'effective_to',NULL,'expires_on',NULL,'approved_by',erp_private.staff_name(s.approved_by),'approved_at',s.approved_at,'prepared_by',erp_private.staff_name(s.proposed_by),'revision',s.revision,'extra','{}'::jsonb)
   FROM erp_private.service_templates s
  UNION ALL
  SELECT jsonb_build_object('area','export_profile','record_id',p.profile_id::text,'group_key',p.return_code,'label',p.return_code||' ('||p.authority||')','code',p.return_code,'native_status',p.status,'version',p.version,
   'effective_from',p.effective_from,'effective_to',p.effective_to,'expires_on',NULL,'approved_by',erp_private.staff_name(p.published_by),'approved_at',p.published_at,'prepared_by',erp_private.staff_name(p.created_by),'revision',p.revision,
   'extra',jsonb_build_object('layout_code',p.layout_code,'template_version',p.template_version,'verified_on',p.verified_on,'verified_against',p.verified_against,'ended',(p.ended_at IS NOT NULL)))
   FROM erp_private.statutory_export_profiles p
  UNION ALL
  SELECT jsonb_build_object('area','upload_template','record_id',i.template_id::text,'group_key',i.template_key,'label',i.name,'code',i.template_key,'native_status',i.status,'version',i.version,
   'effective_from',i.effective_from,'effective_to',i.effective_to,'expires_on',NULL,'approved_by',erp_private.staff_name(i.published_by),'approved_at',i.published_at,'prepared_by',erp_private.staff_name(i.created_by),'revision',i.revision,
   'extra',jsonb_build_object('importer_profile',i.importer_profile))
   FROM erp_private.import_templates i
  UNION ALL
  SELECT jsonb_build_object('area','routing_map','record_id',m.routing_id::text,'group_key',m.client_id::text||':'||m.module||':'||m.routing_code,'label',m.routing_code||' to '||m.erp_account_code||' ('||c.company_name||')','code',m.routing_code,'native_status',m.status,'version',m.version,
   'effective_from',m.effective_from,'effective_to',m.effective_to,'expires_on',NULL,'approved_by',erp_private.staff_name(m.approved_by),'approved_at',m.approved_at,'prepared_by',erp_private.staff_name(m.created_by),'revision',m.revision,
   'extra',jsonb_build_object('client_id',m.client_id,'module',m.module,'account_code',m.erp_account_code,'side',m.side))
   FROM erp_private.client_routing_map m JOIN erp_private.clients c ON c.client_id=m.client_id
  UNION ALL
  SELECT jsonb_build_object('area','eligibility','record_id',e.record_id::text,'group_key',e.service_code||':'||e.kind||':'||COALESCE(e.staff_id::text,'firm'),'label',e.service_code||' '||lower(e.kind)||' ('||e.authority||')','code',e.service_code,'native_status',e.status,'version',NULL,
   'effective_from',e.valid_from,'effective_to',NULL,'expires_on',e.expires_on,'approved_by',erp_private.staff_name(e.verified_by),'approved_at',e.verified_at,'prepared_by',erp_private.staff_name(e.recorded_by),'revision',e.revision,
   'extra',jsonb_build_object('kind',e.kind,'person',erp_private.staff_name(e.staff_id)))
   FROM erp_private.service_eligibility_records e
  UNION ALL
  SELECT jsonb_build_object('area','policy','record_id',y.policy_code,'group_key',y.policy_code,'label',y.policy_name,'code',y.policy_code,'native_status',y.status,'version',y.revision,
   'effective_from',NULL,'effective_to',NULL,'expires_on',y.review_due_date,'approved_by',erp_private.staff_name(y.signed_by),'approved_at',y.signed_at,'prepared_by',NULL,'revision',y.revision,'extra','{}'::jsonb)
   FROM erp_private.system_policies y
 ) q(x);
 RETURN r;
END; $$;

-- Change history from the audit log for the settings tables. One record (p_record_id) or the latest across all (p_record_id NULL).
CREATE FUNCTION erp_private.settings_changes(p_area text,p_record_id text,p_limit integer)
RETURNS TABLE(occurred_at timestamptz,area text,record_id text,action text,actor_name text,status_before text,status_after text,changed_fields text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RETURN; END IF;
 RETURN QUERY
 SELECT e.occurred_at,m.area,e.record_key,e.action,(SELECT s.full_name FROM erp_private.staff_members s WHERE s.auth_user_id=e.actor_auth_id LIMIT 1),
  e.before_values->>'status',e.after_values->>'status',
  CASE WHEN e.action='UPDATE' THEN ARRAY(SELECT k FROM jsonb_object_keys(e.after_values) k WHERE k NOT IN('updated_at','revision') AND e.after_values->k IS DISTINCT FROM e.before_values->k ORDER BY k) ELSE ARRAY[]::text[] END
 FROM erp_private.audit_events e
 JOIN (VALUES('tax_rates','tax_rate'),('service_templates','service_template'),('statutory_export_profiles','export_profile'),('import_templates','upload_template'),('client_routing_map','routing_map'),('service_eligibility_records','eligibility'),('system_policies','policy')) m(tbl,area) ON m.tbl=e.table_name
 WHERE (p_area IS NULL OR m.area=p_area) AND (p_record_id IS NULL OR e.record_key=p_record_id)
 ORDER BY e.occurred_at DESC
 LIMIT LEAST(GREATEST(COALESCE(p_limit,40),1),200);
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.settings_register() FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION erp_private.settings_changes(text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.settings_register() TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.settings_changes(text,text,integer) TO erp_api;
