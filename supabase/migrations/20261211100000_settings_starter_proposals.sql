-- An existing starter draft can acquire a proposer once. The current staff member is
-- recorded by the usual audit triggers, and proposal and approval remain separate actions.

CREATE FUNCTION erp_private.tax_rate_proposer_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NOT coalesce((OLD.created_by IS NULL AND OLD.status='Draft' AND NEW.status='Draft' AND OLD.deleted_at IS NULL
   AND NOT OLD.is_test AND OLD.rate_key !~* '^QA' AND OLD.label !~* '(FICTIONAL|SYNTHETIC TEST)'
   AND erp_private.is_leader() AND NEW.created_by IS NOT NULL
   AND NEW.created_by=(erp_private.actor()).staff_id
   AND (to_jsonb(NEW)-ARRAY['created_by','revision','updated_at'])=(to_jsonb(OLD)-ARRAY['created_by','revision','updated_at'])),false) THEN
  RAISE EXCEPTION 'The tax rule proposer is retained and cannot be changed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.tax_rate_proposer_guard() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_rate_proposer_guard() TO erp_api;
CREATE TRIGGER tax_rate_proposer_guard BEFORE UPDATE OF created_by ON erp_private.tax_rates
 FOR EACH ROW WHEN (OLD.created_by IS DISTINCT FROM NEW.created_by) EXECUTE FUNCTION erp_private.tax_rate_proposer_guard();

CREATE OR REPLACE FUNCTION erp_private.account_catalog_approval_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
  a:=erp_private.actor();
  IF TG_OP='UPDATE' AND NEW.proposed_by IS DISTINCT FROM OLD.proposed_by THEN
    IF NOT coalesce((OLD.proposed_by IS NULL AND OLD.status='Draft' AND NEW.status='Draft' AND erp_private.is_leader()
      AND NEW.proposed_by IS NOT NULL AND NEW.proposed_by=a.staff_id
      AND (to_jsonb(NEW)-ARRAY['proposed_by','revision','updated_at'])
          = (to_jsonb(OLD)-ARRAY['proposed_by','revision','updated_at'])),false) THEN
      RAISE EXCEPTION 'The account proposer is retained and cannot be changed.' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_OP='INSERT' AND current_user='erp_api' AND NEW.status='Draft' AND NEW.proposed_by IS DISTINCT FROM a.staff_id THEN
    RAISE EXCEPTION 'A draft account must retain its proposer.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND OLD.status='Draft' AND NEW.status='Active' AND current_user='erp_api' THEN
    IF a.category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Partner approval required.' USING ERRCODE='42501'; END IF;
    IF OLD.proposed_by IS NULL OR OLD.proposed_by=a.staff_id THEN RAISE EXCEPTION 'A different Partner must approve a draft account with a known proposer.' USING ERRCODE='42501'; END IF;
    IF NEW.approved_by IS DISTINCT FROM a.staff_id OR NEW.approved_at IS NULL THEN RAISE EXCEPTION 'Record the approving Partner and approval time.' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE POLICY statement_map_starter_proposal ON erp_private.account_statement_map FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND status='Draft' AND proposed_by IS NULL)
 WITH CHECK(erp_private.is_leader() AND status='Draft' AND proposed_by=(erp_private.actor()).staff_id);

CREATE OR REPLACE FUNCTION erp_private.account_statement_map_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status='Draft' AND OLD.proposed_by IS NULL AND NEW.proposed_by IS NOT NULL
    AND NEW.proposed_by=(erp_private.actor()).staff_id AND NEW.proposed_at=now() AND erp_private.is_leader()
    AND (to_jsonb(NEW)-ARRAY['proposed_by','proposed_at'])=(to_jsonb(OLD)-ARRAY['proposed_by','proposed_at']) THEN
  RETURN NEW;
 END IF;
 IF (NEW.map_id,NEW.account_code,NEW.line_code,NEW.effective_from,NEW.reason,NEW.proposed_by,NEW.proposed_at)
    IS DISTINCT FROM (OLD.map_id,OLD.account_code,OLD.line_code,OLD.effective_from,OLD.reason,OLD.proposed_by,OLD.proposed_at) THEN
  RAISE EXCEPTION 'A statement-line mapping cannot be edited. Propose a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Draft' THEN
   IF (NEW.effective_to,NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.effective_to,OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) THEN RAISE EXCEPTION 'A draft mapping changes only when it is approved or rejected.' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The reviewer must be the signed-in Partner.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' AND OLD.proposed_by IS NOT NULL AND NEW.reviewed_by=OLD.proposed_by THEN RAISE EXCEPTION 'A mapping must be approved by a Partner other than the person who proposed it.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Rejected' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when rejecting a mapping.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' AND NEW.effective_to IS NOT NULL THEN RAISE EXCEPTION 'A mapping is approved without an end date.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Approved' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) OR OLD.effective_to IS NOT NULL THEN
   RAISE EXCEPTION 'An approved mapping can only be ended once, by replacing it.' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'A rejected mapping is closed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
