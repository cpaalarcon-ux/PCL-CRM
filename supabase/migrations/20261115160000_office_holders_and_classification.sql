-- Build 2813: officers and signatories as separate, evidence-backed client facts, and Partner classification before tax or accounting defaults.
--  * An officer or signatory is recorded with the person, position, authority, the supporting paper (resolution, governing document, establishing instrument,
--    court grant or registration record) and where it can be found. A different Supervisor, Manager or Partner verifies it, and the date is kept.
--    A record is never edited: it is verified or ended with a reason. These are not Director, Shareholder or Trustee entries.
--  * The client-type templates say how many of each an entity must have. This replaces the one-line "officials" style facts of build 2812.
--  * An entity whose legal form needs a Partner's classification (the "other registered entity" fallback) gets no tax or accounting defaults until a Partner has verified it.
--  * A public entity records why its subtype (public institution, state corporation and so on) is supported by its establishing instrument.
--  * A chama's registration certificate stays "if applicable"; while it is unregistered, the resolution or minutes naming its officials and signatories are required.
CREATE TABLE erp_private.client_office_holders(
 holder_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('Officer','Signatory')),
 holder_name text NOT NULL CHECK(char_length(btrim(holder_name)) BETWEEN 2 AND 120),
 holder_position text NOT NULL CHECK(char_length(btrim(holder_position)) BETWEEN 2 AND 120),
 authority text NOT NULL CHECK(char_length(btrim(authority)) BETWEEN 5 AND 300),
 basis_kind text NOT NULL CHECK(basis_kind IN('Resolution','Governing document','Establishing instrument','Court grant','Registration record')),
 document_id uuid REFERENCES erp_private.documents ON DELETE RESTRICT,
 source_reference text CHECK(source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 3 AND 300),
 status text NOT NULL DEFAULT 'Recorded' CHECK(status IN('Recorded','Verified','Ended')),
 recorded_by uuid NOT NULL REFERENCES erp_private.staff_members,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 verified_by uuid REFERENCES erp_private.staff_members,
 verified_at timestamptz,
 verification_note text CHECK(verification_note IS NULL OR char_length(btrim(verification_note)) BETWEEN 3 AND 500),
 ended_by uuid REFERENCES erp_private.staff_members,
 ended_at timestamptz,
 ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(document_id IS NOT NULL OR source_reference IS NOT NULL),
 CHECK(verified_by IS NULL OR verified_by<>recorded_by),
 CHECK(verified_by IS NULL OR (verified_at IS NOT NULL AND verification_note IS NOT NULL)),
 CHECK(status<>'Verified' OR verified_by IS NOT NULL),
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND ended_reason IS NOT NULL))
);
CREATE UNIQUE INDEX client_office_holders_live_uidx ON erp_private.client_office_holders(client_id,kind,lower(btrim(holder_name)),lower(btrim(holder_position))) WHERE status<>'Ended';
CREATE INDEX client_office_holders_client_idx ON erp_private.client_office_holders(client_id,kind,status);
CREATE INDEX client_office_holders_document_idx ON erp_private.client_office_holders(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX client_office_holders_recorded_by_idx ON erp_private.client_office_holders(recorded_by);
CREATE INDEX client_office_holders_verified_by_idx ON erp_private.client_office_holders(verified_by) WHERE verified_by IS NOT NULL;
CREATE INDEX client_office_holders_ended_by_idx ON erp_private.client_office_holders(ended_by) WHERE ended_by IS NOT NULL;
ALTER TABLE erp_private.client_office_holders ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_office_holders FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.client_office_holders TO erp_api;
CREATE POLICY holders_read ON erp_private.client_office_holders FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY holders_insert ON erp_private.client_office_holders FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND recorded_by=(erp_private.actor()).staff_id);
CREATE POLICY holders_update ON erp_private.client_office_holders FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_office_holders FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_office_holders FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('holder_id');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_office_holders FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE FUNCTION erp_private.client_office_holders_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE who erp_private.staff_members;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'Recorded' THEN RAISE EXCEPTION 'A record is made first and verified separately.' USING ERRCODE='23514'; END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=NEW.document_id AND d.client_id=NEW.client_id) THEN
   RAISE EXCEPTION 'The document does not belong to this client.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.client_id,NEW.kind,NEW.holder_name,NEW.holder_position,NEW.authority,NEW.basis_kind,NEW.document_id,NEW.source_reference,NEW.recorded_by,NEW.recorded_at)
    IS DISTINCT FROM ROW(OLD.client_id,OLD.kind,OLD.holder_name,OLD.holder_position,OLD.authority,OLD.basis_kind,OLD.document_id,OLD.source_reference,OLD.recorded_by,OLD.recorded_at) THEN
  RAISE EXCEPTION 'A recorded officer or signatory is never edited. End it with a reason and record the new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Ended' THEN RAISE EXCEPTION 'An ended record stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status='Verified' AND OLD.status='Recorded' THEN
  IF current_user='erp_api' THEN
   SELECT * INTO who FROM erp_private.staff_members WHERE staff_id=(erp_private.actor()).staff_id;
   IF who.category_code NOT IN('PARTNER','MANAGER','SUPERVISOR') THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner verifies an officer or signatory.' USING ERRCODE='23514'; END IF;
   IF NEW.verified_by IS DISTINCT FROM who.staff_id THEN RAISE EXCEPTION 'Verification is recorded under your own name.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF NEW.status='Ended' THEN
  IF current_user='erp_api' AND NEW.ended_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The change is recorded under your own name.' USING ERRCODE='23514'; END IF;
 ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.verified_by IS DISTINCT FROM OLD.verified_by OR NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
  RAISE EXCEPTION 'That change is not allowed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_office_holders_guard BEFORE INSERT OR UPDATE ON erp_private.client_office_holders FOR EACH ROW EXECUTE FUNCTION erp_private.client_office_holders_guard();

