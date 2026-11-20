-- Build 2854: the client set-up grid follows the KRA iTax taxpayer profile.
-- The facts the client-type templates ask for now include the iTax identity and address fields. The single-line "registered address" is replaced by the
-- iTax address parts (street or road, city or town, county, postal code, P.O. Box), so the same address is not asked for twice.
-- Required (blocks set-up until recorded and verified): street or road, city or town, county, postal code, P.O. Box for every client type;
-- business commencement date for every registered type; business registration date (the existing incorporation date) for partnerships too.
-- Everything else on the iTax page is "If applicable": shown on the grid, never blocking.
-- Facts already recorded and verified, including any registered address, stay exactly as they are. A retired row is hidden from the checklist, not deleted.
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order)
SELECT t.template_code,f.field_key,f.requirement,f.ord FROM erp_private.client_type_templates t CROSS JOIN (VALUES
 ('street_road','Required',110),('city_town','Required',120),('county','Required',130),('postal_code','Required',140),('po_box','Required',150),
 ('trading_name','If applicable',160),('nssf_number','If applicable',170),('has_branches','If applicable',180),('legal_rep_declared','If applicable',190),('legal_rep_pin','If applicable',200),
 ('epz_effective_date','If applicable',210),('sez_effective_date','If applicable',220),
 ('lr_number','If applicable',230),('building','If applicable',240),('district','If applicable',250),('locality','If applicable',260),('descriptive_address','If applicable',270),('postal_town','If applicable',280),
 ('telephone','If applicable',290),('mobile_2','If applicable',300),('mobile_3','If applicable',310),('secondary_email','If applicable',320),('website','If applicable',330)
) f(field_key,requirement,ord)
ON CONFLICT (template_code,field_key) DO NOTHING;
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order)
SELECT t.template_code,'commencement_date',CASE WHEN t.template_code='INDIVIDUAL' THEN 'If applicable' ELSE 'Required' END,45 FROM erp_private.client_type_templates t
ON CONFLICT (template_code,field_key) DO NOTHING;
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order) VALUES('PARTNERSHIP','incorporation_date','Required',40)
ON CONFLICT (template_code,field_key) DO NOTHING;
UPDATE erp_private.client_template_fields SET retired=true WHERE field_key='registered_address' AND NOT retired;
