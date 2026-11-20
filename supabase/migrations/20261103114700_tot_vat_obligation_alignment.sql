-- Keep a tax profile's entity/regime facts separate from each obligation's
-- iTax registration, legal applicability and client status. Firm-handled scope
-- remains on the project schedule / engagement.
ALTER TABLE erp_private.client_tax_profiles
 ADD COLUMN obligation_statuses jsonb NOT NULL DEFAULT '{}'::jsonb,
 ADD COLUMN vat_taxable_supplies_status text NOT NULL DEFAULT 'UNKNOWN',
 ADD COLUMN vat_taxable_supplies_12m numeric(18,2),
 ADD COLUMN vat_threshold_checked_on date,
 ADD COLUMN vat_threshold_evidence_reference text,
 ADD COLUMN obligations_reviewed_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN obligations_reviewed_at timestamptz,
 ADD CONSTRAINT client_tax_profiles_obligation_statuses_object CHECK(jsonb_typeof(obligation_statuses)='object'),
 ADD CONSTRAINT client_tax_profiles_vat_status CHECK(vat_taxable_supplies_status IN('CONFIRMED','UNKNOWN')),
 ADD CONSTRAINT client_tax_profiles_vat_amount_nonnegative CHECK(vat_taxable_supplies_12m IS NULL OR vat_taxable_supplies_12m>=0),
 ADD CONSTRAINT client_tax_profiles_vat_check_complete CHECK(
   (vat_taxable_supplies_status='UNKNOWN' AND vat_taxable_supplies_12m IS NULL AND vat_threshold_checked_on IS NULL AND vat_threshold_evidence_reference IS NULL) OR
   (vat_taxable_supplies_status='CONFIRMED' AND vat_taxable_supplies_12m IS NOT NULL AND vat_threshold_checked_on IS NOT NULL AND nullif(btrim(vat_threshold_evidence_reference),'') IS NOT NULL)
 );

-- Verified identity, regime, obligations and period dates stay immutable.
-- A Manager/Partner may add or refresh only the separately audited obligation
-- evidence and VAT-threshold assessment on an existing verified version.
CREATE OR REPLACE FUNCTION erp_private.tax_profile_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.status='Verified' THEN
  IF ROW(NEW.client_id,NEW.entity_type,NEW.residency,NEW.regime,NEW.obligations,NEW.annual_turnover,NEW.effective_from,NEW.effective_to,NEW.notes,NEW.created_by,NEW.verified_by,NEW.verified_at,NEW.status,NEW.deleted_at)
     IS DISTINCT FROM
     ROW(OLD.client_id,OLD.entity_type,OLD.residency,OLD.regime,OLD.obligations,OLD.annual_turnover,OLD.effective_from,OLD.effective_to,OLD.notes,OLD.created_by,OLD.verified_by,OLD.verified_at,OLD.status,OLD.deleted_at) THEN
   RAISE EXCEPTION 'Verified profile facts are immutable; update only the separately reviewed obligation details' USING ERRCODE='23514';
  END IF;
  IF NOT erp_private.is_leader() OR NEW.obligations_reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id OR NEW.obligations_reviewed_at IS NULL THEN
   RAISE EXCEPTION 'Manager or Partner review is required to update obligation registration facts' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.client_id<>OLD.client_id OR NEW.created_by<>OLD.created_by THEN RAISE EXCEPTION 'Profile identity cannot change';END IF;
 IF NEW.status='Verified' THEN
  IF NOT erp_private.is_leader() OR NEW.verified_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'Manager or Partner verification required' USING ERRCODE='42501';END IF;
  IF NEW.obligations_reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id OR NEW.obligations_reviewed_at IS NULL THEN RAISE EXCEPTION 'Review obligation registration facts before verifying the profile' USING ERRCODE='23514';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':taxprofile',0));
  IF EXISTS(SELECT 1 FROM erp_private.client_tax_profiles p WHERE p.client_id=NEW.client_id AND p.profile_id<>NEW.profile_id AND p.status='Verified' AND p.deleted_at IS NULL AND p.effective_from<=NEW.effective_to AND p.effective_to>=NEW.effective_from) THEN RAISE EXCEPTION 'Verified profile periods overlap' USING ERRCODE='23514';END IF;
 END IF;
 RETURN NEW;
END;$$;

