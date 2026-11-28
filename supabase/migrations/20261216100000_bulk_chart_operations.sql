-- Bulk client set-up gains two operations: preparing the client chart of accounts for several clients, and approving the waiting charts.
-- Each row still goes through the single-client chart action, so every chart rule is unchanged. The audit tables stay insert-only.
ALTER TABLE erp_private.bulk_setup_runs DROP CONSTRAINT IF EXISTS bulk_setup_runs_operation_check;
ALTER TABLE erp_private.bulk_setup_runs ADD CONSTRAINT bulk_setup_runs_operation_check CHECK(operation IN('ENGAGEMENT','PAYROLL_RETURNS','CHART_PROPOSE','CHART_APPROVE'));
