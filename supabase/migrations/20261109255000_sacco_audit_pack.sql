-- Audit build S6: SACCO audit pack.
--  1. Audit programme: a versioned library of procedures. A Partner approves a version; a file adopts an approved version (the steps are copied
--     onto the file), one person performs each step (or marks it not applicable with the reason) and a Manager or Partner who did not perform it reviews.
--  2. Compliance register: a firm list of legal and regulatory requirements (each can point at the S2 legal reference), approved by a Partner.
--     On a file, each item is assessed (complied, not complied, not applicable), given a reporting effect, and reviewed by someone else.
--  3. Matters communicated to those charged with governance, and key audit matter (KAM) decisions. A KAM can only be drafted from a matter that was
--     communicated (it is linked to it). No list of KAMs is preset. Only a Partner decides whether a matter is a KAM.
--  4. Two new report kinds: "Statutory report to regulator" and "Key audit matters". Both are approved by a Partner only. The statutory report assembles
--     the file's facts (ratios, compliance results, section-10 matters, the s44 calendar wording) and carries the Partner's own written conclusion.
--     The system does not state the legal test and does not compute a due date until a Partner has confirmed the rule (S2).
-- Everything seeded is a DRAFT or PROPOSED row for a Partner to read. Nothing here holds a SASRA figure or percentage.

-- ---- Programme library --------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.audit_programmes (
 programme_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 code text NOT NULL CHECK(code ~ '^[A-Z0-9][A-Z0-9_-]{2,30}$'),
 version integer NOT NULL CHECK(version>0),
 title text NOT NULL CHECK(length(btrim(title))>=5),
 applies_to text[] NOT NULL DEFAULT ARRAY['ALL_SACCO']::text[] CHECK(applies_to <@ ARRAY['DT_SACCO','NWDT_SACCO','ALL_SACCO']::text[] AND cardinality(applies_to)>0),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Superseded')),
 source_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 approval_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 UNIQUE(code,version),
 CHECK(status='Draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(approval_note))>=10))
);
CREATE UNIQUE INDEX audit_programmes_one_draft ON erp_private.audit_programmes(code) WHERE status='Draft';
CREATE UNIQUE INDEX audit_programmes_one_approved ON erp_private.audit_programmes(code) WHERE status='Approved';
CREATE INDEX audit_programmes_created_idx ON erp_private.audit_programmes(created_by);
CREATE INDEX audit_programmes_approved_idx ON erp_private.audit_programmes(approved_by);

CREATE TABLE erp_private.audit_programme_steps (
 programme_id uuid NOT NULL REFERENCES erp_private.audit_programmes,
 step_code text NOT NULL CHECK(step_code ~ '^[A-Z]{1,3}\.[A-Z0-9_]{2,30}$'),
 audit_area text NOT NULL CHECK(length(btrim(audit_area))>=2),
 assertion text NOT NULL CHECK(length(btrim(assertion))>=3),
 procedure text NOT NULL CHECK(length(btrim(procedure))>=20),
 required boolean NOT NULL DEFAULT true,
 reference_id uuid REFERENCES erp_private.legal_references,
 sort_order integer NOT NULL,
 PRIMARY KEY(programme_id,step_code)
);
CREATE INDEX audit_programme_steps_ref_idx ON erp_private.audit_programme_steps(reference_id);

-- The steps as adopted on one file. The wording is copied, so a later programme version never changes a file's working papers.
CREATE TABLE erp_private.audit_file_steps (
 file_step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 programme_id uuid NOT NULL REFERENCES erp_private.audit_programmes,
 step_code text NOT NULL,
 audit_area text NOT NULL,
 assertion text NOT NULL,
 procedure text NOT NULL,
 required boolean NOT NULL DEFAULT true,
 sort_order integer NOT NULL,
 status text NOT NULL DEFAULT 'Not started' CHECK(status IN('Not started','Prepared','Reviewed','Returned')),
 applicable boolean NOT NULL DEFAULT true,
 result_note text NOT NULL DEFAULT '',
 audit_workpaper_id uuid REFERENCES erp_private.audit_workpapers,
 prepared_by uuid REFERENCES erp_private.staff_members,
 prepared_at timestamptz,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,programme_id,step_code),
 CHECK(status='Not started' OR (prepared_by IS NOT NULL AND prepared_at IS NOT NULL AND length(btrim(result_note))>=10)),
 CHECK(status NOT IN('Reviewed') OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by)),
 CHECK(status<>'Returned' OR length(btrim(review_note))>=5)
);
CREATE INDEX audit_file_steps_project_idx ON erp_private.audit_file_steps(project_id,audit_file_id,handling_firm_id);
CREATE INDEX audit_file_steps_prog_idx ON erp_private.audit_file_steps(programme_id);
CREATE INDEX audit_file_steps_wp_idx ON erp_private.audit_file_steps(audit_workpaper_id);
CREATE INDEX audit_file_steps_prep_idx ON erp_private.audit_file_steps(prepared_by);
CREATE INDEX audit_file_steps_rev_idx ON erp_private.audit_file_steps(reviewer_id);

-- ---- Compliance register ------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.audit_compliance_items (
 item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 item_code text NOT NULL UNIQUE CHECK(item_code ~ '^[A-Z0-9][A-Z0-9_.-]{2,40}$'),
 title text NOT NULL CHECK(length(btrim(title))>=5),
 requirement text NOT NULL CHECK(length(btrim(requirement))>=10),
 citation text NOT NULL DEFAULT '',
 reference_id uuid REFERENCES erp_private.legal_references,
 applies_to text[] NOT NULL DEFAULT ARRAY['ALL_SACCO']::text[] CHECK(applies_to <@ ARRAY['DT_SACCO','NWDT_SACCO','ALL_SACCO']::text[] AND cardinality(applies_to)>0),
 nature text NOT NULL CHECK(nature IN('Audit reporting matter','Governance - not audit reporting','AML/CFT/CPF','Regulatory return','Other')),
 sort_order integer NOT NULL DEFAULT 100,
 status text NOT NULL DEFAULT 'Proposed' CHECK(status IN('Proposed','Approved')),
 created_by uuid REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 approval_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK((status='Approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(approval_note))>=10) OR (status='Proposed' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX audit_compliance_items_ref_idx ON erp_private.audit_compliance_items(reference_id);
CREATE INDEX audit_compliance_items_created_idx ON erp_private.audit_compliance_items(created_by);
CREATE INDEX audit_compliance_items_approved_idx ON erp_private.audit_compliance_items(approved_by);

CREATE TABLE erp_private.audit_file_compliance (
 compliance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 item_id uuid NOT NULL REFERENCES erp_private.audit_compliance_items,
 status text NOT NULL DEFAULT 'Not started' CHECK(status IN('Not started','Prepared','Reviewed','Returned')),
 result text CHECK(result IN('Complied','Not complied','Not applicable')),
 reporting_effect text NOT NULL DEFAULT 'None' CHECK(reporting_effect IN('None','Management letter','Statutory report','Matter for those charged with governance')),
 note text NOT NULL DEFAULT '',
 prepared_by uuid REFERENCES erp_private.staff_members,
 prepared_at timestamptz,
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,item_id),
 CHECK(status='Not started' OR (result IS NOT NULL AND prepared_by IS NOT NULL AND prepared_at IS NOT NULL AND length(btrim(note))>=10)),
 CHECK(result IS DISTINCT FROM 'Not complied' OR (reporting_effect<>'None' AND length(btrim(note))>=20)),
 CHECK(status<>'Reviewed' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by)),
 CHECK(status<>'Returned' OR length(btrim(review_note))>=5)
);
CREATE INDEX audit_file_compliance_project_idx ON erp_private.audit_file_compliance(project_id,audit_file_id,handling_firm_id);
CREATE INDEX audit_file_compliance_item_idx ON erp_private.audit_file_compliance(item_id);
CREATE INDEX audit_file_compliance_prep_idx ON erp_private.audit_file_compliance(prepared_by);
CREATE INDEX audit_file_compliance_rev_idx ON erp_private.audit_file_compliance(reviewer_id);

-- ---- Matters communicated to those charged with governance, and KAM decisions ------------------------------------------------------
CREATE TABLE erp_private.audit_tcwg_matters (
 matter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 matter_seq integer NOT NULL CHECK(matter_seq>0),
 matter_ref text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title))>=5),
 description text NOT NULL CHECK(length(btrim(description))>=20),
 communicated_on date NOT NULL,
 method text NOT NULL CHECK(method IN('Meeting','Letter','Email','Written report')),
 communicated_to text NOT NULL CHECK(length(btrim(communicated_to))>=3),
 response text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Withdrawn')),
 withdraw_note text NOT NULL DEFAULT '',
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,matter_seq),
 CHECK(status<>'Withdrawn' OR length(btrim(withdraw_note))>=10)
);
CREATE INDEX audit_tcwg_matters_project_idx ON erp_private.audit_tcwg_matters(project_id,audit_file_id,handling_firm_id);
CREATE INDEX audit_tcwg_matters_by_idx ON erp_private.audit_tcwg_matters(created_by);

