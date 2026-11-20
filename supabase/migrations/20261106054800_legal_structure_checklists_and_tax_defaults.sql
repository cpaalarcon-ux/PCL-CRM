-- Legal Structure Build 2 (KYC and document checklists) and Build 3 (taxpayer classification and suggested obligations).
--  * Every Legal structure + Subcategory pair gets its own list of KYC requirements and Permanent File documents. A requirement is
--    "Required" (blocks KYC verification), "If applicable" (shown, does not block) or "Permanent file" (a document to collect, does not block).
--  * The new evidence kinds are added as rules in Testing; the Compliance Lead confirms forms and renewal intervals as for the existing five.
--  * Every pair also gets a Suggested taxpayer classification, the tax-profile entity type and the obligations normally checked. These
--    are starting points for the Tax Lead; nothing is applied to a client without a staff member saving and a different Manager or Partner
--    verifying the tax profile.
--  * No existing requirement is made lighter: Company, Partnership, Sole proprietor and Other keep every rule they have today.

INSERT INTO erp_private.kyc_evidence_rules(rule_code,label,accepted_forms,renewal_days,required_for_entities,rule_source) VALUES
 ('NATIONAL_ID','National ID or passport',ARRAY['upload','physical','online'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('PARTNERSHIP_DEED','Partnership deed or LLP agreement',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('PARTNERS_LIST','Partners with ID and KRA PIN',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('GOVERNING_DOCUMENT','Constitution, trust deed or by-laws',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('OFFICE_BEARERS','Officials, trustees or committee members (with ID)',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('PBO_EXEMPTION','PBO status or KRA income-tax exemption letter',ARRAY['upload','physical','online'],NULL,ARRAY[]::text[],'Suggested by legal structure. Tax Lead and Compliance Lead to confirm what proves exemption.'),
 ('BOARD_RESOLUTION','Governing body resolution authorising the engagement and signatories',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('FUNDER_AGREEMENTS','Donor or funder agreements',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('ESTABLISHING_INSTRUMENT','Establishing Act, charter, gazette notice or order',ARRAY['upload','physical','online'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('ACCOUNTING_OFFICER','Appointment of accounting officer or head of finance',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('SACCO_LICENCE','SASRA licence (deposit-taking SACCO)',ARRAY['upload','physical','online'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('PROBATE_LETTERS','Grant of probate or letters of administration',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Suggested by legal structure. Form and renewal interval require Compliance Lead confirmation.'),
 ('BANK_MANDATE','Bank account details and mandate',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Permanent File document. Not a KYC gate.'),
 ('PRIOR_FINANCIALS','Last approved financial statements',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Permanent File document. Not a KYC gate.'),
 ('MINUTES','Minutes of the last general meeting',ARRAY['upload','physical'],NULL,ARRAY[]::text[],'Permanent File document. Not a KYC gate.')
ON CONFLICT(rule_code) DO NOTHING;

CREATE TABLE erp_private.legal_structure_requirements(
 structure text NOT NULL,
 subtype text NOT NULL,
 rule_code text NOT NULL REFERENCES erp_private.kyc_evidence_rules(rule_code),
 requirement text NOT NULL CHECK(requirement IN('Required','If applicable','Permanent file')),
 note text NOT NULL DEFAULT '',
 sort_order integer NOT NULL DEFAULT 0,
 PRIMARY KEY(structure,subtype,rule_code),
 FOREIGN KEY(structure,subtype) REFERENCES erp_private.legal_structure_types(structure,subtype)
);
ALTER TABLE erp_private.legal_structure_requirements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.legal_structure_requirements TO erp_api;
CREATE POLICY legal_structure_requirements_read ON erp_private.legal_structure_requirements FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.legal_structure_requirements FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

-- '*' means every subcategory of the structure; a row for a named subcategory is inserted first and wins.
INSERT INTO erp_private.legal_structure_requirements(structure,subtype,rule_code,requirement,note,sort_order)
WITH _req(structure,subtype,rule_code,requirement,note) AS (VALUES
 -- Limited Company (all subcategories keep the five existing rules, plus documents to collect)
 ('Limited Company','*','REGISTRATION_IDENTITY','Required','Certificate of incorporation'),
 ('Limited Company','*','KRA_PIN','Required',''),
 ('Limited Company','*','DIRECTORS_CR12','Required','Current CR12'),
 ('Limited Company','*','REGISTER_MEMBERS','Required',''),
 ('Limited Company','*','BENEFICIAL_OWNERSHIP','Required',''),
 ('Limited Company','*','BOARD_RESOLUTION','If applicable','Needed when a director signs for the company for the first time'),
 ('Limited Company','*','BANK_MANDATE','Permanent file',''),
 ('Limited Company','*','PRIOR_FINANCIALS','Permanent file',''),
 ('Limited Company','*','MINUTES','Permanent file','Last AGM'),
 ('Limited Company','Company Limited by Guarantee','GOVERNING_DOCUMENT','Required','Memorandum and articles (guarantee members)'),
 -- Partnership
 ('Partnership','*','REGISTRATION_IDENTITY','Required','Business name certificate or LLP certificate'),
 ('Partnership','*','KRA_PIN','Required',''),
 ('Partnership','*','PARTNERSHIP_DEED','Required','Signed deed, or LLP agreement'),
 ('Partnership','*','PARTNERS_LIST','Required','Every partner with ID number and KRA PIN'),
 ('Partnership','*','NATIONAL_ID','If applicable','ID or passport of each partner'),
 ('Partnership','*','BANK_MANDATE','Permanent file',''),
 ('Partnership','*','PRIOR_FINANCIALS','Permanent file',''),
 ('Partnership','Limited Liability Partnership (LLP)','BENEFICIAL_OWNERSHIP','Required',''),
 ('Partnership','Limited Partnership','BENEFICIAL_OWNERSHIP','If applicable',''),
 -- Individual
 ('Individual','Sole Proprietor','REGISTRATION_IDENTITY','Required','Business name certificate if registered, otherwise national ID'),
 ('Individual','Sole Proprietor','KRA_PIN','Required',''),
 ('Individual','Sole Proprietor','NATIONAL_ID','If applicable',''),
 ('Individual','Sole Proprietor','BANK_MANDATE','Permanent file',''),
 ('Individual','Individual Taxpayer','NATIONAL_ID','Required',''),
 ('Individual','Individual Taxpayer','KRA_PIN','Required',''),
 ('Individual','Individual Taxpayer','BANK_MANDATE','Permanent file',''),
 -- Non-Profit Organisation
 ('Non-Profit Organisation','*','REGISTRATION_IDENTITY','Required','Registration certificate from the registrar'),
 ('Non-Profit Organisation','*','KRA_PIN','Required',''),
 ('Non-Profit Organisation','*','GOVERNING_DOCUMENT','Required','Constitution or trust deed'),
 ('Non-Profit Organisation','*','OFFICE_BEARERS','Required','Board, trustees or committee with IDs'),
 ('Non-Profit Organisation','*','BOARD_RESOLUTION','Required',''),
 ('Non-Profit Organisation','*','PBO_EXEMPTION','If applicable','Only if tax exemption has been granted'),
 ('Non-Profit Organisation','*','FUNDER_AGREEMENTS','If applicable','Grant-funded work'),
 ('Non-Profit Organisation','*','BANK_MANDATE','Permanent file',''),
 ('Non-Profit Organisation','*','PRIOR_FINANCIALS','Permanent file',''),
 ('Non-Profit Organisation','*','MINUTES','Permanent file','Last general meeting'),
 ('Non-Profit Organisation','NGO','REGISTRATION_IDENTITY','Required','NGO Coordination Board certificate'),
 ('Non-Profit Organisation','CBO','REGISTRATION_IDENTITY','Required','Social services or registrar certificate'),
 ('Non-Profit Organisation','CBO','REGISTER_MEMBERS','If applicable',''),
 ('Non-Profit Organisation','PBO','PBO_EXEMPTION','Required','Public benefit organisation status letter'),
 ('Non-Profit Organisation','Society','REGISTRATION_IDENTITY','Required','Registrar of Societies certificate'),
 ('Non-Profit Organisation','Society','REGISTER_MEMBERS','Required',''),
 ('Non-Profit Organisation','Self-Help Group','REGISTRATION_IDENTITY','Required','Social services registration certificate'),
 ('Non-Profit Organisation','Self-Help Group','REGISTER_MEMBERS','Required',''),
 ('Non-Profit Organisation','Faith-Based Organisation','REGISTRATION_IDENTITY','Required','Registrar certificate or trustees incorporation'),
 -- Public Entity (no registration certificate is expected; the establishing instrument takes its place)
 ('Public Entity','*','ESTABLISHING_INSTRUMENT','Required','Act, charter, gazette notice or order'),
 ('Public Entity','*','KRA_PIN','Required',''),
 ('Public Entity','*','ACCOUNTING_OFFICER','Required',''),
 ('Public Entity','*','REGISTRATION_IDENTITY','If applicable','Only if the entity also holds a registration certificate'),
 ('Public Entity','*','BOARD_RESOLUTION','If applicable','Board or council resolution authorising the engagement'),
 ('Public Entity','*','BANK_MANDATE','Permanent file',''),
 ('Public Entity','*','PRIOR_FINANCIALS','Permanent file','Last audited accounts'),
 -- Co-operative Society
 ('Co-operative Society','*','REGISTRATION_IDENTITY','Required','Co-operative registration certificate'),
 ('Co-operative Society','*','KRA_PIN','Required',''),
 ('Co-operative Society','*','GOVERNING_DOCUMENT','Required','By-laws'),
 ('Co-operative Society','*','OFFICE_BEARERS','Required','Board or management committee with IDs'),
 ('Co-operative Society','*','REGISTER_MEMBERS','Required',''),
 ('Co-operative Society','*','BOARD_RESOLUTION','Required',''),
 ('Co-operative Society','*','BANK_MANDATE','Permanent file',''),
 ('Co-operative Society','*','PRIOR_FINANCIALS','Permanent file',''),
 ('Co-operative Society','*','MINUTES','Permanent file','Last annual general meeting'),
 ('Co-operative Society','SACCO','SACCO_LICENCE','If applicable','Deposit-taking SACCOs only'),
 -- Other
 ('Other','Trust','REGISTRATION_IDENTITY','Required','Trust registration or incorporation certificate'),
 ('Other','Trust','KRA_PIN','Required',''),
 ('Other','Trust','GOVERNING_DOCUMENT','Required','Trust deed'),
 ('Other','Trust','OFFICE_BEARERS','Required','Trustees with IDs'),
 ('Other','Trust','BENEFICIAL_OWNERSHIP','If applicable','Settlor and beneficiaries'),
 ('Other','Trust','BANK_MANDATE','Permanent file',''),
 ('Other','Association','REGISTRATION_IDENTITY','Required',''),
 ('Other','Association','KRA_PIN','Required',''),
 ('Other','Association','GOVERNING_DOCUMENT','Required','Constitution'),
 ('Other','Association','OFFICE_BEARERS','Required',''),
 ('Other','Association','REGISTER_MEMBERS','If applicable',''),
 ('Other','Association','BANK_MANDATE','Permanent file',''),
 ('Other','Chama or Investment Group','REGISTRATION_IDENTITY','Required','Registration certificate'),
 ('Other','Chama or Investment Group','KRA_PIN','Required',''),
 ('Other','Chama or Investment Group','GOVERNING_DOCUMENT','Required','Constitution'),
 ('Other','Chama or Investment Group','OFFICE_BEARERS','Required',''),
 ('Other','Chama or Investment Group','REGISTER_MEMBERS','Required',''),
 ('Other','Chama or Investment Group','BANK_MANDATE','Permanent file',''),
 ('Other','Estate','PROBATE_LETTERS','Required',''),
 ('Other','Estate','KRA_PIN','Required','PIN used for the estate'),
 ('Other','Estate','NATIONAL_ID','Required','Administrator and deceased'),
 ('Other','Estate','REGISTRATION_IDENTITY','If applicable',''),
 ('Other','Estate','BANK_MANDATE','Permanent file',''),
 ('Other','Other registered entity','REGISTRATION_IDENTITY','Required',''),
 ('Other','Other registered entity','KRA_PIN','Required',''),
 ('Other','Other registered entity','GOVERNING_DOCUMENT','If applicable',''),
 ('Other','Other registered entity','OFFICE_BEARERS','If applicable',''),
 ('Other','Other registered entity','BANK_MANDATE','Permanent file','')
),pick AS (
 SELECT DISTINCT ON(t.structure,t.subtype,r.rule_code) t.structure,t.subtype,r.rule_code,r.requirement,r.note
 FROM _req r JOIN erp_private.legal_structure_types t ON t.structure=r.structure AND(r.subtype='*' OR r.subtype=t.subtype)
 ORDER BY t.structure,t.subtype,r.rule_code,(r.subtype='*')
)
SELECT structure,subtype,rule_code,requirement,note,
 CASE requirement WHEN 'Required' THEN 100 WHEN 'If applicable' THEN 200 ELSE 300 END+(row_number() OVER(PARTITION BY structure,subtype,requirement ORDER BY rule_code))::int
FROM pick;

-- Build 3: suggested taxpayer classification and obligations per pair.
CREATE TABLE erp_private.legal_structure_tax_defaults(
 structure text NOT NULL,
 subtype text NOT NULL,
 taxpayer_class text NOT NULL CHECK(btrim(taxpayer_class)<>''),
 profile_entity_type text NOT NULL CHECK(profile_entity_type IN('Company','Partnership','Individual','Other')),
 suggested_obligations text[] NOT NULL DEFAULT ARRAY[]::text[],
 note text NOT NULL DEFAULT '',
 rule_status text NOT NULL DEFAULT 'Suggested' CHECK(rule_status IN('Suggested','Approved')),
 PRIMARY KEY(structure,subtype),
 FOREIGN KEY(structure,subtype) REFERENCES erp_private.legal_structure_types(structure,subtype),
 CHECK(suggested_obligations <@ ARRAY['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest','Withholding VAT agent','Withholding VAT credits received','Withholding income tax credits received','Excise duty','Instalment tax','Advance tax']::text[])
);
ALTER TABLE erp_private.legal_structure_tax_defaults ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON erp_private.legal_structure_tax_defaults TO erp_api;
CREATE POLICY legal_structure_tax_defaults_read ON erp_private.legal_structure_tax_defaults FOR SELECT TO erp_api USING((erp_private.actor()).staff_id IS NOT NULL);
CREATE TRIGGER no_delete BEFORE DELETE ON erp_private.legal_structure_tax_defaults FOR EACH ROW EXECUTE FUNCTION erp_private.reject_delete();

INSERT INTO erp_private.legal_structure_tax_defaults(structure,subtype,taxpayer_class,profile_entity_type,suggested_obligations,note)
SELECT DISTINCT ON(t.structure,t.subtype) t.structure,t.subtype,d.taxpayer_class,d.profile_entity_type,d.suggested_obligations,d.note
FROM erp_private.legal_structure_types t
JOIN (VALUES
 ('Limited Company','*','Resident company','Company',ARRAY['Company','Instalment tax','VAT','PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Corporation tax return with instalment tax. Confirm VAT against the turnover threshold and keep only the payroll items the company actually runs.'),
 ('Limited Company','Company Limited by Guarantee','Company limited by guarantee','Company',ARRAY['Company','VAT','PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Many are not-for-profit. Tax Lead to confirm whether any exemption applies before treating income as taxable or exempt.'),
 ('Partnership','*','Partnership (firm return; tax falls on the partners)','Partnership',ARRAY['Partnership','VAT','PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'The firm files a return showing each partner''s share. Instalment and advance tax are for the partners; confirm with the Tax Lead.'),
 ('Individual','Sole Proprietor','Individual in business','Individual',ARRAY['Individual','Instalment tax','VAT','PAYE','SHIF','NSSF','NITA','Housing levy'],'Check whether Turnover Tax or Rental Income Tax applies instead; either one replaces ordinary income tax and instalment tax on that income.'),
 ('Individual','Individual Taxpayer','Individual (employment or other income)','Individual',ARRAY['Individual'],'Add Rental Income Tax or other items only after the Tax Lead confirms the income sources.'),
 ('Non-Profit Organisation','*','Non-profit (exemption status to be confirmed)','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Record the exemption position and any tax on unrelated business income in the profile notes. An income-tax obligation cannot be selected for this entity type yet.'),
 ('Non-Profit Organisation','PBO','Public benefit organisation (exemption letter on file)','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Confirm the exemption letter, its date and its conditions before relying on it.'),
 ('Public Entity','*','Public entity (Exchequer or county funded)','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT','Withholding VAT agent'],'Most public bodies are appointed to withhold VAT; confirm the appointment. Income tax treatment follows the establishing instrument.'),
 ('Co-operative Society','*','Co-operative society','Other',ARRAY['VAT','PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Co-operatives follow their own income-tax rules. Tax Lead to confirm before an income-tax obligation is recorded.'),
 ('Co-operative Society','SACCO','SACCO','Other',ARRAY['VAT','PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Deposit-taking SACCOs have additional rules on interest and withholding. Tax Lead to confirm.'),
 ('Other','Trust','Trust','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Confirm whether the trust is taxed on its own income or the trustees account for beneficiaries.'),
 ('Other','Association','Association','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Member subscriptions and trading income are treated differently; Tax Lead to confirm.'),
 ('Other','Chama or Investment Group','Chama or investment group','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Confirm whether the group files as a company, a partnership or an association.'),
 ('Other','Estate','Estate of a deceased person','Other',ARRAY[]::text[],'Returns follow the PIN and the administrator''s instructions. Tax Lead decides what applies.'),
 ('Other','Other registered entity','Other registered entity','Other',ARRAY['PAYE','SHIF','NSSF','NITA','Housing levy','WHT'],'Tax Lead to classify before any income-tax obligation is recorded.')
) AS d(structure,subtype,taxpayer_class,profile_entity_type,suggested_obligations,note) ON d.structure=t.structure AND(d.subtype='*' OR d.subtype=t.subtype)
ORDER BY t.structure,t.subtype,(d.subtype='*')
ON CONFLICT(structure,subtype) DO NOTHING;

INSERT INTO erp_private.release_checks(check_code,title,owner_position) VALUES
 ('LSCHECKLISTS','Legal-structure KYC and Permanent File checklists confirmed by the Compliance Lead','Compliance Lead'),
 ('LSTAXCLASS','Taxpayer classification and suggested obligations per legal structure confirmed by the Tax Lead','Tax Lead')
ON CONFLICT(check_code) DO NOTHING;
