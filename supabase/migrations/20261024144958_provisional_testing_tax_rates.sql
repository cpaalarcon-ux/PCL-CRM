-- Provisional UAT enablement is separate from formal Partner/legal approval.
ALTER TABLE erp_private.tax_rates DROP CONSTRAINT tax_rates_status_check;
ALTER TABLE erp_private.tax_rates ADD CONSTRAINT tax_rates_status_check CHECK(status IN('Draft','Testing','Approved','Rejected'));
ALTER TABLE erp_private.tax_rates ADD COLUMN testing_authorized_at timestamptz,ADD COLUMN testing_authorization_note text;
