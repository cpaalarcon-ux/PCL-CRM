# Consolidated connected testing release — 24 October 2026

Testing URL: https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot

This release connects the core staff workflows to the dedicated staging Supabase project. It does not merge the review branch into production. The historical pages at the site root remain browser-local previews; use `/staff-pilot` for shared records. No Odoo installation or eTIMS integration is used.

See the [complete prior-request inventory](RELEASE_INVENTORY_2026_10_24.md) for connected, partial and pending modules.

## Leads

Partner/Manager accounts now have **Leads** next to Home. Capture firm, contact, sector, branch, initial service, source, qualification and follow-up. **Prepare client** links an existing client or creates a CRM profile with the same firm; it does not activate an engagement. Complete the KYC/EL steps below before activation.

## Projects in Draft: how to activate

1. Under **Documents**, upload the client's identity/KYC evidence to **Permanent File**. Upload the signed engagement letter PDF to **Signed Engagement Letters**, selecting the correct project.
2. Under **Clients → KYC / contacts**, complete missing profile details, link the evidence, record screening/conflict review and a future KYC review date. A Partner or Manager verifies the file. Company files require directors, members and beneficial-ownership evidence plus an owner/controller record. High-risk or PEP files additionally require Partner enhanced-review approval.
3. Under **Projects & tasks**, select the project, then **Review & activate**. Use the activation checklist and **Upload signed letter PDF** shortcut, then select **Save and activate**. Tax projects show preparer/manager controls; audit-only EQR controls appear only on audit services. **Save controls only** remains available while evidence is incomplete.
4. The backend checks the gate. The project becomes **Active**, retaining its task IDs, documents and recurring schedule. A new handling firm or client requires another engagement. An active project's service cannot be changed; assigned Supervisors can still edit its name and schedule.

Draft projects continue to support the isolated task/upload testing workflow. Activation does not retrospectively certify KYC or submit anything to a regulator. This release does not bulk-activate existing records.

## One acceptance-test sequence

Use a fictional client and separate preparer/reviewer accounts. Test both an Engagement Partner and an Assistant; use a Supervisor to test scheduling and independent source review.

| Area | Where to test | Expected outcome |
| --- | --- | --- |
| Staff and clients | Staff & access / Clients → Import from Excel | Select worksheet and map columns; count nonblank data rows; skip duplicates; retain missing-client-field warnings; no profile overwrites. Import does not issue login credentials automatically. |
| Credentials | Staff & access → Generate login link / Reset password | Copyable single-use link valid 24 hours. Reset invalidates previous unused links and sessions. No email delivery. |
| Session | Any connected screen | Remain signed in after inactivity and after clock-out. Reload restores the session. Manual sign-out clears credentials and revokes access; password reset and account disabling remain effective. |
| Recurrence | Projects & tasks → New project / Edit project & schedule | Once-off, weekly, monthly, weekly + monthly, weekly + monthly + annually, quarterly or annual. Weekly/Monthly/Annual task filters and Upcoming schedule explain what exists and what will be generated. |
| Handover | Task → Forward / Escalate | Required message, permitted recipient, ownership change, retained history and in-app alert. |
| Working papers | Documents → Review Excel; project → Imported rows & mapping | Original workbook columns, sheet/period selection, duplicate/rejected counts; resale, expenditure and PPE classification; non-eTIMS exception review. |
| Tax cases | Projects & tasks → Open tax periods | VAT, PAYE, company, partnership, individual, TOT, MRI, WHT, CGT, AHL, SHIF, NSSF, NITA and interest-benchmark computations. Preparer saves/submits; another authorised reviewer returns or locks; filing now follows the linked task procedure, with written approval and acknowledgment PDF required. |
| Rates | Settings → Tax & payroll rates | Manager/Partner drafts a dated schedule with legal source; Partner approves. Approved versions are immutable and cannot overlap for the same code. The catalogue contains 35 sourced schedules. User-authorized provisional schedules are marked Approved for testing; formal approval requires Partner legal verification. Test-only rules are excluded from client calculations. Monthly PAYE and annual income-tax bands are separate configurations. |
| Downloads | Tax case → Download report & working papers; client → Download KYC package | ZIP with PDF and XLSX; KYC also DOCX. Tax drafts are labelled NOT FOR FILING. Reviewed tax exports use locked snapshots and include supporting files within a 20 MB package limit. Downloads are audited. |
| Time and WIP | Time & HR; Billing & WIP → Budgets & WIP | Assigned-task time, independent approval, locked entries and reversals. Effective-dated staff rates calculate approved-time cost. Missing rates remain visible rather than being treated as zero cost. |
| Finance | Billing & WIP → Invoices / Payments / Statements | Create draft; activated engagement required to post; firm-specific permanent number; Cash, M-Pesa, Bank or Cheque allocations; overpayment blocked; reversal instead of deletion. One client statement spans permitted firms and identifies every issuer. |
| Letters & QR | Comms → Letters & QR → Create letter & QR | Select client, handling firm, optional project/contact, date, purpose, signatory and letter text. Save letter & generate QR opens the saved reference and printable letter. Print / Save PDF or Download QR (SVG). The code opens the protected record and requires authorised staff sign-in. It is not an electronic signature and remains outside invoicing. The creation button also stays visible on Support. |
| Other communications | Comms → Communications → Log communication | Record calls, emails, meetings, visits, follow-up and minutes. A pasted Google Meet/Teams/Zoom link can be opened. Logging does not send an email or invitation. |
| HR and support | Time & HR; Comms → Support | Attendance, leave with busy-season Partner approval, credential verification, roster capacity checks, feedback, ticket threads and first-response deadlines. |

