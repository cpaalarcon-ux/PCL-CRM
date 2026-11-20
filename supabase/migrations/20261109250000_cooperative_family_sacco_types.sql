-- S1: Co-operative society becomes its own entity family, and SACCOs are split into the two regulated types used by the audit specification.
--  * Engine family 'Co-operative society' is classified and tracked now. Its ledger, chart of accounts and statements are NOT enabled
--    here (that is the SACCO chart build), so accountingEnabled('Co-operative society') stays false.
--  * Deposit-taking SACCO and Non-withdrawable-deposit-taking SACCO are separate subcategories. The type is read from the subcategory
--    (legal_structure_types.sacco_type), never typed in a second place, so it cannot disagree with the legal structure.
--  * The old single 'SACCO' subcategory is retired, not deleted: it stays for any client already on it but cannot be chosen again.
--  * No rate, ratio or deadline is stored here. Prudential ratios and dates are Partner-confirmed registers in later builds.
ALTER TABLE erp_private.legal_structure_types DROP CONSTRAINT IF EXISTS legal_structure_types_engine_family_check;
ALTER TABLE erp_private.legal_structure_types ADD CONSTRAINT legal_structure_types_engine_family_check
 CHECK(engine_family IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Co-operative society','Other legal entity'));
ALTER TABLE erp_private.clients DROP CONSTRAINT clients_legal_entity_type_check;
ALTER TABLE erp_private.clients ADD CONSTRAINT clients_legal_entity_type_check
 CHECK(legal_entity_type IN('Limited company','Partnership','Sole proprietor','Non-profit organisation','Foreign branch','Co-operative society','Other legal entity'));

ALTER TABLE erp_private.legal_structure_types ADD COLUMN IF NOT EXISTS retired boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.legal_structure_types ADD COLUMN IF NOT EXISTS sacco_type text CHECK(sacco_type IN('DT_SACCO','NWDT_SACCO'));

INSERT INTO erp_private.legal_structure_types(structure,subtype,engine_family,sort_order,sacco_type) VALUES
 ('Co-operative Society','Deposit-taking SACCO','Co-operative society',1,'DT_SACCO'),
 ('Co-operative Society','Non-withdrawable-deposit-taking SACCO','Co-operative society',2,'NWDT_SACCO')
ON CONFLICT (structure,subtype) DO NOTHING;
UPDATE erp_private.legal_structure_types SET engine_family='Co-operative society',sort_order=3 WHERE structure='Co-operative Society' AND subtype='Co-operative Society';
UPDATE erp_private.legal_structure_types SET engine_family='Co-operative society',sort_order=4 WHERE structure='Co-operative Society' AND subtype='Co-operative Union';
UPDATE erp_private.legal_structure_types SET retired=true,sort_order=99 WHERE structure='Co-operative Society' AND subtype='SACCO';

-- A retired subcategory cannot be given to a client again; a client already on it may keep it until a Manager or Partner reclassifies.
CREATE OR REPLACE FUNCTION erp_private.legal_subtype_not_retired() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF NEW.legal_structure IS NOT NULL AND NEW.legal_subtype IS NOT NULL
  AND (TG_OP='INSERT' OR NEW.legal_structure IS DISTINCT FROM OLD.legal_structure OR NEW.legal_subtype IS DISTINCT FROM OLD.legal_subtype)
  AND EXISTS(SELECT 1 FROM erp_private.legal_structure_types t WHERE t.structure=NEW.legal_structure AND t.subtype=NEW.legal_subtype AND t.retired) THEN
  RAISE EXCEPTION 'The subcategory "%" is retired. Choose Deposit-taking SACCO, Non-withdrawable-deposit-taking SACCO or another current subcategory.',NEW.legal_subtype USING ERRCODE='check_violation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legal_subtype_not_retired BEFORE INSERT OR UPDATE OF legal_structure,legal_subtype ON erp_private.clients
 FOR EACH ROW EXECUTE FUNCTION erp_private.legal_subtype_not_retired();

-- The SACCO type of a client, read from its subcategory: DT_SACCO, NWDT_SACCO or NOT_SACCO. Later builds use this for the SASRA gates.
CREATE OR REPLACE FUNCTION erp_private.client_sacco_type(p_client uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT COALESCE((SELECT t.sacco_type FROM erp_private.clients c JOIN erp_private.legal_structure_types t ON t.structure=c.legal_structure AND t.subtype=c.legal_subtype
  WHERE c.client_id=p_client),'NOT_SACCO')
$$;
REVOKE ALL ON FUNCTION erp_private.client_sacco_type(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION erp_private.client_sacco_type(uuid) TO erp_api;

-- Checklist: both SACCO types start from the co-operative list. The SASRA licence is required for the deposit-taking type; for the
-- non-withdrawable type it is shown but does not block, because its status has to be confirmed by the Compliance Lead.
INSERT INTO erp_private.legal_structure_requirements(structure,subtype,rule_code,requirement,note,sort_order)
SELECT r.structure,s.subtype,r.rule_code,r.requirement,r.note,r.sort_order
FROM erp_private.legal_structure_requirements r
CROSS JOIN (VALUES('Deposit-taking SACCO'),('Non-withdrawable-deposit-taking SACCO')) s(subtype)
WHERE r.structure='Co-operative Society' AND r.subtype='Co-operative Society'
ON CONFLICT DO NOTHING;
INSERT INTO erp_private.legal_structure_requirements(structure,subtype,rule_code,requirement,note,sort_order) VALUES
 ('Co-operative Society','Deposit-taking SACCO','SACCO_LICENCE','Required','SASRA licence for deposit-taking business',150),
 ('Co-operative Society','Non-withdrawable-deposit-taking SACCO','SACCO_LICENCE','If applicable','Compliance Lead to confirm the SASRA registration or authorisation held',250)
ON CONFLICT DO NOTHING;

-- Tax: filing position only, as for every other co-operative. Nothing is computed and no rate is stored.
INSERT INTO erp_private.legal_structure_tax_defaults(structure,subtype,taxpayer_class,profile_entity_type,suggested_obligations,note,rule_status)
SELECT d.structure,s.subtype,s.class,d.profile_entity_type,d.suggested_obligations,
 'SACCOs have additional rules on interest and withholding. Other entity income tax records the filing position only; the ERP does not compute it. Tax Lead to confirm.','Suggested'
FROM erp_private.legal_structure_tax_defaults d
CROSS JOIN (VALUES('Deposit-taking SACCO','Deposit-taking SACCO'),('Non-withdrawable-deposit-taking SACCO','Non-withdrawable-deposit-taking SACCO')) s(subtype,class)
WHERE d.structure='Co-operative Society' AND d.subtype='SACCO'
ON CONFLICT DO NOTHING;
