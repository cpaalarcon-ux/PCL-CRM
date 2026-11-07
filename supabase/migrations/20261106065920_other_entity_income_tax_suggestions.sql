-- Income-tax positions for non-profits, co-operatives, public entities, trusts and similar bodies.
-- The client tax profile can now hold "Exempt body return" or "Other entity income tax" (taxpayer type Other). These record the
-- filing position only; the ERP does not compute their income tax. The per-pair suggestions are updated to match.
ALTER TABLE erp_private.legal_structure_tax_defaults DROP CONSTRAINT legal_structure_tax_defaults_suggested_obligations_check;
ALTER TABLE erp_private.legal_structure_tax_defaults ADD CONSTRAINT legal_structure_tax_defaults_suggested_obligations_check
 CHECK(suggested_obligations <@ ARRAY['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest','Withholding VAT agent','Withholding VAT credits received','Withholding income tax credits received','Excise duty','Instalment tax','Advance tax','Exempt body return','Other entity income tax']::text[]);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Exempt body return'),
    note='Exempt body return: the annual return and the exemption position. Record any tax on unrelated business income, or a part-exempt position, in the profile notes. The ERP records this position but does not compute the income tax. Tax Lead to confirm.'
WHERE structure='Non-Profit Organisation' AND subtype<>'PBO' AND NOT 'Exempt body return'=ANY(suggested_obligations);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Exempt body return'),
    note='Confirm the exemption letter, its date and its conditions before relying on it. Exempt body return records the annual return position; tax on unrelated business income goes in the profile notes. The ERP does not compute the income tax.'
WHERE structure='Non-Profit Organisation' AND subtype='PBO' AND NOT 'Exempt body return'=ANY(suggested_obligations);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Other entity income tax'),
    note=CASE WHEN subtype='SACCO' THEN 'Deposit-taking SACCOs have additional rules on interest and withholding. Other entity income tax records the filing position only; the ERP does not compute it. Tax Lead to confirm.'
              ELSE 'Co-operatives follow their own income-tax rules. Other entity income tax records the filing position only; the ERP does not compute it. Tax Lead to confirm.' END
WHERE structure='Co-operative Society' AND NOT 'Other entity income tax'=ANY(suggested_obligations);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Exempt body return'),
    note='Most public bodies are appointed to withhold VAT; confirm the appointment. A ministry, county or public institution usually has no income-tax return: keep Exempt body return only if KRA records the obligation. The ERP does not compute the income tax.'
WHERE structure='Public Entity' AND subtype<>'State Corporation' AND NOT 'Exempt body return'=ANY(suggested_obligations);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Other entity income tax'),
    note='Most public bodies are appointed to withhold VAT; confirm the appointment. Some state corporations are exempt under the Income Tax Act or their establishing law; confirm before treating income as taxable. Other entity income tax records the filing position only; the ERP does not compute it.'
WHERE structure='Public Entity' AND subtype='State Corporation' AND NOT 'Other entity income tax'=ANY(suggested_obligations);

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_append(suggested_obligations,'Other entity income tax'),
    note=CASE subtype
      WHEN 'Trust' THEN 'Confirm whether the trust is taxed on its own income or the trustees account for beneficiaries. Other entity income tax records the filing position only; the ERP does not compute it.'
      WHEN 'Association' THEN 'Member subscriptions and trading income are treated differently; Tax Lead to confirm. Other entity income tax records the filing position only; the ERP does not compute it.'
      WHEN 'Chama or Investment Group' THEN 'Confirm whether the group files as a company, a partnership or an association, and change the taxpayer type if it does. Other entity income tax records the filing position only.'
      ELSE 'Tax Lead to classify before any income-tax obligation is recorded. Other entity income tax records the filing position only; the ERP does not compute it.' END
WHERE structure='Other' AND subtype IN('Trust','Association','Chama or Investment Group','Other registered entity') AND NOT 'Other entity income tax'=ANY(suggested_obligations);
