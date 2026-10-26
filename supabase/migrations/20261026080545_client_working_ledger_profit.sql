-- Client working papers only. Firm invoices and WIP are separate modules.
CREATE TABLE erp_private.ledger_periods (
 period_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),project_id uuid NOT NULL REFERENCES erp_private.projects,
 client_id uuid NOT NULL REFERENCES erp_private.clients,handling_firm_id uuid NOT NULL REFERENCES erp_private.firms,
 starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on AND ends_on<starts_on+interval '1 year 1 day'),
 entity_type text NOT NULL CHECK(entity_type IN ('Limited company','Sole proprietor','Partnership')),
 entity_evidence text NOT NULL,status text NOT NULL DEFAULT 'Open' CHECK(status IN ('Open','Closed')),
 closed_snapshot jsonb,closed_by uuid REFERENCES erp_private.staff_members,closed_at timestamptz,
 created_by uuid NOT NULL REFERENCES erp_private.staff_members,revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(project_id,starts_on,ends_on),UNIQUE(client_id,ends_on)
);
CREATE INDEX ledger_period_client_idx ON erp_private.ledger_periods(client_id,starts_on,ends_on);
CREATE INDEX ledger_period_firm_idx ON erp_private.ledger_periods(handling_firm_id);
CREATE TABLE erp_private.ledger_journals (
 journal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,
 project_id uuid NOT NULL REFERENCES erp_private.projects,kind text NOT NULL CHECK(kind IN ('Opening','Purchases','Sales','Stock','Payroll','Depreciation','Adjustment','Reversal','Year close')),
 journal_date date NOT NULL,reference text NOT NULL CHECK(length(btrim(reference)) BETWEEN 1 AND 100),
 description text NOT NULL DEFAULT '',evidence text NOT NULL DEFAULT '',source_snapshot jsonb NOT NULL DEFAULT '{}',
 generated boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Posted')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,last_prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_by uuid REFERENCES erp_private.staff_members,review_note text,posted_at timestamptz,reversal_of uuid REFERENCES erp_private.ledger_journals,
 revision bigint NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(period_id,reference),UNIQUE(reversal_of)
);
CREATE UNIQUE INDEX ledger_one_opening_idx ON erp_private.ledger_journals(period_id) WHERE kind='Opening';
CREATE UNIQUE INDEX ledger_one_close_idx ON erp_private.ledger_journals(period_id) WHERE kind='Year close';
CREATE INDEX ledger_journal_project_idx ON erp_private.ledger_journals(project_id,period_id,status,journal_date);
CREATE INDEX ledger_journal_period_idx ON erp_private.ledger_journals(period_id,status);
CREATE TABLE erp_private.ledger_lines (
 line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),journal_id uuid NOT NULL REFERENCES erp_private.ledger_journals,
 project_id uuid NOT NULL REFERENCES erp_private.projects,line_no integer NOT NULL CHECK(line_no>0),account_code text REFERENCES erp_private.account_catalog,
 legacy_code text NOT NULL DEFAULT '',source_name text NOT NULL DEFAULT '',description text NOT NULL DEFAULT '',
 debit numeric(18,2) NOT NULL DEFAULT 0 CHECK(debit>=0),credit numeric(18,2) NOT NULL DEFAULT 0 CHECK(credit>=0),
 source_status text NOT NULL DEFAULT 'Unverified' CHECK(source_status IN ('Confirmed','Unverified')),source_reference text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),CHECK(debit=0 OR credit=0),UNIQUE(journal_id,line_no)
);
CREATE INDEX ledger_lines_project_idx ON erp_private.ledger_lines(project_id,journal_id,account_code);
CREATE INDEX ledger_lines_account_idx ON erp_private.ledger_lines(account_code);
CREATE TABLE erp_private.ledger_sources (
 source_kind text NOT NULL,source_key text NOT NULL,journal_id uuid NOT NULL REFERENCES erp_private.ledger_journals,
 project_id uuid NOT NULL REFERENCES erp_private.projects,source_revision bigint,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(source_kind,source_key)
);
CREATE INDEX ledger_sources_journal_idx ON erp_private.ledger_sources(journal_id,project_id);
CREATE TABLE erp_private.asset_class_rates (
 rate_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),class_code text NOT NULL,name text NOT NULL,
 first_rate numeric(8,4) NOT NULL CHECK(first_rate BETWEEN 0 AND 100),annual_rate numeric(8,4) NOT NULL CHECK(annual_rate BETWEEN 0 AND 100),
 later_basis_percentage numeric(8,4) NOT NULL CHECK(later_basis_percentage BETWEEN 0 AND 100),method text NOT NULL CHECK(method='Equal instalments'),
 tax_cost_cap numeric(18,2),expense_account text NOT NULL REFERENCES erp_private.account_catalog,contra_account text NOT NULL REFERENCES erp_private.account_catalog,
 effective_from date NOT NULL,effective_to date NOT NULL CHECK(effective_to>=effective_from),source_reference text NOT NULL,source_checked_on date NOT NULL,
 scope text NOT NULL,created_by uuid REFERENCES erp_private.staff_members,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(class_code,effective_from)
);
CREATE INDEX asset_rates_period_idx ON erp_private.asset_class_rates(class_code,effective_from,effective_to);
CREATE TABLE erp_private.ledger_assets (
 asset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),period_id uuid NOT NULL REFERENCES erp_private.ledger_periods,project_id uuid NOT NULL REFERENCES erp_private.projects,
 source_row_id uuid UNIQUE REFERENCES erp_private.workbook_rows,asset_name text NOT NULL,asset_account text NOT NULL REFERENCES erp_private.account_catalog,
 first_use_date date NOT NULL,cost numeric(18,2) NOT NULL CHECK(cost>=0),business_percentage numeric(8,4) NOT NULL DEFAULT 100 CHECK(business_percentage BETWEEN 0 AND 100),
 noncommercial_vehicle boolean NOT NULL DEFAULT false,opening_book_value numeric(18,2) CHECK(opening_book_value>=0),opening_tax_value numeric(18,2) CHECK(opening_tax_value>=0),
 complex_case boolean NOT NULL DEFAULT false,rate_id uuid NOT NULL REFERENCES erp_private.asset_class_rates,rate_snapshot jsonb NOT NULL DEFAULT '{}',
 evidence text NOT NULL,status text NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','Submitted','Returned','Approved')),
 prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,last_prepared_by uuid NOT NULL REFERENCES erp_private.staff_members,
 reviewed_by uuid REFERENCES erp_private.staff_members,review_note text,revision bigint NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_assets_project_idx ON erp_private.ledger_assets(project_id,period_id,status);
