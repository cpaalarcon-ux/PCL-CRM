-- KYC evidence records: the person recording a new record must be the actor,
-- but any authorised Manager or Partner may withdraw a record (soft delete).
-- The withdrawal itself is logged by change_audit and creates a KYC change
-- version when the file was already verified.
DROP POLICY IF EXISTS kyc_evidence_scope ON erp_private.client_kyc_evidence;
CREATE POLICY kyc_evidence_read ON erp_private.client_kyc_evidence FOR SELECT TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id));
CREATE POLICY kyc_evidence_insert ON erp_private.client_kyc_evidence FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY kyc_evidence_withdraw ON erp_private.client_kyc_evidence FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND deleted_at IS NULL)
 WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

-- Evidence content is immutable once recorded; only withdrawal is allowed.
CREATE OR REPLACE FUNCTION erp_private.kyc_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (NEW.client_id,NEW.document_type,NEW.evidence_form,NEW.covered_items,NEW.document_id,NEW.document_reference,NEW.evidence_date,NEW.expires_on,NEW.physical_location,NEW.copy_type,NEW.sighted_by,NEW.sighted_at,NEW.online_source,NEW.online_reference,NEW.checked_by,NEW.checked_at,NEW.recorded_by)
    IS DISTINCT FROM
    (OLD.client_id,OLD.document_type,OLD.evidence_form,OLD.covered_items,OLD.document_id,OLD.document_reference,OLD.evidence_date,OLD.expires_on,OLD.physical_location,OLD.copy_type,OLD.sighted_by,OLD.sighted_at,OLD.online_source,OLD.online_reference,OLD.checked_by,OLD.checked_at,OLD.recorded_by) THEN
  RAISE EXCEPTION 'KYC evidence is immutable; withdraw it and record a replacement' USING ERRCODE='23514';
 END IF;
 IF OLD.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'A withdrawn KYC evidence record cannot change' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION erp_private.kyc_evidence_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.kyc_evidence_guard() TO erp_api;
CREATE TRIGGER kyc_evidence_guard BEFORE UPDATE ON erp_private.client_kyc_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.kyc_evidence_guard();
