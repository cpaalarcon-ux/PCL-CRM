-- Client card (build 2026-11-10.2690): the facts the card shows beyond set-up.
-- 1. client_card_flags: open KRA notices near their deadline, files waiting in Incoming review, and (to the lead Partner only) a forensic file.
-- 2. client_card_wip: unbilled work in progress per client, Managers and Partners only, with the same definition the Finance page uses.
-- Both run as the signed-in person and return a row only for a client that person may see. Nothing is stored. No limit or rule is added: the KRA warning
-- window is the existing KRA setting "flag_b_days" (default 3, not confirmed) and the overdue limit is the existing Incoming review setting "overdue_days".

CREATE FUNCTION erp_private.client_card_flags(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,kra_open integer,kra_days integer,incoming_waiting integer,incoming_overdue integer,forensic_file boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;today date:=(now() AT TIME ZONE 'Africa/Nairobi')::date;v_lim integer;v_rev boolean;v_od integer;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RETURN; END IF;
 IF cardinality(COALESCE(p_client_ids,'{}'::uuid[]))>500 THEN RAISE EXCEPTION 'Ask for 500 clients or fewer' USING ERRCODE='22023'; END IF;
 v_lim:=erp_private.kra_int('flag_b_days');
 v_od:=COALESCE(erp_private.incoming_int('overdue_days'),3);
 -- A person who may not review the Incoming queue sees no incoming figure, the same rule as the menu count.
 v_rev:=erp_private.incoming_my_rank()>=1 AND erp_private.incoming_my_rank()>=erp_private.incoming_rank(erp_private.incoming_txt('accept_min_role'));
 RETURN QUERY
 SELECT c.client_id,
  (SELECT count(*)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  (SELECT min(k.deadline_date-today)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc)) ELSE 0 END,
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) AND i.logged_at<now()-make_interval(days=>v_od)) ELSE 0 END,
  -- Only the lead of a forensic file for this client is told it exists. Nobody else, whatever their role, gets a hint.
  EXISTS(SELECT 1 FROM erp_private.forensic_cases f WHERE f.client_id=c.client_id AND f.lead_id=a.staff_id)
 FROM erp_private.clients c
 WHERE c.client_id=ANY(p_client_ids) AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id);
END $$;

CREATE FUNCTION erp_private.client_card_wip(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,wip_unbilled numeric,hours_without_rate numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('PARTNER','MANAGER') THEN RETURN; END IF;
 IF cardinality(COALESCE(p_client_ids,'{}'::uuid[]))>500 THEN RAISE EXCEPTION 'Ask for 500 clients or fewer' USING ERRCODE='22023'; END IF;
 RETURN QUERY
 WITH sc AS(SELECT o.client_id FROM erp_private.oversight_clients(a.staff_id,a.category_code) o WHERE o.client_id=ANY(p_client_ids)),
 te AS(SELECT p.client_id AS cid,t.hours,t.billable,r.billable_rate FROM erp_private.timesheets t
   JOIN erp_private.projects p ON p.project_id=t.project_id JOIN sc ON sc.client_id=p.client_id
   LEFT JOIN LATERAL(SELECT x.billable_rate FROM erp_private.staff_rates x WHERE x.staff_id=t.staff_id AND t.work_date BETWEEN x.effective_from AND x.effective_to ORDER BY x.effective_from DESC LIMIT 1) r ON true
   WHERE t.status='Approved' AND t.deleted_at IS NULL),
 inv AS(SELECT i.client_id AS cid,sum(i.net_amount) billed FROM erp_private.invoices i JOIN sc ON sc.client_id=i.client_id WHERE i.status='Posted' AND i.deleted_at IS NULL GROUP BY i.client_id)
 SELECT sc.client_id,
  round(greatest(0,coalesce((SELECT sum(te.hours*te.billable_rate) FROM te WHERE te.cid=sc.client_id AND te.billable AND te.billable_rate IS NOT NULL),0)-coalesce((SELECT inv.billed FROM inv WHERE inv.cid=sc.client_id),0)),2),
  coalesce((SELECT sum(te.hours) FROM te WHERE te.cid=sc.client_id AND te.billable AND te.billable_rate IS NULL),0)
 FROM sc;
END $$;

REVOKE EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
REVOKE EXECUTE ON FUNCTION erp_private.client_card_wip(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) TO erp_api;
GRANT EXECUTE ON FUNCTION erp_private.client_card_wip(uuid[]) TO erp_api;
