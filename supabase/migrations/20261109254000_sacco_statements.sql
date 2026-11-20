-- Audit build S4: SACCO statements.
-- A SACCO audit file builds its "Financial statements" report from a SACCO statement layout instead of the general eleven-line layout.
--  * The layout (captions, order, totals) is versioned. A Partner approves a version before the statements can be submitted. Nothing here is a SASRA figure.
--  * Each of the firm's audit accounts is mapped to a layout line. A Manager proposes, a Partner approves (a Partner's own mapping is approved on save).
--  * The statement of changes in equity has one column per reserve. Opening balances come from the comparative trial balance, the surplus goes to the
--    retained-earnings column, and recorded movements (transfers, dividends, share issues) must explain the change in each column.
--  * Statistics (members, loan accounts and so on) are entered with a source note. The prudential ratios shown are the Partner-confirmed ones from S3.
--  * A list of section-10 matters (legal framework note, directors' statement, regulatory report, capital and liquidity schedules, expected credit loss
--    against prudential provision, AML/CFT/CPF, dividends and reserves) is prepared by one person and reviewed by another. Unreviewed items block final sign-off.
-- The captions seeded below are a DRAFT. The Mkopo specimen was not available when they were written. A Partner must read and approve them.

-- ---- Layout versions ----------------------------------------------------------------------------------------------------------------
CREATE TABLE erp_private.sacco_layouts (
 layout_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 version integer NOT NULL UNIQUE CHECK(version>0),
 title text NOT NULL CHECK(length(btrim(title))>=5),
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN('Draft','Approved','Superseded')),
 source_note text NOT NULL DEFAULT '',
 created_by uuid REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 approval_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 CHECK(status='Draft' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND length(btrim(approval_note))>=10))
);
CREATE UNIQUE INDEX sacco_layouts_one_approved ON erp_private.sacco_layouts((true)) WHERE status='Approved';
CREATE UNIQUE INDEX sacco_layouts_one_draft ON erp_private.sacco_layouts((true)) WHERE status='Draft';
CREATE INDEX sacco_layouts_created_idx ON erp_private.sacco_layouts(created_by);
CREATE INDEX sacco_layouts_approved_idx ON erp_private.sacco_layouts(approved_by);

CREATE TABLE erp_private.sacco_layout_lines (
 layout_id uuid NOT NULL REFERENCES erp_private.sacco_layouts,
 line_code text NOT NULL CHECK(line_code ~ '^[A-Z]{1,3}\.[A-Z0-9_]{2,30}$'),
 statement text NOT NULL CHECK(statement IN('Financial position','Income statement','Statistical','Disclosure')),
 section text NOT NULL CHECK(length(btrim(section))>=2),
 caption text NOT NULL CHECK(length(btrim(caption))>=3),
 detail text NOT NULL DEFAULT '',
 kind text NOT NULL CHECK(kind IN('Line','Total','Statistic','Check')),
 side text CHECK(side IN('Debit','Credit')),
 total_of text[] NOT NULL DEFAULT ARRAY[]::text[],
 roles text[] NOT NULL DEFAULT ARRAY[]::text[],
 unit text CHECK(unit IN('KES','Count')),
 auto_key text CHECK(auto_key IN('EQUITY_RECONCILES','ECL_PRUDENTIAL','CAPITAL_FIGURES')),
 sort_order integer NOT NULL,
 PRIMARY KEY(layout_id,line_code),
 CHECK(roles <@ ARRAY['TOTAL_ASSETS','TOTAL_LIABILITIES_EQUITY','SURPLUS','EQUITY_COLUMN','SURPLUS_COLUMN','ECL_ALLOWANCE','PRUDENTIAL_PROVISION']::text[]),
 CHECK((kind='Line' AND side IS NOT NULL AND cardinality(total_of)=0 AND unit IS NULL AND auto_key IS NULL AND statement IN('Financial position','Income statement'))
    OR (kind='Total' AND side IS NULL AND cardinality(total_of)>0 AND unit IS NULL AND auto_key IS NULL AND statement IN('Financial position','Income statement'))
    OR (kind='Statistic' AND side IS NULL AND cardinality(total_of)=0 AND unit IS NOT NULL AND auto_key IS NULL AND statement='Statistical')
    OR (kind='Check' AND side IS NULL AND cardinality(total_of)=0 AND unit IS NULL AND statement='Disclosure'))
);

-- ---- Account to layout-line map -----------------------------------------------------------------------------------------------------
-- Keyed by the firm's audit account, so one approval covers every SACCO client of the firm. The line code is stable across layout versions.
CREATE TABLE erp_private.sacco_line_map (
 audit_account_id uuid PRIMARY KEY,
 handling_firm_id uuid NOT NULL,
 line_code text NOT NULL,
 status text NOT NULL DEFAULT 'Proposed' CHECK(status IN('Proposed','Approved')),
 proposed_by uuid NOT NULL REFERENCES erp_private.staff_members,
 approved_by uuid REFERENCES erp_private.staff_members,
 approved_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_account_id,handling_firm_id) REFERENCES erp_private.audit_account_mappings(audit_account_id,handling_firm_id),
 CHECK((status='Approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL) OR (status='Proposed' AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX sacco_line_map_firm_idx ON erp_private.sacco_line_map(handling_firm_id);
CREATE INDEX sacco_line_map_proposed_idx ON erp_private.sacco_line_map(proposed_by);
CREATE INDEX sacco_line_map_approved_idx ON erp_private.sacco_line_map(approved_by);

-- ---- Statistics, equity movements and the section-10 list, per file ------------------------------------------------------------------
CREATE TABLE erp_private.sacco_file_values (
 value_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 line_code text NOT NULL,
 amount numeric(20,2) NOT NULL CHECK(amount>=0),
 source_note text NOT NULL CHECK(length(btrim(source_note))>=5),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 entered_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id)
);
CREATE INDEX sacco_file_values_idx ON erp_private.sacco_file_values(audit_file_id,line_code,entered_at DESC);
CREATE INDEX sacco_file_values_project_idx ON erp_private.sacco_file_values(project_id,audit_file_id,handling_firm_id);
CREATE INDEX sacco_file_values_by_idx ON erp_private.sacco_file_values(entered_by);

CREATE TABLE erp_private.sacco_equity_moves (
 move_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 line_code text NOT NULL,
 kind text NOT NULL CHECK(kind IN('Transfer to or from reserve','Dividend on shares','Shares issued or redeemed','Revaluation','Other')),
 amount numeric(20,2) NOT NULL CHECK(amount<>0),
 note text NOT NULL CHECK(length(btrim(note))>=5),
 status text NOT NULL DEFAULT 'Active' CHECK(status IN('Active','Withdrawn')),
 entered_by uuid NOT NULL REFERENCES erp_private.staff_members,
 entered_at timestamptz NOT NULL DEFAULT now(),
 withdrawn_by uuid REFERENCES erp_private.staff_members,
 withdrawn_at timestamptz,
 withdraw_note text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 CHECK((status='Withdrawn' AND withdrawn_by IS NOT NULL AND withdrawn_at IS NOT NULL AND length(btrim(withdraw_note))>=5) OR (status='Active' AND withdrawn_by IS NULL AND withdrawn_at IS NULL))
);
CREATE INDEX sacco_equity_moves_idx ON erp_private.sacco_equity_moves(audit_file_id,status);
CREATE INDEX sacco_equity_moves_project_idx ON erp_private.sacco_equity_moves(project_id,audit_file_id,handling_firm_id);
CREATE INDEX sacco_equity_moves_by_idx ON erp_private.sacco_equity_moves(entered_by);
CREATE INDEX sacco_equity_moves_wd_idx ON erp_private.sacco_equity_moves(withdrawn_by);

CREATE TABLE erp_private.sacco_file_checks (
 check_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audit_file_id uuid NOT NULL,
 project_id uuid NOT NULL,
 handling_firm_id uuid NOT NULL,
 line_code text NOT NULL,
 status text NOT NULL DEFAULT 'Prepared' CHECK(status IN('Prepared','Reviewed','Returned')),
 applicable boolean NOT NULL DEFAULT true,
 note text NOT NULL CHECK(length(btrim(note))>=10),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 prepared_at timestamptz NOT NULL DEFAULT now(),
 reviewer_id uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1,
 FOREIGN KEY(audit_file_id,project_id,handling_firm_id) REFERENCES erp_private.audit_files(audit_file_id,project_id,handling_firm_id),
 UNIQUE(audit_file_id,line_code),
 CHECK(status='Prepared' OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL AND reviewer_id<>prepared_by)),
 CHECK(status<>'Returned' OR length(btrim(review_note))>=5)
);
CREATE INDEX sacco_file_checks_project_idx ON erp_private.sacco_file_checks(project_id,audit_file_id,handling_firm_id);
CREATE INDEX sacco_file_checks_prep_idx ON erp_private.sacco_file_checks(prepared_by);
CREATE INDEX sacco_file_checks_rev_idx ON erp_private.sacco_file_checks(reviewer_id);

