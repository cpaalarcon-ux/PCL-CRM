-- Build 2855: the MLRO-owned POCAMLA block.
-- The firm's MLRO (an additional right an Engagement Partner grants to a named Manager; Partners hold it by rank) owns the AML/CFT/CPF lists, the client risk
-- decision and the engagement gate. Staff collect the client's facts and refer the profile. Nothing here guesses a legal threshold or a screening list:
-- the lists are MLRO-maintained, every value says where it came from, and the starter values stay marked "Starter" until the MLRO confirms them.

-- 1. The MLRO right can be granted (to a Manager) and tested.
CREATE FUNCTION erp_private.is_mlro() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT erp_private.has_capability('MLRO') $$;
REVOKE ALL ON FUNCTION erp_private.is_mlro() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.is_mlro() TO erp_api;
DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.staff_right_grant(uuid,text,text,date)'::regprocedure);
 o:=$q$IF p_capability NOT IN('FINANCE','APPROVE_TAX_RULES') THEN$q$;n:=$q$IF p_capability NOT IN('FINANCE','APPROVE_TAX_RULES','MLRO') THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: patch 1 not applied'; END IF; d:=replace(d,o,n);
 d:=replace(d,'HR, MLRO and SYSTEM_ADMIN are reserved','HR and SYSTEM_ADMIN are reserved');
 d:=replace(d,'Only the FINANCE right (and the Tax Lead''''s APPROVE_TAX_RULES right) can be granted today.','Only the FINANCE right (and the Tax Lead and MLRO rights) can be granted today.');
 o:=$q$IF t.category_code='ADMIN' THEN$q$;
 n:=$q$IF p_capability='MLRO' AND t.category_code<>'MANAGER' THEN RAISE EXCEPTION 'The MLRO is appointed at management level. Choose a Manager (Engagement Partners already hold every right).' USING ERRCODE='23514'; END IF;
 IF t.category_code='ADMIN' THEN$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'staff_right_grant changed: patch 2 not applied'; END IF; d:=replace(d,o,n);
 EXECUTE d;
END $patch$;

CREATE FUNCTION erp_private.aml_mlro_holders() RETURNS TABLE(full_name text,expires_on date) LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT s.full_name,c.expires_on FROM erp_private.staff_capabilities c JOIN erp_private.staff_members s ON s.staff_id=c.staff_id WHERE c.capability='MLRO' AND c.deleted_at IS NULL AND (c.expires_on IS NULL OR c.expires_on>=current_date) AND erp_private.is_mlro() ORDER BY s.full_name
$$;
REVOKE ALL ON FUNCTION erp_private.aml_mlro_holders() FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.aml_mlro_holders() TO erp_api;

-- 2. Document reference numbers: DOC-2026-00001. A person types or picks the reference instead of attaching the file again.
CREATE SEQUENCE erp_private.doc_ref_seq;GRANT USAGE ON SEQUENCE erp_private.doc_ref_seq TO erp_api;
ALTER TABLE erp_private.documents ADD COLUMN doc_ref text NOT NULL DEFAULT ('DOC-'||to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYY')||'-'||lpad(nextval('erp_private.doc_ref_seq')::text,5,'0'));
CREATE UNIQUE INDEX documents_doc_ref_uidx ON erp_private.documents(doc_ref);

-- 3. The MLRO's lists (pre-populated dropdowns).
CREATE TABLE erp_private.aml_lookups(
 lookup_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 category text NOT NULL CHECK(category IN('COUNTRY','PEP_TYPE','SOURCE_OF_FUNDS','SOURCE_OF_WEALTH','SERVICE_ACTIVITY','RISK_INDICATOR')),
 value text NOT NULL CHECK(char_length(btrim(value)) BETWEEN 2 AND 120),
 attention boolean NOT NULL DEFAULT false,
 source text NOT NULL CHECK(char_length(btrim(source)) BETWEEN 3 AND 300),
 effective_from date NOT NULL DEFAULT current_date,
 status text NOT NULL DEFAULT 'Confirmed' CHECK(status IN('Starter','Confirmed','Ended')),
 created_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 confirmed_by uuid REFERENCES erp_private.staff_members,confirmed_at timestamptz,
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,ended_reason text CHECK(ended_reason IS NULL OR char_length(btrim(ended_reason)) BETWEEN 5 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(status<>'Ended' OR (ended_by IS NOT NULL AND ended_at IS NOT NULL AND ended_reason IS NOT NULL))
);
CREATE UNIQUE INDEX aml_lookups_live_uidx ON erp_private.aml_lookups(category,lower(btrim(value))) WHERE status<>'Ended';
CREATE FUNCTION erp_private.aml_lookups_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 IF NOT erp_private.is_mlro() THEN RAISE EXCEPTION 'Only the MLRO maintains the POCAMLA lists.' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status='Ended' THEN RAISE EXCEPTION 'A value is added, then ended later.' USING ERRCODE='23514'; END IF;
  IF NEW.created_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The value is recorded under your own name.' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.category,NEW.value,NEW.attention,NEW.source,NEW.effective_from,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.category,OLD.value,OLD.attention,OLD.source,OLD.effective_from,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A list value is never edited. End it with a reason and add the corrected value.' USING ERRCODE='23514'; END IF;
 IF OLD.status='Ended' THEN RAISE EXCEPTION 'An ended value stays as it was.' USING ERRCODE='23514'; END IF;
 IF NEW.status='Confirmed' AND OLD.status='Starter' AND NEW.confirmed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The confirmation is recorded under your own name.' USING ERRCODE='23514'; END IF;
 IF NEW.status='Ended' AND NEW.ended_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'Ending a value is recorded under your own name.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aml_lookups_guard BEFORE INSERT OR UPDATE ON erp_private.aml_lookups FOR EACH ROW EXECUTE FUNCTION erp_private.aml_lookups_guard();
INSERT INTO erp_private.aml_lookups(category,value,attention,source,status)
 SELECT 'COUNTRY',c,false,'Starter list of countries; the MLRO adds notes and flags from the firm''s own sources','Starter' FROM unnest(ARRAY['Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia','Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo (Republic)','Congo (Democratic Republic)','Costa Rica','Cote d''Ivoire','Croatia','Cuba','Cyprus','Czechia','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt','El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon','Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana','Haiti','Honduras','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kosovo','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova','Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan','Palau','Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino','Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan','Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo','Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe']) c;
INSERT INTO erp_private.aml_lookups(category,value,attention,source,status)
 SELECT x.category,x.value,x.attention,'Starter value from the firm''s POCAMLA specification; the MLRO confirms or replaces it','Starter' FROM (VALUES
 ('PEP_TYPE','No known PEP',false),('PEP_TYPE','Domestic PEP',true),('PEP_TYPE','Foreign PEP',true),('PEP_TYPE','International organisation function',true),('PEP_TYPE','Immediate family member of a PEP',true),('PEP_TYPE','Close associate of a PEP',true),
 ('SOURCE_OF_FUNDS','Salary or employment income',false),('SOURCE_OF_FUNDS','Business income',false),('SOURCE_OF_FUNDS','Investment income',false),('SOURCE_OF_FUNDS','Sale of property or assets',false),('SOURCE_OF_FUNDS','Inheritance or gift',false),('SOURCE_OF_FUNDS','Loan or financing',false),('SOURCE_OF_FUNDS','Grant or donor funding',false),('SOURCE_OF_FUNDS','Pension or retirement income',false),('SOURCE_OF_FUNDS','Public funds',false),('SOURCE_OF_FUNDS','Other (explain in the note)',true),
 ('SOURCE_OF_WEALTH','Employment',false),('SOURCE_OF_WEALTH','Business ownership',false),('SOURCE_OF_WEALTH','Investments',false),('SOURCE_OF_WEALTH','Inheritance',false),('SOURCE_OF_WEALTH','Property',false),('SOURCE_OF_WEALTH','Other (explain in the note)',true),
 ('SERVICE_ACTIVITY','Audit',false),('SERVICE_ACTIVITY','Tax compliance and advice',false),('SERVICE_ACTIVITY','Accounting and bookkeeping',false),('SERVICE_ACTIVITY','Payroll',false),('SERVICE_ACTIVITY','Advisory',false),
 ('SERVICE_ACTIVITY','Real estate transactions',true),('SERVICE_ACTIVITY','Managing client money or assets',true),('SERVICE_ACTIVITY','Managing client bank accounts',true),('SERVICE_ACTIVITY','Company formation',true),('SERVICE_ACTIVITY','Managing or administering a company or trust',true),('SERVICE_ACTIVITY','Other AML-relevant activity',true),
 ('RISK_INDICATOR','Unusual or complex activity',true),('RISK_INDICATOR','Unexplained third-party payments',true),('RISK_INDICATOR','Nominee arrangements',true),('RISK_INDICATOR','Unexpected foreign transactions',true),('RISK_INDICATOR','Inconsistent instructions or activity',true),('RISK_INDICATOR','Reluctance to give information or evidence',true),('RISK_INDICATOR','Cash-intensive business',true)
 ) x(category,value,attention);

-- 4. The firm's policy switch and the Partner's formal approval record.
CREATE TABLE erp_private.aml_policy(
 only_row boolean PRIMARY KEY DEFAULT true CHECK(only_row),
 gate_enforced boolean NOT NULL DEFAULT false,
 gate_changed_by uuid REFERENCES erp_private.staff_members,gate_changed_at timestamptz,gate_reason text,
 updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1
);
INSERT INTO erp_private.aml_policy DEFAULT VALUES;
CREATE TABLE erp_private.aml_policy_approvals(
 approval_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 approved_by uuid NOT NULL REFERENCES erp_private.staff_members,approved_at timestamptz NOT NULL DEFAULT now(),
 reference text NOT NULL CHECK(char_length(btrim(reference)) BETWEEN 3 AND 300),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 3 AND 1000),
 lists_snapshot jsonb NOT NULL
);
CREATE FUNCTION erp_private.aml_gate_enforced() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT coalesce((SELECT gate_enforced FROM erp_private.aml_policy),false) $$;
CREATE FUNCTION erp_private.aml_policy_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user='erp_api' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN RAISE EXCEPTION 'Only an Engagement Partner switches the POCAMLA gate.' USING ERRCODE='42501'; END IF;
 IF NEW.gate_enforced AND NOT OLD.gate_enforced THEN
  IF NOT EXISTS(SELECT 1 FROM erp_private.aml_policy_approvals) THEN RAISE EXCEPTION 'Record the Partner or Board approval of the POCAMLA lists first.' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.aml_lookups WHERE status='Starter') THEN RAISE EXCEPTION 'The MLRO has not yet confirmed every starter value in the lists.' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aml_policy_guard BEFORE UPDATE ON erp_private.aml_policy FOR EACH ROW EXECUTE FUNCTION erp_private.aml_policy_guard();

-- 5. The client's AML profile, the selections under it, and the decision log.
CREATE TABLE erp_private.client_aml_profiles(
 client_id uuid PRIMARY KEY REFERENCES erp_private.clients ON DELETE RESTRICT,
 stage text NOT NULL DEFAULT 'Staff review' CHECK(stage IN('Staff review','MLRO review','Decided')),
 purpose_of_relationship text,expected_activity text,expected_size_frequency text,
 pep_type text,pep_role text,pep_jurisdiction text,pep_from date,pep_relationship text,pep_document_id uuid REFERENCES erp_private.documents,
 screening_status text NOT NULL DEFAULT 'Not screened' CHECK(screening_status IN('Not screened','No match','Potential match','Confirmed match')),
 screening_list_source text,screening_list_date date,screening_note text,screening_document_id uuid REFERENCES erp_private.documents,
 risk_rating text CHECK(risk_rating IS NULL OR risk_rating IN('Low','Medium','High')),risk_reasons text,mitigating_controls text,risk_override_reason text,
 decision text CHECK(decision IS NULL OR decision IN('Accept','Accept with conditions','Restrict','Decline')),decision_conditions text,decision_reason text,
 decided_by uuid REFERENCES erp_private.staff_members,decided_at timestamptz,
 edd_required boolean NOT NULL DEFAULT false,edd_note text,
 next_review date,review_reason text,
 return_note text,
 submitted_by uuid REFERENCES erp_private.staff_members,submitted_at timestamptz,
 last_edited_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),revision bigint NOT NULL DEFAULT 1,
 CHECK(decision IS NULL OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX client_aml_profiles_stage_idx ON erp_private.client_aml_profiles(stage,next_review);
CREATE TABLE erp_private.client_aml_selections(
 selection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 category text NOT NULL CHECK(category IN('COUNTRY','SOURCE_OF_FUNDS','SOURCE_OF_WEALTH','SERVICE_ACTIVITY','RISK_INDICATOR')),
 context text NOT NULL DEFAULT '' CHECK(char_length(context)<=40),
 lookup_value text NOT NULL CHECK(char_length(btrim(lookup_value)) BETWEEN 2 AND 120),
 note text CHECK(note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
 evidence_document_id uuid REFERENCES erp_private.documents,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),
 ended_by uuid REFERENCES erp_private.staff_members,ended_at timestamptz,
 CHECK((ended_by IS NULL)=(ended_at IS NULL))
);
CREATE UNIQUE INDEX client_aml_selections_live_uidx ON erp_private.client_aml_selections(client_id,category,context,lower(btrim(lookup_value))) WHERE ended_at IS NULL;
CREATE INDEX client_aml_selections_client_idx ON erp_private.client_aml_selections(client_id) WHERE ended_at IS NULL;
CREATE TABLE erp_private.client_aml_decisions(
 decision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES erp_private.clients ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN('Decision','EDD requested','Returned for information')),
 decision text,risk_rating text,risk_reasons text,conditions text,edd_note text,note text,next_review date,
 decided_by uuid NOT NULL REFERENCES erp_private.staff_members,decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_aml_decisions_client_idx ON erp_private.client_aml_decisions(client_id,decided_at);

CREATE FUNCTION erp_private.client_aml_profiles_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user<>'erp_api' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.decision,NEW.decision_conditions,NEW.decision_reason,NEW.decided_by,NEW.decided_at,NEW.risk_rating,NEW.risk_reasons,NEW.mitigating_controls,NEW.risk_override_reason,NEW.next_review,NEW.review_reason,NEW.edd_required,NEW.edd_note)
    IS DISTINCT FROM ROW(OLD.decision,OLD.decision_conditions,OLD.decision_reason,OLD.decided_by,OLD.decided_at,OLD.risk_rating,OLD.risk_reasons,OLD.mitigating_controls,OLD.risk_override_reason,OLD.next_review,OLD.review_reason,OLD.edd_required,OLD.edd_note) THEN
  IF NOT erp_private.is_mlro() THEN RAISE EXCEPTION 'Only the MLRO records the risk rating, the decision and the review date.' USING ERRCODE='42501'; END IF;
 END IF;
 IF NEW.decision IS NOT NULL AND NEW.stage='Decided' AND (TG_OP='INSERT' OR OLD.stage IS DISTINCT FROM 'Decided') THEN
  IF NEW.decided_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The decision is recorded under your own name.' USING ERRCODE='23514'; END IF;
  IF NEW.decided_by IS NOT DISTINCT FROM NEW.last_edited_by OR NEW.decided_by IS NOT DISTINCT FROM NEW.submitted_by THEN RAISE EXCEPTION 'The person who prepared or submitted this profile cannot decide it; another MLRO or an Engagement Partner must.' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER client_aml_profiles_guard BEFORE INSERT OR UPDATE ON erp_private.client_aml_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.client_aml_profiles_guard();

-- Is this client cleared to start an engagement under the POCAMLA decision? Used by the engagement gate once the Partner switches it on.
CREATE FUNCTION erp_private.aml_cleared(p_client uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM erp_private.client_aml_profiles p
  LEFT JOIN erp_private.client_compliance k ON k.client_id=p.client_id
  WHERE p.client_id=p_client AND p.stage='Decided' AND p.decision IN('Accept','Accept with conditions')
   AND p.next_review IS NOT NULL AND p.next_review>=current_date
   AND (NOT (p.risk_rating='High' OR EXISTS(SELECT 1 FROM erp_private.aml_lookups l WHERE l.category='PEP_TYPE' AND l.value=p.pep_type AND l.attention)) OR k.edd_approved_by IS NOT NULL))
$$;
REVOKE ALL ON FUNCTION erp_private.aml_gate_enforced(),erp_private.aml_cleared(uuid) FROM PUBLIC,anon,authenticated,service_role;GRANT EXECUTE ON FUNCTION erp_private.aml_gate_enforced(),erp_private.aml_cleared(uuid) TO erp_api;

DO $patch$ DECLARE d text;o text;n text; BEGIN
 d:=pg_get_functiondef('erp_private.project_guard()'::regprocedure);
 o:=$q$IF c.verified_by IS NULL OR c.review_due IS NULL$q$;
 n:=$q$IF erp_private.aml_gate_enforced() AND NOT erp_private.aml_cleared(NEW.client_id) THEN RAISE EXCEPTION 'POCAMLA: the MLRO has not approved this client (a current Accept or Accept with conditions decision, and enhanced due diligence where it applies, are required)' USING ERRCODE='23514'; END IF;
  IF c.verified_by IS NULL OR c.review_due IS NULL$q$;
 IF position(o IN d)=0 THEN RAISE EXCEPTION 'project_guard changed: patch not applied'; END IF;
 EXECUTE replace(d,o,n);
END $patch$;

-- 6. Access: every staff member with access to the client may read and prepare; the MLRO decides; the Partner approves the policy.
ALTER TABLE erp_private.aml_lookups ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_lookups FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aml_policy ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aml_policy_approvals ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aml_policy_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_aml_profiles ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_aml_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_aml_selections ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_aml_selections FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.client_aml_decisions ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.client_aml_decisions FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.aml_lookups,erp_private.client_aml_profiles,erp_private.client_aml_selections TO erp_api;
GRANT SELECT,UPDATE ON erp_private.aml_policy TO erp_api;
GRANT SELECT,INSERT ON erp_private.aml_policy_approvals,erp_private.client_aml_decisions TO erp_api;
CREATE POLICY aml_lookups_read ON erp_private.aml_lookups FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY aml_lookups_insert ON erp_private.aml_lookups FOR INSERT TO erp_api WITH CHECK(erp_private.is_mlro());
CREATE POLICY aml_lookups_update ON erp_private.aml_lookups FOR UPDATE TO erp_api USING(erp_private.is_mlro()) WITH CHECK(erp_private.is_mlro());
CREATE POLICY aml_policy_read ON erp_private.aml_policy FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY aml_policy_update ON erp_private.aml_policy FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE POLICY aml_approvals_read ON erp_private.aml_policy_approvals FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE POLICY aml_approvals_insert ON erp_private.aml_policy_approvals FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND approved_by=(erp_private.actor()).staff_id);
CREATE POLICY aml_profiles_read ON erp_private.client_aml_profiles FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY aml_profiles_insert ON erp_private.client_aml_profiles FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN'));
CREATE POLICY aml_profiles_update ON erp_private.client_aml_profiles FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY aml_selections_read ON erp_private.client_aml_selections FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY aml_selections_insert ON erp_private.client_aml_selections FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN') AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY aml_selections_update ON erp_private.client_aml_selections FOR UPDATE TO erp_api USING(erp_private.client_allowed(client_id) AND (erp_private.actor()).category_code NOT IN('INTERN','ADMIN')) WITH CHECK(erp_private.client_allowed(client_id));
CREATE POLICY aml_decisions_read ON erp_private.client_aml_decisions FOR SELECT TO erp_api USING(erp_private.client_allowed(client_id));
CREATE POLICY aml_decisions_insert ON erp_private.client_aml_decisions FOR INSERT TO erp_api WITH CHECK(erp_private.client_allowed(client_id) AND decided_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aml_lookups FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aml_policy_approvals FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_aml_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_aml_selections FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.client_aml_decisions FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aml_lookups FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('lookup_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_aml_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('client_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_aml_selections FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('selection_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.client_aml_decisions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('decision_id');
CREATE TRIGGER change_audit AFTER UPDATE ON erp_private.aml_policy FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('only_row');
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aml_lookups FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.client_aml_profiles FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aml_policy FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
