-- One dated source of truth for activities, client tax obligations and the
-- downstream work each selection enables. This is staging configuration;
-- version 1 remains Testing until a Tax Lead / Manager releases it.

ALTER TABLE erp_private.client_activities
 ADD COLUMN activity_code text,
 ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
 ADD COLUMN turnover_share numeric(7,4),
 ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN revision bigint NOT NULL DEFAULT 1,
 ADD CONSTRAINT client_activity_code_check CHECK(activity_code IS NULL OR activity_code ~ '^[a-z][a-z0-9_]{1,39}$'),
 ADD CONSTRAINT client_activity_share_check CHECK(turnover_share IS NULL OR turnover_share BETWEEN 0 AND 100);

-- The legacy history trigger rejects every update. Remove it only for this
-- audited backfill; the replacement below permits only a one-time end date.
DROP TRIGGER IF EXISTS immutable ON erp_private.client_activities;
UPDATE erp_private.client_activities SET activity_code=CASE
 WHEN lower(activity_name) LIKE '%wholesale%' THEN 'wholesale'
 WHEN lower(activity_name) LIKE '%retail%' THEN 'retail'
 WHEN lower(activity_name) LIKE '%construction%' OR pack_code='Construction' THEN 'construction'
 WHEN lower(activity_name) LIKE '%hospitality%' OR pack_code='Hospitality' THEN 'hospitality'
 WHEN lower(activity_name) LIKE '%consult%' OR pack_code='Consultancy' THEN 'professional'
 WHEN lower(activity_name) LIKE '%agri%' OR lower(activity_name) LIKE '%farm%' THEN 'agriculture'
 WHEN lower(activity_name) LIKE '%real estate%' OR lower(activity_name) LIKE '%rental%' THEN 'real_estate'
 WHEN lower(activity_name) LIKE '%education%' THEN 'education'
 WHEN lower(activity_name) LIKE '%manufactur%' THEN 'manufacturing'
 WHEN lower(activity_name) LIKE '%transport%' OR lower(activity_name) LIKE '%logistic%' THEN 'transport'
 WHEN lower(activity_name) LIKE '%health%' OR lower(activity_name) LIKE '%medical%' THEN 'healthcare'
 WHEN lower(activity_name) LIKE '%information%' OR lower(activity_name) LIKE '%communication%' OR lower(activity_name) LIKE '%ict%' THEN 'ict'
 ELSE 'other' END;
WITH ranked AS (
 SELECT activity_id,row_number() OVER(PARTITION BY client_id ORDER BY (effective_to IS NULL OR effective_to>=current_date) DESC,effective_from DESC,activity_id) rn
 FROM erp_private.client_activities
)
UPDATE erp_private.client_activities a SET is_primary=(r.rn=1) FROM ranked r WHERE r.activity_id=a.activity_id;
ALTER TABLE erp_private.client_activities ALTER COLUMN activity_code SET NOT NULL;

