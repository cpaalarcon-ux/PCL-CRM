-- Build 2833: catalogue aligned to the Service Expansion and Workflow Update Specification v1.1, and an eligibility register.
-- 1. Ten service records are added: BRS annual returns, audit co-sourcing, business valuation, executive recruitment, IT and systems review, and five
--    restricted services (insolvency, trustee/executor, attestation, derivatives, sustainability assurance). None is assumed from a client's type.
-- 2. Eligibility register: for the services that need it, the firm licence, the named practitioner's authorization, technical competence, independence and
--    conflict check, the appointment, or management approval of the business line is recorded with evidence and an expiry date. A Partner other than the
--    recorder verifies it. A project for such a service cannot become Active until every required kind is verified and unexpired. Records are never deleted
--    or edited; an old one is ended with a reason. This records evidence a person supplies; it does not establish that anyone holds a licence.
-- The new services use codes that avoid the AUD- prefix, which creates a statutory-audit file with its gates.
INSERT INTO erp_private.services(service_code,service_group,service_name,is_active) VALUES
 ('ADV-BRS','Advisory & Consulting','BRS Annual Returns & Corporate Compliance',true),
 ('ADV-COSRC','Audit & Assurance','Audit Co-sourcing / Outsourced Audit Support',true),
 ('ADV-VAL','Advisory & Consulting','Business Valuation',true),
 ('ADV-REC','Advisory & Consulting','Executive Recruitment',true),
 ('ADV-ITR','Advisory & Consulting','IT & Systems Review',true),
 ('RST-INS','Advisory & Consulting','Insolvency Practice (restricted)',true),
 ('RST-TRU','Advisory & Consulting','Trustee / Executor Services (restricted)',true),
 ('RST-ATT','Audit & Assurance','Attestation Engagements (restricted)',true),
 ('RST-DER','Advisory & Consulting','Derivatives Advisory (restricted)',true),
 ('RST-SUS','Audit & Assurance','Sustainability Reporting Assurance (restricted)',true)
ON CONFLICT (service_code) DO NOTHING;
INSERT INTO erp_private.service_profiles(service_code,engine,engine_state,note) VALUES
 ('ADV-BRS','Checklist only','Built','Free-form tasks and the file checklist. The annual-return calendar and officer, ownership and address change events are not built yet.'),
 ('ADV-COSRC','Restricted file','Planned','Appointed auditor, who directs and signs, independence before access, and workpaper handover are not built yet. Needs eligibility and independence evidence before it can be active.'),
 ('ADV-VAL','Restricted file','Planned','Purpose, basis, date, assumptions log and immutable report versions are not built yet. Needs competence and independence evidence before it can be active.'),
 ('ADV-REC','Restricted file','Planned','A separate business line. Needs management approval recorded before it can be active. Candidate consent, retention and restricted access are not built yet.'),
 ('ADV-ITR','Checklist only','Built','Free-form tasks and the file checklist. Needs competence evidence before it can be active.'),
 ('RST-INS','Restricted file','Planned','Unavailable until the practitioner authorization, appointment and independence are verified and a template is approved.'),
 ('RST-TRU','Restricted file','Planned','Unavailable until the practitioner authorization and the appointment are verified and a template is approved.'),
 ('RST-ATT','Restricted file','Planned','Unavailable until licence, authorization, competence and independence are verified and a template is approved.'),
 ('RST-DER','Restricted file','Planned','Unavailable until licence and competence are verified and a template is approved.'),
 ('RST-SUS','Restricted file','Planned','Readiness only until accreditation and independence checks are verified and a template is approved.')
