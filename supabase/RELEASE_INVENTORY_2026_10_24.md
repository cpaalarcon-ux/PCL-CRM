# ERP release inventory — 24 October 2026

Use the [connected staff testing workspace](https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot). The repository's historical root-page modules remain published workflow previews; browser-local preview records are not shared database records. This inventory reconciles the requested modules with the connected release. It is not production sign-off.

**Connected** means an authenticated UI and backend exist for staff acceptance testing. **Partial** means only the listed subset is connected. **Pending** means it must not be represented as a working integration. Real business data and production access require the release checklist below.

| Earlier request | Status and place to test | Outstanding work / limitation |
|---|---|---|
| One workspace for three or more firms | Connected: firm selector, shared Clients, Projects, Finance, Comms | Access remains scoped; a project keeps one handling firm. A different firm needs a different engagement. |
| Firm details and invoice identity | Connected: Partner Settings, legal name/PIN/contact/prefix/payment instructions/VAT registration | Logo upload and fully branded per-firm document templates need a further release. |
| Staff categories | Connected: Engagement Partner, Manager, Supervisor, Assistant, Intern | Dedicated Finance/HR/MLRO role-management UI and granular capability assignment are not complete. |
| Staff roster, contract employees and billing classification | Connected: Staff & access; click staff to edit | Review the actual imported staff list and permissions before invitations. No unseen historical attachment was imported in this release. |
| Login ID / copyable setup and reset | Connected: authorised roster actions; single-use links valid 24 hours | Links are private credentials. No automatic email delivery. |
| Login duration | Connected: remains signed in until manual sign-out; automatic token renewal and browser persistence | Latest user policy supersedes all idle timeouts. Presence and attendance do not end authentication. Account reset/disablement/revocation and contract expiry still apply. |
| Staff/client Excel imports and mapping | Connected: Staff & access / Clients → Import | Nonblank-row counts, duplicate skips, mapping and missing-client-field warnings. Validate real source files and totals during UAT. |
| Edit staff and clients after import | Connected: Partner/Manager, subject to category/scope restrictions | Incomplete existing profiles may be retained; they do not satisfy KYC activation gates. |
| Clients, contacts, sectors and branches | Connected: Clients; dynamic sector list and contact records | Full earlier company-field matrix and multiple requested services per lead still need expansion. |
| Leads / opportunity pipeline | Connected: **Leads**, Partner/Manager, scoped by firm | Intake, contact, initial service, sector, branch, source, Cold/Warm/Hot, stages, notes and follow-up dates. Follow-up is an on-screen warning, not an email. |
| Lead conversion | Connected: Leads → Prepare client | Duplicate check and explicit existing-client link; idempotent conversion retains the handling firm and creates no active job. Proposal stage records an external activity. Automated quotations, pricing thresholds, proposal approval/sending and auto fee/invoice creation are pending. |
| Automatic lead routing / cross-selling | Pending | Branch → sector → team routing, engagement-based lead scoring, bundled fee suggestions and 30-day audit cross-sell tasks still need implementation. Current lead ownership is the creating Partner/Manager. |
| Potential PIE | Connected: lead flag for Financial Services/Public Sector; audit activation/finalization controls | Classification and acceptance still require professional review; sector alone is not a legal PIE determination. |
| KYC, beneficial owners, screening and EDD | Connected: Clients → KYC / contacts | Evidence references, manual screening conclusions, verified KYC and Partner EDD. No live sanctions/PEP lookup. |
| Signed EL and engagement activation | Connected: Projects → Review & activate; checklist and upload shortcut | Save-and-activate is transactional. KYC and verified signed PDF required; no bulk activation or generated claim of ICPAK-compliant wording. |
| SME audit optional | Connected: KYC audit requested/exemption controls | Exemption does not prevent an expressly requested audit. |
| Tax versus audit review | Connected: tax activation has no audit EQR fields; ordinary tax preparer/reviewer controls remain | Audit EQR clearance/sign-off remains restricted. |
| Audit workspace and ICPAK logic | Partial: engagement stages, evidence, EQR and finalization gates | Detailed audit programmes, risk/sampling, trial balance, audit procedures and ICPAK software integration/export package are not connected. |
| Project naming and Supervisor creation | Connected: Projects & tasks | Client/service/year suggestion is editable. Supervisor creation/assignment stays within authorised clients/firms. |
| Recurring tax projects | Connected: Once-off, Weekly, Monthly, Weekly + Monthly, **Weekly + Monthly + Annually**, Quarterly, Annually | One project; scheduled task instances deduplicated. Editing a schedule preserves existing tasks. |
| Weekly/monthly/annual task visibility | Connected: Projects filters and Upcoming schedule | Annual tasks are calendar-year compilation reminders. Client fiscal-year statutory deadline automation needs expansion. |
| Forward / escalate tasks with message | Connected: Task actions, permitted recipients, history, in-app notifications | Email delivery is not configured. |
| Missing-document escalation | Connected: daily/scheduled task controls and manual escalation | Confirm the assigned escalation reviewer and due dates during UAT. |
| Personal dashboard | Connected: contextual next tax deadlines, pending independent reviews, missing document tasks, unread alerts, quick time, seven-day work and scoped global search | All nine executive graphs, lead-source analytics, full firm-health drill-down and configurable KPI routing are not complete. |
| Excel working-paper uploads | Connected: Documents → Review Excel; original workbook sheet/header mapping | Requires a supported worksheet and period. PDF evidence is separate from Excel row data. |
| Purchases / expenditure / PPE | Connected: supplier search, page selection, atomic bulk mapping, balanced mixed-invoice splitting, 273-account catalog and PPE first-use details | Reviewer confirms resale, expense or capital treatment. Catalogue labels are not automatic tax eligibility. |
| Non-eTIMS expenditure | Connected: original-template import and documented exclusion review | Statutory fees and commercial licences must be distinguished. No automatic claim that every licence is excluded. |
| Sales / purchases / bank import controls | Partial: source rows, duplicate controls, period validation, reviewer exceptions | No live eTIMS authenticity/supplier validation. Automated bank matching and fully automated three-file capture clearance remain pending. Bank entries never create another VAT posting. |
| Tax-rate settings | Connected: Settings → Tax & payroll rates | 35 sourced schedules start **Draft**. Partner must verify applicability and approve; no blanket auto-approval. New dated versions, overlap controls and impact review exist. |
| Client-specific tax application | Connected: Clients → Tax profile; verified dated obligations and entity/residence/regime | Working papers require an applicable approved rule and profile. Special regimes and treaties require further implementation/review. |
| Tax calculations | Connected: VAT, PAYE, company/individual/partnership, TOT, MRI, selected WHT, CGT, AHL, NSSF, SHIF, NITA and interest benchmarks | Not all Kenyan taxes or complete statutory return forms. Excise, customs, stamp duty, asset capital-allowance schedules, treaty variants and unsupported periods are not covered. |
| Rate changes and report integrity | Connected: effective dates, immutable approved versions, locked calculation snapshots | Review coverage ending 31 Dec 2026 means review needed; it does not assert the law expires then. Monthly PAYE and annual individual bands are distinct. |
| Tax approval and filing date | Connected: submit → different reviewer returns/locks → actual filing date | Receipt PDF optional. Recording a date does not prove or submit filing to KRA. |
| Tax and KYC downloads | Connected: ZIP of PDF/XLSX; KYC also DOCX; attachments and audit trail | Draft tax exports labelled NOT FOR FILING; package/row limits apply. Not the full historical audit export specification. |
| Expense claims / client disbursements | Pending | Manager/Partner approval, reimbursable expense capture and rebilling are not connected. |
| Timesheets and WIP | Connected: assigned-task time, submission/approval, approved-entry locks, reversals, dated rates/budgets | Remaining agreed fee is not earned accounting WIP; cost-to-fee ratio is not a proof of loss at 70%. Missing rates stay visible. |
| Invoices | Connected: draft, activated-project posting, firm-specific number, print | No eTIMS integration, as requested. No invoice communication QR. Recurring billing, credit notes, advanced aging and automatic disbursement rebilling need follow-up. |
| Payments and statements | Connected: Cash, M-Pesa, Bank, Cheque; allocations and reversals; combined client statement | M-Pesa is manual recording, not gateway reconciliation. Each entry retains firm and invoice reference. Legacy references are recorded, not retrieved from Odoo. |
| Communication Hub | Connected: letters/calls/emails/meetings/visits, client/contact/project, date/purpose/signatory/reference | Logs communications; does not send emails, SMS or WhatsApp. Pre-client correspondence currently stays in lead notes. |
| Communication QR | Connected: dedicated Letters & QR tab; create, save and open printable letter; SVG download; edit retaining reference | Encodes only an opaque CRM URL. Login and record authorisation required. No client/fee/contact data in the code; no public access grant. |
| Virtual meetings | Partial: saved HTTPS Google Meet/Teams/Zoom links | Create the meeting in the provider and paste its link. OAuth creation, embedded Jitsi and self-hosted video remain pending. |
| Channels, live chat and mail sync | Pending | Channel/member hierarchy, WebSocket/SSE, IMAP/SMTP, aliases, reply threading and mass mailing are not connected. |
| Document Vault | Connected: private uploads, role/scoped downloads, access history, automatic locked categories | External single-use PBC portal, full version-replacement UI and retention/disposal workflow need additional work. BRS receipts are locked when uploaded. |
| HR, leave and credentials | Connected: records/CPD, verification, busy-season Partner approval, leave/attendance link, fieldwork roster, feedback | Holiday/entitlement calculations and full induction automation need follow-up. No full payroll payments engine. |
| Attendance | Partial: clock in/out, location, late reason, manager correction, leave exclusion | GPS/client-site proof, IP policy, full overtime/burnout and attendance-gap analytics not complete. |
| Help Desk | Connected: internal tickets, threads, categories including Attendance, priorities/SLA and alerts | External ticket portal, knowledge base, satisfaction surveys and email delivery remain pending. |
| BRS / annual returns / compliance tasks | Partial: service/task/manual evidence support and locked BRS folder | Incorporation-anniversary generation, broader regulatory calendar and automatic exemption workflows need completion. |
| AML monitoring / STR | Pending beyond KYC/EDD | No live payment anomaly engine, restricted MLRO case workflow or goAML export. Communication restrictions and retention must be legally reviewed before implementation. |
| Contract renewal and quarterly client cleanup | Pending | Letter expiry can be recorded; automated renewal work, quarterly duplicate review and richer legal-entity templates need follow-up. |
| External client portal | Pending | Do not give clients staff logins. Separate released-invoice/report views and external upload authorisation required. |
| Security and data integrity | Connected: authenticated backend, RLS, private storage, retained audit history, transactional commands | Firm/project/assignment scope exists; a separate branch-only isolation policy is not fully implemented. Production MFA, compromised-password checking and restore/load drills remain gates. |
| Backups / recovery / training / cutover | Pending operational evidence | Prove recovery, monitoring, capacity, training and import reconciliation before live business use. Earlier preview checkboxes are not operational evidence. |

