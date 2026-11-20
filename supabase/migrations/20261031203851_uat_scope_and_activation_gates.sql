-- UAT scoping is disabled by default. Enable it only in the staging project
-- after tagging the approved fictional fixtures there; production remains
-- unaffected unless an operator explicitly enables the staging feature.
CREATE TABLE erp_private.workspace_features (
 feature_key text PRIMARY KEY CHECK (feature_key='uat_client_scope'),
 enabled boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE erp_private.workspace_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.workspace_features FROM PUBLIC,anon,authenticated,erp_api,service_role;

CREATE FUNCTION erp_private.uat_scope_enabled() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT f.enabled FROM erp_private.workspace_features f WHERE f.feature_key='uat_client_scope'),false)
$$;
REVOKE ALL ON FUNCTION erp_private.uat_scope_enabled() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.uat_scope_enabled() TO erp_api;

ALTER TABLE erp_private.clients ADD COLUMN is_uat_fixture boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.leads ADD COLUMN is_uat_fixture boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION erp_private.client_allowed(c uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.clients x WHERE x.client_id=c AND x.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR x.is_uat_fixture)
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

CREATE OR REPLACE FUNCTION erp_private.project_allowed(p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.projects e JOIN erp_private.clients c ON c.client_id=e.client_id
 WHERE e.project_id=p AND e.deleted_at IS NULL AND c.deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR c.is_uat_fixture)
 AND (erp_private.actor()).category_code<>'INTERN'
 AND erp_private.firm_allowed(e.handling_firm_id) AND ((erp_private.actor()).category_code='PARTNER'
 OR (erp_private.project_editor() AND e.owner_staff_id=(erp_private.actor()).staff_id)
 OR EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=e.project_id AND a.deleted_at IS NULL
 AND (a.staff_id=(erp_private.actor()).staff_id OR erp_private.manages(a.staff_id)))
 OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access f WHERE f.staff_id=(erp_private.actor()).staff_id
 AND f.firm_id=e.handling_firm_id AND f.deleted_at IS NULL AND f.scope='Firm' AND erp_private.is_leader())))
$$;

DROP POLICY clients_insert ON erp_private.clients;
CREATE POLICY clients_insert ON erp_private.clients FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND owner_staff_id=(erp_private.actor()).staff_id
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture));

DROP POLICY leads_read ON erp_private.leads;
DROP POLICY leads_add ON erp_private.leads;
DROP POLICY leads_update ON erp_private.leads;
CREATE POLICY leads_read ON erp_private.leads FOR SELECT TO erp_api USING(deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture)
 AND erp_private.is_leader() AND erp_private.firm_allowed(firm_id)
 AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id
 OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a
 WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm')));
CREATE POLICY leads_add ON erp_private.leads FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader()
 AND erp_private.firm_allowed(firm_id) AND owner_id=(erp_private.actor()).staff_id AND stage<>'Converted' AND client_id IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture));
CREATE POLICY leads_update ON erp_private.leads FOR UPDATE TO erp_api USING(deleted_at IS NULL
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture)
 AND erp_private.is_leader() AND erp_private.firm_allowed(firm_id)
 AND ((erp_private.actor()).category_code='PARTNER' OR owner_id=(erp_private.actor()).staff_id
 OR erp_private.manages(owner_id) OR EXISTS(SELECT 1 FROM erp_private.staff_firm_access a
 WHERE a.staff_id=(erp_private.actor()).staff_id AND a.firm_id=leads.firm_id AND a.deleted_at IS NULL AND a.scope='Firm')))
 WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(firm_id)
 AND (NOT erp_private.uat_scope_enabled() OR is_uat_fixture));