ON CONFLICT (service_code) DO NOTHING;
INSERT INTO erp_private.service_references(service_code,kind,reference) VALUES
 ('ADV-BRS','Law','Companies Act, 2015: annual returns and beneficial ownership'),('ADV-BRS','Guidance','BRS public notice on beneficial ownership compliance'),
 ('ADV-COSRC','Guidance','The appointed auditor''s engagement terms and the ICPAK Firm Management Guide (January 2018)'),
 ('ADV-VAL','Standard','International Valuation Standards: edition and applicability to be confirmed by the Compliance Lead'),
 ('ADV-REC','Law','Data Protection Act, 2019'),
 ('ADV-ITR','Guidance','ICPAK Firm Management Guide (January 2018): IT and systems review'),
 ('RST-INS','Law','Insolvency Act, 2015 and the BRS insolvency practitioner requirements'),
 ('RST-TRU','Guidance','The appointment instrument and the trust or succession law that applies, to be confirmed'),
 ('RST-ATT','Standard','The IAASB assurance standard that applies to the attestation, to be confirmed'),
 ('RST-DER','Guidance','Applicable capital-markets and reporting rules, to be confirmed'),
 ('RST-SUS','Standard','The IAASB sustainability assurance standard and its applicability, to be confirmed');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,record_check,required,sort_order)
SELECT s.service_code,v.item_key,v.stage,v.label,'Record',v.rc,true,v.ord FROM erp_private.services s
 CROSS JOIN (VALUES
  ('kyc','Acceptance','Client KYC verified and current','KYC_VERIFIED',10),
  ('letter','Acceptance','Signed engagement letter uploaded and verified','LETTER_VERIFIED',20),
  ('fee','Acceptance','Fee agreed (a fee budget or an active recurring fee)','FEE_AGREED',30),
  ('team','Execution','Team assigned to the project','TEAM_ASSIGNED',40)
 ) v(item_key,stage,label,rc,ord) WHERE s.service_code IN('ADV-BRS','ADV-COSRC','ADV-VAL','ADV-REC','ADV-ITR','RST-INS','RST-TRU','RST-ATT','RST-DER','RST-SUS');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note)
SELECT s.service_code,'workpapers','Execution','Working papers or supporting schedules filed','Document','Working Papers',true,50,'' FROM erp_private.services s
 WHERE s.service_code IN('ADV-BRS','ADV-COSRC','ADV-VAL','ADV-REC','ADV-ITR','RST-INS','RST-TRU','RST-ATT','RST-DER','RST-SUS');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note)
SELECT s.service_code,'deliverable','Issue','Signed deliverable filed (report, memo, certificate or letter)','Document','Final Reports',true,60,'' FROM erp_private.services s
 WHERE s.service_code IN('ADV-BRS','ADV-COSRC','ADV-VAL','ADV-REC','ADV-ITR','RST-INS','RST-TRU','RST-ATT','RST-DER','RST-SUS');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note) VALUES
 ('ADV-BRS','receipt','Issue','BRS submission acknowledgement','Document','BRS Receipts',true,58,'Kept apart from the return itself.'),
 ('ADV-COSRC','appointment','Acceptance','Appointed auditor''s instruction and responsibilities','Document','Signed Engagement Letters',true,15,''),
 ('ADV-VAL','data_register','Execution','Source data, assumptions and method','Document','Working Papers',true,52,'');

-- ---- Eligibility ----------------------------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.service_eligibility_requirements(
 service_code text NOT NULL REFERENCES erp_private.services,
 kind text NOT NULL CHECK(kind IN('Firm licence','Practitioner authorization','Technical competence','Independence and conflicts','Appointment','Management approval')),
 PRIMARY KEY(service_code,kind)
);
INSERT INTO erp_private.service_eligibility_requirements(service_code,kind) VALUES
 ('ADV-COSRC','Firm licence'),('ADV-COSRC','Independence and conflicts'),('ADV-COSRC','Appointment'),
 ('ADV-VAL','Technical competence'),('ADV-VAL','Independence and conflicts'),
 ('ADV-REC','Management approval'),
 ('ADV-ITR','Technical competence'),
 ('RST-INS','Firm licence'),('RST-INS','Practitioner authorization'),('RST-INS','Appointment'),('RST-INS','Independence and conflicts'),
 ('RST-TRU','Practitioner authorization'),('RST-TRU','Appointment'),
 ('RST-ATT','Firm licence'),('RST-ATT','Practitioner authorization'),('RST-ATT','Technical competence'),('RST-ATT','Independence and conflicts'),
 ('RST-DER','Firm licence'),('RST-DER','Technical competence'),
 ('RST-SUS','Firm licence'),('RST-SUS','Technical competence'),('RST-SUS','Independence and conflicts');
