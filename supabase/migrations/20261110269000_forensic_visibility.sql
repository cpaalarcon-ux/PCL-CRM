-- Forensic visibility decision (build 2026-11-10.2700), from the Partner's written decision of 10 Nov 2026.
-- 1. The client card no longer carries any forensic hint: client_card_flags stops returning forensic_file (the column is removed, not hidden).
-- 2. The ordinary audit log (audit_events) refuses any row that names a forensic table or action. The forensic file keeps its own separate event
--    log (forensic_events), which is read only through the access-list checks of the forensic functions.
-- 3. forensic_menu(): the menu entry shows only to a person who is on the access list of at least one forensic file, or to a Partner,
--    who is the only role that can open a first file. Everyone else sees no entry at all.
-- No rate, threshold or other rule is added.

DROP FUNCTION erp_private.client_card_flags(uuid[]);
CREATE FUNCTION erp_private.client_card_flags(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,kra_open integer,kra_days integer,incoming_waiting integer,incoming_overdue integer)
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
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) AND i.logged_at<now()-make_interval(days=>v_od)) ELSE 0 END
 FROM erp_private.clients c
 WHERE c.client_id=ANY(p_client_ids) AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) TO erp_api;

ALTER TABLE erp_private.audit_events ADD CONSTRAINT audit_events_no_forensic CHECK (table_name !~* 'forensic' AND action !~* 'forensic') NOT VALID;
ALTER TABLE erp_private.audit_events VALIDATE CONSTRAINT audit_events_no_forensic;

CREATE FUNCTION erp_private.forensic_menu() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL THEN RETURN false; END IF;
 RETURN a.category_code='PARTNER' OR EXISTS(SELECT 1 FROM erp_private.forensic_access x WHERE x.staff_id=a.staff_id AND x.removed_at IS NULL);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.forensic_menu() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.forensic_menu() TO erp_api;
