-- Step 6 of the joined-practice review (2026-11-09): the procedures engine for Agreed-Upon Procedures (ADV-AUP) and KRA Audit and
-- Dispute Support (TAX-KRA). A KRA audit is treated as a form of agreed-upon procedures: the work is a list of procedures that is
-- fixed by the signed engagement letter, performed, evidenced, reviewed and reported as factual findings.
--
-- How it works:
--  * LIBRARY: suggested procedures (all "Suggested" until a Partner records the Compliance Lead's confirmation). Staff may also write a custom
--    procedure. The library never limits what a scope can hold.
--  * DRAFT SCOPE: a Manager or Partner adds and removes procedures freely while the scope is a draft. Removing is soft (nothing is deleted).
--    For TAX-KRA the project is created by staff from the template; this scope is then amended to the notice and the letter.
--  * LOCK: only a Partner locks the scope, against the project's verified signed engagement letter. The lock records the letter, where in
--    the letter the procedures are listed, the time, and a SHA-256 of the procedure list.
--  * SCOPE CHANGE: after the lock, procedures can only be added or removed through a request (Manager or Partner) that a Partner who is not
--    the requester approves. Approval applies the change; the request and its decision stay on the record.
--  * EXECUTION: assigned staff mark each procedure In progress, Completed, Exception or Not applicable, with a factual finding. A procedure that
--    needs evidence cannot be Completed or reported as an Exception until a document from the same project is attached (the evidence gate).
--    Any change to a result removes the review. A Supervisor, Manager or Partner other than the performer reviews each result.
--  * REPORT: a Partner issues the report of factual findings once every procedure is performed and reviewed. The report is stored as a
--    snapshot with its SHA-256 and the scope is then closed. The standard reference in the report reads "[STANDARD REFERENCE - PENDING
--    COMPLIANCE REVIEW]" until a Partner has recorded the Compliance Lead's confirmation of that reference. ISRS 4000 is not used anywhere.
-- Report wording and the library are defaults that no Partner or Compliance Lead has confirmed.

-- 1. Library of suggested procedures.
CREATE TABLE erp_private.aup_procedure_library(
 library_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK(code ~ '^[A-Z]{2,5}-[0-9]{2,3}$'),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 200),
 description text NOT NULL CHECK(length(btrim(description))>=10),
 area text NOT NULL CHECK(area IN('Tax','Payroll','Bank','Sales','Purchases','Ledger','Documents','General')),
 applies_to text NOT NULL CHECK(applies_to IN('Both','ADV-AUP','TAX-KRA')),
 in_template boolean NOT NULL DEFAULT false,
 evidence_required boolean NOT NULL DEFAULT true,
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
CREATE UNIQUE INDEX aup_library_code_unique ON erp_private.aup_procedure_library(code);
CREATE INDEX aup_library_confirmed_by_idx ON erp_private.aup_procedure_library(confirmed_by) WHERE confirmed_by IS NOT NULL;
CREATE INDEX aup_library_created_by_idx ON erp_private.aup_procedure_library(created_by) WHERE created_by IS NOT NULL;
INSERT INTO erp_private.aup_procedure_library(code,title,description,area,applies_to,in_template,evidence_required) VALUES
 ('KRA-01','Agree VAT returns to the general ledger','Compare output and input VAT on the filed returns for the period to the VAT control accounts in the ledger, and list each difference.','Tax','TAX-KRA',true,true),
 ('KRA-02','Match sales invoices to eTIMS records','Compare the sales recorded in the ledger for the period to the sales held on eTIMS, and list invoices on either side that have no match.','Sales','TAX-KRA',true,true),
 ('KRA-03','Match purchase invoices to supplier eTIMS records','Compare purchases recorded in the ledger to the supplier eTIMS invoices used to claim input VAT, and list purchases that have no match.','Purchases','TAX-KRA',true,true),
 ('KRA-04','Reconcile PAYE returns to payroll records','Compare the PAYE declared on the returns for the period to the payroll records and the amounts paid, and list each difference.','Payroll','TAX-KRA',true,true),
 ('KRA-05','Reconcile withholding tax deducted and certificates','Compare withholding tax deducted and withheld from the client to the certificates and the amounts paid, and list each difference.','Tax','TAX-KRA',true,true),
 ('KRA-06','Agree the income tax computation to the financial statements','Agree each figure in the income tax computation to the financial statements and the trial balance, and list each difference.','Tax','TAX-KRA',true,true),
 ('KRA-07','Agree opening balances to the prior-year closing trial balance','Compare the opening balances in the books for the period to the prior-year closing trial balance, and list each difference.','Ledger','Both',true,true),
 ('KRA-08','Trace bank receipts to recorded sales','Trace receipts on the bank statements for the period to the sales recorded in the ledger, and list receipts that have no matching sale.','Bank','TAX-KRA',false,true),
 ('KRA-09','List manual (non-eTIMS) transactions and the support held','List the transactions recorded without an eTIMS document and state the support held for each.','Documents','TAX-KRA',false,true),
 ('KRA-10','Compile the documents requested in the KRA notice','List each item the notice asks for, the document supplied for it, and any item that could not be supplied.','Documents','TAX-KRA',true,true),
 ('AUP-01','Agree amounts in a schedule to underlying records','Agree each amount in the schedule named in the engagement letter to the underlying record named in the letter, and list each difference.','General','ADV-AUP',true,true),
 ('AUP-02','Inspect specified documents for stated attributes','Inspect the documents named in the engagement letter for the attributes the letter lists, and state for each document whether each attribute is present.','Documents','ADV-AUP',true,true),
 ('AUP-03','Recompute the totals in a schedule','Recompute the totals and extensions in the schedule provided and state any difference from the figures shown.','General','ADV-AUP',true,false),
 ('AUP-04','Obtain confirmation from a named third party','Send the confirmation request described in the engagement letter to the named third party, and state the reply received or that none was received.','General','ADV-AUP',false,true),
 ('AUP-05','Compare data between two named sources','Compare the data in the two sources named in the engagement letter for the stated period, and list each difference.','General','ADV-AUP',false,true);
ALTER TABLE erp_private.aup_procedure_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aup_procedure_library FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.aup_procedure_library TO erp_api;
CREATE POLICY aup_library_read ON erp_private.aup_procedure_library FOR SELECT TO erp_api USING(true);
CREATE POLICY aup_library_add ON erp_private.aup_procedure_library FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY aup_library_update ON erp_private.aup_procedure_library FOR UPDATE TO erp_api USING(erp_private.is_leader()) WITH CHECK(erp_private.is_leader());

