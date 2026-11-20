-- Annual pack foundation (slice 1): (1) a statement-line catalogue and a dated, Partner-approved map from every account to a statement line,
-- (2) the reporting framework and edition recorded for each client year, (3) the readiness checks read these. No tax rate is stored.
-- IFRS for SMEs Third Edition (2025) applies to annual periods beginning on or after 1 January 2027; earlier use is early application and is recorded as such.

CREATE TABLE erp_private.statement_lines(
 line_code text PRIMARY KEY CHECK(line_code ~ '^[A-Z]{2,6}[.][A-Z0-9_]{2,30}$'),
 statement text NOT NULL CHECK(statement IN ('Financial position','Profit or loss','Excluded')),
 section text NOT NULL,
 label text NOT NULL,
 sort_order integer NOT NULL,
 normal_side text NOT NULL CHECK(normal_side IN ('Debit','Credit')),
 cash_flow_class text NOT NULL CHECK(cash_flow_class IN ('Operating','Investing','Financing','Cash','Equity','None')),
 note_ref text NOT NULL DEFAULT '',
 UNIQUE(statement,sort_order)
);
COMMENT ON TABLE erp_private.statement_lines IS 'Face-of-statement lines. cash_flow_class says how a movement in the line is classified in the indirect cash-flow statement.';
INSERT INTO erp_private.statement_lines(line_code,statement,section,label,sort_order,normal_side,cash_flow_class,note_ref) VALUES
 ('SFP.PPE','Financial position','Non-current assets','Property, plant and equipment',100,'Debit','Investing','PPE'),
 ('SFP.ROU','Financial position','Non-current assets','Right-of-use assets',110,'Debit','Investing','LEASES'),
 ('SFP.INVPROP','Financial position','Non-current assets','Investment property',120,'Debit','Investing','INVPROP'),
 ('SFP.INTANG','Financial position','Non-current assets','Intangible assets and goodwill',130,'Debit','Investing','INTANG'),
 ('SFP.BIO_NC','Financial position','Non-current assets','Biological assets - non-current',140,'Debit','Investing','BIO'),
 ('SFP.INVEST','Financial position','Non-current assets','Investments',150,'Debit','Investing','INVEST'),
 ('SFP.INV','Financial position','Current assets','Inventories',200,'Debit','Operating','INV'),
 ('SFP.BIO_C','Financial position','Current assets','Biological assets and harvested produce - current',210,'Debit','Operating','BIO'),
 ('SFP.TRADE_REC','Financial position','Current assets','Trade receivables',220,'Debit','Operating','REC'),
 ('SFP.CONTRACT_ASSET','Financial position','Current assets','Contract assets and retentions receivable',230,'Debit','Operating','CONTRACTS'),
 ('SFP.OTHER_REC','Financial position','Current assets','Other receivables, deposits and prepayments',240,'Debit','Operating','REC'),
 ('SFP.RELATED_REC','Financial position','Current assets','Amounts due from group companies',250,'Debit','Operating','RELATED'),
 ('SFP.TAX_REC','Financial position','Current assets','Tax and statutory receivables',260,'Debit','Operating','TAX'),
 ('SFP.CASH','Financial position','Current assets','Cash and cash equivalents',270,'Debit','Cash','CASH'),
 ('SFP.SHARE_CAP','Financial position','Equity','Share capital',300,'Credit','Equity','EQUITY'),
 ('SFP.SHARE_PREM','Financial position','Equity','Share premium',310,'Credit','Equity','EQUITY'),
 ('SFP.OWNER_CAP','Financial position','Equity','Owner or partner capital',320,'Credit','Equity','EQUITY'),
 ('SFP.OWNER_CUR','Financial position','Equity','Partner current accounts',330,'Credit','Equity','EQUITY'),
 ('SFP.DRAWINGS','Financial position','Equity','Drawings',340,'Debit','Equity','EQUITY'),
 ('SFP.REVAL','Financial position','Equity','Revaluation surplus',350,'Credit','Equity','EQUITY'),
 ('SFP.RESERVES','Financial position','Equity','Other reserves',360,'Credit','Equity','EQUITY'),
 ('SFP.RETAINED','Financial position','Equity','Retained earnings',370,'Credit','Equity','EQUITY'),
 ('SFP.FUND_ACCUM','Financial position','Equity','Accumulated fund',380,'Credit','Equity','FUNDS'),
 ('SFP.FUND_RESTR','Financial position','Equity','Restricted funds',390,'Credit','Equity','FUNDS'),
 ('SFP.FUND_DESIG','Financial position','Equity','Designated funds',395,'Credit','Equity','FUNDS'),
 ('SFP.HEAD_OFFICE','Financial position','Equity','Head office account',398,'Credit','Equity','EQUITY'),
 ('SFP.BORROW_NC','Financial position','Non-current liabilities','Borrowings - long-term',400,'Credit','Financing','BORROW'),
 ('SFP.LEASE_NC','Financial position','Non-current liabilities','Lease liabilities - long-term',410,'Credit','Financing','LEASES'),
 ('SFP.DEFTAX','Financial position','Non-current liabilities','Deferred tax',420,'Credit','Operating','TAX'),
 ('SFP.PROVISIONS','Financial position','Non-current liabilities','Provisions',430,'Credit','Operating','PROV'),
 ('SFP.TRADE_PAY','Financial position','Current liabilities','Trade payables',500,'Credit','Operating','PAY'),
 ('SFP.ACCRUALS','Financial position','Current liabilities','Accruals',510,'Credit','Operating','PAY'),
 ('SFP.DEPOSITS','Financial position','Current liabilities','Customer deposits and deferred income',520,'Credit','Operating','CONTRACTS'),
 ('SFP.GRANTS_ADV','Financial position','Current liabilities','Grants received in advance',530,'Credit','Operating','FUNDS'),
 ('SFP.GRANTS_REFUND','Financial position','Current liabilities','Grants refundable to donors',535,'Credit','Operating','FUNDS'),
 ('SFP.RELATED_PAY','Financial position','Current liabilities','Amounts due to group companies',540,'Credit','Financing','RELATED'),
 ('SFP.BORROW_C','Financial position','Current liabilities','Borrowings - current',550,'Credit','Financing','BORROW'),
 ('SFP.LEASE_C','Financial position','Current liabilities','Lease liabilities - current',560,'Credit','Financing','LEASES'),
 ('SFP.OVERDRAFT','Financial position','Current liabilities','Bank overdraft',570,'Credit','Cash','CASH'),
 ('SFP.DIVIDENDS_PAY','Financial position','Current liabilities','Dividends payable',580,'Credit','Financing','EQUITY'),
 ('SFP.VAT','Financial position','Current liabilities','VAT payable',600,'Credit','Operating','TAX'),
 ('SFP.PAYROLL_PAY','Financial position','Current liabilities','Payroll liabilities',610,'Credit','Operating','PAY'),
 ('SFP.INCOME_TAX','Financial position','Current liabilities','Income tax payable',620,'Credit','Operating','TAX'),
 ('SFP.OTHER_STATUTORY','Financial position','Current liabilities','Other taxes and statutory levies payable',630,'Credit','Operating','TAX'),
 ('PL.REVENUE','Profit or loss','Revenue','Revenue',1000,'Credit','Operating','REVENUE'),
 ('PL.GRANTS','Profit or loss','Revenue','Grants, donations and membership income',1010,'Credit','Operating','FUNDS'),
 ('PL.COST_SALES','Profit or loss','Cost of sales','Cost of sales',1100,'Debit','Operating','INV'),
 ('PL.OTHER_INCOME','Profit or loss','Other income','Other income and gains',1200,'Credit','Operating','OTHER'),
 ('PL.STAFF','Profit or loss','Operating costs','Staff costs',1300,'Debit','Operating','STAFF'),
 ('PL.DEPREC','Profit or loss','Operating costs','Depreciation and amortisation',1310,'Debit','None','PPE'),
 ('PL.IMPAIR','Profit or loss','Operating costs','Impairment of assets',1315,'Debit','None','PPE'),
 ('PL.PROGRAMME','Profit or loss','Operating costs','Programme and beneficiary costs',1320,'Debit','Operating','FUNDS'),
 ('PL.OTHER_OPEX','Profit or loss','Operating costs','Other operating expenses',1330,'Debit','Operating','OPEX'),
 ('PL.FIN_INCOME','Profit or loss','Finance','Finance income',1400,'Credit','Operating','FINANCE'),
 ('PL.FIN_COSTS','Profit or loss','Finance','Finance costs',1410,'Debit','Operating','FINANCE'),
 ('PL.TAX','Profit or loss','Tax','Income tax expense',1500,'Debit','Operating','TAX'),
 ('PL.UNRESOLVED','Profit or loss','Unresolved','Unresolved review items',1900,'Debit','None','UNRESOLVED'),
 ('EXCL.LEGACY','Excluded','Excluded','Legacy account - must carry no balance',9000,'Debit','None','');
