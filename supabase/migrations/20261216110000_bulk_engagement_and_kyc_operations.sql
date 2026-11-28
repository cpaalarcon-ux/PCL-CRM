-- Bulk set-up gains four operations. Only the audit table's operation check is widened; no rights, routes or single-client rules change.
ALTER TABLE erp_private.bulk_setup_runs DROP CONSTRAINT IF EXISTS bulk_setup_runs_operation_check;
ALTER TABLE erp_private.bulk_setup_runs ADD CONSTRAINT bulk_setup_runs_operation_check CHECK(operation IN('ENGAGEMENT','PAYROLL_RETURNS','CHART_PROPOSE','CHART_APPROVE','ENGAGEMENT_ACTIVATE','KYC_VERIFY','SECTIONS_SEND','ENGAGEMENT_TEAM'));