## Tax controls and limits

VAT uses reviewed source rows; bank records do not create output VAT. Uploads do not prove eTIMS authenticity or supplier VAT status. Reviewers must establish eligibility and the legal basis for non-eTIMS expenditure, including the distinction between statutory fees and commercial licences. Bank reconciliation and rejected-row resolution currently require a documented reviewer conclusion; automated transaction matching and live KRA checks are not implemented.

Submitted/locked/filed tax periods block source-row imports and changes for their project. Independent row review is tied to the source revision. The preparer cannot lock their own case. Reopening a submitted case requires a reviewer return; locked cases cannot be overwritten. The case stores the approved rate and computation snapshot. Filing records a date; it does not send a return to KRA or establish filing proof.

The income-tax and PAYE screens are reviewable computations, not full official KRA return forms or automatic tax advice. Reviewers supply supported deductions, credits, loss relief and the applicable rate schedule. Partnership profit shares total 100%; entity tax is not calculated as corporation tax. PAYE compares per-person computed tax with supplied P10 values. VAT credit carry-forward requires contiguous reviewed periods or a supported opening credit.

## Items still separate from this connected release

- External client portal and single-use external PBC uploads; real-time channels and IMAP/SMTP delivery; OAuth-generated meeting links and self-hosted video.
- Full ICPAK audit-file programmes, sampling, trial balance and detailed audit procedures. The connected release has engagement evidence and EQR completion gates, not the entire historical audit preview.
- M-Pesa gateway callbacks, statutory eTIMS submission, automatic recurring invoice posting, full finance aging and all executive charts. Payments here are recorded and allocated by authorised staff.
- Regulatory calendars and automated BRS/AML monitoring; actual sanctions-list checks, STR/goAML filing, case-specific legal retention decisions.
- Payroll payment processing, holiday/leave-entitlement calendars, GPS/site verification, overtime pay and all attendance analytics. Attendance is not a billable timesheet and does not create client time automatically.
- Full staff-facing capability-management UI, production MFA policy, backup restore drill and a 1,000-user load test.

These remain explicit follow-up items, not hidden or simulated integrations. Email-like actions in Comms record history; notifications stay inside the ERP.

## Deployment and verification

The deployed API is `staff-workspace-v7`, with explicit server-side authentication and database RLS. Its source remains under `functions/staff-workspace-v6/` to preserve the existing relative imports/test paths. Deploy that directory with the **v7** function name. The legacy v6 endpoint does not implement these tax or communication APIs; database activation gates still protect project status. Do not use it as a tax-rule rollback without reviewing database compatibility. Do not point production at this API automatically.

Additional migrations: `20261023214800_lead_archive_retention.sql`, `20261023214203_connected_leads.sql`, `20261023212733_tax_registry_client_profiles.sql` and `20261023212754_combined_frequency_tax_activation.sql`.

Earlier applied migrations: `20261023200819_consolidated_testing_suite.sql` and `20261023202036_suite_activation_followup.sql`, in addition to the foundation/session/workbook migrations.

Verification includes the Node validation/calculation suite, a DOM navigation/form test, Deno type checking, rollback-only database security/integrity checks and earlier connected HTTP tests using fictional private fixtures. The registry/lead HTTP extension subsequently passed after the temporary workspace network restriction cleared; its checks cover scoped lead conversion, recurrence, atomic tax activation, profiles/rates, QR privacy and draft exports. Fictional fixtures were archived and temporary accounts disabled afterwards. `tests/suite_http.py` takes a private fixture path; never commit its credentials or generated state. `tests/suite_ui.test.mjs` requires jsdom via `PCL_TEST_MODULES` and can run with `node --test --test-force-exit`.

Supabase's security advisor still reports the existing disabled leaked-password protection warning. Enable and verify [compromised-password checking](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before production. The six intentional private authentication/control tables remain RLS-enabled without general API policies. Do not replace that boundary with permissive policies.

