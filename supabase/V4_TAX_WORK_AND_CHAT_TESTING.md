# KRA tax work and internal discussions — testing release

26 October 2026. Connected staff API: `staff-workspace-v10`. This extends the existing testing ERP; it does not merge production main or change DNS.

## Where to test

- **Clients → Add client / click client name:** select **KRA Tax Compilation and Compliance**, a handling firm, frequency, effective dates, preparer and independent reviewer. Missing legacy client details can still be saved. Engagement activation remains subject to verified KYC and a signed engagement letter.
- **Projects & tasks:** the normal list shows open monthly work projects. **Service schedules** exposes the continuing engagement setup. Click a monthly card to filter its weekly and monthly tasks. The stable engagement retains all accounting, source, invoice and evidence references.
- **Task workspace → Upload CSV / Excel / ZIP:** upload an original, review the selected member/worksheet and header mode, confirm legal client and period, map columns and import. Header `0` means no header. KRA CSV section mapping requires explicit confirmation. The ZIP inventory distinguishes physical source rows from unique documents. PDF evidence stays separate.
- **Purchases & expenditure:** opens a full-screen work area, initially showing unmapped rows. Select rows, check count/KES totals, then map inventory, a detailed expense account or PPE class. Mapping does not approve tax or post a journal.
- **Task → Open task discussion**, **Project discussion**, or **Comms → Internal chat:** internal messages, replies, private document links and linked system activity. Direct messages are private to their pair. Position hierarchy alone does not expose another staff pair's conversation.
- **Projects & tasks → Payment follow-up:** filed tasks leave the active filing queue while unpaid statutory liabilities remain actionable. Closing requires the established evidence and review controls.
- **Projects & tasks → Archived work:** scoped Managers and the Engagement Partner can browse closed period tasks, discussion history, engagement documents and time records. A closed month never disables the master service schedule or removes its data from annual accounting.
- **Settings → Reference documents & change control:** private versioned Word specifications and reference files, download audit history and authenticated approval records. Specifications and client source files must not be committed to the public repository.

## Schedule

All dates use Africa/Nairobi. Weeks retain ISO week-year and week number: 26 October–1 November 2026 is **2026-W44**. No week 54 is generated. A week crossing month-end has non-overlapping coverage segments, with the same ISO label.

| Work | Release | Internal target |
|---|---|---|
| Weekly compilation | Monday 03:00 EAT; first-day/current-segment catch-up on activation | Sunday 23:59 EAT, or month-end segment cutoff |
| Current-month payroll | 22nd at 03:00 EAT | PAYE filing chain by 6th of next month |
| Other selected monthly tasks | 1st of reporting month at 03:00 EAT | 15th of next month, subject to an earlier verified obligation-specific deadline |

Tax Monthly frequency includes weekly compilation. Weekly-only, quarterly, annual and once-off options remain available. Existing historical weekly work retains its identifiers and dates; calendar segmentation changes begin at the deployment cutover. The deployment retired only unused initial historical seed entries, by reversible soft deletion with a recorded system reason. It did not alter old human work or accounting entries.

Completed tasks leave daily lists; the archive worker checks every five minutes. A monthly project cannot archive before its reporting period ends or while any required work, review or payment follow-up is open. A reviewer must record a reason to cancel an applicable period task. Archived records cannot be reopened or overwritten; use a linked correction.

## Security and delivery

The existing renewable login persists until manual sign-out or authorised revocation. Presence does not expire login. Attendance and task time are independent.

Private Supabase Realtime broadcasts carry only a sequence-change signal. Every message, document and history fetch checks the active session and current source scope. A cached realtime subscription cannot fetch confidential content after access is removed. Authenticated refresh recovers missed signals. Sends are idempotent by author/request ID, with immutable originals and monotonic read cursors.

CSV and ZIP source limits: 10 MB compressed, 50 MB expanded, 100 members, three ZIP-container levels, 20,000 records per member. A single commit selects at most 10,000 source rows. Encrypted archives, traversal paths, symlinks and executable/macro members are rejected. Unsupported reference members are listed, not silently imported. Spreadsheet formulas are not executed. Formatting-only cells through XFD are excluded from the business boundary.

## Verification

The release adds database/API integration coverage for period generation, ISO boundaries, repeat generation, independent service configuration, archive permissions, incomplete-period blocking, source identity, duplicate commits, direct-message privacy and access revocation. Existing accounting, permission, procedure and UI tests remain part of the full suite. Desktop/mobile Chromium checks cover client setup, period selection, chatter, source pickers and the full-screen mapping workspace.

The supplied KRA archive was inspected by the implemented reader: nine CSV files and 6,607 physical rows. The supplied payroll workbook's business boundary is 17 columns, rather than XFD. Importing or previewing a source does not establish statutory eligibility or approval.

## Continuing scope tracked by the consolidated specification

The approved Word specification remains the review baseline. This release implements the client tax-service/recurrence/archive and internal-chatter updates, source-format extension and private-reference controls. It retains the existing posted ledger, shared PPE rates, payroll control journal and profit working paper.

A full client employee/payroll master with monthly roll-forward, confirmed official PAYE filing-export contracts, bank statement matching and a complete framework-specific final financial-statement generator require their own implemented acceptance evidence. They are not described as complete by this release. Existing testing-rate warnings and filing/review gates remain in force.
