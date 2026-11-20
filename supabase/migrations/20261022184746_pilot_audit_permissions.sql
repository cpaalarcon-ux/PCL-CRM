-- Permit the private runtime role to call auth.uid()/auth.jwt(), not read auth tables.
GRANT USAGE ON SCHEMA auth TO erp_api;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO erp_api;
CREATE TRIGGER firms_audit AFTER INSERT OR UPDATE ON erp_private.firms FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('firm_id');
CREATE TRIGGER firm_access_audit AFTER INSERT OR UPDATE ON erp_private.staff_firm_access FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('staff_id');
CREATE TRIGGER client_firms_audit AFTER INSERT OR UPDATE ON erp_private.client_firm_links FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('client_id');
CREATE TRIGGER assignments_audit AFTER INSERT OR UPDATE ON erp_private.project_assignments FOR EACH ROW EXECUTE FUNCTION erp_private.log_change('project_id');