CREATE FUNCTION erp_private.aup_library_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER') OR NEW.created_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can add a suggested procedure to the library' USING ERRCODE='42501'; END IF;
  IF NEW.rule_status<>'Suggested' THEN RAISE EXCEPTION 'A new library procedure starts as Suggested; a Partner confirms it separately' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.code,NEW.title,NEW.description,NEW.area,NEW.applies_to,NEW.in_template,NEW.evidence_required,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.code,OLD.title,OLD.description,OLD.area,OLD.applies_to,OLD.in_template,OLD.evidence_required,OLD.created_by,OLD.created_at) THEN
  RAISE EXCEPTION 'A library procedure cannot be edited; retire it and add the correct one' USING ERRCODE='23514';
 END IF;
 IF OLD.rule_status='Retired' AND NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN RAISE EXCEPTION 'A retired procedure stays retired' USING ERRCODE='23514'; END IF;
 IF NEW.rule_status IS NOT DISTINCT FROM OLD.rule_status AND ROW(NEW.confirmed_by,NEW.confirmed_at,NEW.source_note) IS DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at,OLD.source_note) THEN
  RAISE EXCEPTION 'A recorded confirmation cannot be changed; retire the procedure and add it again' USING ERRCODE='23514';
 END IF;
 IF NEW.rule_status IS DISTINCT FROM OLD.rule_status THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can confirm or retire a library procedure' USING ERRCODE='42501'; END IF;
  IF NEW.rule_status IN('Confirmed','Retired') THEN
   IF v_actor IS NOT NULL AND NEW.confirmed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the confirmation must be the signed-in Partner' USING ERRCODE='42501'; END IF;
   NEW.confirmed_at:=now();
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aup_guard BEFORE INSERT OR UPDATE ON erp_private.aup_procedure_library FOR EACH ROW EXECUTE FUNCTION erp_private.aup_library_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aup_procedure_library FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aup_procedure_library FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aup_procedure_library FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('library_id');

-- 2. The scope of one project (one scope per project).
CREATE TABLE erp_private.aup_scopes(
 scope_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL UNIQUE REFERENCES erp_private.projects,
 state text NOT NULL DEFAULT 'Draft' CHECK(state IN('Draft','Locked','Issued')),
 letter_document_id uuid REFERENCES erp_private.documents,
 letter_reference text,
 locked_by uuid REFERENCES erp_private.staff_members,
 locked_at timestamptz,
 scope_sha256 text CHECK(scope_sha256 IS NULL OR scope_sha256 ~ '^[0-9a-f]{64}$'),
 report_issued_by uuid REFERENCES erp_private.staff_members,
 report_issued_at timestamptz,
 report_snapshot jsonb,
 report_sha256 text CHECK(report_sha256 IS NULL OR report_sha256 ~ '^[0-9a-f]{64}$'),
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((state='Draft')=(locked_at IS NULL AND locked_by IS NULL AND scope_sha256 IS NULL AND letter_document_id IS NULL)),
 CHECK(state='Draft' OR length(btrim(COALESCE(letter_reference,'')))>=3),
 CHECK((state='Issued')=(report_issued_at IS NOT NULL AND report_issued_by IS NOT NULL AND report_snapshot IS NOT NULL AND report_sha256 IS NOT NULL))
);
CREATE INDEX aup_scopes_letter_idx ON erp_private.aup_scopes(letter_document_id) WHERE letter_document_id IS NOT NULL;
CREATE INDEX aup_scopes_locked_by_idx ON erp_private.aup_scopes(locked_by) WHERE locked_by IS NOT NULL;
CREATE INDEX aup_scopes_issued_by_idx ON erp_private.aup_scopes(report_issued_by) WHERE report_issued_by IS NOT NULL;
CREATE INDEX aup_scopes_created_by_idx ON erp_private.aup_scopes(created_by);

