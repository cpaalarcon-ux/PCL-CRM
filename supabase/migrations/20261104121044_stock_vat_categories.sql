-- Stock by VAT category (Phase 5): one stock roll per VAT category, and the VAT categories a client sells.
ALTER TABLE erp_private.stock_controls ADD COLUMN IF NOT EXISTS vat_category text CHECK(vat_category IS NULL OR vat_category IN('16%','8%','0%','Exempt'));
CREATE UNIQUE INDEX IF NOT EXISTS stock_controls_vat_unique ON erp_private.stock_controls(project_id,activity_id,vat_category,starts_on,ends_on) WHERE vat_category IS NOT NULL;
ALTER TABLE erp_private.clients ADD COLUMN IF NOT EXISTS vat_categories_sold text[] CHECK(vat_categories_sold IS NULL OR (cardinality(vat_categories_sold)>0 AND vat_categories_sold <@ ARRAY['16%','8%','0%','Exempt']::text[]));