## Applying tax rules to client working papers

1. Settings → Tax rules: inspect the source, coverage dates and conditions. The Partner approves only applicable verified versions. Rates are not assumed approved because they were researched.
2. Clients → Tax profile: select taxpayer type, residence, regime, obligations and date coverage. A Manager/Partner verifies the evidence.
3. Tax period → Edit computation → Preview calculation: the server selects approved versions and lists blockers. No missing rate silently becomes zero. VAT row review separately selects supply treatment and income-tax classification; imported amounts remain unchanged.
4. Another Supervisor/Manager reviews and locks. Reports retain the applied rules, sources and client-profile snapshot. Updated rates never rewrite locked periods.
5. Settings → Testing & go-live checks: record dated evidence and outstanding issues. The checklist is a readiness record, not a deployment button.

Annual recurring tasks are calendar-year compilation/review/report reminders, not a statutory annual filing calendar. A non-calendar financial year and its legal filing deadline require an explicitly dated task until a fiscal-year recurrence configuration is added. Changing a schedule preserves existing tasks and takes effect for future releases; newly added annual compilation starts at the new effective date.

### Letter workflow verification

The dedicated letter workflow is covered by DOM regression checks: client/firm/project/contact scoping, validation failure and retry with the same request identity, printable preview after the asynchronous workspace refresh, edits retaining the original reference and opaque QR, and no letter controls for Interns. QR unit checks verify the opaque authenticated route and reject insecure production URLs. This frontend update uses the already deployed communication API and requires no schema migration.

## Final-test additions — accounting, dashboard and attendance

1. Open **Settings → Chart of accounts**. Confirm detailed codes, including rent 61000, bank fees 62500, input VAT 10160 and output VAT 21000. Source labels are internal mappings; a reviewer still establishes legal eligibility and the current return version.
2. A Manager configures the client's inventory accounting method from the project accounting screen. Upload the original Excel, review its worksheet/period and import. Repeating the upload skips the same invoice identities and counts new, duplicate and rejected rows separately.
3. Open **Imported rows & mapping**. Search one supplier, select visible rows and map Inventory, Expenditure or PPE. The drawer filters detailed accounts. For mixed invoices use **Split**; allocated net and VAT must exactly equal the original. Confirm that raw source values are unchanged and the original does not count twice.
4. Open **Sales & VAT reconciliation**. Create a weekly month-to-date or full-month review. Use Sales/POS/Bank imports, explain POS applicability/differences and support every bank bridge adjustment with project evidence. The gross comparison never creates an automatic sales entry or VAT claim. Submit with no unresolved controls; another authorised reviewer returns or locks it. A locked monthly review is required for VAT submission.
5. Home shows next contextual tax targets, pending independent reviews, required uploads and unread notes. Try global search using a client/project/task reference. Confirm a staff account cannot discover another team's private records.
6. Log in without clocking in. Wait idle or use the session regression: login stays active. Clock in separately, start an assigned-task timer, take a break and resume. Stop the timer and confirm the **Draft** entry in My Time. Only approved timesheets feed WIP cost.
7. A Manager opens **Team presence** and **Attendance vs time**. ERP activity is approximate; manual meeting status is not a synced calendar event. Missed-punch estimates require explicit Manager correction/approval. Activity and clock-out never sign anyone out.
8. Sign out manually. If attendance is open, choose whether to clock out too. Confirm the signed-out screen cannot reopen a private document using the old token. A browser restart retains a valid login until manual sign-out or account/session revocation.

Migrations added in this release: `20261024122422_purchase_accounting_reconciliation.sql`, `20261024122800_accounting_review_guards.sql`, `20261024131627_actionable_dashboard_alerts.sql`, `20261024133148_attendance_timer_day_guard.sql`. Migration 20261024122800 was applied as the same checked SQL transaction through the staging SQL runner after migration-service request errors, then registered in migration history. Production migrations remain a separate deployment decision.

The 24 October final-test update passed 83 automated Node checks, Deno type checking and rollback-only database checks for session revocation, mapping/source locks, split conservation and attendance/timer boundaries. A connected fictional-account check verified access and token renewal after a day-old activity timestamp, followed by manual logout rejecting both access and refresh. These checks support staging acceptance testing and do not certify production readiness.

## Clickable workspaces and procedural work — 24 October 2026

Click a task title, its row or **Open task workspace**. Click a project name/card to open its tasks. Browser Back, direct task/project links and search results preserve the work context. Record links require staff login and current record access; an unavailable link reveals no hidden record. Main navigation wraps into visible rows rather than hiding Settings behind horizontal scrolling.

Within a task:

