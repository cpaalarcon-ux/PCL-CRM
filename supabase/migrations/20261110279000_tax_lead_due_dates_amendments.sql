-- Tax Lead right, confirmed KRA due dates, and adjustments-only amendments (build 2026-11-10.2760), from the Partner's written decisions of 10 Nov 2026 19:23.
-- 1. The Tax Lead's right to approve tax rules is an ADDITIONAL right (APPROVE_TAX_RULES) that an Engagement Partner grants to a named Manager with a reason and an end date.
--    No one is granted it here: the instruction names no person. VAT and credit (withholding tax) rules can only be given their legal confirmation and approved by someone
--    who holds this right, so a Partner alone can no longer approve them. Other tax rules keep their earlier path (Partner, or the Tax Lead).
-- 2. The KRA return due date is entered and confirmed per client period AND per filing class (the 9th for PAYE and payroll levies, the 20th for VAT/TOT/MRI, an annual date for
--    income tax). The ERP only suggests; a Partner, Manager or the Tax Lead confirms against the KRA iTax calendar, or explicitly chooses the task-date fallback with a reason.
--    Filing windows and Urgent alerts now count from a CONFIRMED date only.
-- 3. An amendment changes adjustments only. The source figures of the filed return are carried over untouched and cannot be edited in the amendment.
-- The warning and late-day settings (3/3, 5/3, 14/3) are not touched: they already hold these values and stay "not yet confirmed" until a Partner confirms them in Settings.

-- 1. The additional right ---------------------------------------------------------------------------------------------------------------
DO $$ DECLARE c text; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.staff_capabilities'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%SYSTEM_ADMIN%' LOOP
  EXECUTE format('ALTER TABLE erp_private.staff_capabilities DROP CONSTRAINT %I',c);
 END LOOP;
END $$;
ALTER TABLE erp_private.staff_capabilities ADD CONSTRAINT staff_capabilities_capability_check CHECK(capability IN('FINANCE','HR','SYSTEM_ADMIN','MLRO','APPROVE_TAX_RULES'));

-- True only for a person who holds the right themselves (a Partner does NOT hold it implicitly) and whose grant has not expired or been revoked.
CREATE FUNCTION erp_private.tax_rules_approver() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT (erp_private.actor()).staff_id IS NOT NULL AND EXISTS(
  SELECT 1 FROM erp_private.staff_capabilities x
  WHERE x.staff_id=(erp_private.actor()).staff_id AND x.capability='APPROVE_TAX_RULES' AND x.deleted_at IS NULL
   AND (x.expires_on IS NULL OR x.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date))
$$;
REVOKE ALL ON FUNCTION erp_private.tax_rules_approver() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_rules_approver() TO erp_api;

