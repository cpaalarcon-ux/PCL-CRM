# Full ERP staff acceptance test plan

**Target:** connected staff testing workspace only  
**Use with:** [Consolidated connected testing release](CONNECTED_TESTING_SUITE.md), [Entity/activity and mapping release](ENTITY_ACTIVITY_V3.md), and [Import and ledger release](IMPORT_LEDGER_V12.md)

Use the [PMS v6.0 alignment and additional acceptance gates](PMS_V6_UAT_ALIGNMENT_2026_10_28.md) for the Testing Firm, multi-tenant, subscription and detailed opening-balance status. These additions do not imply that those tests have passed.

## Purpose and scope

Use this plan to test the features that are connected in the staff workspace from client intake through project work, accounting review, billing, HR and communications. It is an acceptance checklist, not evidence that every listed test has passed. Record the actual build, tester, role, result and issue reference for each case.

Open the shared staging workspace at `https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot`. Confirm the visible banner says **STAGING ONLY — DO NOT FILE OR SEND** before entering data. Use the assigned staff login and approved fictional records. Do not use production client records, live filing credentials, or send an actual return, payment or client communication during UAT.

Use these outcomes:

- **Pass:** the observed result matches the expected result and evidence is retained.
- **Fail:** the feature behaves differently from the expected result. Record the exact steps and error.
- **Blocked:** the required test account, setup, evidence or permission is missing. Name the owner and dependency.
- **Not tested:** the assigned tester did not perform the case. Add a reason and owner.

## Role coverage

| Role | Required checks |
| --- | --- |
| Engagement Partner | Approval gates, firm access, rates, project activation, finance authority and independent review boundaries |
| Manager | Client setup, KYC checks, activity and stock setup, schedules, project activation and team controls |
| Supervisor / independent reviewer | Independent review, return/lock, handover, evidence and source revision controls |
| Preparer / Assistant | Assigned work, uploads, calculations, mapping, comments and submission for review |
| Intern | Restricted navigation, assigned-work limits, document access and prohibited approval or client configuration |

Run access cases with separate accounts. A role selector in a preview is not proof of server-enforced access.

## Acceptance test matrix