-- 3. The procedures in a scope, with their results.
CREATE TABLE erp_private.aup_scope_items(
 item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id uuid NOT NULL REFERENCES erp_private.aup_scopes,
 seq integer NOT NULL CHECK(seq>0),
 library_id uuid REFERENCES erp_private.aup_procedure_library,
 source text NOT NULL CHECK(source IN('Library','Custom')),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 200),
 description text NOT NULL CHECK(length(btrim(description))>=10),
 evidence_required boolean NOT NULL DEFAULT true,
 added_by uuid NOT NULL REFERENCES erp_private.staff_members,
 added_at timestamptz NOT NULL DEFAULT now(),
 added_in_change uuid,
 removed_at timestamptz,
 removed_by uuid REFERENCES erp_private.staff_members,
 removed_reason text,
 removed_in_change uuid,
 exec_status text NOT NULL DEFAULT 'Not started' CHECK(exec_status IN('Not started','In progress','Completed','Exception','Not applicable')),
 finding text,
 performed_by uuid REFERENCES erp_private.staff_members,
 performed_at timestamptz,
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((source='Library')=(library_id IS NOT NULL)),
 CHECK((removed_at IS NULL)=(removed_by IS NULL)),
 CHECK((removed_at IS NULL)=(removed_reason IS NULL)),
 CHECK(removed_reason IS NULL OR length(btrim(removed_reason))>=3),
 CHECK((exec_status='Not started')=(performed_by IS NULL AND performed_at IS NULL)),
 CHECK((reviewed_by IS NULL)=(reviewed_at IS NULL)),
 CHECK(reviewed_by IS NULL OR exec_status IN('Completed','Exception','Not applicable')),
 CHECK(exec_status NOT IN('Completed','Exception','Not applicable') OR length(btrim(COALESCE(finding,'')))>=3)
);
CREATE UNIQUE INDEX aup_items_seq_unique ON erp_private.aup_scope_items(scope_id,seq);
CREATE INDEX aup_items_library_idx ON erp_private.aup_scope_items(library_id) WHERE library_id IS NOT NULL;
CREATE INDEX aup_items_added_by_idx ON erp_private.aup_scope_items(added_by);
CREATE INDEX aup_items_removed_by_idx ON erp_private.aup_scope_items(removed_by) WHERE removed_by IS NOT NULL;
CREATE INDEX aup_items_performed_by_idx ON erp_private.aup_scope_items(performed_by) WHERE performed_by IS NOT NULL;
CREATE INDEX aup_items_reviewed_by_idx ON erp_private.aup_scope_items(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX aup_items_added_change_idx ON erp_private.aup_scope_items(added_in_change) WHERE added_in_change IS NOT NULL;
CREATE INDEX aup_items_removed_change_idx ON erp_private.aup_scope_items(removed_in_change) WHERE removed_in_change IS NOT NULL;

-- 4. Evidence attached to a procedure: documents from the same project.
CREATE TABLE erp_private.aup_item_evidence(
 evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_id uuid NOT NULL REFERENCES erp_private.aup_scope_items,
 document_id uuid NOT NULL REFERENCES erp_private.documents,
 note text NOT NULL DEFAULT '',
 linked_by uuid NOT NULL REFERENCES erp_private.staff_members,
 linked_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz,
 removed_by uuid REFERENCES erp_private.staff_members,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((removed_at IS NULL)=(removed_by IS NULL))
);
CREATE UNIQUE INDEX aup_evidence_current_unique ON erp_private.aup_item_evidence(item_id,document_id) WHERE removed_at IS NULL;
CREATE INDEX aup_evidence_document_idx ON erp_private.aup_item_evidence(document_id);
CREATE INDEX aup_evidence_linked_by_idx ON erp_private.aup_item_evidence(linked_by);
CREATE INDEX aup_evidence_removed_by_idx ON erp_private.aup_item_evidence(removed_by) WHERE removed_by IS NOT NULL;

-- 5. Scope changes after the lock.
CREATE TABLE erp_private.aup_scope_changes(
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 scope_id uuid NOT NULL REFERENCES erp_private.aup_scopes,
 kind text NOT NULL CHECK(kind IN('Add','Remove')),
 item_id uuid REFERENCES erp_private.aup_scope_items,
 library_id uuid REFERENCES erp_private.aup_procedure_library,
 proposed_title text,
 proposed_description text,
 proposed_evidence_required boolean,
 reason text NOT NULL CHECK(length(btrim(reason))>=10),
 supporting_document_id uuid REFERENCES erp_private.documents,
 status text NOT NULL DEFAULT 'Requested' CHECK(status IN('Requested','Approved','Rejected')),
 requested_by uuid NOT NULL REFERENCES erp_private.staff_members,
 requested_at timestamptz NOT NULL DEFAULT now(),
 decided_by uuid REFERENCES erp_private.staff_members,
 decided_at timestamptz,
 decision_note text,
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((kind='Add')=(item_id IS NULL)),
 CHECK(kind<>'Add' OR (length(btrim(COALESCE(proposed_title,''))) BETWEEN 5 AND 200 AND length(btrim(COALESCE(proposed_description,'')))>=10 AND proposed_evidence_required IS NOT NULL)),
 CHECK((status='Requested')=(decided_by IS NULL AND decided_at IS NULL AND decision_note IS NULL)),
 CHECK(status='Requested' OR length(btrim(COALESCE(decision_note,'')))>=10),
 CHECK(decided_by IS NULL OR decided_by<>requested_by)
);
CREATE UNIQUE INDEX aup_changes_one_open_remove ON erp_private.aup_scope_changes(item_id) WHERE kind='Remove' AND status='Requested';
CREATE INDEX aup_changes_scope_idx ON erp_private.aup_scope_changes(scope_id,status);
CREATE INDEX aup_changes_library_idx ON erp_private.aup_scope_changes(library_id) WHERE library_id IS NOT NULL;
CREATE INDEX aup_changes_support_idx ON erp_private.aup_scope_changes(supporting_document_id) WHERE supporting_document_id IS NOT NULL;
CREATE INDEX aup_changes_requested_by_idx ON erp_private.aup_scope_changes(requested_by);
CREATE INDEX aup_changes_decided_by_idx ON erp_private.aup_scope_changes(decided_by) WHERE decided_by IS NOT NULL;
ALTER TABLE erp_private.aup_scope_items
 ADD CONSTRAINT aup_items_added_change_fk FOREIGN KEY(added_in_change) REFERENCES erp_private.aup_scope_changes(change_id),
 ADD CONSTRAINT aup_items_removed_change_fk FOREIGN KEY(removed_in_change) REFERENCES erp_private.aup_scope_changes(change_id);
CREATE INDEX aup_changes_item_idx ON erp_private.aup_scope_changes(item_id) WHERE item_id IS NOT NULL;

-- Helpers. They read scope data on behalf of the triggers and policies below.
-- Is this a current document filed on this project? Read with definer rights: document row security hides files from staff who did not upload them.
CREATE FUNCTION erp_private.aup_document_on_project(p_document uuid,p_project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.document_id=p_document AND d.project_id=p_project AND d.deleted_at IS NULL AND d.archived_at IS NULL)
$$;

CREATE FUNCTION erp_private.aup_scope_allowed(p_scope uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT erp_private.project_allowed(s.project_id) FROM erp_private.aup_scopes s WHERE s.scope_id=p_scope),false)
$$;

