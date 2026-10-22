# Finance import and client history

Finance > Imported client history accepts Payment and Journal Entry Excel exports in KES. The workbook is parsed in the browser. No workbook, customer name, transaction or receipt is included in the public repository.

Imports use a separate, browser-local history register (`pcl-finance-import-history-v1`). The existing receivables, invoice payment records, WIP and statements are unchanged. This is not a shared database or authenticated finance backend.

## Import rules

- Preserve original references, dates, signed amounts, source statuses and source file/sheet/row. Use integer cents, retaining negative and zero amounts.
- Match a unique existing client ID using its legal, trading or previous name. Normalize only case and whitespace. Ambiguous or unmatched names remain unlinked and red. Never create clients implicitly.
- Require KES as the declared import currency. An optional batch firm can be selected. Otherwise leave ownership missing. A client relationship or journal prefix does not establish the owning firm.
- Compare references within the source record type and known firm. If either firm is missing, conservatively treat the same reference as a potential duplicate. Identical source values are skipped. Different values block import for review, never silently overwrite.
- Negative journal amounts suggest a credit or reversal but do not establish the document type. Preserve source Paid/Reconciled separately from local allocation status. A Bank journal does not establish the payment method.
- Review shows nonblank rows read, new records, duplicates, conflicts, invalid rows, source totals and client links. Conflicts and invalid rows block saving. Missing client/firm/allocation details do not prevent saving historical records.
- Commit records and batch history in one storage write, with stale-data checks. Reimports are idempotent.

## Review and navigation

Engagement Partner and Manager preview categories can import, view and review these records. Staff category controls are a UI preview, not secure authorization. Production access must be enforced by the server before shared operation.

Search/filter by client, reference and record type. A linked client opens its existing profile; the profile includes a return button to its imported finance history. Review / link saves an explicit client, firm, payment-method or document-type correction with a reason and before/after history. Amounts and original source names remain unchanged. A selected owning firm is locked against casual reassignment.

No import creates invoices, invoice allocations, statements, journal postings, engagement activation, messages, receipts to send, eTIMS submissions or payments to execute. Additional invoice history, allocation evidence, owning firms and opening balances are needed for a reconciled statement. Missing fields remain red until completed or reconciled through a future supported workflow.

Validation: `node --test tests/finance_import.test.cjs tests/profile_edit.test.cjs` uses synthetic fixtures only. Private input files must stay outside this repository.
