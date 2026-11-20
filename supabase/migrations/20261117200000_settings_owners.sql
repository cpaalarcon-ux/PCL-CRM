-- Settings owners and the register's client name (build 2839).
-- A Partner confirms who owns each settings section. A confirmation is never edited: confirming a different owner ends the earlier one (who ended it and when are kept) and adds a new row.
-- An owner is information for staff: it says who prepares, reviews and approves a section. It changes nobody's rights, and the person who prepared a record still never approves it.
CREATE TABLE erp_private.settings_section_owners(
 owner_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 section_key text NOT NULL CHECK(section_key ~ '^[a-z_]{3,60}$'),
 owner_role text NOT NULL CHECK(owner_role IN('PARTNER','TAX_LEAD','MANAGER','FINANCE','HR','SYSADMIN')),
 owner_staff_id uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 500),
 confirmed_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ended_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((ended_by IS NULL)=(ended_at IS NULL))
);
CREATE UNIQUE INDEX settings_section_owners_open_idx ON erp_private.settings_section_owners(section_key) WHERE ended_at IS NULL;
CREATE INDEX settings_section_owners_staff_idx ON erp_private.settings_section_owners(owner_staff_id) WHERE owner_staff_id IS NOT NULL;
CREATE INDEX settings_section_owners_confirmed_idx ON erp_private.settings_section_owners(confirmed_by);
CREATE INDEX settings_section_owners_ended_idx ON erp_private.settings_section_owners(ended_by) WHERE ended_by IS NOT NULL;
ALTER TABLE erp_private.settings_section_owners ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.settings_section_owners FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.settings_section_owners FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON erp_private.settings_section_owners TO erp_api;
CREATE POLICY own_read ON erp_private.settings_section_owners FOR SELECT TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE POLICY own_insert ON erp_private.settings_section_owners FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND confirmed_by=(erp_private.actor()).staff_id AND ended_at IS NULL);
CREATE POLICY own_update ON erp_private.settings_section_owners FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.settings_section_owners FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.settings_section_owners FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('owner_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.settings_section_owners FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
-- Only the end of a confirmation may change on an existing row.
CREATE FUNCTION erp_private.settings_owner_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended owner confirmation cannot change.' USING ERRCODE='23514'; END IF;
 IF NEW.section_key IS DISTINCT FROM OLD.section_key OR NEW.owner_role IS DISTINCT FROM OLD.owner_role OR NEW.owner_staff_id IS DISTINCT FROM OLD.owner_staff_id OR NEW.note IS DISTINCT FROM OLD.note
  OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
  RAISE EXCEPTION 'A confirmed owner is never edited. Confirm a new owner instead; the earlier one is ended and kept.' USING ERRCODE='23514'; END IF;
 IF NEW.ended_at IS NULL THEN RAISE EXCEPTION 'Only ending a confirmation is allowed.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER owner_guard BEFORE UPDATE ON erp_private.settings_section_owners FOR EACH ROW EXECUTE FUNCTION erp_private.settings_owner_guard();

CREATE OR REPLACE FUNCTION erp_private.settings_register()
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
   'extra',jsonb_build_object('client_id',m.client_id,'client_name',c.company_name,'module',m.module,'account_code',m.erp_account_code,'side',m.side))
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
REVOKE EXECUTE ON FUNCTION erp_private.settings_register() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.settings_register() TO erp_api;