CREATE FUNCTION erp_private.aup_scope_progress(p_scope uuid)
RETURNS TABLE(total integer,completed integer,exceptions integer,not_applicable integer,open_items integer,unreviewed integer,missing_evidence integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT count(*)::int,
  (count(*) FILTER(WHERE i.exec_status='Completed'))::int,
  (count(*) FILTER(WHERE i.exec_status='Exception'))::int,
  (count(*) FILTER(WHERE i.exec_status='Not applicable'))::int,
  (count(*) FILTER(WHERE i.exec_status IN('Not started','In progress')))::int,
  (count(*) FILTER(WHERE i.exec_status IN('Completed','Exception','Not applicable') AND i.reviewed_by IS NULL))::int,
  (count(*) FILTER(WHERE i.evidence_required AND i.exec_status IN('Completed','Exception')
     AND NOT EXISTS(SELECT 1 FROM erp_private.aup_item_evidence e WHERE e.item_id=i.item_id AND e.removed_at IS NULL)))::int
 FROM erp_private.aup_scope_items i WHERE i.scope_id=p_scope AND i.removed_at IS NULL AND erp_private.aup_scope_allowed(p_scope)
$$;

-- Evidence on a scope with the file names, and the documents on a project that can be attached. Definer rights: document row security hides
-- files from staff who did not upload them, and the team needs to see what is attached. KYC files are never offered as evidence.
CREATE FUNCTION erp_private.aup_evidence_list(p_scope uuid) RETURNS TABLE(evidence_id uuid,item_id uuid,document_id uuid,file_name text,note text,linked_at timestamptz,revision bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT e.evidence_id,e.item_id,e.document_id,d.file_name,e.note,e.linked_at,e.revision
 FROM erp_private.aup_item_evidence e JOIN erp_private.aup_scope_items i ON i.item_id=e.item_id JOIN erp_private.documents d ON d.document_id=e.document_id
 WHERE i.scope_id=p_scope AND e.removed_at IS NULL AND erp_private.aup_scope_allowed(p_scope) ORDER BY e.linked_at
$$;
CREATE FUNCTION erp_private.aup_project_documents(p_project uuid) RETURNS TABLE(document_id uuid,file_name text,category text,uploaded_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT d.document_id,d.file_name,d.category,d.uploaded_at FROM erp_private.documents d
 WHERE d.project_id=p_project AND d.deleted_at IS NULL AND d.archived_at IS NULL AND d.category<>'KYC Pending' AND erp_private.project_allowed(p_project)
 ORDER BY d.uploaded_at DESC LIMIT 200
$$;

-- The report of factual findings for one project, as data. Anyone who may see the project can read it.
-- The standard reference is shown only once a Partner has recorded the Compliance Lead's confirmation of it.
CREATE FUNCTION erp_private.aup_report(p_project uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'project_id',p.project_id,'project_name',p.project_name,'service',sv.service_name,'service_code',p.service_code,
  'client',c.company_name,'client_pin',c.kra_pin,'firm',f.legal_name,
  'scope_state',sc.state,'letter_file',(SELECT d.file_name FROM erp_private.documents d WHERE d.document_id=sc.letter_document_id),
  'letter_reference',sc.letter_reference,'locked_at',sc.locked_at,
  'locked_by',(SELECT m.full_name FROM erp_private.staff_members m WHERE m.staff_id=sc.locked_by),'scope_sha256',sc.scope_sha256,
  'procedures',(SELECT COALESCE(jsonb_agg(jsonb_build_object(
     'seq',i.seq,'title',i.title,'description',i.description,'status',i.exec_status,'finding',i.finding,
     'performed_by',(SELECT m.full_name FROM erp_private.staff_members m WHERE m.staff_id=i.performed_by),
     'performed_on',(i.performed_at AT TIME ZONE 'Africa/Nairobi')::date,
     'reviewed_by',(SELECT m.full_name FROM erp_private.staff_members m WHERE m.staff_id=i.reviewed_by),
     'evidence',(SELECT COALESCE(jsonb_agg(d.file_name ORDER BY e.linked_at),'[]'::jsonb) FROM erp_private.aup_item_evidence e JOIN erp_private.documents d ON d.document_id=e.document_id WHERE e.item_id=i.item_id AND e.removed_at IS NULL)
    ) ORDER BY i.seq),'[]'::jsonb) FROM erp_private.aup_scope_items i WHERE i.scope_id=sc.scope_id AND i.removed_at IS NULL),
  'scope_changes',(SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',ch.kind,'title',COALESCE(ch.proposed_title,(SELECT i2.title FROM erp_private.aup_scope_items i2 WHERE i2.item_id=ch.item_id)),'reason',ch.reason,'decided_on',(ch.decided_at AT TIME ZONE 'Africa/Nairobi')::date) ORDER BY ch.requested_at),'[]'::jsonb)
     FROM erp_private.aup_scope_changes ch WHERE ch.scope_id=sc.scope_id AND ch.status='Approved'),
  'standard',COALESCE((SELECT jsonb_build_object('reference',r.reference,'status',r.rule_status,
        'text',CASE WHEN r.rule_status='Confirmed' THEN r.reference ELSE '[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]' END)
     FROM erp_private.service_references r WHERE r.service_code=p.service_code AND r.reference ILIKE '%ISRS 4400%' AND r.rule_status<>'Retired' ORDER BY (r.rule_status='Confirmed') DESC,r.reference LIMIT 1),
     jsonb_build_object('reference',NULL,'status','Suggested','text','[STANDARD REFERENCE - PENDING COMPLIANCE REVIEW]')),
  'statement','This report sets out the procedures agreed in the engagement letter and the factual findings from performing them. It is not an audit or review and no assurance is expressed. Use of this report is restricted to the parties named in the engagement letter.')
 FROM erp_private.projects p JOIN erp_private.services sv ON sv.service_code=p.service_code JOIN erp_private.clients c ON c.client_id=p.client_id
  JOIN erp_private.firms f ON f.firm_id=p.handling_firm_id JOIN erp_private.aup_scopes sc ON sc.project_id=p.project_id
 WHERE p.project_id=p_project AND p.deleted_at IS NULL AND erp_private.project_allowed(p.project_id)
$$;

-- Guard: the scope.
CREATE FUNCTION erp_private.aup_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_svc text;v_letter uuid;v_n integer;v_p record;v_hash text;v_report jsonb;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 IF TG_OP='INSERT' THEN
  SELECT service_code INTO v_svc FROM erp_private.projects WHERE project_id=NEW.project_id AND deleted_at IS NULL;
  IF v_svc IS NULL OR v_svc NOT IN('ADV-AUP','TAX-KRA') THEN RAISE EXCEPTION 'A procedures scope applies only to Agreed-Upon Procedures and KRA Audit and Dispute Support projects' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER') OR NEW.created_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can start the scope' USING ERRCODE='42501'; END IF;
  IF NEW.state<>'Draft' THEN RAISE EXCEPTION 'A scope starts as a draft' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.project_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.project_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'The project and creator of a scope cannot change' USING ERRCODE='23514'; END IF;
 IF OLD.state='Issued' THEN RAISE EXCEPTION 'The report has been issued; this scope can no longer change' USING ERRCODE='23514'; END IF;
 IF OLD.state='Draft' AND NEW.state='Draft' THEN
  IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the draft scope' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.state='Locked' AND NEW.state='Locked' THEN
  IF ROW(NEW.letter_document_id,NEW.letter_reference,NEW.locked_by,NEW.locked_at,NEW.scope_sha256) IS DISTINCT FROM ROW(OLD.letter_document_id,OLD.letter_reference,OLD.locked_by,OLD.locked_at,OLD.scope_sha256) THEN
   RAISE EXCEPTION 'A locked scope cannot be edited; ask a Partner to approve a scope change' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.state='Draft' AND NEW.state='Locked' THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can lock the scope' USING ERRCODE='42501'; END IF;
  IF v_actor IS NOT NULL AND NEW.locked_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person locking the scope must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF NOT erp_private.project_letter_ok(NEW.project_id) THEN RAISE EXCEPTION 'Upload and verify the signed engagement letter before the scope is locked against it' USING ERRCODE='23514'; END IF;
  SELECT e.signed_letter_id INTO v_letter FROM erp_private.engagement_controls e WHERE e.project_id=NEW.project_id AND e.deleted_at IS NULL;
  NEW.letter_document_id:=v_letter;
  SELECT count(*),encode(sha256(convert_to(COALESCE(string_agg(i.title||E'\n'||i.description||E'\n'||i.evidence_required::text,E'\n--\n' ORDER BY i.seq),''),'UTF8')),'hex')
   INTO v_n,v_hash FROM erp_private.aup_scope_items i WHERE i.scope_id=NEW.scope_id AND i.removed_at IS NULL;
  IF v_n<1 THEN RAISE EXCEPTION 'Add at least one procedure before locking the scope' USING ERRCODE='23514'; END IF;
  NEW.scope_sha256:=v_hash;NEW.locked_at:=now();NEW.locked_by:=COALESCE(v_actor,NEW.locked_by);
  RETURN NEW;
 END IF;
 IF OLD.state='Locked' AND NEW.state='Issued' THEN
  IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can issue the report' USING ERRCODE='42501'; END IF;
  IF v_actor IS NOT NULL AND NEW.report_issued_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person issuing the report must be the signed-in Partner' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.letter_document_id,NEW.letter_reference,NEW.locked_by,NEW.locked_at,NEW.scope_sha256) IS DISTINCT FROM ROW(OLD.letter_document_id,OLD.letter_reference,OLD.locked_by,OLD.locked_at,OLD.scope_sha256) THEN RAISE EXCEPTION 'The lock record cannot change' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_p FROM erp_private.aup_scope_progress(NEW.scope_id);
  IF v_p.total<1 OR v_p.open_items>0 THEN RAISE EXCEPTION 'Every procedure must be performed (Completed, Exception or Not applicable) before the report is issued' USING ERRCODE='23514'; END IF;
  IF v_p.unreviewed>0 THEN RAISE EXCEPTION 'Every procedure result must be reviewed before the report is issued' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM erp_private.aup_scope_changes c WHERE c.scope_id=NEW.scope_id AND c.status='Requested') THEN RAISE EXCEPTION 'Decide the open scope change requests before the report is issued' USING ERRCODE='23514'; END IF;
  v_report:=erp_private.aup_report(NEW.project_id);
  IF v_report IS NULL THEN RAISE EXCEPTION 'The report could not be prepared' USING ERRCODE='23514'; END IF;
  NEW.report_snapshot:=v_report;NEW.report_sha256:=encode(sha256(convert_to(v_report::text,'UTF8')),'hex');NEW.report_issued_at:=now();NEW.report_issued_by:=COALESCE(v_actor,NEW.report_issued_by);
  RETURN NEW;
 END IF;
 RAISE EXCEPTION 'A scope moves only from Draft to Locked and from Locked to Issued' USING ERRCODE='23514';
END $$;
CREATE TRIGGER aup_guard BEFORE INSERT OR UPDATE ON erp_private.aup_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.aup_scope_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aup_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aup_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aup_scopes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('scope_id');

-- Guard: the procedures and their results.
CREATE FUNCTION erp_private.aup_item_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_state text;v_proj uuid;v_pstatus text;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 SELECT s.state,s.project_id INTO v_state,v_proj FROM erp_private.aup_scopes s WHERE s.scope_id=NEW.scope_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'This scope is not available' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.exec_status<>'Not started' OR NEW.finding IS NOT NULL OR NEW.performed_by IS NOT NULL OR NEW.reviewed_by IS NOT NULL OR NEW.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A new procedure starts as Not started' USING ERRCODE='23514'; END IF;
  IF v_state='Issued' THEN RAISE EXCEPTION 'The report has been issued; this scope can no longer change' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER') OR NEW.added_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can add a procedure' USING ERRCODE='42501'; END IF;
  IF v_state='Draft' THEN
   IF NEW.added_in_change IS NOT NULL THEN RAISE EXCEPTION 'Procedures are added directly while the scope is a draft' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.added_in_change IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.aup_scope_changes c WHERE c.change_id=NEW.added_in_change AND c.scope_id=NEW.scope_id AND c.kind='Add' AND c.status='Approved') THEN
    RAISE EXCEPTION 'After the scope is locked, a procedure can be added only through a scope change that a Partner has approved' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM erp_private.aup_scope_items i WHERE i.added_in_change=NEW.added_in_change) THEN RAISE EXCEPTION 'That scope change has already been applied' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.seq IS NULL OR NEW.seq<1 THEN NEW.seq:=COALESCE((SELECT max(i.seq) FROM erp_private.aup_scope_items i WHERE i.scope_id=NEW.scope_id),0)+1; END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.scope_id,NEW.seq,NEW.library_id,NEW.source,NEW.added_by,NEW.added_at,NEW.added_in_change) IS DISTINCT FROM ROW(OLD.scope_id,OLD.seq,OLD.library_id,OLD.source,OLD.added_by,OLD.added_at,OLD.added_in_change) THEN
  RAISE EXCEPTION 'Where a procedure came from cannot change' USING ERRCODE='23514';
 END IF;
 IF v_state='Issued' THEN RAISE EXCEPTION 'The report has been issued; this scope can no longer change' USING ERRCODE='23514'; END IF;
 IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'A removed procedure stays removed' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.title,NEW.description,NEW.evidence_required) IS DISTINCT FROM ROW(OLD.title,OLD.description,OLD.evidence_required) THEN
  IF v_state<>'Draft' THEN RAISE EXCEPTION 'The wording of a locked procedure cannot change; ask a Partner to approve a scope change' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND v_cat NOT IN('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the draft scope' USING ERRCODE='42501'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.removed_at IS NOT NULL THEN
  IF ROW(NEW.exec_status,NEW.finding,NEW.performed_by,NEW.performed_at,NEW.reviewed_by,NEW.reviewed_at) IS DISTINCT FROM ROW(OLD.exec_status,OLD.finding,OLD.performed_by,OLD.performed_at,OLD.reviewed_by,OLD.reviewed_at) THEN RAISE EXCEPTION 'Remove a procedure on its own' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER') OR NEW.removed_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can remove a procedure' USING ERRCODE='42501'; END IF;
  IF v_state='Draft' THEN
   IF NEW.removed_in_change IS NOT NULL THEN RAISE EXCEPTION 'Procedures are removed directly while the scope is a draft' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.removed_in_change IS NULL OR NOT EXISTS(SELECT 1 FROM erp_private.aup_scope_changes c WHERE c.change_id=NEW.removed_in_change AND c.scope_id=NEW.scope_id AND c.kind='Remove' AND c.item_id=OLD.item_id AND c.status='Approved') THEN
    RAISE EXCEPTION 'After the scope is locked, a procedure can be removed only through a scope change that a Partner has approved' USING ERRCODE='23514';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 -- Results.
 IF ROW(NEW.exec_status,NEW.finding,NEW.performed_by,NEW.performed_at,NEW.reviewed_by,NEW.reviewed_at) IS NOT DISTINCT FROM ROW(OLD.exec_status,OLD.finding,OLD.performed_by,OLD.performed_at,OLD.reviewed_by,OLD.reviewed_at) THEN RETURN NEW; END IF;
 IF v_state<>'Locked' THEN RAISE EXCEPTION 'Procedures are performed only after a Partner has locked the scope' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND NOT erp_private.project_allowed(v_proj) THEN RAISE EXCEPTION 'You are not assigned to this project' USING ERRCODE='42501'; END IF;
 SELECT p.status INTO v_pstatus FROM erp_private.projects p WHERE p.project_id=v_proj;
 IF v_pstatus<>'Active' THEN RAISE EXCEPTION 'Activate the engagement before performing procedures' USING ERRCODE='23514'; END IF;
 IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN
  IF ROW(NEW.exec_status,NEW.finding,NEW.performed_by,NEW.performed_at) IS DISTINCT FROM ROW(OLD.exec_status,OLD.finding,OLD.performed_by,OLD.performed_at) THEN RAISE EXCEPTION 'Review a result on its own' USING ERRCODE='23514'; END IF;
  IF NEW.reviewed_by IS NULL THEN RAISE EXCEPTION 'A review is removed by changing the result, not directly' USING ERRCODE='23514'; END IF;
  IF OLD.reviewed_by IS NOT NULL THEN RAISE EXCEPTION 'This result has already been reviewed' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER','SUPERVISOR') OR NEW.reviewed_by<>v_actor) THEN RAISE EXCEPTION 'A Supervisor, Manager or Partner reviews a result' USING ERRCODE='42501'; END IF;
  IF NEW.reviewed_by=OLD.performed_by THEN RAISE EXCEPTION 'The person who performed a procedure cannot review it' USING ERRCODE='42501'; END IF;
  IF OLD.exec_status NOT IN('Completed','Exception','Not applicable') THEN RAISE EXCEPTION 'Only a finished result can be reviewed' USING ERRCODE='23514'; END IF;
  NEW.reviewed_at:=now();
  RETURN NEW;
 END IF;
 IF NEW.exec_status='Not started' THEN RAISE EXCEPTION 'A procedure that has been started cannot go back to Not started' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND NEW.performed_by IS DISTINCT FROM v_actor THEN RAISE EXCEPTION 'The person recording the result must be the signed-in user' USING ERRCODE='42501'; END IF;
 IF NEW.exec_status IN('Exception','Not applicable') AND length(btrim(COALESCE(NEW.finding,'')))<10 THEN RAISE EXCEPTION 'Describe the exception, or the reason it does not apply, in at least 10 characters' USING ERRCODE='23514'; END IF;
 IF NEW.exec_status='Completed' AND length(btrim(COALESCE(NEW.finding,'')))<3 THEN RAISE EXCEPTION 'Record the factual finding' USING ERRCODE='23514'; END IF;
 IF NEW.exec_status IN('Completed','Exception') AND NEW.evidence_required
    AND NOT EXISTS(SELECT 1 FROM erp_private.aup_item_evidence e WHERE e.item_id=NEW.item_id AND e.removed_at IS NULL) THEN
  RAISE EXCEPTION 'Attach the evidence for this procedure before recording the result' USING ERRCODE='23514';
 END IF;
 NEW.performed_at:=now();NEW.reviewed_by:=NULL;NEW.reviewed_at:=NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER aup_guard BEFORE INSERT OR UPDATE ON erp_private.aup_scope_items FOR EACH ROW EXECUTE FUNCTION erp_private.aup_item_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aup_scope_items FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aup_scope_items FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aup_scope_items FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('item_id');

-- Guard: evidence.
CREATE FUNCTION erp_private.aup_evidence_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_state text;v_proj uuid;v_item record;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;
 SELECT i.scope_id,i.removed_at,i.exec_status,i.reviewed_by INTO v_item FROM erp_private.aup_scope_items i WHERE i.item_id=NEW.item_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'This procedure is not available' USING ERRCODE='23514'; END IF;
 SELECT s.state,s.project_id INTO v_state,v_proj FROM erp_private.aup_scopes s WHERE s.scope_id=v_item.scope_id;
 IF v_state<>'Locked' THEN RAISE EXCEPTION 'Evidence is attached only while the scope is locked and open' USING ERRCODE='23514'; END IF;
 IF v_item.removed_at IS NOT NULL THEN RAISE EXCEPTION 'This procedure has been removed' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND NOT erp_private.project_allowed(v_proj) THEN RAISE EXCEPTION 'You are not assigned to this project' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF v_actor IS NOT NULL AND NEW.linked_by<>v_actor THEN RAISE EXCEPTION 'The person attaching evidence must be the signed-in user' USING ERRCODE='42501'; END IF;
  IF NEW.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Attach evidence as current' USING ERRCODE='23514'; END IF;
  IF NOT erp_private.aup_document_on_project(NEW.document_id,v_proj) THEN
   RAISE EXCEPTION 'Evidence must be a current document filed on this project' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.item_id,NEW.document_id,NEW.note,NEW.linked_by,NEW.linked_at) IS DISTINCT FROM ROW(OLD.item_id,OLD.document_id,OLD.note,OLD.linked_by,OLD.linked_at) THEN RAISE EXCEPTION 'Evidence cannot be edited; remove it and attach the correct document' USING ERRCODE='23514'; END IF;
 IF OLD.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Removed evidence stays removed' USING ERRCODE='23514'; END IF;
 IF NEW.removed_at IS NOT NULL THEN
  IF v_actor IS NOT NULL AND NEW.removed_by<>v_actor THEN RAISE EXCEPTION 'The person removing evidence must be the signed-in user' USING ERRCODE='42501'; END IF;
  IF v_item.exec_status IN('Completed','Exception') THEN RAISE EXCEPTION 'Reopen the procedure (set it to In progress) before removing its evidence' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aup_guard BEFORE INSERT OR UPDATE ON erp_private.aup_item_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.aup_evidence_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aup_item_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aup_item_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aup_item_evidence FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('evidence_id');

