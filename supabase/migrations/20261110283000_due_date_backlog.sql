-- Build 2773: the list of existing tax periods that still have no confirmed KRA due date. Read-only: it changes nothing. A period is waiting until the Tax Lead, a Manager or a Partner has
-- either confirmed the KRA date or chosen the task-date fallback (period_due_confirm / period_due_fallback, build 2760). Amendments are not listed: the original period carries the date.
CREATE FUNCTION erp_private.period_due_backlog() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY (r.due_status='MISSING') DESC,r.ends_on DESC,r.company_name),'[]'::jsonb)
 FROM (
  SELECT DISTINCT ON (p.client_id,t.starts_on,t.ends_on,erp_private.period_due_class(t.kind))
   t.case_id,t.project_id,p.client_id,c.company_name,p.project_name,t.kind,t.starts_on,t.ends_on,t.status AS case_status,
   erp_private.period_due_class(t.kind) AS filing_class,erp_private.period_due_suggest_kind(t.kind,t.ends_on) AS suggested_due_date,
   COALESCE(d.status,'MISSING') AS due_status,d.kra_due_date,d.confirmed_at
  FROM erp_private.tax_cases t
  JOIN erp_private.projects p ON p.project_id=t.project_id AND p.deleted_at IS NULL
  JOIN erp_private.clients c ON c.client_id=p.client_id
  LEFT JOIN erp_private.period_due_dates d ON d.client_id=p.client_id AND d.starts_on=t.starts_on AND d.ends_on=t.ends_on AND d.filing_class=erp_private.period_due_class(t.kind)
  WHERE t.deleted_at IS NULL AND t.amends_case_id IS NULL
    AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND erp_private.client_allowed(p.client_id)
  ORDER BY p.client_id,t.starts_on,t.ends_on,erp_private.period_due_class(t.kind),t.created_at
  LIMIT 500
 ) r
$$;
REVOKE ALL ON FUNCTION erp_private.period_due_backlog() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.period_due_backlog() TO erp_api;