CREATE TABLE erp_private.audit_kam_decisions (
 matter_id uuid PRIMARY KEY REFERENCES erp_private.audit_tcwg_matters,
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('KAM','Not a KAM')),
 significance_note text NOT NULL CHECK(length(btrim(significance_note))>=20),
 heading text NOT NULL DEFAULT '',
 how_addressed text NOT NULL DEFAULT '',
 draft_text text NOT NULL DEFAULT '',
 matter_revision bigint NOT NULL,
 decided_by uuid NOT NULL REFERENCES erp_private.staff_members,
 decided_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 CHECK(decision<>'KAM' OR (length(btrim(heading))>=5 AND length(btrim(how_addressed))>=20 AND length(btrim(draft_text))>=40))
);
CREATE INDEX audit_kam_decisions_project_idx ON erp_private.audit_kam_decisions(project_id,audit_file_id,handling_firm_id);
CREATE INDEX audit_kam_decisions_by_idx ON erp_private.audit_kam_decisions(decided_by);

-- ---- Row security: read through the API, write only through the functions below ---------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_programmes','audit_programme_steps','audit_file_steps','audit_compliance_items','audit_file_compliance','audit_tcwg_matters','audit_kam_decisions'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
 END LOOP;
END $$;
CREATE POLICY audit_programmes_read ON erp_private.audit_programmes FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_programme_steps_read ON erp_private.audit_programme_steps FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_compliance_items_read ON erp_private.audit_compliance_items FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_file_steps_read ON erp_private.audit_file_steps FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_file_compliance_read ON erp_private.audit_file_compliance FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_tcwg_matters_read ON erp_private.audit_tcwg_matters FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_kam_decisions_read ON erp_private.audit_kam_decisions FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['audit_programmes','audit_file_steps','audit_compliance_items','audit_file_compliance','audit_tcwg_matters','audit_kam_decisions'] LOOP
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',t);
  EXECUTE format('CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',t);
 END LOOP;
