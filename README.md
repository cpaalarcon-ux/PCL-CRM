# PCL CRM — Client, Service and Engagement Lifecycle Foundation

This build provides a browser-local, editable CRM intake module for a consulting and audit practice. Open `index.html` in a current browser.

## Included

- Mandatory company profile fields for sector and branch reporting
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
- Lead gates for scoping data, KYC document references, conflict clearance, Partner approval for Potential PIE / configured fee thresholds, signed EL, KYC verification and ICPAK reference for Statutory Audit
- Automatic Potential PIE flagging for Financial Services and Public Sector leads
- Service-specific activation tasks for Statutory Audit, SME bookkeeping/tax, Legal/LSK and NGO/donor work
- Position-based Independent Engagement Quality Reviewer task generation for Potential PIE statutory audits
- ICPAK-aligned Audit Workspace for activated Statutory Audit engagements: controlled annual audit files; required acceptance, strategy, materiality, risk and fraud planning controls; balanced trial-balance import; audit-area mapping; controlled source-population provenance and control totals; TB / GL reconciliation clearance; provisional-to-final sample gates; detailed testing evidence; exception, adjustment and unadjusted-error disposition; lead schedules / audit programmes; completion and reporting evidence; Partner-only archive gate; permanent-file reference roll-forward; and a governed ICPAK hand-off manifest
- Resource assignments by staff identifier, 40-hour weekly assistant-capacity warning / override control, invoice milestones and WIP setup
- Timesheet and WIP module with effective-dated staff rates, separate engagement-financial baselines, submission / approval / lock workflow, reversals, invoices, profitability and loss-decision prompts
- Tax-project invoice engine with one-off, monthly, quarterly and annual billing schedules, tax-period descriptions, VAT calculation, due dates, payment references, partial-payment reconciliation and WIP-linked net fees
- Centralized Communication Hub across leads, engagements, primary client contacts, tax invoices and QR events; it records Email, phone, meeting, WhatsApp, internal-note and formal-letter activity, vault attachment references, position-routed follow-ups, open/resolved status and branch/service filters
- Tax invoice QR register linked to the originating lead and the primary client contact, plus logged Email and WhatsApp communication actions in the Hub; the QR contains only an opaque token, never client contact details or tax information
- Client document vault with controlled categories, immutable-final-report logic, document-access audit records, PBC request and ICPAK export-manifest controls
- Executive dashboard for WIP, approved-time cost, branch revenue, Potential PIE / EQR queue, loss and document-lock controls, with the required alert-queue logic
- HR and staffing module for CPA / ICPAK / CPD records, busy-season leave approval, resource-roster collision checks, sick-leave availability entries and engagement performance reviews
- Attendance module for daily clock-in/out, office, remote and client-site locations, leave synchronisation, lateness, overtime and missed-punch exceptions, client-site verification, burnout alerts and attendance-to-timesheet gap controls
- Help Desk module for client and staff support tickets, category-to-position routing, SLA escalation, engagement and vault links, PBC reminders, ticket updates, attendance-correction tickets and client-visible knowledge-base articles
- `database_schema.sql`, a production PostgreSQL schema for clients, contacts, leads, engagements, tax projects, invoices, invoice QR records, payment reconciliation, centralized communication records, vault-linked attachments, service templates, WIP, audit files, controlled source populations, TB / GL reconciliations, sample registers, exception dispositions, trial-balance mapping, workpapers, closure evidence, alerts, HR, staffing and attendance; it includes immutable-timesheet, locked-document, tax-invoice-link, payment-status, communication-link, attendance, leave-sync, trial-balance-total, sample-finalisation and audit-archive triggers

## Implementation note

The browser prototype stores records only in local storage so the workflow can be reviewed without a backend. Before live use, apply `database_schema.sql` through controlled database migrations and connect the modules to authenticated server-side APIs, a secured object-storage repository and an alert-delivery service. Generate QR images and portal links server-side from opaque, revocable tokens. Mirror the Communication Hub as an authenticated server-side model with record rules, immutable activity/audit history, vault attachment relationships and a daily follow-up scheduler. Enforce KYC, conflict, EL, approval, EQR, fee visibility, tax-project / lead / contact consistency, invoice/communication link consistency, payment reconciliation, approved-timesheet locks, document locks, audit-file status and archive gates, controlled-source provenance, reconciliations, sample finalisation, exception disposition, trial-balance balancing and mapping, permanent-file roll-forward, busy-season leave, attendance location/IP verification and capacity controls in those server-side permissions; browser checks alone are not a compliance control. The required server-side positions are Engagement Partner, Branch Manager, Practice Administration, Account Manager, Tax Manager, Tax Associate, Audit Supervisor, Audit Assistant, Financial Services team and Independent Engagement Quality Reviewer roles.
