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
| Session | Any connected screen | Warn at 28 minutes idle; clear the workspace at 30 minutes. Actual user activity keeps the session open. |
| Recurrence | Projects & tasks → New project / Edit project & schedule | Once-off, weekly, monthly, weekly + monthly, weekly + monthly + annually, quarterly or annual. Weekly/Monthly/Annual task filters and Upcoming schedule explain what exists and what will be generated. |
| Handover | Task → Forward / Escalate | Required message, permitted recipient, ownership change, retained history and in-app alert. |
| Working papers | Documents → Review Excel; project → Imported rows & mapping | Original workbook columns, sheet/period selection, duplicate/rejected counts; resale, expenditure and PPE classification; non-eTIMS exception review. |
| Tax cases | Projects & tasks → Open tax periods | VAT, PAYE, company, partnership, individual, TOT, MRI, WHT, CGT, AHL, SHIF, NSSF, NITA and interest-benchmark computations. Preparer saves/submits; another authorised reviewer returns or locks; actual filing date is required, receipt PDF optional. |
| Rates | Settings → Tax & payroll rates | Manager/Partner drafts a dated schedule with legal source; Partner approves. Approved versions are immutable and cannot overlap for the same code. 35 official-source schedules are preloaded as Draft and require Partner validation. Test-only rules are excluded from client calculations. Monthly PAYE and annual income-tax bands are separate configurations. |
| Downloads | Tax case → Download report & working papers; client → Download KYC package | ZIP with PDF and XLSX; KYC also DOCX. Tax drafts are labelled NOT FOR FILING. Reviewed tax exports use locked snapshots and include supporting files within a 20 MB package limit. Downloads are audited. |
| Time and WIP | Time & HR; Finance → Budgets & WIP | Assigned-task time, independent approval, locked entries and reversals. Effective-dated staff rates calculate approved-time cost. Missing rates remain visible rather than being treated as zero cost. |
| Finance | Finance → Invoices / Payments / Statements | Create draft; activated engagement required to post; firm-specific permanent number; Cash, M-Pesa, Bank or Cheque allocations; overpayment blocked; reversal instead of deletion. One client statement spans permitted firms and identifies every issuer. |
| Communications | Comms → Log communication | Client/firm/project/contact, reference, purpose, date, signatory, follow-up and minutes. A pasted Google Meet/Teams/Zoom link can be opened. Generate QR and download SVG for a letter. The QR encodes only the opaque CRM link and requires authorised sign-in; it remains outside invoicing. |
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

Verification includes the Node validation/calculation suite, a DOM navigation/form test, Deno type checking, rollback-only database security/integrity checks and earlier connected HTTP tests using fictional private fixtures. The new registry HTTP extension was interrupted by a workspace proxy error after login/client/project checks and is not marked passed. `tests/suite_http.py` takes a private fixture path; never commit its credentials or generated state. `tests/suite_ui.test.mjs` requires jsdom via `PCL_TEST_MODULES` and can run with `node --test --test-force-exit`.

Supabase's security advisor still reports the existing disabled leaked-password protection warning. Enable and verify [compromised-password checking](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) before production. The six intentional private authentication/control tables remain RLS-enabled without general API policies. Do not replace that boundary with permissive policies.

## Applying tax rules to client working papers

1. Settings → Tax rules: inspect the source, coverage dates and conditions. The Partner approves only applicable verified versions. Rates are not assumed approved because they were researched.
2. Clients → Tax profile: select taxpayer type, residence, regime, obligations and date coverage. A Manager/Partner verifies the evidence.
3. Tax period → Edit computation → Preview calculation: the server selects approved versions and lists blockers. No missing rate silently becomes zero. VAT row review separately selects supply treatment and income-tax classification; imported amounts remain unchanged.
4. Another Supervisor/Manager reviews and locks. Reports retain the applied rules, sources and client-profile snapshot. Updated rates never rewrite locked periods.
5. Settings → Testing & go-live checks: record dated evidence and outstanding issues. The checklist is a readiness record, not a deployment button.

Annual recurring tasks are calendar-year compilation/review/report reminders, not a statutory annual filing calendar. A non-calendar financial year and its legal filing deadline require an explicitly dated task until a fiscal-year recurrence configuration is added. Changing a schedule preserves existing tasks and takes effect for future releases; newly added annual compilation starts at the new effective date.
