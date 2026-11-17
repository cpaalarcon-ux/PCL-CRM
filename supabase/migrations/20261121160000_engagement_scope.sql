-- Build 2864: engagement scope (two-tier temporal gate). The date a client appointed the firm (the engagement date, which may be backdated to the signed letter) is kept apart from the
-- first period the firm is engaged to work on (the scope start). Work before the scope start is blocked unless a Partner approves a scope override for that period, with a reason.
-- Opening balances and prior-year trial balances are reference data and are never blocked. A client with no scope recorded is not gated yet; the screens say "scope not recorded".
-- A scope is never edited: replacing it ends the old one with a reason. An override is a request that a Partner decides once; a decided override is history.
CREATE TABLE erp_private.client_engagement_scopes(
 scope_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL,
 engagement_date date NOT NULL,
 scope_start_date date NOT NULL,
 scope_end_date date,
 letter_document_id uuid REFERENCES erp_private.documents,
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,recorded_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links ON DELETE RESTRICT,
 CHECK(scope_end_date IS NULL OR scope_end_date>=scope_start_date),
 CHECK(engagement_date>=DATE '2000-01-01' AND scope_start_date>=DATE '2000-01-01'),
 CHECK((ended_by IS NULL)=(ended_at IS NULL) AND (ended_at IS NULL)=(ended_reason IS NULL))
);
CREATE UNIQUE INDEX client_engagement_scopes_live_uidx ON erp_private.client_engagement_scopes(client_id,firm_id) WHERE ended_at IS NULL;
CREATE INDEX client_engagement_scopes_firm_idx ON erp_private.client_engagement_scopes(client_id,firm_id);
CREATE INDEX client_engagement_scopes_doc_idx ON erp_private.client_engagement_scopes(letter_document_id) WHERE letter_document_id IS NOT NULL;
CREATE INDEX client_engagement_scopes_by_idx ON erp_private.client_engagement_scopes(recorded_by);
CREATE INDEX client_engagement_scopes_ended_idx ON erp_private.client_engagement_scopes(ended_by) WHERE ended_by IS NOT NULL;
CREATE FUNCTION erp_private.client_engagement_scopes_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.ended_at IS NOT NULL THEN RAISE EXCEPTION 'An ended scope is history and cannot change.' USING ERRCODE='23514'; END IF;
  IF (NEW.scope_id,NEW.client_id,NEW.firm_id,NEW.engagement_date,NEW.scope_start_date,NEW.scope_end_date,NEW.letter_document_id,NEW.note,NEW.recorded_by,NEW.recorded_at)
     IS DISTINCT FROM (OLD.scope_id,OLD.client_id,OLD.firm_id,OLD.engagement_date,OLD.scope_start_date,OLD.scope_end_date,OLD.letter_document_id,OLD.note,OLD.recorded_by,OLD.recorded_at)
   THEN RAISE EXCEPTION 'An engagement scope is not edited. End it with a reason and record a new one.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_engagement_scopes_guard BEFORE INSERT OR UPDATE ON erp_private.client_engagement_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.client_engagement_scopes_guard();

CREATE TABLE erp_private.scope_overrides(
 override_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL,
 firm_id uuid NOT NULL,
 from_date date NOT NULL,
 to_date date NOT NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 5 AND 500),
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,requested_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'Requested' CHECK(status IN('Requested','Approved','Rejected')),
 decided_by uuid REFERENCES erp_private.staff_members,decided_at timestamptz,
 decision_note text CHECK(decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 3 AND 500),
 sole_partner_approval boolean NOT NULL DEFAULT false,
 FOREIGN KEY(client_id,firm_id) REFERENCES erp_private.client_firm_links ON DELETE RESTRICT,
 CHECK(to_date>=from_date AND to_date<=from_date+3660 AND from_date>=DATE '2000-01-01'),
 CHECK((status='Requested')=(decided_by IS NULL AND decided_at IS NULL)),
 CHECK(status<>'Rejected' OR decision_note IS NOT NULL),
 CHECK(decided_by IS NULL OR decided_by<>requested_by OR sole_partner_approval)
);
CREATE INDEX scope_overrides_client_idx ON erp_private.scope_overrides(client_id,firm_id,status);
CREATE INDEX scope_overrides_open_idx ON erp_private.scope_overrides(requested_at) WHERE status='Requested';
CREATE INDEX scope_overrides_req_idx ON erp_private.scope_overrides(requested_by);
CREATE INDEX scope_overrides_dec_idx ON erp_private.scope_overrides(decided_by) WHERE decided_by IS NOT NULL;
CREATE FUNCTION erp_private.scope_overrides_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.status<>'Requested' THEN RAISE EXCEPTION 'A decided scope override is history and cannot change.' USING ERRCODE='23514'; END IF;
  IF (NEW.override_id,NEW.client_id,NEW.firm_id,NEW.from_date,NEW.to_date,NEW.reason,NEW.requested_by,NEW.requested_at) IS DISTINCT FROM (OLD.override_id,OLD.client_id,OLD.firm_id,OLD.from_date,OLD.to_date,OLD.reason,OLD.requested_by,OLD.requested_at)
   THEN RAISE EXCEPTION 'A scope override request is not edited. Decide it, or ask for a new one.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status<>'Requested' THEN RAISE EXCEPTION 'A scope override starts as a request.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER scope_overrides_guard BEFORE INSERT OR UPDATE ON erp_private.scope_overrides FOR EACH ROW EXECUTE FUNCTION erp_private.scope_overrides_guard();