CREATE INDEX ledger_assets_period_idx ON erp_private.ledger_assets(period_id);
CREATE INDEX ledger_assets_rate_idx ON erp_private.ledger_assets(rate_id);
CREATE TABLE erp_private.ledger_asset_charges (
 charge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),asset_id uuid NOT NULL REFERENCES erp_private.ledger_assets,
 journal_id uuid NOT NULL REFERENCES erp_private.ledger_journals,project_id uuid NOT NULL REFERENCES erp_private.projects,
 starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),snapshot jsonb NOT NULL,book_charge numeric(18,2) NOT NULL CHECK(book_charge>=0),
 tax_projection numeric(18,2) NOT NULL CHECK(tax_projection>=0),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(asset_id,starts_on,ends_on)
);
CREATE INDEX ledger_charges_journal_idx ON erp_private.ledger_asset_charges(journal_id,project_id);

CREATE FUNCTION erp_private.ledger_row_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a erp_private.staff_members;p erp_private.ledger_periods;j erp_private.ledger_journals;pr erp_private.projects;n integer;diff numeric;
BEGIN
 a:=erp_private.actor();
 IF current_user='erp_api' AND (a.staff_id IS NULL OR a.category_code='INTERN') THEN RAISE EXCEPTION 'Assigned staff access required' USING ERRCODE='42501';END IF;
 IF TG_TABLE_NAME='ledger_periods' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.status<>'Open' OR NEW.closed_snapshot IS NOT NULL THEN RAISE EXCEPTION 'New financial years must be open';END IF;
   IF current_user='erp_api' AND a.category_code NOT IN ('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Manager or Partner required' USING ERRCODE='42501';END IF;
   SELECT * INTO pr FROM erp_private.projects WHERE project_id=NEW.project_id AND deleted_at IS NULL;
   IF pr.project_id IS NULL OR (NEW.client_id,NEW.handling_firm_id) IS DISTINCT FROM (pr.client_id,pr.handling_firm_id) THEN RAISE EXCEPTION 'Ledger must retain the project client and firm';END IF;
   PERFORM pg_advisory_xact_lock(hashtextextended(NEW.client_id::text||':ledger',0));
   IF EXISTS(SELECT 1 FROM erp_private.ledger_periods WHERE client_id=NEW.client_id AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) THEN RAISE EXCEPTION 'A client ledger already covers this financial year. Ask the Manager for the owning workspace.';END IF;
  ELSE
   IF OLD.status='Closed' THEN RAISE EXCEPTION 'Closed ledger snapshot is immutable';END IF;
   IF (NEW.project_id,NEW.client_id,NEW.handling_firm_id,NEW.starts_on,NEW.ends_on,NEW.entity_type,NEW.entity_evidence,NEW.created_by) IS DISTINCT FROM (OLD.project_id,OLD.client_id,OLD.handling_firm_id,OLD.starts_on,OLD.ends_on,OLD.entity_type,OLD.entity_evidence,OLD.created_by) THEN RAISE EXCEPTION 'Ledger identity is immutable';END IF;
   IF NEW.status='Closed' THEN
    IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.closed_by IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'Manager closure required' USING ERRCODE='42501';END IF;
    IF NOT EXISTS(SELECT 1 FROM erp_private.ledger_journals WHERE period_id=OLD.period_id AND kind='Opening' AND status='Posted') OR EXISTS(SELECT 1 FROM erp_private.ledger_journals WHERE period_id=OLD.period_id AND status<>'Posted') THEN RAISE EXCEPTION 'Post the supported opening and resolve outstanding journals first';END IF;
    SELECT coalesce(sum(l.debit-l.credit),0) INTO diff FROM erp_private.ledger_lines l JOIN erp_private.ledger_journals j USING(journal_id) WHERE j.period_id=OLD.period_id AND j.status='Posted';
    IF diff<>0 OR NEW.closed_snapshot IS NULL THEN RAISE EXCEPTION 'Balanced closing evidence and snapshot required';END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='ledger_journals' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF p.project_id IS DISTINCT FROM NEW.project_id OR p.status<>'Open' OR NEW.journal_date<p.starts_on OR NEW.journal_date>p.ends_on THEN RAISE EXCEPTION 'Use the authorised open financial year';END IF;
  IF NEW.kind='Opening' AND NEW.journal_date<>p.starts_on THEN RAISE EXCEPTION 'Opening balances belong on the first day of the financial year';END IF;
  IF TG_OP='INSERT' THEN
   IF NEW.status<>'Draft' OR (current_user='erp_api' AND (NEW.prepared_by IS DISTINCT FROM a.staff_id OR NEW.last_prepared_by IS DISTINCT FROM a.staff_id)) THEN RAISE EXCEPTION 'New journals must be prepared as Draft';END IF;
  ELSE
   IF OLD.status='Posted' THEN RAISE EXCEPTION 'Posted journal is immutable. Use a linked reversal and replacement.';END IF;
   IF (NEW.period_id,NEW.project_id,NEW.kind,NEW.prepared_by,NEW.generated,NEW.reversal_of) IS DISTINCT FROM (OLD.period_id,OLD.project_id,OLD.kind,OLD.prepared_by,OLD.generated,OLD.reversal_of) THEN RAISE EXCEPTION 'Journal identity is immutable';END IF;
   IF OLD.status='Submitted' AND NEW.status NOT IN ('Posted','Returned') THEN RAISE EXCEPTION 'Independent reviewer must post or return this journal';END IF;
   IF OLD.status='Submitted' AND (NEW.journal_date,NEW.reference,NEW.description,NEW.evidence,NEW.source_snapshot,NEW.last_prepared_by) IS DISTINCT FROM (OLD.journal_date,OLD.reference,OLD.description,OLD.evidence,OLD.source_snapshot,OLD.last_prepared_by) THEN RAISE EXCEPTION 'Submitted journal content is locked during review';END IF;
   IF current_user='erp_api' AND OLD.status IN ('Draft','Returned') THEN NEW.last_prepared_by:=a.staff_id;END IF;
   IF NEW.status IN ('Submitted','Posted') THEN
    SELECT count(*),coalesce(sum(l.debit-l.credit),0) INTO n,diff FROM erp_private.ledger_lines l WHERE l.journal_id=NEW.journal_id AND l.debit+l.credit>0;
    IF n<2 OR diff<>0 OR NOT EXISTS(SELECT 1 FROM erp_private.ledger_lines WHERE journal_id=NEW.journal_id AND debit+credit>0) THEN RAISE EXCEPTION 'A journal needs balanced debit and credit lines. No automatic suspense.';END IF;
    IF EXISTS(SELECT 1 FROM erp_private.ledger_lines l LEFT JOIN erp_private.account_catalog c ON c.code=l.account_code WHERE l.journal_id=NEW.journal_id AND l.debit+l.credit>0 AND (c.code IS NULL OR c.status<>'Active' OR c.is_legacy OR (c.code='37000' AND l.debit+l.credit>0))) THEN RAISE EXCEPTION 'Resolve unmapped, legacy and suspense accounts';END IF;
    IF NEW.kind='Opening' AND EXISTS(SELECT 1 FROM erp_private.ledger_lines WHERE journal_id=NEW.journal_id AND debit+credit>0 AND (source_status<>'Confirmed' OR length(btrim(source_reference))<3 OR account_code>='40000')) THEN RAISE EXCEPTION 'Confirm opening balance-sheet sources and evidence';END IF;
    IF EXISTS(SELECT 1 FROM erp_private.ledger_lines WHERE journal_id=NEW.journal_id AND debit+credit>0 AND account_code BETWEEN '30000' AND '36020' AND ((p.entity_type='Limited company' AND account_code>='35000') OR (p.entity_type='Sole proprietor' AND account_code NOT BETWEEN '35000' AND '35010') OR (p.entity_type='Partnership' AND account_code NOT BETWEEN '36000' AND '36020'))) THEN RAISE EXCEPTION 'Use equity accounts matching the verified legal entity';END IF;
    IF length(btrim(NEW.evidence))<10 THEN RAISE EXCEPTION 'Document the supporting evidence';END IF;
   END IF;
   IF NEW.status IN ('Posted','Returned') AND OLD.status='Submitted' THEN
    IF current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR a.staff_id IN (NEW.prepared_by,NEW.last_prepared_by)) THEN RAISE EXCEPTION 'A different Manager or Partner must review' USING ERRCODE='42501';END IF;
    IF length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Record the independent review conclusion';END IF;
    IF NEW.status='Posted' THEN NEW.posted_at:=now();END IF;
   ELSIF NEW.status='Posted' THEN RAISE EXCEPTION 'Submit before posting';
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='ledger_lines' THEN
  SELECT * INTO j FROM erp_private.ledger_journals WHERE journal_id=NEW.journal_id;
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=j.period_id;
  IF j.project_id IS DISTINCT FROM NEW.project_id OR j.status NOT IN ('Draft','Returned') OR p.status<>'Open' THEN RAISE EXCEPTION 'Only open draft journal lines can change';END IF;
  IF current_user='erp_api' AND a.staff_id<>j.prepared_by AND a.category_code NOT IN ('PARTNER','MANAGER') THEN RAISE EXCEPTION 'Assigned preparer or Manager required' USING ERRCODE='42501';END IF;
 ELSIF TG_TABLE_NAME='ledger_assets' THEN
  SELECT * INTO p FROM erp_private.ledger_periods WHERE period_id=NEW.period_id;
  IF p.project_id IS DISTINCT FROM NEW.project_id OR p.status<>'Open' THEN RAISE EXCEPTION 'Use the authorised open financial year';END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'Draft' OR (current_user='erp_api' AND NEW.prepared_by IS DISTINCT FROM a.staff_id)) THEN RAISE EXCEPTION 'New assets must be prepared as Draft';END IF;
  IF NEW.source_row_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM erp_private.workbook_rows WHERE row_id=NEW.source_row_id AND project_id=NEW.project_id AND route=3) THEN RAISE EXCEPTION 'Asset source must be a PPE row from this project';END IF;
  IF TG_OP='UPDATE' AND OLD.status='Approved' THEN RAISE EXCEPTION 'Approved asset snapshot is immutable';END IF;
  IF TG_OP='UPDATE' AND (NEW.period_id,NEW.project_id,NEW.source_row_id,NEW.prepared_by) IS DISTINCT FROM (OLD.period_id,OLD.project_id,OLD.source_row_id,OLD.prepared_by) THEN RAISE EXCEPTION 'Asset identity and original source are immutable';END IF;
  IF TG_OP='UPDATE' AND OLD.status='Submitted' AND NEW.status NOT IN ('Approved','Returned') THEN RAISE EXCEPTION 'Independent reviewer must approve or return the asset';END IF;
  IF TG_OP='UPDATE' AND OLD.status='Submitted' AND (NEW.asset_name,NEW.asset_account,NEW.first_use_date,NEW.cost,NEW.business_percentage,NEW.noncommercial_vehicle,NEW.opening_book_value,NEW.opening_tax_value,NEW.complex_case,NEW.rate_id,NEW.rate_snapshot,NEW.evidence,NEW.last_prepared_by) IS DISTINCT FROM (OLD.asset_name,OLD.asset_account,OLD.first_use_date,OLD.cost,OLD.business_percentage,OLD.noncommercial_vehicle,OLD.opening_book_value,OLD.opening_tax_value,OLD.complex_case,OLD.rate_id,OLD.rate_snapshot,OLD.evidence,OLD.last_prepared_by) THEN RAISE EXCEPTION 'Submitted asset content is locked during review';END IF;
  IF current_user='erp_api' AND NEW.status IN ('Draft','Submitted') THEN NEW.last_prepared_by:=a.staff_id;END IF;
  IF NEW.status='Approved' THEN
   IF TG_OP='INSERT' OR OLD.status<>'Submitted' OR (current_user='erp_api' AND (a.category_code NOT IN ('PARTNER','MANAGER') OR NEW.reviewed_by IS DISTINCT FROM a.staff_id OR a.staff_id IN (NEW.prepared_by,NEW.last_prepared_by))) THEN RAISE EXCEPTION 'Independent Manager or Partner asset review required' USING ERRCODE='42501';END IF;
   IF NEW.rate_snapshot='{}'::jsonb OR length(btrim(NEW.evidence))<10 OR length(btrim(coalesce(NEW.review_note,'')))<10 THEN RAISE EXCEPTION 'Asset, shared rate and review evidence required';END IF;
  END IF;
 ELSIF TG_TABLE_NAME='ledger_asset_charges' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.asset_id::text||':depreciation',0));
  IF EXISTS(SELECT 1 FROM erp_private.ledger_asset_charges WHERE asset_id=NEW.asset_id AND starts_on<=NEW.ends_on AND ends_on>=NEW.starts_on) THEN RAISE EXCEPTION 'An asset charge already covers these dates';END IF;
 END IF;
 RETURN NEW;
