-- Slice 16: four more industry packs (Agriculture, Transport, Technology, Manufacturing) with their accounts.
-- Every new account is a Draft until a Partner approves it, and none carries a tax rate. Codes are new numbers in this
-- firm's own chart; they are not taken from any other chart.
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT IF EXISTS account_catalog_industry_packs_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_industry_packs_check
  CHECK (industry_packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','Other']::text[]);

ALTER TABLE erp_private.client_activities DROP CONSTRAINT IF EXISTS client_activities_pack_code_check;
ALTER TABLE erp_private.client_activities ADD CONSTRAINT client_activities_pack_code_check
  CHECK (pack_code IN ('Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','Other'));

DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='erp_private.client_chart_versions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%Wholesale%' LOOP
  EXECUTE format('ALTER TABLE erp_private.client_chart_versions DROP CONSTRAINT %I',c.conname);
 END LOOP;
 ALTER TABLE erp_private.client_chart_versions ADD CONSTRAINT client_chart_versions_packs_check
  CHECK (cardinality(packs)>0 AND packs <@ ARRAY['Wholesale','Retail','Hospitality','Consultancy','Construction','Agriculture','Transport','Technology','Manufacturing','Other']::text[]);
END $$;

INSERT INTO erp_private.account_catalog
  (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,industry_packs)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-06-IND2','Draft',industry_packs
FROM (VALUES
 ('10310','Biological assets - growing crops and livestock','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Farm records / valuations / livestock registers','Fair value less costs to sell (IAS 41); bearer plants are property, plant and equipment',ARRAY['Agriculture']),
 ('10320','Harvested produce on hand','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Stock records / produce delivery notes','Measured at fair value at harvest',ARRAY['Agriculture']),
 ('40340','Sale of farm produce','Revenue',null::int,'REV','Profit or loss','Income / turnover','Delivery notes / invoices / eTIMS','VAT category depends on whether the produce is processed - tax review',ARRAY['Agriculture']),
 ('40350','Fair value gain on biological assets','Revenue',null::int,'REV','Profit or loss','Income / turnover','Valuation workings','Non-cash; tax treatment to be reviewed',ARRAY['Agriculture']),
 ('50180','Farm inputs - seed, fertiliser and agrochemicals','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Supplier invoices / stores issues','',ARRAY['Agriculture']),
 ('61320','Casual farm labour','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Muster rolls / payroll records','Check the casual-worker PAYE position',ARRAY['Agriculture']),
 ('61330','Veterinary and crop-protection services','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Invoices / service reports','',ARRAY['Agriculture']),
 ('61340','Fair value loss on biological assets','Expenditure',2,'EXP01','Profit or loss','Review for deductibility','Valuation workings','Non-cash; tax treatment to be reviewed',ARRAY['Agriculture']),
 ('20210','Customer deposits and advance freight','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Bookings / receipts','Revenue when the trip or haulage is performed',ARRAY['Transport']),
 ('40360','Freight and haulage income','Revenue',null::int,'REV','Profit or loss','Income / turnover','Delivery notes / invoices / eTIMS','',ARRAY['Transport']),
 ('40370','Passenger fare income','Revenue',null::int,'REV','Profit or loss','Income / turnover','Trip sheets / ticket records','',ARRAY['Transport']),
 ('61350','Vehicle licences, inspections and permits','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Licences / receipts','',ARRAY['Transport']),
 ('61360','Tyres and vehicle spares - fleet','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Invoices / job cards','Capital improvements are not repairs - review',ARRAY['Transport']),
 ('61370','Goods-in-transit and fleet insurance','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Policy schedules / invoices','',ARRAY['Transport']),
 ('61380','Trip costs - tolls, parking and crew allowances','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Trip sheets / receipts','',ARRAY['Transport']),
 ('10330','Contract assets - unbilled usage and services','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Usage reports / contract schedules','Cut-off review at period end',ARRAY['Technology']),
 ('20220','Deferred revenue - subscriptions and licences','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Subscription schedules / invoices','Annual or multi-period billings released over the service period',ARRAY['Technology']),
 ('40380','Subscription and platform revenue','Revenue',null::int,'REV','Profit or loss','Income / turnover','Billing system / invoices / eTIMS','Recognised over the subscription period',ARRAY['Technology']),
 ('40390','Software licence and implementation fees','Revenue',null::int,'REV','Profit or loss','Income / turnover','Contracts / invoices / eTIMS','',ARRAY['Technology']),
 ('40400','Support and maintenance income','Revenue',null::int,'REV','Profit or loss','Income / turnover','Support contracts / invoices','',ARRAY['Technology']),
 ('61390','Cloud hosting and infrastructure','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Provider invoices','Cross-border service - review withholding on payments',ARRAY['Technology']),
 ('61400','Software subscriptions and platform licences','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Provider invoices','Cross-border service - review withholding on payments',ARRAY['Technology']),
 ('10350','Raw materials stock','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Stores records / stock counts','',ARRAY['Manufacturing']),
 ('10360','Work in progress - production','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Production records / costing sheets','Costs move from raw materials to WIP to finished goods',ARRAY['Manufacturing']),
 ('10370','Finished goods stock','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Stock records / stock counts','',ARRAY['Manufacturing']),
 ('40410','Sales - manufactured goods','Revenue',null::int,'REV','Profit or loss','Income / turnover','Invoices / eTIMS','Excise status to be confirmed per product',ARRAY['Manufacturing']),
 ('40420','Scrap and by-product sales','Revenue',null::int,'REV','Profit or loss','Income / turnover','Invoices / eTIMS','',ARRAY['Manufacturing']),
 ('50190','Raw materials consumed','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Stores issue records / costing sheets','',ARRAY['Manufacturing']),
 ('50200','Factory consumables and packaging','Cost of sales',1,'STOCK','Profit or loss','Cost of sales','Invoices / stores issues','',ARRAY['Manufacturing']),
 ('61410','Factory power, water and utilities','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Utility bills / meter records','',ARRAY['Manufacturing']),
 ('61420','Production wastage and scrap written off','Expenditure',2,'EXP01','Profit or loss','Generally deductible subject to law / support','Wastage reports','',ARRAY['Manufacturing'])
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes,industry_packs)
ON CONFLICT (code) DO NOTHING;