-- Guard: scope changes.
CREATE FUNCTION erp_private.aup_change_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE v_actor uuid;v_cat text;v_state text;v_proj uuid;v_item record;
BEGIN
 v_actor:=(erp_private.actor()).staff_id;v_cat:=(erp_private.actor()).category_code;
 SELECT s.state,s.project_id INTO v_state,v_proj FROM erp_private.aup_scopes s WHERE s.scope_id=NEW.scope_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'This scope is not available' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF v_state<>'Locked' THEN RAISE EXCEPTION 'A scope change is requested only while the scope is locked; a draft scope is edited directly' USING ERRCODE='23514'; END IF;
  IF v_actor IS NOT NULL AND (v_cat NOT IN('PARTNER','MANAGER') OR NEW.requested_by<>v_actor) THEN RAISE EXCEPTION 'Only a Manager or Partner can request a scope change' USING ERRCODE='42501'; END IF;
  IF NEW.status<>'Requested' THEN RAISE EXCEPTION 'A scope change starts as Requested' USING ERRCODE='23514'; END IF;
  IF NEW.kind='Remove' THEN
   SELECT i.scope_id,i.removed_at INTO v_item FROM erp_private.aup_scope_items i WHERE i.item_id=NEW.item_id;
   IF NOT FOUND OR v_item.scope_id<>NEW.scope_id OR v_item.removed_at IS NOT NULL THEN RAISE EXCEPTION 'Choose a procedure that is currently in this scope' USING ERRCODE='23514'; END IF;
  END IF;
  IF NEW.supporting_document_id IS NOT NULL AND NOT erp_private.aup_document_on_project(NEW.supporting_document_id,v_proj) THEN
   RAISE EXCEPTION 'The supporting document must be filed on this project' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF ROW(NEW.scope_id,NEW.kind,NEW.item_id,NEW.library_id,NEW.proposed_title,NEW.proposed_description,NEW.proposed_evidence_required,NEW.reason,NEW.supporting_document_id,NEW.requested_by,NEW.requested_at)
    IS DISTINCT FROM ROW(OLD.scope_id,OLD.kind,OLD.item_id,OLD.library_id,OLD.proposed_title,OLD.proposed_description,OLD.proposed_evidence_required,OLD.reason,OLD.supporting_document_id,OLD.requested_by,OLD.requested_at) THEN
  RAISE EXCEPTION 'A scope change request cannot be edited' USING ERRCODE='23514';
 END IF;
 IF OLD.status<>'Requested' THEN RAISE EXCEPTION 'This request has already been decided' USING ERRCODE='23514'; END IF;
 IF v_state<>'Locked' THEN RAISE EXCEPTION 'The scope is no longer open to changes' USING ERRCODE='23514'; END IF;
 IF v_actor IS NOT NULL AND v_cat<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can decide a scope change' USING ERRCODE='42501'; END IF;
 IF v_actor IS NOT NULL AND (NEW.decided_by IS DISTINCT FROM v_actor OR v_actor=OLD.requested_by) THEN RAISE EXCEPTION 'A scope change must be decided by a Partner other than the person who requested it' USING ERRCODE='42501'; END IF;
 NEW.decided_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER aup_guard BEFORE INSERT OR UPDATE ON erp_private.aup_scope_changes FOR EACH ROW EXECUTE FUNCTION erp_private.aup_change_guard();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.aup_scope_changes FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.aup_scope_changes FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.aup_scope_changes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('change_id');

