# Client accounting and profit — testing release

Open the connected staff workspace, select **Projects & Tasks**, select a project, then **Client accounting & profit**. The same button is available inside a task's **Project working papers** section. This is the client's accounting ledger; firm billing, payments and WIP remain separate.

## Prepare a client year

A Manager or Engagement Partner first verifies the client's legal entity, evidence and year-end in the client profile, then creates the year. One taxpayer cannot have overlapping working years in different handling engagements. The handling firm stays fixed.

## Test the flow

1. **Import & post:** upload an original XLSX through a project task, select the opening worksheet and header, map account name/debit/credit columns, and import a draft. Legacy codes and original signed amounts remain in the retained source snapshot. There is no guessed account mapping and no automatic suspense balancing. Map each nonzero opening row to the master chart and confirm its source evidence.
2. Map eTIMS purchases as resale, a detailed expenditure account, or PPE using the existing purchases workspace. Obtain independent VAT and income-treatment review. Select the reviewed rows in **Import & post** to prepare a purchase entry. Supported sales use the separate sales preparation button. Bank receipts do not manufacture sales or output VAT. Source rows are claimed once; partial overlaps are blocked. A stale draft must refresh its reviewed sources before submission.
3. Specific non-eTIMS operating/admin/finance expenditure uses the relevant expense category below gross profit. It cannot be routed into stock, PPE, payroll or depreciation through that schedule. VAT recovery is a separate evidence-based decision; non-eTIMS does not mean automatically zero input VAT.
4. **Payroll:** prepare gross employment pay and employer costs, with employee deductions and net wages as liabilities. Payroll settlement/remittances clear liabilities instead of repeating the expense. A balanced payroll journal XLSX may also be imported. This is a control entry, not a payroll tax calculator or a P10 filing.
5. **PPE & shared rates:** create a record from a mapped, reviewed PPE purchase or a supported opening asset. Confirm the correct account, class, first-use date, business use and any opening book/tax values. One dated class-rate version feeds both book depreciation and tax wear-and-tear projections. Only real cost restrictions, use, timing or historical balances create differences. A different Manager/Partner approves the asset snapshot. Prepare one depreciation entry for the chosen dates; overlapping charge windows are blocked. Tax wear and tear is a reconciliation column, not a second accounting expense.
6. **Entry register:** submit a balanced entry with evidence. A different Manager/Partner posts it or returns it with written notes. Neither the original nor last preparer can self-approve. Draft evidence/references and payroll control figures can be corrected before resubmission, with audit history. A posted entry and its source mapping cannot be overwritten. Posted corrections use an evidenced linked reversal followed by a replacement entry; both need review. Draft depreciation reservations cannot be generated again over the same dates.
7. **Trial balance:** choose a report date and click an account for its posted journal lines. **Overview** shows sales less cost of sales as gross profit, followed by operating expenses, gross payroll/employer costs, finance costs and accounting depreciation to calculate profit before tax. Other income is shown below gross profit. The same build applies to sole proprietors, partnerships and limited companies; equity accounts follow the verified entity.

## Access and safeguards

Assigned non-intern project staff can prepare these client working papers. Interns cannot access them. Firm/project row-level access applies to every read and write, including direct API calls. Only Managers/Partners set up years and perform independent final accounting approvals. Only the Partner adds a future shared-rate version; existing versions and approved asset snapshots are immutable. Existing audit EQR controls do not become tax quality-review gates.

## Release boundaries

This is a testing release, not a certified KRA filing export. Only independently posted entries feed the TB/profit report. Opening evidence, stock completeness, all relevant source imports and depreciation coverage must be reviewed before relying on profit. Stock adjustments are supported manual journals referencing the existing independently reviewed stock controls; full perpetual SKU costing is not implemented here. There is no automatic year-end close, next-year roll-forward or annual tax-return adapter in this screen. A readiness warning is retained rather than claiming the year is ready to file.

The shared reference-rate seed covers calendar 2026 common classes from the KRA-published Income Tax Act Second Schedule. That consolidation flags outstanding amendments; confirm the applicable legal position, qualifying use and special relief before filing. Special assets, disposals, incentives and transition cases require supported separate adjustments. The chosen common rate policy does not, by itself, establish compliance with a financial reporting framework. New dated versions retain source, scope and the date checked.

## Validation

- Full existing rule/UI/migration suite plus ledger rules and end-to-end database tests.
- Browser checks cover project navigation, native-dialog replacement, TB drill-down, independent posting, payroll capture, shared-rate visibility and mobile dialog width.
- All seven new tables have forced RLS; no private source workbook, credential or client record is included in this repository.
- Deploy the additive migration before the versioned `staff-workspace-v9` API. The browser moves to v9; v8 remains available for application rollback. No migration drops existing tables or changes old sharing policies.
