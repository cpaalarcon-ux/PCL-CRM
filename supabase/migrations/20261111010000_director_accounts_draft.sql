-- Director current account and director loan account for limited companies. Added as Draft: a Partner activates them
-- (and chooses their statement line) before any client chart offers them. No rate is stored. Partner answer of 11 Nov 2026 00:48.
INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status,entity_types)
SELECT code,name,account_group,route,category_code,statement,tax_note,evidence,notes,false,null,'COA-2026-11-11-DIRECTORS','Draft',ARRAY['Limited company']
FROM (VALUES
 ('20250','Director current accounts','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Board resolution / director agreement / bank statement','Money a director takes from or pays into the company outside salary and dividends. A debit balance is owed by the director; how it is presented and any tax effect need Partner and Tax Lead confirmation'),
 ('20260','Director loan accounts','Liabilities',null::int,'LIAB','Statement of financial position','Balance sheet','Loan agreement / bank statement','Loans made to the company by a director, and their repayment. Terms and any interest need Partner and Tax Lead confirmation')
) AS v(code,name,account_group,route,category_code,statement,tax_note,evidence,notes)
ON CONFLICT (code) DO NOTHING;
