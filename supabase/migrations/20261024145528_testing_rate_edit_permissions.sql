-- Provisional UAT rates remain amendable; formally Approved rates stay immutable.
ALTER POLICY rates_update ON erp_private.tax_rates TO erp_api USING(erp_private.is_leader() AND status IN('Draft','Testing')) WITH CHECK(erp_private.is_leader());