ALTER TABLE erp_private.client_engagement_scopes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_engagement_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.scope_overrides ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.scope_overrides FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_engagement_scopes TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.scope_overrides TO erp_api;
CREATE POLICY client_engagement_scopes_read ON erp_private.client_engagement_scopes FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY client_engagement_scopes_insert ON erp_private.client_engagement_scopes FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code IN('PARTNER','MANAGER') AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY client_engagement_scopes_update ON erp_private.client_engagement_scopes FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY scope_overrides_read ON erp_private.scope_overrides FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY scope_overrides_insert ON erp_private.scope_overrides FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND requested_by=(erp_private.actor()).staff_id);
CREATE POLICY scope_overrides_update ON erp_private.scope_overrides FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_engagement_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.scope_overrides FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_engagement_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('scope_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.scope_overrides FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('override_id');

-- The one rule every gate uses. NULL means the work may go ahead; text is the plain reason it may not. No live scope means no gate.
CREATE FUNCTION erp_private.scope_block(p_client uuid,p_firm uuid,p_from date,p_to date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE
  WHEN s.scope_id IS NULL THEN NULL
  WHEN p_from>=s.scope_start_date AND (s.scope_end_date IS NULL OR p_to<=s.scope_end_date) THEN NULL
  WHEN EXISTS(SELECT 1 FROM erp_private.scope_overrides o WHERE o.client_id=p_client AND o.firm_id=p_firm AND o.status='Approved' AND o.from_date<=p_from AND o.to_date>=p_to) THEN NULL
  WHEN p_from<s.scope_start_date THEN 'This falls before the engagement scope, which starts on '||to_char(s.scope_start_date,'FMDD Mon YYYY')||'. A Partner can approve a scope override for it.'
  ELSE 'This falls after the engagement scope, which ends on '||to_char(s.scope_end_date,'FMDD Mon YYYY')||'. A Partner can approve a scope override for it.'
 END
 FROM (SELECT 1) x LEFT JOIN erp_private.client_engagement_scopes s ON s.client_id=p_client AND s.firm_id=p_firm AND s.ended_at IS NULL
$$;
REVOKE ALL ON FUNCTION erp_private.scope_block(uuid,uuid,date,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.scope_block(uuid,uuid,date,date) TO erp_api;

-- The database refuses out-of-scope work whichever screen it comes from. The triggers are named so they run before the other guards, so the scope reason is the one shown. Opening journals are reference data and are never refused.
CREATE FUNCTION erp_private.scope_gate_period() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE why text;
BEGIN
 -- A financial year is needed whole, so it is judged by the day it ends; its postings are judged one by one.
 why:=erp_private.scope_block(NEW.client_id,NEW.handling_firm_id,NEW.ends_on,NEW.ends_on);
 IF why IS NOT NULL THEN RAISE EXCEPTION 'TEMPORAL_BLOCK: %',why USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_scope_gate BEFORE INSERT ON erp_private.ledger_periods FOR EACH ROW EXECUTE FUNCTION erp_private.scope_gate_period();
CREATE FUNCTION erp_private.scope_gate_journal() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE why text;p record;
BEGIN
 IF NEW.kind='Opening' THEN RETURN NEW; END IF;
 SELECT client_id,handling_firm_id INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 why:=erp_private.scope_block(p.client_id,p.handling_firm_id,NEW.journal_date,NEW.journal_date);
 IF why IS NOT NULL THEN RAISE EXCEPTION 'TEMPORAL_BLOCK: %',why USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_scope_gate BEFORE INSERT ON erp_private.ledger_journals FOR EACH ROW EXECUTE FUNCTION erp_private.scope_gate_journal();
CREATE FUNCTION erp_private.scope_gate_work_period() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE why text;p record;
BEGIN
 SELECT client_id,handling_firm_id INTO p FROM erp_private.projects WHERE project_id=NEW.project_id;
 why:=erp_private.scope_block(p.client_id,p.handling_firm_id,NEW.starts_on,NEW.ends_on);
 IF why IS NOT NULL THEN RAISE EXCEPTION 'TEMPORAL_BLOCK: %',why USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aa_scope_gate BEFORE INSERT ON erp_private.project_work_periods FOR EACH ROW EXECUTE FUNCTION erp_private.scope_gate_work_period();