ALTER TABLE erp_private.statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.statement_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.statement_lines FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON erp_private.statement_lines TO erp_api;
CREATE POLICY statement_lines_read ON erp_private.statement_lines FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);

-- The dated map. Each account has at most one Approved row in force; a change is a new Draft row from a date, approved by a Partner,
-- which ends the row it replaces the day before. Rows are never edited or deleted.
CREATE TABLE erp_private.account_statement_map(
 map_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 account_code text NOT NULL REFERENCES erp_private.account_catalog(code),
 line_code text NOT NULL REFERENCES erp_private.statement_lines(line_code),
 effective_from date NOT NULL,
 effective_to date,
 status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Approved','Rejected')),
 reason text NOT NULL DEFAULT '' CHECK(char_length(reason)<=500),
 proposed_by uuid REFERENCES erp_private.staff_members,
 proposed_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid REFERENCES erp_private.staff_members,
 reviewed_at timestamptz,
 review_note text,
 CHECK(effective_to IS NULL OR effective_to>=effective_from),
 CHECK(status='Draft' OR reviewed_at IS NOT NULL)
);
CREATE UNIQUE INDEX account_statement_map_one_draft ON erp_private.account_statement_map(account_code) WHERE status='Draft';
CREATE UNIQUE INDEX account_statement_map_one_open ON erp_private.account_statement_map(account_code) WHERE status='Approved' AND effective_to IS NULL;
CREATE INDEX account_statement_map_line_idx ON erp_private.account_statement_map(line_code);
COMMENT ON TABLE erp_private.account_statement_map IS 'Which statement line each account belongs to, by date. Seeded as Draft proposals from the master chart; a Partner approves them.';

