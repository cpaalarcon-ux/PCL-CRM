-- Step 5 of the joined-practice review (2026-11-09): a defined file for every service.
--
-- Until now the 23 services were only names. Only tax compliance had behaviour behind it. This step gives every service:
--   * a PROFILE: which engine it runs on and whether that engine is built;
--   * REFERENCES: the standards, laws and guidance that usually apply, each marked Suggested until a Partner records the Compliance
--     Lead's written confirmation (nothing is stored as a rule, and no section numbers are asserted);
--   * a FILE CHECKLIST: what the project file should hold, by stage, checked against what is actually on the project.
-- The checklist only shows what is present or missing. It does not block anything, except billing: an invoice cannot be posted
-- unless the project holds a verified, unexpired signed engagement letter (Partner decision of 2026-11-09, applies to every service).
--
-- Two services are added (Partner decision of 2026-11-09): Agreed-Upon Procedures and KRA Audit and Dispute Support. The codes avoid the
-- AUD- prefix on purpose: that prefix creates an audit file with statutory-audit gates.

INSERT INTO erp_private.services(service_code,service_group,service_name,is_active) VALUES
 ('ADV-AUP','Advisory & Consulting','Agreed-Upon Procedures',true),
 ('TAX-KRA','Tax Services','KRA Audit and Dispute Support',true)
ON CONFLICT (service_code) DO NOTHING;

CREATE TABLE erp_private.service_profiles(
 service_code text PRIMARY KEY REFERENCES erp_private.services,
 engine text NOT NULL CHECK(engine IN('Audit file','Tax engine','Ledger and statements','Procedures engine','Restricted file','Checklist only')),
 engine_state text NOT NULL CHECK(engine_state IN('Built','Partly built','Planned')),
 note text NOT NULL DEFAULT ''
);
INSERT INTO erp_private.service_profiles(service_code,engine,engine_state,note) VALUES
 ('AUD-STAT','Audit file','Built','Materiality, risks, working papers, completion, reports and the assembly lock are built, including SACCO.'),
 ('AUD-INT','Audit file','Partly built','Runs on the statutory-audit file. Internal audit follows different standards; the gates may not fit.'),
 ('AUD-PROJ','Audit file','Partly built','Runs on the statutory-audit file. Procedures-only work will move to the procedures engine.'),
 ('AUD-VFM','Audit file','Partly built','Runs on the statutory-audit file; performance audit criteria are not modelled.'),
 ('AUD-GRANT','Audit file','Partly built','Runs on the statutory-audit file. Procedures-only work will move to the procedures engine.'),
 ('AUD-RISK','Audit file','Partly built','Runs on the statutory-audit file; the control framework is not modelled.'),
 ('TAX-COMP','Tax engine','Built','Periods, filings, payments, computations and approvals are built.'),
 ('TAX-DIAG','Checklist only','Built','Free-form tasks and the file checklist. No tax engine behind it.'),
 ('TAX-ADV','Checklist only','Built','Free-form tasks and the file checklist. No tax engine behind it.'),
 ('TAX-EXEMPT','Checklist only','Built','Free-form tasks and the file checklist. No tax engine behind it.'),
 ('TAX-TP','Checklist only','Built','Free-form tasks and the file checklist. No tax engine behind it.'),
 ('TAX-KRA','Procedures engine','Planned','Staff create the project from a template and amend it to the notice and the engagement letter. The procedures engine and notice log are not built yet.'),
 ('ACC-BOOK','Ledger and statements','Partly built','Built for limited companies, partnerships and sole proprietors. Co-operative and public entity ledgers are pending.'),
 ('ACC-REP','Ledger and statements','Partly built','Built for limited companies, partnerships and sole proprietors. Co-operative and public entity statements are pending.'),
 ('ACC-PAY','Checklist only','Built','Payroll is not a separate engine; PAYE and statutory lines sit inside tax.'),
 ('ACC-MGMT','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ACC-CASH','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-PLAN','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-FEAS','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-CTRL','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-GOV','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-AML','Checklist only','Built','Free-form tasks and the file checklist. The AML applicability decision and filings are not built.'),
 ('ADV-LSK','Checklist only','Built','Free-form tasks and the file checklist.'),
 ('ADV-FOR','Restricted file','Planned','Needs a file visible only to its access list (Partner decision of 2026-11-09). Not built yet; until then it is an ordinary project.'),
 ('ADV-AUP','Procedures engine','Planned','Library, draft scope, Partner lock, execution board with evidence gate and report. Not built yet.');