| ID | Feature and path | Expected result |
| --- | --- | --- |
| U01 | Sign in, refresh, remain idle, then sign out | The assigned user remains signed in under the configured session rules. Manual sign-out revokes the session; an old token cannot reopen protected records. |
| U02 | Test each role and authorised handling firm | Navigation and API responses respect the user’s role and firm scope. A user cannot find or open another team’s private client, project, document or finance record. |
| U03 | Staff & access: create staff, issue setup/reset link, disable a user | The link follows the stated expiry and single-use rules. Reset/disable takes effect, prior sessions are revoked as designed and no credentials are sent automatically. |
| U04 | Leads: create, qualify, record next action, move to proposal and prepare client | Required lead details and follow-up are validated. The client profile carries the selected handling firm and does not activate a project by itself. |
| U05 | Clients: complete identity, KYC/contact, authorised firms and review | Missing data remains visible. Verification requires the authorised reviewer and linked evidence. Client, legal entity, tax profile, industry and KYC values remain separate. Confirm legal entity, supporting source and financial year-end before opening-balance setup. |
| U06 | Clients: set business activity and purchase mapping defaults | Choose from the pre-populated activity list. **Other — specify** requires a description. The suggested industry pack follows the activity, remains confirmable, and evidence and effective dates are retained. |
| U07 | Client setup → project → purchase mapping | Saved activity and dated stock settings are available in later projects and mapping without re-entering client defaults. Multiple activities retain their effective dates; no stock setup is forced on a non-inventory expense. |
| U08 | Client tax profile and service schedule | Taxpayer type, obligations, handler, preparer, independent reviewer and reporting dates persist. Defaults are reused by the project schedule. Missing statutory dates are not guessed. |
| U09 | Client/staff Excel import | Worksheet and columns are mapped; counts reflect populated rows; duplicate records are skipped; incomplete profiles are flagged; existing client/staff values are not silently overwritten. |
| U10 | Create or open project and activate it | A new project, direct task or task generation is blocked until client identity/year-end is complete and an opening TB source is staged, an opening journal is posted, or an authorised reasoned “No opening balances” confirmation is recorded. Existing open master project is reused where required. Activation checks signed engagement, KYC/conflict status and required approvals. |
| U11 | Project periods and recurrence | Test each enabled frequency and a schedule crossing the year-end. Tasks release on their scheduled dates, carry the saved client defaults and do not duplicate on retry. |
| U12 | Pause, resume, end and archive recurring work | Pause stops future releases; resume continues from the next scheduled date; end/cancel stops future work; archival retains completed period history and the next year can start without repeating setup. |
| U13 | Upload evidence, signed letters and task documents | The file is linked to the correct client, firm, project, task and category. Unsupported types/sizes fail clearly; locked records remain protected; version history is visible. |
| U14 | Standard purchases upload | The exact 14-column A–N template is recognised, row 1 is ignored as headings, transactions start on row 2, optional cells may remain blank, and source values remain unchanged. M/N are accepted only as a matched active ERP routing category and TB item account; valid codes preselect an unconfirmed suggestion, while invalid pairs fall back to manual dropdown mapping. Legacy 12-column files remain supported. |
| U15 | Upload validation, totals and volume limits | Worksheet/period, imported/rejected/duplicate counts, two-decimal rounding and net/VAT/gross totals reconcile to the source. The 10,000-row limit is explained without silently dropping transactions. |
| U16 | Credit note with and without original invoice references | Complete credits retain negative amounts and original invoice number/date. An incomplete credit is pending, excluded from final totals and mapping, and becomes importable after the corrected source is re-uploaded. |
| U17 | Import repeat, changed source and row history | Exact repeats are idempotent and counted as duplicates. Changed values against an accepted identity are blocked with a clear reason. Source row, revision, file and reviewer history remain traceable. |
| U18 | Map resale inventory, construction materials, expense and PPE | Each route shows compatible categories/accounts for the selected activity, inventory use and dated method. Construction captures the job/site reference. PPE captures asset/use and first-use status. |
| U19 | Bulk mapping and selection | The selected count and net/VAT/gross are server-confirmed. Mixed classifications are not forced into one account. A stale, expired, altered or locked selection fails atomically and can be retried safely. |
| U20 | Split mixed invoice and undo mapping | Allocation net and VAT conserve the original amounts exactly. Parent source remains a control; allocations do not double count. Undo follows the documented row/user/revision/period restrictions. |
| U21 | Accounting preview, stock control and category request | Preview uses mapped, independently reviewed source rows and displays blockers. Stock controls use dated policy/evidence snapshots. Requests go to an authorised reviewer; they do not activate new accounts automatically. |
| U22 | VAT reporting month and independent tax review | Client VAT month is visible and separate from the invoice date. Mapping does not approve a VAT claim or post a journal. An independent reviewer records the tax decision and evidence. |
| U23 | Sales & VAT reconciliation and bank evidence | Sales/POS/bank source totals and explanations are traceable. Missing statements stay missing, not zero. Deferral and late supplement require independent review; a locked month is not silently rewritten. |
| U24 | Client opening TB and ledger period review | Before any project/task, complete client identity and year-end, then stage the six-column A–F opening TB or record why no balances apply. It appears as a client-level Import Source, not as evidence. After the client-year project is created, import the staged file; verify the routing category and TB item codes, row references, any “Difference in Books” control row, debits/credits and source differences. Import creates a draft journal only. Obtain independent approval before posting; rejected rows remain identifiable and reconciliation clearance is reviewer-attributed. |
| U25 | Tax rates and client rule selection | Draft, review and Partner approval permissions work. Effective dates and sources are visible; approved versions cannot be overwritten or overlap. Testing-only rates are clearly labelled and excluded from live filing outputs. |
| U26 | Supported tax computations and period workflow | Run representative enabled VAT, PAYE, TOT, WHT and income-tax cases. Missing rates or evidence create blockers rather than zero values. Another authorised reviewer returns or locks the case; preparers cannot approve themselves. |
| U27 | Tax exports and KYC package | Downloads contain the expected PDF/XLSX and applicable supporting documents. Drafts are clearly marked **TESTING — NOT FOR FILING**. Export readiness does not claim that a return has been filed with KRA. |
| U28 | Filing procedure and approval evidence | Preparer submission, independent review, client written approval, verified filing reference/date and payment evidence follow the required stages. The ERP records the external filing; it does not send a return or payment. |
| U29 | Billing & WIP: create invoice from an activated engagement | Draft and approval controls use the correct client, project and issuing firm. The authoritative invoice number is unique. Recurring fee schedules use the project service description, saved before-VAT amount, VAT rate, dates and Monthly/Quarterly/Annual frequency. Generating due periods creates reviewable invoice drafts only; retries do not duplicate a schedule period. |
| U30 | Payments, allocations and client statements | Cash, M-Pesa, bank and cheque receipts allocate to the correct invoice. Overpayment is blocked; corrections use reversal. Statements retain issuer firm and immutable dated snapshots. |
| U31 | Timesheets, rates, approval and WIP | Assigned-task time is separate from attendance. Rates are effective-dated; missing rates remain visible. Only approved, locked time feeds WIP and corrections retain reversal history. |
| U32 | Time & HR: attendance, leave and capacity | Clock-in/out, break, leave approval and roster capacity follow the role rules. Attendance does not sign the user out, create billable client time or calculate payroll. |
| U33 | Communications, handover and support | Logs retain author, time, client/project and status. Forward/escalate records recipient and message. Support routing and response deadlines are visible. Logging does not send email or meeting invitations. |
| U34 | Letters and QR | Saved letters retain client/firm scope and produce a printable letter and opaque protected reference. QR access requires authorised staff login; QR is not an electronic signature, invoice QR or external client portal. |
| U35 | Home dashboard, global search and alerts | Assigned work, upcoming deadlines, unread notes and pending uploads link to the right record. Review counts disclose their included queues; reconciliation alert labels match their sources. Search obeys the same role and firm restrictions as direct navigation. |
| U36 | Performance and responsive layout | Record load time, row count, filters, browser/device and viewport. Verify 25-row server pagination, stable page navigation and correct totals with 1,500 tasks; do not mark this passed based on a client-side slice. Test modal scrolling and keyboard/focus behavior at the agreed staff widths. |
| U37 | Recurring engagement fees | In **Billing & WIP → Recurring fees**, set a project, consistent invoice description, fee before VAT, VAT rate, cadence and dates. Confirm due drafts; pause, resume and cancel future drafts. Existing invoices remain unchanged, cancellations require a reason, permissions are enforced, and each due project period produces at most one draft. This is separate from recurring work/task schedules. |

