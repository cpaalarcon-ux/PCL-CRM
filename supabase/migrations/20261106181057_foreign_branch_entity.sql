-- Slice 18: Foreign branch becomes a sixth accounting entity family. No tax rate is stored here: the branch's
-- corporation tax and any repatriation tax stay with the Tax Lead until confirmed in writing.
ALTER TABLE erp_private.legal_structure_types DROP CONSTRAINT IF EXISTS legal_structure_types_engine_family_check;
ALTER TABLE erp_private.legal_structure_types ADD CONSTRAINT legal_structure_types_engine_family_check
 CHECK(engine_family IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Other legal entity'));

ALTER TABLE erp_private.clients DROP CONSTRAINT clients_legal_entity_type_check;
ALTER TABLE erp_private.clients ADD CONSTRAINT clients_legal_entity_type_check
 CHECK(legal_entity_type IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Other legal entity'));
ALTER TABLE erp_private.client_chart_versions DROP CONSTRAINT client_chart_versions_entity_type_check;
ALTER TABLE erp_private.client_chart_versions ADD CONSTRAINT client_chart_versions_entity_type_check
 CHECK(entity_type IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Other legal entity'));
ALTER TABLE erp_private.ledger_periods DROP CONSTRAINT ledger_periods_entity_type_check;
ALTER TABLE erp_private.ledger_periods ADD CONSTRAINT ledger_periods_entity_type_check
 CHECK(entity_type IN('Limited company','Sole proprietor','Partnership','Non-profit organisation','Foreign branch'));
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT account_catalog_entity_types_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_entity_types_check
 CHECK(entity_types <@ ARRAY['Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch']::text[]);

INSERT INTO erp_private.legal_structure_types(structure,subtype,engine_family,sort_order) VALUES
 ('Limited Company','Branch of a Foreign Company','Foreign branch',4)
ON CONFLICT (structure,subtype) DO NOTHING;

-- Branch accounts: Draft until a Partner approves each one.
INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,entity_types)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-06-BRANCH','Draft',ARRAY['Foreign branch']
FROM (VALUES
 ('34320','Head office account - foreign branch','Equity',null::int,'EQUITY','Statement of financial position','Balance sheet','Head office funding letters / branch accounts','Replaces share capital for a branch of a foreign company','Equity'),
 ('20230','Amounts due to head office and group companies','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Head office statements / intercompany confirmations','Remittances and recharges with head office; tax treatment to be confirmed by the Tax Lead','Liabilities')
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes,grp)
ON CONFLICT (code) DO NOTHING;

-- The branch starts from the Private Limited Company evidence checklist and suggested classification; the Tax Lead decides the rest.
INSERT INTO erp_private.legal_structure_requirements(structure,subtype,rule_code,requirement,note,sort_order)
SELECT structure,'Branch of a Foreign Company',rule_code,requirement,note,sort_order
FROM erp_private.legal_structure_requirements WHERE structure='Limited Company' AND subtype='Private Limited Company'
ON CONFLICT DO NOTHING;
INSERT INTO erp_private.legal_structure_tax_defaults(structure,subtype,taxpayer_class,profile_entity_type,suggested_obligations,note,rule_status)
SELECT structure,'Branch of a Foreign Company','Branch of a foreign company',profile_entity_type,suggested_obligations,
 'Treated like a company for income-tax profiling. The Tax Lead decides the branch''s corporation tax and any repatriation tax; no rate is stored.','Suggested'
FROM erp_private.legal_structure_tax_defaults WHERE structure='Limited Company' AND subtype='Private Limited Company'
ON CONFLICT DO NOTHING;