DO $patch$ DECLARE d text;o text;n text; BEGIN
 -- staff_right_grant: allow the new right, to a Manager only.
 d:=pg_get_functiondef('erp_private.staff_right_grant(uuid,text,text,date)'::regprocedure);
 o:=$q$IF p_capability IS DISTINCT FROM 'FINANCE' THEN RAISE EXCEPTION 'Only the FINANCE right can be granted today. HR, MLRO and SYSTEM_ADMIN are reserved and no screen uses them yet.'$q$;
 n:=$q$IF p_capability NOT IN('FINANCE','APPROVE_TAX_RULES') THEN RAISE EXCEPTION 'Only the FINANCE right (and the Tax Lead''s APPROVE_TAX_RULES right) can be granted today. HR, MLRO and SYSTEM_ADMIN are reserved and no screen uses them yet.'$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: patch 1 not applied'; END IF;
 d:=replace(d,o,n);
 o:=$q$IF t.category_code='ADMIN' THEN$q$;
 n:=$q$IF p_capability='APPROVE_TAX_RULES' AND t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'The Tax Lead right is held by a Manager. Choose the designated Tax Manager.' USING ERRCODE='23514'; END IF;
 IF t.category_code='ADMIN' THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: patch 2 not applied'; END IF;
 d:=replace(d,o,n);
 EXECUTE d;
 -- suite_guard (tax_rates branch): the Tax Lead may approve as well as a Partner.
 d:=pg_get_functiondef('erp_private.suite_guard()'::regprocedure);
 o:=$q$IF NEW.status='Approved' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN$q$;
 n:=$q$IF NEW.status='Approved' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' AND NOT erp_private.tax_rules_approver() THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'suite_guard changed: patch not applied'; END IF;
 EXECUTE replace(d,o,n);
 -- rate_legal_review_guard: the Tax Lead may record the legal confirmation as well as a Partner.
 d:=pg_get_functiondef('erp_private.rate_legal_review_guard()'::regprocedure);
 o:=$q$IF (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN$q$;
 n:=$q$IF (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' AND NOT erp_private.tax_rules_approver() THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'rate_legal_review_guard changed: patch 1 not applied'; END IF;
 d:=replace(d,o,n);
 d:=replace(d,'Only an Engagement Partner may record the Tax Lead confirmation','Only an Engagement Partner or the designated Tax Lead may record the Tax Lead confirmation');
 EXECUTE d;
 -- approved_rule_guard: the Tax Lead may approve as well as a Partner (the preparer, source-evidence and official-URL rules still apply to everyone).
 d:=pg_get_functiondef('erp_private.approved_rule_guard()'::regprocedure);
 o:=$q$IF (erp_private.actor()).category_code<>'PARTNER' THEN$q$;
 n:=$q$IF (erp_private.actor()).category_code<>'PARTNER' AND NOT erp_private.tax_rules_approver() THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'approved_rule_guard changed: patch not applied'; END IF;
 d:=replace(replace(d,o,n),'Only an Engagement Partner may approve tax rules','Only an Engagement Partner or the designated Tax Lead may approve tax rules');
 EXECUTE d;
END $patch$;

-- VAT and credit (withholding tax) rules need the Tax Lead's own action: the legal confirmation and the approval both. A Partner without the right cannot do either.
CREATE FUNCTION erp_private.tax_rule_lead_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
BEGIN
 IF NEW.tax_type IN('VAT','Withholding tax') AND (
    (NEW.status='Approved' AND OLD.status IS DISTINCT FROM 'Approved')
    OR (NEW.legal_review_status='Confirmed' AND OLD.legal_review_status IS DISTINCT FROM 'Confirmed')) THEN
  IF NOT erp_private.tax_rules_approver() THEN
   RAISE EXCEPTION 'VAT and credit rules can only be confirmed and approved by the designated Tax Lead (the APPROVE_TAX_RULES right). Ask an Engagement Partner to grant it to the Tax Manager.' USING ERRCODE='42501';
  END IF;
  IF NEW.created_by IS NOT NULL AND NEW.created_by=(erp_private.actor()).staff_id THEN
   RAISE EXCEPTION 'The person who prepared this tax rule cannot confirm or approve it.' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.tax_rule_lead_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_rule_lead_guard() TO erp_api;
-- The name sorts first so this clear message is raised before the older Partner messages.
CREATE TRIGGER a_tax_rule_lead_guard BEFORE UPDATE ON erp_private.tax_rates FOR EACH ROW EXECUTE FUNCTION erp_private.tax_rule_lead_guard();

-- 2. KRA return due dates per client period and filing class -----------------------------------------------------------------------------
CREATE TABLE erp_private.period_due_dates(
 due_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 starts_on date NOT NULL,
 ends_on date NOT NULL CHECK(ends_on>=starts_on),
 filing_class text NOT NULL CHECK(filing_class IN('PAYE','VAT','ANNUAL','OTHER')),
 suggested_due_date date,
 suggestion_rule text,
 kra_due_date date,
 status text NOT NULL CHECK(status IN('CONFIRMED','TASK_DATE_FALLBACK')),
 itax_confirmed boolean NOT NULL DEFAULT false,
 confirmed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 confirmed_at timestamptz NOT NULL DEFAULT now(),
 fallback_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'CONFIRMED' OR (kra_due_date IS NOT NULL AND itax_confirmed AND kra_due_date>=ends_on)),
 CHECK(status<>'TASK_DATE_FALLBACK' OR (kra_due_date IS NULL AND NOT itax_confirmed AND char_length(btrim(coalesce(fallback_reason,'')))>=10))
);
CREATE UNIQUE INDEX period_due_dates_one ON erp_private.period_due_dates(client_id,starts_on,ends_on,filing_class);
CREATE INDEX period_due_dates_confirmed_by_idx ON erp_private.period_due_dates(confirmed_by);
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.period_due_dates FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.period_due_dates FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.period_due_dates FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('due_id');
ALTER TABLE erp_private.period_due_dates ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.period_due_dates FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.period_due_dates TO erp_api;
CREATE POLICY period_due_dates_read ON erp_private.period_due_dates FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND erp_private.client_allowed(client_id));

