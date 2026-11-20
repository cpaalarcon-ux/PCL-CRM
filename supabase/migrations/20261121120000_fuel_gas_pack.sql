-- Build 2859: Fuel and gas industry pack (fuel, LPG, cylinders). Like the MSME pack, every new account is a Draft until a Partner approves it,
-- and none carries a tax rate or a tax decision. The account choices are a starting list for the Partner to review; nothing is switched on.
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT IF EXISTS account_catalog_industry_packs_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_industry_packs_check
  CHECK (industry_packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Fuel and gas','Other']::text[]);

ALTER TABLE erp_private.client_activities DROP CONSTRAINT IF EXISTS client_activities_pack_code_check;
ALTER TABLE erp_private.client_activities ADD CONSTRAINT client_activities_pack_code_check
  CHECK (pack_code IN ('Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Fuel and gas','Other'));

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.client_chart_versions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Wholesale%' LOOP
  EXECUTE format('ALTER TABLE erp_private.client_chart_versions DROP CONSTRAINT %I',c.conname);
 END LOOP;
 ALTER TABLE erp_private.client_chart_versions ADD CONSTRAINT client_chart_versions_packs_check
  CHECK (cardinality(packs)>0 AND packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','MSME','Fuel and gas','Other']::text[]);
END $$;

INSERT INTO erp_private.account_catalog
  (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,industry_packs)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-21-FUEL-GAS','Draft',industry_packs
FROM (VALUES
 ('10380','Fuel and gas stock','Current assets',null::int,'ASSET','Statement of financial position','','Dip readings / stock count sheets / supplier delivery notes','Stock is counted and valued by the method the client has chosen',ARRAY['Fuel and gas']),
 ('10390','Cylinders held for sale and exchange','Current assets',null::int,'ASSET','Statement of financial position','','Cylinder register / stock count sheets','Filled and empty cylinders the client owns; deposits held for cylinders on loan are kept in a separate liability',ARRAY['Fuel and gas']),
 ('20162','Cylinder and container deposits held','Liabilities',null::int,'LIAB','Statement of financial position','','Deposit receipts / cylinder register','Returnable deposits owed to customers until the cylinder or container comes back',ARRAY['Fuel and gas']),
 ('20165','Customer prepaid fuel and gas credit','Liabilities',null::int,'LIAB','Statement of financial position','','Prepayment receipts / customer statements','Amounts paid by customers for fuel or gas not yet delivered',ARRAY['Fuel and gas']),
 ('40441','Sales - fuel','Revenue',null::int,'REV','Profit or loss','Income / turnover','Pump readings / daily sales summaries / eTIMS invoices','',ARRAY['Fuel and gas']),
 ('40445','Sales - gas (LPG)','Revenue',null::int,'REV','Profit or loss','Income / turnover','Daily sales summaries / eTIMS invoices','',ARRAY['Fuel and gas']),
 ('40447','Sales - cylinders, regulators and accessories','Revenue',null::int,'REV','Profit or loss','Income / turnover','Sales invoices / eTIMS invoices','',ARRAY['Fuel and gas']),
 ('50220','Cost of fuel and gas sold','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Supplier invoices / delivery notes / stock counts','',ARRAY['Fuel and gas']),
 ('50230','Cost of cylinders and accessories sold','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Supplier invoices / delivery notes','',ARRAY['Fuel and gas']),
 ('50240','Stock loss - evaporation, spillage and handling','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Stock count variance report / incident log','Treatment of the loss for tax is a tax review matter',ARRAY['Fuel and gas']),
 ('61470','Energy regulator licence and permit fees','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Licence and permit receipts','The licences held are recorded on the client file; this account carries the fees',ARRAY['Fuel and gas']),
 ('61480','Pump, meter and cylinder testing and calibration','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Calibration certificates / test invoices','',ARRAY['Fuel and gas']),
 ('61490','Safety and environmental compliance costs','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Safety audit reports / invoices','',ARRAY['Fuel and gas'])
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes,industry_packs)
ON CONFLICT (code) DO NOTHING;

-- Provisional statement lines, as for every other account: a Draft mapping the Partner approves or changes.
INSERT INTO erp_private.account_statement_map(account_code,line_code,effective_from,reason)
SELECT code,line_code,DATE '2025-01-01','Provisional: Fuel and gas pack account; awaiting Partner approval'
FROM (VALUES
 ('10380','SFP.INV'),('10390','SFP.INV'),
 ('20162','SFP.DEPOSITS'),('20165','SFP.DEPOSITS'),
 ('40441','PL.REVENUE'),('40445','PL.REVENUE'),('40447','PL.REVENUE'),
 ('50220','PL.COST_SALES'),('50230','PL.COST_SALES'),('50240','PL.COST_SALES'),
 ('61470','PL.OTHER_OPEX'),('61480','PL.OTHER_OPEX'),('61490','PL.OTHER_OPEX')
) AS m(code,line_code);
