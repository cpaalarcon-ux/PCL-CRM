-- Non-eTIMS exception bases. A purchase row with no eTIMS invoice can only stay in the working when it rests on a named, approved basis
-- (bank charge, payroll, import and so on) plus a piece of evidence. This table is the list of those bases.
-- - Nothing is invented here: the nine workbook categories are seeded as "Testing" with no legal reference. A Partner approves a basis
--   only after entering the legal reference they verified; until then rows that rely on it block tax review.
-- - A basis is never deleted. Retiring one stops new use and keeps every earlier row readable.
CREATE TABLE erp_private.non_etims_bases(
 basis_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 basis_code text NOT NULL UNIQUE CHECK(basis_code ~ '^[A-Z0-9-]{3,30}$'),
 legal_category text NOT NULL CHECK(length(btrim(legal_category)) BETWEEN 2 AND 100),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 3 AND 200),
 guidance text NOT NULL DEFAULT '' CHECK(length(guidance)<=1000),
 legal_reference text NOT NULL DEFAULT '' CHECK(length(legal_reference)<=500),
 status text NOT NULL DEFAULT 'Testing' CHECK(status IN('Testing','Active','Retired')),
 revision integer NOT NULL DEFAULT 1,
 created_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 approved_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 approved_at timestamptz,
 retired_by uuid REFERENCES erp_private.staff_members(staff_id) ON DELETE RESTRICT,
 retired_at timestamptz,
 retire_reason text CHECK(retire_reason IS NULL OR length(btrim(retire_reason)) BETWEEN 10 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(status<>'Active' OR (length(btrim(legal_reference))>=10 AND approved_by IS NOT NULL AND approved_at IS NOT NULL)),
 CHECK(status<>'Retired' OR (retire_reason IS NOT NULL AND retired_by IS NOT NULL AND retired_at IS NOT NULL))
);
CREATE INDEX non_etims_bases_created_idx ON erp_private.non_etims_bases(created_by) WHERE created_by IS NOT NULL;
CREATE INDEX non_etims_bases_approved_idx ON erp_private.non_etims_bases(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX non_etims_bases_retired_idx ON erp_private.non_etims_bases(retired_by) WHERE retired_by IS NOT NULL;

-- Approved wording is fixed; a retired basis is frozen. Only status moves forward: Testing -> Active -> Retired (or Testing -> Retired).
CREATE FUNCTION erp_private.non_etims_basis_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=erp_private,pg_temp AS $$
BEGIN
 NEW.updated_at:=now();
 IF NEW.basis_code IS DISTINCT FROM OLD.basis_code THEN RAISE EXCEPTION 'A basis code cannot change.' USING ERRCODE='42501'; END IF;
 IF OLD.status='Retired' THEN RAISE EXCEPTION 'A retired basis cannot be changed.' USING ERRCODE='42501'; END IF;
 IF OLD.status='Active' AND NEW.status='Testing' THEN RAISE EXCEPTION 'An approved basis cannot go back to testing. Retire it and add a new one.' USING ERRCODE='42501'; END IF;
 IF OLD.status='Active' AND NEW.status='Active' AND (NEW.label IS DISTINCT FROM OLD.label OR NEW.legal_category IS DISTINCT FROM OLD.legal_category OR NEW.legal_reference IS DISTINCT FROM OLD.legal_reference) THEN
  RAISE EXCEPTION 'An approved basis cannot be edited. Retire it and add a new one.' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER non_etims_basis_guard BEFORE UPDATE ON erp_private.non_etims_bases FOR EACH ROW EXECUTE FUNCTION erp_private.non_etims_basis_guard();
CREATE TRIGGER non_etims_bases_audit AFTER INSERT OR UPDATE ON erp_private.non_etims_bases FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('basis_id');

ALTER TABLE erp_private.non_etims_bases ENABLE ROW LEVEL SECURITY;ALTER TABLE erp_private.non_etims_bases FORCE ROW LEVEL SECURITY;
REVOKE ALL ON erp_private.non_etims_bases FROM PUBLIC,anon,authenticated,service_role;GRANT SELECT,INSERT,UPDATE ON erp_private.non_etims_bases TO erp_api;
CREATE POLICY non_etims_bases_read ON erp_private.non_etims_bases FOR SELECT TO erp_api USING((erp_private.actor()).category_code<>'INTERN');
CREATE POLICY non_etims_bases_add ON erp_private.non_etims_bases FOR INSERT TO erp_api WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER') AND created_by=(erp_private.actor()).staff_id AND status='Testing');
CREATE POLICY non_etims_bases_change ON erp_private.non_etims_bases FOR UPDATE TO erp_api USING((erp_private.actor()).category_code IN('PARTNER','MANAGER')) WITH CHECK((erp_private.actor()).category_code IN('PARTNER','MANAGER'));

-- Seed: the nine categories the purchase workbook already offers. No legal reference is supplied; the Tax Lead and a Partner do that.
INSERT INTO erp_private.non_etims_bases(basis_code,legal_category,label,guidance) VALUES
 ('NE-PAYROLL','Payroll/wages','Payroll or wages with no supplier invoice','Evidence: payroll register or payslips for the same month.'),
 ('NE-BANKCHG','Bank charge','Bank charge','Evidence: the bank statement line or the bank advice.'),
 ('NE-INTEREST','Interest','Interest charged','Evidence: lender statement or bank advice showing the interest.'),
 ('NE-IMPORT','Import','Import with customs documents','Evidence: customs entry and the import invoice.'),
 ('NE-TICKET','Passenger ticket','Passenger ticket','Evidence: the ticket or e-ticket and the traveller.'),
 ('NE-FIFEE','Financial-institution fee','Financial-institution fee','Evidence: the institution statement or fee advice.'),
 ('NE-BUYERINV','Buyer-issued invoice','Buyer-issued invoice','Evidence: the self-billing agreement and the buyer-issued document.'),
 ('NE-FWHT','Final withholding tax expense','Final withholding tax expense','Evidence: the withholding certificate or return line.'),
 ('NE-OTHER','Other supported exception','Other supported exception','Evidence: explain in the reference why no eTIMS invoice exists.');
