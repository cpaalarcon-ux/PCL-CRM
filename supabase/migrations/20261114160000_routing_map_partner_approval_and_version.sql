-- Build 2803: the firm's answer on routing mappings. The Engagement Manager proposes the client account for a routing code; an Engagement Partner who
-- did not propose it approves it. Nothing is guessed: until a Partner approves a mapping that covers the transaction date, the row stays unmapped.
-- Each mapping keeps a version (1, 2, 3 ...) for its client, module and routing code, so approval records the client, account, dates, approver and version.
-- Ending or withdrawing a mapping stays with a Manager or Partner: it only stops new rows being mapped.
ALTER TABLE erp_private.client_routing_map ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>=1);
CREATE OR REPLACE FUNCTION erp_private.client_routing_map_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE ac erp_private.account_catalog; me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner proposes a routing mapping.' USING ERRCODE='42501'; END IF;
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Propose a draft routing mapping; approval is separate.' USING ERRCODE='42501'; END IF;
  SELECT coalesce(max(m.version),0)+1 INTO NEW.version FROM erp_private.client_routing_map m WHERE m.client_id=NEW.client_id AND m.module=NEW.module AND m.routing_code=NEW.routing_code AND coalesce(m.item_code,'')=coalesce(NEW.item_code,'') AND coalesce(m.side,'')=coalesce(NEW.side,'');
 ELSE
  IF ROW(NEW.client_id,NEW.module,NEW.routing_code,NEW.item_code,NEW.erp_account_code,NEW.side,NEW.effective_from,NEW.created_by,NEW.version)
     IS DISTINCT FROM ROW(OLD.client_id,OLD.module,OLD.routing_code,OLD.item_code,OLD.erp_account_code,OLD.side,OLD.effective_from,OLD.created_by,OLD.version) THEN
   RAISE EXCEPTION 'A routing mapping cannot be edited. Propose a new dated mapping instead.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Inactive' THEN RAISE EXCEPTION 'A withdrawn routing mapping cannot be changed.' USING ERRCODE='23514'; END IF;
  IF OLD.status='Active' THEN
   IF NEW.status='Active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    IF OLD.effective_to IS NOT NULL THEN RAISE EXCEPTION 'An approved routing mapping that has an end date cannot be moved.' USING ERRCODE='23514'; END IF;
    IF cat NOT IN('PARTNER','MANAGER') OR NEW.closed_by IS DISTINCT FROM me OR NEW.closed_reason IS NULL THEN RAISE EXCEPTION 'Only a Manager or Partner can end a routing mapping, and must give a reason.' USING ERRCODE='42501'; END IF;
   ELSIF NEW.status='Active' AND ROW(NEW.approved_by,NEW.approved_at,NEW.closed_by,NEW.closed_at,NEW.closed_reason) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.closed_by,OLD.closed_at,OLD.closed_reason) THEN
    RAISE EXCEPTION 'An approved routing mapping cannot be edited.' USING ERRCODE='23514';
   ELSIF NEW.status='Inactive' THEN
    IF cat NOT IN('PARTNER','MANAGER') OR NEW.closed_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Only a Manager or Partner can withdraw a routing mapping.' USING ERRCODE='42501'; END IF;
    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN RAISE EXCEPTION 'Withdrawing changes nothing else about the mapping.' USING ERRCODE='23514'; END IF;
   ELSIF NEW.status='Draft' THEN RAISE EXCEPTION 'An approved routing mapping cannot go back to draft.' USING ERRCODE='23514';
   END IF;
  END IF;
  IF OLD.status='Draft' AND NEW.status='Inactive' AND NEW.closed_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Record who withdrew the draft.' USING ERRCODE='42501'; END IF;
  IF OLD.status='Draft' AND NEW.status='Draft' AND ROW(NEW.approved_by,NEW.approved_at,NEW.closed_by,NEW.closed_at,NEW.closed_reason,NEW.effective_to) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.closed_by,OLD.closed_at,OLD.closed_reason,OLD.effective_to) THEN
   RAISE EXCEPTION 'A draft routing mapping is replaced, not edited.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='INSERT' OR (OLD.status='Draft' AND NEW.status IN('Draft','Active')) THEN
  SELECT * INTO ac FROM erp_private.account_catalog WHERE code=NEW.erp_account_code;
  IF ac.code IS NULL OR ac.status<>'Active' OR ac.is_legacy THEN RAISE EXCEPTION 'Choose an active account from the chart of accounts.' USING ERRCODE='23514'; END IF;
  IF NEW.module='Purchases' AND coalesce(ac.route,0) NOT IN(1,2,3) THEN RAISE EXCEPTION 'A purchase routing code needs an account that purchases post to (stock, expense or fixed asset).' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status='Draft') THEN
  IF cat<>'PARTNER' OR NEW.approved_by IS DISTINCT FROM me OR NEW.approved_by=NEW.created_by THEN RAISE EXCEPTION 'A Partner who did not propose it must approve this routing mapping.' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.client_routing_map m WHERE m.client_id=NEW.client_id AND m.module=NEW.module AND m.routing_code=NEW.routing_code
    AND coalesce(m.item_code,'')=coalesce(NEW.item_code,'') AND coalesce(m.side,'')=coalesce(NEW.side,'') AND m.status='Active' AND m.routing_id<>NEW.routing_id
    AND m.effective_from<=coalesce(NEW.effective_to,'infinity'::date) AND coalesce(m.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'An approved mapping already covers this routing code on these dates. End it first, then approve the new one.' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END $$;

DROP POLICY routing_map_insert ON erp_private.client_routing_map;
CREATE POLICY routing_map_insert ON erp_private.client_routing_map FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
