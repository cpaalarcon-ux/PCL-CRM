-- Propose-and-approve for client onboarding data entry (staging).
-- An Assistant or Supervisor saves a proposal that holds exactly what they entered. For an Assistant's proposal a Supervisor, Manager or
-- Partner checks it first; then a Manager or Partner who is neither the proposer nor the checker approves it. Approval replays the stored
-- request under the approver's own name, so every existing validation and review rule still runs. Nothing is deleted.
CREATE TABLE erp_private.change_proposals (
 proposal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid REFERENCES erp_private.clients,
 action text NOT NULL CHECK(length(action) BETWEEN 3 AND 80),
 summary text NOT NULL CHECK(length(btrim(summary)) BETWEEN 3 AND 300),
 payload jsonb NOT NULL,
 reason text,
 status text NOT NULL DEFAULT 'Proposed' CHECK(status IN('Proposed','Checked','Approved','Returned','Withdrawn')),
 proposed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 proposed_role text NOT NULL CHECK(proposed_role IN('ASSISTANT','SUPERVISOR')),
 proposed_at timestamptz NOT NULL DEFAULT now(),
 checked_by uuid REFERENCES erp_private.staff_members,
 checked_at timestamptz,
 check_note text,
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 decision_note text,
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status NOT IN('Approved') OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
 CHECK(status NOT IN('Checked') OR (checked_by IS NOT NULL AND checked_at IS NOT NULL)),
 CHECK(status<>'Returned' OR (decision_note IS NOT NULL AND length(btrim(decision_note))>=3)),
 CHECK(checked_by IS NULL OR checked_by<>proposed_by),
 CHECK(decided_by IS NULL OR decided_by<>proposed_by)
);
CREATE INDEX change_proposals_open_idx ON erp_private.change_proposals(status,proposed_at DESC);
CREATE INDEX change_proposals_client_idx ON erp_private.change_proposals(client_id,proposed_at DESC);

CREATE FUNCTION erp_private.change_proposals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE me erp_private.staff_members;
BEGIN
 IF NEW.action IS DISTINCT FROM OLD.action OR NEW.payload IS DISTINCT FROM OLD.payload OR NEW.proposed_by IS DISTINCT FROM OLD.proposed_by
  OR NEW.proposed_role IS DISTINCT FROM OLD.proposed_role OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.summary IS DISTINCT FROM OLD.summary THEN
  RAISE EXCEPTION 'A proposal cannot be edited. Withdraw it and propose again.';
 END IF;
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF OLD.status IN('Approved','Returned','Withdrawn') THEN RAISE EXCEPTION 'This proposal is already closed.'; END IF;
 me:=erp_private.actor();
 IF NEW.status='Withdrawn' THEN
  IF me.staff_id<>OLD.proposed_by THEN RAISE EXCEPTION 'Only the person who proposed this can withdraw it.'; END IF;
 ELSIF NEW.status='Checked' THEN
  IF OLD.status<>'Proposed' OR OLD.proposed_role<>'ASSISTANT' THEN RAISE EXCEPTION 'Only an Assistant proposal waits for a check.'; END IF;
  IF me.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the proposer must check this.'; END IF;
  NEW.checked_by:=me.staff_id;NEW.checked_at:=now();
 ELSIF NEW.status='Approved' THEN
  IF me.category_code NOT IN('MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by OR me.staff_id IS NOT DISTINCT FROM OLD.checked_by THEN
   RAISE EXCEPTION 'A Manager or Partner who neither proposed nor checked this must approve it.';
  END IF;
  IF OLD.proposed_role='ASSISTANT' AND OLD.status<>'Checked' THEN RAISE EXCEPTION 'An Assistant proposal needs a Supervisor, Manager or Partner check before approval.'; END IF;
  NEW.decided_by:=me.staff_id;NEW.decided_at:=now();
 ELSIF NEW.status='Returned' THEN
  IF me.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the proposer must return this.'; END IF;
  IF me.category_code='SUPERVISOR' AND OLD.proposed_role<>'ASSISTANT' THEN RAISE EXCEPTION 'A Supervisor proposal is returned by a Manager or Partner.'; END IF;
  NEW.decided_by:=me.staff_id;NEW.decided_at:=now();
 ELSE RAISE EXCEPTION 'Unsupported proposal status change.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER change_proposals_guard BEFORE UPDATE ON erp_private.change_proposals FOR EACH ROW EXECUTE FUNCTION erp_private.change_proposals_guard();

ALTER TABLE erp_private.change_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.change_proposals FORCE ROW LEVEL SECURITY;
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.change_proposals FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.change_proposals FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('proposal_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.change_proposals FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
GRANT SELECT,INSERT,UPDATE ON erp_private.change_proposals TO erp_api;
CREATE POLICY change_proposals_read ON erp_private.change_proposals FOR SELECT TO erp_api
 USING((client_id IS NULL OR erp_private.client_allowed(client_id)) AND (proposed_by=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code IN('SUPERVISOR','MANAGER','PARTNER')));
CREATE POLICY change_proposals_insert ON erp_private.change_proposals FOR INSERT TO erp_api
 WITH CHECK(proposed_by=(erp_private.actor()).staff_id AND proposed_role=(erp_private.actor()).category_code AND status='Proposed' AND (client_id IS NULL OR erp_private.client_allowed(client_id)));
CREATE POLICY change_proposals_update ON erp_private.change_proposals FOR UPDATE TO erp_api
 USING((client_id IS NULL OR erp_private.client_allowed(client_id)) AND (proposed_by=(erp_private.actor()).staff_id OR (erp_private.actor()).category_code IN('SUPERVISOR','MANAGER','PARTNER')))
 WITH CHECK(client_id IS NULL OR erp_private.client_allowed(client_id));