CREATE TABLE erp_private.service_eligibility_records(
 record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_code text NOT NULL,
 kind text NOT NULL,
 staff_id uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 authority text NOT NULL CHECK(char_length(btrim(authority)) BETWEEN 2 AND 200),
 reference text NOT NULL CHECK(char_length(btrim(reference)) BETWEEN 3 AND 200),
 evidence_note text NOT NULL CHECK(char_length(btrim(evidence_note)) BETWEEN 10 AND 1000),
 valid_from date NOT NULL,
 expires_on date NOT NULL,
 status text NOT NULL DEFAULT 'Recorded' CHECK(status IN('Recorded','Verified','Ended')),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 verified_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 verified_at timestamptz,
 verification_note text CHECK(verification_note IS NULL OR char_length(btrim(verification_note)) BETWEEN 10 AND 1000),
 sole_partner_verify boolean NOT NULL DEFAULT false,
 ended_by uuid REFERENCES erp_private.staff_members ON DELETE RESTRICT,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(service_code,kind) REFERENCES erp_private.service_eligibility_requirements(service_code,kind) ON DELETE RESTRICT,
 CHECK(expires_on>valid_from),
 CHECK((kind IN('Practitioner authorization','Technical competence'))=(staff_id IS NOT NULL)),
 CHECK(status<>'Verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND verification_note IS NOT NULL)),
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND ended_reason IS NOT NULL)),
 CHECK(NOT sole_partner_verify OR verified_by=recorded_by)
);
CREATE INDEX service_eligibility_records_service_idx ON erp_private.service_eligibility_records(service_code,kind,status);
CREATE INDEX service_eligibility_records_staff_idx ON erp_private.service_eligibility_records(staff_id) WHERE staff_id IS NOT NULL;
CREATE INDEX service_eligibility_records_recorded_idx ON erp_private.service_eligibility_records(recorded_by);
CREATE INDEX service_eligibility_records_verified_idx ON erp_private.service_eligibility_records(verified_by) WHERE verified_by IS NOT NULL;
CREATE INDEX service_eligibility_records_ended_idx ON erp_private.service_eligibility_records(ended_by) WHERE ended_by IS NOT NULL;
ALTER TABLE erp_private.service_eligibility_requirements ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.service_eligibility_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_eligibility_records ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.service_eligibility_records FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.service_eligibility_requirements,erp_private.service_eligibility_records FROM PUBLIC,anon,authenticated;
GRANT SELECT ON erp_private.service_eligibility_requirements TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.service_eligibility_records TO erp_api;
CREATE POLICY sel_req_read ON erp_private.service_eligibility_requirements FOR SELECT TO erp_api USING(true);
CREATE POLICY sel_rec_read ON erp_private.service_eligibility_records FOR SELECT TO erp_api USING((erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY sel_rec_insert ON erp_private.service_eligibility_records FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY sel_rec_update ON erp_private.service_eligibility_records FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.service_eligibility_records FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.service_eligibility_records FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('record_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.service_eligibility_records FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();

CREATE FUNCTION erp_private.service_eligibility_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE me uuid; cat text; api boolean:=current_user='erp_api';
BEGIN
 IF api THEN me:=(erp_private.actor()).staff_id; cat:=(erp_private.actor()).category_code; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Recorded' OR NEW.verified_by IS NOT NULL OR NEW.ended_by IS NOT NULL OR NEW.sole_partner_verify THEN RAISE EXCEPTION 'Record the evidence first; a Partner verifies it afterwards.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.service_code,NEW.kind,NEW.staff_id,NEW.authority,NEW.reference,NEW.evidence_note,NEW.valid_from,NEW.expires_on,NEW.recorded_by,NEW.recorded_at) IS DISTINCT FROM ROW(OLD.service_code,OLD.kind,OLD.staff_id,OLD.authority,OLD.reference,OLD.evidence_note,OLD.valid_from,OLD.expires_on,OLD.recorded_by,OLD.recorded_at) THEN
  RAISE EXCEPTION 'A recorded eligibility entry is never edited. End it with a reason and record a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Ended' THEN RAISE EXCEPTION 'An ended entry stays as it was.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Recorded' AND NEW.status='Verified' THEN
  IF api THEN
   IF cat<>'PARTNER' THEN RAISE EXCEPTION 'A Partner verifies eligibility evidence.' USING ERRCODE='42501'; END IF;
   IF NEW.verified_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Verification is recorded under your own name.' USING ERRCODE='42501'; END IF;
   IF OLD.recorded_by IS NOT DISTINCT FROM me THEN
    IF NOT erp_private.sole_active_partner() OR NOT NEW.sole_partner_verify THEN RAISE EXCEPTION 'A different Partner verifies evidence you recorded, unless you are your firm''s only Partner.' USING ERRCODE='42501'; END IF;
   ELSIF NEW.sole_partner_verify THEN RAISE EXCEPTION 'That flag is set only when a sole Partner verifies their own entry.' USING ERRCODE='23514';
   END IF;
  END IF;
  IF ROW(NEW.ended_by,NEW.ended_at,NEW.ended_reason) IS DISTINCT FROM ROW(OLD.ended_by,OLD.ended_at,OLD.ended_reason) THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='Ended' THEN
  IF api AND NEW.ended_by IS DISTINCT FROM me THEN RAISE EXCEPTION 'Ending is recorded under your own name.' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.verified_by,NEW.verified_at,NEW.verification_note,NEW.sole_partner_verify) IS DISTINCT FROM ROW(OLD.verified_by,OLD.verified_at,OLD.verification_note,OLD.sole_partner_verify) THEN RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER service_eligibility_guard BEFORE INSERT OR UPDATE ON erp_private.service_eligibility_records FOR EACH ROW EXECUTE FUNCTION erp_private.service_eligibility_guard();

-- The kinds a service still lacks for a given practitioner on a given day (Nairobi). Empty means it can be activated.
CREATE FUNCTION erp_private.eligibility_gaps(p_service text,p_owner uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(array_agg(r.kind ORDER BY r.kind),ARRAY[]::text[]) FROM erp_private.service_eligibility_requirements r
 WHERE r.service_code=p_service AND NOT EXISTS(
  SELECT 1 FROM erp_private.service_eligibility_records e
  WHERE e.service_code=r.service_code AND e.kind=r.kind AND e.status='Verified'
   AND e.valid_from<=(now() AT TIME ZONE 'Africa/Nairobi')::date AND e.expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date
   AND (e.staff_id IS NULL OR e.staff_id=p_owner));
$$;
CREATE FUNCTION erp_private.project_eligibility_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE gaps text[];
BEGIN
 IF NEW.status='Active' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'Active') THEN
  gaps:=erp_private.eligibility_gaps(NEW.service_code,NEW.owner_staff_id);
  IF array_length(gaps,1)>0 THEN RAISE EXCEPTION 'This service cannot be active yet. Missing, unverified or expired: %.',array_to_string(gaps,', ') USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_eligibility_guard BEFORE INSERT OR UPDATE OF status ON erp_private.projects FOR EACH ROW EXECUTE FUNCTION erp_private.project_eligibility_guard();
REVOKE ALL ON FUNCTION erp_private.service_eligibility_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.project_eligibility_guard() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION erp_private.eligibility_gaps(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION erp_private.eligibility_gaps(text,uuid) TO erp_api;