ALTER TABLE erp_private.service_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_profiles FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.service_profiles TO erp_api;
CREATE POLICY service_profiles_read ON erp_private.service_profiles FOR SELECT TO erp_api USING(true);

-- References: standards, laws and guidance. Suggested until a Partner records the Compliance Lead's written confirmation.
CREATE TABLE erp_private.service_references(
 reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 service_code text NOT NULL REFERENCES erp_private.services,
 kind text NOT NULL CHECK(kind IN('Standard','Law','Guidance')),
 reference text NOT NULL CHECK(length(btrim(reference))>=3),
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed','Retired')),
 source_note text,
 confirmed_by uuid REFERENCES erp_private.staff_members,
 confirmed_at timestamptz,
 created_by uuid REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(rule_status='Suggested' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL AND length(btrim(COALESCE(source_note,'')))>=10)),
 CHECK(rule_status<>'Suggested' OR (confirmed_by IS NULL AND confirmed_at IS NULL))
);
CREATE INDEX service_references_service_idx ON erp_private.service_references(service_code);
CREATE INDEX service_references_confirmed_by_idx ON erp_private.service_references(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX service_references_created_by_idx ON erp_private.service_references(created_by) WHERE created_by IS NOT NULL;
CREATE UNIQUE INDEX service_references_unique ON erp_private.service_references(service_code,kind,lower(btrim(reference))) WHERE rule_status<>'Retired';

INSERT INTO erp_private.service_references(service_code,kind,reference) VALUES
 ('AUD-STAT','Standard','International Standards on Auditing: engagement letter, documentation, planning, risk, materiality, evidence, representations, reporting'),
 ('AUD-STAT','Standard','ISQM 1 and ISQM 2 (quality management and engagement quality review)'),
 ('AUD-STAT','Law','Companies Act (audit provisions)'),
 ('AUD-STAT','Law','SACCO Societies Act and SASRA rules, for SACCO clients'),
 ('AUD-INT','Standard','Internal audit standards of the Institute of Internal Auditors'),
 ('AUD-PROJ','Guidance','Donor or funder agreement terms'),
 ('AUD-PROJ','Standard','ISAE 3000 if an assurance opinion is given; ISRS 4400 (Revised) if procedures only'),
 ('AUD-GRANT','Guidance','Donor or funder agreement terms'),
 ('AUD-GRANT','Standard','ISAE 3000 if an assurance opinion is given; ISRS 4400 (Revised) if procedures only'),
 ('AUD-VFM','Guidance','Public-sector performance audit practice (standard to be named by the Compliance Lead)'),
 ('AUD-RISK','Standard','ISAE 3000 and a named control framework'),
 ('TAX-COMP','Law','Income Tax Act, VAT Act, Tax Procedures Act, PAYE rules'),
 ('TAX-COMP','Guidance','KRA eTIMS requirements'),
 ('TAX-DIAG','Law','Income Tax Act, VAT Act, Tax Procedures Act'),
 ('TAX-ADV','Law','Income Tax Act, VAT Act, Tax Procedures Act'),
 ('TAX-EXEMPT','Law','Income Tax Act exemption provisions and public benefit organisation law'),
 ('TAX-TP','Law','Transfer pricing rules under the Income Tax Act'),
 ('TAX-KRA','Law','Tax Procedures Act (notices, audits, objections and appeals)'),
 ('TAX-KRA','Standard','ISRS 4400 (Revised) for the report of procedures'),
 ('ACC-BOOK','Law','Companies Act record-keeping requirements'),
 ('ACC-BOOK','Standard','IFRS or IFRS for SMEs; ISRS 4410 (Revised) if statements are compiled'),
 ('ACC-PAY','Law','Employment Act and the statutory deduction laws (PAYE, NSSF, SHIF, housing levy, NITA)'),
 ('ACC-REP','Standard','IFRS, IFRS for SMEs, IPSAS'),
 ('ACC-MGMT','Guidance','No mandatory standard; ISAE 3400 only if an opinion on prospective information is requested'),
 ('ACC-CASH','Guidance','No mandatory standard; ISAE 3400 only if an opinion on prospective information is requested'),
 ('ADV-PLAN','Guidance','No mandatory standard'),
 ('ADV-FEAS','Guidance','No mandatory standard'),
 ('ADV-CTRL','Guidance','A named control framework such as COSO'),
 ('ADV-GOV','Guidance','A named governance framework or code, where one applies'),
 ('ADV-AML','Law','Proceeds of Crime and Anti-Money Laundering Act, including the 2025 amendment; FRC and goAML guidance'),
 ('ADV-LSK','Guidance','Advocates accounts rules and Law Society of Kenya requirements'),
 ('ADV-FOR','Law','Evidence law on electronic records'),
 ('ADV-FOR','Guidance','Forensic standard reference: PENDING COMPLIANCE REVIEW (no numbered standard is cited until verified)'),
 ('ADV-AUP','Standard','ISRS 4400 (Revised), agreed-upon procedures engagements');
ALTER TABLE erp_private.service_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_references FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.service_references TO erp_api;
CREATE POLICY service_references_read ON erp_private.service_references FOR SELECT TO erp_api USING(true);
CREATE POLICY service_references_add ON erp_private.service_references FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY service_references_update ON erp_private.service_references FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());