-- Seed proposals (proposed_by NULL = seeded from the master chart). Legacy accounts map to the excluded line so a balance on them blocks the pack.
INSERT INTO erp_private.account_statement_map(account_code,line_code,effective_from,reason)
SELECT x.code,x.line_code,DATE '2025-01-01','Seeded from the master chart; awaiting Partner approval'
FROM (SELECT c.code,
 CASE
  WHEN c.is_legacy OR c.code IN ('21100','22000') THEN 'EXCL.LEGACY'
  WHEN c.code IN ('10000','10010','10020','10021','10022','10023','10024','10025','10026','10027','10028','10030','10040','10050','10260') THEN 'SFP.CASH'
  WHEN c.code IN ('10060','10065','10300') THEN 'SFP.TRADE_REC'
  WHEN c.code IN ('10270','10280','10290','10330') THEN 'SFP.CONTRACT_ASSET'
  WHEN c.code IN ('10070','10080','10090','10100','10110','10340') THEN 'SFP.OTHER_REC'
  WHEN c.code='10120' THEN 'SFP.RELATED_REC'
  WHEN c.code IN ('10130','10140','10150','10160','10170','10180') THEN 'SFP.TAX_REC'
  WHEN c.code IN ('10190','10200','10210','10220','10230','10240','10250','10350','10360','10370') THEN 'SFP.INV'
  WHEN c.code IN ('10310','10320') THEN 'SFP.BIO_C'
  WHEN c.code='15013' OR c.code='15960' THEN 'SFP.ROU'
  WHEN c.code='15018' THEN 'SFP.INVPROP'
  WHEN c.code IN ('15008','15019','15020','15970') THEN 'SFP.INTANG'
  WHEN c.code='15021' THEN 'SFP.BIO_NC'
  WHEN c.code='15022' THEN 'SFP.INVEST'
  WHEN c.code BETWEEN '15000' AND '15999' THEN 'SFP.PPE'
  WHEN c.code IN ('20000','20050','20170') THEN 'SFP.TRADE_PAY'
  WHEN c.code IN ('20010','20020') THEN 'SFP.ACCRUALS'
  WHEN c.code IN ('20030','20040','20150','20160','20190','20210','20220') THEN 'SFP.DEPOSITS'
  WHEN c.code='20200' THEN 'SFP.GRANTS_ADV'
  WHEN c.code='20240' THEN 'SFP.GRANTS_REFUND'
  WHEN c.code IN ('20060','20230') THEN 'SFP.RELATED_PAY'
  WHEN c.code='20070' THEN 'SFP.BORROW_C'
  WHEN c.code='20080' THEN 'SFP.OVERDRAFT'
  WHEN c.code='20090' THEN 'SFP.BORROW_NC'
  WHEN c.code='20100' THEN 'SFP.LEASE_C'
  WHEN c.code='20110' THEN 'SFP.LEASE_NC'
  WHEN c.code IN ('20120','20180') THEN 'SFP.PROVISIONS'
  WHEN c.code='20130' THEN 'SFP.DEFTAX'
  WHEN c.code='20140' THEN 'SFP.DIVIDENDS_PAY'
  WHEN c.code IN ('21000','21010','21020','21030') THEN 'SFP.VAT'
  WHEN c.code IN ('21600','21601','21602','21603','21604','21610','21611','21612') THEN 'SFP.PAYROLL_PAY'
  WHEN c.code IN ('21605','21613','21614') THEN 'SFP.INCOME_TAX'
  WHEN c.code IN ('21606','21607','21608','21609','21615') THEN 'SFP.OTHER_STATUTORY'
  WHEN c.code='30000' THEN 'SFP.SHARE_CAP'
  WHEN c.code='30010' THEN 'SFP.SHARE_PREM'
  WHEN c.code IN ('31000','32000') THEN 'SFP.RETAINED'
  WHEN c.code='33000' THEN 'SFP.REVAL'
  WHEN c.code IN ('34000','34100','34200') THEN 'SFP.RESERVES'
  WHEN c.code='34300' THEN 'SFP.FUND_ACCUM'
  WHEN c.code='34310' THEN 'SFP.FUND_RESTR'
  WHEN c.code='34320' THEN 'SFP.HEAD_OFFICE'
  WHEN c.code='34330' THEN 'SFP.FUND_DESIG'
  WHEN c.code IN ('35000','36000') THEN 'SFP.OWNER_CAP'
  WHEN c.code='36010' THEN 'SFP.OWNER_CUR'
  WHEN c.code IN ('35010','36020') THEN 'SFP.DRAWINGS'
  WHEN c.code IN ('40300','40310','40320','40330','40440') THEN 'PL.GRANTS'
  WHEN c.code IN ('40070','40090','40110','40120','40130','40140','40350') THEN 'PL.OTHER_INCOME'
  WHEN c.code='40080' THEN 'PL.FIN_INCOME'
  WHEN c.code BETWEEN '40000' AND '49999' THEN 'PL.REVENUE'
  WHEN c.code BETWEEN '50000' AND '50999' THEN 'PL.COST_SALES'
  WHEN c.code BETWEEN '60000' AND '60999' THEN 'PL.STAFF'
  WHEN c.code BETWEEN '62000' AND '62099' THEN 'PL.FIN_COSTS'
  WHEN c.code IN ('61300','61310') THEN 'PL.PROGRAMME'
  WHEN c.code BETWEEN '67000' AND '67999' THEN 'PL.DEPREC'
  WHEN c.code='68000' THEN 'PL.IMPAIR'
  WHEN c.code IN ('69000','69010') THEN 'PL.TAX'
  WHEN c.code BETWEEN '69900' AND '69999' THEN 'PL.UNRESOLVED'
  WHEN c.code BETWEEN '51000' AND '66999' THEN 'PL.OTHER_OPEX'
  ELSE NULL
 END AS line_code
 FROM erp_private.account_catalog c WHERE c.code <> '37000') x
