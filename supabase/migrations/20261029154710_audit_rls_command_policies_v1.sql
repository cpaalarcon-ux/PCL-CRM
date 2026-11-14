-- Separate read and write policies so audit table SELECTs are evaluated once.
DROP POLICY IF EXISTS audit_file_write ON erp_private.audit_files;
CREATE POLICY audit_file_insert ON erp_private.audit_files FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));
CREATE POLICY audit_file_update ON erp_private.audit_files FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.project_allowed(project_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.project_allowed(project_id));

DROP POLICY IF EXISTS audit_account_map_write ON erp_private.audit_account_mappings;
CREATE POLICY audit_account_map_insert ON erp_private.audit_account_mappings FOR INSERT TO erp_api
 WITH CHECK(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_account_map_update ON erp_private.audit_account_mappings FOR UPDATE TO erp_api
 USING(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.firm_allowed(handling_firm_id) AND (erp_private.actor()).category_code<>'INTERN');

DROP POLICY IF EXISTS audit_template_write ON erp_private.audit_templates;
CREATE POLICY audit_template_insert ON erp_private.audit_templates FOR INSERT TO erp_api
 WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id));
CREATE POLICY audit_template_update ON erp_private.audit_templates FOR UPDATE TO erp_api
 USING(erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id))
 WITH CHECK(erp_private.is_leader() AND erp_private.firm_allowed(handling_firm_id));

DROP POLICY IF EXISTS audit_tb_import_write ON erp_private.audit_tb_imports;
CREATE POLICY audit_tb_import_insert ON erp_private.audit_tb_imports FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_tb_import_update ON erp_private.audit_tb_imports FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

DROP POLICY IF EXISTS audit_tb_line_write ON erp_private.audit_tb_lines;
CREATE POLICY audit_tb_line_insert ON erp_private.audit_tb_lines FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_tb_line_update ON erp_private.audit_tb_lines FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

DROP POLICY IF EXISTS audit_workpaper_write ON erp_private.audit_workpapers;
CREATE POLICY audit_workpaper_insert ON erp_private.audit_workpapers FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_workpaper_update ON erp_private.audit_workpapers FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN'
  AND (prepared_by=(erp_private.actor()).staff_id OR erp_private.project_editor()))
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');

DROP POLICY IF EXISTS audit_completion_write ON erp_private.audit_completion_items;
CREATE POLICY audit_completion_insert ON erp_private.audit_completion_items FOR INSERT TO erp_api
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
CREATE POLICY audit_completion_update ON erp_private.audit_completion_items FOR UPDATE TO erp_api
 USING(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN')
 WITH CHECK(erp_private.project_allowed(project_id) AND (erp_private.actor()).category_code<>'INTERN');