CREATE FUNCTION erp_private.service_reference_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can add a standard or law reference to a service' USING ERRCODE='42501'; END IF;
  IF NEW.rule_status<>'Suggested' THEN RAISE EXCEPTION 'A new reference starts as Suggested; a Partner confirms it separately' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.service_code,NEW.kind,NEW.reference,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.service_code,OLD.kind,OLD.reference,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A reference cannot be edited; retire it and add the correct one' USING ERRCODE='23514';
 END IF;
 IF OLD.rule_status='Retired' AND NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'A retired reference stays retired' USING ERRCODE='23514'; END IF;
 IF NEW.rule_status IS NOT DISTINCT FROM OLD.rule_status AND ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be changed; retire the reference and add it again' USING ERRCODE='23514';
 END IF;
 IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm or retire a reference' USING ERRCODE='42501'; END IF;
  IF NEW.rule_status IN('Confirmed','Retired') THEN
   IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
   NEW.confirmed_at:=now();
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reference_guard BEFORE INSERT OR UPDATE ON erp_private.service_references FOR EACH ROW EXECUTE FUNCTION erp_private.service_reference_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.service_references FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.service_references FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.service_references FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('reference_id');

-- The file checklist: what each service's project file should hold, by stage.
-- 'Record' items are worked out from data the system already holds. 'Document' items check that the project holds at least one
-- current file in the named document category (the category is checked, not the individual document).
CREATE TABLE erp_private.service_checklist_items(
 service_code text NOT NULL REFERENCES erp_private.services,
 item_key text NOT NULL CHECK(item_key ~ '^[a-z0-9_]{2,40}$'),
 stage text NOT NULL CHECK(stage IN('Acceptance','Execution','Issue')),
 label text NOT NULL,
 check_kind text NOT NULL CHECK(check_kind IN('Record','Document')),
 record_check text CHECK(record_check IN('KYC_VERIFIED','LETTER_VERIFIED','FEE_AGREED','TEAM_ASSIGNED')),
 document_category text CHECK(document_category IN('Permanent File','Signed Engagement Letters','Current Year Audit','Tax Returns','Working Papers','PBC Documents','BRS Receipts','Final Reports')),
 required boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL DEFAULT 100,
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Confirmed','Retired')),
 note text NOT NULL DEFAULT '',
 PRIMARY KEY(service_code,item_key),
 CHECK((check_kind='Record')=(record_check IS NOT NULL)),
 CHECK((check_kind='Document')=(document_category IS NOT NULL))
);
-- The same four record checks for every service.
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,record_check,required,sort_order)
SELECT s.service_code,v.item_key,v.stage,v.label,'Record',v.rc,true,v.ord FROM erp_private.services s
 CROSS JOIN (VALUES
  ('kyc','Acceptance','Client KYC verified and current','KYC_VERIFIED',10),
  ('letter','Acceptance','Signed engagement letter uploaded and verified','LETTER_VERIFIED',20),
  ('fee','Acceptance','Fee agreed (a fee budget or an active recurring fee)','FEE_AGREED',30),
  ('team','Execution','Team assigned to the project','TEAM_ASSIGNED',40)
 ) v(item_key,stage,label,rc,ord);
-- Document items by service. Working papers and the issued deliverable for most; the rest as the standards and laws usually expect.
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note)
SELECT s.service_code,'workpapers','Execution','Working papers or supporting schedules filed','Document','Working Papers',true,50,'' FROM erp_private.services s
 WHERE s.service_code NOT IN('TAX-COMP');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note)
