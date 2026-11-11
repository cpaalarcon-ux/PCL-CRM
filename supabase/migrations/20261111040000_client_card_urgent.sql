-- Client card: the Urgent figure (build 2786). A filing is Urgent when the firm's internal deadline has been reached and the KRA (statutory) due date has not passed:
-- the same test the nightly Urgent notice uses (filing_urgent_scan), so the card and the notice always agree. Only filings whose period has a recorded KRA due date count.
-- Two figures are added to client_card_flags: how many filings are Urgent, and the fewest days left to the KRA date among them. Nothing is stored, blocked or changed;
-- no new limit is introduced (the internal date is the period's own internal due date, or the filing task's date).
DROP FUNCTION erp_private.client_card_flags(uuid[]);
CREATE FUNCTION erp_private.client_card_flags(p_client_ids uuid[])
RETURNS TABLE(client_id uuid,kra_open integer,kra_days integer,incoming_waiting integer,incoming_overdue integer,filing_soon integer,filing_soon_days integer,filing_late integer,filing_late_days integer,filing_urgent integer,filing_urgent_days integer)
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
 WITH fs AS MATERIALIZED(SELECT * FROM erp_private.filing_state(p_client_ids))
 SELECT c.client_id,
  (SELECT count(*)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  (SELECT min(k.deadline_date-today)::integer FROM erp_private.kra_cases k WHERE k.client_id=c.client_id AND k.status='Open' AND k.deadline_date-today<=v_lim),
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc)) ELSE 0 END,
  CASE WHEN v_rev THEN (SELECT count(*)::integer FROM erp_private.incoming_items i WHERE i.client_id=c.client_id AND i.deleted_at IS NULL AND i.status IN('Received','Needs Review') AND erp_private.incoming_can_see(i.client_id,i.confidentiality,i.is_kyc) AND i.logged_at<now()-make_interval(days=>v_od)) ELSE 0 END,
  (SELECT count(*)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left BETWEEN 0 AND fs.warn_days),
  (SELECT min(fs.days_left)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left BETWEEN 0 AND fs.warn_days),
  (SELECT count(*)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left<0),
  (SELECT max(-fs.days_left)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.days_left<0),
  (SELECT count(*)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.due_source='PERIOD' AND fs.internal_days_left<=0 AND fs.days_left>=0),
  (SELECT min(fs.days_left)::integer FROM fs WHERE fs.client_id=c.client_id AND fs.due_source='PERIOD' AND fs.internal_days_left<=0 AND fs.days_left>=0)
 FROM erp_private.clients c
 WHERE c.client_id=ANY(p_client_ids) AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id);
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.client_card_flags(uuid[]) TO erp_api;