For every **Fail** or **Blocked** result, attach a redacted screenshot or source-row reference and record the actual build. Do not retry a failed import or bulk action until its batch result and row status have been checked.

## Explicitly outside this UAT release

Record these as **Not available / separate build**, not as passing integrations: external client portal and external PBC uploads, live KRA access or filing, eTIMS submission, M-Pesa gateway callbacks, automatic invoice posting, live IMAP/SMTP delivery, OAuth-generated meeting links, full SKU/perpetual cost-of-sales engine, the complete historical audit-file programme, payroll payment processing, GPS/site verification, backup restore certification and a 1,000-user load test. The active screens must not imply that these integrations ran.

## Readiness gates for a high score

### Target 9/10 before wider staff testing

- Every critical flow U01–U35 has a recorded outcome and evidence; no unresolved Critical or High defects remain.
- Client defaults carry from setup to project, recurring tasks and mapping; the activity dropdown and “Other” path work at both setup entry points. Opening TB staging occurs after identity/year-end and before project/task setup; purchase code suggestions require staff confirmation.
- No cross-client or cross-firm access, source-value changes, duplicated totals, skipped records, duplicate tasks or duplicate invoices are found.
- Uploads, mapping, independent tax review, billing, session/security and role restrictions pass with separate accounts.
- All remaining Medium/Low findings have an owner, workaround and target date. U36 has measured results and a supported screen-size review.

### Target 10/10 for a release decision

- All in-scope cases pass in the exact release candidate on supported browsers and screen sizes; no Critical, High or Medium defect remains open.
- Staff sign-off and Partner/Manager approval are recorded, and the exact build, migrations and rollback point are known.
- Backup restoration, security review and agreed peak-load/performance targets are evidenced for the deployment environment.
- Separate integrations or functions listed above are either completed and independently tested or formally excluded from the product claim and rollout scope.

A readiness score is earned from recorded evidence and closed defects. It cannot be guaranteed before staff execute this plan.