-- Anything the rules above could not place stays unmapped on purpose and is reported as such.
WHERE x.line_code IS NOT NULL;

ALTER TABLE erp_private.account_statement_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.account_statement_map FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.account_statement_map FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.account_statement_map TO erp_api;
CREATE POLICY statement_map_read ON erp_private.account_statement_map FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY statement_map_add ON erp_private.account_statement_map FOR INSERT TO erp_api WITH CHECK(erp_private.is_leader() AND status='Draft' AND proposed_by=(erp_private.actor()).staff_id);
CREATE POLICY statement_map_review ON erp_private.account_statement_map FOR UPDATE TO erp_api USING((erp_private.actor()).category_code='PARTNER') WITH CHECK((erp_private.actor()).category_code='PARTNER');
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.account_statement_map FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.account_statement_map FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('map_id');

-- A map row is only ever reviewed once (Draft to Approved or Rejected, by a Partner who did not propose it) or ended once (effective_to set).
CREATE FUNCTION erp_private.account_statement_map_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF (NEW.map_id,NEW.account_code,NEW.line_code,NEW.effective_from,NEW.reason,NEW.proposed_by,NEW.proposed_at)
    IS DISTINCT FROM (OLD.map_id,OLD.account_code,OLD.line_code,OLD.effective_from,OLD.reason,OLD.proposed_by,OLD.proposed_at) THEN
  RAISE EXCEPTION 'A statement-line mapping cannot be edited. Propose a new one.' USING ERRCODE='23514';
 END IF;
 IF OLD.status='Draft' THEN
  IF NEW.status='Draft' THEN
   IF (NEW.effective_to,NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.effective_to,OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) THEN RAISE EXCEPTION 'A draft mapping changes only when it is approved or rejected.' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.reviewed_by IS DISTINCT FROM (erp_private.actor()).staff_id THEN RAISE EXCEPTION 'The reviewer must be the signed-in Partner.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' AND OLD.proposed_by IS NOT NULL AND NEW.reviewed_by=OLD.proposed_by THEN RAISE EXCEPTION 'A mapping must be approved by a Partner other than the person who proposed it.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Rejected' AND length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Give a reason of at least 10 characters when rejecting a mapping.' USING ERRCODE='23514'; END IF;
   IF NEW.status='Approved' AND NEW.effective_to IS NOT NULL THEN RAISE EXCEPTION 'A mapping is approved without an end date.' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF OLD.status='Approved' THEN
  IF NEW.status<>'Approved' OR (NEW.reviewed_by,NEW.reviewed_at,NEW.review_note) IS DISTINCT FROM (OLD.reviewed_by,OLD.reviewed_at,OLD.review_note) OR OLD.effective_to IS NOT NULL THEN
   RAISE EXCEPTION 'An approved mapping can only be ended once, by replacing it.' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'A rejected mapping is closed.' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.account_statement_map_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER statement_map_guard BEFORE UPDATE ON erp_private.account_statement_map FOR EACH ROW EXECUTE FUNCTION erp_private.account_statement_map_guard();

