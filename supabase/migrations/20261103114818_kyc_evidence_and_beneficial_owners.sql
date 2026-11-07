-- Structured KYC evidence, full beneficial-owner records and dated
-- post-activation change review. No beneficial-ownership threshold is
-- hard-coded here; that rule remains a Compliance Lead decision.

CREATE TABLE erp_private.kyc_evidence_rules (
 rule_code text PRIMARY KEY,
 label text NOT NULL,
 accepted_forms text[] NOT NULL DEFAULT ARRAY['upload','physical','online']::text[],
 renewal_days integer,
 required_for_entities text[] NOT NULL DEFAULT ARRAY['Company']::text[],
 rule_status text NOT NULL DEFAULT 'Testing' CHECK(rule_status IN('Testing','Approved','Retired')),
 rule_source text,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(renewal_days IS NULL OR renewal_days BETWEEN 1 AND 3650),
 CHECK(cardinality(accepted_forms)>0),
 CHECK(rule_status<>'Approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

INSERT INTO erp_private.kyc_evidence_rules(rule_code,label,accepted_forms,renewal_days,required_for_entities,rule_source)
VALUES
 ('REGISTRATION_IDENTITY','Registration / identity',ARRAY['upload','physical','online'],NULL,ARRAY['Company','Partnership','Sole proprietor','Other'],'Form and renewal interval require Compliance Lead confirmation.'),
 ('KRA_PIN','KRA PIN',ARRAY['upload','physical','online'],NULL,ARRAY['Company','Partnership','Sole proprietor','Other'],'Form and renewal interval require Compliance Lead confirmation.'),
 ('DIRECTORS_CR12','Directors / CR12',ARRAY['upload','physical','online'],NULL,ARRAY['Company'],'Form and renewal interval require Compliance Lead confirmation.'),
 ('REGISTER_MEMBERS','Register of members',ARRAY['upload','physical','online'],NULL,ARRAY['Company'],'Form and renewal interval require Compliance Lead confirmation.'),
 ('BENEFICIAL_OWNERSHIP','Beneficial ownership',ARRAY['upload','physical','online'],NULL,ARRAY['Company'],'Beneficial-owner qualification threshold and evidence rule require Compliance Lead confirmation.')
ON CONFLICT(rule_code) DO NOTHING;

CREATE TABLE erp_private.client_kyc_evidence (
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 document_type text NOT NULL REFERENCES erp_private.kyc_evidence_rules(rule_code),
 evidence_form text NOT NULL CHECK(evidence_form IN('upload','physical','online')),
 covered_items text[] NOT NULL CHECK(cardinality(covered_items)>0),
 document_id uuid REFERENCES erp_private.documents,
 document_reference text,
 evidence_date date NOT NULL,
 expires_on date,
 physical_location text,
 copy_type text CHECK(copy_type IN('Original','Certified copy')),
 sighted_by uuid REFERENCES erp_private.staff_members,
 sighted_at date,
 online_source text,
 online_reference text,
 checked_by uuid REFERENCES erp_private.staff_members,
 checked_at date,
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 deleted_at timestamptz,
 CHECK(expires_on IS NULL OR expires_on>=evidence_date),
 CHECK((evidence_form='upload' AND document_id IS NOT NULL) OR evidence_form<>'upload'),
 CHECK((evidence_form='physical' AND nullif(btrim(document_reference),'') IS NOT NULL AND nullif(btrim(physical_location),'') IS NOT NULL AND copy_type IS NOT NULL AND sighted_by IS NOT NULL AND sighted_at IS NOT NULL) OR evidence_form<>'physical'),
 CHECK((evidence_form='online' AND nullif(btrim(online_source),'') IS NOT NULL AND nullif(btrim(online_reference),'') IS NOT NULL AND checked_by IS NOT NULL AND checked_at IS NOT NULL) OR evidence_form<>'online')
);
CREATE INDEX client_kyc_evidence_client_idx ON erp_private.client_kyc_evidence(client_id,deleted_at,document_type);
CREATE UNIQUE INDEX client_kyc_physical_reference_unique ON erp_private.client_kyc_evidence(client_id,document_type,lower(btrim(document_reference)))
 WHERE evidence_form='physical' AND deleted_at IS NULL;

ALTER TABLE erp_private.beneficial_owners
 ADD COLUMN identity_type text,
 ADD COLUMN nationality text,
 ADD COLUMN holding_type text CHECK(holding_type IN('Direct','Indirect')),
 ADD COLUMN effective_from date,
 ADD COLUMN pep_status text CHECK(pep_status IN('Yes','No','To confirm')),
 ADD COLUMN screening_date date,
 ADD COLUMN screening_result text,
 ADD COLUMN supporting_document_id uuid REFERENCES erp_private.documents,
 ADD COLUMN created_by uuid REFERENCES erp_private.staff_members,
 ADD COLUMN updated_by uuid REFERENCES erp_private.staff_members;
ALTER TABLE erp_private.client_compliance
 ADD COLUMN last_edited_by uuid REFERENCES erp_private.staff_members;

CREATE TABLE erp_private.client_kyc_change_versions (
 version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 version_number integer NOT NULL CHECK(version_number>0),
 before_snapshot jsonb NOT NULL,
 proposed_snapshot jsonb NOT NULL,
 changed_items text[] NOT NULL CHECK(cardinality(changed_items)>0),
 change_reason text NOT NULL CHECK(length(btrim(change_reason))>=3),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'Pending review' CHECK(status IN('Pending review','Approved','Returned')),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(client_id,version_number),
 CHECK(status<>'Approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX client_kyc_change_pending_idx ON erp_private.client_kyc_change_versions(client_id,status,recorded_at DESC);

-- Preserve existing file links as upload-form evidence so legacy KYC records
-- remain visible in the new evidence-first screen.
INSERT INTO erp_private.client_kyc_evidence(client_id,document_type,evidence_form,covered_items,document_id,document_reference,evidence_date,recorded_by)
SELECT c.client_id,x.rule_code,'upload',ARRAY[x.rule_code],x.document_id,d.file_name,d.uploaded_at::date,d.uploaded_by
FROM erp_private.client_compliance c
CROSS JOIN LATERAL (VALUES
 ('REGISTRATION_IDENTITY',c.incorporation_document),
 ('KRA_PIN',c.pin_document),
 ('DIRECTORS_CR12',c.directors_document),
 ('REGISTER_MEMBERS',c.members_document),
 ('BENEFICIAL_OWNERSHIP',c.bo_document)
) AS x(rule_code,document_id)
JOIN erp_private.documents d ON d.document_id=x.document_id AND d.client_id=c.client_id AND d.category='Permanent File'
WHERE x.document_id IS NOT NULL;
UPDATE erp_private.beneficial_owners SET created_by=coalesce(created_by,updated_by),updated_by=coalesce(updated_by,created_by);

DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT * FROM (VALUES ('kyc_evidence_rules','rule_code'),('client_kyc_evidence','evidence_id'),('client_kyc_change_versions','version_id')) AS x(tbl,key) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
  EXECUTE format('CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON erp_private.%I TO erp_api',r.tbl);
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);
 END LOOP;
END $$;

CREATE POLICY kyc_rules_read ON erp_private.kyc_evidence_rules FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY kyc_rules_write ON erp_private.kyc_evidence_rules FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());
CREATE POLICY kyc_evidence_scope ON erp_private.client_kyc_evidence FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id) AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY kyc_versions_scope ON erp_private.client_kyc_change_versions FOR ALL TO erp_api USING(erp_private.is_leader() AND erp_private.client_allowed(client_id)) WITH CHECK(erp_private.is_leader() AND erp_private.client_allowed(client_id));

INSERT INTO erp_private.release_checks(check_code,title,owner_position)
VALUES
 ('KYCRULES','KYC document forms and renewal intervals approved by the Compliance Lead','Compliance Lead'),
 ('KYCBO','Beneficial-owner qualification threshold confirmed against current Kenyan requirements','Compliance Lead')
ON CONFLICT(check_code) DO NOTHING;

-- Keep the database-level activation guard aligned with the KYC package:
-- verified client evidence, a current screening and an independent review are
-- required before an engagement can become Active.
CREATE OR REPLACE FUNCTION erp_private.project_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c erp_private.client_compliance;e erp_private.engagement_controls; owner_count integer; pending_count integer;
BEGIN
 IF TG_OP='UPDATE' AND (NEW.handling_firm_id<>OLD.handling_firm_id OR NEW.client_id<>OLD.client_id) THEN RAISE EXCEPTION 'A different firm or client requires a new engagement' USING ERRCODE='23514';END IF;
 -- Preserve the existing permission for assigned staff to edit an already
 -- active engagement without re-running activation checks on every edit.
 IF TG_OP='UPDATE' AND OLD.status='Active' AND NEW.status='Active' THEN
  IF NEW.service_code<>OLD.service_code THEN RAISE EXCEPTION 'An active engagement cannot change service; create another project' USING ERRCODE='23514';END IF;
  RETURN NEW;
 END IF;
 IF NEW.status='Active' THEN
  SELECT * INTO c FROM erp_private.client_compliance WHERE client_id=NEW.client_id;
  SELECT * INTO e FROM erp_private.engagement_controls WHERE project_id=NEW.project_id;
  SELECT count(*) INTO owner_count FROM erp_private.beneficial_owners WHERE client_id=NEW.client_id AND deleted_at IS NULL;
  SELECT count(*) INTO pending_count FROM erp_private.client_kyc_change_versions WHERE client_id=NEW.client_id AND status='Pending review';
  IF c.verified_by IS NULL OR c.review_due IS NULL OR c.review_due<current_date OR ((c.is_pep OR c.risk_rating='High') AND c.edd_approved_by IS NULL) OR e.signed_letter_id IS NULL OR e.letter_verified_by IS NULL OR (e.letter_expires_on IS NOT NULL AND e.letter_expires_on<current_date) OR pending_count>0 OR (c.entity_type='Company' AND owner_count<1) THEN
   RAISE EXCEPTION 'Verified current KYC, independent change review, beneficial owner evidence, enhanced review where required, and a verified signed engagement letter are required' USING ERRCODE='23514';
  END IF;
 END IF;RETURN NEW;
END; $$;