-- Row security. Reading follows the project; the guards above decide who may do what.
ALTER TABLE erp_private.aup_scopes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aup_scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aup_scope_items ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aup_scope_items FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aup_item_evidence ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aup_item_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE erp_private.aup_scope_changes ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.aup_scope_changes FORCE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE ON erp_private.aup_scopes,erp_private.aup_scope_items,erp_private.aup_item_evidence,erp_private.aup_scope_changes TO erp_api;
CREATE POLICY aup_scopes_read ON erp_private.aup_scopes FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id));
CREATE POLICY aup_scopes_add ON erp_private.aup_scopes FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id) AND created_by=(erp_private.actor()).staff_id);
CREATE POLICY aup_scopes_update ON erp_private.aup_scopes FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.project_allowed(project_id)) WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY aup_items_read ON erp_private.aup_scope_items FOR SELECT TO erp_api USING(erp_private.aup_scope_allowed(scope_id));
CREATE POLICY aup_items_add ON erp_private.aup_scope_items FOR INSERT TO erp_api WITH CHECK(erp_private.aup_scope_allowed(scope_id));
CREATE POLICY aup_items_update ON erp_private.aup_scope_items FOR UPDATE TO erp_api USING(erp_private.aup_scope_allowed(scope_id)) WITH CHECK(erp_private.aup_scope_allowed(scope_id));
CREATE POLICY aup_evidence_read ON erp_private.aup_item_evidence FOR SELECT TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.aup_scope_items i WHERE i.item_id=aup_item_evidence.item_id AND erp_private.aup_scope_allowed(i.scope_id)));
CREATE POLICY aup_evidence_add ON erp_private.aup_item_evidence FOR INSERT TO erp_api WITH CHECK(EXISTS(SELECT 1 FROM erp_private.aup_scope_items i WHERE i.item_id=aup_item_evidence.item_id AND erp_private.aup_scope_allowed(i.scope_id)));
CREATE POLICY aup_evidence_update ON erp_private.aup_item_evidence FOR UPDATE TO erp_api USING(EXISTS(SELECT 1 FROM erp_private.aup_scope_items i WHERE i.item_id=aup_item_evidence.item_id AND erp_private.aup_scope_allowed(i.scope_id))) WITH CHECK(EXISTS(SELECT 1 FROM erp_private.aup_scope_items i WHERE i.item_id=aup_item_evidence.item_id AND erp_private.aup_scope_allowed(i.scope_id)));
CREATE POLICY aup_changes_read ON erp_private.aup_scope_changes FOR SELECT TO erp_api USING(erp_private.aup_scope_allowed(scope_id));
CREATE POLICY aup_changes_add ON erp_private.aup_scope_changes FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND erp_private.aup_scope_allowed(scope_id));
CREATE POLICY aup_changes_update ON erp_private.aup_scope_changes FOR UPDATE TO erp_api USING(erp_private.is_leader() AND erp_private.aup_scope_allowed(scope_id)) WITH CHECK(erp_private.is_leader() AND erp_private.aup_scope_allowed(scope_id));

