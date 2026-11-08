-- Approval comments and Supervisor-prepared work (staging).
-- 1. A decision (approve, return, reject, accept, lock, reallocate, decline) must carry a note of at least 10 characters after trimming,
--    enforced by the database so no endpoint or script can skip it. A missing (NULL) note fails. Only status changes are checked, so
--    existing rows and system inserts (for example timesheet reversals) are not affected.
-- 2. Work prepared by a Supervisor is checked by a different Supervisor, Manager or Partner, then approved by a Manager or Partner
--    who is neither the preparer nor the checker (the same path as Assistant work). This replaces the 7 and 8 November rule.
-- 3. Three further Partner policies are recorded as Pending. They are sign-offs only; nothing else is switched on by them.

CREATE FUNCTION erp_private.review_note_required() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE n text;
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 IF NEW.status = ANY(string_to_array(TG_ARGV[0],',')) THEN
  n:=to_jsonb(NEW)->>TG_ARGV[1];
  IF length(btrim(coalesce(n,'')))<10 THEN
   RAISE EXCEPTION 'Record a note of at least 10 characters with this decision.' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;

-- zz_ prefix so the rule runs after the existing guards.
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.ledger_report_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Approved,Returned','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.bank_close_explanations FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Accepted,Returned','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.stock_controls FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Approved,Returned','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.client_setup_change_sets FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Approved,Returned','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Locked,Returned','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.timesheets FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Approved,Rejected','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.leave_requests FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Approved,Rejected','review_note');
CREATE TRIGGER zz_review_note BEFORE UPDATE ON erp_private.task_handovers FOR EACH ROW EXECUTE FUNCTION erp_private.review_note_required('Reallocated,Declined','decision_note');

-- Supervisor-prepared journals and charts now need a check, like Assistant work (the guards already require the checker to differ from the preparer).
CREATE OR REPLACE FUNCTION erp_private.is_junior_preparer(p_staff_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.staff_members WHERE staff_id=p_staff_id AND category_code IN ('ASSISTANT','INTERN','SUPERVISOR'));
$$;