END;$$;

DO $$DECLARE r record;BEGIN
 FOR r IN SELECT * FROM (VALUES ('ledger_periods','period_id'),('ledger_journals','journal_id'),('ledger_lines','line_id'),('ledger_assets','asset_id')) x(tbl,key) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE POLICY ledger_read ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  EXECUTE format('CREATE POLICY ledger_add ON erp_private.%I FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  EXECUTE format('CREATE POLICY ledger_update ON erp_private.%I FOR UPDATE TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'') WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  EXECUTE format('CREATE TRIGGER ledger_guard BEFORE INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_row_guard()',r.tbl);
  IF r.tbl<>'ledger_lines' THEN EXECUTE format('CREATE TRIGGER revision BEFORE UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.touch_revision()',r.tbl);END IF;
  EXECUTE format('CREATE TRIGGER audit AFTER INSERT OR UPDATE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.log_change(%L)',r.tbl,r.key);
  EXECUTE format('CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete()',r.tbl);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON erp_private.%I TO erp_api',r.tbl);
 END LOOP;
 FOR r IN SELECT * FROM (VALUES ('ledger_sources'),('ledger_asset_charges')) x(tbl) LOOP
  EXECUTE format('ALTER TABLE erp_private.%I ENABLE ROW LEVEL SECURITY',r.tbl);EXECUTE format('ALTER TABLE erp_private.%I FORCE ROW LEVEL SECURITY',r.tbl);
  EXECUTE format('CREATE POLICY ledger_read ON erp_private.%I FOR SELECT TO erp_api USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  EXECUTE format('CREATE POLICY ledger_add ON erp_private.%I FOR INSERT TO erp_api WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>''INTERN'')',r.tbl);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON erp_private.%I FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change()',r.tbl);
  EXECUTE format('GRANT SELECT,INSERT ON erp_private.%I TO erp_api',r.tbl);
 END LOOP;