-- Reporting framework and edition for each client financial year. Changes are audited. The period must be Open.
CREATE TABLE erp_private.ledger_period_reporting(
 period_id uuid PRIMARY KEY REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,
 framework text NOT NULL DEFAULT 'IFRS for SMEs Accounting Standard' CHECK(framework IN ('IFRS for SMEs Accounting Standard','IFRS Accounting Standards','Other framework')),
 edition text NOT NULL DEFAULT 'Third Edition (2025)' CHECK(edition IN ('Third Edition (2025)','Second Edition (2015, amended 2022)','As issued at the reporting date','Other (state in the note)')),
 early_application_note text NOT NULL DEFAULT '' CHECK(char_length(early_application_note)<=500),
 presentation_currency text NOT NULL DEFAULT 'KES' CHECK(presentation_currency ~ '^[A-Z]{3}$'),
 rounding text NOT NULL DEFAULT 'Whole shillings' CHECK(rounding IN ('Whole shillings','Thousands')),
 comparatives_basis text NOT NULL DEFAULT 'Prior year ledger' CHECK(comparatives_basis IN ('Prior year ledger','Approved opening balances','First period - none')),
 cash_flow_method text NOT NULL DEFAULT 'Indirect' CHECK(cash_flow_method='Indirect'),
 set_by uuid NOT NULL REFERENCES erp_private.staff_members,
 set_at timestamptz NOT NULL DEFAULT now(),
 revision bigint NOT NULL DEFAULT 1
);
COMMENT ON TABLE erp_private.ledger_period_reporting IS 'Which accounting framework and edition a client year is reported under. IFRS for SMEs Third Edition applies to annual periods beginning on or after 1 January 2027; use before then is early application and must be disclosed.';
ALTER TABLE erp_private.ledger_period_reporting ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.ledger_period_reporting FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.ledger_period_reporting FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON erp_private.ledger_period_reporting TO erp_api;
CREATE POLICY period_reporting_read ON erp_private.ledger_period_reporting FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY period_reporting_add ON erp_private.ledger_period_reporting FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND set_by=(erp_private.actor()).staff_id);
CREATE POLICY period_reporting_update ON erp_private.ledger_period_reporting FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND erp_private.is_leader()) WITH CHECK(erp_private.project_allowed(project_id) AND erp_private.is_leader() AND set_by=(erp_private.actor()).staff_id);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.ledger_period_reporting FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.ledger_period_reporting FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('period_id');