END $$;
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_programmes FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('programme_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_file_steps FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('file_step_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_compliance_items FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('item_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_file_compliance FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('compliance_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_tcwg_matters FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('matter_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.audit_kam_decisions FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('matter_id');

-- An approved or superseded programme never changes, except that an approved one becomes superseded. Steps change only while their programme is a draft.
CREATE FUNCTION erp_private.audit_programme_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status<>'Draft' THEN
  IF NOT (OLD.status='Approved' AND NEW.status='Superseded' AND NEW.version=OLD.version AND NEW.code=OLD.code AND NEW.title=OLD.title AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by) THEN
   RAISE EXCEPTION 'An approved programme cannot be changed. Copy it to a new draft version' USING ERRCODE='23514'; END IF;
 ELSIF NEW.version<>OLD.version OR NEW.code<>OLD.code THEN RAISE EXCEPTION 'The code and version of a programme cannot change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER programme_guard BEFORE UPDATE ON erp_private.audit_programmes FOR EACH ROW EXECUTE FUNCTION erp_private.audit_programme_guard();

CREATE FUNCTION erp_private.audit_programme_step_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE pid uuid;st text;
BEGIN
 pid:=CASE WHEN TG_OP='DELETE' THEN OLD.programme_id ELSE NEW.programme_id END;
 SELECT status INTO st FROM erp_private.audit_programmes WHERE programme_id=pid;
 IF st IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Only a draft programme can be changed. Copy the approved programme to a new draft version' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER programme_step_guard BEFORE INSERT OR UPDATE OR DELETE ON erp_private.audit_programme_steps FOR EACH ROW EXECUTE FUNCTION erp_private.audit_programme_step_guard();

-- ---- Policy: is the statutory report to the regulator required? ------------------------------------------------------------------------
ALTER TABLE erp_private.system_settings ADD CONSTRAINT system_settings_dt_statutory CHECK(key<>'SACCO_DT_REQUIRES_STATUTORY_REPORT' OR value IN('true','false'));
INSERT INTO erp_private.system_settings(key,value,note) VALUES
 ('SACCO_DT_REQUIRES_STATUTORY_REPORT','true','Default. A deposit-taking SACCO file needs an approved statutory report to the regulator before final sign-off. A Partner confirms.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION erp_private.audit_policy_save(p_key text,p_value text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can set firm audit policy' USING ERRCODE='42501'; END IF;
 IF p_key NOT IN('AUDIT_FILE_LOCK_DAYS','AUDIT_FILE_LOCK_ANCHOR','SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT') THEN RAISE EXCEPTION 'Unknown policy setting' USING ERRCODE='22023'; END IF;
 IF p_key='AUDIT_FILE_LOCK_DAYS' AND NOT (btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' AND CASE WHEN btrim(COALESCE(p_value,'')) ~ '^[0-9]{1,3}$' THEN btrim(p_value)::integer BETWEEN 1 AND 365 ELSE false END) THEN RAISE EXCEPTION 'Enter the number of days, from 1 to 365' USING ERRCODE='23514'; END IF;
 IF p_key='AUDIT_FILE_LOCK_ANCHOR' AND btrim(COALESCE(p_value,'')) NOT IN('REPORT_DATE','YEAR_END') THEN RAISE EXCEPTION 'Choose the audit report date or the financial year end' USING ERRCODE='23514'; END IF;
 IF p_key IN('SACCO_DT_REQUIRES_EQCR','SACCO_DT_REQUIRES_STATUTORY_REPORT') AND btrim(COALESCE(p_value,'')) NOT IN('true','false') THEN RAISE EXCEPTION 'Choose yes or no' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.system_settings SET value=btrim(p_value),note=btrim(p_note),updated_by=a.staff_id WHERE key=p_key;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.pack_statutory_required(p_file uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT erp_private.client_sacco_type(f.client_id)='DT_SACCO' FROM erp_private.audit_files f WHERE f.audit_file_id=p_file),false)
  AND COALESCE((SELECT value='true' FROM erp_private.system_settings WHERE key='SACCO_DT_REQUIRES_STATUTORY_REPORT'),true);
$$;

-- ---- Draft programme, version 1, and proposed compliance items (need Partner approval) -------------------------------------------------
INSERT INTO erp_private.audit_programmes(code,version,title,applies_to,status,source_note)
VALUES('SACCO-STD',1,'SACCO audit programme, version 1','{ALL_SACCO}','Draft','Draft prepared from the usual areas of a SACCO audit and the section-10 list in the legal report. It names no regulatory percentage or amount: where a step needs a regulatory rule, it says to use the rule a Partner has confirmed. A Partner must read every step before approving it.');

INSERT INTO erp_private.audit_programme_steps(programme_id,step_code,audit_area,assertion,procedure,required,sort_order)
SELECT (SELECT programme_id FROM erp_private.audit_programmes WHERE code='SACCO-STD' AND version=1),v.c,v.area,v.asr,v.proc,true,v.ord
FROM (VALUES
 ('P.UNDERSTAND','Planning','Understanding','Read the by-laws, the regulator''s licence or registration position, correspondence with the regulator, any inspection findings and last year''s management letter. Record how each affects the audit plan and the risk register.',10),
 ('P.GOVERN','Governance','Completeness','Read the minutes of the board, credit committee, supervisory committee and general meetings for the year. List every decision that affects the accounts (loans approved, dividends, write-offs, policy changes) and agree each to the records.',20),
 ('P.FRAUD','Fraud and irregularity','Occurrence','Make the fraud and irregularity inquiries of management, the board and the supervisory committee. Record the answers and the risks that follow in the risk register.',30),
 ('P.LAWS','Laws and regulations','Compliance','Complete the compliance register for this file. Raise each not-complied item with the reporting effect chosen and communicate it to those charged with governance.',40),
 ('P.RELATED','Related parties','Presentation','Obtain the list of directors, committee members, management and staff. Identify their loans, deposits and other dealings with the SACCO. Test approval, terms and disclosure.',50),
 ('L.LEDGER','Loans to members','Completeness','Agree the loan ledger population (reconciled in the populations tab) to the general ledger. Investigate and explain every difference.',60),
 ('L.EXIST','Loans to members','Existence','Select a sample of loans. Vouch the application, approval, disbursement, member identity and security. Confirm balances with members where practical.',70),
 ('L.CLASS','Loans to members','Valuation','Re-perform the age classification of loans using the provisioning rules a Partner has confirmed for this SACCO type and year. If the rules are not yet confirmed, stop and ask the Partner.',80),
 ('L.ECL','Loans to members','Valuation','Compare the expected credit loss allowance with the prudential provision (see the section-10 item on the SACCO statements tab). Record the difference and how the Partner has decided it is treated.',90),
 ('L.INCOME','Loans to members','Occurrence','Recompute interest income on a sample of loans. Review interest in suspense and the basis on which interest stops accruing.',100),
 ('L.WRITEOFF','Loans to members','Rights and obligations','Check that recoveries and write-offs were approved by the person or committee with authority, and that written-off loans are tracked.',110),
 ('D.LEDGER','Member deposits and shares','Completeness','Agree the member deposit and share ledger population to the general ledger and to the member statistics. Investigate every difference.',120),
 ('D.CONFIRM','Member deposits and shares','Existence','Confirm a sample of member balances, test cut-off at the year end and review dormant and inactive accounts.',130),
 ('D.CLASS','Member deposits and shares','Presentation','Check how deposits and shares are classified (withdrawable or not) against the by-laws and the accounting framework used. Record the conclusion.',140),
 ('D.DIVIDEND','Member deposits and shares','Accuracy','Recompute dividend and interest on deposits. Agree to the general-meeting approval and to the reserves and dividend rules a Partner has confirmed. Do not use a rule that is not confirmed.',150),
 ('B.CASH','Cash and bank','Existence','Obtain bank confirmations, test the year-end bank reconciliations and check cut-off. Review cash on hand counts.',160),
 ('I.INVEST','Investments','Existence','Confirm investments with custodians or issuers, agree to certificates and test the valuation basis.',170),
 ('A.PPE','Property and equipment','Existence','Test additions and disposals, depreciation and title documents. Inspect a sample of assets.',180),
 ('A.LIABS','Payables and borrowings','Completeness','Search for unrecorded liabilities. Agree borrowings to lender confirmations and check covenant compliance.',190),
 ('R.EXPENSES','Income and expenses','Occurrence','Perform analytical procedures on income and expenses. Test a sample of expenditure for approval and for correct period.',200),
 ('C.RATIOS','Capital and liquidity','Accuracy','Recompute the prudential figures entered on the SASRA tab from the trial balance and statements. Check them against the definitions a Partner has confirmed. Report any breach to the Partner.',210),
 ('C.RESERVES','Capital and liquidity','Accuracy','Reconcile the movement in every reserve (statement of changes in equity) and check that transfers are authorised and net to zero.',220),
 ('C.AML','AML/CFT/CPF','Compliance','Inspect the SACCO''s policies, officer appointments, training and reporting of suspicious transactions. Record any gap in the compliance register.',230),
 ('G.GOINGCONCERN','Completion','Presentation','Assess going concern, including capital, liquidity and the regulator''s requirements. Record the conclusion and any communication with those charged with governance.',240),
 ('G.SUBSEQUENT','Completion','Completeness','Review events after the year end up to the date of the report. Record any adjusting or disclosing event.',250),
 ('G.REPRESENT','Completion','Understanding','Obtain management''s written representations (representation letter) and follow up any matter management declines to confirm.',260)
) v(c,area,asr,proc,ord)
;

INSERT INTO erp_private.audit_compliance_items(item_code,title,requirement,citation,reference_id,applies_to,nature,sort_order)
SELECT v.c,v.t,v.r,v.cit,(SELECT ref_id FROM erp_private.legal_references WHERE ref_code=v.ref),v.ap::text[],v.n,v.ord
FROM (VALUES
 ('SACCO-S7A','Anti-money-laundering, terrorism-financing and proliferation-financing duties (s 7A)','The SACCO meets its AML/CFT/CPF duties, as cited in the legal verification report. Check the duties against the primary text before relying on this item.','Sacco Societies Act, s 7A (as cited; not independently verified)','SACCO-ACT-2008','{ALL_SACCO}','AML/CFT/CPF',10),
 ('SACCO-S7B','Anti-money-laundering, terrorism-financing and proliferation-financing duties (s 7B)','The SACCO meets its AML/CFT/CPF duties, as cited in the legal verification report. Check the duties against the primary text before relying on this item.','Sacco Societies Act, s 7B (as cited; not independently verified)','SACCO-ACT-2008','{ALL_SACCO}','AML/CFT/CPF',20),
 ('REG-65-2','Code of conduct (regulation 65(2) and Third Schedule)','Governance rules for directors and officers. The legal report treats this as governance, not as an audit reporting duty. Record the result; the reporting effect is normally none unless a Partner decides otherwise.','Regulation 65(2) and Third Schedule, as cited','SACCO-DT-REG-2010','{DT_SACCO}','Governance - not audit reporting',30),
 ('SACCO-S64B','Accuracy of regulatory returns (s 64(b))','Management is responsible for the accuracy of returns made to the regulator. The legal report says this is not an automatic auditor certification. Record what was checked.','Sacco Societies Act, s 64(b), as cited','SACCO-ACT-2008','{ALL_SACCO}','Regulatory return',40),
 ('SACCO-AUDITDATE','Audit and submission to the regulator by the reported date','The audited accounts are completed and submitted by the date the legal report gives (ss 40(4), 41(1), reg 55(1)). Whether this is a fixed date is for a Partner to settle in the calendar.','Ss 40(4), 41(1); reg 55(1), as cited','SACCO-ACT-2008','{ALL_SACCO}','Audit reporting matter',50),
 ('SACCO-AGM','Annual general meeting held and accounts presented','The annual general meeting is held within the period the legal report gives (reg 55(4)). Whether the period runs from the year end is for a Partner to settle in the calendar.','Regulation 55(4), as cited','SACCO-DT-REG-2010','{DT_SACCO}','Audit reporting matter',60),
 ('SACCO-S44','Separate auditor report to the regulator (s 44(3)-(4), reg 56)','The auditor''s separate report is prepared and delivered. The wording of s 44(3) is disputed between sources; the calendar holds both readings and no date is computed until a Partner confirms the text.','Section 44(3)-(4); regulation 56, as cited','SACCO-ACT-2008','{ALL_SACCO}','Audit reporting matter',70),
 ('SACCO-PROVISION','Loan classification and provisioning applied under the regulations','Loans are classified and provided for as the regulations require. Use the rules a Partner has confirmed; this item names no percentage.','Regulations 41 and 44, as cited','SACCO-DT-REG-2010','{DT_SACCO}','Audit reporting matter',80),
 ('SACCO-DIVIDEND','Dividend and statutory reserve rules','Dividends and transfers to the statutory reserve follow the rules in force. The December 2025 circular is known only from secondary reports; do not rely on it until a Partner has verified it.','December 2025 circular, secondary source only','SASRA-CIRC-2025-12','{ALL_SACCO}','Regulatory return',90)
) v(c,t,r,cit,ref,ap,n,ord);

-- ---- Matter / KAM helpers --------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.pack_kam_blocking(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE res jsonb:='[]'::jsonb;r record;
BEGIN
 FOR r IN SELECT m.matter_ref,m.title FROM erp_private.audit_tcwg_matters m WHERE m.audit_file_id=p_file AND m.status='Active'
   AND NOT EXISTS(SELECT 1 FROM erp_private.audit_kam_decisions d WHERE d.matter_id=m.matter_id) ORDER BY m.matter_seq LOOP
  res:=res||to_jsonb(('Matter '||r.matter_ref||' ('||r.title||') has no key audit matter decision from a Partner.')::text);
 END LOOP;
 FOR r IN SELECT m.matter_ref,m.title FROM erp_private.audit_tcwg_matters m JOIN erp_private.audit_kam_decisions d ON d.matter_id=m.matter_id
   WHERE m.audit_file_id=p_file AND m.status='Active' AND d.matter_revision<>m.revision ORDER BY m.matter_seq LOOP
  res:=res||to_jsonb(('Matter '||r.matter_ref||' ('||r.title||') changed after the Partner decided. The Partner must decide again.')::text);
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_kam_decisions d JOIN erp_private.audit_tcwg_matters m ON m.matter_id=d.matter_id WHERE d.audit_file_id=p_file AND d.decision='KAM' AND m.status='Active') THEN
  res:=res||to_jsonb('No matter has been decided as a key audit matter.'::text); END IF;
 RETURN res;
END $$;

CREATE FUNCTION erp_private.pack_statutory_blocking(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;res jsonb:='[]'::jsonb;chk jsonb;x jsonb;n integer;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN '[]'::jsonb; END IF;
 IF f.audit_report_date IS NULL THEN res:=res||to_jsonb('The audit report date is not set.'::text); END IF;
 IF NOT erp_private.sasra_eligible(f.client_id,f.handling_firm_id,EXTRACT(year FROM f.ends_on)::integer) AND NOT f.is_demonstration THEN
  res:=res||to_jsonb('SASRA auditor eligibility is not confirmed by a Partner for this financial year.'::text); END IF;
 chk:=erp_private.sasra_breach_check(p_file);
 IF chk IS NULL OR jsonb_array_length(chk)=0 THEN res:=res||to_jsonb('No SASRA ratio is confirmed for this SACCO type and year end.'::text);
 ELSE
  FOR x IN SELECT * FROM jsonb_array_elements(chk) LOOP
   IF x->>'state' NOT IN('Met','Breach') THEN res:=res||to_jsonb(('Figures missing for '||(x->>'label')||'.')::text);
   ELSIF x->>'state'='Breach' AND NOT (x->>'acknowledged')::boolean THEN res:=res||to_jsonb(('Breach not acknowledged by a Partner: '||(x->>'label')||'.')::text); END IF;
  END LOOP;
 END IF;
 SELECT count(*) INTO n FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file;
 IF n=0 THEN res:=res||to_jsonb('The compliance register has not been started on this file.'::text);
 ELSE
  SELECT count(*) INTO n FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file AND status<>'Reviewed';
  IF n>0 THEN res:=res||to_jsonb((n::text||' compliance item(s) are not reviewed.')::text); END IF;
 END IF;
 RETURN res;
END $$;

-- Two new report kinds. Both are approved by a Partner only.
ALTER TABLE erp_private.audit_reports DROP CONSTRAINT audit_reports_kind_check;
ALTER TABLE erp_private.audit_reports ADD CONSTRAINT audit_reports_kind_check CHECK(kind IN('Financial statements','Management letter','Representation letter','Completion memorandum','Statutory report to regulator','Key audit matters'));

ALTER FUNCTION erp_private.audit_report_build(uuid,text,jsonb) RENAME TO audit_report_build_standard;
CREATE FUNCTION erp_private.audit_report_build(p_file uuid,p_kind text,p_params jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;c erp_private.clients;st text;cal erp_private.regulatory_calendar;fsr record;
BEGIN
 IF p_kind NOT IN('Statutory report to regulator','Key audit matters') THEN RETURN erp_private.audit_report_build_standard(p_file,p_kind,p_params); END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=f.client_id;
 st:=erp_private.client_sacco_type(f.client_id);
 IF p_kind='Key audit matters' THEN
  RETURN jsonb_build_object('entity',c.company_name,'sacco_type',st,'period_end',f.ends_on,'report_date',f.audit_report_date,
   'note','Drafted only from matters communicated to those charged with governance. No matter is included unless a Partner decided it is a key audit matter.',
   'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('matter_ref',m.matter_ref,'matter_title',m.title,'communicated_on',m.communicated_on,'communicated_to',m.communicated_to,'method',m.method,
      'heading',d.heading,'why_significant',d.significance_note,'how_addressed',d.how_addressed,'text',d.draft_text) ORDER BY m.matter_seq)
     FROM erp_private.audit_kam_decisions d JOIN erp_private.audit_tcwg_matters m ON m.matter_id=d.matter_id WHERE d.audit_file_id=p_file AND d.decision='KAM' AND m.status='Active'),'[]'::jsonb),
   'considered_not_kam',COALESCE((SELECT jsonb_agg(jsonb_build_object('matter_ref',m.matter_ref,'matter_title',m.title,'reason',d.significance_note) ORDER BY m.matter_seq)
     FROM erp_private.audit_kam_decisions d JOIN erp_private.audit_tcwg_matters m ON m.matter_id=d.matter_id WHERE d.audit_file_id=p_file AND d.decision='Not a KAM' AND m.status='Active'),'[]'::jsonb));
 END IF;
 SELECT * INTO cal FROM erp_private.regulatory_calendar WHERE item_code='S44-SEPARATE-AUDITOR-REPORT';
 SELECT r.version_number,r.body_sha256 INTO fsr FROM erp_private.audit_reports r WHERE r.audit_file_id=p_file AND r.kind='Financial statements' AND r.status='Approved' ORDER BY r.version_number DESC LIMIT 1;
 RETURN jsonb_build_object('entity',c.company_name,'sacco_type',st,'period_start',f.starts_on,'period_end',f.ends_on,'report_date',f.audit_report_date,
  'addressee',btrim(COALESCE(p_params->>'addressee','')),'partner_conclusion',btrim(COALESCE(p_params->>'partner_conclusion','')),
  'eligibility',jsonb_build_object('financial_year',EXTRACT(year FROM f.ends_on)::integer,'confirmed',erp_private.sasra_eligible(f.client_id,f.handling_firm_id,EXTRACT(year FROM f.ends_on)::integer)),
  'financial_statements',CASE WHEN fsr.version_number IS NULL THEN NULL ELSE jsonb_build_object('approved_version',fsr.version_number,'fingerprint',left(fsr.body_sha256,12)) END,
  'ratios',COALESCE(erp_private.sasra_breach_check(p_file),'[]'::jsonb),
  'ratio_acknowledgements',COALESCE((SELECT jsonb_agg(jsonb_build_object('ratio_id',q.ratio_id,'note',q.note,'value_seen',q.value_seen,'at',q.created_at) ORDER BY q.created_at) FROM erp_private.audit_quality_logs q WHERE q.audit_file_id=p_file AND q.kind='Breach acknowledged'),'[]'::jsonb),
  'compliance',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',i.item_code,'title',i.title,'citation',i.citation,'nature',i.nature,'result',k.result,'effect',k.reporting_effect,'note',k.note,'status',k.status) ORDER BY i.sort_order,i.item_code)
     FROM erp_private.audit_file_compliance k JOIN erp_private.audit_compliance_items i ON i.item_id=k.item_id WHERE k.audit_file_id=p_file AND (k.reporting_effect='Statutory report' OR k.result='Not complied')),'[]'::jsonb),
  'compliance_counts',(SELECT COALESCE(jsonb_object_agg(COALESCE(result,'Not started'),n),'{}'::jsonb) FROM (SELECT result,count(*)::int n FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file GROUP BY result) s),
  'section10',COALESCE((SELECT jsonb_agg(jsonb_build_object('caption',l.caption,'status',k.status,'applicable',k.applicable,'note',k.note) ORDER BY l.sort_order)
     FROM erp_private.sacco_file_checks k JOIN erp_private.sacco_layout_lines l ON l.layout_id=erp_private.sacco_layout_use() AND l.line_code=k.line_code WHERE k.audit_file_id=p_file),'[]'::jsonb),
  'calendar',CASE WHEN cal.item_id IS NULL THEN NULL ELSE jsonb_build_object('as_reported',cal.as_reported,'conflicting_wording',cal.conflicting_wording,'status',cal.status,
     'due',erp_private.regulatory_due_date(cal.item_id,f.ends_on)) END,
  'note','Assembled from the records on the file. The conclusion above is the Partner''s own wording. The system does not state the legal test and computes no due date until a Partner has confirmed the rule.');
