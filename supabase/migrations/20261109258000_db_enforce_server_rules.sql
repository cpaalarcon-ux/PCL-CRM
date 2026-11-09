-- Step 1 of the joined-practice review (2026-11-09): rules the edge function already enforced are now also enforced by the database,
-- so no other route can bypass them. No new policy: each trigger repeats a server rule that was already live.
--
--  1. KYC verification: verifier is a Manager or Partner, is not the last editor, and the file is complete.
--  2. Tax profile: the person who prepared a profile cannot verify it.
--  3. Tax case: only the preparer submits; the reviewer is the signed-in person and is not the preparer.
--  4. Engagement activation: the opening TB for the year is posted (unless the client has no opening balances).
--  5. Accounting family: once ledger, chart or tax records exist, the legal entity type cannot change.
--  6. Legal structure: a revision needs a Manager or Partner and a reason of at least 10 characters.
--
-- Not included (decisions or larger fixtures): audit file status flow, audit setup needing an active project/KYC (Partner decision),
-- approved chart before a draft project.

-- 1. KYC verification
CREATE FUNCTION erp_private.kyc_verify_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_missing integer;v_struct text;v_sub text;
BEGIN
 IF NEW.verified_by IS NULL THEN RETURN NEW; END IF;
 IF OLD.verified_by IS NOT DISTINCT FROM NEW.verified_by AND OLD.verified_at IS NOT DISTINCT FROM NEW.verified_at THEN RETURN NEW; END IF;
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF v_actor IS NOT NULL THEN
  IF v_cat NOT IN ('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can verify a KYC file' USING ERRCODE='42501'; END IF;
  IF NEW.verified_by<>v_actor THEN RAISE EXCEPTION 'The verifier must be the signed-in Manager or Partner' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.last_edited_by IS NOT DISTINCT FROM NEW.verified_by THEN
  RAISE EXCEPTION 'The person who made the latest KYC change cannot verify it; a different Manager or Partner must' USING ERRCODE='42501';
 END IF;
 SELECT cardinality(c.missing_fields),c.legal_structure,c.legal_subtype INTO v_missing,v_struct,v_sub FROM erp_private.clients c WHERE c.client_id=NEW.client_id;
 IF COALESCE(v_missing,0)>0 OR v_struct IS NULL OR v_sub IS NULL OR NOT COALESCE(NEW.conflict_checked,false) OR NEW.sanctions_date IS NULL OR NEW.sanctions_result IS NULL OR NEW.review_due IS NULL THEN
  RAISE EXCEPTION 'Complete the client fields, legal structure, conflict review, screening and next review date before verifying KYC' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER kyc_verify_guard BEFORE UPDATE OF verified_by,verified_at ON erp_private.client_compliance FOR EACH ROW EXECUTE FUNCTION erp_private.kyc_verify_guard();

-- 2. Tax profile: preparer cannot verify
CREATE FUNCTION erp_private.tax_profile_checker_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status<>'Verified' AND NEW.status='Verified' AND NEW.verified_by IS NOT DISTINCT FROM NEW.created_by THEN
  RAISE EXCEPTION 'The person who prepared a tax profile cannot verify it; a different Manager or Partner must' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_profile_checker BEFORE UPDATE OF status ON erp_private.client_tax_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.tax_profile_checker_guard();

-- 3. Tax case: preparer submits, a different signed-in person reviews
CREATE FUNCTION erp_private.tax_case_reviewer_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 v_actor:=(erp_private.actor()).staff_id;
 IF NEW.status='Submitted' AND OLD.status IN ('Draft','Returned') AND v_actor IS NOT NULL AND v_actor IS DISTINCT FROM NEW.prepared_by THEN
  RAISE EXCEPTION 'Only the preparer can submit a tax case' USING ERRCODE='42501';
 END IF;
 IF OLD.status='Submitted' AND NEW.status IN ('Locked','Returned') THEN
  IF NEW.reviewed_by IS NULL THEN RAISE EXCEPTION 'Record the reviewer' USING ERRCODE='23514'; END IF;
  IF NEW.reviewed_by=NEW.prepared_by THEN RAISE EXCEPTION 'Another reviewer must approve or return this computation' USING ERRCODE='42501'; END IF;
  IF v_actor IS NOT NULL AND NEW.reviewed_by<>v_actor THEN RAISE EXCEPTION 'The reviewer must be the signed-in person' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_reviewer_independent BEFORE UPDATE OF status ON erp_private.tax_cases FOR EACH ROW EXECUTE FUNCTION erp_private.tax_case_reviewer_guard();

-- 4. Engagement activation needs the opening TB posted
CREATE FUNCTION erp_private.project_opening_gate() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_status text;v_on date;
BEGIN
 IF NEW.status<>'Active' OR OLD.status='Active' THEN RETURN NEW; END IF;
 SELECT c.opening_balance_status INTO v_status FROM erp_private.clients c WHERE c.client_id=NEW.client_id;
 IF v_status IS NOT DISTINCT FROM 'No opening balances' THEN RETURN NEW; END IF;
 SELECT s.starts_on INTO v_on FROM erp_private.project_schedules s WHERE s.project_id=NEW.project_id AND s.deleted_at IS NULL LIMIT 1;
 v_on:=COALESCE(v_on,current_date);
 IF NOT EXISTS(SELECT 1 FROM erp_private.ledger_journals j JOIN erp_private.ledger_periods lp ON lp.period_id=j.period_id
  WHERE lp.client_id=NEW.client_id AND lp.starts_on<=v_on AND lp.ends_on>=v_on AND j.kind='Opening' AND j.status='Posted') THEN
  RAISE EXCEPTION 'The project stays Draft until the opening TB for its financial year is independently posted' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_opening_gate BEFORE UPDATE OF status ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.project_opening_gate();

-- 5 and 6. Client legal structure and accounting family
CREATE FUNCTION erp_private.client_structure_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_cat text;
BEGIN
 IF OLD.legal_entity_type IS NOT NULL AND NEW.legal_entity_type IS DISTINCT FROM OLD.legal_entity_type THEN
  IF EXISTS(SELECT 1 FROM erp_private.ledger_periods WHERE client_id=NEW.client_id)
   OR EXISTS(SELECT 1 FROM erp_private.client_chart_versions WHERE client_id=NEW.client_id AND status='Approved')
   OR EXISTS(SELECT 1 FROM erp_private.tax_cases t JOIN erp_private.projects p ON p.project_id=t.project_id WHERE p.client_id=NEW.client_id) THEN
   RAISE EXCEPTION 'This client already has ledger, chart or tax records under % and its accounting family cannot change; use a successor client',OLD.legal_entity_type USING ERRCODE='23514';
  END IF;
 END IF;
 IF OLD.legal_structure IS NOT NULL AND OLD.legal_subtype IS NOT NULL
  AND (NEW.legal_structure IS DISTINCT FROM OLD.legal_structure OR NEW.legal_subtype IS DISTINCT FROM OLD.legal_subtype) THEN
  v_cat:=(erp_private.actor()).category_code;
  IF (erp_private.actor()).staff_id IS NOT NULL AND v_cat NOT IN ('PARTNER','MANAGER') THEN
   RAISE EXCEPTION 'Only a Manager or Partner can change a client legal structure' USING ERRCODE='42501';
  END IF;
  IF length(COALESCE(NEW.legal_structure_note,''))<10 OR NEW.legal_structure_changed_at IS NOT DISTINCT FROM OLD.legal_structure_changed_at THEN
   RAISE EXCEPTION 'Record why the legal structure is being changed (at least 10 characters)' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_structure_guard BEFORE UPDATE OF legal_entity_type,legal_structure,legal_subtype ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.client_structure_guard();

REVOKE EXECUTE ON FUNCTION erp_private.kyc_verify_guard(),erp_private.tax_profile_checker_guard(),erp_private.tax_case_reviewer_guard(),erp_private.project_opening_gate(),erp_private.client_structure_guard() FROM PUBLIC,anon,authenticated,service_role;
