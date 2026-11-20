-- Client Register, one page at a time. Runs as the signed-in person, so the usual row-level security still decides which clients they can see.
-- Filters: search (name, KRA PIN, legal structure), firm, sector, service status, archived, assigned manager (client owner),
-- KYC, tax profile, opening balance, active project count and next deadline. "Next deadline" is the earliest due date of an open task on an Active project.
CREATE OR REPLACE FUNCTION erp_private.client_register(
 p_q text DEFAULT '',p_firm uuid DEFAULT NULL,p_sector text DEFAULT NULL,p_service text DEFAULT NULL,p_archived boolean DEFAULT false,
 p_owner uuid DEFAULT NULL,p_kyc text DEFAULT NULL,p_tax text DEFAULT NULL,p_opening text DEFAULT NULL,p_projects text DEFAULT NULL,
 p_deadline_days integer DEFAULT NULL,p_sort text DEFAULT 'name',p_limit integer DEFAULT 25,p_offset integer DEFAULT 0)
RETURNS TABLE(client_id uuid,total bigint,active_projects integer,open_tasks integer,overdue_tasks integer,next_deadline timestamptz,kyc_complete boolean,tax_verified boolean,opening_done boolean)
LANGUAGE sql STABLE SET search_path TO '' AS $$
 WITH base AS (
  SELECT c.client_id,c.company_name,
   COALESCE(pr.active_projects,0) active_projects,COALESCE(tk.open_tasks,0) open_tasks,COALESCE(tk.overdue_tasks,0) overdue_tasks,tk.next_deadline,
   (length(btrim(COALESCE(c.kra_pin,'')))>0 AND EXISTS(SELECT 1 FROM erp_private.client_compliance cc WHERE cc.client_id=c.client_id AND cc.verified_at IS NOT NULL AND cc.deleted_at IS NULL)
     AND EXISTS(SELECT 1 FROM erp_private.client_contacts k WHERE k.client_id=c.client_id AND k.deleted_at IS NULL)) kyc_complete,
   EXISTS(SELECT 1 FROM erp_private.client_tax_profiles t WHERE t.client_id=c.client_id AND t.status='Verified' AND t.deleted_at IS NULL) tax_verified,
   (c.opening_balance_status='No opening balances' OR EXISTS(SELECT 1 FROM erp_private.ledger_periods lp JOIN erp_private.ledger_journals lj USING(period_id)
     WHERE lp.client_id=c.client_id AND lp.starts_on<=(now() AT TIME ZONE 'Africa/Nairobi')::date AND lp.ends_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date AND lj.kind='Opening' AND lj.status='Posted')) opening_done
  FROM erp_private.clients c
  LEFT JOIN LATERAL (SELECT count(*)::integer active_projects FROM erp_private.projects p WHERE p.client_id=c.client_id AND p.deleted_at IS NULL AND p.status='Active') pr ON true
  LEFT JOIN LATERAL (SELECT count(*)::integer open_tasks,count(*) FILTER (WHERE k.due_at<now())::integer overdue_tasks,min(k.due_at) next_deadline
    FROM erp_private.tasks k JOIN erp_private.projects p ON p.project_id=k.project_id
    WHERE p.client_id=c.client_id AND p.deleted_at IS NULL AND p.status='Active' AND k.deleted_at IS NULL AND k.status NOT IN('Completed','Cancelled')) tk ON true
  WHERE c.deleted_at IS NULL
   AND (p_archived OR c.record_status<>'Archived')
   AND (COALESCE(p_q,'')='' OR c.company_name ILIKE '%'||p_q||'%' OR COALESCE(c.kra_pin,'') ILIKE '%'||p_q||'%' OR COALESCE(c.legal_structure,'') ILIKE '%'||p_q||'%' OR COALESCE(c.legal_subtype,'') ILIKE '%'||p_q||'%')
   AND (p_firm IS NULL OR EXISTS(SELECT 1 FROM erp_private.client_firm_links l WHERE l.client_id=c.client_id AND l.firm_id=p_firm AND l.deleted_at IS NULL))
   AND (p_sector IS NULL OR c.primary_sector=p_sector)
   AND (p_service IS NULL OR c.service_status=p_service)
   AND (p_owner IS NULL OR c.owner_staff_id=p_owner)
 ), picked AS (
  SELECT * FROM base b WHERE
   (p_kyc IS NULL OR (p_kyc='complete')=b.kyc_complete)
   AND (p_tax IS NULL OR (p_tax='verified')=b.tax_verified)
   AND (p_opening IS NULL OR (p_opening='done')=b.opening_done)
   AND (p_projects IS NULL OR (p_projects='none' AND b.active_projects=0) OR (p_projects='some' AND b.active_projects>0))
   AND (p_deadline_days IS NULL OR b.next_deadline<=now()+make_interval(days=>p_deadline_days))
 )
 SELECT x.client_id,count(*) OVER()::bigint total,x.active_projects,x.open_tasks,x.overdue_tasks,x.next_deadline,x.kyc_complete,x.tax_verified,x.opening_done
 FROM picked x
 ORDER BY CASE WHEN p_sort='deadline' THEN x.next_deadline END ASC NULLS LAST,
          CASE WHEN p_sort='projects' THEN x.active_projects END DESC,
          CASE WHEN p_sort='overdue' THEN x.overdue_tasks END DESC,
          x.company_name,x.client_id
 LIMIT GREATEST(1,LEAST(COALESCE(p_limit,25),100)) OFFSET GREATEST(0,COALESCE(p_offset,0))
$$;
REVOKE EXECUTE ON FUNCTION erp_private.client_register(text,uuid,text,text,boolean,uuid,text,text,text,text,integer,text,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_register(text,uuid,text,text,boolean,uuid,text,text,text,text,integer,text,integer,integer) TO erp_api;
CREATE INDEX IF NOT EXISTS projects_client_active_idx ON erp_private.projects(client_id) WHERE deleted_at IS NULL AND status='Active';
CREATE INDEX IF NOT EXISTS clients_owner_idx ON erp_private.clients(owner_staff_id) WHERE deleted_at IS NULL;
