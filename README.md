> **Current connected testing release:** See [Consolidated testing suite](supabase/CONNECTED_TESTING_SUITE.md) for Draft → Active projects, tax reviews, rates, finance, HR and the acceptance-test steps. Historical descriptions below refer to earlier releases or browser-local previews. Login persists until manual sign-out; activity affects presence only.

# PCL CRM — Client, Service and Engagement Lifecycle Foundation

This build provides a browser-local, editable CRM intake module for a consulting and audit practice. Open `index.html` in a current browser.

## Included

- Mandatory company profile fields for sector and branch reporting
- Multi-firm operating model: a configurable firm directory begins with three placeholders; the handling firm is required on a lead, is immutable after save and a different firm requires a separate lead and engagement
- Primary contact and decision-role fields
- A controlled 23-service master catalogue grouped by service line
- Sector-based service recommendations that use the controlled catalogue
- PIE, Financial Services and Public Sector IEQR quality gate
- Audit sign-off block until the IEQR assignment is complete
- Tax, SASRA, branch-routing and cross-selling workflow task generation
- Conditional tax-compliance work packs for VAT and eTIMS, payroll statutory deductions, WHT, tax credits, income tax, PPE, stock, instalment tax and client reporting
- Tax-credit posting gate requiring iTax verification and reviewer approval
- Position-based hierarchy and permission profiles for Engagement Partner, Manager, Audit Supervisor, Audit Assistant and Intern
- Protected Engagement Fee and EQR sign-off rules, defined without staff names
- Potential duplicate warning based on legal or trading name
- Client notes and engagement-letter reference fields
- A separate Lead-to-Engagement Kanban: New Lead, Scoping & KYC, Proposal Sent, EL Signed, Active Engagement, WIP / Billing and Closed / Archived
- Lead qualification with Cold, Warm and Hot temperature, controlled opportunity owner, score, expected-close date and mandatory next activity / due date for Warm and Hot leads
- Qualified Opportunity conversion at proposal stage, with quotation status and forecast retained through EL acceptance and conversion to an engagement
- Controlled operational routing: legal Firm → Branch / Office → Service Line → Specialist Team / queue, without treating a branch as a legal company code
- Lead gates for scoping data, KYC document references, conflict clearance, Partner approval for Potential PIE / configured fee thresholds, signed EL, KYC verification and ICPAK reference for Statutory Audit
- Automatic Potential PIE flagging for Financial Services and Public Sector leads
- Service-specific activation tasks for Statutory Audit, SME bookkeeping/tax, Legal/LSK and NGO/donor work
- Position-based Independent Engagement Quality Reviewer task generation for Potential PIE statutory audits
- ICPAK-aligned Audit Workspace for activated Statutory Audit engagements: controlled annual audit files; required acceptance, strategy, materiality, risk and fraud planning controls; balanced trial-balance import; audit-area mapping; controlled source-population provenance and control totals; TB / GL reconciliation clearance; provisional-to-final sample gates; detailed testing evidence; exception, adjustment and unadjusted-error disposition; lead schedules / audit programmes; completion and reporting evidence; Partner-only archive gate; permanent-file reference roll-forward; and a governed ICPAK hand-off manifest
- Resource assignments by staff identifier, 40-hour weekly assistant-capacity warning / override control, invoice milestones and WIP setup
- Contract terms for one-off, annual-audit and recurring-retainer work; 60- and 30-day renewal controls; renewal creation starts a separate firm-locked opportunity and EL cycle without overwriting the prior signed EL
- Timesheet and WIP module with effective-dated staff rates, separate engagement-financial baselines, submission / approval / lock workflow, reversals, invoices, profitability and loss-decision prompts
- Tax-project billing queue and authoritative invoice register: recurring schedules raise a billing requirement rather than generate a second invoice number; staff register the approved invoice number against the locked engagement, client and primary contact
- Practice Group shared workspace: one login and a central Projects & Tasks workboard across authorised firms. Engagement ownership remains immutable, and every project, task, time entry, document, communication, invoice and payment visibly retains its Handling Firm.
- Receivables Centre for combined all-firm invoice visibility, Cash / M-Pesa / Bank Transfer / Cheque receipt capture, reference-prefix validation, payment reconciliation, aging, CSV export, immutable firm-statement snapshots and non-legal client relationship summaries. Every payment reference begins with the same invoice number, then its receipt or transaction identifier. eTIMS is not integrated into Receivables Centre.
- Centralized Communication Hub across leads, engagements, primary client contacts and tax invoices; it records Email, phone, meeting, WhatsApp, internal-note and formal-letter activity, vault attachment references, position-routed follow-ups, open/resolved status and branch/service filters. Formal communications inherit their firm from the selected lead or engagement rather than accepting a free-text issuer
- Controlled Communication QR register for letters and other communications. Each QR reference records its linked client, issuing firm, issue date, purpose, approved signatory position or staff identifier and opaque token; no client or communication details are encoded in the QR payload
- Client document vault with controlled categories, immutable-final-report logic, document-access audit records, PBC request and ICPAK export-manifest controls
- Executive dashboard for WIP, approved-time cost, branch revenue, Potential PIE / EQR queue, loss and document-lock controls, with the required alert-queue logic
- Firm-filtered CRM analytics for customer (sector), service-line margin, marketing-source conversion and sales conversion by branch
- HR and staffing module for CPA / ICPAK / CPD records, busy-season leave approval, resource-roster collision checks, sick-leave availability entries and engagement performance reviews
- Attendance module for daily clock-in/out, office, remote and client-site locations, leave synchronisation, lateness, overtime and missed-punch exceptions, client-site verification, burnout alerts and attendance-to-timesheet gap controls
- Help Desk module for client and staff support tickets, category-to-position routing, SLA escalation, engagement and vault links, PBC reminders, ticket updates, attendance-correction tickets and client-visible knowledge-base articles
- Recurring Task Engine V2: Monday-to-Sunday Tax Health Check sprints, Monday overdue escalation to Tax Assistant and Tax Supervisor, monthly PAYE / VAT-TOT / payroll controls, annual income-tax preparation and quarterly eTIMS controls that can mark a client Tax At Risk
- Tax Project Workspace V2: a verified Tax Compliance engagement is the only client-selection route; each VAT, PAYE, WHT or annual income-tax period has its own controlled project, source-batch completeness checks, Tax Manager identity approval, Tax Supervisor review, Tax Manager filing approval, optional client confirmation and Partner escalation, iTax reference and actual filing-date capture, and controlled amendments. Source schedules and working papers are uploaded as `.xlsx` or `.xlsm` workbooks; the importer reads the rows, accepts new rows only, skips duplicates and displays its count. Task evidence is PDF-only. An acknowledgement or receipt PDF is optional and never blocks recording a filing.
- Engagement collaboration controls: public channels, private groups and direct chats; role/position access policy, role auto-subscription, engagement-generated team channels, controlled `#channel-name` cross-posting from internal Communication Hub records, and a production WebSocket / SSE outbox contract
- Email-to-ERP controls: secret-reference-only IMAP / SMTP connection metadata, alias-to-module/position routing, an Email Manager global inbox, client-team reply restrictions, Communication Hub logging and Message-ID / In-Reply-To / References thread preservation
- `database_schema.sql`, a production PostgreSQL schema for firms, firm-user access, clients, contacts, leads, routing rules, opportunities, engagements, immutable engagement contracts, tax projects, invoices, payment reconciliation, centralized communication records, communication QR references, vault-linked attachments, service templates, WIP, audit files, controlled source populations, TB / GL reconciliations, sample registers, exception dispositions, trial-balance mapping, workpapers, closure evidence, alerts, HR, staffing and attendance; it includes immutable firm ownership, engagement-child firm matching, firm row-level access, opportunity / contract chain controls, renewal alerts, immutable-timesheet, locked-document, tax-invoice-link, payment-status, communication-link, communication-QR, attendance, leave-sync, trial-balance-total, sample-finalisation and audit-archive triggers