END $$;

-- Basis: if this changes, an approved report is out of date. (Replaces the S4 version and adds the two new kinds.)
CREATE OR REPLACE FUNCTION erp_private.audit_report_basis(p_file uuid,p_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s text;cid uuid;
BEGIN
 IF p_kind='Key audit matters' THEN
  s:=COALESCE((SELECT jsonb_agg(jsonb_build_array(m.matter_id,m.revision,m.status,d.decision,d.heading,d.significance_note,d.how_addressed,d.draft_text) ORDER BY m.matter_seq)::text
    FROM erp_private.audit_tcwg_matters m LEFT JOIN erp_private.audit_kam_decisions d ON d.matter_id=m.matter_id WHERE m.audit_file_id=p_file),'[]');
  RETURN encode(sha256(convert_to('KAM|'||s,'UTF8')),'hex');
 END IF;
 s:=erp_private.audit_report_basis_standard(p_file,p_kind);
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF p_kind='Financial statements' THEN
  IF erp_private.client_sacco_type(cid)<>'NOT_SACCO' THEN s:=encode(sha256(convert_to(s||'|'||erp_private.sacco_basis_text(p_file),'UTF8')),'hex'); END IF;
 ELSIF p_kind='Statutory report to regulator' THEN
  s:=encode(sha256(convert_to(s||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(k.item_id,k.result,k.reporting_effect,k.status,k.note) ORDER BY k.item_id)::text FROM erp_private.audit_file_compliance k WHERE k.audit_file_id=p_file),'[]')
    ||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(x->>'ratio_code',x->>'value',x->>'state',x->>'acknowledged'))::text FROM jsonb_array_elements(COALESCE(erp_private.sasra_breach_check(p_file),'[]'::jsonb)) x),'[]')
    ||'|'||COALESCE((SELECT audit_report_date::text FROM erp_private.audit_files WHERE audit_file_id=p_file),'')
    ||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(k.line_code,k.status,k.applicable) ORDER BY k.line_code)::text FROM erp_private.sacco_file_checks k WHERE k.audit_file_id=p_file),'[]'),'UTF8')),'hex');
 END IF;
 RETURN s;
END $$;

