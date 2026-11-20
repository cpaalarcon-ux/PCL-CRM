-- V3 additive controls. No historical client inference, ledger posting or live tax-rate changes.
ALTER TABLE erp_private.clients ADD COLUMN legal_entity_type text CHECK(legal_entity_type IN ('Limited company','Partnership','Sole proprietor','Other legal entity')),
 ADD COLUMN accepts_new_engagements boolean NOT NULL DEFAULT true, ADD COLUMN entity_evidence text NOT NULL DEFAULT '', ADD COLUMN year_end_month integer CHECK(year_end_month BETWEEN 1 AND 12),
 ADD COLUMN year_end_day integer CHECK(year_end_day BETWEEN 1 AND 31), ADD COLUMN predecessor_client_id uuid REFERENCES erp_private.clients;
ALTER TABLE erp_private.clients ADD CONSTRAINT client_not_own_predecessor CHECK(predecessor_client_id IS DISTINCT FROM client_id);
CREATE INDEX client_predecessor_idx ON erp_private.clients(predecessor_client_id) WHERE predecessor_client_id IS NOT NULL;
CREATE FUNCTION erp_private.entity_activation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF (TG_OP='INSERT' OR NEW.status='Active' AND OLD.status IS DISTINCT FROM 'Active') AND EXISTS(SELECT 1 FROM erp_private.clients WHERE client_id=NEW.client_id AND NOT accepts_new_engagements) THEN RAISE EXCEPTION 'This predecessor entity is closed to new engagements; retain its unfinished work and use the successor for new work' USING ERRCODE='23514';END IF;
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'Active') AND NOT EXISTS
 (SELECT 1 FROM erp_private.clients c WHERE c.client_id=NEW.client_id AND c.legal_entity_type IS NOT NULL AND length(btrim(c.entity_evidence))>=10 AND c.year_end_month IS NOT NULL AND c.year_end_day IS NOT NULL)
 THEN RAISE EXCEPTION 'Confirm legal entity type, evidence and financial year-end before activation' USING ERRCODE='23514';END IF;RETURN NEW;
END;$$;
CREATE TRIGGER entity_activation BEFORE INSERT OR UPDATE ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.entity_activation_guard();

