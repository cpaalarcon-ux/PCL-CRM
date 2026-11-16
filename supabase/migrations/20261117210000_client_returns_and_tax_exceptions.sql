-- Build 2841: two client-level choices that sit on top of firm-wide settings.
-- 1. client_payroll_returns: which statutory returns (NSSF, SHIF, PAYE P10) a client's payroll service files. The firm approves and publishes each export format once in
--    Settings; this table only records which of those formats a client uses, with dates. A client with no row here keeps today's behaviour (every return is offered).
--    A row is never edited; it is ended on a date with a reason, and a later choice is a new row. Nothing here changes a payroll figure.
-- 2. client_tax_exceptions: a client-specific exception to a firm-wide tax rule. The rule itself stays in the central library. An exception needs a reason and a legal
--    basis, is proposed by one person and approved by a different Partner (or the Tax Lead), and is ended with a reason, never edited. It is a recorded, approved position
--    that screens show beside the rule; it does not change a rate or any calculation by itself.
CREATE TABLE erp_private.client_payroll_returns(
 selection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 return_code text NOT NULL CHECK(return_code IN('NSSF','SHIF','PAYE_P10')),
 effective_from date NOT NULL,
 effective_to date,
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Ended')),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
 selected_by uuid NOT NULL REFERENCES erp_private.staff_members,
 selected_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND ended_reason IS NOT NULL AND effective_to IS NOT NULL))
);
CREATE UNIQUE INDEX client_payroll_returns_one_active ON erp_private.client_payroll_returns(client_id,return_code) WHERE status='Active';
CREATE INDEX client_payroll_returns_selected_by_idx ON erp_private.client_payroll_returns(selected_by);
CREATE INDEX client_payroll_returns_ended_by_idx ON erp_private.client_payroll_returns(ended_by) WHERE ended_by IS NOT NULL;
ALTER TABLE erp_private.client_payroll_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_payroll_returns FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_payroll_returns TO erp_api;
CREATE POLICY cpr_read ON erp_private.client_payroll_returns FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY cpr_insert ON erp_private.client_payroll_returns FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND selected_by=(erp_private.actor()).staff_id AND status='Active');
CREATE POLICY cpr_update ON erp_private.client_payroll_returns FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_payroll_returns FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_payroll_returns FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('selection_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_payroll_returns FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.client_payroll_returns_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.client_id,NEW.return_code,NEW.effective_from,NEW.note,NEW.selected_by,NEW.selected_at) IS DISTINCT FROM ROW(OLD.client_id,OLD.return_code,OLD.effective_from,OLD.note,OLD.selected_by,OLD.selected_at) THEN
   RAISE EXCEPTION 'A chosen return cannot be edited. End it with a reason and choose again.' USING ERRCODE='23514'; END IF;
  IF OLD.status='Ended' THEN RAISE EXCEPTION 'An ended choice cannot be changed.' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'Ended' OR NEW.ended_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'A chosen return can only be ended, by the person ending it.' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON erp_private.client_payroll_returns FOR EACH ROW EXECUTE FUNCTION erp_private.client_payroll_returns_guard();

CREATE TABLE erp_private.client_tax_exceptions(
 exception_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 rate_key text NOT NULL CHECK(char_length(btrim(rate_key)) BETWEEN 2 AND 80),
 kind text NOT NULL CHECK(kind IN('NOT_APPLICABLE','VARIATION')),
 effective_from date NOT NULL,
 effective_to date,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 20 AND 1000),
 legal_basis text NOT NULL CHECK(char_length(btrim(legal_basis)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Active','Ended','Withdrawn')),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 closed_by uuid REFERENCES erp_private.staff_members,
 closed_at timestamptz,
 closed_reason text CHECK(closed_reason IS NULL OR char_length(btrim(closed_reason)) BETWEEN 10 AND 500),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(approved_by IS NULL OR approved_by<>created_by),
 CHECK(status NOT IN('Active','Ended') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(status NOT IN('Ended','Withdrawn') OR (closed_by IS NOT NULL AND closed_at IS NOT NULL AND closed_reason IS NOT NULL)),
 CHECK(status<>'Ended' OR effective_to IS NOT NULL)
);
CREATE INDEX client_tax_exceptions_client_idx ON erp_private.client_tax_exceptions(client_id,rate_key,effective_from);
CREATE INDEX client_tax_exceptions_created_by_idx ON erp_private.client_tax_exceptions(created_by);
CREATE INDEX client_tax_exceptions_approved_by_idx ON erp_private.client_tax_exceptions(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX client_tax_exceptions_closed_by_idx ON erp_private.client_tax_exceptions(closed_by) WHERE closed_by IS NOT NULL;
ALTER TABLE erp_private.client_tax_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_tax_exceptions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_tax_exceptions TO erp_api;
CREATE POLICY cte_read ON erp_private.client_tax_exceptions FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY cte_insert ON erp_private.client_tax_exceptions FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Draft');
CREATE POLICY cte_update ON erp_private.client_tax_exceptions FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_tax_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_tax_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('exception_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_tax_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.client_tax_exceptions_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text;
BEGIN
 me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Draft' OR NEW.created_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Propose a draft exception; approval is separate.' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.rate_key,NEW.kind,NEW.effective_from,NEW.reason,NEW.legal_basis,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.rate_key,OLD.kind,OLD.effective_from,OLD.reason,OLD.legal_basis,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'An exception cannot be edited. Withdraw it and propose a new one.' USING ERRCODE='23514'; END IF;
 IF OLD.status IN('Ended','Withdrawn') THEN RAISE EXCEPTION 'A closed exception cannot be changed.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN RAISE EXCEPTION 'An exception cannot be edited. Withdraw it and propose a new one.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Draft' AND NEW.status='Active' THEN
  IF NEW.approved_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'The approval is recorded under the approver''s own name.' USING ERRCODE='42501'; END IF;
  IF me=OLD.created_by THEN RAISE EXCEPTION 'The person who proposed an exception cannot approve it.' USING ERRCODE='42501'; END IF;
  IF cat<>'PARTNER' AND NOT erp_private.tax_rules_approver() THEN RAISE EXCEPTION 'A Partner, or the Tax Lead, approves an exception to a tax rule.' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':'||NEW.rate_key||':tax-exception',0));
  IF EXISTS(SELECT 1 FROM erp_private.client_tax_exceptions o WHERE o.client_id=NEW.client_id AND o.rate_key=NEW.rate_key AND o.exception_id<>NEW.exception_id AND o.status='Active'
     AND o.effective_from<=COALESCE(NEW.effective_to,'9999-12-31') AND COALESCE(o.effective_to,'9999-12-31')>=NEW.effective_from) THEN
   RAISE EXCEPTION 'Another approved exception for this rule already covers some of these dates. End it first.' USING ERRCODE='23514'; END IF;
 ELSIF OLD.status='Draft' AND NEW.status='Withdrawn' THEN
  IF NEW.closed_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'The withdrawal is recorded under your own name.' USING ERRCODE='42501'; END IF;
 ELSIF OLD.status='Active' AND NEW.status='Ended' THEN
  IF NEW.closed_by IS DISTINCT FROM me OR cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'A Manager or Partner ends an exception, under their own name.' USING ERRCODE='42501'; END IF;
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN RAISE EXCEPTION 'The approval cannot change.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status<>OLD.status OR NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
  RAISE EXCEPTION 'That change is not allowed for an exception.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON erp_private.client_tax_exceptions FOR EACH ROW EXECUTE FUNCTION erp_private.client_tax_exceptions_guard();