## Implementation note

The browser prototype stores records only in local storage so the workflow can be reviewed without a backend. Before live use, replace the three placeholder firms with legal entities, apply `database_schema.sql` through controlled database migrations and connect the modules to authenticated server-side APIs, a secured object-storage repository and an alert-delivery service. Generate QR images and portal links server-side from opaque, revocable tokens. Mirror the Communication Hub as an authenticated server-side model with record rules, immutable activity/audit history, vault attachment relationships and a daily follow-up scheduler. Enforce firm access and the immutable lead-to-engagement firm chain alongside KYC, conflict, EL, approval, EQR, fee visibility, tax-project / lead / contact consistency, invoice/communication link consistency, payment reconciliation, approved-timesheet locks, document locks, audit-file status and archive gates, controlled-source provenance, reconciliations, sample finalisation, exception disposition, trial-balance balancing and mapping, permanent-file roll-forward, busy-season leave, attendance location/IP verification and capacity controls in those server-side permissions; browser checks alone are not a compliance control. The required server-side positions are Engagement Partner, Branch Manager, Practice Administration, Account Manager, Tax Manager, Tax Associate, Audit Supervisor, Audit Assistant, Financial Services team and Independent Engagement Quality Reviewer roles.

### Receivables Centre

The ERP uses one authoritative invoice number and must never create a second invoice sequence. Receipts may be Cash, M-Pesa, Bank Transfer or Cheque, but their reference must begin with that invoice number followed by the payment-specific reference. Only the Partner, an authorised Manager or Practice Administration may view or modify receivables. Generated statements are immutable dated snapshots: corrections require a void and a new statement version, and any stored PDF must use the locked Document Vault.