1. **Upload purchases Excel / Upload Excel** fixes the client, handling firm, project and task. After saving the private original, the worksheet/section preview opens automatically. Confirm the period and import; duplicate checks, row counts and reviewer controls remain in force.
2. **Open purchases mapping** opens the project's shared imported rows. Select rows, classify them and save. Mapping is a project working paper, not a separate ledger posting for each task.
3. **Add work comment** retains the author/time and message without changing figures or the task stage. **Forward / Escalate** requires a receiving staff member and handover message, retained in task history.
4. Supporting capture tasks have a shorter capture-completion path. Compilation reviews require independent review and Manager closure. Service deliverables add written client acceptance and delivery evidence. Audit engagement quality and report-issuance gates remain separate.

### Statutory tax filing procedure

Generated monthly VAT/PAYE/TOT filing tasks default to **Tax filing**. Other filing work can be configured by a project reviewer. Link the same client/project, tax type and period's computation, choose an independent reviewer, and record the authorised client representative, authority basis, secure delivery method, agreed cutoff and verified statutory deadline. Staff record receipt of the client records; missing records become a query/blocked stage.

**Pending preparer → Pending supervisor review → Awaiting client approval → Ready to file → Filed - pending payment → Closed.**

- Submission contains a preparer note and submits the linked tax computation through its existing source/rate/reconciliation controls. Independent review can return it with a required reason or approve it. A preparer cannot approve their own submission.
- Generate the client approval summary PDF after internal review and send it manually through the agreed secure method. No email, tax return or tax payment is sent by these controls.
- Save the written approval email as PDF or upload a signed PDF, then log its date. Approval must follow review. Late client approval requires a Manager acknowledgment; the ERP does not declare that the firm is exempt from penalties or liability.
- Actual filing remains external in iTax. Recording it requires the client's written approval, a locked acknowledgment PDF, actual filing date and PRN, or a documented nil/no-PRN explanation. An active engagement is required. A generic status update or the older tax filing-date action cannot bypass this gate.
- An independent Manager verifies filing and payment proof before closure. For no payable tax, record the supported nil-liability conclusion. Closure locks the task and evidence. Corrections require separate work; no routine reopen or overwrite is offered.
- **Download status report** produces a PDF/XLSX ZIP with project-period tax statuses, reviewed figures and outstanding tasks. Written approval summaries exclude internal working papers.

Weekly Tax Compilation task release is now Monday **03:00 Africa/Nairobi**. Automatic generation scans enabled schedules on active engagements; Draft projects retain manual generation for isolated testing. Monthly internal release/due targets are unchanged and are not presented as certified statutory deadlines. Existing task identities and periods are retained.

### Automatic attendance

Clock in/out and task timers use server timestamps. Staff choose their location and add a reason when required; no clock time is entered. Break minutes derive from Take break / Resume work, not a keyed amount at clock-out. Current system time is displayed in EAT. An authorised Manager can record a separate reasoned attendance correction; normal staff clock actions cannot supply arbitrary timestamps. Clock-out, breaks and inactivity do not sign staff out.

### Rates enabled for UAT

On explicit user instruction, 34 remaining Draft catalogue schedules were enabled as **Approved for testing**; one catalogue schedule was already formally Approved. Numeric parameters and coverage dates were not changed. Provisional rules are amendable by authorised Managers/Partners and are usable only in the dedicated staging Supabase project. Formally Approved rules retain priority and remain immutable.

Calculations using provisional rules and their exports are marked **TESTING — NOT FOR FILING**. A simulated filing requires an explicit confirmation and fictional test evidence. Provisional enablement does not establish legal accuracy, supplier eligibility, client tax registration or actual filing with KRA. Locked calculation snapshots retain their original values when a provisional schedule is amended later.

### Verification of the procedural release

The release passed 90 Node checks (including DOM interaction checks), Deno type checking and rollback-only database checks for procedural locks and testing-rate permissions. A connected fictional-account test passed independent review, written client approval, simulated filing, independent Manager closure, locked-task immutability, PDF/XLSX report generation and a provisional-rate preview. It also confirmed that caller-supplied clock timestamps and break totals are ignored. No real email, KRA filing or payment occurred. Temporary fictional accounts were disabled, their sessions revoked and the fixture client/project archived; evidence and history were retained.

Applied migrations: `20261024144344_task_procedures_client_approval.sql`, `20261024144958_provisional_testing_tax_rates.sql`, `20261024145528_testing_rate_edit_permissions.sql`, `20261024150802_scoped_procedure_notifications.sql`. The task-notification INSERT permission is scoped to visible task participants.

Browser rendering at responsive widths still requires staff UAT: the local browser binary download failed. DOM navigation/forms and CSS structure were checked; do not describe them as a completed visual browser review. Supabase's existing compromised-password warning and performance-advisor items remain follow-up work before production.
