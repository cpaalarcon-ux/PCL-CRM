-- Cover new ledger references used by scoped approvals, retained history and account lookups.
CREATE INDEX asset_rates_contra_idx ON erp_private.asset_class_rates(contra_account);
CREATE INDEX asset_rates_expense_idx ON erp_private.asset_class_rates(expense_account);
CREATE INDEX asset_rates_creator_idx ON erp_private.asset_class_rates(created_by);
CREATE INDEX ledger_charge_project_idx ON erp_private.ledger_asset_charges(project_id);
CREATE INDEX ledger_asset_account_idx ON erp_private.ledger_assets(asset_account);
CREATE INDEX ledger_asset_preparer_idx ON erp_private.ledger_assets(prepared_by);
CREATE INDEX ledger_asset_last_preparer_idx ON erp_private.ledger_assets(last_prepared_by);
CREATE INDEX ledger_asset_reviewer_idx ON erp_private.ledger_assets(reviewed_by);
CREATE INDEX ledger_journal_preparer_idx ON erp_private.ledger_journals(prepared_by);
CREATE INDEX ledger_journal_last_preparer_idx ON erp_private.ledger_journals(last_prepared_by);
CREATE INDEX ledger_journal_reviewer_idx ON erp_private.ledger_journals(reviewed_by);
CREATE INDEX ledger_period_closer_idx ON erp_private.ledger_periods(closed_by);
CREATE INDEX ledger_period_creator_idx ON erp_private.ledger_periods(created_by);
CREATE INDEX ledger_source_project_idx ON erp_private.ledger_sources(project_id);