CREATE FUNCTION erp_private.period_reporting_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
DECLARE p erp_private.ledger_periods;
BEGIN
 SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'That ledger year does not exist.' USING ERRCODE='23514'; END IF;
 IF (NEW.project_id,NEW.client_id) IS DISTINCT FROM (p.project_id,p.client_id) THEN RAISE EXCEPTION 'The reporting choice must belong to the same client and project as the ledger year.' USING ERRCODE='23514'; END IF;
 IF p.status<>'Open' THEN RAISE EXCEPTION 'This ledger year is closed. Its reporting framework can no longer be changed.' USING ERRCODE='23514'; END IF;
 IF NEW.framework='IFRS for SMEs Accounting Standard' AND NEW.edition NOT IN ('Third Edition (2025)','Second Edition (2015, amended 2022)') THEN RAISE EXCEPTION 'Choose the Third or Second Edition of IFRS for SMEs.' USING ERRCODE='23514'; END IF;
 IF NEW.framework='IFRS Accounting Standards' AND NEW.edition<>'As issued at the reporting date' THEN RAISE EXCEPTION 'Full IFRS is applied as issued at the reporting date.' USING ERRCODE='23514'; END IF;
 IF NEW.framework='Other framework' AND NEW.edition<>'Other (state in the note)' THEN RAISE EXCEPTION 'Another framework is described in the note.' USING ERRCODE='23514'; END IF;
 IF NEW.edition='Second Edition (2015, amended 2022)' AND p.starts_on>=DATE '2027-01-01' THEN RAISE EXCEPTION 'The Second Edition cannot be used for a year beginning on or after 1 January 2027.' USING ERRCODE='23514'; END IF;
 IF NEW.edition='Third Edition (2025)' AND p.starts_on<DATE '2027-01-01' AND length(btrim(NEW.early_application_note))<10 THEN RAISE EXCEPTION 'Using the Third Edition before 1 January 2027 is early application. Record the disclosure note.' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN NEW.revision=OLD.revision+1; NEW.set_at=now(); END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION erp_private.period_reporting_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER period_reporting_guard BEFORE INSERT OR UPDATE ON erp_private.ledger_period_reporting FOR EACH ROW EXECUTE FUNCTION erp_private.period_reporting_guard();