-- Proposals: Supervisor proposals are checked too; check and decision notes are mandatory.
CREATE OR REPLACE FUNCTION erp_private.change_proposals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD.status<>'Proposed' THEN RAISE EXCEPTION 'Only a proposal that has not been checked can be checked.'; END IF;
  IF me.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the proposer must check this.'; END IF;
  IF length(btrim(coalesce(NEW.check_note,'')))<10 THEN RAISE EXCEPTION 'Record the check conclusion (at least 10 characters).' USING ERRCODE='23514'; END IF;
  NEW.checked_by:=me.staff_id;NEW.checked_at:=now();
 ELSIF NEW.status='Approved' THEN
  IF me.category_code NOT IN('MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by OR me.staff_id IS NOT DISTINCT FROM OLD.checked_by THEN
   RAISE EXCEPTION 'A Manager or Partner who neither proposed nor checked this must approve it.';
  END IF;
  IF OLD.status<>'Checked' THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner must check this proposal before approval.'; END IF;
  IF length(btrim(coalesce(NEW.decision_note,'')))<10 THEN RAISE EXCEPTION 'Record the approval note (at least 10 characters).' USING ERRCODE='23514'; END IF;
  NEW.decided_by:=me.staff_id;NEW.decided_at:=now();
 ELSIF NEW.status='Returned' THEN
  IF me.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') OR me.staff_id=OLD.proposed_by THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner other than the proposer must return this.'; END IF;
  IF length(btrim(coalesce(NEW.decision_note,'')))<10 THEN RAISE EXCEPTION 'Record why it is returned (at least 10 characters).' USING ERRCODE='23514'; END IF;
  NEW.decided_by:=me.staff_id;NEW.decided_at:=now();
 ELSE RAISE EXCEPTION 'Unsupported proposal status change.';
 END IF;
 RETURN NEW;
END $$;

INSERT INTO erp_private.system_policies(policy_code,policy_name,statement) VALUES
 ('ASSIGNMENT_POLICY','Assignment Policy','I confirm that recurring tasks are auto-assigned from the Staff Assignment Matrix and that the Open Board is used for ad-hoc work only.'),
 ('LEAVE_HANDOVER_POLICY','Leave Handover Policy','I confirm that when leave is approved, the Manager must reassign the person''s tasks through the Handover Wizard, and that in-progress tasks stay with the substitute until filed.'),
 ('SECURITY_POLICY','Security Policy','I confirm that client portal credentials are stored encrypted (AES-256) with the key held outside the database, that revealing a password requires a second factor and is logged, and that cancelled projects keep their documents locked read-only indefinitely.')
ON CONFLICT (policy_code) DO NOTHING;

-- 4. Approval trail for exports. audit_events is append-only and not readable by the API role, so a narrow, read-only function
--    returns the approval steps (created, submitted, checked, approved, returned) for named record types only. Supervisor, Manager or Partner.
CREATE FUNCTION erp_private.approval_trail(p_table text,p_keys text[]) RETURNS TABLE(occurred_at timestamptz,step text,comment text,who_name text,who_role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN ('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'Supervisor, Manager or Partner required' USING ERRCODE='42501'; END IF;
 IF p_table NOT IN ('tax_cases','ledger_journals','ledger_report_reviews','change_proposals','timesheets','leave_requests','task_handovers','client_chart_versions','stock_controls','bank_close_explanations','client_setup_change_sets') THEN
  RAISE EXCEPTION 'Unsupported record type' USING ERRCODE='22023';
 END IF;
 IF coalesce(array_length(p_keys,1),0)=0 OR array_length(p_keys,1)>1000 THEN RAISE EXCEPTION 'Choose between 1 and 1000 records' USING ERRCODE='22023'; END IF;
 RETURN QUERY
 SELECT e.occurred_at,
  CASE WHEN e.action='INSERT' THEN 'Created ('||coalesce(e.after_values->>'status','new')||')'
       WHEN e.after_values->>'checked_by' IS DISTINCT FROM e.before_values->>'checked_by' AND e.after_values->>'checked_by' IS NOT NULL THEN 'Checked'
       ELSE coalesce(e.before_values->>'status','?')||' > '||coalesce(e.after_values->>'status','?') END,
  CASE WHEN e.action='INSERT' THEN coalesce(e.after_values->>'prepared_note',e.after_values->>'reason','')
       WHEN e.after_values->>'checked_by' IS DISTINCT FROM e.before_values->>'checked_by' AND e.after_values->>'checked_by' IS NOT NULL THEN coalesce(e.after_values->>'check_note','')
       ELSE coalesce(e.after_values->>'review_note',e.after_values->>'decision_note','') END,
  coalesce(s.full_name,'System'),coalesce(s.category_code,'')
 FROM erp_private.audit_events e LEFT JOIN erp_private.staff_members s ON s.auth_user_id=e.actor_auth_id
 WHERE e.table_name=p_table AND e.record_key=ANY(p_keys)
  AND (e.action='INSERT' OR e.after_values->>'status' IS DISTINCT FROM e.before_values->>'status' OR (e.after_values->>'checked_by' IS DISTINCT FROM e.before_values->>'checked_by' AND e.after_values->>'checked_by' IS NOT NULL))
 ORDER BY e.occurred_at,e.event_id;
END $$;
REVOKE ALL ON FUNCTION erp_private.approval_trail(text,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.approval_trail(text,text[]) TO erp_api;

-- 5. The error text said "prepared by an Assistant"; it now covers Supervisor-prepared work too (the rule itself was changed in section 2).
DO $$
BEGIN
 EXECUTE replace(pg_get_functiondef('erp_private.ledger_check_guard()'::regprocedure),'prepared by an Assistant,','prepared by an Assistant or Supervisor,');
 EXECUTE replace(pg_get_functiondef('erp_private.client_chart_version_guard()'::regprocedure),'a chart prepared by an Assistant before','a chart prepared by an Assistant or Supervisor before');
END $$;