## Required acceptance test before production

1. Use fictional records and separate Partner, Manager, Supervisor, Assistant and Intern accounts. Test denied access as well as successful operations.
2. Add a lead; test existing-client duplicate prevention and same-firm conversion. Complete KYC and activate a tax project without audit EQR. Separately confirm an audit requiring EQR cannot finalize without clearance.
3. Create a Weekly + Monthly + Annually schedule, preview tasks, rerun generation and verify no duplicates. Forward a task with a message; confirm the recipient sees it.
4. Upload the actual approved-format sample workbook, map rows, repeat the import and reconcile counts; attach PDF evidence separately. Verify the correct client/project/firm before import.
5. Review source-linked Draft tax rules and verify a fictional client tax profile. An authorised Partner approves the applicable rules, not every rule indiscriminately. Preview, independently review, lock and export; verify that future rate edits do not change the locked report.
6. Test time approval, invoice posting, each payment method, reversal and combined statement. Confirm an Assistant/Intern cannot obtain fees through the API.
7. Use Comms → Letters & QR → Create letter & QR. Verify the selected client/firm/contact, purpose, date and signatory on the printable letter; edit it and confirm the reference stays unchanged. Download its SVG QR; scan signed out and under an unauthorised staff account. Only an authorised signed-in account may see the record.
8. Complete **Settings → Testing & go-live checks** with evidence. Production is not approved just because code was published.