-- Drafting: the same checks as before, with the two new kinds.
CREATE OR REPLACE FUNCTION erp_private.audit_report_draft(p_file uuid,p_kind text,p_params jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;f erp_private.audit_files;body jsonb;v integer;id uuid;prm jsonb:=COALESCE(p_params,'{}'::jsonb);
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to new report versions' USING ERRCODE='23514'; END IF;
 IF p_kind NOT IN('Financial statements','Management letter','Representation letter','Completion memorandum','Statutory report to regulator','Key audit matters') THEN RAISE EXCEPTION 'Choose a report' USING ERRCODE='22023'; END IF;
 IF p_kind IN('Statutory report to regulator','Key audit matters') AND erp_private.client_sacco_type(f.client_id)='NOT_SACCO' THEN RAISE EXCEPTION 'This report is only for a SACCO file' USING ERRCODE='23514'; END IF;
 IF p_kind='Statutory report to regulator' THEN
  IF length(btrim(COALESCE(prm->>'addressee','')))<3 THEN RAISE EXCEPTION 'Enter who the report is addressed to' USING ERRCODE='23514'; END IF;
  IF length(btrim(COALESCE(prm->>'partner_conclusion','')))<30 THEN RAISE EXCEPTION 'The Partner must write the conclusion in their own words (at least 30 characters)' USING ERRCODE='23514'; END IF;
 END IF;
 IF p_kind='Key audit matters' AND NOT EXISTS(SELECT 1 FROM erp_private.audit_kam_decisions d JOIN erp_private.audit_tcwg_matters m ON m.matter_id=d.matter_id WHERE d.audit_file_id=p_file AND d.decision='KAM' AND m.status='Active') THEN
  RAISE EXCEPTION 'A Partner has not decided any communicated matter is a key audit matter' USING ERRCODE='23514'; END IF;
 IF p_kind='Representation letter' AND (length(btrim(COALESCE(prm->>'signatory_name','')))<3 OR length(btrim(COALESCE(prm->>'signatory_title','')))<3) THEN RAISE EXCEPTION 'Enter the name and title of the person signing for management' USING ERRCODE='23514'; END IF;
 IF p_kind='Management letter' AND EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Open') THEN RAISE EXCEPTION 'Decide every management-letter point (include or drop) before drafting the letter' USING ERRCODE='23514'; END IF;
 IF p_kind='Financial statements' AND NOT EXISTS(SELECT 1 FROM erp_private.audit_tb_imports WHERE audit_file_id=p_file AND period_kind='Current' AND status='Confirmed') THEN RAISE EXCEPTION 'Confirm the current-year trial balance first' USING ERRCODE='23514'; END IF;
 body:=erp_private.audit_report_build(p_file,p_kind,prm);
 UPDATE erp_private.audit_reports SET status='Superseded' WHERE audit_file_id=p_file AND kind=p_kind AND status IN('Draft','Returned');
 SELECT COALESCE(max(version_number),0)+1 INTO v FROM erp_private.audit_reports WHERE audit_file_id=p_file AND kind=p_kind;
 INSERT INTO erp_private.audit_reports(audit_file_id,project_id,handling_firm_id,kind,version_number,params,body,body_sha256,basis_sha256,prepared_by)
  VALUES(p_file,f.project_id,f.handling_firm_id,p_kind,v,prm,body,encode(sha256(convert_to(body::text,'UTF8')),'hex'),erp_private.audit_report_basis(p_file,p_kind),a.staff_id) RETURNING report_id INTO id;
 RETURN id;
END $$;

CREATE OR REPLACE FUNCTION erp_private.audit_report_status_calc(p_file uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('kind',k,
   'required',CASE WHEN k='Management letter' THEN EXISTS(SELECT 1 FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Included')
     WHEN k='Statutory report to regulator' THEN erp_private.pack_statutory_required(p_file)
     WHEN k='Key audit matters' THEN EXISTS(SELECT 1 FROM erp_private.audit_kam_decisions d JOIN erp_private.audit_tcwg_matters m ON m.matter_id=d.matter_id WHERE d.audit_file_id=p_file AND d.decision='KAM' AND m.status='Active')
     ELSE true END,
   'approved_report_id',ar.report_id,'approved_version',ar.version_number,'current',ar.report_id IS NOT NULL AND ar.basis_sha256=erp_private.audit_report_basis(p_file,k),
   'open_points',CASE WHEN k='Management letter' THEN (SELECT count(*)::int FROM erp_private.audit_management_points WHERE audit_file_id=p_file AND status='Open') END) ORDER BY ord),'[]'::jsonb)
 FROM (VALUES(1,'Financial statements'),(2,'Management letter'),(3,'Representation letter'),(4,'Completion memorandum'),(5,'Statutory report to regulator'),(6,'Key audit matters')) v(ord,k)
 LEFT JOIN LATERAL (SELECT r.report_id,r.version_number,r.basis_sha256 FROM erp_private.audit_reports r WHERE r.audit_file_id=p_file AND r.kind=v.k AND r.status='Approved' ORDER BY r.version_number DESC LIMIT 1) ar ON true;
$$;

CREATE OR REPLACE FUNCTION erp_private.audit_report_bases(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_files f WHERE f.audit_file_id=p_file AND erp_private.project_allowed(f.project_id)) THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('Financial statements',erp_private.audit_report_basis(p_file,'Financial statements'),'Management letter',erp_private.audit_report_basis(p_file,'Management letter'),
  'Representation letter',erp_private.audit_report_basis(p_file,'Representation letter'),'Completion memorandum',erp_private.audit_report_basis(p_file,'Completion memorandum'),
  'Statutory report to regulator',erp_private.audit_report_basis(p_file,'Statutory report to regulator'),'Key audit matters',erp_private.audit_report_basis(p_file,'Key audit matters'));
END $$;

-- Partner-only approval of the two new kinds, and the submit checks.
CREATE FUNCTION erp_private.pack_report_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE blk jsonb;
BEGIN
 IF NEW.kind NOT IN('Statutory report to regulator','Key audit matters') THEN RETURN NEW; END IF;
 IF NEW.status='Approved' AND OLD.status IS DISTINCT FROM 'Approved' AND (erp_private.actor()).category_code IS DISTINCT FROM 'PARTNER' THEN
  RAISE EXCEPTION 'Only a Partner approves the %',lower(NEW.kind) USING ERRCODE='42501'; END IF;
 IF NEW.status='Submitted' AND OLD.status IS DISTINCT FROM 'Submitted' THEN
  blk:=CASE NEW.kind WHEN 'Key audit matters' THEN erp_private.pack_kam_blocking(NEW.audit_file_id) ELSE erp_private.pack_statutory_blocking(NEW.audit_file_id) END;
  IF jsonb_array_length(COALESCE(blk,'[]'::jsonb))>0 THEN RAISE EXCEPTION 'The % is not ready to submit: %',lower(NEW.kind),(SELECT string_agg(x,' ') FROM (SELECT jsonb_array_elements_text(blk) x LIMIT 3) q) USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pack_report_guard BEFORE UPDATE OF status ON erp_private.audit_reports FOR EACH ROW EXECUTE FUNCTION erp_private.pack_report_guard();

-- ---- Writes ------------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.pack_programme_copy(p_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;src erp_private.audit_programmes;nid uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can start a new programme version' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_programmes WHERE code=p_code AND status='Draft') THEN RAISE EXCEPTION 'There is already a draft of this programme. Finish or approve it first' USING ERRCODE='23514'; END IF;
 SELECT * INTO src FROM erp_private.audit_programmes WHERE code=p_code ORDER BY version DESC LIMIT 1;
 IF src.programme_id IS NULL THEN RAISE EXCEPTION 'Unknown programme' USING ERRCODE='22023'; END IF;
 INSERT INTO erp_private.audit_programmes(code,version,title,applies_to,status,source_note,created_by)
  VALUES(p_code,src.version+1,src.title,src.applies_to,'Draft','Copied from version '||src.version||'. A Partner must approve it before files can adopt it.',a.staff_id) RETURNING programme_id INTO nid;
 INSERT INTO erp_private.audit_programme_steps(programme_id,step_code,audit_area,assertion,procedure,required,reference_id,sort_order)
  SELECT nid,step_code,audit_area,assertion,procedure,required,reference_id,sort_order FROM erp_private.audit_programme_steps WHERE programme_id=src.programme_id;
 RETURN nid;
END $$;

CREATE FUNCTION erp_private.pack_programme_step_save(p_programme uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;pr erp_private.audit_programmes;v_code text;v_ref uuid;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the programme' USING ERRCODE='42501'; END IF;
 SELECT * INTO pr FROM erp_private.audit_programmes WHERE programme_id=p_programme FOR UPDATE;
 IF pr.programme_id IS NULL OR pr.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft programme can be edited' USING ERRCODE='23514'; END IF;
 v_code:=upper(btrim(p->>'step_code'));
 IF NULLIF(btrim(COALESCE(p->>'reference_code','')),'') IS NOT NULL THEN
  SELECT ref_id INTO v_ref FROM erp_private.legal_references WHERE ref_code=btrim(p->>'reference_code');
  IF v_ref IS NULL THEN RAISE EXCEPTION 'That legal reference is not in the register' USING ERRCODE='22023'; END IF;
 END IF;
 INSERT INTO erp_private.audit_programme_steps(programme_id,step_code,audit_area,assertion,procedure,required,reference_id,sort_order)
  VALUES(p_programme,v_code,btrim(p->>'audit_area'),btrim(p->>'assertion'),btrim(p->>'procedure'),COALESCE((p->>'required')::boolean,true),v_ref,(p->>'sort_order')::integer)
 ON CONFLICT (programme_id,step_code) DO UPDATE SET audit_area=EXCLUDED.audit_area,assertion=EXCLUDED.assertion,procedure=EXCLUDED.procedure,required=EXCLUDED.required,reference_id=EXCLUDED.reference_id,sort_order=EXCLUDED.sort_order;
 UPDATE erp_private.audit_programmes SET updated_at=now() WHERE programme_id=p_programme;
 RETURN jsonb_build_object('ok',true,'step_code',v_code);
END $$;

CREATE FUNCTION erp_private.pack_programme_step_remove(p_programme uuid,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;pr erp_private.audit_programmes;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the programme' USING ERRCODE='42501'; END IF;
 SELECT * INTO pr FROM erp_private.audit_programmes WHERE programme_id=p_programme FOR UPDATE;
 IF pr.programme_id IS NULL OR pr.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft programme can be edited' USING ERRCODE='23514'; END IF;
 DELETE FROM erp_private.audit_programme_steps WHERE programme_id=p_programme AND step_code=p_code;
 UPDATE erp_private.audit_programmes SET updated_at=now() WHERE programme_id=p_programme;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.pack_programme_approve(p_programme uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;pr erp_private.audit_programmes;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve the audit programme' USING ERRCODE='42501'; END IF;
 SELECT * INTO pr FROM erp_private.audit_programmes WHERE programme_id=p_programme FOR UPDATE;
 IF pr.programme_id IS NULL OR pr.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft programme can be approved' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what you checked, in at least 10 characters' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_programme_steps WHERE programme_id=p_programme) THEN RAISE EXCEPTION 'The programme has no steps' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_programmes SET status='Superseded' WHERE code=pr.code AND status='Approved';
 UPDATE erp_private.audit_programmes SET status='Approved',approved_by=a.staff_id,approved_at=now(),approval_note=btrim(p_note) WHERE programme_id=p_programme;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Adopting a programme copies its steps onto the file. A file adopts a programme code once.
CREATE FUNCTION erp_private.pack_programme_adopt(p_file uuid,p_programme uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;pr erp_private.audit_programmes;st text;n integer;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);
 SELECT * INTO pr FROM erp_private.audit_programmes WHERE programme_id=p_programme;
 IF pr.programme_id IS NULL OR pr.status<>'Approved' THEN RAISE EXCEPTION 'Only a programme approved by a Partner can be adopted' USING ERRCODE='23514'; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF NOT ('ALL_SACCO'=ANY(pr.applies_to) OR st=ANY(pr.applies_to)) THEN RAISE EXCEPTION 'This programme is not for this type of SACCO' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.audit_file_steps s JOIN erp_private.audit_programmes q ON q.programme_id=s.programme_id WHERE s.audit_file_id=p_file AND q.code=pr.code) THEN
  RAISE EXCEPTION 'This file has already adopted this programme' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_file_steps(audit_file_id,project_id,handling_firm_id,programme_id,step_code,audit_area,assertion,procedure,required,sort_order)
  SELECT f.audit_file_id,f.project_id,f.handling_firm_id,s.programme_id,s.step_code,s.audit_area,s.assertion,s.procedure,s.required,s.sort_order FROM erp_private.audit_programme_steps s WHERE s.programme_id=p_programme;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'steps',n);
END $$;

CREATE FUNCTION erp_private.pack_step_prepare(p_file uuid,p_programme uuid,p_step text,p_applicable boolean,p_note text,p_workpaper uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;s erp_private.audit_file_steps;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 SELECT * INTO s FROM erp_private.audit_file_steps WHERE audit_file_id=p_file AND programme_id=p_programme AND step_code=p_step FOR UPDATE;
 IF s.file_step_id IS NULL THEN RAISE EXCEPTION 'Choose a step of an adopted programme' USING ERRCODE='22023'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what was done, or why the step does not apply, in at least 10 characters' USING ERRCODE='23514'; END IF;
 IF p_workpaper IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.audit_workpapers w WHERE w.audit_workpaper_id=p_workpaper AND w.audit_file_id=p_file) THEN RAISE EXCEPTION 'That working paper is not on this file' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_file_steps SET status='Prepared',applicable=COALESCE(p_applicable,true),result_note=btrim(p_note),audit_workpaper_id=p_workpaper,prepared_by=a.staff_id,prepared_at=now(),reviewer_id=NULL,reviewed_at=NULL,review_note='' WHERE file_step_id=s.file_step_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.pack_step_review(p_file uuid,p_programme uuid,p_step text,p_accept boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;s erp_private.audit_file_steps;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 IF a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner reviews a programme step' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM erp_private.audit_file_steps WHERE audit_file_id=p_file AND programme_id=p_programme AND step_code=p_step FOR UPDATE;
 IF s.file_step_id IS NULL OR s.status<>'Prepared' THEN RAISE EXCEPTION 'That step is not waiting for review' USING ERRCODE='23514'; END IF;
 IF s.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You performed this step, so someone else must review it' USING ERRCODE='42501'; END IF;
 IF NOT p_accept AND length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Say what needs to change (at least 5 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_file_steps SET status=CASE WHEN p_accept THEN 'Reviewed' ELSE 'Returned' END,reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(COALESCE(p_note,'')) WHERE file_step_id=s.file_step_id;
 IF NOT p_accept THEN INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(s.prepared_by,'A programme step was returned: '||left(btrim(p_note),150),'pack-step-return:'||s.file_step_id::text||':'||s.revision::text) ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Compliance register: library
CREATE FUNCTION erp_private.pack_compliance_item_save(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;v_code text;v_ref uuid;v_applies text[];it erp_private.audit_compliance_items;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner maintains the compliance register' USING ERRCODE='42501'; END IF;
 v_code:=upper(btrim(p->>'item_code'));
 IF NULLIF(btrim(COALESCE(p->>'reference_code','')),'') IS NOT NULL THEN
  SELECT ref_id INTO v_ref FROM erp_private.legal_references WHERE ref_code=btrim(p->>'reference_code');
  IF v_ref IS NULL THEN RAISE EXCEPTION 'That legal reference is not in the register' USING ERRCODE='22023'; END IF;
 END IF;
 v_applies:=COALESCE(ARRAY(SELECT jsonb_array_elements_text(p->'applies_to')),ARRAY['ALL_SACCO']::text[]);
 SELECT * INTO it FROM erp_private.audit_compliance_items WHERE item_code=v_code FOR UPDATE;
 IF it.item_id IS NULL THEN
  INSERT INTO erp_private.audit_compliance_items(item_code,title,requirement,citation,reference_id,applies_to,nature,sort_order,created_by)
   VALUES(v_code,btrim(p->>'title'),btrim(p->>'requirement'),btrim(COALESCE(p->>'citation','')),v_ref,v_applies,p->>'nature',COALESCE((p->>'sort_order')::integer,100),a.staff_id);
 ELSE
  UPDATE erp_private.audit_compliance_items SET title=btrim(p->>'title'),requirement=btrim(p->>'requirement'),citation=btrim(COALESCE(p->>'citation','')),reference_id=v_ref,applies_to=v_applies,nature=p->>'nature',
   sort_order=COALESCE((p->>'sort_order')::integer,sort_order),status='Proposed',approved_by=NULL,approved_at=NULL,approval_note='' WHERE item_id=it.item_id;
 END IF;
 RETURN jsonb_build_object('ok',true,'item_code',v_code);
END $$;

CREATE FUNCTION erp_private.pack_compliance_item_approve(p_item uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;it erp_private.audit_compliance_items;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner approves a compliance register item' USING ERRCODE='42501'; END IF;
 SELECT * INTO it FROM erp_private.audit_compliance_items WHERE item_id=p_item FOR UPDATE;
 IF it.item_id IS NULL OR it.status<>'Proposed' THEN RAISE EXCEPTION 'Only a proposed item can be approved' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what you checked against the source, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_compliance_items SET status='Approved',approved_by=a.staff_id,approved_at=now(),approval_note=btrim(p_note) WHERE item_id=p_item;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Compliance register: on a file
CREATE FUNCTION erp_private.pack_compliance_adopt(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;n integer;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);
 st:=erp_private.client_sacco_type(f.client_id);
 INSERT INTO erp_private.audit_file_compliance(audit_file_id,project_id,handling_firm_id,item_id)
  SELECT f.audit_file_id,f.project_id,f.handling_firm_id,i.item_id FROM erp_private.audit_compliance_items i
  WHERE i.status='Approved' AND ('ALL_SACCO'=ANY(i.applies_to) OR st=ANY(i.applies_to))
  ON CONFLICT (audit_file_id,item_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'added',n);
END $$;

CREATE FUNCTION erp_private.pack_compliance_prepare(p_file uuid,p_item uuid,p_result text,p_effect text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;k erp_private.audit_file_compliance;v_effect text;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 SELECT * INTO k FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file AND item_id=p_item FOR UPDATE;
 IF k.compliance_id IS NULL THEN RAISE EXCEPTION 'Add the standard items to this file first' USING ERRCODE='23514'; END IF;
 IF p_result NOT IN('Complied','Not complied','Not applicable') THEN RAISE EXCEPTION 'Choose complied, not complied or not applicable' USING ERRCODE='22023'; END IF;
 v_effect:=CASE WHEN p_result='Not complied' THEN COALESCE(p_effect,'None') ELSE 'None' END;
 IF p_result='Not complied' AND v_effect NOT IN('Management letter','Statutory report','Matter for those charged with governance') THEN RAISE EXCEPTION 'Choose where a non-compliance is reported' USING ERRCODE='23514'; END IF;
 IF p_result='Not complied' AND length(btrim(COALESCE(p_note,'')))<20 THEN RAISE EXCEPTION 'Describe the non-compliance in at least 20 characters' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what was checked, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_file_compliance SET status='Prepared',result=p_result,reporting_effect=v_effect,note=btrim(p_note),prepared_by=a.staff_id,prepared_at=now(),reviewer_id=NULL,reviewed_at=NULL,review_note='' WHERE compliance_id=k.compliance_id;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.pack_compliance_review(p_file uuid,p_item uuid,p_accept boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;k erp_private.audit_file_compliance;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 IF a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner reviews a compliance item' USING ERRCODE='42501'; END IF;
 SELECT * INTO k FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file AND item_id=p_item FOR UPDATE;
 IF k.compliance_id IS NULL OR k.status<>'Prepared' THEN RAISE EXCEPTION 'That item is not waiting for review' USING ERRCODE='23514'; END IF;
 IF k.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You assessed this item, so someone else must review it' USING ERRCODE='42501'; END IF;
 IF NOT p_accept AND length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Say what needs to change (at least 5 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_file_compliance SET status=CASE WHEN p_accept THEN 'Reviewed' ELSE 'Returned' END,reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(COALESCE(p_note,'')) WHERE compliance_id=k.compliance_id;
 IF NOT p_accept THEN INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(k.prepared_by,'A compliance item was returned: '||left(btrim(p_note),150),'pack-compliance-return:'||k.compliance_id::text||':'||k.revision::text) ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Matters communicated, and the Partner's KAM decision
CREATE FUNCTION erp_private.pack_matter_save(p_file uuid,p_matter uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;seq integer;id uuid;m erp_private.audit_tcwg_matters;v_on date;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 v_on:=(p->>'communicated_on')::date;
 IF v_on IS NULL OR v_on>current_date THEN RAISE EXCEPTION 'Enter the date the matter was communicated. It cannot be in the future' USING ERRCODE='23514'; END IF;
 IF v_on<f.starts_on THEN RAISE EXCEPTION 'The matter cannot have been communicated before the audit period began' USING ERRCODE='23514'; END IF;
 IF p_matter IS NULL THEN
  SELECT COALESCE(max(matter_seq),0)+1 INTO seq FROM erp_private.audit_tcwg_matters WHERE audit_file_id=p_file;
  INSERT INTO erp_private.audit_tcwg_matters(audit_file_id,project_id,handling_firm_id,matter_seq,matter_ref,title,description,communicated_on,method,communicated_to,response,created_by)
   VALUES(p_file,f.project_id,f.handling_firm_id,seq,'TM-'||lpad(seq::text,3,'0'),btrim(p->>'title'),btrim(p->>'description'),v_on,p->>'method',btrim(p->>'communicated_to'),btrim(COALESCE(p->>'response','')),a.staff_id) RETURNING matter_id INTO id;
  RETURN jsonb_build_object('ok',true,'matter_id',id);
 END IF;
 SELECT * INTO m FROM erp_private.audit_tcwg_matters WHERE matter_id=p_matter AND audit_file_id=p_file FOR UPDATE;
 IF m.matter_id IS NULL OR m.status<>'Active' THEN RAISE EXCEPTION 'Matter unavailable' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.audit_tcwg_matters SET title=btrim(p->>'title'),description=btrim(p->>'description'),communicated_on=v_on,method=p->>'method',communicated_to=btrim(p->>'communicated_to'),response=btrim(COALESCE(p->>'response','')) WHERE matter_id=p_matter;
 RETURN jsonb_build_object('ok',true,'matter_id',p_matter);
END $$;

CREATE FUNCTION erp_private.pack_matter_withdraw(p_matter uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE m erp_private.audit_tcwg_matters;f erp_private.audit_files;
BEGIN
 SELECT * INTO m FROM erp_private.audit_tcwg_matters WHERE matter_id=p_matter;
 IF m.matter_id IS NULL THEN RAISE EXCEPTION 'Matter unavailable' USING ERRCODE='42501'; END IF;
 f:=erp_private.sacco_file_for_write(m.audit_file_id);
 IF m.status<>'Active' THEN RAISE EXCEPTION 'The matter is already withdrawn' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record why the matter is withdrawn, in at least 10 characters' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.audit_tcwg_matters SET status='Withdrawn',withdraw_note=btrim(p_note) WHERE matter_id=p_matter;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.pack_kam_decide(p_matter uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;m erp_private.audit_tcwg_matters;f erp_private.audit_files;v_dec text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner decides whether a matter is a key audit matter' USING ERRCODE='42501'; END IF;
 SELECT * INTO m FROM erp_private.audit_tcwg_matters WHERE matter_id=p_matter FOR UPDATE;
 IF m.matter_id IS NULL OR m.status<>'Active' THEN RAISE EXCEPTION 'Matter unavailable' USING ERRCODE='42501'; END IF;
 f:=erp_private.sacco_file_for_write(m.audit_file_id);
 v_dec:=p->>'decision';
 IF v_dec NOT IN('KAM','Not a KAM') THEN RAISE EXCEPTION 'Choose key audit matter or not a key audit matter' USING ERRCODE='22023'; END IF;
 IF length(btrim(COALESCE(p->>'significance_note','')))<20 THEN RAISE EXCEPTION 'Record the reason for your decision, in at least 20 characters' USING ERRCODE='23514'; END IF;
 IF v_dec='KAM' AND (length(btrim(COALESCE(p->>'heading','')))<5 OR length(btrim(COALESCE(p->>'how_addressed','')))<20 OR length(btrim(COALESCE(p->>'draft_text','')))<40) THEN
  RAISE EXCEPTION 'A key audit matter needs a heading, how the audit addressed it (20 characters) and the draft text (40 characters)' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.audit_kam_decisions(matter_id,audit_file_id,project_id,handling_firm_id,decision,significance_note,heading,how_addressed,draft_text,matter_revision,decided_by)
  VALUES(p_matter,m.audit_file_id,m.project_id,m.handling_firm_id,v_dec,btrim(p->>'significance_note'),btrim(COALESCE(p->>'heading','')),btrim(COALESCE(p->>'how_addressed','')),btrim(COALESCE(p->>'draft_text','')),m.revision,a.staff_id)
 ON CONFLICT (matter_id) DO UPDATE SET decision=EXCLUDED.decision,significance_note=EXCLUDED.significance_note,heading=EXCLUDED.heading,how_addressed=EXCLUDED.how_addressed,draft_text=EXCLUDED.draft_text,
  matter_revision=EXCLUDED.matter_revision,decided_by=EXCLUDED.decided_by,decided_at=now(),updated_at=now();
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- Sign-off and the screen ---------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.pack_signoff_issues(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;res jsonb:='[]'::jsonb;n integer;x jsonb;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN '[]'::jsonb; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN '[]'::jsonb; END IF;
 -- programme
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_programmes WHERE status='Approved' AND ('ALL_SACCO'=ANY(applies_to) OR st=ANY(applies_to))) THEN
  res:=res||to_jsonb('The SACCO audit programme is not approved by a Partner.'::text);
 ELSIF NOT EXISTS(SELECT 1 FROM erp_private.audit_file_steps WHERE audit_file_id=p_file) THEN res:=res||to_jsonb('No audit programme has been adopted on this file.'::text);
 ELSE
  SELECT count(*) INTO n FROM erp_private.audit_file_steps WHERE audit_file_id=p_file AND required AND status<>'Reviewed';
  IF n>0 THEN res:=res||to_jsonb((n::text||' required programme step(s) are not reviewed.')::text); END IF;
 END IF;
 -- compliance
 IF NOT EXISTS(SELECT 1 FROM erp_private.audit_compliance_items WHERE status='Approved' AND ('ALL_SACCO'=ANY(applies_to) OR st=ANY(applies_to))) THEN
  res:=res||to_jsonb('No compliance register items are approved by a Partner.'::text);
 ELSIF NOT EXISTS(SELECT 1 FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file) THEN res:=res||to_jsonb('The compliance register has not been started on this file.'::text);
 ELSE
  SELECT count(*) INTO n FROM erp_private.audit_file_compliance WHERE audit_file_id=p_file AND status<>'Reviewed';
  IF n>0 THEN res:=res||to_jsonb((n::text||' compliance item(s) are not reviewed.')::text); END IF;
 END IF;
 -- matters (the report guard also needs a current Key audit matters report once a KAM is decided)
 FOR x IN SELECT * FROM jsonb_array_elements(erp_private.pack_kam_blocking(p_file)) LOOP
  IF (x #>> '{}') <> 'No matter has been decided as a key audit matter.' THEN res:=res||x; END IF;
 END LOOP;
 RETURN res;
END $$;

ALTER FUNCTION erp_private.sasra_signoff_issues(uuid) RENAME TO sasra_signoff_issues_s4;
CREATE FUNCTION erp_private.sasra_signoff_issues(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 RETURN erp_private.sasra_signoff_issues_s4(p_file)||erp_private.pack_signoff_issues(p_file);
END $$;

CREATE FUNCTION erp_private.pack_workspace(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL THEN RETURN NULL; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('sacco_type',st,
  'programmes',COALESCE((SELECT jsonb_agg(to_jsonb(p)||jsonb_build_object('approved_by_name',s.full_name,
      'steps',COALESCE((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('reference_code',lr.ref_code) ORDER BY x.sort_order) FROM erp_private.audit_programme_steps x LEFT JOIN erp_private.legal_references lr ON lr.ref_id=x.reference_id WHERE x.programme_id=p.programme_id),'[]'::jsonb))
     ORDER BY p.code,p.version DESC) FROM erp_private.audit_programmes p LEFT JOIN erp_private.staff_members s ON s.staff_id=p.approved_by),'[]'::jsonb),
  'file_steps',COALESCE((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('prepared_by_name',pb.full_name,'reviewer_name',rv.full_name,'workpaper_ref',w.workpaper_ref,'programme_version',pr.version,'programme_code',pr.code) ORDER BY x.sort_order)
     FROM erp_private.audit_file_steps x JOIN erp_private.audit_programmes pr ON pr.programme_id=x.programme_id LEFT JOIN erp_private.staff_members pb ON pb.staff_id=x.prepared_by LEFT JOIN erp_private.staff_members rv ON rv.staff_id=x.reviewer_id
     LEFT JOIN erp_private.audit_workpapers w ON w.audit_workpaper_id=x.audit_workpaper_id WHERE x.audit_file_id=p_file),'[]'::jsonb),
  'workpapers',COALESCE((SELECT jsonb_agg(jsonb_build_object('audit_workpaper_id',w.audit_workpaper_id,'workpaper_ref',w.workpaper_ref,'audit_area',w.audit_area) ORDER BY w.workpaper_ref) FROM erp_private.audit_workpapers w WHERE w.audit_file_id=p_file),'[]'::jsonb),
  'compliance_items',COALESCE((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('reference_code',lr.ref_code,'reference_title',lr.title,'reference_verification',lr.verification,'approved_by_name',s.full_name) ORDER BY i.sort_order,i.item_code)
     FROM erp_private.audit_compliance_items i LEFT JOIN erp_private.legal_references lr ON lr.ref_id=i.reference_id LEFT JOIN erp_private.staff_members s ON s.staff_id=i.approved_by),'[]'::jsonb),
  'compliance',COALESCE((SELECT jsonb_agg(to_jsonb(k)||jsonb_build_object('item_code',i.item_code,'title',i.title,'requirement',i.requirement,'citation',i.citation,'nature',i.nature,'prepared_by_name',pb.full_name,'reviewer_name',rv.full_name) ORDER BY i.sort_order,i.item_code)
     FROM erp_private.audit_file_compliance k JOIN erp_private.audit_compliance_items i ON i.item_id=k.item_id LEFT JOIN erp_private.staff_members pb ON pb.staff_id=k.prepared_by LEFT JOIN erp_private.staff_members rv ON rv.staff_id=k.reviewer_id WHERE k.audit_file_id=p_file),'[]'::jsonb),
  'matters',COALESCE((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('created_by_name',cb.full_name,'decision',d.decision,'significance_note',d.significance_note,'heading',d.heading,'how_addressed',d.how_addressed,'draft_text',d.draft_text,
       'decided_by_name',db.full_name,'decided_at',d.decided_at,'decision_stale',(d.matter_id IS NOT NULL AND d.matter_revision<>m.revision)) ORDER BY m.matter_seq)
     FROM erp_private.audit_tcwg_matters m LEFT JOIN erp_private.audit_kam_decisions d ON d.matter_id=m.matter_id LEFT JOIN erp_private.staff_members cb ON cb.staff_id=m.created_by LEFT JOIN erp_private.staff_members db ON db.staff_id=d.decided_by WHERE m.audit_file_id=p_file),'[]'::jsonb),
  'policy',(SELECT jsonb_build_object('key',s.key,'value',s.value,'note',s.note,'confirmed',s.updated_by IS NOT NULL,'confirmed_by_name',m.full_name,'revision',s.revision) FROM erp_private.system_settings s LEFT JOIN erp_private.staff_members m ON m.staff_id=s.updated_by WHERE s.key='SACCO_DT_REQUIRES_STATUTORY_REPORT'),
  'statutory_required',erp_private.pack_statutory_required(p_file),
  'statutory_blocking',erp_private.pack_statutory_blocking(p_file),'kam_blocking',erp_private.pack_kam_blocking(p_file),'issues',erp_private.pack_signoff_issues(p_file));
END $$;

-- ---- Permissions --------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION erp_private.audit_programme_guard(),erp_private.audit_programme_step_guard(),erp_private.pack_statutory_required(uuid),erp_private.pack_kam_blocking(uuid),erp_private.pack_statutory_blocking(uuid),
 erp_private.pack_report_guard(),erp_private.audit_report_build(uuid,text,jsonb),erp_private.audit_report_build_standard(uuid,text,jsonb),erp_private.sasra_signoff_issues_s4(uuid)
 FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.pack_programme_copy(text),erp_private.pack_programme_step_save(uuid,jsonb),erp_private.pack_programme_step_remove(uuid,text),erp_private.pack_programme_approve(uuid,text),
 erp_private.pack_programme_adopt(uuid,uuid),erp_private.pack_step_prepare(uuid,uuid,text,boolean,text,uuid),erp_private.pack_step_review(uuid,uuid,text,boolean,text),
 erp_private.pack_compliance_item_save(jsonb),erp_private.pack_compliance_item_approve(uuid,text),erp_private.pack_compliance_adopt(uuid),erp_private.pack_compliance_prepare(uuid,uuid,text,text,text),
 erp_private.pack_compliance_review(uuid,uuid,boolean,text),erp_private.pack_matter_save(uuid,uuid,jsonb),erp_private.pack_matter_withdraw(uuid,text),erp_private.pack_kam_decide(uuid,jsonb),
 erp_private.pack_signoff_issues(uuid),erp_private.pack_workspace(uuid),erp_private.sasra_signoff_issues(uuid),erp_private.audit_policy_save(text,text,text),erp_private.audit_report_draft(uuid,text,jsonb),
 erp_private.audit_report_status_calc(uuid),erp_private.audit_report_bases(uuid),erp_private.audit_report_basis(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.pack_programme_copy(text),erp_private.pack_programme_step_save(uuid,jsonb),erp_private.pack_programme_step_remove(uuid,text),erp_private.pack_programme_approve(uuid,text),
 erp_private.pack_programme_adopt(uuid,uuid),erp_private.pack_step_prepare(uuid,uuid,text,boolean,text,uuid),erp_private.pack_step_review(uuid,uuid,text,boolean,text),
 erp_private.pack_compliance_item_save(jsonb),erp_private.pack_compliance_item_approve(uuid,text),erp_private.pack_compliance_adopt(uuid),erp_private.pack_compliance_prepare(uuid,uuid,text,text,text),
 erp_private.pack_compliance_review(uuid,uuid,boolean,text),erp_private.pack_matter_save(uuid,uuid,jsonb),erp_private.pack_matter_withdraw(uuid,text),erp_private.pack_kam_decide(uuid,jsonb),
 erp_private.pack_signoff_issues(uuid),erp_private.pack_workspace(uuid),erp_private.sasra_signoff_issues(uuid),erp_private.audit_policy_save(text,text,text),erp_private.audit_report_draft(uuid,text,jsonb),
 erp_private.audit_report_bases(uuid) TO erp_api;
