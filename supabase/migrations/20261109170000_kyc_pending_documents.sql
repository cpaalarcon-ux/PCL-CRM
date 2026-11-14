-- KYC files proposed by Assistants and Supervisors.
--  * An Assistant or Supervisor uploads the file into the category "KYC Pending". Only Managers and Partners can see or download it;
--    the uploader cannot read it back and cannot attach it to anything.
--  * The file becomes part of the Permanent File only when a Manager or Partner approves the proposal that carries it
--    (the approver's own account records the evidence). Until then it is not evidence.
ALTER TABLE erp_private.documents DROP CONSTRAINT documents_category_check;
ALTER TABLE erp_private.documents ADD CONSTRAINT documents_category_check CHECK(category IN ('Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports','Import Sources','KYC Pending'));

CREATE OR REPLACE FUNCTION erp_private.document_allowed(c uuid,f uuid,p uuid,t uuid,cat text,writing boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT erp_private.firm_allowed(f) AND (
 (erp_private.is_leader() AND erp_private.client_allowed(c)) OR
 ((erp_private.actor()).category_code='SUPERVISOR' AND erp_private.project_allowed(p)
 AND cat IN ('Current Year Audit','Tax Returns','Working Papers','PBC Documents','Import Sources')) OR
 ((erp_private.actor()).category_code IN ('ASSISTANT','INTERN') AND (cat='Working Papers' OR cat='Import Sources' AND (erp_private.actor()).category_code='ASSISTANT')
 AND (NOT writing OR (erp_private.actor()).category_code='ASSISTANT')
 AND EXISTS(SELECT 1 FROM erp_private.tasks x WHERE x.task_id=t AND x.assigned_to=(erp_private.actor()).staff_id AND erp_private.task_allowed(t))) OR
 (writing AND cat='KYC Pending' AND p IS NULL AND t IS NULL AND (erp_private.actor()).category_code IN ('ASSISTANT','SUPERVISOR') AND erp_private.client_allowed(c)))
$$;

-- What the proposer may learn about their own pending file: its name, and only if it is theirs, for this client.
CREATE OR REPLACE FUNCTION erp_private.kyc_pending_file(p_doc uuid,p_client uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT d.file_name FROM erp_private.documents d WHERE d.document_id=p_doc AND d.client_id=p_client AND d.category='KYC Pending'
  AND d.deleted_at IS NULL AND d.uploaded_by=(erp_private.actor()).staff_id
$$;
REVOKE EXECUTE ON FUNCTION erp_private.kyc_pending_file(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.kyc_pending_file(uuid,uuid) TO erp_api;

-- Approval: a Manager or Partner who is not the uploader moves the file into the Permanent File.
CREATE OR REPLACE FUNCTION erp_private.kyc_promote_document(p_doc uuid,p_client uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE d record;
BEGIN
 IF NOT erp_private.is_leader() THEN RAISE EXCEPTION 'Only a Manager or Partner can accept a proposed KYC file' USING ERRCODE='42501'; END IF;
 IF NOT erp_private.client_allowed(p_client) THEN RAISE EXCEPTION 'That client is not available to you' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM erp_private.documents WHERE document_id=p_doc AND client_id=p_client AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR d.category<>'KYC Pending' THEN RAISE EXCEPTION 'That proposed KYC file is not available' USING ERRCODE='22023'; END IF;
 IF d.uploaded_by=(erp_private.actor()).staff_id THEN RAISE EXCEPTION 'You uploaded this file, so another Manager or Partner must approve it' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.documents SET category='Permanent File' WHERE document_id=p_doc;
END $$;
REVOKE EXECUTE ON FUNCTION erp_private.kyc_promote_document(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.kyc_promote_document(uuid,uuid) TO erp_api;
