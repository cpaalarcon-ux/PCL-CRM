-- Build 1 of the client legal-structure design (Partner brief, 5 Nov 2026).
--  * Every client carries a Legal Structure (seven groups) and a Subcategory. The pairs live in a reference table so new
--    subcategories (and later new accounting families) are added as rows, not code.
--  * Each pair names its accounting / tax "engine family". Non-profit organisations (NGO, CBO, PBO ...) become the first new
--    family enabled for accounting; Public Entity, Co-operative and the rest stay in "Other legal entity" until enabled.
--  * clients.client_category is kept and stays in step (derived from the structure) so existing checks keep working.
--  * Non-profit chart accounts are added as Draft; a Partner approves each one from the chart of accounts screen.

CREATE TABLE erp_private.legal_structure_types(
 structure text NOT NULL CHECK(structure IN('Limited Company','Partnership','Individual','Non-Profit Organisation','Public Entity','Co-operative Society','Other')),
 subtype text NOT NULL CHECK(btrim(subtype)<>''),
 engine_family text NOT NULL CHECK(engine_family IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Other legal entity')),
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(structure,subtype)
);
ALTER TABLE erp_private.legal_structure_types ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.legal_structure_types TO erp_api;
CREATE POLICY legal_structure_types_read ON erp_private.legal_structure_types FOR SELECT TO erp_api USING(true);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.legal_structure_types FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

INSERT INTO erp_private.legal_structure_types(structure,subtype,engine_family,sort_order) VALUES
 ('Limited Company','Private Limited Company','Limited company',1),
 ('Limited Company','Public Limited Company','Limited company',2),
 ('Limited Company','Company Limited by Guarantee','Limited company',3),
 ('Partnership','General Partnership','Partnership',1),
 ('Partnership','Limited Liability Partnership (LLP)','Partnership',2),
 ('Partnership','Limited Partnership','Partnership',3),
 ('Individual','Sole Proprietor','Sole proprietor',1),
 ('Individual','Individual Taxpayer','Other legal entity',2),
 ('Non-Profit Organisation','NGO','Non-profit organisation',1),
 ('Non-Profit Organisation','CBO','Non-profit organisation',2),
 ('Non-Profit Organisation','PBO','Non-profit organisation',3),
 ('Non-Profit Organisation','Charitable Organisation','Non-profit organisation',4),
 ('Non-Profit Organisation','Foundation','Non-profit organisation',5),
 ('Non-Profit Organisation','Society','Non-profit organisation',6),
 ('Non-Profit Organisation','Self-Help Group','Non-profit organisation',7),
 ('Non-Profit Organisation','Faith-Based Organisation','Non-profit organisation',8),
 ('Public Entity','Government Ministry','Other legal entity',1),
 ('Public Entity','State Corporation','Other legal entity',2),
 ('Public Entity','County Government','Other legal entity',3),
 ('Public Entity','Public Institution','Other legal entity',4),
 ('Public Entity','Public School or College','Other legal entity',5),
 ('Public Entity','Public Hospital','Other legal entity',6),
 ('Co-operative Society','SACCO','Other legal entity',1),
 ('Co-operative Society','Co-operative Society','Other legal entity',2),
 ('Co-operative Society','Co-operative Union','Other legal entity',3),
 ('Other','Trust','Other legal entity',1),
 ('Other','Association','Other legal entity',2),
 ('Other','Chama or Investment Group','Other legal entity',3),
 ('Other','Estate','Other legal entity',4),
 ('Other','Other registered entity','Other legal entity',5);

-- The accounting engine now recognises Non-profit organisations.
ALTER TABLE erp_private.clients DROP CONSTRAINT clients_legal_entity_type_check;
ALTER TABLE erp_private.clients ADD CONSTRAINT clients_legal_entity_type_check
 CHECK(legal_entity_type IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Other legal entity'));
ALTER TABLE erp_private.client_chart_versions DROP CONSTRAINT client_chart_versions_entity_type_check;
ALTER TABLE erp_private.client_chart_versions ADD CONSTRAINT client_chart_versions_entity_type_check
 CHECK(entity_type IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Other legal entity'));
ALTER TABLE erp_private.ledger_periods DROP CONSTRAINT ledger_periods_entity_type_check;
ALTER TABLE erp_private.ledger_periods ADD CONSTRAINT ledger_periods_entity_type_check
 CHECK(entity_type IN('Limited company','Sole proprietor','Partnership','Non-profit organisation'));
ALTER TABLE erp_private.account_catalog DROP CONSTRAINT account_catalog_entity_types_check;
ALTER TABLE erp_private.account_catalog ADD CONSTRAINT account_catalog_entity_types_check
 CHECK(entity_types <@ ARRAY['Limited company','Partnership','Sole proprietor','Non-profit organisation']::text[]);

-- Client columns.
ALTER TABLE erp_private.clients
 ADD COLUMN legal_structure text CHECK(legal_structure IN('Limited Company','Partnership','Individual','Non-Profit Organisation','Public Entity','Co-operative Society','Other')),
 ADD COLUMN legal_subtype text,
 ADD COLUMN legal_structure_note text NOT NULL DEFAULT '',
 ADD COLUMN legal_structure_changed_by uuid REFERENCES erp_private.staff_members(staff_id),
 ADD COLUMN legal_structure_changed_at timestamptz,
 ADD CONSTRAINT clients_legal_subtype_needs_structure CHECK(legal_subtype IS NULL OR legal_structure IS NOT NULL),
 ADD CONSTRAINT clients_legal_structure_pair_fk FOREIGN KEY(legal_structure,legal_subtype) REFERENCES erp_private.legal_structure_types(structure,subtype);
CREATE INDEX clients_legal_structure_idx ON erp_private.clients(legal_structure,legal_subtype);
CREATE INDEX clients_legal_structure_changed_by_idx ON erp_private.clients(legal_structure_changed_by);

-- Keep the older Client category in step: it follows the structure; a plain category from an import fills a missing structure
-- only where it is unambiguous ("Corporate" is not: staff must confirm Limited Company, Co-operative and so on).
CREATE OR REPLACE FUNCTION erp_private.client_category_sync() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.legal_structure IS NOT NULL THEN
  NEW.client_category:=CASE NEW.legal_structure WHEN 'Individual' THEN 'Individual' WHEN 'Non-Profit Organisation' THEN 'Non-Profit' WHEN 'Public Entity' THEN 'Public Entity' ELSE 'Corporate' END;
 ELSIF NEW.client_category IN('Individual','Non-Profit','Public Entity') AND (TG_OP='INSERT' OR NEW.client_category IS DISTINCT FROM OLD.client_category) THEN
  NEW.legal_structure:=CASE NEW.client_category WHEN 'Individual' THEN 'Individual' WHEN 'Non-Profit' THEN 'Non-Profit Organisation' ELSE 'Public Entity' END;
 END IF;
 RETURN NEW;
END;$$;
REVOKE ALL ON FUNCTION erp_private.client_category_sync() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER a_client_category_sync BEFORE INSERT OR UPDATE ON erp_private.clients FOR EACH ROW EXECUTE FUNCTION erp_private.client_category_sync();

-- Existing clients: classify what the records already prove; the rest show as "Legal structure missing" for staff to confirm.
UPDATE erp_private.clients SET
 legal_structure=CASE
  WHEN legal_entity_type='Limited company' THEN 'Limited Company'
  WHEN legal_entity_type='Partnership' THEN 'Partnership'
  WHEN legal_entity_type='Sole proprietor' THEN 'Individual'
  WHEN client_category='Non-Profit' THEN 'Non-Profit Organisation'
  WHEN client_category='Public Entity' THEN 'Public Entity'
  WHEN client_category='Individual' THEN 'Individual'
  WHEN legal_entity_type='Other legal entity' THEN 'Other'
 END,
 legal_subtype=CASE WHEN legal_entity_type='Sole proprietor' THEN 'Sole Proprietor' END
WHERE legal_structure IS NULL;

-- Non-profit chart accounts: Draft until a Partner approves each one. Tax treatment stays with the Tax Lead.
INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,entity_types)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-05-NPO','Draft',ARRAY['Non-profit organisation']
FROM (VALUES
 ('20200','Grants received in advance - unspent restricted','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Grant agreements / bank statements','Held until the restricted spend is incurred; confirm the grant terms before releasing to income'),
 ('34300','Accumulated fund - non-profit','Equity',null,'EQUITY','Statement of financial position','Balance sheet','Audited accounts / governing body minutes','Replaces retained earnings for a non-profit; no share capital'),
 ('34310','Restricted funds - non-profit','Equity',null,'EQUITY','Statement of financial position','Balance sheet','Grant agreements / donor restrictions','Funds the donor has restricted; released as the restricted spend is incurred'),
 ('40300','Grants and donations - unrestricted','Revenue',null,'REV','Profit or loss','Income / turnover','Grant agreements / donor letters / bank','Tax treatment of non-profit income needs Tax Lead confirmation'),
 ('40310','Grants released from restricted funds','Revenue',null,'REV','Profit or loss','Income / turnover','Grant agreements / expenditure reports','Recognised as the restricted spend is incurred'),
 ('40320','Membership subscriptions and contributions','Revenue',null,'REV','Profit or loss','Income / turnover','Membership register / receipts','Check whether any part is a taxable supply - Tax Lead'),
 ('40330','Donated goods and services (in-kind)','Revenue',null,'REV','Profit or loss','Income / turnover','Donation register / valuation basis','Record only with a supportable valuation'),
 ('61300','Programme and project costs','Expenditure',2,'EXP01','Profit or loss','Review under the non-profit tax position','Invoices / project budgets','Charge to the funded project; keep donor reporting codes in the narrative'),
 ('61310','Beneficiary support and distributions','Expenditure',2,'EXP01','Profit or loss','Review under the non-profit tax position','Beneficiary lists / payment vouchers','Support the beneficiary selection and payment evidence')
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes)
ON CONFLICT(code) DO NOTHING;
