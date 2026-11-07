-- Slice 23: unpaid (dishonoured) cheques are deducted from money in on the bank reconciliation summary for every client.
-- A cheque the bank returns unpaid is a money-out statement line; mapping it here keeps the deduction visible and auditable.
-- Draft until a Partner approves it, then proposed into every client chart (core account).
INSERT INTO erp_private.account_catalog
 (code,name,account_group,route,category_code,statement,tax_note,evidence,notes,is_legacy,asset_class,catalog_version,status)
VALUES
 ('10065','Dishonoured (unpaid) cheques','Current assets',null,'ASSET','Statement of financial position','Balance sheet','Bank statement showing the returned cheque; customer notification','A customer cheque the bank returned unpaid. Clear it when the customer pays again or the debt is written off',false,null,'COA-2026-11-07-CHEQUES','Draft');
