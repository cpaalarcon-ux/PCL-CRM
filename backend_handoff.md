# Backend Handoff: Unified ERP Workspace

The published application is a browser-local prototype. The six-tab workspace is an information architecture and workflow preview; it does not authenticate users, call an accounting platform, or enforce record permissions on a server.

## Six workspace modules

| Workspace module | Existing business capability retained | Required authenticated backend capability |
|---|---|---|
| Clients | Client profile, contacts, vault and billing context | Client master API; per-firm and assignment scope filters; object storage access checks |
| Projects & Tasks | Lead-to-engagement, audit, tax and recurring work | Project/task API filtered by current user, staff category, firm and assignment |
| Finance | Invoice register, payment capture, reconciliation and statements | Invoice/payment ledger APIs; posted document source; transaction-safe reconciliation and statement snapshots |
| Time & HR | Timesheets, WIP, attendance, staffing and leave | Time, leave and attendance APIs; approver rules; locked approved entries |
| Communications | Communication Hub, channels, meetings, email workspace and support | Thread/message APIs, mail ingestion, permissions, audit logging and meeting provider integration |
| Settings | Firm profiles, user setup, policy dictionaries and operational settings | Administrator-only configuration APIs; immutable audit trail; secret vault for API credentials |

## Staff category and permission design

Every user has one primary staff category:

1. Engagement Partner
2. Manager
3. Audit Supervisor
4. Audit Assistant
5. Intern

Functional permissions are additive and do not replace staff category:

- Finance
- HR
- System Administration

Every request must apply firm, client and project scope at the backend. Hiding a frontend tab is never an access-control measure.

## Neutral API contract

The following endpoint shapes are proposed, but are not implemented in the browser preview.

```text
GET  /api/clients?firm_id=&assigned_to=
GET  /api/projects?firm_id=&assigned_to=
GET  /api/tasks?project_id=&assigned_to=&status=&due_from=&due_to=
GET  /api/invoices?firm_id=&client_id=&status=
GET  /api/payments?invoice_id=&firm_id=
POST /api/payments/{id}/reconcile
POST /api/statements { client_id, firm_id, start_date, end_date }
GET  /api/me
GET  /api/settings/firms
```

The authenticated identity returned by `/api/me` must include primary staff category, functional permissions, allowed firm IDs, allowed client IDs, and task/project assignment scope.

## Required enforcement

- Client records originate in CRM; other modules reference `client_id`.
- Staff records originate in HR; other modules reference `user_id`.
- An engagement has one immutable handling firm. A firm change requires a new lead and engagement.
- Invoice number is authoritative. Payment/receipt references begin with the invoice number and then the Cash, M-Pesa, Bank Transfer, or Cheque reference.
- QR/reference generation belongs only to formal communications, never to invoices or receivables.
- Approved timesheets are locked; corrections use reversals.
- All deletion is soft-delete plus an audit event.
- Settings are administrator-only on the server, not merely hidden in the browser.