END;$$;
CREATE TRIGGER asset_charge_guard BEFORE INSERT ON erp_private.ledger_asset_charges FOR EACH ROW EXECUTE FUNCTION erp_private.ledger_row_guard();
ALTER TABLE erp_private.asset_class_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE erp_private.asset_class_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY asset_rate_read ON erp_private.asset_class_rates FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY asset_rate_add ON erp_private.asset_class_rates FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code='PARTNER' AND created_by=(erp_private.actor()).staff_id);
CREATE TRIGGER asset_rate_immutable BEFORE UPDATE OR DELETE ON erp_private.asset_class_rates FOR EACH ROW EXECUTE FUNCTION erp_private.reject_audit_change();
GRANT SELECT,INSERT ON erp_private.asset_class_rates TO erp_api;
REVOKE ALL ON erp_private.ledger_periods,erp_private.ledger_journals,erp_private.ledger_lines,erp_private.ledger_sources,erp_private.ledger_assets,erp_private.ledger_asset_charges,erp_private.asset_class_rates FROM PUBLIC,anon,authenticated;

CREATE FUNCTION erp_private.posted_source_mapping_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM erp_private.ledger_sources s JOIN erp_private.ledger_journals j USING(journal_id) WHERE s.source_kind='Workbook row' AND s.source_key=OLD.row_id::text AND j.status='Posted') THEN RAISE EXCEPTION 'Posted source classification is retained. Use a ledger reversal and controlled correction.';END IF;
 IF NEW.dataset='Non-eTIMS' AND NEW.account_code IS NOT NULL AND (NEW.route<>2 OR NEW.account_code<'51000' OR NEW.account_code>='67000' OR NEW.account_code BETWEEN '60000' AND '60170') THEN RAISE EXCEPTION 'Specific non-eTIMS operating expenditure cannot enter stock, PPE, payroll or depreciation';END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER posted_source_guard BEFORE UPDATE OF route,category_code,account_code,narration,asset_details,review_details,first_use_status,first_use_date ON erp_private.workbook_rows FOR EACH ROW EXECUTE FUNCTION erp_private.posted_source_mapping_guard();

