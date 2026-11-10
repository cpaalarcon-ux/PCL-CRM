-- Per-document review state, expiring access grants and the evidence-scan stub (build 2026-11-10.2740), step 5 of the Partner's build order of 10 Nov 2026 17:46.
-- 1. A document is reviewed by a named reviewer (Supervisor, Manager or Partner) who is NOT the person who uploaded it, with a written comment, against the exact file
--    (its SHA-256 is recorded). A new file version has a different hash, so it starts as "not reviewed" again. Reviews are append-only history.
-- 2. A Manager or Partner can give one named colleague time-limited access to one document (at most 30 days, written reason, revocable). The grant widens nothing else:
--    it does not give access to the client, project or other documents, and it never opens a Restricted file to someone who may not see it.
-- 3. Malware scanning cannot be built in-house. The scan request is recorded and answered PENDING_MANUAL_REVIEW with no provider; a third-party service
--    (for example VirusTotal or AWS GuardDuty) is connected later. Nothing is blocked on the scan result yet.

CREATE TABLE erp_private.document_reviews(
 review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 reviewed_sha256 text NOT NULL CHECK(reviewed_sha256 ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN('APPROVED','CHANGES_REQUESTED','REJECTED')),
 comment text NOT NULL CHECK(char_length(btrim(comment))>=10 AND char_length(comment)<=2000),
 reviewer_id uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_reviews_doc_idx ON erp_private.document_reviews(document_id,reviewed_at DESC);

CREATE TABLE erp_private.document_access_grants(
 grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 grantee_id uuid NOT NULL REFERENCES erp_private.staff_members,
 granted_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reason text NOT NULL CHECK(char_length(btrim(reason))>=10 AND char_length(reason)<=2000),
 granted_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 revoked_by uuid REFERENCES erp_private.staff_members,
 revoke_reason text CHECK(revoke_reason IS NULL OR char_length(btrim(revoke_reason))>=10),
 CHECK(granted_by<>grantee_id),
 CHECK(expires_at>granted_at AND expires_at<=granted_at+interval '30 days'),
 CHECK((revoked_at IS NULL AND revoked_by IS NULL AND revoke_reason IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE INDEX document_grants_grantee_idx ON erp_private.document_access_grants(grantee_id,expires_at);
CREATE INDEX document_grants_doc_idx ON erp_private.document_access_grants(document_id);
CREATE UNIQUE INDEX document_grants_one_live ON erp_private.document_access_grants(document_id,grantee_id) WHERE revoked_at IS NULL;

CREATE TABLE erp_private.document_scan_results(
 scan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL CHECK(status='PENDING_MANUAL_REVIEW'),
 provider text CHECK(provider IS NULL),
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_scan_doc_idx ON erp_private.document_scan_results(document_id,requested_at DESC);

-- Is the signed-in person holding a live grant on this document?
CREATE FUNCTION erp_private.document_granted(p_document uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.document_access_grants g
  WHERE g.document_id=p_document AND g.grantee_id=(erp_private.actor()).staff_id AND g.revoked_at IS NULL AND g.expires_at>now()
   AND (erp_private.actor()).category_code IN('MANAGER','SUPERVISOR','ASSISTANT'))
$$;

CREATE FUNCTION erp_private.document_review_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d erp_private.documents; a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL THEN RAISE EXCEPTION 'Sign in to review a document.' USING ERRCODE='23514'; END IF;
 IF a.category_code NOT IN('SUPERVISOR','MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Supervisor, Manager or Partner reviews a document.' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.document_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'That document is unavailable.' USING ERRCODE='23514'; END IF;
 IF d.uploaded_by=a.staff_id THEN RAISE EXCEPTION 'The person who uploaded a document cannot review it. Ask a colleague.' USING ERRCODE='23514'; END IF;
 IF d.archived_at IS NOT NULL THEN RAISE EXCEPTION 'An archived document is not reviewed.' USING ERRCODE='23514'; END IF;
 NEW.reviewer_id:=a.staff_id; NEW.reviewed_sha256:=d.sha256; NEW.reviewed_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER document_review_guard BEFORE INSERT ON erp_private.document_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.document_review_guard();
CREATE TRIGGER document_review_immutable BEFORE UPDATE OR DELETE ON erp_private.document_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

CREATE FUNCTION erp_private.document_grant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d erp_private.documents; a erp_private.staff_members; g erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can give access to a document.' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.document_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That document is unavailable.' USING ERRCODE='23514'; END IF;
  IF NEW.grantee_id=a.staff_id THEN RAISE EXCEPTION 'You cannot give access to yourself.' USING ERRCODE='23514'; END IF;
  SELECT * INTO g FROM erp_private.staff_members WHERE staff_id=NEW.grantee_id AND deleted_at IS NULL AND access_status='Active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose an active member of staff.' USING ERRCODE='23514'; END IF;
  IF g.category_code NOT IN('MANAGER','SUPERVISOR','ASSISTANT') THEN RAISE EXCEPTION 'Access to a single document can be given to a Manager, Supervisor or Assistant.' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.staff_firm_access x JOIN erp_private.firms f ON f.firm_id=x.firm_id WHERE x.staff_id=g.staff_id AND x.firm_id=d.handling_firm_id AND x.deleted_at IS NULL AND f.deleted_at IS NULL AND f.is_active)
   THEN RAISE EXCEPTION 'That person does not work for the firm that holds this document. Give them firm access first.' USING ERRCODE='23514'; END IF;
  NEW.granted_by:=a.staff_id; NEW.granted_at:=now();
  IF NEW.expires_at IS NULL OR NEW.expires_at<=now() OR NEW.expires_at>now()+interval '30 days' THEN RAISE EXCEPTION 'Access must end within 30 days from today.' USING ERRCODE='23514'; END IF;
  NEW.revoked_at:=NULL; NEW.revoked_by:=NULL; NEW.revoke_reason:=NULL;
  RETURN NEW;
 END IF;
 -- UPDATE: the only change allowed is to withdraw the access once.
 IF OLD.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'This access was already withdrawn.' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.grant_id,NEW.document_id,NEW.grantee_id,NEW.granted_by,NEW.reason,NEW.granted_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.grant_id,OLD.document_id,OLD.grantee_id,OLD.granted_by,OLD.reason,OLD.granted_at,OLD.expires_at)
  THEN RAISE EXCEPTION 'A document access grant cannot be edited. Withdraw it and give a new one.' USING ERRCODE='23514'; END IF;
 NEW.revoked_at:=now(); NEW.revoked_by:=a.staff_id;
 RETURN NEW;
END $$;
CREATE TRIGGER document_grant_guard BEFORE INSERT OR UPDATE ON erp_private.document_access_grants FOR EACH ROW EXECUTE FUNCTION erp_private.document_grant_guard();
CREATE TRIGGER document_grant_no_delete BEFORE DELETE ON erp_private.document_access_grants FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

CREATE FUNCTION erp_private.document_scan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d erp_private.documents; a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code IN('ADMIN','INTERN') THEN RAISE EXCEPTION 'Your role cannot request a document scan.' USING ERRCODE='23514'; END IF;
 IF NEW.status IS DISTINCT FROM 'PENDING_MANUAL_REVIEW' OR NEW.provider IS NOT NULL THEN RAISE EXCEPTION 'No scan provider is connected yet. A scan request can only be recorded as pending manual review.' USING ERRCODE='23514'; END IF;
 SELECT * INTO d FROM erp_private.documents WHERE document_id=NEW.document_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'That document is unavailable.' USING ERRCODE='23514'; END IF;
 NEW.sha256:=d.sha256; NEW.requested_by:=a.staff_id; NEW.requested_at:=now(); NEW.status:='PENDING_MANUAL_REVIEW'; NEW.provider:=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER document_scan_guard BEFORE INSERT ON erp_private.document_scan_results FOR EACH ROW EXECUTE FUNCTION erp_private.document_scan_guard();
CREATE TRIGGER document_scan_immutable BEFORE UPDATE OR DELETE ON erp_private.document_scan_results FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();

-- Row security. The visibility check on the document itself (a subselect on erp_private.documents) uses the document's own row policy.
ALTER TABLE erp_private.document_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.document_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.document_access_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.document_access_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.document_scan_results ENABLE ROW LEVEL SECURITY; ALTER TABLE erp_private.document_scan_results FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON erp_private.document_reviews,erp_private.document_scan_results TO erp_api;
GRANT SELECT,INSERT,UPDATE ON erp_private.document_access_grants TO erp_api;
CREATE POLICY document_reviews_read ON erp_private.document_reviews FOR SELECT TO erp_api USING((erp_private.actor()).category_code<>'INTERN' AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_reviews.document_id));
CREATE POLICY document_reviews_insert ON erp_private.document_reviews FOR INSERT TO erp_api WITH CHECK(reviewer_id=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_reviews.document_id));
CREATE POLICY document_scan_read ON erp_private.document_scan_results FOR SELECT TO erp_api USING((erp_private.actor()).category_code<>'INTERN' AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_scan_results.document_id));
CREATE POLICY document_scan_insert ON erp_private.document_scan_results FOR INSERT TO erp_api WITH CHECK(requested_by=(erp_private.actor()).staff_id AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_scan_results.document_id));
-- Leaders see all grants on documents they can see; the person who holds a grant sees their own.
CREATE POLICY document_grants_read ON erp_private.document_access_grants FOR SELECT TO erp_api USING(grantee_id=(erp_private.actor()).staff_id OR ((erp_private.actor()).category_code IN('MANAGER','PARTNER') AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_access_grants.document_id)));
CREATE POLICY document_grants_insert ON erp_private.document_access_grants FOR INSERT TO erp_api WITH CHECK(granted_by=(erp_private.actor()).staff_id AND (erp_private.actor()).category_code IN('MANAGER','PARTNER') AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_access_grants.document_id));
CREATE POLICY document_grants_update ON erp_private.document_access_grants FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('MANAGER','PARTNER') AND EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=document_access_grants.document_id)) WITH CHECK((erp_private.actor()).category_code IN('MANAGER','PARTNER'));