-- Counts for the go-live checks (Manager or Partner only).
CREATE FUNCTION erp_private.aup_counts() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object(
  'aup_projects_scope_not_locked',(SELECT count(*) FROM erp_private.projects p WHERE p.status='Active' AND p.deleted_at IS NULL AND p.service_code IN('ADV-AUP','TAX-KRA') AND erp_private.is_leader()
     AND NOT EXISTS(SELECT 1 FROM erp_private.aup_scopes s WHERE s.project_id=p.project_id AND s.state IN('Locked','Issued'))),
  'aup_changes_requested',(SELECT count(*) FROM erp_private.aup_scope_changes c WHERE c.status='Requested' AND erp_private.is_leader()),
  'aup_results_unreviewed',(SELECT count(*) FROM erp_private.aup_scope_items i JOIN erp_private.aup_scopes s ON s.scope_id=i.scope_id WHERE s.state='Locked' AND i.removed_at IS NULL AND i.exec_status IN('Completed','Exception','Not applicable') AND i.reviewed_by IS NULL AND erp_private.is_leader()),
  'aup_library_unconfirmed',(SELECT count(*) FROM erp_private.aup_procedure_library l WHERE l.rule_status='Suggested' AND erp_private.is_leader()))
$$;

-- The file checklist now carries two procedures checks for the two services.
ALTER TABLE erp_private.service_checklist_items DROP CONSTRAINT service_checklist_items_record_check_check;
ALTER TABLE erp_private.service_checklist_items ADD CONSTRAINT service_checklist_items_record_check_check
 CHECK(record_check IN('KYC_VERIFIED','LETTER_VERIFIED','FEE_AGREED','TEAM_ASSIGNED','AUP_SCOPE_LOCKED','AUP_REPORT_ISSUED'));