## Verification evidence for this change

- Node validation/calculation/import/session/QR tests and the DOM navigation/form regression.
- Deno type check of the deployed backend.
- Five rollback-only database suites, including lead firm/category isolation, tax-versus-audit EQR, combined recurrence/deduplication and immutable tax profiles.
- Connected HTTP scenario **passed** after the temporary workspace network restriction cleared: lead category restrictions, duplicate prevention and idempotent conversion; combined schedule preview; failed-activation rollback and successful verified tax activation without audit EQR; tax-profile permissions and missing-rate submission block; authenticated/unauthorised QR access; draft ZIP report generation. These use fictional fixtures, not real client acceptance. Staff UAT remains required.
- Cloudflare successfully deployed commit `348f3da` and the browser loaded the new release script. Temporary QA accounts were disabled, sessions revoked and fictional client/project/lead records archived after verification. Locked evidence and audit history were retained.
- The existing disabled compromised-password protection warning still needs an environment configuration change before production.

No real tax rule was approved on the Partner's behalf, no client filing/payment was submitted externally, and no historical attachment was assumed to be present.

## Accounting, dashboard and presence additions

- Settings → Chart of accounts: 273 supplied accounts, legacy controls non-postable. Manager/Partner adds draft codes; Partner activates them. These are internal classification codes, not verified official KRA return-field identifiers.
- Project → Imported rows & mapping: supplier/PIN/invoice search, source/mapping filters, checkboxes, selected totals and contextual detailed-account drawer. Inventory method must be configured by a Manager. Exact net and VAT conservation applies to mixed-invoice splits; original raw rows remain as non-posting source controls.
- Project → Sales & VAT reconciliation: weekly month-to-date and monthly reviews. POS is a comparator. Bank reconciliation compares gross receipts to supported sales on a consistent basis. MAX is a review benchmark only and never posts revenue/VAT. Independently locked monthly reconciliation is required for VAT case submission.
- Monday 03:00 Africa/Nairobi: idempotent month-to-date draft sales reviews for active VAT schedules, generated by an hourly scheduler. Existing operational tax tasks remain separate.
- Home: contextual task deadlines, independent tax/sales review queue, missing required uploads, unread alerts and weekly personal time. These are task targets, not a certified statutory calendar. Billing navigation is labelled Billing & WIP.
- Header: clock in/out, explicit break/meeting/resume, Manager/Partner team presence and attendance/time comparison. Presence refreshes every 60 seconds. Away/Offline indicate ERP activity only, never physical absence. Calendar-driven presence, Redis and WebSockets are pending.
- Task timers save Draft timesheets for confirmation; independent approval alone contributes cost to WIP. Missed attendance is estimated from last ERP activity, marked for Manager review and excluded from confirmed office-hour totals until approved. Closing yesterday's attendance cannot stop today's timer.

Accounting previews remain unposted drafts. Full general-ledger journal posting, automated bank matching, official return generation and the pending integrations above require separate tested releases.