-- How many officers and signatories each client type asks for, and what supports them.
CREATE TABLE erp_private.client_template_holders(
 template_code text NOT NULL REFERENCES erp_private.client_type_templates,
 kind text NOT NULL CHECK(kind IN('Officer','Signatory')),
 min_count integer NOT NULL DEFAULT 1 CHECK(min_count>=1),
 requirement text NOT NULL CHECK(requirement IN('Required','If applicable')),
 label text NOT NULL,
 basis_hint text NOT NULL DEFAULT '',
 PRIMARY KEY(template_code,kind)
);
ALTER TABLE erp_private.client_template_holders ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_template_holders FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.client_template_holders TO erp_api;
CREATE POLICY cth_read ON erp_private.client_template_holders FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_template_holders FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
INSERT INTO erp_private.client_template_holders(template_code,kind,min_count,requirement,label,basis_hint) VALUES
 ('PUBLIC_SECTOR','Officer',1,'Required','Accounting officer or head of the entity','Establishing instrument, gazette notice or appointment letter'),
 ('PUBLIC_SECTOR','Signatory',1,'Required','Authorised signatories','Board or council resolution, or the governing document'),
 ('ASSOCIATION','Officer',1,'Required','Officials (chairperson, secretary, treasurer)','Constitution, or the minutes that elected them'),
 ('ASSOCIATION','Signatory',1,'Required','Authorised signatories','Resolution or minutes authorising them to sign and operate the account'),
 ('ESTATE','Officer',1,'Required','Executor or administrator','Grant of probate, letters of administration or court order'),
 ('OTHER_REGISTERED','Officer',1,'Required','Responsible officers','Registration record, governing document or resolution'),
 ('OTHER_REGISTERED','Signatory',1,'If applicable','Authorised signatories','Resolution or governing document');

