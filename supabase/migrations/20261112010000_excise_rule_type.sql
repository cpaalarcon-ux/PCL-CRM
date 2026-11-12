-- Build 2792: a dated-rule type for excise duty (a specific amount per unit of a product).
-- The type is added to the allowed list and ONE placeholder row is seeded for LPG. The placeholder carries no figure:
-- it is a Draft flagged Pending until the Tax Lead confirms the product code, unit and rate in writing.
ALTER TABLE erp_private.tax_rates DROP CONSTRAINT tax_rates_tax_type_check;
ALTER TABLE erp_private.tax_rates ADD CONSTRAINT tax_rates_tax_type_check CHECK(tax_type IN ('VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy','Turnover tax','Rental income tax','Capital gains tax','NSSF','Relief / deduction','Interest benchmark','Significant economic presence tax','Registration threshold','Excise duty'));

INSERT INTO erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,legal_review_status,legal_review_note)
SELECT 'KE_EXCISE_LPG','Excise duty','Excise duty on LPG (rate pending)',DATE '2026-01-01',DATE '2026-12-31','{}'::jsonb,'','Placeholder row. No product code, unit or rate has been confirmed.','Draft','Pending','The product code, the unit and the duty per unit await the Tax Lead written confirmation. Do not enter a figure until it is supplied with its legal source.'
WHERE NOT EXISTS(SELECT 1 FROM erp_private.tax_rates WHERE rate_key='KE_EXCISE_LPG');
