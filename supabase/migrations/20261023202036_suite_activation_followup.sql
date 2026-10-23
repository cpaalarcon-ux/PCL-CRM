-- Keep approved engagements editable by assigned Supervisors without exposing restricted KYC.
CREATE OR REPLACE FUNCTION erp_private.project_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c erp_private.client_compliance;e erp_private.engagement_controls;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.handling_firm_id<>OLD.handling_firm_id OR NEW.client_id<>OLD.client_id) THEN RAISE EXCEPTION 'A different firm or client requires a new engagement' USING ERRCODE='23514';END IF;
 IF TG_OP='UPDATE' AND OLD.status='Active' AND NEW.status='Active' THEN
  IF NEW.service_code<>OLD.service_code THEN RAISE EXCEPTION 'An active engagement cannot change service; create another project' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='Active' THEN
  SELECT * INTO c FROM erp_private.client_compliance WHERE client_id=NEW.client_id;
  SELECT * INTO e FROM erp_private.engagement_controls WHERE project_id=NEW.project_id;
  IF c.verified_by IS NULL OR c.review_due IS NULL OR c.review_due<current_date OR ((c.is_pep OR c.risk_rating='High') AND c.edd_approved_by IS NULL) OR e.signed_letter_id IS NULL OR e.letter_verified_by IS NULL OR (e.letter_expires_on IS NOT NULL AND e.letter_expires_on<current_date) THEN RAISE EXCEPTION 'Verified current KYC, enhanced review where required, and a verified signed engagement letter are required' USING ERRCODE='23514';END IF;
 END IF;RETURN NEW;
END; $$;