-- The tax kind decides the class. Only the kinds the Partner named are put into a class that has a suggested day; the rest are OTHER (no suggestion, a person enters the date).
CREATE FUNCTION erp_private.period_due_class(p_kind text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_kind IN('PAYE','NSSF','SHIF','Housing levy') THEN 'PAYE'
             WHEN p_kind IN('VAT','TOT','MRI','Excise') THEN 'VAT'
             WHEN p_kind IN('Company','Individual','Partnership') THEN 'ANNUAL'
             ELSE 'OTHER' END
$$;
-- Suggestion only: the 9th (PAYE and payroll levies) or the 20th (VAT, TOT, MRI) of the month after the period ends. Annual and other dates are not suggested.
CREATE FUNCTION erp_private.period_due_suggest(p_class text,p_ends date) RETURNS date LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_class='PAYE' THEN (date_trunc('month',p_ends)+interval '1 month'+interval '8 days')::date
             WHEN p_class='VAT' THEN (date_trunc('month',p_ends)+interval '1 month'+interval '19 days')::date END
$$;

CREATE FUNCTION erp_private.period_due_confirm(p_client uuid,p_start date,p_end date,p_kind text,p_due date,p_itax boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;cls text;sug date;rid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR NOT (a.category_code IN('PARTNER','MANAGER') OR erp_private.tax_rules_approver()) THEN RAISE EXCEPTION 'The Tax Lead, a Manager or a Partner confirms the KRA due date.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE='42501'; END IF;
 IF p_itax IS DISTINCT FROM true THEN RAISE EXCEPTION 'Tick the box to confirm the date matches the KRA iTax calendar.' USING ERRCODE='23514'; END IF;
 IF p_due IS NULL THEN RAISE EXCEPTION 'Enter the KRA due date, or choose the task-date fallback instead.' USING ERRCODE='23514'; END IF;
 IF p_end<p_start THEN RAISE EXCEPTION 'The period end cannot be before its start.' USING ERRCODE='23514'; END IF;
 IF p_due<p_end THEN RAISE EXCEPTION 'The KRA due date cannot be before the period ends.' USING ERRCODE='23514'; END IF;
 cls:=erp_private.period_due_class(p_kind);sug:=erp_private.period_due_suggest(cls,p_end);
 INSERT INTO erp_private.period_due_dates(client_id,starts_on,ends_on,filing_class,suggested_due_date,suggestion_rule,kra_due_date,status,itax_confirmed,confirmed_by,confirmed_at,fallback_reason)
 VALUES(p_client,p_start,p_end,cls,sug,CASE cls WHEN 'PAYE' THEN '9th of the following month' WHEN 'VAT' THEN '20th of the following month' END,p_due,'CONFIRMED',true,a.staff_id,now(),NULL)
 ON CONFLICT(client_id,starts_on,ends_on,filing_class) DO UPDATE SET kra_due_date=excluded.kra_due_date,status='CONFIRMED',itax_confirmed=true,confirmed_by=excluded.confirmed_by,confirmed_at=now(),fallback_reason=NULL,suggested_due_date=excluded.suggested_due_date,suggestion_rule=excluded.suggestion_rule,updated_at=now()
 RETURNING due_id INTO rid;
 RETURN rid;
END $$;

CREATE FUNCTION erp_private.period_due_fallback(p_client uuid,p_start date,p_end date,p_kind text,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;cls text;rid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR NOT (a.category_code IN('PARTNER','MANAGER') OR erp_private.tax_rules_approver()) THEN RAISE EXCEPTION 'The Tax Lead, a Manager or a Partner chooses the task-date fallback.' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'You do not have access to this client.' USING ERRCODE='42501'; END IF;
 IF char_length(btrim(coalesce(p_reason,'')))<10 THEN RAISE EXCEPTION 'Say why the KRA due date is not entered (at least 10 characters).' USING ERRCODE='23514'; END IF;
 IF p_end<p_start THEN RAISE EXCEPTION 'The period end cannot be before its start.' USING ERRCODE='23514'; END IF;
 cls:=erp_private.period_due_class(p_kind);
 INSERT INTO erp_private.period_due_dates(client_id,starts_on,ends_on,filing_class,suggested_due_date,suggestion_rule,kra_due_date,status,itax_confirmed,confirmed_by,confirmed_at,fallback_reason)
 VALUES(p_client,p_start,p_end,cls,erp_private.period_due_suggest(cls,p_end),CASE cls WHEN 'PAYE' THEN '9th of the following month' WHEN 'VAT' THEN '20th of the following month' END,NULL,'TASK_DATE_FALLBACK',false,a.staff_id,now(),btrim(p_reason))
 ON CONFLICT(client_id,starts_on,ends_on,filing_class) DO UPDATE SET kra_due_date=NULL,status='TASK_DATE_FALLBACK',itax_confirmed=false,confirmed_by=excluded.confirmed_by,confirmed_at=now(),fallback_reason=excluded.fallback_reason,updated_at=now()
 RETURNING due_id INTO rid;
 RETURN rid;
END $$;

-- What the screen needs: the saved row for this period and class (if any) and the suggested date.
CREATE FUNCTION erp_private.period_due_state(p_client uuid,p_start date,p_end date,p_kind text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('filing_class',x.cls,'suggested_due_date',erp_private.period_due_suggest(x.cls,p_end),
  'suggestion_rule',CASE x.cls WHEN 'PAYE' THEN '9th of the following month' WHEN 'VAT' THEN '20th of the following month' END,
  'status',d.status,'kra_due_date',d.kra_due_date,'confirmed_at',d.confirmed_at,'confirmed_by_name',s.full_name,'fallback_reason',d.fallback_reason)
 FROM (SELECT erp_private.period_due_class(p_kind) AS cls) x
 LEFT JOIN erp_private.period_due_dates d ON d.client_id=p_client AND d.starts_on=p_start AND d.ends_on=p_end AND d.filing_class=x.cls
 LEFT JOIN erp_private.staff_members s ON s.staff_id=d.confirmed_by
 WHERE erp_private.client_allowed(p_client)
$$;

-- True when the Tax Team has either confirmed the KRA date or explicitly chosen the task-date fallback for this period and class.
CREATE FUNCTION erp_private.period_due_ready(p_client uuid,p_start date,p_end date,p_kind text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.period_due_dates d WHERE d.client_id=p_client AND d.starts_on=p_start AND d.ends_on=p_end AND d.filing_class=erp_private.period_due_class(p_kind))
$$;
REVOKE ALL ON FUNCTION erp_private.period_due_class(text),erp_private.period_due_suggest(text,date),erp_private.period_due_confirm(uuid,date,date,text,date,boolean),erp_private.period_due_fallback(uuid,date,date,text,text),erp_private.period_due_state(uuid,date,date,text),erp_private.period_due_ready(uuid,date,date,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.period_due_class(text),erp_private.period_due_suggest(text,date),erp_private.period_due_confirm(uuid,date,date,text,date,boolean),erp_private.period_due_fallback(uuid,date,date,text,text),erp_private.period_due_state(uuid,date,date,text),erp_private.period_due_ready(uuid,date,date,text) TO erp_api;

-- Filing windows and Urgent alerts now count from a CONFIRMED date for the task's class and period. A period with no confirmed date uses the task's own due date (shown as TASK).
DROP FUNCTION erp_private.filing_state(uuid[]);
CREATE FUNCTION erp_private.filing_state(p_clients uuid[] DEFAULT NULL)
RETURNS TABLE(task_id uuid,project_id uuid,client_id uuid,task_name text,filing_class text,due_date date,days_left integer,warn_days integer,late_days integer,due_source text,internal_due_date date,internal_days_left integer,assigned_to uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT t.task_id,t.project_id,p.client_id,t.task_name,x.cls,
  COALESCE(per.kra_due_date,d.due),
  (COALESCE(per.kra_due_date,d.due)-((now() AT TIME ZONE 'Africa/Nairobi')::date))::integer,
  erp_private.deadline_int(lower(x.cls)||'_warn_days'),erp_private.deadline_int(lower(x.cls)||'_late_days'),
  CASE WHEN per.kra_due_date IS NOT NULL THEN 'PERIOD' ELSE 'TASK' END,
  CASE WHEN per.kra_due_date IS NULL THEN NULL ELSE COALESCE(per.internal_due_date,d.due) END,
  CASE WHEN per.kra_due_date IS NULL THEN NULL ELSE (COALESCE(per.internal_due_date,d.due)-((now() AT TIME ZONE 'Africa/Nairobi')::date))::integer END,
  t.assigned_to
 FROM erp_private.tasks t
 JOIN erp_private.projects p ON p.project_id=t.project_id
 CROSS JOIN LATERAL(SELECT CASE WHEN t.template_key IN('monthly-paye','monthly-payroll') THEN 'PAYE' WHEN t.template_key LIKE 'monthly-%' THEN 'VAT' WHEN t.template_key LIKE 'annual-%' THEN 'ANNUAL' END AS cls) x
 CROSS JOIN LATERAL(SELECT (t.due_at AT TIME ZONE 'Africa/Nairobi')::date AS due) d
 LEFT JOIN LATERAL(
  SELECT dd.kra_due_date,
   (SELECT cp.internal_due_date FROM erp_private.client_periods cp WHERE cp.client_id=p.client_id AND cp.starts_on=w.starts_on AND cp.ends_on=w.ends_on ORDER BY cp.created_at DESC LIMIT 1) AS internal_due_date
  FROM erp_private.work_period_tasks wt
  JOIN erp_private.project_work_periods w ON w.work_period_id=wt.work_period_id
  JOIN erp_private.period_due_dates dd ON dd.client_id=p.client_id AND dd.starts_on=w.starts_on AND dd.ends_on=w.ends_on AND dd.filing_class=x.cls AND dd.status='CONFIRMED'
  WHERE wt.task_id=t.task_id LIMIT 1) per ON true
 WHERE x.cls IS NOT NULL AND t.deleted_at IS NULL AND t.due_at IS NOT NULL AND t.status NOT IN('Completed','Cancelled')
  AND (p_clients IS NULL OR p.client_id=ANY(p_clients))
$$;
REVOKE EXECUTE ON FUNCTION erp_private.filing_state(uuid[]) FROM PUBLIC,anon,authenticated,service_role,erp_api;

-- 3. Amendments change adjustments only ---------------------------------------------------------------------------------------------------
-- An amendment is a new Draft case (the amendment draft) beside the locked original; the original and its source rows are never reopened. Everything in the amendment's inputs
-- that is not an adjustment must stay exactly as it was in the filed version. Only the adjustment fields (and the tie-out / eligibility confirmations, which restart) may differ.
-- A tax with no adjustment fields cannot be amended until adjustment lines exist for it.
CREATE FUNCTION erp_private.tax_amendment_adjustment_keys(p_kind text) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_kind='VAT' THEN ARRAY['adjustments','adjustment_basis']
             WHEN p_kind IN('Company','Individual','Partnership') THEN ARRAY['addbacks','deductions','other_reliefs','tax_adjustment_basis']
             ELSE ARRAY[]::text[] END
$$;
CREATE FUNCTION erp_private.tax_amendment_source_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE o erp_private.tax_cases;keep text[];
BEGIN
 IF NEW.amends_case_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.inputs IS NOT DISTINCT FROM OLD.inputs THEN RETURN NEW; END IF;
 SELECT * INTO o FROM erp_private.tax_cases WHERE case_id=NEW.amends_case_id;
 IF o.case_id IS NULL THEN RETURN NEW; END IF;
 keep:=erp_private.tax_amendment_adjustment_keys(NEW.kind)||ARRAY['return_tied','eligibility_confirmed'];
 IF (coalesce(NEW.inputs,'{}'::jsonb)-keep) IS DISTINCT FROM (coalesce(o.inputs,'{}'::jsonb)-keep) THEN
  RAISE EXCEPTION 'An amendment changes adjustments only. The filed source figures cannot be edited; record the correction as an adjustment.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.tax_amendment_adjustment_keys(text),erp_private.tax_amendment_source_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_amendment_adjustment_keys(text),erp_private.tax_amendment_source_guard() TO erp_api;
CREATE TRIGGER amendment_source_guard BEFORE INSERT OR UPDATE ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_amendment_source_guard();