CREATE TABLE erp_private.dependency_map_versions(
 version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_label text NOT NULL UNIQUE,
 effective_from date NOT NULL,effective_to date,
 status text NOT NULL DEFAULT 'Testing' CHECK(status IN('Testing','Approved','Retired')),
 source_note text NOT NULL,created_by uuid REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(status<>'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND created_by IS DISTINCT FROM approved_by))
);
CREATE TABLE erp_private.dependency_map_rules(
 rule_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),version_id uuid NOT NULL REFERENCES erp_private.dependency_map_versions,
 source_type text NOT NULL CHECK(source_type IN('ACTIVITY','OBLIGATION')),
 source_code text NOT NULL,dependency_code text NOT NULL,dependency_label text NOT NULL,
 configuration jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 UNIQUE(version_id,source_type,source_code,dependency_code)
);
WITH v AS (
 INSERT INTO erp_private.dependency_map_versions(version_label,effective_from,status,source_note)
 VALUES('ERP-DEPENDENCIES-UAT-1','2021-01-01','Testing','UAT seed based on the approved ERP alignment design; do not use for production until independently reviewed.')
 RETURNING version_id
)
INSERT INTO erp_private.dependency_map_rules(version_id,source_type,source_code,dependency_code,dependency_label,configuration)
SELECT v.version_id,x.source_type,x.source_code,x.dependency_code,x.dependency_label,x.configuration::jsonb
FROM v CROSS JOIN (VALUES
 ('ACTIVITY','wholesale','STOCK_METHOD','Stock method by activity','{}'),
 ('ACTIVITY','wholesale','STOCK_COUNT','Stock count schedule','{}'),
 ('ACTIVITY','wholesale','COST_OF_SALES','Cost-of-sales routing','{}'),
 ('ACTIVITY','wholesale','GROSS_MARGIN','Gross-margin checks','{}'),
 ('ACTIVITY','wholesale','CUSTOMER_DEPOSITS','Customer-deposit controls where applicable','{}'),
 ('ACTIVITY','retail','STOCK_METHOD','Stock method by activity','{}'),
 ('ACTIVITY','retail','STOCK_COUNT','Stock count schedule','{}'),
 ('ACTIVITY','retail','COST_OF_SALES','Cost-of-sales routing','{}'),
 ('ACTIVITY','retail','GROSS_MARGIN','Gross-margin checks','{}'),
 ('ACTIVITY','retail','CUSTOMER_DEPOSITS','Customer-deposit controls where applicable','{}'),
 ('ACTIVITY','retail','Z_ETR_CASH_SALES','Z/ETR cash-sales source','{}'),
 ('ACTIVITY','retail','CASH_BANKING_TEST','Cash-banking test','{}'),
 ('ACTIVITY','construction','CONTRACT_REGISTER','Contract register','{}'),
 ('ACTIVITY','construction','WIP_CONTROL','Work-in-progress control','{}'),
 ('ACTIVITY','construction','RETENTIONS','Retention schedule','{}'),
 ('ACTIVITY','construction','STAGE_REVENUE','Contract revenue by stage of completion','{}'),
 ('ACTIVITY','construction','JOB_COSTING','Contract job-costing tags','{}'),
 ('ACTIVITY','hospitality','STOCK_METHOD','Stock method by activity','{}'),
 ('ACTIVITY','hospitality','STOCK_COUNT','Stock count schedule','{}'),
 ('ACTIVITY','hospitality','COST_OF_SALES','Cost-of-sales routing','{}'),
 ('ACTIVITY','hospitality','GROSS_MARGIN','Gross-margin checks','{}'),
 ('OBLIGATION','VAT','SALES_IMPORT','Sales import','{}'),
 ('OBLIGATION','VAT','PURCHASES_IMPORT','Purchases import','{}'),
 ('OBLIGATION','VAT','VAT_RETURN','VAT return working','{"due_day":20}'),
 ('OBLIGATION','VAT','ETIMS_MATCHING','eTIMS matching','{}'),
 ('OBLIGATION','VAT','SALES_BANK_TEST','Sales-to-bank test','{}'),
 ('OBLIGATION','PAYE','P10_IMPORT','P10 / payroll import','{}'),
 ('OBLIGATION','PAYE','PAYROLL_RECONCILIATION','Payroll reconciliation','{}'),
 ('OBLIGATION','PAYE','PAYROLL_PAYABLES','Payroll payable checks','{}'),
 ('OBLIGATION','PAYE','PAYE_RETURN','PAYE return task','{"due_day":9}'),
 ('OBLIGATION','NSSF','PAYROLL_PAYABLES','Payroll payable checks','{}'),
 ('OBLIGATION','NSSF','NSSF_TASK','NSSF filing task','{"due_day":9}'),
 ('OBLIGATION','SHIF','PAYROLL_PAYABLES','Payroll payable checks','{}'),
 ('OBLIGATION','SHIF','SHIF_TASK','SHIF filing task','{"due_day":9}'),
 ('OBLIGATION','Housing levy','PAYROLL_PAYABLES','Payroll payable checks','{}'),
 ('OBLIGATION','Housing levy','AHL_TASK','Affordable Housing Levy task','{"due_rule":"ninth_working_day"}'),
 ('OBLIGATION','NITA','PAYROLL_PAYABLES','Payroll payable checks','{}'),
 ('OBLIGATION','NITA','NITA_TASK','NITA task','{"due_rule":"confirm"}'),
 ('OBLIGATION','WHT','WHT_CLASSIFICATION','Withholding-tax payment classification','{}'),
 ('OBLIGATION','WHT','WHT_SCHEDULE','Withholding-tax schedule','{}'),
 ('OBLIGATION','WHT','WHT_EVENT_REMITTANCE','Event-based remittance task','{"due_working_days_after_payment":5}'),
 ('OBLIGATION','Company','INCOME_TAX_ESTIMATE','Income-tax estimate','{}'),
 ('OBLIGATION','Company','INSTALMENT_SCHEDULE','Instalment schedule when legally applicable','{}'),
 ('OBLIGATION','Company','YEAR_END_COMPUTATION','Year-end income-tax computation','{}'),
 ('OBLIGATION','Company','IT2C_MAPPING','IT2C return mapping','{}'),
 ('OBLIGATION','Partnership','INCOME_TAX_ESTIMATE','Income-tax estimate','{}'),
 ('OBLIGATION','Partnership','INSTALMENT_SCHEDULE','Instalment schedule when legally applicable','{}'),
 ('OBLIGATION','Partnership','YEAR_END_COMPUTATION','Year-end income-tax computation','{}'),
 ('OBLIGATION','Partnership','IT2C_MAPPING','IT2C return mapping','{}'),
 ('OBLIGATION','Individual','INCOME_TAX_ESTIMATE','Income-tax estimate','{}'),
 ('OBLIGATION','Individual','INSTALMENT_SCHEDULE','Instalment schedule when legally applicable','{}'),
 ('OBLIGATION','Individual','YEAR_END_COMPUTATION','Year-end income-tax computation','{}'),
 ('OBLIGATION','Individual','IT1_MAPPING','IT1 return mapping','{}'),
 ('OBLIGATION','Instalment tax','INSTALMENT_SCHEDULE','Instalment schedule','{}'),
 ('OBLIGATION','TOT','TOT_DAILY_RECORDS','Daily gross-sales and purchase records','{}'),
 ('OBLIGATION','TOT','ETIMS_INVOICING','eTIMS invoicing requirement','{}'),
 ('OBLIGATION','TOT','TOT_RETURN','Turnover Tax return task','{"cadence":"monthly"}'),
 ('OBLIGATION','MRI','MRI_RENT_SCHEDULE','Residential rental-income schedule','{}'),
 ('OBLIGATION','MRI','MRI_RETURN','Monthly Residential Rental Income Tax task','{"cadence":"monthly"}')
) AS x(source_type,source_code,dependency_code,dependency_label,configuration);