SELECT s.service_code,'deliverable','Issue','Signed deliverable filed (report, memo, certificate or letter)','Document','Final Reports',true,60,'' FROM erp_private.services s
 WHERE s.service_code NOT IN('TAX-COMP','ACC-BOOK','ACC-PAY');
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,document_category,required,sort_order,note) VALUES
 ('AUD-STAT','audit_file','Execution','Current year audit file documents','Document','Current Year Audit',true,52,''),
 ('AUD-STAT','pbc','Execution','Client-provided documents (PBC)','Document','PBC Documents',false,54,'Optional: some audits are fully system-based.'),
 ('TAX-COMP','returns','Issue','Filed return and acknowledgement','Document','Tax Returns',true,60,''),
 ('TAX-COMP','workpapers','Execution','Tax working papers filed','Document','Working Papers',true,50,''),
 ('TAX-EXEMPT','registration','Acceptance','Constitution and registration documents','Document','Permanent File',true,15,''),
 ('ACC-BOOK','bank_rec','Execution','Bank reconciliation evidence','Document','BRS Receipts',false,55,'Optional: only for clients with bank accounts to reconcile.'),
 ('ADV-AML','risk_profile','Acceptance','Risk profile and applicability decision','Document','Permanent File',true,16,''),
 ('TAX-KRA','notice','Acceptance','KRA notice and correspondence (filed under Permanent File until a notice category exists)','Document','Permanent File',true,15,''),
 ('TAX-KRA','requested','Execution','Documents requested by KRA','Document','PBC Documents',true,52,''),
 ('ADV-AUP','requested','Execution','Evidence for each procedure','Document','PBC Documents',true,52,'');
ALTER TABLE erp_private.service_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.service_checklist_items FORCE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.service_checklist_items TO erp_api;
CREATE POLICY service_checklist_read ON erp_private.service_checklist_items FOR SELECT TO erp_api USING(true);

-- Does the project hold a verified, unexpired signed engagement letter? Used by the checklist and by invoice posting.
CREATE FUNCTION erp_private.project_letter_ok(p_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.engagement_controls e WHERE e.project_id=p_project AND e.deleted_at IS NULL
  AND e.signed_letter_id IS NOT NULL AND e.letter_verified_by IS NOT NULL
  AND (e.letter_expires_on IS NULL OR e.letter_expires_on>=(now() AT TIME ZONE 'Africa/Nairobi')::date))
$$;

-- The checklist for one project. Empty unless the caller may see the project.
CREATE FUNCTION erp_private.project_file_checklist(p_project uuid)
RETURNS TABLE(item_key text,stage text,label text,check_kind text,required boolean,present boolean,sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT i.item_key,i.stage,i.label,i.check_kind,i.required,
  CASE i.record_check
   WHEN 'KYC_VERIFIED' THEN EXISTS(SELECT 1 FROM erp_private.client_compliance k WHERE k.client_id=p.client_id AND k.verified_by IS NOT NULL AND k.review_due IS NOT NULL AND k.review_due>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
   WHEN 'LETTER_VERIFIED' THEN erp_private.project_letter_ok(p.project_id)
   WHEN 'FEE_AGREED' THEN EXISTS(SELECT 1 FROM erp_private.project_budgets b WHERE b.project_id=p.project_id AND b.agreed_fee>0)
                       OR EXISTS(SELECT 1 FROM erp_private.recurring_fee_schedules f WHERE f.project_id=p.project_id AND f.status='Active')
   WHEN 'TEAM_ASSIGNED' THEN EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=p.project_id AND a.deleted_at IS NULL)
   ELSE EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.project_id=p.project_id AND d.category=i.document_category AND d.deleted_at IS NULL AND d.archived_at IS NULL)
  END,i.sort_order
 FROM erp_private.projects p JOIN erp_private.service_checklist_items i ON i.service_code=p.service_code AND i.rule_status<>'Retired'
 WHERE p.project_id=p_project AND p.deleted_at IS NULL AND erp_private.project_allowed(p.project_id)
 ORDER BY i.sort_order,i.item_key
$$;

-- Active projects with required items missing (Manager or Partner only). Used by the go-live checks.
CREATE FUNCTION erp_private.project_file_gaps() RETURNS TABLE(project_id uuid,missing integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p.project_id,(count(*) FILTER(WHERE c.required AND NOT c.present))::int
 FROM erp_private.projects p CROSS JOIN LATERAL erp_private.project_file_checklist(p.project_id) c
 WHERE p.status='Active' AND p.deleted_at IS NULL AND erp_private.is_leader()
 GROUP BY p.project_id HAVING count(*) FILTER(WHERE c.required AND NOT c.present)>0
$$;

REVOKE EXECUTE ON FUNCTION erp_private.service_reference_guard(),erp_private.project_letter_ok(uuid),erp_private.project_file_checklist(uuid),erp_private.project_file_gaps() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.project_letter_ok(uuid),erp_private.project_file_checklist(uuid),erp_private.project_file_gaps() TO erp_api;
