-- Build 2899: client supplier aliases (amendment F to rule A, 19 Nov 2026).
-- An alias says: for this client, a supplier name (and, where used, a description) written exactly like this uses this approved routing code and TB item code.
-- It never approves a pair: the pair it points to must itself be an approved routing mapping for the client, checked again whenever a row is mapped.
-- Matching is exact after one fixed clean-up (lower case, trimmed, spaces and punctuation collapsed); nothing fuzzy ever maps a row. Per client only, Purchases only.
-- A Manager or Partner proposes (Draft). A different Partner approves. An approved alias is never edited: it is ended on a date or withdrawn with a reason. Nothing is deleted.
CREATE TABLE erp_private.client_routing_alias(
 alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 module text NOT NULL DEFAULT 'Purchases' CHECK(module='Purchases'),
 party_key text NOT NULL CHECK(char_length(party_key) BETWEEN 2 AND 200 AND party_key=lower(btrim(party_key))),
 description_key text CHECK(description_key IS NULL OR (char_length(description_key) BETWEEN 2 AND 300 AND description_key=lower(btrim(description_key)))),
 party_label text NOT NULL CHECK(char_length(btrim(party_label)) BETWEEN 1 AND 200), -- the supplier name as the proposer wrote it, for display
 routing_code text NOT NULL CHECK(routing_code=upper(btrim(routing_code)) AND routing_code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
 item_code text NOT NULL CHECK(item_code ~ '^\d{5}$'),
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
 CHECK((status='Draft' AND approved_by IS NULL AND approved_at IS NULL) OR (status='Active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR status='Inactive'),
 CHECK(status<>'Inactive' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND closed_reason IS NOT NULL))
);
CREATE INDEX client_routing_alias_lookup_idx ON erp_private.client_routing_alias(client_id,party_key,effective_from) WHERE status='Active';
CREATE INDEX client_routing_alias_created_by_idx ON erp_private.client_routing_alias(created_by);
CREATE INDEX client_routing_alias_approved_by_idx ON erp_private.client_routing_alias(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX client_routing_alias_closed_by_idx ON erp_private.client_routing_alias(closed_by) WHERE closed_by IS NOT NULL;
ALTER TABLE erp_private.client_routing_alias ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_routing_alias FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_routing_alias TO erp_api;
CREATE POLICY routing_alias_read ON erp_private.client_routing_alias FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY routing_alias_insert ON erp_private.client_routing_alias FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY routing_alias_update ON erp_private.client_routing_alias FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_routing_alias FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_routing_alias FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('alias_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_routing_alias FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.client_routing_alias_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Propose a draft alias; approval is separate.' USING ERRCODE='42501'; END IF;
 ELSE
  IF ROW(NEW.client_id,NEW.module,NEW.party_key,NEW.description_key,NEW.party_label,NEW.routing_code,NEW.item_code,NEW.effective_from,NEW.created_by)
     IS DISTINCT FROM ROW(OLD.client_id,OLD.module,OLD.party_key,OLD.description_key,OLD.party_label,OLD.routing_code,OLD.item_code,OLD.effective_from,OLD.created_by) THEN
   RAISE EXCEPTION 'An alias cannot be edited. Propose a new dated alias instead.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='Inactive' THEN RAISE EXCEPTION 'A withdrawn alias cannot be changed.' USING ERRCODE='23514'; END IF;
  IF OLD.status='Active' THEN
   IF NEW.status='Active' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    IF OLD.effective_to IS NOT NULL THEN RAISE EXCEPTION 'An approved alias that has an end date cannot be moved.' USING ERRCODE='23514'; END IF;
    IF cat NOT IN('PARTNER','MANAGER') OR NEW.closed_by IS DISTINCT FROM me OR NEW.closed_reason IS NULL THEN RAISE EXCEPTION 'Only a Manager or Partner can end an alias, and must give a reason.' USING ERRCODE='42501'; END IF;
   ELSIF NEW.status='Active' AND ROW(NEW.approved_by,NEW.approved_at,NEW.closed_by,NEW.closed_at,NEW.closed_reason) IS DISTINCT FROM ROW(OLD.approved_by,OLD.approved_at,OLD.closed_by,OLD.closed_at,OLD.closed_reason) THEN
    RAISE EXCEPTION 'An approved alias cannot be edited.' USING ERRCODE='23514';
   ELSIF NEW.status='Inactive' THEN
    IF cat NOT IN('PARTNER','MANAGER') OR NEW.closed_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Only a Manager or Partner can withdraw an alias.' USING ERRCODE='42501'; END IF;
    IF NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN RAISE EXCEPTION 'Withdrawing changes nothing else about the alias.' USING ERRCODE='23514'; END IF;
   ELSIF NEW.status='Draft' THEN RAISE EXCEPTION 'An approved alias cannot go back to draft.' USING ERRCODE='23514';
   END IF;
  END IF;
  IF OLD.status='Draft' AND NEW.status='Inactive' AND NEW.closed_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Record who withdrew the draft.' USING ERRCODE='42501'; END IF;
  IF OLD.status='Draft' AND NEW.status='Draft' THEN RAISE EXCEPTION 'A draft alias is replaced, not edited.' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status='Draft') THEN
  IF cat<>'PARTNER' OR NEW.approved_by IS DISTINCT FROM me OR NEW.approved_by=NEW.created_by THEN RAISE EXCEPTION 'A different Partner must approve this alias.' USING ERRCODE='42501'; END IF;
  -- An alias never approves a pair: the routing code and TB item code must already be an approved mapping for this client on the start date.
  IF NOT EXISTS(SELECT 1 FROM erp_private.client_routing_map m WHERE m.client_id=NEW.client_id AND m.module='Purchases' AND m.status='Active' AND m.routing_code=NEW.routing_code
    AND (m.item_code=NEW.item_code OR (m.item_code IS NULL AND m.erp_account_code=NEW.item_code)) AND m.effective_from<=NEW.effective_from AND coalesce(m.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'An alias only points to a routing code and TB item code that a Partner has already approved for this client. Approve that mapping first.' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM erp_private.client_routing_alias o WHERE o.client_id=NEW.client_id AND o.party_key=NEW.party_key AND coalesce(o.description_key,'')=coalesce(NEW.description_key,'') AND o.status='Active' AND o.alias_id<>NEW.alias_id
    AND o.effective_from<=coalesce(NEW.effective_to,'infinity'::date) AND coalesce(o.effective_to,'infinity'::date)>=NEW.effective_from) THEN
   RAISE EXCEPTION 'An approved alias already covers this supplier text on these dates. End it first, then approve the new one.' USING ERRCODE='23505';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_routing_alias_guard BEFORE INSERT OR UPDATE ON erp_private.client_routing_alias FOR EACH ROW EXECUTE FUNCTION erp_private.client_routing_alias_guard();