CREATE TABLE erp_private.client_tax_obligations(
 obligation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 profile_id uuid NOT NULL REFERENCES erp_private.client_tax_profiles,obligation_code text NOT NULL,
 effective_from date NOT NULL,effective_to date NOT NULL CHECK(effective_to>=effective_from),
 registered text NOT NULL CHECK(registered IN('YES','NO','UNKNOWN')),
 applicable text NOT NULL CHECK(applicable IN('YES','NO','TO_CONFIRM')),
 client_status text NOT NULL CHECK(client_status IN('ACTIVE','DORMANT','NIL_FILER','DEREGISTERED','NOT_REGISTERED','UNKNOWN')),
 evidence_reference text NOT NULL DEFAULT '',handling_firm_ids uuid[] NOT NULL DEFAULT '{}',is_selected boolean NOT NULL DEFAULT true,
 created_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 UNIQUE(profile_id,obligation_code)
);
CREATE INDEX client_tax_obligations_period_idx ON erp_private.client_tax_obligations(client_id,obligation_code,effective_from,effective_to) WHERE is_selected;

INSERT INTO erp_private.client_tax_obligations(client_id,profile_id,obligation_code,effective_from,effective_to,registered,applicable,client_status,evidence_reference,handling_firm_ids,created_by)
SELECT p.client_id,p.profile_id,ob.code,
 coalesce(nullif(p.obligation_statuses->ob.code->>'effective_from','')::date,p.effective_from),
 coalesce(nullif(p.obligation_statuses->ob.code->>'effective_to','')::date,p.effective_to),
 coalesce(p.obligation_statuses->ob.code->>'registered','UNKNOWN'),
 coalesce(p.obligation_statuses->ob.code->>'applicable','TO_CONFIRM'),
 coalesce(p.obligation_statuses->ob.code->>'client_status','UNKNOWN'),
 coalesce(p.obligation_statuses->ob.code->>'evidence_reference',''),
 coalesce((SELECT array_agg(DISTINCT pr.handling_firm_id) FROM erp_private.project_schedules s JOIN erp_private.projects pr USING(project_id)
   WHERE pr.client_id=p.client_id AND s.enabled AND s.deleted_at IS NULL AND ob.code=ANY(s.obligations)
    AND s.starts_on<=p.effective_to AND s.ends_on>=p.effective_from),'{}'::uuid[]),p.created_by