CREATE TABLE erp_private.client_activities (
 activity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 pack_code text NOT NULL CHECK(pack_code IN ('Wholesale','Hospitality','Consultancy','Construction','Other')),
 activity_name text NOT NULL CHECK(length(btrim(activity_name))>0),income_stream text NOT NULL,
 effective_from date NOT NULL,effective_to date CHECK(effective_to>=effective_from),evidence text NOT NULL,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_client_idx ON erp_private.client_activities(client_id,effective_from);
CREATE TABLE erp_private.partner_interests (
 interest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 partner_name text NOT NULL,partner_pin text NOT NULL CHECK(partner_pin ~ '^[A-Z][0-9]{9}[A-Z]$'),recipient_type text NOT NULL CHECK(recipient_type IN ('Individual','Company','Other')),
 profit_percentage numeric(7,4) NOT NULL CHECK(profit_percentage>0 AND profit_percentage<=100),
 effective_from date NOT NULL,effective_to date NOT NULL CHECK(effective_to>=effective_from),agreement_reference text NOT NULL,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),group_id uuid NOT NULL
);
CREATE INDEX interests_client_idx ON erp_private.partner_interests(client_id,effective_from,effective_to);
CREATE TABLE erp_private.client_periods (
 period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),return_due_date date,internal_due_date date,payment_due_date date,
 deadline_rule_reference text NOT NULL,created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,starts_on,ends_on)
);
CREATE INDEX periods_client_idx ON erp_private.client_periods(client_id,ends_on);
CREATE TABLE erp_private.stock_policy_versions (
 policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 activity_id uuid NOT NULL REFERENCES erp_private.client_activities,inventory_method text NOT NULL CHECK(inventory_method IN ('Periodic','Perpetual')),
 valuation_basis text NOT NULL,effective_from date NOT NULL,count_frequency text NOT NULL CHECK(count_frequency IN ('Weekly','Monthly','Annually')),
 variance_threshold numeric(18,2) NOT NULL DEFAULT 100 CHECK(variance_threshold>=0),evidence text NOT NULL,
 configured_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(activity_id,effective_from)
);
CREATE INDEX stock_policy_client_idx ON erp_private.stock_policy_versions(client_id,activity_id,effective_from);
CREATE TABLE erp_private.stock_controls (
 control_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 activity_id uuid NOT NULL REFERENCES erp_private.client_activities,policy_id uuid NOT NULL REFERENCES erp_private.stock_policy_versions,
 stock_class text NOT NULL,starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),inputs jsonb NOT NULL DEFAULT '{}',
 result jsonb NOT NULL DEFAULT '{}',snapshot jsonb,status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Approved')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,reviewed_by uuid REFERENCES erp_private.staff_members,
 review_note text,revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by),UNIQUE(project_id,activity_id,stock_class,starts_on,ends_on)
);
CREATE INDEX stock_control_project_idx ON erp_private.stock_controls(project_id,ends_on);
CREATE TABLE erp_private.category_requests (
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,row_id uuid NOT NULL REFERENCES erp_private.workbook_rows,
 reason text NOT NULL,proposed_name text NOT NULL,evidence text NOT NULL,requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Rejected')),account_code text REFERENCES erp_private.account_catalog,
 decided_by uuid REFERENCES erp_private.staff_members,decision_note text,revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_project_idx ON erp_private.category_requests(project_id,status);
CREATE INDEX category_row_idx ON erp_private.category_requests(row_id);
CREATE TABLE erp_private.mapping_selections (
 selection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 selected_by uuid NOT NULL REFERENCES erp_private.staff_members,filters jsonb NOT NULL,rows_snapshot jsonb NOT NULL,
 totals jsonb NOT NULL,selection_hash text NOT NULL,expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',
 result jsonb,consumed_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX selections_project_idx ON erp_private.mapping_selections(project_id,selected_by);
CREATE TABLE erp_private.bank_deferrals (
 reconciliation_id uuid PRIMARY KEY REFERENCES erp_private.sales_reconciliations,project_id uuid NOT NULL REFERENCES erp_private.projects,
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,expected_on date NOT NULL,owner_id uuid NOT NULL REFERENCES erp_private.staff_members,
 evidence_id uuid NOT NULL REFERENCES erp_private.documents,reason text NOT NULL,alternative_control text NOT NULL,
 approved_by uuid NOT NULL REFERENCES erp_private.staff_members,approved_at timestamptz NOT NULL DEFAULT now(),CHECK(approved_by<>requested_by)
);
CREATE INDEX bank_defer_project_idx ON erp_private.bank_deferrals(project_id);
CREATE TABLE erp_private.bank_supplements (
 supplement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reconciliation_id uuid NOT NULL REFERENCES erp_private.sales_reconciliations,
 project_id uuid NOT NULL REFERENCES erp_private.projects,document_id uuid NOT NULL REFERENCES erp_private.documents,
 conclusion text NOT NULL,amendment_required boolean NOT NULL,prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_by uuid REFERENCES erp_private.staff_members,review_note text,status text NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Returned')),
 revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),CHECK(reviewed_by IS NULL OR reviewed_by<>prepared_by)
);
CREATE INDEX bank_supplement_project_idx ON erp_private.bank_supplements(project_id,reconciliation_id);
-- Canonical return identity is independent of invoice issuer. A new firm does not create another filing.
CREATE TABLE erp_private.tax_return_identities (
 client_id uuid NOT NULL REFERENCES erp_private.clients,kind text NOT NULL,starts_on date NOT NULL,ends_on date NOT NULL,
 case_id uuid UNIQUE REFERENCES erp_private.tax_cases,project_id uuid REFERENCES erp_private.projects,legacy_collision boolean NOT NULL DEFAULT false,
 PRIMARY KEY(client_id,kind,starts_on,ends_on)
);
-- Reserve all historical identities, leaving collisions visibly unresolved.
INSERT INTO erp_private.tax_return_identities(client_id,kind,starts_on,ends_on,case_id,project_id,legacy_collision)
SELECT p.client_id,c.kind,c.starts_on,c.ends_on,CASE WHEN count(*)=1 THEN (array_agg(c.case_id))[1] END,CASE WHEN count(*)=1 THEN (array_agg(c.project_id))[1] END,count(*)>1
FROM erp_private.tax_cases c JOIN erp_private.projects p USING(project_id) GROUP BY p.client_id,c.kind,c.starts_on,c.ends_on;
-- Historical collisions are deliberately not silently merged. New cases are protected from this release.
CREATE FUNCTION erp_private.return_identity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE cid uuid;
BEGIN
 SELECT client_id INTO cid FROM erp_private.projects WHERE project_id=NEW.project_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(cid::text||':'||NEW.kind,0));
 IF EXISTS(SELECT 1 FROM erp_private.tax_return_identities WHERE client_id=cid AND kind=NEW.kind AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) THEN RAISE EXCEPTION 'A return identity already overlaps for this client, obligation and period; use the responsible engagement' USING ERRCODE='23505';END IF;
 INSERT INTO erp_private.tax_return_identities(client_id,kind,starts_on,ends_on,case_id,project_id) VALUES(cid,NEW.kind,NEW.starts_on,NEW.ends_on,NEW.case_id,NEW.project_id);
 RETURN NEW;
