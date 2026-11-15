-- Build 2812: four more client-type templates, so every legal structure the firm uses has a client file that asks for the right things.
-- As before, a client type decides only the KYC facts, evidence and people the file asks for. It never selects a service.
--  * Public entity -> Public sector / statutory body (the subtype must be chosen).
--  * Chama -> Unincorporated association / chama (if its documents show a society, co-operative or company, that legal form's template applies instead).
--  * Estate -> Estate of a deceased person.
--  * Other registered entity -> Custom: legal form, registration authority and evidence, responsible officers; a Partner classifies it if the form cannot be identified.
-- Facts are entered by hand with their supporting document and are verified separately; document reading is a later phase.
ALTER TABLE erp_private.client_type_templates ADD COLUMN requires_subtype boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.client_type_templates ADD COLUMN reclassify_if_formal boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.client_type_templates ADD COLUMN partner_classifies boolean NOT NULL DEFAULT false;
ALTER TABLE erp_private.client_template_fields ADD COLUMN partner_verified boolean NOT NULL DEFAULT false;

INSERT INTO erp_private.client_type_templates(template_code,name,controls,regulatory_overlay,sort_order,requires_subtype,reclassify_if_formal,partner_classifies) VALUES
 ('PUBLIC_SECTOR','Public sector / statutory body','The subtype, the establishing instrument, the mandate, the accounting officer and the authorised signatories',false,60,true,false,false),
 ('ASSOCIATION','Unincorporated association / chama','The constitution, officials, members or signatories and registration status. A group whose documents show it is a registered society, co-operative or company uses that legal form''s template instead',false,70,false,true,false),
 ('ESTATE','Estate of a deceased person','The deceased person, the executor or administrator, and the grant or court documents',false,80,false,false,false),
 ('OTHER_REGISTERED','Other registered entity (custom)','The specific legal form, the registration authority and evidence, and the responsible officers. A Partner classifies the entity if its form cannot be identified',false,90,false,false,true);

INSERT INTO erp_private.client_type_template_map(structure,subtype,template_code) VALUES
 ('Public Entity','*','PUBLIC_SECTOR'),
 ('Other','Chama or Investment Group','ASSOCIATION'),
 ('Other','Estate','ESTATE'),
 ('Other','Other registered entity','OTHER_REGISTERED');

INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order)
SELECT t.template_code,f.field_key,f.requirement,f.ord FROM erp_private.client_type_templates t CROSS JOIN (VALUES
 ('company_name','Required',10),('kra_pin','Required',20),('registered_address','Required',60),('contact_person','Required',70),
 ('contact_phone','Required',80),('contact_email','Required',90),('year_end','Required',100)) f(field_key,requirement,ord)
WHERE t.template_code IN('PUBLIC_SECTOR','ASSOCIATION','ESTATE','OTHER_REGISTERED');
INSERT INTO erp_private.client_template_fields(template_code,field_key,requirement,sort_order,partner_verified) VALUES
 ('PUBLIC_SECTOR','establishing_instrument','Required',30,false),('PUBLIC_SECTOR','mandate','Required',35,false),('PUBLIC_SECTOR','accounting_officer','Required',40,false),
 ('PUBLIC_SECTOR','authorised_signatories','Required',45,false),('PUBLIC_SECTOR','registration_number','If applicable',50,false),
 ('ASSOCIATION','registration_status','Required',30,false),('ASSOCIATION','officials','Required',35,false),('ASSOCIATION','authorised_signatories','Required',40,false),('ASSOCIATION','registration_number','If applicable',45,false),
 ('ESTATE','deceased_name','Required',30,false),('ESTATE','deceased_id','Required',32,false),('ESTATE','date_of_death','Required',34,false),('ESTATE','executor_name','Required',36,false),('ESTATE','grant_details','Required',38,false),
 ('OTHER_REGISTERED','specific_legal_form','Required',30,true),('OTHER_REGISTERED','registration_authority','Required',32,false),('OTHER_REGISTERED','registration_number','Required',34,false),
 ('OTHER_REGISTERED','incorporation_date','If applicable',36,false),('OTHER_REGISTERED','authority_basis','Required',40,false),('OTHER_REGISTERED','responsible_officers','Required',45,false);

-- Evidence the file asks for. A chama may be unregistered, so a registration certificate is asked for only if it has one; the officers of an
-- other registered entity are required because the file must name who is responsible.
UPDATE erp_private.legal_structure_requirements SET requirement='If applicable',note='Only if the group is registered. If it shows a registered society, co-operative or company, change the legal structure to that form'
 WHERE structure='Other' AND subtype='Chama or Investment Group' AND rule_code='REGISTRATION_IDENTITY';
UPDATE erp_private.legal_structure_requirements SET requirement='Required',note='Officers responsible for the entity, with IDs'
 WHERE structure='Other' AND subtype='Other registered entity' AND rule_code='OFFICE_BEARERS';
UPDATE erp_private.legal_structure_requirements SET note='Whatever shows the specific legal form and who registered it'
 WHERE structure='Other' AND subtype='Other registered entity' AND rule_code='REGISTRATION_IDENTITY';
UPDATE erp_private.legal_structure_requirements SET note='Grant of probate, letters of administration or court order'
 WHERE structure='Other' AND subtype='Estate' AND rule_code='PROBATE_LETTERS';
