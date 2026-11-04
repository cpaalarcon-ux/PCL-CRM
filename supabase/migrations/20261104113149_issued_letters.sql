-- Issued letters (4 Nov 2026 UAT): the named signatory or an Engagement Partner issues a letter.
-- The ERP then produces the letterhead PDF with the letter-details QR, records who issued it, when,
-- and the SHA-256 of the PDF, and locks the letter's content. A change needs a new letter.
ALTER TABLE erp_private.communications
 ADD COLUMN IF NOT EXISTS issued_at timestamptz,
 ADD COLUMN IF NOT EXISTS issued_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN IF NOT EXISTS issued_sha256 text CHECK(issued_sha256 IS NULL OR issued_sha256 ~ '^[0-9a-f]{64}$'),
 ADD CONSTRAINT communications_issue_complete CHECK((issued_at IS NULL)=(issued_by IS NULL) AND (issued_at IS NULL)=(issued_sha256 IS NULL)),
 ADD CONSTRAINT communications_issue_letters_only CHECK(issued_at IS NULL OR channel='Letter');
CREATE INDEX IF NOT EXISTS communications_issued_by_idx ON erp_private.communications(issued_by) WHERE issued_by IS NOT NULL;

CREATE OR REPLACE FUNCTION erp_private.issued_letter_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.issued_at IS NOT NULL THEN
  IF (NEW.reference,NEW.client_id,NEW.firm_id,NEW.project_id,NEW.contact_id,NEW.channel,NEW.subject,NEW.purpose,NEW.details,NEW.communication_date,NEW.signatory_id,NEW.issued_at,NEW.issued_by,NEW.issued_sha256,NEW.deleted_at)
     IS DISTINCT FROM (OLD.reference,OLD.client_id,OLD.firm_id,OLD.project_id,OLD.contact_id,OLD.channel,OLD.subject,OLD.purpose,OLD.details,OLD.communication_date,OLD.signatory_id,OLD.issued_at,OLD.issued_by,OLD.issued_sha256,OLD.deleted_at) THEN
   RAISE EXCEPTION 'This letter has been issued and is locked. Record a new letter for any change.' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.issued_letter_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.issued_letter_guard() TO erp_api;
CREATE TRIGGER issued_letter_guard BEFORE UPDATE ON erp_private.communications FOR EACH ROW EXECUTE FUNCTION erp_private.issued_letter_guard();

-- Anyone who may see a letter must be able to print its signatory's name and role, although staff rows are
-- otherwise limited to oneself and one's reports. Only those two fields, only for the signatory of a visible letter.
CREATE OR REPLACE FUNCTION erp_private.letter_signatory(p_communication_id uuid) RETURNS TABLE(full_name text,category_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT s.full_name,s.category_code FROM erp_private.communications c JOIN erp_private.staff_members s ON s.staff_id=c.signatory_id
 WHERE c.communication_id=p_communication_id AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id) AND erp_private.firm_allowed(c.firm_id);
$$;
REVOKE ALL ON FUNCTION erp_private.letter_signatory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.letter_signatory(uuid) TO erp_api;
