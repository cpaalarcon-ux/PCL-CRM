# PCL CRM / ERP production-readiness runbook

> **28 October 2026 status:** This document includes the original target architecture and is not evidence that every item is deployed. Use the [dated release inventory](supabase/RELEASE_INVENTORY_2026_10_24.md), [PMS v6.0 alignment and UAT gate](supabase/PMS_V6_UAT_ALIGNMENT_2026_10_28.md), and [staff testing guide](supabase/CONNECTED_TESTING_SUITE.md) for current scope. The root UI is a browser-local preview; shared authenticated testing is at `/staff-pilot`. Apply only the versioned `supabase/migrations` to the staging Supabase database, not the historical `database_schema.sql`. Production cutover, restore/load tests, staff UAT and missing integrations remain outstanding. The ERP is firm-scoped, not a verified multi-tenant subscription product; production and subscription-ready claims are not authorised.


## Scope of this release

This release adds the controls required before real client, staff, audit and tax data is admitted to the ERP:

- soft deletion and immutable change history
- controlled service catalogue IDs
- idempotent Lead-to-Engagement activation records and transactional outbox
- firm and branch row-level access control
- retention, legal-hold, data-subject-request, incident and restore-test records
- restricted client-portal accounts, document release and PBC requests
- a browser-preview Go-live controls tab for archival, invitation and control review

The browser implementation is a workflow preview only. PostgreSQL, authenticated APIs, object storage and a background worker are the production enforcement points.

## Mandatory migration sequence

1. Back up the production database and test the restore in an isolated environment.
2. Apply `database_schema.sql` through the approved migration tool, never from a browser client.
3. Seed `service_catalog` using the approved master-service catalogue, then populate `requested_service_id`, `primary_service_id`, `engagement_services` and `service_templates.service_id` before rejecting legacy text-based service entries.
4. Populate `user_firm_access` and `user_branch_access` for every active staff account. No normal user should receive blanket firm access without an approved reason.
5. Deploy API middleware that starts every transaction with the authenticated context:

```sql
BEGIN;
SET LOCAL app.user_id = :authenticated_user_id;
SET LOCAL app.change_reason = :approved_reason;
SET LOCAL app.correlation_id = :request_correlation_uuid;
SET LOCAL app.ip_address = :client_ip;
SET LOCAL app.user_agent = :client_user_agent;
-- Perform the authorised command.
COMMIT;
```

6. Use an idempotency key for every Lead-to-Engagement activation. The API must insert the activation run, engagement, financial baseline, tasks and outbox events in the same transaction. If any step fails, roll back the full transaction and mark the activation run only through a separately authorised recovery process.
7. Run the UAT and recovery tests below in a sandbox before opening the system to staff or clients.

## Record-retention rule

Archive does not mean erase. `deleted_at` hides a record from normal operational lists while retaining the record, its relationships and its change trail. Use:

- archive for client, contact, lead, task and user records that are no longer operational
- reversal for approved timesheets
- credit note or cancellation controls for invoices
- superseding versions for signed letters and final reports
- a legal hold to prevent disposal while a dispute, inspection or other obligation remains open

Only a completed data-subject request, a retention-policy decision and a legal-hold check may permit deletion, anonymisation or pseudonymisation after the applicable retention period.

## Client portal boundary

Portal accounts are linked to a verified client contact and an explicitly granted client. The portal may show only:

- that client’s released invoices, receipts and payment references
- a client-safe engagement status
- open PBC requests and single-use upload links
- final documents that an authorised user has expressly released

The portal must not expose staff identities, internal notes, workpapers, audit exceptions, WIP, other clients, unapproved reports or object-storage keys. Upload and download links must be server-generated, short-lived and logged.

## UAT release gate

| Test | Expected result |
|---|---|
| Intern access test | Fees, rates, WIP, exports, approvals and report sign-off are denied by API and database policy. |
| PIE gatekeeper test | A Potential PIE engagement cannot reach Partner completion or archive while EQR is outstanding. |
| Cross-branch test | A non-global user cannot read, create or modify another branch’s CRM record through a direct API call. |
| Activation failure test | A deliberately failed task/outbox step creates no partial engagement, invoice schedule or workflow. Repeating the same idempotency key returns the original result. |
| Scheduler test | An overdue task, tax deadline and privacy-incident deadline create one deduplicated alert and delivery record. |
| Portal isolation test | A portal account cannot retrieve any other client’s invoice, status, PBC request or report. |
| Restore test | A backup restores to an isolated environment within the agreed RTO and meets the agreed RPO. |
| Concurrent-use test | The agreed peak-load profile is tested against API latency, database connections, object-storage upload and worker capacity. |

## Backup and incident operations

Define and approve RPO and RTO before go-live. Maintain encrypted backups on separate media/location, versioned object storage for vault data and quarterly evidence-backed restore tests. The incident process must record containment, scope, harm assessment, notices, remediation and closure. The privacy lead must validate current notification obligations and deadlines before every live incident response.

## Historical-data migration

1. Import only active clients, open engagements, current contact details, current-year balances and documents needed for active work.
2. Map and reconcile every imported client, service, firm, branch, engagement and document reference.
3. Retain legacy Excel/WhatsApp/source folders as read-only archived evidence according to the retention policy.
4. Reconcile client count, open-fee total, outstanding invoice total, open task count and document count to signed migration reports.
5. Obtain Engagement Partner and system-owner sign-off before production cutover.
