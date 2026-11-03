# Purchase review and weekly import controls

Open **Projects & Tasks → Purchase review**, or **Tax projects → Purchases & weekly controls**.

## What this release does

- Retains source column headings, values, worksheet/CSV section, row number and file hash. Source values cannot be edited through the review screen.
- Imports Excel invoice tables, CSV exports and the supplied KRA ZIP structure, including nested `csv.zip` sections B (sales), F and G (purchases). Macros are not executed. A ZIP section is selected and previewed separately.
- Allows staff to confirm and save reusable column mappings. Preview is mandatory. Rows with validation errors can enter an exception queue only, with no posting to a return, trial balance or invoice.
- Counts all nonblank source rows, duplicates, deferred rows outside the selected week, new rows and validation exceptions. No excess rows are silently truncated. Files over 20 MB and worksheets over 25,000 rows are rejected with a message.
- Uses taxpayer identity across handling firms for duplicate control. Supplier identity and invoice line identity are included. Repeated invoices without line IDs are held for review instead of dropping potentially valid lines.
- Provides dependent purchase dropdowns: 1 resale/inventory, 2 expenditure, 3 PPE. The dictionary preserves 65 labels from the supplied IT2C v17.0.10 return. Its 47 Purchase entries are selectable. Payroll and accounting adjustments remain reference entries only.
- Supports split net allocations. Their total must equal the source net amount. PPE requires description, location and first-use date; capital allowance rates are not inferred.
- Keeps VAT review separate from classification. Missing source VAT is not zero. An unverified purchase amount cannot become an input claim automatically. Sales with missing VAT must be corrected at source and re-imported or explicitly excluded for a documented reason.
- Preserves rejected and excluded source rows with review explanations. Invalid identities, dates, references or amounts cannot be overwritten or cleared merely by entering a note. Corrections use a new source export and a reviewed exclusion of the original.
- Records preparation, review, returns, exclusions and prior/new classifications in a local change history. A preparing position cannot approve or exclude its own work. Changed allocations must be saved before independent approval.
- Requires bank-account identity and confirmed statement coverage of the selected week. Supports bank allocations to multiple invoices and partial settlements, with amount caps. Unmatched balances require an explanation and independent review. Bank records never post VAT.
- Compares the optional purchase ledger with eTIMS by supplier, invoice and net amount. Missing invoices or amount differences remain findings. Without a ledger upload, completeness is explicitly unverified.
- Provides a weekly summary and sequential capture/lock controls. Each source must have reviewed data or a Manager/Partner no-activity declaration. Open findings, incomplete mapping, unfinished reviews and missing tax-control reviews block capture. The previous week must be locked before the next week can be changed.
- Requires Manager/Partner review of tax rates, IT2C mapping and withholding-VAT/adjustment controls. Not-applicable decisions require an explanation. Existing Tax Project technical-review and filing transitions check that the VAT weeks are locked.
- Exports a validation CSV and a classified review CSV. Unlocked exports are labelled DRAFT — NOT FOR FILING. These are review exports, not KRA filing files.

## How staff use it

1. Select the identity-verified VAT Tax Project. Client, taxpayer PIN and handling firm are inherited from it.
2. Select the first open week. Choose the source file and worksheet/CSV section.
3. Check the column mapping and preview. Confirm that the file belongs to the displayed client. Correct invalid source data or save it to the exception queue for review.
4. Click a purchase invoice reference. Select route and category, describe the actual item, split allocations if needed, and save.
5. An independent Supervisor, Manager or Partner checks the classification and the separate VAT treatment. Record evidence references and return unsupported items for correction.
6. Review bank matching and, where uploaded, ledger differences. Record no-activity declarations only where supported.
7. Complete the Manager tax-control review, mark the week Captured, then have a Manager/Partner lock it. Work on the next week can then begin.

Earlier uploader versions stored fingerprints and counts only. Those records remain in the legacy register. Re-upload the original files in this workspace to establish reviewable source rows. Subsequent uploads here skip exact repeats. The two registers never post accounting entries.

## Important deployment boundary

The current GitHub Pages application is a **browser-local staff testing preview**. A public code deployment does not create a shared database, secure staff login, server-enforced authorization or immutable evidence storage. Browser data is not shared between computers and can be altered or cleared outside the application. The category/position selector is a preview control, not authentication.

No client exports, taxpayer identifiers, supplier populations or working papers are included in the public repository. Only generic code, category wording and synthetic tests are published.

## Reconciliation with the additional implementation specification

| Requirement | This release | Required for production |
|---|---|---|
| Reusable templates and dry run | Saved source/heading mappings, preview and error CSV; exceptions isolated from posting | Versioned templates, authoritative API validation and database transaction |
| Sequential week lock | Application checks on every review/import transition | `VatWeek.previous_week_id`, authenticated service checks and atomic locks |
| Route/category consistency | Dependent dropdowns and allocation reconciliation | Reviewed B03/PPE feed and account mapping, with posting reconciliation |
| Opening balances/TB difference | No balancing figures or TB postings are created | Opening-balance register, balanced journals, calculated TB difference and evidence-based explanation |
| Payroll employee/employer split | Existing PAYE upload remains separate, not changed here | Dedicated P10 mapping, employee/employer split, payroll reconciliation and reviewed statutory configuration |
| Non-eTIMS expenses | Books differences remain visible, no automatic VAT claim | Separate evidence-backed exception workflow, permitted legal-basis dictionary and bank-charge duplication checks |
| Pre-lock checks | Source coverage, source findings, classifications, reviews and bank/ledger exceptions | Add verified TB, payroll and rate-band control totals once those source schedules exist |
| Download package | Validation and classified-review CSV | Asynchronous PDF/XLSX/ZIP job, authorised private storage, download audit trail |
| Tax-control flags | Manager review with explanation, gate enforced in the preview | Entity/FY-scoped records, authenticated reviewer, no silent override |

Do not describe an explained variance as zero, an uploaded file as portal-verified, a browser lock as a database lock, or a classified purchase as automatically tax-deductible.

VAT review references: KRA [Understanding VAT Input Tax Deduction](https://www.kra.go.ke/helping-tax-payers/faqs/understanding-vat-input-tax-deduction) and [VAT](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax), checked 22 October 2026. Customs/import evidence and other permitted treatments require their own review; absence from a particular export is a finding, not an automatic legal conclusion. Blank buyer PINs on sales require the reviewer to establish whether the sale is a genuine consumer transaction.

## Validation

Run `node --test tests/tax_import.test.cjs tests/tax_review.test.cjs` for amount/date parsing, duplicate isolation, multi-line invoices, routing/splits, missing VAT, bank allocations, variance reporting, capture/lock gates, stale saves and independent review checks. Synthetic test records are used throughout.
