-- Withdraw from review. A preparer can pull back their own submitted work to Draft until a reviewer has acted on it.
-- The database allows this only for the preparer, only when the server sets the withdrawal flag, and only while nobody has checked,
-- reviewed or approved it. Reviewers still decide everything else. Covers period imports, sales reconciliations, journals and assets.
DO $patch$
DECLARE def text; patched text;
BEGIN
 -- Period imports
 def:=pg_get_functiondef('erp_private.period_import_guard()'::regprocedure);
 patched:=replace(def,$a$ELSIF NEW.status='Superseded' THEN$a$,
  $b$ELSIF NEW.status='Draft' AND OLD.status='Submitted' THEN
   IF current_setting('erp.withdraw',true) IS DISTINCT FROM 'period_import' OR OLD.reviewed_by IS NOT NULL OR (current_user='erp_api' AND a.staff_id IS DISTINCT FROM OLD.prepared_by) THEN RAISE EXCEPTION 'Only the preparer can withdraw an import that has not been reviewed' USING ERRCODE='42501';END IF;
  ELSIF NEW.status='Superseded' THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'period_import_guard: superseded rule not found'; END IF;
 EXECUTE patched;

 -- Sales reconciliations
 def:=pg_get_functiondef('erp_private.accounting_control_guard()'::regprocedure);
 patched:=replace(def,$a$IF OLD.status='Submitted' THEN$a$,
  $b$IF OLD.status='Submitted' AND NOT (NEW.status='Draft' AND current_setting('erp.withdraw',true)='sales_recon' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id=OLD.prepared_by)) THEN$b$);
 IF patched=def THEN RAISE EXCEPTION 'accounting_control_guard: submitted rule not found'; END IF;
 EXECUTE patched;

 -- Journals and assets
 def:=pg_get_functiondef('erp_private.ledger_row_guard()'::regprocedure);
 patched:=replace(def,
  $a$IF OLD.status='Submitted' AND NEW.status NOT IN ('Posted','Returned') AND NOT (NEW.status='Submitted' AND NEW.checked_by IS DISTINCT FROM OLD.checked_by) THEN RAISE EXCEPTION 'Independent reviewer must post or return this journal';END IF;$a$,
  $b$IF OLD.status='Submitted' AND NEW.status NOT IN ('Posted','Returned') AND NOT (NEW.status='Submitted' AND NEW.checked_by IS DISTINCT FROM OLD.checked_by)
     AND NOT (NEW.status='Draft' AND current_setting('erp.withdraw',true)='journal' AND OLD.checked_by IS NULL AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by))) THEN RAISE EXCEPTION 'Independent reviewer must post or return this journal';END IF;$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: journal rule not found'; END IF;
 def:=patched;
 patched:=replace(def,
  $a$IF TG_OP='UPDATE' AND OLD.status='Submitted' AND NEW.status NOT IN ('Approved','Returned') THEN RAISE EXCEPTION 'Independent reviewer must approve or return the asset';END IF;$a$,
  $b$IF TG_OP='UPDATE' AND OLD.status='Submitted' AND NEW.status NOT IN ('Approved','Returned')
     AND NOT (NEW.status='Draft' AND current_setting('erp.withdraw',true)='asset' AND OLD.reviewed_by IS NULL AND (current_user<>'erp_api' OR a.staff_id IN (OLD.prepared_by,OLD.last_prepared_by))) THEN RAISE EXCEPTION 'Independent reviewer must approve or return the asset';END IF;$b$);
 IF patched=def THEN RAISE EXCEPTION 'ledger_row_guard: asset rule not found'; END IF;
 EXECUTE patched;
END
$patch$;

-- Tell the people who were asked to review that the item has been pulled back (same recipients as the review alert).
CREATE OR REPLACE FUNCTION erp_private.notify_withdrawn(p_client uuid,p_what text,p_reason text,p_key text,p_requested uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE me_id uuid:=(erp_private.actor()).staff_id;me_name text;cname text;n integer;
BEGIN
 IF me_id IS NULL THEN RETURN 0;END IF;
 SELECT full_name INTO me_name FROM erp_private.staff_members WHERE staff_id=me_id;
 SELECT company_name INTO cname FROM erp_private.clients WHERE client_id=p_client;
 INSERT INTO erp_private.notifications(recipient_id,message,event_key)
 SELECT r.staff_id,'No review needed for now: '||coalesce(me_name,'the preparer')||' withdrew '||left(p_what,200)||' for '||coalesce(cname,'a client')||' to correct it ('||left(btrim(p_reason),160)||'). It will come back when it is resubmitted.',left(p_key,200)||':'||r.staff_id::text
 FROM erp_private.review_candidates(p_client) r
 WHERE p_requested IS NULL OR r.staff_id=p_requested OR r.category_code='PARTNER'
 ON CONFLICT (event_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;RETURN n;
END;$$;
REVOKE ALL ON FUNCTION erp_private.notify_withdrawn(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.notify_withdrawn(uuid,text,text,text,uuid) TO erp_api;