-- A live grant opens that one document, still subject to the Restricted rule. Everything else about the policy is unchanged.
ALTER POLICY documents_read ON erp_private.documents USING(deleted_at IS NULL
 AND (erp_private.document_allowed(client_id,handling_firm_id,project_id,task_id,category,false) OR (erp_private.document_granted(document_id) AND erp_private.firm_allowed(handling_firm_id)))
 AND (confidentiality='Normal' OR erp_private.incoming_restricted_ok()));

CREATE TRIGGER document_reviews_audit AFTER INSERT ON erp_private.document_reviews FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('review_id');
CREATE TRIGGER document_grants_audit AFTER INSERT OR UPDATE ON erp_private.document_access_grants FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('grant_id');
CREATE TRIGGER document_scan_audit AFTER INSERT ON erp_private.document_scan_results FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('scan_id');

-- Alert Partners when a grant is given, so access is never silent.
CREATE FUNCTION erp_private.document_grant_alert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE n text;
BEGIN
 SELECT d.file_name INTO n FROM erp_private.documents d WHERE d.document_id=NEW.document_id;
 PERFORM erp_private.alert_partners('document-grant:'||NEW.grant_id,'Time-limited access to "'||coalesce(n,'a document')||'" was given until '||to_char(NEW.expires_at,'DD Mon YYYY')||'.');
 RETURN NEW;
END $$;
CREATE TRIGGER document_grant_alert AFTER INSERT ON erp_private.document_access_grants FOR EACH ROW EXECUTE FUNCTION erp_private.document_grant_alert();

REVOKE ALL ON FUNCTION erp_private.document_granted(uuid),erp_private.document_review_guard(),erp_private.document_grant_guard(),erp_private.document_scan_guard(),erp_private.document_grant_alert() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.document_granted(uuid),erp_private.document_review_guard(),erp_private.document_grant_guard(),erp_private.document_scan_guard(),erp_private.document_grant_alert() TO erp_api;