-- Every recurring tax filing task must satisfy the confirmed obligation, the
-- effective dated profile, evidence, and the engagement's selected service.
-- Unknown or inconsistent legacy profiles therefore cannot create new filing
-- tasks in the background scheduler.
CREATE OR REPLACE FUNCTION erp_private.tax_task_obligation_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE code text; cid uuid; profile erp_private.client_tax_profiles; scheduled boolean:=false; vat jsonb;
BEGIN
 code:=CASE NEW.template_key
  WHEN 'monthly-vat' THEN 'VAT' WHEN 'monthly-paye' THEN 'PAYE' WHEN 'monthly-tot' THEN 'TOT' WHEN 'monthly-mri' THEN 'MRI'
  WHEN 'monthly-housing-levy' THEN 'Housing levy' WHEN 'monthly-shif' THEN 'SHIF' WHEN 'monthly-nssf' THEN 'NSSF'
  WHEN 'monthly-nita' THEN 'NITA' WHEN 'monthly-fringe-benefit' THEN 'Fringe benefit' WHEN 'monthly-deemed-interest' THEN 'Deemed interest'
  ELSE NULL END;
 IF code IS NULL THEN RETURN NEW; END IF;

 SELECT client_id INTO cid FROM erp_private.projects WHERE project_id=NEW.project_id AND deleted_at IS NULL;
 IF cid IS NULL THEN RETURN NULL; END IF;
 SELECT p.* INTO profile FROM erp_private.client_tax_profiles p
  WHERE p.client_id=cid AND p.status='Verified' AND p.deleted_at IS NULL
   AND p.effective_from<=NEW.period_start AND p.effective_to>=NEW.period_end
  ORDER BY p.effective_from DESC LIMIT 1;
 IF profile.profile_id IS NULL OR NOT (code=ANY(profile.obligations)) OR profile.obligations_reviewed_at IS NULL THEN RETURN NULL; END IF;
 IF COALESCE(profile.obligation_statuses->code->>'registered','UNKNOWN')<>'YES'
  OR COALESCE(profile.obligation_statuses->code->>'applicable','TO_CONFIRM')<>'YES'
  OR COALESCE(profile.obligation_statuses->code->>'client_status','UNKNOWN') IN('DEREGISTERED','NOT_REGISTERED','UNKNOWN')
  OR COALESCE(profile.obligation_statuses->code->>'evidence_reference','')='' THEN RETURN NULL; END IF;

 IF code='TOT' THEN
  IF profile.regime<>'TOT' OR profile.vat_taxable_supplies_status<>'CONFIRMED' OR profile.vat_taxable_supplies_12m IS NULL OR profile.vat_threshold_checked_on IS NULL OR nullif(btrim(profile.vat_threshold_evidence_reference),'') IS NULL THEN RETURN NULL; END IF;
  IF profile.vat_taxable_supplies_12m>=5000000 THEN
   vat:=profile.obligation_statuses->'VAT';
   IF NOT ('VAT'=ANY(profile.obligations)) OR COALESCE(vat->>'registered','UNKNOWN')<>'YES' OR COALESCE(vat->>'applicable','TO_CONFIRM')<>'YES' OR COALESCE(vat->>'evidence_reference','')='' THEN RETURN NULL; END IF;
  END IF;
 END IF;
 IF code='VAT' AND profile.regime='TOT' AND (profile.vat_taxable_supplies_status<>'CONFIRMED' OR profile.vat_taxable_supplies_12m IS NULL OR profile.vat_threshold_checked_on IS NULL OR nullif(btrim(profile.vat_threshold_evidence_reference),'') IS NULL) THEN RETURN NULL; END IF;

 SELECT EXISTS(
  SELECT 1 FROM erp_private.project_schedules s WHERE s.project_id=NEW.project_id AND s.version=NEW.schedule_version AND s.enabled AND s.deleted_at IS NULL AND code=ANY(s.obligations)
  UNION ALL
  SELECT 1 FROM erp_private.project_schedule_history h WHERE h.project_id=NEW.project_id AND h.version=NEW.schedule_version AND h.enabled AND h.deleted_at IS NULL AND code=ANY(h.obligations)
 ) INTO scheduled;
 IF NOT scheduled THEN RETURN NULL; END IF;
 RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS task_tax_obligation_gate ON erp_private.tasks;
CREATE TRIGGER task_tax_obligation_gate BEFORE INSERT ON erp_private.tasks FOR EACH ROW EXECUTE FUNCTION erp_private.tax_task_obligation_gate();
REVOKE EXECUTE ON FUNCTION erp_private.tax_task_obligation_gate() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.tax_task_obligation_gate() TO erp_api;

INSERT INTO erp_private.release_checks(check_code,title,owner_position)
VALUES('TOTVAT','TOT/VAT coexistence, KES 5m threshold, daily records and separate eTIMS requirement verified in staging','Tax Lead')
ON CONFLICT(check_code) DO NOTHING;
