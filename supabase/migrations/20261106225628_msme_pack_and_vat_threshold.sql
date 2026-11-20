-- Slice 26: MSME / informal-trader industry pack and a Rate Register row for the VAT registration threshold.
-- Every new account is a Draft until a Partner approves it, and none carries a tax rate. The threshold row stores no
-- figure: it is a Draft flagged Pending until the Tax Lead confirms the amount in writing.
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT IF EXISTS account_catalog_industry_packs_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_industry_packs_check
  CHECK (industry_packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Other']::text[]);

ALTER TABLE erp_private.client_activities DROP CONSTRAINT IF EXISTS client_activities_pack_code_check;
ALTER TABLE erp_private.client_activities ADD CONSTRAINT client_activities_pack_code_check
  CHECK (pack_code IN ('Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Other'));

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.client_chart_versions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Wholesale%' LOOP
  EXECUTE format('ALTER TABLE erp_private.client_chart_versions DROP CONSTRAINT %I',c.conname);
 END LOOP;
 ALTER TABLE erp_private.client_chart_versions ADD CONSTRAINT client_chart_versions_packs_check
  CHECK (cardinality(packs)>0 AND packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Other']::text[]);
END $$;

INSERT INTO erp_private.account_catalog
  (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,industry_packs)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-07-MSME','Draft',industry_packs
FROM (VALUES
 ('40430','Daily takings - cash and mobile money','Revenue',null::int,'REV','Profit or loss','Income / turnover','Daily sales book / till roll / mobile money statements','For traders who record sales as daily totals; the daily sales register is the evidence',ARRAY['MSME']),
 ('50210','Stock bought without an eTIMS invoice','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Delivery notes / supplier receipts / daily purchases register','Deductibility and VAT treatment depend on the evidence held - tax review',ARRAY['MSME']),
 ('61430','Stall, kiosk or site rent','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Rent receipts / landlord or market-association receipts','',ARRAY['MSME']),
 ('61440','County permit and market fees','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','County receipts / permit','',ARRAY['MSME']),
 ('61450','Market association and security contributions','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Association receipts','',ARRAY['MSME']),
 ('61460','Transport of stock - boda, matatu and handcart fares','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Trip log / mobile money messages','',ARRAY['MSME'])
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes,industry_packs)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE erp_private.tax_rates DROP CONSTRAINT tax_rates_tax_type_check;
ALTER TABLE erp_private.tax_rates ADD CONSTRAINT tax_rates_tax_type_check CHECK(tax_type IN ('VAT','PAYE','Corporation tax','Individual income tax','Withholding tax','Levy','Turnover tax','Rental income tax','Capital gains tax','NSSF','Relief / deduction','Interest benchmark','Significant economic presence tax','Registration threshold'));

INSERT INTO erp_private.tax_rates(rate_key,tax_type,label,effective_from,effective_to,parameters,source_url,source_note,status,legal_review_status,legal_review_note)
SELECT 'KE_VAT_REG_THRESHOLD','Registration threshold','VAT registration threshold (figure pending)',DATE '2026-01-01',DATE '2026-12-31','{}'::jsonb,'','Placeholder row. No threshold has been confirmed.','Draft','Pending','The VAT registration threshold awaits the Tax Lead written confirmation. Do not enter a figure until it is supplied with its legal source.'
WHERE NOT EXISTS(SELECT 1 FROM erp_private.tax_rates WHERE rate_key='KE_VAT_REG_THRESHOLD');