FROM erp_private.client_tax_profiles p CROSS JOIN LATERAL unnest(p.obligations) AS ob(code)
ON CONFLICT(profile_id,obligation_code) DO NOTHING;

CREATE TABLE erp_private.client_dependency_sources(
 dependency_source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 source_type text NOT NULL CHECK(source_type IN('ACTIVITY','OBLIGATION')),source_id uuid NOT NULL,
 source_code text NOT NULL,dependency_code text NOT NULL,version_id uuid NOT NULL REFERENCES erp_private.dependency_map_versions,
 effective_from date NOT NULL,effective_to date,created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 UNIQUE(source_type,source_id,dependency_code,version_id)
);
CREATE INDEX client_dependency_sources_period_idx ON erp_private.client_dependency_sources(client_id,dependency_code,effective_from,effective_to);

CREATE TABLE erp_private.client_setup_change_sets(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid NOT NULL REFERENCES erp_private.clients,
 version_id uuid NOT NULL REFERENCES erp_private.dependency_map_versions,
 proposed_activities jsonb NOT NULL,preview jsonb NOT NULL,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Pending review','Approved','Returned')),
 submitted_by uuid REFERENCES erp_private.staff_members,reviewed_by uuid REFERENCES erp_private.staff_members,
 review_note text NOT NULL DEFAULT '',submitted_at timestamptz,reviewed_at timestamptz,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Pending review' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
 CHECK(status<>'Approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND reviewed_by IS DISTINCT FROM submitted_by))
);
CREATE INDEX client_setup_pending_idx ON erp_private.client_setup_change_sets(client_id,status,created_at DESC);

-- Legacy activities get a dated source link under the UAT rule version. This
-- does not activate downstream work or assume that a source module is ready.
INSERT INTO erp_private.client_dependency_sources(client_id,source_type,source_id,source_code,dependency_code,version_id,effective_from,effective_to,created_by)
SELECT a.client_id,'ACTIVITY',a.activity_id,a.activity_code,r.dependency_code,r.version_id,a.effective_from,a.effective_to,a.created_by
FROM erp_private.client_activities a
JOIN erp_private.dependency_map_versions v ON v.version_label='ERP-DEPENDENCIES-UAT-1'
JOIN erp_private.dependency_map_rules r ON r.version_id=v.version_id AND r.source_type='ACTIVITY' AND r.source_code=a.activity_code
ON CONFLICT(source_type,source_id,dependency_code,version_id) DO NOTHING;
INSERT INTO erp_private.client_dependency_sources(client_id,source_type,source_id,source_code,dependency_code,version_id,effective_from,effective_to,created_by)
SELECT o.client_id,'OBLIGATION',o.obligation_id,o.obligation_code,r.dependency_code,r.version_id,o.effective_from,o.effective_to,o.created_by
FROM erp_private.client_tax_obligations o
JOIN erp_private.client_tax_profiles p ON p.profile_id=o.profile_id AND p.status='Verified' AND p.deleted_at IS NULL
JOIN erp_private.dependency_map_versions v ON v.version_label='ERP-DEPENDENCIES-UAT-1'
JOIN erp_private.dependency_map_rules r ON r.version_id=v.version_id AND r.source_type='OBLIGATION' AND r.source_code=o.obligation_code
WHERE o.is_selected
ON CONFLICT(source_type,source_id,dependency_code,version_id) DO NOTHING;

-- Preserve the existing active-engagement edit rule while allowing one
-- controlled end-date update for activity history; all other fields are fixed.
CREATE OR REPLACE FUNCTION erp_private.client_activity_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.effective_to IS NOT NULL OR NEW.effective_to IS NULL OR
     (to_jsonb(NEW)-ARRAY['effective_to','updated_at','revision']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['effective_to','updated_at','revision']) OR
     NEW.effective_to<OLD.effective_from THEN
   RAISE EXCEPTION 'Activity history is immutable; only one end date may be added' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM erp_private.stock_controls s WHERE s.activity_id=OLD.activity_id AND s.status IN('Submitted','Approved') AND s.ends_on>NEW.effective_to) THEN
   RAISE EXCEPTION 'Submitted or approved stock controls extend beyond the proposed activity end date' USING ERRCODE='23514';
  END IF;
  NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
 ELSIF TG_OP='INSERT' THEN
  IF EXISTS(SELECT 1 FROM erp_private.client_activities a WHERE a.client_id=NEW.client_id AND a.activity_code=NEW.activity_code
    AND a.effective_from<=coalesce(NEW.effective_to,'infinity'::date) AND coalesce(a.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'This activity already has an overlapping dated row; end the old row before adding a new period' USING ERRCODE='23505';
  END IF;
  IF NEW.is_primary AND EXISTS(SELECT 1 FROM erp_private.client_activities a WHERE a.client_id=NEW.client_id AND a.is_primary
    AND a.effective_from<=coalesce(NEW.effective_to,'infinity'::date) AND coalesce(a.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'Only one primary activity may apply at a time; end the current primary first' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER client_activity_guard BEFORE INSERT OR UPDATE ON erp_private.client_activities FOR EACH ROW EXECUTE FUNCTION erp_private.client_activity_guard();
GRANT UPDATE ON erp_private.client_activities TO erp_api;
CREATE POLICY client_activity_end ON erp_private.client_activities FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT * FROM (VALUES
  ('dependency_map_versions','version_id'),('dependency_map_rules','rule_id'),
  ('client_tax_obligations','obligation_id'),('client_dependency_sources','dependency_source_id'),
  ('client_setup_change_sets','change_id')) x(tbl,key) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
  EXECUTE format('CREATE TRIGGER revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON erp_private.%I TO erp_api',r.tbl);
 END LOOP;
END $$;

CREATE POLICY dependency_versions_read ON erp_private.dependency_map_versions FOR SELECT TO erp_api USING(erp_private.is_leader());
CREATE POLICY dependency_versions_write ON erp_private.dependency_map_versions FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
CREATE POLICY dependency_rules_read ON erp_private.dependency_map_rules FOR SELECT TO erp_api USING(erp_private.is_leader());
CREATE POLICY dependency_rules_add ON erp_private.dependency_map_rules FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader());
CREATE POLICY tax_obligations_scope ON erp_private.client_tax_obligations FOR ALL TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY dependency_sources_scope ON erp_private.client_dependency_sources FOR ALL TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY setup_changes_read ON erp_private.client_setup_change_sets FOR SELECT TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY setup_changes_add ON erp_private.client_setup_change_sets FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY setup_changes_update ON erp_private.client_setup_change_sets FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

CREATE OR REPLACE FUNCTION erp_private.setup_change_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM (erp_private.actor()).staff_id OR
     NEW.submitted_by IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.submitted_at IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
   RAISE EXCEPTION 'A setup preview starts as a draft owned by its preparer' USING ERRCODE='42501';
  END IF;
 ELSIF TG_OP='UPDATE' THEN
  IF NEW.client_id<>OLD.client_id OR NEW.version_id<>OLD.version_id OR
     NEW.proposed_activities IS DISTINCT FROM OLD.proposed_activities OR NEW.preview IS DISTINCT FROM OLD.preview OR
     NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at THEN
   RAISE EXCEPTION 'A saved setup preview is immutable; prepare a new dated change' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Draft' AND NEW.status='Pending review' THEN
   IF OLD.created_by IS DISTINCT FROM (erp_private.actor()).staff_id OR NEW.submitted_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Only the setup preparer may submit this preview' USING ERRCODE='42501';
   END IF;
  ELSIF OLD.status='Pending review' AND NEW.status IN('Approved','Returned') THEN
   IF NOT erp_private.is_leader() OR NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id OR NEW.reviewed_by=OLD.submitted_by THEN
    RAISE EXCEPTION 'A different Manager or Partner must review the submitted setup' USING ERRCODE='42501';
   END IF;
  ELSE
   RAISE EXCEPTION 'Invalid setup change state transition' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER setup_change_guard BEFORE INSERT OR UPDATE ON erp_private.client_setup_change_sets FOR EACH ROW EXECUTE FUNCTION erp_private.setup_change_guard();

CREATE OR REPLACE FUNCTION erp_private.client_tax_obligation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p erp_private.client_tax_profiles;
BEGIN
 SELECT * INTO p FROM erp_private.client_tax_profiles WHERE profile_id=NEW.profile_id AND client_id=NEW.client_id AND deleted_at IS NULL;
 IF p.profile_id IS NULL OR NEW.effective_from<p.effective_from OR NEW.effective_to>p.effective_to THEN
  RAISE EXCEPTION 'Obligation dates must be within the selected client tax-profile version' USING ERRCODE='23514';
 END IF;
 IF cardinality(NEW.handling_firm_ids)>0 AND EXISTS(
  SELECT 1 FROM unnest(NEW.handling_firm_ids) f(id) WHERE NOT EXISTS(
   SELECT 1 FROM erp_private.client_firm_links cf WHERE cf.client_id=NEW.client_id AND cf.firm_id=f.id AND cf.deleted_at IS NULL)) THEN
  RAISE EXCEPTION 'An obligation can be assigned only to a firm linked to this client' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER client_tax_obligation_guard BEFORE INSERT OR UPDATE ON erp_private.client_tax_obligations FOR EACH ROW EXECUTE FUNCTION erp_private.client_tax_obligation_guard();

-- The dated child row is the task-generation control. A schedule cannot create
-- a return task unless the obligation is confirmed, applies and this firm is
-- explicitly selected to handle it for the full period.
CREATE OR REPLACE FUNCTION erp_private.tax_task_obligation_row_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE code text; cid uuid; firm uuid; o erp_private.client_tax_obligations;
BEGIN
 code:=CASE NEW.template_key
  WHEN 'monthly-vat' THEN 'VAT' WHEN 'monthly-paye' THEN 'PAYE' WHEN 'monthly-tot' THEN 'TOT' WHEN 'monthly-mri' THEN 'MRI'
  WHEN 'monthly-housing-levy' THEN 'Housing levy' WHEN 'monthly-shif' THEN 'SHIF' WHEN 'monthly-nssf' THEN 'NSSF'
  WHEN 'monthly-nita' THEN 'NITA' WHEN 'monthly-fringe-benefit' THEN 'Fringe benefit' WHEN 'monthly-deemed-interest' THEN 'Deemed interest'
  ELSE NULL END;
 IF code IS NULL THEN RETURN NEW; END IF;
 SELECT p.client_id,p.handling_firm_id INTO cid,firm FROM erp_private.projects p WHERE p.project_id=NEW.project_id AND p.deleted_at IS NULL;
 IF cid IS NULL THEN RETURN NULL; END IF;
 SELECT x.* INTO o FROM erp_private.client_tax_obligations x
 JOIN erp_private.client_tax_profiles pr ON pr.profile_id=x.profile_id AND pr.status='Verified' AND pr.deleted_at IS NULL
 WHERE x.client_id=cid AND x.obligation_code=code AND x.is_selected
  AND x.effective_from<=NEW.period_start AND x.effective_to>=NEW.period_end
  AND pr.effective_from<=NEW.period_start AND pr.effective_to>=NEW.period_end
 ORDER BY x.effective_from DESC LIMIT 1;
 IF o.obligation_id IS NULL OR o.registered<>'YES' OR o.applicable<>'YES'
  OR o.client_status IN('DEREGISTERED','NOT_REGISTERED','UNKNOWN') OR o.evidence_reference=''
  OR NOT (firm=ANY(o.handling_firm_ids)) THEN RETURN NULL; END IF;
 RETURN NEW;
END;$$;
REVOKE EXECUTE ON FUNCTION erp_private.tax_task_obligation_row_gate() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_task_obligation_row_gate() TO erp_api;
CREATE TRIGGER task_tax_obligation_row_gate BEFORE INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.tax_task_obligation_row_gate();

INSERT INTO erp_private.release_checks(check_code,title,owner_position)
VALUES('DEPENDENCYMAP','Dated multi-activity and obligation dependency map, preview and downstream controls verified in staging','Tax Lead / ERP Administrator')
ON CONFLICT(check_code) DO NOTHING;
