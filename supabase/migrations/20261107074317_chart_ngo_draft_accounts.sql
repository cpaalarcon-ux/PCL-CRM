-- Chart slice B: the account tags may name any client entity type, and the non-profit chart gets four Draft accounts
-- for fund and grant accounting. Draft accounts are not proposed to any client until a Partner activates them.
-- No tax rate or tax treatment is stored here; non-profit income treatment stays with the Tax Lead.
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT IF EXISTS account_catalog_entity_types_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_entity_types_check
 CHECK(entity_types <@ ARRAY['Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Other legal entity']::text[]);

INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,entity_types)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-07-NGO','Draft',ARRAY['Non-profit organisation']
FROM (VALUES
 ('10340','Grants and pledges receivable','Current assets',null::int,'ASSET','Statement of financial position','Balance sheet','Grant agreements / donor pledge letters','Grant income earned but not yet received; confirm the agreement terms before recognising'),
 ('20240','Grants refundable to donors','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Grant agreements / donor correspondence / refund proof','Unspent or disallowed grant money the organisation must return'),
 ('34330','Designated funds - non-profit','Equity',null::int,'EQUITY','Statement of financial position','Balance sheet','Board or committee resolution','Funds the governing body has set aside for a purpose; not donor-restricted'),
 ('40440','Restricted grants and donations received','Revenue',null::int,'REV','Profit or loss','Income / turnover','Grant agreements / donor letters / bank','Donor-restricted receipts before release to the restricted fund; tax treatment of non-profit income needs Tax Lead confirmation')
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes)
ON CONFLICT (code) DO NOTHING;