INSERT INTO erp_private.service_checklist_items(service_code,item_key,stage,label,check_kind,record_check,required,sort_order,note) VALUES
 ('ADV-AUP','scope_locked','Execution','Procedures scope locked against the signed letter','Record','AUP_SCOPE_LOCKED',true,45,''),
 ('ADV-AUP','report_issued','Issue','Report of factual findings issued','Record','AUP_REPORT_ISSUED',true,58,''),
 ('TAX-KRA','scope_locked','Execution','Procedures scope locked against the signed letter','Record','AUP_SCOPE_LOCKED',true,45,''),
 ('TAX-KRA','report_issued','Issue','Report of factual findings issued','Record','AUP_REPORT_ISSUED',true,58,'');
CREATE OR REPLACE FUNCTION erp_private.project_file_checklist(p_project uuid)
RETURNS TABLE(item_key text,stage text,label text,check_kind text,required boolean,present boolean,sort_order integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT i.item_key,i.stage,i.label,i.check_kind,i.required,
  CASE i.record_check
   WHEN 'KYC_VERIFIED' THEN EXISTS(SELECT 1 FROM erp_private.client_compliance k WHERE k.client_id=p.client_id AND k.verified_by IS NOT NULL AND k.review_due IS NOT NULL AND k.review_due>=(now() AT TIME ZONE 'Africa/Nairobi')::date)
   WHEN 'LETTER_VERIFIED' THEN erp_private.project_letter_ok(p.project_id)
   WHEN 'FEE_AGREED' THEN EXISTS(SELECT 1 FROM erp_private.project_budgets b WHERE b.project_id=p.project_id AND b.agreed_fee>0)
                       OR EXISTS(SELECT 1 FROM erp_private.recurring_fee_schedules f WHERE f.project_id=p.project_id AND f.status='Active')
   WHEN 'TEAM_ASSIGNED' THEN EXISTS(SELECT 1 FROM erp_private.project_assignments a WHERE a.project_id=p.project_id AND a.deleted_at IS NULL)
   WHEN 'AUP_SCOPE_LOCKED' THEN EXISTS(SELECT 1 FROM erp_private.aup_scopes s WHERE s.project_id=p.project_id AND s.state IN('Locked','Issued'))
   WHEN 'AUP_REPORT_ISSUED' THEN EXISTS(SELECT 1 FROM erp_private.aup_scopes s WHERE s.project_id=p.project_id AND s.state='Issued')
   ELSE EXISTS(SELECT 1 FROM erp_private.documents d WHERE d.project_id=p.project_id AND d.category=i.document_category AND d.deleted_at IS NULL AND d.archived_at IS NULL)
  END,i.sort_order
 FROM erp_private.projects p JOIN erp_private.service_checklist_items i ON i.service_code=p.service_code AND i.rule_status<>'Retired'
 WHERE p.project_id=p_project AND p.deleted_at IS NULL AND erp_private.project_allowed(p.project_id)
 ORDER BY i.sort_order,i.item_key
$$;

-- The service profiles now say what is built.
UPDATE erp_private.service_profiles SET engine_state='Built',note='Library, draft scope, Partner lock against the signed letter, scope changes, execution with an evidence gate, review and the report of factual findings are built.' WHERE service_code='ADV-AUP';
UPDATE erp_private.service_profiles SET engine_state='Partly built',note='Staff create the project from the template and amend the scope to the notice and the engagement letter. The procedures engine is built. The notice log, the task and the non-compliance flags are not built yet.' WHERE service_code='TAX-KRA';

REVOKE EXECUTE ON FUNCTION erp_private.aup_library_guard(),erp_private.aup_scope_guard(),erp_private.aup_item_guard(),erp_private.aup_evidence_guard(),erp_private.aup_change_guard(),
 erp_private.aup_document_on_project(uuid,uuid),erp_private.aup_scope_allowed(uuid),erp_private.aup_scope_progress(uuid),erp_private.aup_evidence_list(uuid),erp_private.aup_project_documents(uuid),erp_private.aup_report(uuid),erp_private.aup_counts() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.aup_document_on_project(uuid,uuid),erp_private.aup_scope_allowed(uuid),erp_private.aup_scope_progress(uuid),erp_private.aup_evidence_list(uuid),erp_private.aup_project_documents(uuid),erp_private.aup_report(uuid),erp_private.aup_counts() TO erp_api;
