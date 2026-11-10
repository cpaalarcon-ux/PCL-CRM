# Backend Handoff: Unified ERP Workspace

The published application is a browser-local prototype. The six-tab workspace is an information architecture and workflow preview; it does not authenticate users, call an accounting platform, or enforce record permissions on a server.

## Practice Group workspace

The three legal firms operate through one shared ERP login and one central work queue. A user never logs into a separate company to view assigned projects, tasks, shared staff capacity, client contacts, documents or communications.

The selected **Firm view** is a filter over the firms the authenticated user is authorised to access. It does not change ownership. Every engagement has one immutable `handling_firm_id`; its tasks, timesheets, audit files, documents, communications, invoices and payments inherit that same firm. Work for another firm must be opened as a separate engagement.

Finance provides two distinct outputs:

- A **firm statement**, issued by one legal firm and suitable for client delivery.
- A **group relationship summary**, which combines the client's authorised firm activity but displays the issuing firm on every line. It is not a tax invoice or a legal firm statement, and must not be sent as though it were one.

## Six workspace modules

| Workspace module | Existing business capability retained | Required authenticated backend capability |
|---|---|---|
| Clients | Client profile, contacts, vault and billing context | Client master API; per-firm and assignment scope filters; object storage access checks |
| Projects & Tasks | Shared workboard, lead-to-engagement, audit, tax and recurring work | One cross-firm project/task API filtered by current user, assignment and authorised firm set; every returned row includes Handling Firm |
| Finance | Central invoice register, payment capture, reconciliation, firm statements and relationship summaries | Invoice/payment ledger APIs; posted document source; transaction-safe reconciliation; legal firm statements and non-legal group relationship summaries |
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
POST /api/relationship-summaries { client_id, allowed_firm_ids, start_date, end_date }
GET  /api/me
GET  /api/settings/firms
```

The authenticated identity returned by `/api/me` must include primary staff category, functional permissions, allowed firm IDs, allowed client IDs, and task/project assignment scope.

## Required enforcement

- Client records originate in CRM; other modules reference `client_id`.
- Staff records originate in HR; other modules reference `user_id`.
- An engagement has one immutable handling firm. A firm change requires a new lead and engagement.
- The central workboard aggregates authorised projects and tasks. It must label every returned row with the immutable Handling Firm and must not offer a cross-firm ownership edit.
- Invoice number is authoritative. Payment/receipt references begin with the invoice number and then the Cash, M-Pesa, Bank Transfer, or Cheque reference.
- A legal client statement belongs to exactly one issuing firm. A group relationship summary may aggregate balances for the same client but must retain an issuing-firm value for each line and must be labelled as non-legal.
- QR/reference generation belongs only to formal communications, never to invoices or receivables.
- Approved timesheets are locked; corrections use reversals.
- All deletion is soft-delete plus an audit event.
- Settings are administrator-only on the server, not merely hidden in the browser.


## Phased production rollout

See [PRODUCTION_ROLLOUT.md](PRODUCTION_ROLLOUT.md) for the proposed hosting arrangement, first live release, staff login without email delivery, browser-data migration, acceptance gates and remaining module sequence. This is a rollout plan; no production backend or subscription has been created by publishing it.


## Document Vault API and workflow

The vault is client-first. A document must belong to one client and handling firm; an engagement link is optional for permanent/KYC records. Keep one document record and use relationship records for its work context. Preserve the existing KYC check, audit attachment, tax task evidence, tax filing/source batch, and communication attachment relationships. Use engagement_task_document_links for documents attached to general engagement tasks.

### Intake and review

1. Accept inbound files only through an authenticated staff upload, approved client portal link, or configured email/WhatsApp connector.
2. Stream the bytes into private quarantine storage. Validate file size and type, scan for malware, compute SHA-256, and retain the provider message ID or email Message-ID plus registered sender/contact.
3. Create the metadata and relationship records in one transaction. Keep the original received time, file name and source; deduplicate by content hash within the client and linked task.
4. Route the record to a named reviewer. Enforce the migration's review transitions and require a comment on each decision. The uploader cannot approve or finalise their own document.
5. On final approval, lock the version. Corrections create a superseding version; final records are archived rather than hard-deleted. Check retention policy and legal holds before disposal.
6. Serve bytes only through server-authorised, short-lived download URLs. Write access and review events to append-only records.

### Permission rules

The API and database must verify the handling firm and client relationship for every link. Partners and Managers can access documents within their authorised firm. Other staff need an active engagement assignment, an assigned task/role, named reviewer assignment or an unexpired individual access grant. Restricted categories and KYC/engagement-letter records require management-level access or an explicit individual grant. Client portal users see only documents expressly released to their contact; they never inherit staff access to workpapers or internal communications.

### Email and WhatsApp linkage

Store communication records in the Communication Hub and attach inbound files to those records. Match the sender against registered client contacts; unmatched senders go to a restricted classification queue. Preserve provider message identifiers for deduplication and threading. Do not place OAuth tokens, mailbox passwords, WhatsApp tokens or public file URLs in document metadata.

### Release acceptance

Before live use, verify that staff can only open assigned project/task documents; restricted KYC stays limited; task and communication links match the same client and firm; the uploader cannot approve their own file; every review change has a comment; locked files cannot be overwritten or unlocked; malware-pending files cannot be downloaded; portal release is explicit; and backups can restore both metadata and object versions. The browser-local preview is not evidence that these controls are active.
