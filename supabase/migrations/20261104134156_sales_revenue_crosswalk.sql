-- Controlled, versioned crosswalk from the dated VAT category to the revenue account, replacing codes that were hard-coded in the ledger logic.
-- Sales carry the routing code REV and a five-digit revenue account; the ERP checks the pair against the central chart and this table.
CREATE TABLE erp_private.sales_revenue_crosswalk(
 crosswalk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 vat_category text NOT NULL CHECK(vat_category IN ('16%','8%','0%','Exempt')),
 rate_key text NOT NULL,
 routing_code text NOT NULL DEFAULT 'REV' CHECK(routing_code='REV'),
 revenue_account text NOT NULL REFERENCES erp_private.account_catalog(code),
 effective_from date NOT NULL,
 effective_to date CHECK(effective_to IS NULL OR effective_to>=effective_from),
 status text NOT NULL DEFAULT 'Approved' CHECK(status IN ('Approved','Retired')),
 note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(vat_category,effective_from)
);
CREATE INDEX sales_revenue_crosswalk_account_idx ON erp_private.sales_revenue_crosswalk(revenue_account);
ALTER TABLE erp_private.sales_revenue_crosswalk ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.sales_revenue_crosswalk TO erp_api;
CREATE POLICY sales_revenue_crosswalk_read ON erp_private.sales_revenue_crosswalk FOR SELECT TO erp_api USING(true);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.sales_revenue_crosswalk FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();
INSERT INTO erp_private.sales_revenue_crosswalk(vat_category,rate_key,revenue_account,effective_from,note) VALUES
 ('16%','KE_VAT_STANDARD','40000','2025-01-01','Standard-rated sales'),
 ('8%','KE_VAT_PETROLEUM_8','40010','2025-01-01','Other applicable rate; the dated approved VAT rule still decides whether 8% applies to a sale'),
 ('0%','KE_VAT_ZERO','40020','2025-01-01','Zero-rated sales'),
 ('Exempt','KE_VAT_EXEMPT','40030','2025-01-01','Exempt sales');
