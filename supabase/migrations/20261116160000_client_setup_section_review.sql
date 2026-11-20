-- Build 2828: client set-up sections are submitted for manager review without stopping the preparer.
-- A section moves Draft -> Pending Review when the preparer submits it, and the preparer carries on. A Manager or Partner who did not submit it
-- (or the sole active Partner) approves it or returns it with a comment. Approval stores a digest of the data at that moment; if the data has not
-- changed when the section is submitted again it is approved again without a second review. Nothing is deleted, every step is in an insert-only history.
-- The Chart of Accounts and Opening Trial Balance keep their own mandatory approvals; they are not sections here.
CREATE TABLE erp_private.client_setup_sections(
 section_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 section_code text NOT NULL CHECK(section_code IN('identity','registration','tax','ownership','activities','year_end','contacts','permanent_file','engagement')),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Pending Review','Approved','Correction Required')),
 source_kind text CHECK(source_kind IN('BRS','KRA','Permanent file','Client document','Other approved source')),
 source_note text,
 content_digest text,
 approved_digest text,
 unchanged_approval boolean NOT NULL DEFAULT false,
 submitted_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 submitted_at timestamptz,
 reviewed_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(client_id,section_code),
 CHECK(status NOT IN('Pending Review','Approved') OR (submitted_by IS NOT NULL AND content_digest IS NOT NULL)),
 CHECK(status<>'Approved' OR (approved_digest IS NOT NULL AND (unchanged_approval OR reviewed_by IS NOT NULL))),
 CHECK(status<>'Correction Required' OR length(btrim(coalesce(review_note,'')))>=10)
);
CREATE INDEX client_setup_sections_status_idx ON erp_private.client_setup_sections(status,client_id);
CREATE INDEX client_setup_sections_submitted_idx ON erp_private.client_setup_sections(submitted_by);
CREATE INDEX client_setup_sections_reviewed_idx ON erp_private.client_setup_sections(reviewed_by);
CREATE TABLE erp_private.client_setup_section_events(
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 section_id uuid NOT NULL REFERENCES erp_private.client_setup_sections ON DELETE RESTRICT,
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 section_code text NOT NULL,
 action text NOT NULL CHECK(action IN('Submitted','Approved','Approved unchanged','Returned')),
 status_after text NOT NULL,
 actor_id uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 note text,
 digest text,
 source_kind text,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_setup_section_events_section_idx ON erp_private.client_setup_section_events(section_id,occurred_at);
CREATE INDEX client_setup_section_events_client_idx ON erp_private.client_setup_section_events(client_id);
CREATE INDEX client_setup_section_events_actor_idx ON erp_private.client_setup_section_events(actor_id);
ALTER TABLE erp_private.client_setup_sections ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_setup_sections FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_setup_section_events ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_setup_section_events FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_setup_sections TO erp_api;
GRANT SELECT,INSERT ON erp_private.client_setup_section_events TO erp_api;
CREATE POLICY setup_sections_read ON erp_private.client_setup_sections FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN'));
CREATE POLICY setup_sections_write ON erp_private.client_setup_sections FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN'));
CREATE POLICY setup_sections_update ON erp_private.client_setup_sections FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY setup_events_read ON erp_private.client_setup_section_events FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN'));
CREATE POLICY setup_events_insert ON erp_private.client_setup_section_events FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND actor_id=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_setup_sections FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_setup_section_events FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE FUNCTION erp_private.client_setup_section_events_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN RAISE EXCEPTION 'A set-up history entry is never edited.' USING ERRCODE='23514'; END $$;
CREATE TRIGGER client_setup_section_events_no_update BEFORE UPDATE ON erp_private.client_setup_section_events FOR EACH ROW EXECUTE FUNCTION erp_private.client_setup_section_events_immutable();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_setup_sections FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('section_id');
CREATE TRIGGER change_audit AFTER INSERT ON erp_private.client_setup_section_events FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('event_id');
-- Who may move a section, enforced here as well as in the server: maker is not checker.
CREATE FUNCTION erp_private.client_setup_section_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE a record;api boolean:=current_user='erp_api';
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' AND NEW.status<>'Pending Review' THEN RAISE EXCEPTION 'A new set-up section starts as Draft or Pending Review.'; END IF;
  RETURN NEW;
 END IF;
 IF api THEN a:=erp_private.actor(); END IF;
 IF NEW.client_id<>OLD.client_id OR NEW.section_code<>OLD.section_code THEN RAISE EXCEPTION 'A set-up section cannot be moved to another client or section.'; END IF;
 IF NEW.status='Approved' AND NEW.unchanged_approval AND NEW.approved_digest IS NOT DISTINCT FROM OLD.approved_digest AND NEW.approved_digest IS NOT DISTINCT FROM NEW.content_digest THEN
  NULL;
 ELSIF NEW.status='Pending Review' THEN
  IF OLD.status NOT IN('Draft','Correction Required','Approved','Pending Review') THEN RAISE EXCEPTION 'This section cannot be submitted from %.',OLD.status; END IF;
  IF api AND NEW.submitted_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'A section is submitted by the person who prepared it.' USING ERRCODE='42501'; END IF;
 ELSIF NEW.status IN('Approved','Correction Required') AND OLD.status='Pending Review' AND NEW.reviewed_by IS NOT NULL THEN
  IF api THEN
   IF a.category_code NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner reviews a set-up section.' USING ERRCODE='42501'; END IF;
   IF NEW.reviewed_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'The reviewer on the record must be you.' USING ERRCODE='42501'; END IF;
   IF NEW.reviewed_by=OLD.submitted_by AND NOT erp_private.sole_active_partner() THEN RAISE EXCEPTION 'A different Manager or Partner reviews a section you submitted.' USING ERRCODE='42501'; END IF;
  END IF;
 ELSIF NEW.status='Approved' AND OLD.status='Approved' THEN
  NULL;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
  RAISE EXCEPTION 'A set-up section cannot go from % to %.',OLD.status,NEW.status;
 END IF;
 NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
 RETURN NEW;
END $$;
CREATE TRIGGER client_setup_section_guard BEFORE INSERT OR UPDATE ON erp_private.client_setup_sections FOR EACH ROW EXECUTE FUNCTION erp_private.client_setup_section_guard();
REVOKE ALL ON erp_private.client_setup_sections,erp_private.client_setup_section_events FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.client_setup_section_events_immutable() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.client_setup_section_guard() FROM PUBLIC,anon,authenticated;

-- A digest of what the section holds right now, so an unchanged section is not reviewed twice.
-- Volatile columns (updated_at, revision) are left out. The function reads only; it is called by the server for the section being submitted or viewed.
CREATE FUNCTION erp_private.client_setup_section_digest(p_client uuid,p_section text) RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO '' AS $$
DECLARE doc jsonb;
BEGIN
 IF p_section='identity' THEN
  SELECT jsonb_build_object('company_name',company_name,'legal_structure',legal_structure,'legal_subtype',legal_subtype,'legal_entity_type',legal_entity_type,'entity_evidence',entity_evidence,'predecessor',predecessor_client_id,'sector',primary_sector,'branch',branch_location) INTO doc FROM erp_private.clients WHERE client_id=p_client;
 ELSIF p_section='registration' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('k',field_key,'v',value) ORDER BY field_key),'[]'::jsonb) INTO doc FROM erp_private.client_field_facts WHERE client_id=p_client AND status<>'Superseded' AND field_key IN('registration_number','national_id','incorporation_date','registered_address','registration_category','business_name');
 ELSIF p_section='tax' THEN
  SELECT jsonb_build_object('pin',(SELECT kra_pin FROM erp_private.clients WHERE client_id=p_client),
   'profiles',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.profile_id::text),'[]'::jsonb) FROM erp_private.client_tax_profiles t WHERE t.client_id=p_client AND t.deleted_at IS NULL),
   'obligations',(SELECT coalesce(jsonb_agg(to_jsonb(o)-ARRAY['updated_at','revision'] ORDER BY o.obligation_id::text),'[]'::jsonb) FROM erp_private.client_tax_obligations o WHERE o.client_id=p_client)) INTO doc;
 ELSIF p_section='ownership' THEN
  SELECT jsonb_build_object('owners',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.owner_id::text),'[]'::jsonb) FROM erp_private.beneficial_owners t WHERE t.client_id=p_client AND t.deleted_at IS NULL),
   'parties',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.party_id::text),'[]'::jsonb) FROM erp_private.client_parties t WHERE t.client_id=p_client),
   'holders',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.holder_id::text),'[]'::jsonb) FROM erp_private.client_office_holders t WHERE t.client_id=p_client)) INTO doc;
 ELSIF p_section='activities' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.activity_id::text),'[]'::jsonb) INTO doc FROM erp_private.client_activities t WHERE t.client_id=p_client;
 ELSIF p_section='year_end' THEN
  SELECT jsonb_build_object('month',year_end_month,'day',year_end_day) INTO doc FROM erp_private.clients WHERE client_id=p_client;
 ELSIF p_section='contacts' THEN
  SELECT jsonb_build_object('contacts',(SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.contact_id::text),'[]'::jsonb) FROM erp_private.client_contacts t WHERE t.client_id=p_client AND t.deleted_at IS NULL),
   'facts',(SELECT coalesce(jsonb_agg(jsonb_build_object('k',field_key,'v',value) ORDER BY field_key),'[]'::jsonb) FROM erp_private.client_field_facts WHERE client_id=p_client AND status<>'Superseded' AND field_key IN('contact_person','contact_phone','contact_email'))) INTO doc;
 ELSIF p_section='permanent_file' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(t)-ARRAY['updated_at','revision'] ORDER BY t.evidence_id::text),'[]'::jsonb) INTO doc FROM erp_private.client_kyc_evidence t WHERE t.client_id=p_client AND t.deleted_at IS NULL;
 ELSIF p_section='engagement' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('project',a.project_id,'staff',a.staff_id,'role',a.role_on_job) ORDER BY a.project_id::text,a.staff_id::text),'[]'::jsonb) INTO doc FROM erp_private.project_assignments a JOIN erp_private.projects p ON p.project_id=a.project_id WHERE p.client_id=p_client AND p.deleted_at IS NULL;
 ELSE
  RAISE EXCEPTION 'Unknown set-up section %.',p_section;
 END IF;
 RETURN md5(coalesce(doc,'null'::jsonb)::text);
END $$;
REVOKE ALL ON FUNCTION erp_private.client_setup_section_digest(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.client_setup_section_digest(uuid,text) TO erp_api;
