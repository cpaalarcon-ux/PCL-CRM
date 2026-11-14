-- Build 2802: the approved routing map. One approved, dated, per-client record of which of the client's accounts a routing code posts to.
-- Purchases use it when a file carries a routing code (column M), sales and payroll use the same table with their own codes. It is separate from
-- client_account_mappings (opening trial balance source accounts) so a routing code can never be mistaken for a client chart account.
-- Anyone with client access can propose a mapping (Draft). A different Manager or Partner approves it. An approved mapping is never edited:
-- it can be ended on a date, or withdrawn with a reason; a change is a new dated mapping. Nothing here posts anything.
CREATE TABLE erp_private.client_routing_map(
 routing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 module text NOT NULL CHECK(module IN('Purchases','Sales','Payroll')),
 routing_code text NOT NULL CHECK(routing_code=upper(btrim(routing_code)) AND routing_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
 item_code text CHECK(item_code IS NULL OR item_code ~ '^\d{5}$'), -- optional: the TB item code the file carries, when one routing code has several accounts
 erp_account_code text NOT NULL REFERENCES erp_private.account_catalog(code) ON DELETE RESTRICT,
 side text CHECK(side IS NULL OR side IN('Debit','Credit')),
 label text CHECK(label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 200),
 effective_from date NOT NULL,
 effective_to date,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Active','Inactive')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 closed_reason text CHECK(closed_reason IS NULL OR char_length(btrim(closed_reason)) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK((module='Payroll')=(side IS NOT NULL)),
 CHECK(module='Purchases' OR item_code IS NULL),
 CHECK((status='Draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='Active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status='Inactive'),
 CHECK(status<>'Inactive' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND closed_reason IS NOT NULL))
);
CREATE INDEX client_routing_map_lookup_idx ON erp_private.client_routing_map(client_id,module,routing_code,effective_from) WHERE status='Active';
CREATE INDEX client_routing_map_account_idx ON erp_private.client_routing_map(erp_account_code);
CREATE INDEX client_routing_map_created_by_idx ON erp_private.client_routing_map(created_by);
CREATE INDEX client_routing_map_approved_by_idx ON erp_private.client_routing_map(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX client_routing_map_closed_by_idx ON erp_private.client_routing_map(closed_by) WHERE closed_by IS NOT NULL;
ALTER TABLE erp_private.client_routing_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_routing_map FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_routing_map TO erp_api;
CREATE POLICY routing_map_read ON erp_private.client_routing_map FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY routing_map_insert ON erp_private.client_routing_map FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY routing_map_update ON erp_private.client_routing_map FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_routing_map FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_routing_map FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('routing_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_routing_map FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.client_routing_map_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE ac erp_private.account_catalog; me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Propose a draft routing mapping; approval is separate.' USING ERRCODE='42501'; END IF;
 ELSE
  IF ROW(NEW.client_id,NEW.module,NEW.routing_code,NEW.item_code,NEW.erp_account_code,NEW.side,NEW.effective_from,NEW.created_by)
     IS DISTINCT FROM ROW(OLD.client_id,OLD.module,OLD.routing_code,OLD.item_code,OLD.erp_account_code,OLD.side,OLD.effective_from,OLD.created_by) THEN
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
  IF cat NOT IN('PARTNER','MANAGER') OR NEW.approved_by IS DISTINCT FROM me OR NEW.approved_by=NEW.created_by THEN RAISE EXCEPTION 'A different Manager or Partner must approve this routing mapping.' USING ERRCODE='42501'; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.client_routing_map m WHERE m.client_id=NEW.client_id AND m.module=NEW.module AND m.routing_code=NEW.routing_code
    AND coalesce(m.item_code,'')=coalesce(NEW.item_code,'') AND coalesce(m.side,'')=coalesce(NEW.side,'') AND m.status='Active' AND m.routing_id<>NEW.routing_id
    AND m.effective_from<=coalesce(NEW.effective_to,'infinity'::date) AND coalesce(m.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'An approved mapping already covers this routing code on these dates. End it first, then approve the new one.' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_routing_map_guard BEFORE INSERT OR UPDATE ON erp_private.client_routing_map FOR EACH ROW EXECUTE FUNCTION erp_private.client_routing_map_guard();