END;$$;
CREATE TRIGGER canonical_identity AFTER INSERT ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.return_identity_guard();

CREATE TABLE erp_private.mapping_history (
 history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,row_id uuid NOT NULL REFERENCES erp_private.workbook_rows,
 before_mapping jsonb NOT NULL,after_revision bigint NOT NULL,changed_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mapping_history_row_idx ON erp_private.mapping_history(row_id,after_revision DESC);
CREATE FUNCTION erp_private.remember_mapping() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE prior jsonb;next jsonb;
BEGIN
 prior:=jsonb_build_object('route',OLD.route,'category_code',OLD.category_code,'account_code',OLD.account_code,'narration',OLD.narration,'asset_details',OLD.asset_details,'review_details',OLD.review_details,'first_use_status',OLD.first_use_status,'first_use_date',OLD.first_use_date);
 next:=jsonb_build_object('route',NEW.route,'category_code',NEW.category_code,'account_code',NEW.account_code,'narration',NEW.narration,'asset_details',NEW.asset_details,'review_details',NEW.review_details,'first_use_status',NEW.first_use_status,'first_use_date',NEW.first_use_date);
 IF current_setting('erp.mapping_operation',true) IS DISTINCT FROM 'undo' AND prior IS DISTINCT FROM next AND (erp_private.actor()).staff_id IS NOT NULL THEN
 INSERT INTO erp_private.mapping_history(project_id,row_id,before_mapping,after_revision,changed_by) VALUES(NEW.project_id,NEW.row_id,prior,NEW.revision,(erp_private.actor()).staff_id);
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER remember_mapping AFTER UPDATE ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.remember_mapping();
REVOKE ALL ON FUNCTION erp_private.remember_mapping() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.remember_mapping() TO erp_api;

CREATE FUNCTION erp_private.v3_record_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF TG_TABLE_NAME IN ('stock_controls','category_requests','bank_supplements') AND TG_OP='UPDATE' THEN
  IF OLD.status IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Approved records are immutable; create a new controlled version' USING ERRCODE='23514';END IF;
  IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'Project identity is immutable' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_TABLE_NAME='category_requests' THEN
  IF TG_OP='INSERT' AND (NEW.status<>'Pending' OR NEW.requested_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Create your own pending request' USING ERRCODE='42501';END IF;
  IF TG_OP='UPDATE' AND (a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.decided_by IS DISTINCT FROM a.staff_id OR OLD.requested_by=a.staff_id OR NEW.status NOT IN ('Approved','Rejected') OR length(btrim(coalesce(NEW.decision_note,'')))<10 OR (to_jsonb(NEW)-ARRAY['status','account_code','decided_by','decision_note','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','account_code','decided_by','decision_note','revision','updated_at'])) THEN RAISE EXCEPTION 'Independent Manager or Partner decision required' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME='bank_supplements' THEN
  IF TG_OP='INSERT' AND (NEW.status<>'Pending' OR NEW.prepared_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Create your own pending supplement' USING ERRCODE='42501';END IF;
  IF TG_OP='UPDATE' AND (a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR OLD.prepared_by=a.staff_id OR NEW.status NOT IN ('Approved','Returned') OR length(btrim(coalesce(NEW.review_note,'')))<10 OR (to_jsonb(NEW)-ARRAY['status','reviewed_by','review_note','revision','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','reviewed_by','review_note','revision','updated_at'])) THEN RAISE EXCEPTION 'Independent bank supplement review required' USING ERRCODE='42501';END IF;
 END IF;
 IF TG_TABLE_NAME='mapping_selections' THEN IF NEW.selected_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'Selection belongs to another preparer' USING ERRCODE='42501';END IF;END IF;
 IF TG_TABLE_NAME='mapping_selections' AND TG_OP='UPDATE' THEN
  IF OLD.consumed_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['result','consumed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['result','consumed_at']) THEN RAISE EXCEPTION 'Selection snapshot is immutable' USING ERRCODE='23514';END IF;
 END IF;
 IF TG_TABLE_NAME='stock_controls' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status<>'Draft' OR NEW.prepared_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'Create your own draft stock control' USING ERRCODE='42501';END IF;
  ELSE
   IF (NEW.activity_id,NEW.policy_id,NEW.stock_class,NEW.starts_on,NEW.ends_on,NEW.prepared_by) IS DISTINCT FROM (OLD.activity_id,OLD.policy_id,OLD.stock_class,OLD.starts_on,OLD.ends_on,OLD.prepared_by) THEN RAISE EXCEPTION 'Stock identity is immutable' USING ERRCODE='23514';END IF;
   IF OLD.status='Submitted' THEN
    IF NEW.status NOT IN ('Approved','Returned') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR NEW.reviewed_by=OLD.prepared_by OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') OR length(btrim(coalesce(NEW.review_note,'')))<10 OR NEW.inputs IS DISTINCT FROM OLD.inputs OR NEW.result IS DISTINCT FROM OLD.result THEN RAISE EXCEPTION 'Independent review without changing submitted values is required' USING ERRCODE='42501';END IF;
   ELSIF a.staff_id IS DISTINCT FROM OLD.prepared_by OR NEW.status NOT IN ('Draft','Submitted') THEN RAISE EXCEPTION 'Assigned preparer must submit stock work' USING ERRCODE='42501';END IF;
  END IF;
 END IF;
 RETURN NEW;
END;$$;
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT * FROM (VALUES ('client_activities','activity_id'),('partner_interests','interest_id'),('client_periods','period_id'),('stock_policy_versions','policy_id'),('stock_controls','control_id'),('category_requests','request_id'),('mapping_selections','selection_id'),('mapping_history','history_id'),('bank_deferrals','reconciliation_id'),('bank_supplements','supplement_id'),('tax_return_identities','case_id')) x(tbl,key) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
  IF r.tbl IN ('stock_controls','category_requests','bank_supplements') THEN
   EXECUTE format('CREATE TRIGGER revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);
  END IF;
  IF r.tbl IN ('client_activities','partner_interests','client_periods','stock_policy_versions','bank_deferrals','tax_return_identities','mapping_history') THEN
   EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change()',r.tbl);
  ELSE
   EXECUTE format('CREATE TRIGGER v3_guard BEFORE INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.v3_record_guard()',r.tbl);
  END IF;
  IF r.tbl IN ('client_activities','partner_interests','client_periods','stock_policy_versions') THEN
   EXECUTE format('CREATE POLICY scoped_read ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
   EXECUTE format('CREATE POLICY scoped_insert ON erp_private.%I FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND erp_private.is_leader())',r.tbl);
  ELSIF r.tbl='tax_return_identities' THEN
   EXECUTE format('CREATE POLICY scoped_read ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
   EXECUTE format('CREATE POLICY scoped_insert ON erp_private.%I FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  ELSE
   EXECUTE format('CREATE POLICY scoped_read ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
   EXECUTE format('CREATE POLICY scoped_write ON erp_private.%I FOR ALL TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  END IF;
  EXECUTE format('REVOKE ALL ON erp_private.%I FROM PUBLIC,anon,authenticated,service_role',r.tbl);
  EXECUTE format('GRANT SELECT,INSERT ON erp_private.%I TO erp_api',r.tbl);
 END LOOP;
END;$$;
GRANT UPDATE ON erp_private.stock_controls,erp_private.category_requests,erp_private.mapping_selections,erp_private.bank_supplements TO erp_api;
REVOKE ALL ON FUNCTION erp_private.entity_activation_guard(),erp_private.v3_record_guard(),erp_private.return_identity_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.entity_activation_guard(),erp_private.v3_record_guard(),erp_private.return_identity_guard() TO erp_api;

CREATE FUNCTION erp_private.v3_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;c erp_private.sales_reconciliations;cid uuid;
BEGIN
 a:=erp_private.actor();
 IF TG_TABLE_NAME='bank_deferrals' THEN
  SELECT * INTO c FROM erp_private.sales_reconciliations WHERE reconciliation_id=NEW.reconciliation_id;
  IF a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.approved_by IS DISTINCT FROM a.staff_id OR NEW.requested_by IS DISTINCT FROM c.prepared_by OR NEW.project_id IS DISTINCT FROM c.project_id OR c.review_type<>'Monthly' OR c.status NOT IN ('Draft','Returned') OR NOT EXISTS(SELECT 1 FROM erp_private.documents WHERE document_id=NEW.evidence_id AND project_id=NEW.project_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Independent scoped bank deferral required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='stock_policy_versions' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.client_activities WHERE activity_id=NEW.activity_id AND client_id=NEW.client_id) OR NEW.configured_by IS DISTINCT FROM a.staff_id THEN RAISE EXCEPTION 'Stock policy activity and client must match' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='stock_controls' THEN
  SELECT client_id INTO cid FROM erp_private.projects WHERE project_id=NEW.project_id;
  IF NOT EXISTS(SELECT 1 FROM erp_private.stock_policy_versions s WHERE s.policy_id=NEW.policy_id AND s.activity_id=NEW.activity_id AND s.client_id=cid AND s.effective_from<=NEW.starts_on) THEN RAISE EXCEPTION 'Stock policy, activity and client must match the period' USING ERRCODE='23514';END IF;
 ELSIF TG_TABLE_NAME='category_requests' THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.workbook_rows WHERE row_id=NEW.row_id AND project_id=NEW.project_id) THEN RAISE EXCEPTION 'Request must refer to the same project row' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END;$$;
CREATE TRIGGER links BEFORE INSERT ON erp_private.bank_deferrals FOR EACH ROW EXECUTE FUNCTION erp_private.v3_link_guard();
CREATE TRIGGER links BEFORE INSERT ON erp_private.stock_policy_versions FOR EACH ROW EXECUTE FUNCTION erp_private.v3_link_guard();
CREATE TRIGGER links BEFORE INSERT ON erp_private.stock_controls FOR EACH ROW EXECUTE FUNCTION erp_private.v3_link_guard();
CREATE TRIGGER links BEFORE INSERT ON erp_private.category_requests FOR EACH ROW EXECUTE FUNCTION erp_private.v3_link_guard();
REVOKE ALL ON FUNCTION erp_private.v3_link_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.v3_link_guard() TO erp_api;

CREATE FUNCTION erp_private.partner_totals_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE n integer;total numeric;windows integer;
BEGIN
 SELECT count(*),sum(profit_percentage),count(DISTINCT (effective_from,effective_to,client_id)) INTO n,total,windows FROM erp_private.partner_interests WHERE group_id=NEW.group_id;
 IF n<2 OR total<>100 OR windows<>1 THEN RAISE EXCEPTION 'A partnership agreement window must contain at least two partners and total 100 percent' USING ERRCODE='23514';END IF;RETURN NULL;
END;$$;
CREATE CONSTRAINT TRIGGER partner_totals AFTER INSERT ON erp_private.partner_interests DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION erp_private.partner_totals_guard();
CREATE UNIQUE INDEX partner_group_pin ON erp_private.partner_interests(group_id,partner_pin);
REVOKE ALL ON FUNCTION erp_private.partner_totals_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.partner_totals_guard() TO erp_api;

-- Every added single-column FK has an index, including audit actors.
DO $$DECLARE r record;BEGIN
 FOR r IN SELECT c.conrelid,a.attname,c.conkey[1] k FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
 WHERE c.contype='f' AND n.nspname='erp_private' AND t.relname IN ('client_activities','partner_interests','client_periods','stock_policy_versions','stock_controls','category_requests','mapping_selections','mapping_history','bank_deferrals','bank_supplements','tax_return_identities')
 AND NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND i.indisvalid AND i.indkey[0]=c.conkey[1]) LOOP
 EXECUTE format('CREATE INDEX %I ON %s(%I)','v3_fk_'||substr(md5(r.conrelid::text||r.attname),1,20),r.conrelid::regclass,r.attname);
 END LOOP;
END;$$;
