-- Tax credit register with the ERP-versus-iTax variance gate (build 2026-11-10.2730), step 3 of the Partner's build order of 10 Nov 2026 17:46.
-- A credit (withholding VAT, withholding income tax, instalment tax, or a balance carried forward) is entered once, checked against the client's iTax ledger by a
-- DIFFERENT person, and can be claimed in a return only when the two figures agree (RECONCILED) or a Manager/Partner other than the person who entered it has approved the
-- difference with a written reason and the amount to claim (MANAGER_APPROVED). A credit belongs to exactly one tax (VAT, or income tax) and is claimed in at most one return
-- version at a time, so it cannot be counted twice. A return cannot be submitted or locked while an entry for its period is still PENDING or DISPUTED.
-- This is a control, not a tax rule: no rate, formula or entitlement rule is stored or invented here, and the claim amount is always a person's recorded decision.

CREATE TABLE erp_private.tax_credit_entries(
 credit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 credit_type text NOT NULL CHECK(credit_type IN('WHT_VAT','VAT_CARRIED_FORWARD','WHT_INCOME_TAX','INSTALMENT_TAX','INCOME_TAX_CARRIED_FORWARD')),
 applies_to text GENERATED ALWAYS AS (CASE WHEN credit_type IN('WHT_VAT','VAT_CARRIED_FORWARD') THEN 'VAT' ELSE 'INCOME_TAX' END) STORED,
 period_start date NOT NULL,
 period_end date NOT NULL,
 source_reference text NOT NULL CHECK(length(btrim(source_reference))>=3),
 source_document_id uuid REFERENCES erp_private.documents,
 erp_amount numeric(16,2) NOT NULL CHECK(erp_amount>=0),
 itax_amount numeric(16,2) CHECK(itax_amount>=0),
 variance numeric(16,2) GENERATED ALWAYS AS (itax_amount-erp_amount) STORED,
 itax_document_id uuid REFERENCES erp_private.documents,
 itax_checked_by uuid REFERENCES erp_private.staff_members,
 itax_checked_at timestamptz,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','RECONCILED','DISPUTED','MANAGER_APPROVED','REJECTED')),
 claim_amount numeric(16,2) CHECK(claim_amount>=0),
 decision_reason text,
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 claimed_in_case_id uuid REFERENCES erp_private.tax_cases,
 claimed_by uuid REFERENCES erp_private.staff_members,
 claimed_at timestamptz,
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(period_end>=period_start),
 CHECK(status<>'PENDING' OR (itax_amount IS NULL AND itax_checked_by IS NULL AND decided_by IS NULL AND claim_amount IS NULL)),
 CHECK(status<>'RECONCILED' OR (itax_amount IS NOT NULL AND variance=0 AND itax_checked_by IS NOT NULL AND itax_checked_by<>entered_by AND claim_amount=erp_amount)),
 CHECK(status<>'DISPUTED' OR (itax_amount IS NOT NULL AND variance<>0 AND itax_checked_by IS NOT NULL AND itax_checked_by<>entered_by AND claim_amount IS NULL)),
 CHECK(status<>'MANAGER_APPROVED' OR (itax_amount IS NOT NULL AND variance<>0 AND decided_by IS NOT NULL AND decided_by<>entered_by AND length(btrim(COALESCE(decision_reason,'')))>=10 AND claim_amount IS NOT NULL AND claim_amount<=GREATEST(erp_amount,itax_amount))),
 CHECK(status<>'REJECTED' OR (decided_by IS NOT NULL AND length(btrim(COALESCE(decision_reason,'')))>=10 AND claim_amount IS NULL)),
 CHECK(claimed_in_case_id IS NULL OR (status IN('RECONCILED','MANAGER_APPROVED') AND claimed_by IS NOT NULL AND claimed_at IS NOT NULL))
);
-- The same certificate or payment cannot be entered twice while it is live (a rejected entry can be entered again, correctly).
CREATE UNIQUE INDEX tax_credit_live_source_key ON erp_private.tax_credit_entries(client_id,credit_type,lower(btrim(source_reference))) WHERE status<>'REJECTED';
CREATE INDEX tax_credit_project_idx ON erp_private.tax_credit_entries(project_id,applies_to,period_start,period_end);
CREATE INDEX tax_credit_case_idx ON erp_private.tax_credit_entries(claimed_in_case_id) WHERE claimed_in_case_id IS NOT NULL;
CREATE INDEX tax_credit_entered_idx ON erp_private.tax_credit_entries(entered_by);
CREATE INDEX tax_credit_checked_idx ON erp_private.tax_credit_entries(itax_checked_by) WHERE itax_checked_by IS NOT NULL;
CREATE INDEX tax_credit_decided_idx ON erp_private.tax_credit_entries(decided_by) WHERE decided_by IS NOT NULL;
CREATE INDEX tax_credit_claimed_by_idx ON erp_private.tax_credit_entries(claimed_by) WHERE claimed_by IS NOT NULL;
CREATE INDEX tax_credit_client_idx ON erp_private.tax_credit_entries(client_id);
CREATE INDEX tax_credit_source_doc_idx ON erp_private.tax_credit_entries(source_document_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX tax_credit_itax_doc_idx ON erp_private.tax_credit_entries(itax_document_id) WHERE itax_document_id IS NOT NULL;

ALTER TABLE erp_private.tax_credit_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.tax_credit_entries FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.tax_credit_entries TO erp_api;
CREATE POLICY tax_credit_read ON erp_private.tax_credit_entries FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY tax_credit_insert ON erp_private.tax_credit_entries FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN' AND entered_by=(erp_private.actor()).staff_id);
CREATE POLICY tax_credit_update ON erp_private.tax_credit_entries FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

CREATE FUNCTION erp_private.tax_credit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;c erp_private.tax_cases;pr erp_private.projects;v_leader boolean;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;v_leader:=v_cat IN('PARTNER','MANAGER');
 IF TG_OP='INSERT' THEN
  SELECT * INTO pr FROM erp_private.projects WHERE project_id=NEW.project_id;
  IF pr.project_id IS NULL OR pr.client_id<>NEW.client_id THEN RAISE EXCEPTION 'The credit must belong to this client''s engagement' USING ERRCODE='23514'; END IF;
  IF NEW.status<>'PENDING' THEN RAISE EXCEPTION 'A new credit starts as pending iTax confirmation' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 -- What was entered cannot be rewritten; a mistaken entry is rejected and entered again.
 IF ROW(NEW.client_id,NEW.project_id,NEW.credit_type,NEW.period_start,NEW.period_end,NEW.source_reference,NEW.source_document_id,NEW.erp_amount,NEW.entered_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.project_id,OLD.credit_type,OLD.period_start,OLD.period_end,OLD.source_reference,OLD.source_document_id,OLD.erp_amount,OLD.entered_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A credit entry cannot be edited: reject it and enter it again' USING ERRCODE='23514'; END IF;
 IF OLD.status='REJECTED' THEN RAISE EXCEPTION 'A rejected credit is closed' USING ERRCODE='23514'; END IF;
 -- Claiming and releasing a credit: only for an open return of the same engagement and kind.
 IF NEW.claimed_in_case_id IS DISTINCT FROM OLD.claimed_in_case_id THEN
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.itax_amount IS DISTINCT FROM OLD.itax_amount OR NEW.claim_amount IS DISTINCT FROM OLD.claim_amount THEN RAISE EXCEPTION 'Claim or release a credit on its own' USING ERRCODE='23514'; END IF;
  IF NEW.claimed_in_case_id IS NOT NULL THEN
   SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=NEW.claimed_in_case_id;
   IF c.case_id IS NULL OR c.project_id<>NEW.project_id THEN RAISE EXCEPTION 'Claim the credit in a return of the same engagement' USING ERRCODE='23514'; END IF;
   IF OLD.status NOT IN('RECONCILED','MANAGER_APPROVED') THEN RAISE EXCEPTION 'The credit must agree to iTax, or have an approved variance, before it can be claimed' USING ERRCODE='23514'; END IF;
   -- (generated columns are not yet computed in a BEFORE trigger, so the stored OLD value is used; the credit type cannot change)
   IF (OLD.applies_to='VAT' AND c.kind<>'VAT') OR (OLD.applies_to='INCOME_TAX' AND c.kind NOT IN('Company','Individual','Partnership')) THEN RAISE EXCEPTION 'A % credit cannot be claimed in a % return', OLD.applies_to, c.kind USING ERRCODE='23514'; END IF;
   IF c.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'Credits can be claimed only while the return is a draft' USING ERRCODE='23514'; END IF;
   IF NEW.period_start>c.ends_on OR NEW.period_end<c.starts_on THEN RAISE EXCEPTION 'The credit period does not fall in this return period' USING ERRCODE='23514'; END IF;
   IF OLD.claimed_in_case_id IS NOT NULL AND c.amends_case_id IS DISTINCT FROM OLD.claimed_in_case_id THEN RAISE EXCEPTION 'This credit is already claimed in another return; release it there first' USING ERRCODE='23505'; END IF;
   NEW.claimed_by:=v_actor;NEW.claimed_at:=now();
  ELSE
   SELECT * INTO c FROM erp_private.tax_cases WHERE case_id=OLD.claimed_in_case_id;
   IF c.status NOT IN('Draft','Returned') THEN RAISE EXCEPTION 'A credit claimed in a submitted, locked or filed return cannot be released' USING ERRCODE='23514'; END IF;
   NEW.claimed_by:=NULL;NEW.claimed_at:=NULL;
  END IF;
  NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
  RETURN NEW;
 END IF;
 IF OLD.claimed_in_case_id IS NOT NULL THEN RAISE EXCEPTION 'A claimed credit cannot change; release it from its draft return first' USING ERRCODE='23514'; END IF;
 -- Recording the iTax ledger figure: a different person from the one who entered the credit.
 IF NEW.itax_amount IS DISTINCT FROM OLD.itax_amount THEN
  IF NEW.itax_amount IS NULL THEN RAISE EXCEPTION 'The iTax figure cannot be removed' USING ERRCODE='23514'; END IF;
  IF OLD.status NOT IN('PENDING','DISPUTED') THEN RAISE EXCEPTION 'The iTax figure is already settled' USING ERRCODE='23514'; END IF;
  IF v_actor IS NULL OR v_actor=OLD.entered_by THEN RAISE EXCEPTION 'A different person must check the iTax ledger' USING ERRCODE='42501'; END IF;
  NEW.itax_checked_by:=v_actor;NEW.itax_checked_at:=now();NEW.decided_by:=NULL;NEW.decided_at:=NULL;NEW.decision_reason:=NULL;
  IF NEW.itax_amount=NEW.erp_amount THEN NEW.status:='RECONCILED';NEW.claim_amount:=NEW.erp_amount;
  ELSE NEW.status:='DISPUTED';NEW.claim_amount:=NULL;END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status='MANAGER_APPROVED' THEN
   IF OLD.status<>'DISPUTED' THEN RAISE EXCEPTION 'Only a disputed credit can have its variance approved' USING ERRCODE='23514'; END IF;
   IF NOT v_leader OR v_actor=OLD.entered_by THEN RAISE EXCEPTION 'A Manager or Partner other than the person who entered the credit must approve the variance' USING ERRCODE='42501'; END IF;
   NEW.decided_by:=v_actor;NEW.decided_at:=now();
  ELSIF NEW.status='REJECTED' THEN
   IF OLD.status NOT IN('PENDING','DISPUTED') THEN RAISE EXCEPTION 'A reconciled or approved credit cannot be rejected' USING ERRCODE='23514'; END IF;
   IF NOT v_leader THEN RAISE EXCEPTION 'A Manager or Partner must reject a credit entry' USING ERRCODE='42501'; END IF;
   NEW.decided_by:=v_actor;NEW.decided_at:=now();NEW.claim_amount:=NULL;
  ELSE RAISE EXCEPTION 'Record the iTax figure to move a credit forward' USING ERRCODE='23514'; END IF;
 ELSIF NEW.claim_amount IS DISTINCT FROM OLD.claim_amount OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason THEN
  RAISE EXCEPTION 'A decision cannot be edited' USING ERRCODE='23514';
 END IF;
 NEW.updated_at:=now();NEW.revision:=OLD.revision+1;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_credit_guard BEFORE INSERT OR UPDATE ON erp_private.tax_credit_entries FOR EACH ROW EXECUTE FUNCTION erp_private.tax_credit_guard();
CREATE TRIGGER tax_credit_no_delete BEFORE DELETE ON erp_private.tax_credit_entries FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER tax_credit_audit AFTER INSERT OR UPDATE ON erp_private.tax_credit_entries FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('credit_id');

-- A return cannot be submitted or locked while a credit entry for its period is still waiting for the iTax check or has an unresolved difference.
CREATE FUNCTION erp_private.tax_credit_open_count(p_case uuid) RETURNS integer LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT count(*)::integer FROM erp_private.tax_cases c JOIN erp_private.tax_credit_entries e ON e.project_id=c.project_id
 WHERE c.case_id=p_case AND e.status IN('PENDING','DISPUTED')
  AND e.applies_to=CASE WHEN c.kind='VAT' THEN 'VAT' WHEN c.kind IN('Company','Individual','Partnership') THEN 'INCOME_TAX' ELSE 'NONE' END
  AND e.period_start<=c.ends_on AND e.period_end>=c.starts_on
$$;
CREATE FUNCTION erp_private.tax_credit_case_gate() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE n integer;
BEGIN
 IF NEW.status IN('Submitted','Locked') AND OLD.status IS DISTINCT FROM NEW.status THEN
  n:=erp_private.tax_credit_open_count(NEW.case_id);
  IF n>0 THEN RAISE EXCEPTION '% credit entr% for this period still need the iTax check or a decision on a difference', n, CASE WHEN n=1 THEN 'y' ELSE 'ies' END USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_credit_gate BEFORE UPDATE OF status ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_credit_case_gate();

-- What a return claims, by credit type: the one place the totals come from, so a credit is never added in twice.
CREATE FUNCTION erp_private.tax_credit_claimed(p_case uuid) RETURNS TABLE(credit_type text,applies_to text,entries integer,claim_total numeric) LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT e.credit_type,e.applies_to,count(*)::integer,COALESCE(sum(e.claim_amount),0)::numeric FROM erp_private.tax_credit_entries e WHERE e.claimed_in_case_id=p_case GROUP BY e.credit_type,e.applies_to ORDER BY e.credit_type
$$;
REVOKE ALL ON FUNCTION erp_private.tax_credit_guard(),erp_private.tax_credit_open_count(uuid),erp_private.tax_credit_case_gate(),erp_private.tax_credit_claimed(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_credit_guard(),erp_private.tax_credit_open_count(uuid),erp_private.tax_credit_case_gate(),erp_private.tax_credit_claimed(uuid) TO erp_api;