Tax Projects add a stricter tax-specific gate: establish the legal client and KRA PIN through the selected Tax Compliance engagement, then lock the client, firm and tax period after Tax Manager identity approval. The source-batch register is staging data, not a direct posting route; accepted weekly VAT batches and period-specific PAYE, WHT or annual income-tax packs must be complete before technical review. Tax schedules and working papers must be uploaded as `.xlsx` or `.xlsm` workbooks with a header row. The importer reads the first visible worksheet, calculates a row fingerprint from its reference fields or normalised values, accepts new rows only and reports rows read, new items and duplicates skipped. Task evidence must be a PDF document. A filing is completed by recording its iTax reference and actual filing date, not by uploading a document; any acknowledgement or receipt PDF is optional and, when added, must be PDF. A Tax Assistant cannot approve their own work, and corrections create a linked amendment rather than changing the filed project.

### Recurring workers and live channels

Run the production recurring-task worker in `Africa/Nairobi`: generate tasks at 00:01 Monday (and daily for date-based rules), then scan overdue recurring tasks at 00:05 Monday (and daily for date-based deadlines). The PostgreSQL functions `generate_recurring_tax_tasks()` and `flag_overdue_recurring_tasks()` are idempotent and are designed for a queue worker or scheduler such as pg_cron.

The channel API must authenticate and enforce firm access plus active channel membership or an allowed role before serving `GET` / `POST /api/channels/{channelId}/messages`. Consume `channel_event_outbox` after commit through WebSocket or Server-Sent Events; do not expose the browser-local message store in production. Google Meet remains the phase-one provider and its meeting link is never an invoice QR or Communication Hub QR reference.

### Email connection

Run IMAP retrieval in a server worker every two to five minutes (or use IMAP IDLE where supported), with duplicate prevention on the internet `Message-ID`. Route each received email through a configured alias such as `tax@…` to the selected Communication Hub, Help Desk, Tax or Audit queue. Only the Email Manager role may administer the connection, aliases or global inbox. All other roles may only read their routed queue and reply to email linked to their assigned client work. SMTP replies must preserve `In-Reply-To` and `References`; keep credentials only in a managed secret store, never in browser storage or the ERP database.

### My Workspace dashboard

The home dashboard now combines the selected firm view with a personal work area. It contains today's assigned or overdue work, work that is waiting for a client or reviewer, the user's next seven days, an aggregated firm deadline radar, personal pending uploads, quick actions and a recent activity feed. The **View** selector filters all cards to one handling firm or all firms the signed-in user may access. Firm selection is a view preference only: it never changes the immutable firm on a lead, engagement, tax project, invoice or communication.

In the browser preview, the **My Workspace position** selector is a role-preview control. In production, remove that selector for ordinary users and obtain the position from the authenticated session. The API should source the cards from `v_my_workspace_tasks`, `v_workspace_firm_deadline_radar` and `v_workspace_tax_filing_progress`, with PostgreSQL row-level security enforced before any response is returned. The tax-project dashboard bridge carries task and progress summaries only; it never exposes workbook rows, KRA PINs, payment references, evidence files or QR-reference secrets.
### Unified ERP workspace preview

The current published page is a browser-local ERP preview. Its navigation is organised into **Home**, **Clients**, **Projects & Tasks**, **Finance**, **Time & HR**, **Communications**, and **Settings**. Projects & Tasks opens with the shared workboard, and Finance provides a combined invoice register while retaining the issuer firm on every invoice and payment. It is not connected to a live backend.

The staff hierarchy is **Engagement Partner, Manager, Audit Supervisor, Audit Assistant, and Intern**. Finance, HR and System Administration are additional permissions rather than staff categories. The preview may hide modules by category, but all real permissions, firm scope, approvals, audit trails and financial posting must be enforced on a backend. See [backend_handoff.md](backend_handoff.md).