-- The one-line facts of build 2812 for officers and signatories are replaced by the records above. Rows are never deleted, so they are retired.
ALTER TABLE erp_private.client_template_fields ADD COLUMN retired boolean NOT NULL DEFAULT false;
UPDATE erp_private.client_template_fields SET retired=true WHERE (template_code,field_key) IN(
 ('PUBLIC_SECTOR','accounting_officer'),('PUBLIC_SECTOR','authorised_signatories'),('ASSOCIATION','officials'),('ASSOCIATION','authorised_signatories'),('ESTATE','executor_name'),('OTHER_REGISTERED','responsible_officers'));
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order) VALUES('PUBLIC_SECTOR','subtype_basis','Required',32);
UPDATE erp_private.client_type_templates SET controls='The subtype, the establishing instrument and the provision that supports the subtype, the mandate, the accounting officer and the authorised signatories. A statutory body is recorded as a public institution or state corporation when its establishing documents support it; if neither fits, use "Other registered entity" and a Partner classifies it'
 WHERE template_code='PUBLIC_SECTOR';
UPDATE erp_private.client_type_templates SET controls='The constitution, officials and signatories (each with the resolution or document that supports them), and registration status. While the group is unregistered, the resolution or minutes naming its officials and signatories are required. A group whose documents show a registered society, co-operative or company uses that legal form''s template instead'
 WHERE template_code='ASSOCIATION';
UPDATE erp_private.client_type_templates SET controls='The deceased person, the executor or administrator (supported by the grant or court order), and the grant details' WHERE template_code='ESTATE';
UPDATE erp_private.client_type_templates SET controls='The specific legal form, the registration authority and evidence, and the responsible officers. A Partner classifies the entity if its form cannot be identified, and no tax or accounting defaults are applied before that' WHERE template_code='OTHER_REGISTERED';
INSERT INTO erp_private.legal_structure_requirements(structure,subtype,rule_code,requirement,note,sort_order)
VALUES('Other','Chama or Investment Group','BOARD_RESOLUTION','If applicable','Resolution or minutes naming the officials and signatories. Required while the group is unregistered',250);

-- Which legal-form facts a Partner has verified. The staff register shows a person only to their seniors, so these read it as the database owner and answer only
-- for a client the caller may see, and only with the field names, never with who verified them.
CREATE FUNCTION erp_private.client_partner_verified_fields(p_client uuid) RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(array_agg(DISTINCT f.field_key),ARRAY[]::text[]) FROM erp_private.client_field_facts f JOIN erp_private.staff_members s ON s.staff_id=f.verified_by
 WHERE f.client_id=p_client AND f.status='Verified' AND s.category_code='PARTNER' AND erp_private.client_allowed(p_client)
$$;
REVOKE ALL ON FUNCTION erp_private.client_partner_verified_fields(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_partner_verified_fields(uuid) TO erp_api;

-- True when the client's legal form still waits for a Partner: its template needs a Partner to classify it and no Partner has verified the legal form.
CREATE FUNCTION erp_private.client_classification_pending(p_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((
  SELECT bool_or(NOT (tf.field_key = ANY(erp_private.client_partner_verified_fields(c.client_id))))
  FROM erp_private.clients c
  JOIN LATERAL(SELECT m.template_code FROM erp_private.client_type_template_map m WHERE m.structure=c.legal_structure AND (m.subtype=c.legal_subtype OR m.subtype='*') ORDER BY (m.subtype='*') LIMIT 1) pick ON true
  JOIN erp_private.client_type_templates t ON t.template_code=pick.template_code AND t.partner_classifies
  JOIN erp_private.client_template_fields tf ON tf.template_code=t.template_code AND tf.partner_verified AND NOT tf.retired
  WHERE c.client_id=p_client AND c.deleted_at IS NULL AND erp_private.client_allowed(c.client_id)),false)
$$;
REVOKE ALL ON FUNCTION erp_private.client_classification_pending(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_classification_pending(uuid) TO erp_api;
