-- Correction: non-profits and public entities (including government) pay payroll taxes only; income tax is charged on profit.
-- Remove the exempt-body return and give those pairs no income-tax obligation. Co-operatives, trusts, associations and other bodies keep
-- "Other entity income tax" (filing position only; the ERP does not compute it).
ALTER TABLE erp_private.legal_structure_tax_defaults DROP CONSTRAINT legal_structure_tax_defaults_suggested_obligations_check;

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_remove(suggested_obligations,'Exempt body return'),
    note='No income-tax obligation: a non-profit pays payroll taxes, not income tax. If the organisation also runs a business that makes a taxable profit, the Tax Lead decides what applies and records it in the profile notes.'
WHERE structure='Non-Profit Organisation' AND subtype<>'PBO';

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_remove(suggested_obligations,'Exempt body return'),
    note='No income-tax obligation: a non-profit pays payroll taxes, not income tax. Confirm the exemption letter, its date and its conditions on file. If the organisation also runs a business that makes a taxable profit, the Tax Lead decides what applies.'
WHERE structure='Non-Profit Organisation' AND subtype='PBO';

UPDATE erp_private.legal_structure_tax_defaults
SET suggested_obligations=array_remove(array_remove(suggested_obligations,'Exempt body return'),'Other entity income tax'),
    note='No income-tax obligation: government and public bodies pay payroll taxes, not income tax. Most public bodies are appointed to withhold VAT; confirm the appointment.'
WHERE structure='Public Entity';

ALTER TABLE erp_private.legal_structure_tax_defaults ADD CONSTRAINT legal_structure_tax_defaults_suggested_obligations_check
 CHECK(suggested_obligations <@ ARRAY['VAT','PAYE','Company','Partnership','Individual','TOT','MRI','WHT','CGT','Housing levy','SHIF','NSSF','NITA','Fringe benefit','Deemed interest','Withholding VAT agent','Withholding VAT credits received','Withholding income tax credits received','Excise duty','Instalment tax','Advance tax','Other entity income tax']::text[]);