-- The procedure is the final control point so UI and scheduler paths behave
-- identically. Draft engagements and merely staged sources create no tasks.
CREATE OR REPLACE FUNCTION erp_private.generate_project_tasks(pid uuid,through_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE s record; o record; n integer; total integer:=0; fy_month integer; fy_day integer; opening_status text;
 is_tax boolean; work_kind text; work_start date; work_end date; work_period uuid;
BEGIN
 IF current_user='erp_api' AND (NOT erp_private.project_editor() OR NOT erp_private.project_allowed(pid) OR through_at>now()+interval '1 second') THEN
  RAISE EXCEPTION 'Schedule operation not permitted' USING ERRCODE='42501';
 END IF;
 SELECT c.year_end_month,c.year_end_day,c.opening_balance_status,p.tax_master INTO fy_month,fy_day,opening_status,is_tax
 FROM erp_private.projects p JOIN erp_private.clients c ON c.client_id=p.client_id
 WHERE p.project_id=pid AND p.deleted_at IS NULL AND p.status='Active' AND c.deleted_at IS NULL;
 IF NOT FOUND THEN RETURN 0; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(pid::text||':periods',0));
 PERFORM project_id FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 FOR s IN
  SELECT * FROM erp_private.project_schedule_history WHERE project_id=pid AND enabled AND deleted_at IS NULL
  UNION ALL SELECT * FROM erp_private.project_schedules WHERE project_id=pid AND enabled AND deleted_at IS NULL
  ORDER BY version
 LOOP
  IF opening_status<>'No opening balances' AND NOT EXISTS(
   SELECT 1 FROM erp_private.ledger_periods lp JOIN erp_private.ledger_journals j USING(period_id)
   JOIN erp_private.projects p ON p.client_id=lp.client_id
   WHERE p.project_id=pid AND lp.starts_on<=s.starts_on AND lp.ends_on>=s.starts_on
   AND j.kind='Opening' AND j.status='Posted') THEN CONTINUE; END IF;
  FOR o IN SELECT * FROM erp_private.schedule_occurrences(s.frequency,s.pack,s.starts_on,s.ends_on,s.effective_from,s.obligations,through_at,fy_month,fy_day)
   WHERE true
  LOOP
   work_period:=null;
   IF is_tax THEN
    work_kind:=CASE WHEN o.template_key LIKE 'annual-%' THEN 'Annually' WHEN s.frequency IN('Once-off','Quarterly') THEN s.frequency ELSE 'Monthly' END;
    work_start:=CASE WHEN work_kind='Monthly' THEN date_trunc('month',o.period_start::timestamp)::date ELSE o.period_start END;
    work_end:=CASE WHEN work_kind='Monthly' THEN (work_start+interval '1 month -1 day')::date ELSE o.period_end END;
    INSERT INTO erp_private.project_work_periods(project_id,period_kind,starts_on,ends_on)
     VALUES(pid,work_kind,work_start,work_end) ON CONFLICT(project_id,period_kind,starts_on) DO NOTHING;
    SELECT work_period_id INTO work_period FROM erp_private.project_work_periods
     WHERE project_id=pid AND period_kind=work_kind AND starts_on=work_start AND status='Open';
    IF work_period IS NULL THEN CONTINUE; END IF;
   END IF;
   INSERT INTO erp_private.tasks(project_id,assigned_to,task_name,description,due_at,recurring_key,requires_document,period_start,period_end,template_key,schedule_version,iso_week_year,iso_week_number)
   VALUES(pid,CASE WHEN o.review_task THEN s.reviewer_id ELSE s.assigned_to END,o.task_name||' · '||o.period_start::text,
    'Generated from the client reporting schedule. Confirm statutory deadlines and review requirements before filing.',o.due_at,o.template_key||':'||o.period_start::text,
    o.requires_document,o.period_start,o.period_end,o.template_key,s.version,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(isoyear FROM o.period_start)::int END,
    CASE WHEN o.template_key LIKE 'weekly-%' THEN extract(week FROM o.period_start)::int END)
   ON CONFLICT(project_id,recurring_key) DO NOTHING;
   GET DIAGNOSTICS n=ROW_COUNT; total:=total+n;
   IF work_period IS NOT NULL THEN
    INSERT INTO erp_private.work_period_tasks(task_id,work_period_id)
     SELECT task_id,work_period FROM erp_private.tasks WHERE project_id=pid AND recurring_key=o.template_key||':'||o.period_start::text
     ON CONFLICT(task_id) DO NOTHING;
   END IF;
  END LOOP;
 END LOOP;
 RETURN total;
END; $$;
REVOKE EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.generate_project_tasks(uuid,timestamptz) TO erp_api;
