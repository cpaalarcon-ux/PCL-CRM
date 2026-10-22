# PCL ERP staging database foundation

**Current work:** see [Connected staff pilot](STAFF_PILOT.md) for the authenticated workspace and follow-up migrations. The Release 0 description below records the initial restricted foundation.

Release 0 was applied to the dedicated `pcl-erp-staging` Supabase project on 22 October 2026. This is a restricted database foundation, **not a staff-ready or production release**. The existing Cloudflare interface still uses the preview's browser-local data and is not connected to this database.

## Applied migration

`migrations/20261022180244_erp_staging_foundation.sql`

The migration file was created using Supabase CLI 2.121.0 (`supabase migration new erp_staging_foundation`). Its filename was subsequently aligned with the actual remote migration-history version returned after application. Do not apply it again to the same staging project. Do not run the historical root `database_schema.sql` alongside this foundation; it is design/reference material requiring reconciliation.

## What exists

- Sixteen tables in the non-public `erp_private` schema, with enabled and forced row-level security.
- Five position-based categories: Engagement Partner, Manager, Audit Supervisor, Audit Assistant and Intern. Finance, HR, system administration and MLRO are separate capability records, not substitutes for staff categories.
- Twenty-three service codes corresponding to every entry in the supplied master service catalog.
- A shared client master, firm links, staff firm access, draft projects and assigned tasks. A project's client and handling firm cannot be changed; another firm requires a separate engagement.
- Incomplete existing client records are accepted. A generated list identifies missing KRA PIN, primary sector, branch and client category. Contact/KYC completeness and red UI indicators are still to be connected.
- Case-insensitive unique staff identifiers/login IDs, optional authentication linkage and contract end-date constraints. Pending staff cannot become active without an authentication identity. No passwords are stored in these tables.
- Import batch counts, idempotency keys and unique source-row keys. These are database safeguards; Excel parsing, mapping, matching and the import approval screen remain to be implemented against them.
- Document metadata, linked to the correct client, firm, project and task, with distinct immutable evidence identities and version numbers. Permanent-file documents, signed engagement letters, BRS receipts and final reports lock automatically. Locked records cannot be overwritten or deleted; corrections require new versions.
- Hard-delete protection for operational tables and before/after change events for staff, clients, contacts, projects, tasks and documents. This is not yet a complete access/download or permission-change audit system.

No real firm profiles, staff, clients, projects, documents, passwords, API keys or private uploads were added to the repository or database. Apart from the position/service dictionaries, the business tables are empty.

## Access is deliberately closed

`anon`, `authenticated` and `service_role` have no schema, table, sequence or function access to `erp_private`. There are no browser-access policies or exposed endpoints. Privileged database administrators can still administer the database; this does not provide tamper-proof storage against database administrators.

The Supabase security advisor reported sixteen informational **RLS Enabled No Policy** findings, one per table, and no warning/error findings at verification. This is expected for the current denied-access foundation. Do not resolve these notices by adding `USING (true)` policies or broad grants. Implement and test identity, scope and permissions before opening any access. See [Supabase's advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Project activation is intentionally blocked until KYC, verified engagement letters and authenticated approval services exist. The guard must later be replaced through a reviewed migration with the actual transactional activation checks. It must not be bypassed by directly setting a status from the browser.

No storage bucket or upload/download endpoint exists yet. Metadata locks do not lock a storage object on their own. The private Storage bucket, storage RLS, upload validation, object version rules, short-lived downloads and access logs must be implemented together before accepting files.

## Validation performed

`tests/foundation_rollback.sql` was executed successfully against staging as the migration administrator. It creates fictional records inside one transaction and rolls them all back. It checks:

- Position/service dictionaries, RLS settings, revoked privileges and actual denied reads under the anonymous and authenticated database roles.
- Unique login IDs and client PINs, inactive login setup, required intern end dates, incomplete-client markers and optional SME audits.
- Fixed engagement firm, valid staff firm/project assignment, task membership and recurring-task deduplication.
- Automatic BRS metadata locks, blocked overwrites/deletes, retained versions and rejected cross-project document links.
- Import count consistency, duplicate source-row keys and client/staff dataset alignment.
- Recorded before/after changes and blocked audit-event edits.

A separate post-test query confirmed 16/16 tables have enabled and forced RLS, 5 staff categories and 23 services. Firms, staff, clients, projects, tasks, documents, import batches and audit events contained zero rows after rollback; Storage contained zero buckets. Sequence values can advance during rollback-only tests; gaps are normal.

These checks do **not** establish staff-category authorization, frontend login, role revocation, private file access, load capacity, backups, tax calculations or a complete onboarding workflow. They cover only this foundation.

## Next release: authenticated staff pilot

1. Implement staff-ID login through a server-side authentication boundary; do not expose an unrestricted directory or allow a browser role selector to set permissions. Honor the no-email requirement with copyable, expiring, single-use setup/reset links, hashed token storage, first-use password setup and immediate session revocation on disable/reset. Store privileged credentials only in server secrets.
2. Add audited server-side permissions and database policies for staff category, firm scope, project membership and active employment. Managers/Partners can import and edit staff/client details, but staff administration must not let Managers grant themselves Partner, system-administrator or additional firm privileges. Protect all direct API routes, not just visible navigation.
3. Define and test private document access, client restrictions and Storage lifecycle rules. Include cross-firm, unassigned staff, intern, expired contract and locked-object negative tests. Establish record-retention rules before enabling deletion or external uploads.
4. Connect one complete vertical slice: sign in, show assigned tasks, open the permitted client, upload a permitted document, sign out. Remove browser-local role selection and local-only data as authorities in that authenticated mode.
5. Implement an atomic, authorized Excel-import preview and commit using the existing client/staff parsers. Show new/duplicate/rejected/incomplete row counts. Confirm matching and missing-data markers before importing real records.
6. Run the first 3–5 staff pilot on staging. Promote only after permissions, account recovery, data migration and backup/restore have been exercised. Finance, tax approvals and reports can follow as separately tested releases.

Keep staging and production separate. This branch changes no live frontend files, DNS records, Cloudflare deployment settings or production data.