-- ---- Row security: read through the API, write only through the functions below -------------------------------------------------------
DO $$ DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['sacco_layouts','sacco_layout_lines','sacco_line_map','sacco_file_values','sacco_equity_moves','sacco_file_checks'] LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('GRANT SELECT ON erp_private.%I TO erp_api',t);
 END LOOP;
END $$;
CREATE POLICY sacco_layouts_read ON erp_private.sacco_layouts FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY sacco_layout_lines_read ON erp_private.sacco_layout_lines FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY sacco_line_map_read ON erp_private.sacco_line_map FOR SELECT TO erp_api USING(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY sacco_file_values_read ON erp_private.sacco_file_values FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY sacco_equity_moves_read ON erp_private.sacco_equity_moves FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY sacco_file_checks_read ON erp_private.sacco_file_checks FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sacco_layouts FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sacco_line_map FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sacco_file_values FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sacco_equity_moves FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sacco_file_checks FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.sacco_layouts FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.sacco_line_map FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.sacco_equity_moves FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER update_revision BEFORE UPDATE ON erp_private.sacco_file_checks FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision();
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.sacco_layouts FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('layout_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.sacco_line_map FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('audit_account_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.sacco_file_values FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('value_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.sacco_equity_moves FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('move_id');
CREATE TRIGGER change_audit AFTER INSERT OR UPDATE ON erp_private.sacco_file_checks FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('check_id');

-- Approved and superseded layouts never change, except that an approved one becomes superseded. Lines change only while their layout is a draft.
CREATE FUNCTION erp_private.sacco_layout_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF OLD.status<>'Draft' THEN
  IF NOT (OLD.status='Approved' AND NEW.status='Superseded' AND NEW.version=OLD.version AND NEW.title=OLD.title AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by) THEN
   RAISE EXCEPTION 'An approved layout cannot be changed. Copy it to a new draft version' USING ERRCODE='23514'; END IF;
 ELSIF NEW.version<>OLD.version THEN RAISE EXCEPTION 'The version number of a layout cannot change' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER layout_guard BEFORE UPDATE ON erp_private.sacco_layouts FOR EACH ROW EXECUTE FUNCTION erp_private.sacco_layout_guard();

CREATE FUNCTION erp_private.sacco_layout_line_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE lid uuid;st text;
BEGIN
 lid:=CASE WHEN TG_OP='DELETE' THEN OLD.layout_id ELSE NEW.layout_id END;
 SELECT status INTO st FROM erp_private.sacco_layouts WHERE layout_id=lid;
 IF st IS DISTINCT FROM 'Draft' THEN RAISE EXCEPTION 'Only a draft layout can be changed. Copy the approved layout to a new draft version' USING ERRCODE='23514'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER layout_line_guard BEFORE INSERT OR UPDATE OR DELETE ON erp_private.sacco_layout_lines FOR EACH ROW EXECUTE FUNCTION erp_private.sacco_layout_line_guard();

-- ---- Draft layout, version 1 (needs Partner approval) --------------------------------------------------------------------------------
INSERT INTO erp_private.sacco_layouts(version,title,status,source_note)
VALUES(1,'SACCO statements layout, version 1','Draft','Draft prepared from the usual structure of SACCO financial statements and the section-10 list in the legal report. The Mkopo specimen was not available when it was written. A Partner must read every caption, total and note before approving it.');

INSERT INTO erp_private.sacco_layout_lines(layout_id,line_code,statement,section,caption,detail,kind,side,total_of,roles,unit,auto_key,sort_order)
SELECT (SELECT layout_id FROM erp_private.sacco_layouts WHERE version=1),v.code,v.stmt,v.sec,v.cap,v.detail,v.kind,v.side,v.total_of,v.roles,v.unit,v.auto_key,v.ord
FROM (VALUES
 ('A.CASH','Financial position','Assets','Cash and cash equivalents','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1010),
 ('A.INVEST','Financial position','Assets','Investments and placements with financial institutions','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1020),
 ('A.LOANS','Financial position','Assets','Loans and advances to members (gross)','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1030),
 ('A.ECL','Financial position','Assets','Allowance for expected credit losses','Contra account. A credit balance shows in brackets.', 'Line','Debit',ARRAY[]::text[],ARRAY['ECL_ALLOWANCE'],NULL,NULL,1040),
 ('A.RECEIV','Financial position','Assets','Receivables and prepayments','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1050),
 ('A.INVPROP','Financial position','Assets','Investment property','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1060),
 ('A.PPE','Financial position','Assets','Property and equipment','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1070),
 ('A.INTANG','Financial position','Assets','Intangible assets','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1080),
 ('A.OTHER','Financial position','Assets','Other assets','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1090),
 ('A.TOTAL','Financial position','Assets','Total assets','', 'Total',NULL,ARRAY['A.CASH','A.INVEST','A.LOANS','A.ECL','A.RECEIV','A.INVPROP','A.PPE','A.INTANG','A.OTHER'],ARRAY['TOTAL_ASSETS'],NULL,NULL,1099),
 ('L.DEPOSITS','Financial position','Liabilities','Member deposits','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1110),
 ('L.BORROW','Financial position','Liabilities','Borrowings','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1120),
 ('L.PAYABLES','Financial position','Liabilities','Payables and accruals','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1130),
 ('L.DIVPAY','Financial position','Liabilities','Dividends and interest payable to members','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1140),
 ('L.OTHER','Financial position','Liabilities','Other liabilities','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,1150),
 ('L.TOTAL','Financial position','Liabilities','Total liabilities','', 'Total',NULL,ARRAY['L.DEPOSITS','L.BORROW','L.PAYABLES','L.DIVPAY','L.OTHER'],ARRAY[]::text[],NULL,NULL,1199),
 ('E.SHARE','Financial position','Equity','Share capital','', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN'],NULL,NULL,1210),
 ('E.STATUTORY','Financial position','Equity','Statutory reserve','', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN'],NULL,NULL,1220),
 ('E.INSTITUTIONAL','Financial position','Equity','Institutional capital','', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN'],NULL,NULL,1230),
 ('E.REVAL','Financial position','Equity','Revaluation reserve','', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN'],NULL,NULL,1240),
 ('E.OTHERRES','Financial position','Equity','Other reserves','', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN'],NULL,NULL,1250),
 ('E.RETAINED','Financial position','Equity','Retained earnings','The surplus for the year is added to this column in the statement of changes in equity.', 'Line','Credit',ARRAY[]::text[],ARRAY['EQUITY_COLUMN','SURPLUS_COLUMN'],NULL,NULL,1260),
 ('E.SURPLUS','Financial position','Equity','Surplus for the year','', 'Total',NULL,ARRAY['P.SURPLUS'],ARRAY[]::text[],NULL,NULL,1270),
 ('E.TOTAL','Financial position','Equity','Total equity','', 'Total',NULL,ARRAY['E.SHARE','E.STATUTORY','E.INSTITUTIONAL','E.REVAL','E.OTHERRES','E.RETAINED','E.SURPLUS'],ARRAY[]::text[],NULL,NULL,1299),
 ('LE.TOTAL','Financial position','Total','Total liabilities and equity','', 'Total',NULL,ARRAY['L.TOTAL','E.TOTAL'],ARRAY['TOTAL_LIABILITIES_EQUITY'],NULL,NULL,1300),
 ('I.LOANS','Income statement','Income','Interest income on loans to members','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2010),
 ('I.INVEST','Income statement','Income','Interest and investment income','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2020),
 ('I.FEES','Income statement','Income','Fees and commissions','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2030),
 ('I.OTHER','Income statement','Income','Other operating income','', 'Line','Credit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2040),
 ('I.TOTAL','Income statement','Income','Total income','', 'Total',NULL,ARRAY['I.LOANS','I.INVEST','I.FEES','I.OTHER'],ARRAY[]::text[],NULL,NULL,2099),
 ('X.DEPINT','Income statement','Expenses','Interest on member deposits','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2110),
 ('X.BORINT','Income statement','Expenses','Interest on borrowings','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2120),
 ('X.ECL','Income statement','Expenses','Impairment charge on loans','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2130),
 ('X.STAFF','Income statement','Expenses','Staff costs','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2140),
 ('X.ADMIN','Income statement','Expenses','Administrative and general expenses','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2150),
 ('X.DEPREC','Income statement','Expenses','Depreciation and amortisation','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2160),
 ('X.OTHER','Income statement','Expenses','Other expenses','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2170),
 ('X.TAX','Income statement','Expenses','Income tax expense','', 'Line','Debit',ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,2180),
 ('X.TOTAL','Income statement','Expenses','Total expenses','', 'Total',NULL,ARRAY['X.DEPINT','X.BORINT','X.ECL','X.STAFF','X.ADMIN','X.DEPREC','X.OTHER','X.TAX'],ARRAY[]::text[],NULL,NULL,2199),
 ('P.SURPLUS','Income statement','Result','Surplus for the year','', 'Total',NULL,ARRAY['I.TOTAL','-X.TOTAL'],ARRAY['SURPLUS'],NULL,NULL,2200),
 ('S.MEMBERS','Statistical','Statistics','Number of members at year end','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'Count',NULL,3010),
 ('S.ACTIVE','Statistical','Statistics','Number of active members','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'Count',NULL,3020),
 ('S.LOANACCTS','Statistical','Statistics','Number of loan accounts outstanding','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'Count',NULL,3030),
 ('S.EMPLOYEES','Statistical','Statistics','Number of employees','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'Count',NULL,3040),
 ('S.BRANCHES','Statistical','Statistics','Number of branches and offices','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'Count',NULL,3050),
 ('S.NPL','Statistical','Statistics','Non-performing loans (gross amount)','', 'Statistic',NULL,ARRAY[]::text[],ARRAY[]::text[],'KES',NULL,3060),
 ('S.PRUDPROV','Statistical','Statistics','Loan loss provision required by the prudential rules','Enter the amount calculated under the regulator''s rules, with the source.', 'Statistic',NULL,ARRAY[]::text[],ARRAY['PRUDENTIAL_PROVISION'],'KES',NULL,3070),
 ('C.LEGAL','Disclosure','Section 10','Legal framework note','A note naming the laws and regulations the SACCO operates under and its licence status, agreed to the registration and licence documents.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,4010),
 ('C.DIRECTORS','Disclosure','Section 10','Directors'' statement','The directors'' statement of responsibility and approval of the statements, signed and dated.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,4020),
 ('C.REGREPORT','Disclosure','Section 10','Separate regulatory report','Any separate report the regulator requires, drafted and reviewed.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,4030),
 ('C.CAPLIQ','Disclosure','Section 10','Capital and liquidity schedules','Schedules prepared from the figures entered on the SASRA and quality tab.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,'CAPITAL_FIGURES',4040),
 ('C.ECL','Disclosure','Section 10','Expected credit loss against prudential provision','Reconcile the expected credit loss allowance to the provision required by the prudential rules, and record how any difference is treated.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,'ECL_PRUDENTIAL',4050),
 ('C.AML','Disclosure','Section 10','AML, CFT and CPF compliance','Review of the SACCO''s compliance with anti-money-laundering, counter-terrorist-financing and counter-proliferation-financing requirements.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,NULL,4060),
 ('C.DIVRES','Disclosure','Section 10','Dividends and reserves','Dividends, interest on shares and transfers to reserves agreed to the members'' resolution and to the reserve rules.', 'Check',NULL,ARRAY[]::text[],ARRAY[]::text[],NULL,'EQUITY_RECONCILES',4070)
) v(code,stmt,sec,cap,detail,kind,side,total_of,roles,unit,auto_key,ord);

-- ---- Layout helpers ----------------------------------------------------------------------------------------------------------------
-- The layout the statements use: the approved one, else the draft.
CREATE FUNCTION erp_private.sacco_layout_use() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT layout_id FROM erp_private.sacco_layouts ORDER BY (status='Approved') DESC,(status='Draft') DESC,version DESC LIMIT 1;
$$;

-- First problem that stops a layout being approved, or null.
CREATE FUNCTION erp_private.sacco_layout_validate(p_layout uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record;resolved text[]:=ARRAY[]::text[];pass integer;grew boolean;ref text;ok boolean;n integer;role text;
BEGIN
 FOREACH role IN ARRAY ARRAY['TOTAL_ASSETS','TOTAL_LIABILITIES_EQUITY','SURPLUS','SURPLUS_COLUMN'] LOOP
  SELECT count(*) INTO n FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY[role];
  IF n<>1 THEN RETURN 'Exactly one line must carry the role '||role||' (found '||n||')'; END IF;
 END LOOP;
 SELECT count(*) INTO n FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['EQUITY_COLUMN'];
 IF n<1 THEN RETURN 'At least one equity line must be marked as an equity column'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['SURPLUS_COLUMN'] AND NOT roles @> ARRAY['EQUITY_COLUMN']) THEN RETURN 'The surplus column must also be an equity column'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['EQUITY_COLUMN'] AND (kind<>'Line' OR side<>'Credit' OR statement<>'Financial position')) THEN RETURN 'Equity columns must be credit-side lines of the statement of financial position'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['SURPLUS'] AND kind<>'Total') THEN RETURN 'The surplus must be a total'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['ECL_ALLOWANCE'] AND kind<>'Line') THEN RETURN 'The expected credit loss allowance must be a line'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND roles @> ARRAY['PRUDENTIAL_PROVISION'] AND kind<>'Statistic') THEN RETURN 'The prudential provision must be a statistic'; END IF;
 SELECT array_agg(line_code) INTO resolved FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND kind='Line';
 resolved:=COALESCE(resolved,ARRAY[]::text[]);
 FOR pass IN 1..30 LOOP
  grew:=false;
  FOR r IN SELECT * FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND kind='Total' AND NOT (line_code=ANY(resolved)) LOOP
   ok:=true;
   FOREACH ref IN ARRAY r.total_of LOOP
    IF NOT (ltrim(ref,'-')=ANY(resolved)) THEN ok:=false; EXIT; END IF;
   END LOOP;
   IF ok THEN resolved:=array_append(resolved,r.line_code); grew:=true; END IF;
  END LOOP;
  EXIT WHEN NOT grew;
 END LOOP;
 SELECT line_code INTO ref FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND kind='Total' AND NOT (line_code=ANY(resolved)) ORDER BY sort_order LIMIT 1;
 IF ref IS NOT NULL THEN RETURN 'Total '||ref||' refers to a line that does not exist, is a statistic or check, or depends on itself'; END IF;
 SELECT m.line_code INTO ref FROM erp_private.sacco_line_map m WHERE NOT EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines l WHERE l.layout_id=p_layout AND l.line_code=m.line_code AND l.kind='Line') LIMIT 1;
 IF ref IS NOT NULL THEN RETURN 'Accounts are mapped to '||ref||', which is not a line in this layout. Remap them first'; END IF;
 RETURN NULL;
END $$;

-- ---- Account rows: each audit account on the file with its balances and its layout line ------------------------------------------------
CREATE FUNCTION erp_private.sacco_account_rows(p_file uuid) RETURNS TABLE(audit_account_id uuid,account_code text,account_name text,audit_area text,financial_statement_line text,cur_net numeric,cmp_net numeric,line_code text,map_status text,proposed_by uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 WITH cur AS (SELECT t.audit_account_id aid,sum(t.adjusted_net) net FROM erp_private.audit_adjusted_tb_calc(p_file) t GROUP BY 1),
 cmp AS (SELECT l.audit_account_id aid,sum(l.source_debit-l.source_credit) net FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id
   WHERE i.audit_file_id=p_file AND i.period_kind='Comparative' AND i.status='Confirmed' AND l.audit_account_id IS NOT NULL GROUP BY 1),
 ids AS (SELECT aid FROM cur UNION SELECT aid FROM cmp)
 SELECT m.audit_account_id,m.legacy_account_code,m.legacy_account_name,m.audit_area,m.financial_statement_line,COALESCE(cur.net,0),cmp.net,s.line_code,s.status,s.proposed_by
 FROM ids JOIN erp_private.audit_account_mappings m ON m.audit_account_id=ids.aid LEFT JOIN cur ON cur.aid=ids.aid LEFT JOIN cmp ON cmp.aid=ids.aid
 LEFT JOIN erp_private.sacco_line_map s ON s.audit_account_id=ids.aid
 ORDER BY m.legacy_account_code;
$$;

-- ---- The statements ----------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.sacco_fs_calc(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;c erp_private.clients;lay erp_private.sacco_layouts;
 v_cur jsonb:='{}'::jsonb;v_cmp jsonb:='{}'::jsonb;v_tmp jsonb;has_cmp boolean;r record;ref text;v_code text;sg integer;tot numeric;totc numeric;ok boolean;pass integer;grew boolean;
 blocking jsonb:='[]'::jsonb;warnings jsonb:='[]'::jsonb;code_ta text;code_tle text;code_sur text;code_ecl text;code_prud text;
 v_surplus numeric;v_ta numeric;v_tle numeric;v_diff numeric;position_s jsonb;income_s jsonb;soce jsonb;soce_diff numeric;stats jsonb;checks jsonb;ratios jsonb;
 n_unmapped integer;n_unapproved integer;unmapped_names text;n_stat_missing integer;transfers numeric;
 sup_eq jsonb;sup_ecl jsonb;sup_cap jsonb;ecl numeric;prud numeric;figs integer;figs_in integer;unmapped_tb integer;prob text;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 SELECT * INTO c FROM erp_private.clients WHERE client_id=f.client_id;
 SELECT * INTO lay FROM erp_private.sacco_layouts WHERE layout_id=erp_private.sacco_layout_use();
 IF lay.layout_id IS NULL THEN RETURN jsonb_build_object('layout','SACCO','blocking',to_jsonb(ARRAY['No SACCO statement layout exists.']),'warnings','[]'::jsonb); END IF;
 has_cmp:=EXISTS(SELECT 1 FROM erp_private.audit_tb_imports i WHERE i.audit_file_id=p_file AND i.period_kind='Comparative' AND i.status='Confirmed');
 IF lay.status<>'Approved' THEN blocking:=blocking||to_jsonb('The SACCO statement layout (version '||lay.version||') is still a draft. A Partner must approve it.'::text); END IF;
 prob:=erp_private.sacco_layout_validate(lay.layout_id);
 IF prob IS NOT NULL THEN blocking:=blocking||to_jsonb(('Layout problem: '||prob)::text); END IF;

 -- Line values: debit-side lines are debit minus credit, credit-side lines the reverse.
 SELECT COALESCE(jsonb_object_agg(line_code,0),'{}'::jsonb) INTO v_cur FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND kind='Line';
 SELECT COALESCE(jsonb_object_agg(q.line_code,round(q.v,2)),'{}'::jsonb) INTO v_tmp FROM (
  SELECT l.line_code,sum(a.cur_net*CASE l.side WHEN 'Credit' THEN -1 ELSE 1 END) v FROM erp_private.sacco_account_rows(p_file) a
  JOIN erp_private.sacco_layout_lines l ON l.layout_id=lay.layout_id AND l.line_code=a.line_code AND l.kind='Line' GROUP BY l.line_code) q;
 v_cur:=v_cur||v_tmp;
 IF has_cmp THEN
  SELECT COALESCE(jsonb_object_agg(line_code,0),'{}'::jsonb) INTO v_cmp FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND kind='Line';
  SELECT COALESCE(jsonb_object_agg(q.line_code,round(q.v,2)),'{}'::jsonb) INTO v_tmp FROM (
   SELECT l.line_code,sum(a.cmp_net*CASE l.side WHEN 'Credit' THEN -1 ELSE 1 END) v FROM erp_private.sacco_account_rows(p_file) a
   JOIN erp_private.sacco_layout_lines l ON l.layout_id=lay.layout_id AND l.line_code=a.line_code AND l.kind='Line' WHERE a.cmp_net IS NOT NULL GROUP BY l.line_code) q;
  v_cmp:=v_cmp||v_tmp;
 END IF;
 FOR pass IN 1..30 LOOP
  grew:=false;
  FOR r IN SELECT * FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND kind='Total' ORDER BY sort_order LOOP
   IF v_cur ? r.line_code THEN CONTINUE; END IF;
   ok:=true;tot:=0;totc:=0;
   FOREACH ref IN ARRAY r.total_of LOOP
    sg:=CASE WHEN left(ref,1)='-' THEN -1 ELSE 1 END;v_code:=ltrim(ref,'-');
    IF NOT (v_cur ? v_code) THEN ok:=false; EXIT; END IF;
    tot:=tot+sg*(v_cur->>v_code)::numeric;
    IF has_cmp THEN totc:=totc+sg*COALESCE((v_cmp->>v_code)::numeric,0); END IF;
   END LOOP;
   IF ok THEN v_cur:=v_cur||jsonb_build_object(r.line_code,round(tot,2)); IF has_cmp THEN v_cmp:=v_cmp||jsonb_build_object(r.line_code,round(totc,2)); END IF; grew:=true; END IF;
  END LOOP;
  EXIT WHEN NOT grew;
 END LOOP;

 SELECT line_code INTO code_ta FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND roles @> ARRAY['TOTAL_ASSETS'] LIMIT 1;
 SELECT line_code INTO code_tle FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND roles @> ARRAY['TOTAL_LIABILITIES_EQUITY'] LIMIT 1;
 SELECT line_code INTO code_sur FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND roles @> ARRAY['SURPLUS'] LIMIT 1;
 SELECT line_code INTO code_ecl FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND roles @> ARRAY['ECL_ALLOWANCE'] LIMIT 1;
 SELECT line_code INTO code_prud FROM erp_private.sacco_layout_lines WHERE layout_id=lay.layout_id AND roles @> ARRAY['PRUDENTIAL_PROVISION'] LIMIT 1;
 v_ta:=COALESCE((v_cur->>code_ta)::numeric,0);v_tle:=COALESCE((v_cur->>code_tle)::numeric,0);v_surplus:=COALESCE((v_cur->>code_sur)::numeric,0);v_diff:=round(v_ta-v_tle,2);

 position_s:=COALESCE((SELECT jsonb_agg(jsonb_build_object('section',s.sec,'lines',s.lns) ORDER BY s.mn) FROM (
   SELECT l.section sec,min(l.sort_order) mn,jsonb_agg(jsonb_build_object('code',l.line_code,'caption',l.caption,'kind',l.kind,'current',v_cur->l.line_code,'comparative',CASE WHEN has_cmp THEN v_cmp->l.line_code END) ORDER BY l.sort_order) lns
   FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.statement='Financial position' GROUP BY l.section) s),'[]'::jsonb);
 income_s:=COALESCE((SELECT jsonb_agg(jsonb_build_object('section',s.sec,'lines',s.lns) ORDER BY s.mn) FROM (
   SELECT l.section sec,min(l.sort_order) mn,jsonb_agg(jsonb_build_object('code',l.line_code,'caption',l.caption,'kind',l.kind,'current',v_cur->l.line_code,'comparative',CASE WHEN has_cmp THEN v_cmp->l.line_code END) ORDER BY l.sort_order) lns
   FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.statement='Income statement' GROUP BY l.section) s),'[]'::jsonb);

 -- Mapping problems
 SELECT count(*)::int,string_agg(a.account_code||' '||a.account_name,', ' ORDER BY a.account_code) FILTER (WHERE true) INTO n_unmapped,unmapped_names FROM erp_private.sacco_account_rows(p_file) a
  WHERE (abs(a.cur_net)>0 OR abs(COALESCE(a.cmp_net,0))>0) AND NOT EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.line_code=a.line_code AND l.kind='Line');
 IF n_unmapped>0 THEN blocking:=blocking||to_jsonb((n_unmapped||' account'||CASE WHEN n_unmapped=1 THEN '' ELSE 's' END||' with balances '||CASE WHEN n_unmapped=1 THEN 'is' ELSE 'are' END||' not mapped to a statement line: '||left(unmapped_names,160)||CASE WHEN length(unmapped_names)>160 THEN '...' ELSE '' END)::text); END IF;
 SELECT count(*)::int INTO n_unapproved FROM erp_private.sacco_account_rows(p_file) a WHERE (abs(a.cur_net)>0 OR abs(COALESCE(a.cmp_net,0))>0) AND a.map_status='Proposed'
  AND EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.line_code=a.line_code AND l.kind='Line');
 IF n_unapproved>0 THEN blocking:=blocking||to_jsonb((n_unapproved||' mapped account'||CASE WHEN n_unapproved=1 THEN ' is' ELSE 's are' END||' waiting for Partner approval of the mapping.')::text); END IF;
 SELECT count(*)::int INTO unmapped_tb FROM erp_private.audit_tb_lines l JOIN erp_private.audit_tb_imports i ON i.audit_tb_import_id=l.audit_tb_import_id WHERE i.audit_file_id=p_file AND i.period_kind='Current' AND i.status='Confirmed' AND l.audit_account_id IS NULL;
 IF unmapped_tb>0 THEN blocking:=blocking||to_jsonb((unmapped_tb||' trial-balance line'||CASE WHEN unmapped_tb=1 THEN ' is' ELSE 's are' END||' not mapped to an audit account.')::text); END IF;
 IF v_diff<>0 THEN blocking:=blocking||to_jsonb(('The statement of financial position does not balance. Total assets less total liabilities and equity is '||v_diff::text||'.')::text); END IF;

 -- Statement of changes in equity: one column per reserve.
 WITH cols AS (SELECT l.line_code code,l.caption,l.sort_order,(l.roles @> ARRAY['SURPLUS_COLUMN']) is_s FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.roles @> ARRAY['EQUITY_COLUMN']),
 mv AS (SELECT m.line_code code,m.kind,sum(m.amount) amt FROM erp_private.sacco_equity_moves m WHERE m.audit_file_id=p_file AND m.status='Active' GROUP BY 1,2),
 base AS (SELECT cl.code,cl.caption,cl.sort_order,
   CASE WHEN has_cmp THEN COALESCE((v_cmp->>cl.code)::numeric,0)+CASE WHEN cl.is_s THEN COALESCE((v_cmp->>code_sur)::numeric,0) ELSE 0 END END opening,
   CASE WHEN cl.is_s THEN v_surplus ELSE 0 END surp,
   COALESCE((SELECT sum(mv.amt) FROM mv WHERE mv.code=cl.code),0) moves,
   COALESCE((v_cur->>cl.code)::numeric,0)+CASE WHEN cl.is_s THEN v_surplus ELSE 0 END closing
  FROM cols cl)
 SELECT jsonb_build_object('comparative_available',has_cmp,
   'columns',COALESCE((SELECT jsonb_agg(jsonb_build_object('code',b.code,'caption',b.caption) ORDER BY b.sort_order) FROM base b),'[]'::jsonb),
   'rows',jsonb_build_array(
    jsonb_build_object('key','opening','label','Balance at start of year','values',COALESCE((SELECT jsonb_object_agg(b.code,b.opening) FROM base b),'{}'::jsonb),'total',(SELECT sum(b.opening) FROM base b)),
    jsonb_build_object('key','surplus','label','Surplus for the year','values',COALESCE((SELECT jsonb_object_agg(b.code,b.surp) FROM base b),'{}'::jsonb),'total',(SELECT sum(b.surp) FROM base b)))
   ||COALESCE((SELECT jsonb_agg(jsonb_build_object('key','move','label',k.kind,
      'values',(SELECT jsonb_object_agg(b.code,COALESCE((SELECT mv.amt FROM mv WHERE mv.code=b.code AND mv.kind=k.kind),0)) FROM base b),'total',(SELECT sum(mv.amt) FROM mv WHERE mv.kind=k.kind)) ORDER BY k.kind) FROM (SELECT DISTINCT mv.kind FROM mv) k),'[]'::jsonb)
   ||jsonb_build_array(
    jsonb_build_object('key','expected','label','Expected balance at end of year','values',COALESCE((SELECT jsonb_object_agg(b.code,b.opening+b.surp+b.moves) FROM base b),'{}'::jsonb),'total',(SELECT sum(b.opening+b.surp+b.moves) FROM base b)),
    jsonb_build_object('key','closing','label','Balance at end of year (trial balance)','values',COALESCE((SELECT jsonb_object_agg(b.code,b.closing) FROM base b),'{}'::jsonb),'total',(SELECT sum(b.closing) FROM base b)),
    jsonb_build_object('key','difference','label','Unexplained difference','values',COALESCE((SELECT jsonb_object_agg(b.code,round(b.closing-(b.opening+b.surp+b.moves),2)) FROM base b),'{}'::jsonb),'total',(SELECT round(sum(b.closing-(b.opening+b.surp+b.moves)),2) FROM base b)))),
  (SELECT max(abs(round(b.closing-(b.opening+b.surp+b.moves),2))) FROM base b)
 INTO soce,soce_diff;
 IF has_cmp AND COALESCE(soce_diff,0)<>0 THEN blocking:=blocking||to_jsonb(('The statement of changes in equity does not reconcile. The largest unexplained difference in a reserve is '||soce_diff::text||'. Record the transfers, dividends or share movements that explain it.')::text); END IF;
 IF NOT has_cmp THEN warnings:=warnings||to_jsonb('No comparative trial balance is confirmed, so opening reserves and prior-year figures are not shown and the equity movements cannot be reconciled.'::text); END IF;
 SELECT COALESCE(sum(amount),0) INTO transfers FROM erp_private.sacco_equity_moves WHERE audit_file_id=p_file AND status='Active' AND kind='Transfer to or from reserve';
 IF transfers<>0 THEN blocking:=blocking||to_jsonb(('Transfers between reserves do not net to zero (difference '||transfers::text||').')::text); END IF;

 -- Statistics
 stats:=COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.line_code,'caption',l.caption,'detail',l.detail,'unit',l.unit,'value',g.amount,'source_note',g.source_note,'entered_at',g.entered_at,'entered_by_name',s.full_name) ORDER BY l.sort_order)
   FROM erp_private.sacco_layout_lines l LEFT JOIN LATERAL (SELECT x.* FROM erp_private.sacco_file_values x WHERE x.audit_file_id=p_file AND x.line_code=l.line_code ORDER BY x.entered_at DESC,x.value_id LIMIT 1) g ON true
   LEFT JOIN erp_private.staff_members s ON s.staff_id=g.entered_by WHERE l.layout_id=lay.layout_id AND l.kind='Statistic'),'[]'::jsonb);
 SELECT count(*)::int INTO n_stat_missing FROM jsonb_array_elements(stats) x WHERE x->'value' IS NULL OR x->>'value' IS NULL;
 IF n_stat_missing>0 THEN warnings:=warnings||to_jsonb((n_stat_missing||' statistic'||CASE WHEN n_stat_missing=1 THEN ' has' ELSE 's have' END||' no value yet.')::text); END IF;
 ratios:=erp_private.sasra_breach_check(p_file);

 -- Support shown beside the section-10 items
 sup_eq:=CASE WHEN NOT has_cmp THEN jsonb_build_object('state','attention','text','No comparative trial balance, so reserve movements cannot be reconciled.')
   WHEN COALESCE(soce_diff,0)=0 AND transfers=0 THEN jsonb_build_object('state','ok','text','Recorded movements explain the change in every reserve.')
   ELSE jsonb_build_object('state','attention','text','Unexplained difference in a reserve: '||COALESCE(soce_diff,0)::text||'; transfers net '||transfers::text||'.') END;
 ecl:=CASE WHEN code_ecl IS NULL THEN NULL ELSE -COALESCE((v_cur->>code_ecl)::numeric,0) END;
 SELECT g.amount INTO prud FROM erp_private.sacco_file_values g WHERE g.audit_file_id=p_file AND g.line_code=code_prud ORDER BY g.entered_at DESC,g.value_id LIMIT 1;
 sup_ecl:=CASE WHEN ecl IS NULL OR code_prud IS NULL THEN jsonb_build_object('state','attention','text','The layout has no expected credit loss line or prudential provision statistic.')
   WHEN prud IS NULL THEN jsonb_build_object('state','attention','text','Enter the prudential provision under Statistics. Expected credit loss allowance in the accounts: '||ecl::text||'.')
   WHEN round(prud-ecl,2)=0 THEN jsonb_build_object('state','ok','text','Prudential provision and expected credit loss allowance agree at '||ecl::text||'.')
   ELSE jsonb_build_object('state','attention','text','Prudential provision '||prud::text||', expected credit loss allowance '||ecl::text||', difference (prudential less allowance) '||round(prud-ecl,2)::text||'. A Partner decides how the difference is treated.') END;
 SELECT count(*)::int,count(*) FILTER (WHERE EXISTS(SELECT 1 FROM erp_private.sasra_file_figures g WHERE g.audit_file_id=p_file AND g.line_code=sl.line_code))::int INTO figs,figs_in FROM erp_private.sasra_figure_lines sl;
 sup_cap:=CASE WHEN figs=0 THEN jsonb_build_object('state','attention','text','No SASRA figure lines are defined yet.')
   WHEN figs_in=figs THEN jsonb_build_object('state','ok','text','All '||figs||' SASRA figure lines have an amount on this file.')
   ELSE jsonb_build_object('state','attention','text',figs_in||' of '||figs||' SASRA figure lines have an amount on this file.') END;
 checks:=COALESCE((SELECT jsonb_agg(jsonb_build_object('code',l.line_code,'caption',l.caption,'detail',l.detail,'auto_key',l.auto_key,
    'support',CASE l.auto_key WHEN 'EQUITY_RECONCILES' THEN sup_eq WHEN 'ECL_PRUDENTIAL' THEN sup_ecl WHEN 'CAPITAL_FIGURES' THEN sup_cap END,
    'status',COALESCE(k.status,'Open'),'applicable',COALESCE(k.applicable,true),'note',COALESCE(k.note,''),'prepared_by',k.prepared_by,'prepared_by_name',ps.full_name,'prepared_at',k.prepared_at,
    'reviewer_name',rs.full_name,'reviewed_at',k.reviewed_at,'review_note',COALESCE(k.review_note,'')) ORDER BY l.sort_order)
   FROM erp_private.sacco_layout_lines l LEFT JOIN erp_private.sacco_file_checks k ON k.audit_file_id=p_file AND k.line_code=l.line_code
   LEFT JOIN erp_private.staff_members ps ON ps.staff_id=k.prepared_by LEFT JOIN erp_private.staff_members rs ON rs.staff_id=k.reviewer_id WHERE l.layout_id=lay.layout_id AND l.kind='Check'),'[]'::jsonb);

 RETURN jsonb_build_object('layout','SACCO','statement','Financial statements','entity',c.company_name,'framework',f.reporting_framework,'framework_status',f.framework_status,'period_start',f.starts_on,'period_end',f.ends_on,
  'layout_id',lay.layout_id,'layout_version',lay.version,'layout_status',lay.status,'comparative_available',has_cmp,
  'position',position_s,'income',income_s,'soce',soce,'statistics',stats,'ratios',COALESCE(ratios,'[]'::jsonb),'checks',checks,
  'totals',jsonb_build_object('total_assets',v_ta,'total_liabilities_and_equity',v_tle,'surplus_for_the_year',v_surplus,'difference',v_diff),
  'balances',v_diff=0,'blocking',blocking,'warnings',warnings,
  'note','Draft prepared from the adjusted trial balance using the SACCO statement layout. A Partner must confirm the presentation, the notes and the section-10 matters before issue.');
END $$;

-- Route the general "Financial statements" report: a SACCO file uses the SACCO statements.
ALTER FUNCTION erp_private.audit_fs_calc(uuid) RENAME TO audit_fs_calc_standard;
CREATE FUNCTION erp_private.audit_fs_calc(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cid uuid;
BEGIN
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF erp_private.client_sacco_type(cid)<>'NOT_SACCO' THEN
  RETURN erp_private.sacco_fs_calc(p_file)-'checks';
 END IF;
 RETURN erp_private.audit_fs_calc_standard(p_file);
END $$;

-- What the SACCO statements are built on, beyond the trial balance: the layout, the account map, the movements and the statistics.
CREATE FUNCTION erp_private.sacco_basis_text(p_file uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT layout_id::text||':'||revision::text||':'||status FROM erp_private.sacco_layouts WHERE layout_id=erp_private.sacco_layout_use()),'')
  ||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(a.audit_account_id,a.line_code,a.map_status) ORDER BY a.audit_account_id)::text FROM erp_private.sacco_account_rows(p_file) a),'[]')
  ||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(m.move_id,m.line_code,m.kind,m.amount) ORDER BY m.move_id)::text FROM erp_private.sacco_equity_moves m WHERE m.audit_file_id=p_file AND m.status='Active'),'[]')
  ||'|'||COALESCE((SELECT jsonb_agg(jsonb_build_array(g.line_code,g.amount) ORDER BY g.line_code)::text FROM (SELECT DISTINCT ON (x.line_code) x.line_code,x.amount FROM erp_private.sacco_file_values x WHERE x.audit_file_id=p_file ORDER BY x.line_code,x.entered_at DESC,x.value_id) g),'[]');
$$;

ALTER FUNCTION erp_private.audit_report_basis(uuid,text) RENAME TO audit_report_basis_standard;
CREATE FUNCTION erp_private.audit_report_basis(p_file uuid,p_kind text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s text;cid uuid;
BEGIN
 s:=erp_private.audit_report_basis_standard(p_file,p_kind);
 IF p_kind='Financial statements' THEN
  SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=p_file;
  IF erp_private.client_sacco_type(cid)<>'NOT_SACCO' THEN s:=encode(sha256(convert_to(s||'|'||erp_private.sacco_basis_text(p_file),'UTF8')),'hex'); END IF;
 END IF;
 RETURN s;
END $$;

-- A SACCO statements report cannot be submitted while anything blocks it.
CREATE FUNCTION erp_private.sacco_report_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cid uuid;blk jsonb;
BEGIN
 IF NEW.kind<>'Financial statements' OR NEW.status<>'Submitted' OR OLD.status IS NOT DISTINCT FROM 'Submitted' THEN RETURN NEW; END IF;
 SELECT client_id INTO cid FROM erp_private.audit_files WHERE audit_file_id=NEW.audit_file_id;
 IF erp_private.client_sacco_type(cid)='NOT_SACCO' THEN RETURN NEW; END IF;
 blk:=erp_private.sacco_fs_calc(NEW.audit_file_id)->'blocking';
 IF jsonb_array_length(COALESCE(blk,'[]'::jsonb))>0 THEN RAISE EXCEPTION 'The SACCO statements are not ready to submit: %',(SELECT string_agg(x,' ') FROM (SELECT jsonb_array_elements_text(blk) x LIMIT 3) q) USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER sacco_report_guard BEFORE UPDATE OF status ON erp_private.audit_reports FOR EACH ROW EXECUTE FUNCTION erp_private.sacco_report_guard();

-- ---- Writes ------------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.sacco_file_for_write(p_file uuid) RETURNS erp_private.audit_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF f.audit_file_id IS NULL THEN RAISE EXCEPTION 'Audit file unavailable' USING ERRCODE='42501'; END IF;
 IF f.file_status IN('Approved','Completion','Archived') THEN RAISE EXCEPTION 'The audit file is closed to changes' USING ERRCODE='23514'; END IF;
 IF erp_private.client_sacco_type(f.client_id)='NOT_SACCO' THEN RAISE EXCEPTION 'This file is not for a SACCO' USING ERRCODE='23514'; END IF;
 RETURN f;
END $$;

CREATE FUNCTION erp_private.sacco_layout_copy() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;src erp_private.sacco_layouts;nid uuid;nv integer;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can start a new layout version' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layouts WHERE status='Draft') THEN RAISE EXCEPTION 'There is already a draft layout. Finish or approve it first' USING ERRCODE='23514'; END IF;
 SELECT * INTO src FROM erp_private.sacco_layouts ORDER BY (status='Approved') DESC,version DESC LIMIT 1;
 SELECT max(version)+1 INTO nv FROM erp_private.sacco_layouts;
 INSERT INTO erp_private.sacco_layouts(version,title,status,source_note,created_by) VALUES(nv,'SACCO statements layout, version '||nv,'Draft','Copied from version '||src.version||'. A Partner must approve it before the statements use it.',a.staff_id) RETURNING layout_id INTO nid;
 INSERT INTO erp_private.sacco_layout_lines(layout_id,line_code,statement,section,caption,detail,kind,side,total_of,roles,unit,auto_key,sort_order)
  SELECT nid,line_code,statement,section,caption,detail,kind,side,total_of,roles,unit,auto_key,sort_order FROM erp_private.sacco_layout_lines WHERE layout_id=src.layout_id;
 RETURN nid;
END $$;

CREATE FUNCTION erp_private.sacco_layout_line_save(p_layout uuid,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;lay erp_private.sacco_layouts;code text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the layout' USING ERRCODE='42501'; END IF;
 SELECT * INTO lay FROM erp_private.sacco_layouts WHERE layout_id=p_layout FOR UPDATE;
 IF lay.layout_id IS NULL OR lay.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft layout can be edited' USING ERRCODE='23514'; END IF;
 code:=upper(btrim(p->>'line_code'));
 INSERT INTO erp_private.sacco_layout_lines(layout_id,line_code,statement,section,caption,detail,kind,side,total_of,roles,unit,auto_key,sort_order)
 VALUES(p_layout,code,p->>'statement',btrim(p->>'section'),btrim(p->>'caption'),btrim(COALESCE(p->>'detail','')),p->>'kind',NULLIF(p->>'side',''),
  COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'total_of','[]'::jsonb))),ARRAY[]::text[]),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p->'roles','[]'::jsonb))),ARRAY[]::text[]),
  NULLIF(p->>'unit',''),NULLIF(p->>'auto_key',''),(p->>'sort_order')::integer)
 ON CONFLICT (layout_id,line_code) DO UPDATE SET statement=EXCLUDED.statement,section=EXCLUDED.section,caption=EXCLUDED.caption,detail=EXCLUDED.detail,kind=EXCLUDED.kind,side=EXCLUDED.side,
  total_of=EXCLUDED.total_of,roles=EXCLUDED.roles,unit=EXCLUDED.unit,auto_key=EXCLUDED.auto_key,sort_order=EXCLUDED.sort_order;
 UPDATE erp_private.sacco_layouts SET updated_at=now() WHERE layout_id=p_layout;
 RETURN jsonb_build_object('ok',true,'line_code',code);
END $$;

CREATE FUNCTION erp_private.sacco_layout_line_remove(p_layout uuid,p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;lay erp_private.sacco_layouts;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner can edit the layout' USING ERRCODE='42501'; END IF;
 SELECT * INTO lay FROM erp_private.sacco_layouts WHERE layout_id=p_layout FOR UPDATE;
 IF lay.layout_id IS NULL OR lay.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft layout can be edited' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines l WHERE l.layout_id=p_layout AND (p_code=ANY(l.total_of) OR ('-'||p_code)=ANY(l.total_of))) THEN RAISE EXCEPTION 'A total still uses this line. Change the total first' USING ERRCODE='23514'; END IF;
 DELETE FROM erp_private.sacco_layout_lines WHERE layout_id=p_layout AND line_code=p_code;
 UPDATE erp_private.sacco_layouts SET updated_at=now() WHERE layout_id=p_layout;
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sacco_layout_approve(p_layout uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;lay erp_private.sacco_layouts;prob text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve the SACCO statement layout' USING ERRCODE='42501'; END IF;
 SELECT * INTO lay FROM erp_private.sacco_layouts WHERE layout_id=p_layout FOR UPDATE;
 IF lay.layout_id IS NULL OR lay.status<>'Draft' THEN RAISE EXCEPTION 'Only a draft layout can be approved' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what you checked, in at least 10 characters' USING ERRCODE='23514'; END IF;
 prob:=erp_private.sacco_layout_validate(p_layout);
 IF prob IS NOT NULL THEN RAISE EXCEPTION '%',prob USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sacco_layouts SET status='Superseded' WHERE status='Approved';
 UPDATE erp_private.sacco_layouts SET status='Approved',approved_by=a.staff_id,approved_at=now(),approval_note=btrim(p_note) WHERE layout_id=p_layout;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Items: [{audit_account_id, line_code}] ; a null or empty line_code is refused. A Partner's mapping is approved on save.
CREATE FUNCTION erp_private.sacco_map_save(p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;it jsonb;acc erp_private.audit_account_mappings;lid uuid;n integer:=0;st text;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code='INTERN' THEN RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 THEN RAISE EXCEPTION 'Choose at least one account' USING ERRCODE='22023'; END IF;
 lid:=erp_private.sacco_layout_use();
 st:=CASE WHEN a.category_code='PARTNER' THEN 'Approved' ELSE 'Proposed' END;
 FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO acc FROM erp_private.audit_account_mappings WHERE audit_account_id=(it->>'audit_account_id')::uuid AND erp_private.firm_allowed(handling_firm_id);
  IF acc.audit_account_id IS NULL THEN RAISE EXCEPTION 'Account unavailable' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=lid AND line_code=it->>'line_code' AND kind='Line') THEN RAISE EXCEPTION 'Choose a statement line for %',acc.legacy_account_code USING ERRCODE='22023'; END IF;
  INSERT INTO erp_private.sacco_line_map(audit_account_id,handling_firm_id,line_code,status,proposed_by,approved_by,approved_at)
   VALUES(acc.audit_account_id,acc.handling_firm_id,it->>'line_code',st,a.staff_id,CASE WHEN st='Approved' THEN a.staff_id END,CASE WHEN st='Approved' THEN now() END)
  ON CONFLICT (audit_account_id) DO UPDATE SET line_code=EXCLUDED.line_code,status=EXCLUDED.status,proposed_by=EXCLUDED.proposed_by,approved_by=EXCLUDED.approved_by,approved_at=EXCLUDED.approved_at
   WHERE erp_private.sacco_line_map.line_code<>EXCLUDED.line_code OR (erp_private.sacco_line_map.status='Proposed' AND EXCLUDED.status='Approved');
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'saved',n,'status',st);
END $$;

CREATE FUNCTION erp_private.sacco_map_approve(p_accounts uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a erp_private.staff_members;n integer;
BEGIN
 a:=erp_private.actor();
 IF a.staff_id IS NULL OR a.category_code<>'PARTNER' THEN RAISE EXCEPTION 'Only a Partner can approve the account mapping' USING ERRCODE='42501'; END IF;
 UPDATE erp_private.sacco_line_map SET status='Approved',approved_by=a.staff_id,approved_at=now() WHERE audit_account_id=ANY(p_accounts) AND status='Proposed' AND erp_private.firm_allowed(handling_firm_id);
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN jsonb_build_object('ok',true,'approved',n);
END $$;

CREATE FUNCTION erp_private.sacco_value_save(p_file uuid,p_line text,p_amount numeric,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;l erp_private.sacco_layout_lines;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 SELECT * INTO l FROM erp_private.sacco_layout_lines WHERE layout_id=erp_private.sacco_layout_use() AND line_code=p_line AND kind='Statistic';
 IF l.line_code IS NULL THEN RAISE EXCEPTION 'Choose a statistic' USING ERRCODE='22023'; END IF;
 IF p_amount IS NULL OR p_amount<0 THEN RAISE EXCEPTION 'Enter an amount of zero or more' USING ERRCODE='23514'; END IF;
 IF l.unit='Count' AND p_amount<>trunc(p_amount) THEN RAISE EXCEPTION 'A count must be a whole number' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Record where the figure comes from (at least 5 characters)' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.sacco_file_values(audit_file_id,project_id,handling_firm_id,line_code,amount,source_note,entered_by) VALUES(f.audit_file_id,f.project_id,f.handling_firm_id,p_line,p_amount,btrim(p_note),a.staff_id);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sacco_move_save(p_file uuid,p_line text,p_kind text,p_amount numeric,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 IF NOT EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=erp_private.sacco_layout_use() AND line_code=p_line AND roles @> ARRAY['EQUITY_COLUMN']) THEN RAISE EXCEPTION 'Choose a reserve' USING ERRCODE='22023'; END IF;
 IF p_amount IS NULL OR p_amount=0 THEN RAISE EXCEPTION 'Enter the amount of the movement (negative for a decrease)' USING ERRCODE='23514'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Record what the movement is and where it is evidenced (at least 5 characters)' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.sacco_equity_moves(audit_file_id,project_id,handling_firm_id,line_code,kind,amount,note,entered_by) VALUES(f.audit_file_id,f.project_id,f.handling_firm_id,p_line,p_kind,p_amount,btrim(p_note),a.staff_id);
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sacco_move_withdraw(p_move uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE m erp_private.sacco_equity_moves;a erp_private.staff_members;
BEGIN
 SELECT * INTO m FROM erp_private.sacco_equity_moves WHERE move_id=p_move AND erp_private.project_allowed(project_id) FOR UPDATE;
 IF m.move_id IS NULL THEN RAISE EXCEPTION 'Movement unavailable' USING ERRCODE='42501'; END IF;
 PERFORM erp_private.sacco_file_for_write(m.audit_file_id);a:=erp_private.actor();
 IF m.status<>'Active' THEN RAISE EXCEPTION 'That movement is already withdrawn' USING ERRCODE='23514'; END IF;
 IF m.entered_by<>a.staff_id AND a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only the person who entered it, a Manager or a Partner can withdraw it' USING ERRCODE='42501'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Record why it is withdrawn (at least 5 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sacco_equity_moves SET status='Withdrawn',withdrawn_by=a.staff_id,withdrawn_at=now(),withdraw_note=btrim(p_note) WHERE move_id=p_move;
 RETURN jsonb_build_object('ok',true);
END $$;

-- Preparing a section-10 item: done (with a note) or not applicable (with the reason). Preparing again sends it back for review.
CREATE FUNCTION erp_private.sacco_check_prepare(p_file uuid,p_line text,p_applicable boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 IF NOT EXISTS(SELECT 1 FROM erp_private.sacco_layout_lines WHERE layout_id=erp_private.sacco_layout_use() AND line_code=p_line AND kind='Check') THEN RAISE EXCEPTION 'Choose a section-10 item' USING ERRCODE='22023'; END IF;
 IF length(btrim(COALESCE(p_note,'')))<10 THEN RAISE EXCEPTION 'Record what was done, or why the item does not apply, in at least 10 characters' USING ERRCODE='23514'; END IF;
 INSERT INTO erp_private.sacco_file_checks(audit_file_id,project_id,handling_firm_id,line_code,status,applicable,note,prepared_by)
  VALUES(f.audit_file_id,f.project_id,f.handling_firm_id,p_line,'Prepared',COALESCE(p_applicable,true),btrim(p_note),a.staff_id)
 ON CONFLICT (audit_file_id,line_code) DO UPDATE SET status='Prepared',applicable=EXCLUDED.applicable,note=EXCLUDED.note,prepared_by=EXCLUDED.prepared_by,prepared_at=now(),reviewer_id=NULL,reviewed_at=NULL,review_note='';
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE FUNCTION erp_private.sacco_check_review(p_file uuid,p_line text,p_accept boolean,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;a erp_private.staff_members;k erp_private.sacco_file_checks;
BEGIN
 f:=erp_private.sacco_file_for_write(p_file);a:=erp_private.actor();
 IF a.category_code NOT IN('MANAGER','PARTNER') THEN RAISE EXCEPTION 'Only a Manager or Partner reviews a section-10 item' USING ERRCODE='42501'; END IF;
 SELECT * INTO k FROM erp_private.sacco_file_checks WHERE audit_file_id=p_file AND line_code=p_line FOR UPDATE;
 IF k.check_id IS NULL OR k.status<>'Prepared' THEN RAISE EXCEPTION 'That item is not waiting for review' USING ERRCODE='23514'; END IF;
 IF k.prepared_by=a.staff_id THEN RAISE EXCEPTION 'You prepared this item, so someone else must review it' USING ERRCODE='42501'; END IF;
 IF NOT p_accept AND length(btrim(COALESCE(p_note,'')))<5 THEN RAISE EXCEPTION 'Say what needs to change (at least 5 characters)' USING ERRCODE='23514'; END IF;
 UPDATE erp_private.sacco_file_checks SET status=CASE WHEN p_accept THEN 'Reviewed' ELSE 'Returned' END,reviewer_id=a.staff_id,reviewed_at=now(),review_note=btrim(COALESCE(p_note,'')) WHERE check_id=k.check_id;
 IF NOT p_accept THEN INSERT INTO erp_private.notifications(recipient_id,message,event_key) VALUES(k.prepared_by,'A section-10 item was returned: '||left(btrim(p_note),150),'sacco-check-return:'||k.check_id::text||':'||k.revision::text) ON CONFLICT DO NOTHING; END IF;
 RETURN jsonb_build_object('ok',true);
END $$;

-- ---- Read for the screen -----------------------------------------------------------------------------------------------------------
CREATE FUNCTION erp_private.sacco_workspace(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;lid uuid;did uuid;
BEGIN
 IF (erp_private.actor()).staff_id IS NULL OR (erp_private.actor()).category_code='INTERN' THEN RETURN NULL; END IF;
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file AND erp_private.project_allowed(project_id);
 IF f.audit_file_id IS NULL OR erp_private.client_sacco_type(f.client_id)='NOT_SACCO' THEN RETURN NULL; END IF;
 lid:=erp_private.sacco_layout_use();
 SELECT layout_id INTO did FROM erp_private.sacco_layouts WHERE status='Draft' AND layout_id<>COALESCE(lid,'00000000-0000-0000-0000-000000000000'::uuid);
 RETURN jsonb_build_object(
  'layout',(SELECT to_jsonb(l)||jsonb_build_object('approved_by_name',s.full_name,'problem',erp_private.sacco_layout_validate(l.layout_id),
     'lines',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order) FROM erp_private.sacco_layout_lines x WHERE x.layout_id=l.layout_id),'[]'::jsonb))
    FROM erp_private.sacco_layouts l LEFT JOIN erp_private.staff_members s ON s.staff_id=l.approved_by WHERE l.layout_id=lid),
  'draft',(SELECT to_jsonb(l)||jsonb_build_object('problem',erp_private.sacco_layout_validate(l.layout_id),
     'lines',COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.sort_order) FROM erp_private.sacco_layout_lines x WHERE x.layout_id=l.layout_id),'[]'::jsonb))
    FROM erp_private.sacco_layouts l WHERE l.layout_id=did),
  'versions',COALESCE((SELECT jsonb_agg(jsonb_build_object('layout_id',l.layout_id,'version',l.version,'status',l.status,'approved_at',l.approved_at,'approval_note',l.approval_note,'approved_by_name',s.full_name) ORDER BY l.version DESC)
    FROM erp_private.sacco_layouts l LEFT JOIN erp_private.staff_members s ON s.staff_id=l.approved_by),'[]'::jsonb),
  'accounts',COALESCE((SELECT jsonb_agg(jsonb_build_object('audit_account_id',a.audit_account_id,'account_code',a.account_code,'account_name',a.account_name,'audit_area',a.audit_area,'financial_statement_line',a.financial_statement_line,
     'cur_net',round(a.cur_net,2),'cmp_net',round(a.cmp_net,2),'line_code',a.line_code,'map_status',a.map_status,'proposed_by_name',(SELECT s.full_name FROM erp_private.staff_members s WHERE s.staff_id=a.proposed_by)) ORDER BY a.account_code)
    FROM erp_private.sacco_account_rows(p_file) a),'[]'::jsonb),
  'moves',COALESCE((SELECT jsonb_agg(jsonb_build_object('move_id',m.move_id,'line_code',m.line_code,'kind',m.kind,'amount',m.amount,'note',m.note,'status',m.status,'entered_by',m.entered_by,'entered_by_name',s.full_name,'entered_at',m.entered_at,'withdraw_note',m.withdraw_note) ORDER BY m.entered_at,m.move_id)
    FROM erp_private.sacco_equity_moves m LEFT JOIN erp_private.staff_members s ON s.staff_id=m.entered_by WHERE m.audit_file_id=p_file),'[]'::jsonb),
  'preview',erp_private.sacco_fs_calc(p_file));
END $$;

-- ---- File sign-off: the layout must be approved and every applicable section-10 item reviewed -----------------------------------------
CREATE OR REPLACE FUNCTION erp_private.sasra_signoff_issues(p_file uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE f erp_private.audit_files;st text;chk jsonb;x jsonb;issues jsonb:='[]'::jsonb;eq jsonb;lay erp_private.sacco_layouts;r record;
BEGIN
 SELECT * INTO f FROM erp_private.audit_files WHERE audit_file_id=p_file;
 IF f.audit_file_id IS NULL THEN RETURN '[]'::jsonb; END IF;
 st:=erp_private.client_sacco_type(f.client_id);
 IF st='NOT_SACCO' THEN RETURN '[]'::jsonb; END IF;
 IF NOT erp_private.sasra_eligible(f.client_id,f.handling_firm_id,EXTRACT(year FROM f.ends_on)::integer) AND NOT f.is_demonstration THEN
  issues:=issues||to_jsonb('SASRA auditor eligibility for financial year '||EXTRACT(year FROM f.ends_on)::integer||' is not confirmed by a Partner.'::text); END IF;
 chk:=erp_private.sasra_breach_check(p_file);
 IF chk IS NULL OR jsonb_array_length(chk)=0 THEN
  issues:=issues||to_jsonb('No SASRA ratio is confirmed for this type of SACCO and year end. A Partner must confirm the ratios first.'::text);
 ELSE
  FOR x IN SELECT * FROM jsonb_array_elements(chk) LOOP
   IF x->>'state'<>'Met' AND x->>'state'<>'Breach' THEN issues:=issues||to_jsonb(('Enter the figures for '||(x->>'label')||' ('||(x->>'state')||').')::text);
   ELSIF x->>'state'='Breach' AND NOT (x->>'acknowledged')::boolean THEN issues:=issues||to_jsonb(('Regulatory breach not acknowledged by a Partner: '||(x->>'label')||' is '||(x->>'value')||'.')::text); END IF;
  END LOOP;
 END IF;
 eq:=erp_private.audit_eqcr_status(p_file);
 IF erp_private.audit_eqcr_required(p_file) AND NOT COALESCE((eq->>'approved')::boolean,false) THEN issues:=issues||to_jsonb('EQCR Partner approval required before final sign-off.'::text); END IF;
 SELECT * INTO lay FROM erp_private.sacco_layouts WHERE layout_id=erp_private.sacco_layout_use();
 IF lay.layout_id IS NULL OR lay.status<>'Approved' THEN issues:=issues||to_jsonb('The SACCO statement layout is not approved by a Partner.'::text);
 ELSE
  FOR r IN SELECT l.caption FROM erp_private.sacco_layout_lines l WHERE l.layout_id=lay.layout_id AND l.kind='Check'
    AND NOT EXISTS(SELECT 1 FROM erp_private.sacco_file_checks k WHERE k.audit_file_id=p_file AND k.line_code=l.line_code AND k.status='Reviewed') ORDER BY l.sort_order LOOP
   issues:=issues||to_jsonb(('Section 10 item not reviewed: '||r.caption||'.')::text);
  END LOOP;
 END IF;
 RETURN issues;
END $$;

-- ---- Permissions -------------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION erp_private.sacco_layout_guard(),erp_private.sacco_layout_line_guard(),erp_private.sacco_report_guard(),erp_private.sacco_layout_use(),erp_private.sacco_layout_validate(uuid),erp_private.sacco_account_rows(uuid),
 erp_private.sacco_fs_calc(uuid),erp_private.sacco_basis_text(uuid),erp_private.sacco_file_for_write(uuid),erp_private.audit_fs_calc(uuid),erp_private.audit_fs_calc_standard(uuid),
 erp_private.audit_report_basis(uuid,text),erp_private.audit_report_basis_standard(uuid,text) FROM PUBLIC,anon,authenticated,service_role,erp_api;
REVOKE ALL ON FUNCTION erp_private.sacco_layout_copy(),erp_private.sacco_layout_line_save(uuid,jsonb),erp_private.sacco_layout_line_remove(uuid,text),erp_private.sacco_layout_approve(uuid,text),erp_private.sacco_map_save(jsonb),
 erp_private.sacco_map_approve(uuid[]),erp_private.sacco_value_save(uuid,text,numeric,text),erp_private.sacco_move_save(uuid,text,text,numeric,text),erp_private.sacco_move_withdraw(uuid,text),
 erp_private.sacco_check_prepare(uuid,text,boolean,text),erp_private.sacco_check_review(uuid,text,boolean,text),erp_private.sacco_workspace(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION erp_private.sacco_layout_copy(),erp_private.sacco_layout_line_save(uuid,jsonb),erp_private.sacco_layout_line_remove(uuid,text),erp_private.sacco_layout_approve(uuid,text),erp_private.sacco_map_save(jsonb),
 erp_private.sacco_map_approve(uuid[]),erp_private.sacco_value_save(uuid,text,numeric,text),erp_private.sacco_move_save(uuid,text,text,numeric,text),erp_private.sacco_move_withdraw(uuid,text),
 erp_private.sacco_check_prepare(uuid,text,boolean,text),erp_private.sacco_check_review(uuid,text,boolean,text),erp_private.sacco_workspace(uuid) TO erp_api;