INSERT INTO erp_private.asset_class_rates (class_code,name,first_rate,annual_rate,later_basis_percentage,expense_account,contra_account,tax_cost_cap,method,effective_from,effective_to,source_reference,source_checked_on,scope) SELECT class_code,name,first_rate,annual_rate,later_basis_percentage,expense_account,contra_account,tax_cost_cap,method,effective_from,effective_to,source_reference,source_checked_on,scope FROM jsonb_to_recordset($shared_rates$[{"class_code":"MOTOR","name":"Motor vehicles and heavy earth-moving equipment","first_rate":25,"annual_rate":25,"later_basis_percentage":100,"expense_account":"67030","contra_account":"15920","tax_cost_cap":3000000,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"COMPUTER","name":"Computer hardware and qualifying software","first_rate":25,"annual_rate":25,"later_basis_percentage":100,"expense_account":"67050","contra_account":"15940","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"FURNITURE","name":"Furniture and fittings","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67040","contra_account":"15930","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"TELECOM","name":"Telecommunications equipment","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67020","contra_account":"15910","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"MACHINERY","name":"Other machinery","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67020","contra_account":"15910","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"COMMERCIAL","name":"Commercial buildings","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"EDUCATIONAL","name":"Qualifying educational buildings","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"INDUSTRIAL","name":"Industrial buildings and docks","first_rate":10,"annual_rate":10,"later_basis_percentage":100,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"QUALBUILD","name":"Qualifying hotel / manufacture / hospital building","first_rate":50,"annual_rate":25,"later_basis_percentage":50,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"QUALMACHINE","name":"Qualifying manufacturing / hospital equipment / ships","first_rate":50,"annual_rate":25,"later_basis_percentage":50,"expense_account":"67020","contra_account":"15910","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"FARMWORK","name":"Qualifying farmworks","first_rate":50,"annual_rate":25,"later_basis_percentage":50,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."},{"class_code":"LAND","name":"Land","first_rate":0,"annual_rate":0,"later_basis_percentage":100,"expense_account":"67010","contra_account":"15900","tax_cost_cap":null,"method":"Equal instalments","effective_from":"2026-01-01","effective_to":"2026-12-31","source_reference":"Income Tax Act Second Schedule paragraphs 1, 2, 6 and 7; KRA published 2026 consolidation, PDF pages 102-106; https://www.kra.go.ke/images/publications/Income-Tax-Act-2026.pdf","source_checked_on":"2026-10-26","scope":"Reference for testing; confirm qualifying use and evidence on each asset. Special relief and transition cases are not automatic."}]$shared_rates$::jsonb) AS r(class_code text,name text,first_rate numeric,annual_rate numeric,later_basis_percentage numeric,expense_account text,contra_account text,tax_cost_cap numeric,method text,effective_from date,effective_to date,source_reference text,source_checked_on date,scope text);
