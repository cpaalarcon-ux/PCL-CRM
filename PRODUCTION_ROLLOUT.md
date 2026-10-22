# PCL ERP: phased production rollout

Status reviewed: 22 October 2026. This is an implementation and release plan, not a statement that a production backend has been deployed.

## Current position

The interface is published at https://pcl.phamalarcon.com/. The current release includes purchase classification and weekly tax review controls. Staff, clients, finance history and tax review records are still stored in browser-local registers. There is no connected shared application database, authenticated staff session or private evidence storage service.

The staff-category selectors demonstrate visibility. They do not establish a user's identity or protect data. The SQL file is a design baseline, not an applied migration history. For example, it defines `opportunities_by_firm_access` and `engagement_contracts_by_firm_access` more than once. It must be reconciled and tested before deployment.

Do not remove the staff-testing notice merely because the interface has a public URL. Remove it only for modules that have passed the production acceptance gates below. Keep unfinished modules disabled in production and available in the separate testing environment.

## Recommended deployment

| Component | Recommended destination | Required work |
|---|---|---|
| Source and release history | Existing GitHub repository | Keep generic code and tests here. Never commit customer exports, credentials, evidence or database backups. |
| Production web interface and login gateway | Cloudflare Pages/Functions, retaining `pcl.phamalarcon.com` | Build a release containing only approved application assets. Implement the authenticated gateway, secure session handling and explicit production configuration. |
| Shared records and identity | Managed Supabase PostgreSQL and Auth | Create separate testing and production projects, implement migrations, identity mapping, RLS and workflow services. |
| Evidence vault | Private object storage in the backend project | Enforce client/project/firm access and version locks, generate short-lived authorised downloads, and back up the file bytes. |
| Test environment | Separate frontend deployment and backend project | Use fictional records. Never let a preview deployment use production credentials or silently fall back to local storage. |

These providers are recommendations. No subscription has been purchased and no account or project is connected by this plan. Hosting ownership, region, billing and access must be established before remote deployment.

GitHub Pages can retain the current demonstration during development. Move the authenticated operational interface to the application host before collecting credentials or live records. GitHub's Pages limits discourage sensitive transactions, including passwords.

The existing subdomain can be retained. After associating it with the new host and checking the deployment, change only its DNS record at the authoritative DNS provider. If Namecheap still hosts DNS, update the `pcl` CNAME there using the exact target returned by Cloudflare. Do not change mail records or invent a target hostname. A Cloudflare Pages subdomain does not require moving the whole domain's nameservers.

## Release sequence

| Release | Scope | Acceptance gate |
|---|---|---|
| 0: production foundation | Tested database migrations, staff identity, role and assignment scopes, private files, audit events, backup/restore and staging | Server tests prove access restrictions and a database-plus-files restore succeeds. |
| 1: limited staff launch | Staff directory, client master, shared assigned tasks, document uploads, personal work queue and basic communication notes | Two different users on separate devices see the same authorised records; inappropriate requests are rejected by the API. Pilot with 3–5 staff and a small authorised client set. |
| 2: controlled tax operations | Persistent source rows, purchase splits, review assignments, duplicate prevention, bank/ledger checks, week locks and filing date | A preparer cannot approve their own work, simultaneous imports cannot duplicate an invoice, locked periods reject API edits, and filing checks run on the server. |
| 3: finance and time | Invoice history and approved invoice creation, Cash/M-Pesa/Bank/Cheque receipts, reconciliation, firm statements, group summaries, approved time and WIP | Imported totals reconcile; no cross-firm payment allocation; approvals and reversals preserve the ledger and historical rates. |
| 4: remaining tax schedules and reports | Opening balances/TB, payroll employee/employer split, supported non-eTIMS expenses, rate-band checks, PDF/XLSX/ZIP export jobs | Source totals reconcile and exceptions are explained and approved; authorised downloads include actual working papers and an access log. |
| 5: extended operations | Full audit workspace, HR/attendance, live collaboration, mail integration, client portal and advanced analytics | Each module passes its own access, workflow, retention and recovery tests before activation. |

This order allows useful work to begin before every enhancement is finished. It does not defer authentication, access checks, private files or recoverable storage. No calendar completion dates are committed until the implementation and hosting setup have been assessed.

## First release work packages

### 1. Database and identity

- Convert the existing SQL baseline into ordered, repeatable migrations. Resolve duplicate definitions and conflicting constraints. Run the complete migration set against an empty test database and an upgrade fixture.
- Link the application's stable staff key to the authentication provider's verified identity. Existing numeric record identifiers must not be replaced by names.
- Preserve the five staff categories: Engagement Partner, Manager, Audit Supervisor, Audit Assistant and Intern. Finance, HR and System Administration remain additional permissions.
- Derive permissions from the signed-in account on every request. Never trust a role selector, `user_id`, firm list or `app.user_id` supplied by a browser request. Establish database identity only inside the trusted request transaction.
- Apply firm, client and task assignment scopes together. Permit authorised shared work across firms while keeping each engagement's Handling Firm immutable.
- Enforce fee-field restrictions in response serializers and exports as well as the UI. Interns receive only assigned-task information.
- Partners and authorised Managers may import and edit staff/client profiles, but a Manager cannot grant themselves Partner, System Administration or additional firm access.

### 2. Login without staff email delivery

- Use the staff Login ID. Build a trusted login gateway that maps that ID to the identity provider; this is additional application work, not a claim that username-only authentication is enabled by default.
- An authorised administrator generates a copyable, single-use account-setup or reset link. Keep the existing 15-minute expiry and require the staff member to set their own password. The ERP does not need to send an email.
- Store only hashed link tokens; show the usable link once. Tokens must not appear in audit logs, analytics or repository files. Reissue invalidates earlier links; reset revokes existing sessions.
- Disable public signup. Rate-limit login/reset attempts, use secure sessions and require appropriate MFA. Contract expiry disables access while retaining historical work.
- Remove preview role switching from the production build. A missing backend must display an unavailable state rather than silently saving real work in local storage.

### 3. Shared records and private files

- Implement the Clients, Staff, Projects, Tasks and Documents APIs and connect those screens to them. Client creation remains in CRM; staff creation remains in HR.
- Use database uniqueness rules and transactional writes for imports, assignments and workflow transitions. Repeat critical validation on the server.
- Store the original uploaded Excel/CSV/PDF privately, with its hash and immutable version metadata. Separate original file bytes from parsed review rows.
- Check access before issuing any download URL. Capture actor, action, record, timestamp and change reason without logging passwords, setup tokens or unnecessary sensitive values.
- Add backend module switches so unimplemented screens cannot be invoked by calling their URLs or APIs directly.

### 4. Migration from the browser preview

- Identify every browser/device holding records. Browser-local data is not already on GitHub or in a central database.
- Export to a restricted migration workspace, take a backup and inventory clients, staff, assignments, invoices, payments, documents and tax batches. Do not upload those exports to the public repository.
- Preview imports, retain source IDs in a migration map, detect duplicates and reconcile record counts and finance balances before approval.
- Import incomplete historical clients with explicit missing-data markers. Do not invent PINs or documents, mark KYC complete, or activate new engagements without the required checks.
- Preserve authoritative invoice numbers and firm ownership. Historical balances must be reviewed before finance is enabled for operational use.
- Earlier tax batches contain counts/fingerprints rather than complete source rows. Recover the original files and establish the new row register; do not manufacture missing rows from counts.
- Browser-position approvals are not proof of authenticated review. Carry them as legacy history and obtain named-user review for any live approval that depends on them.
- Freeze the preview for the approved cutover window, migrate the final changes and reconcile again. Avoid parallel writes to local and central registers after cutover.

### 5. Acceptance and recovery

- Test anonymous access, expired sessions, a user's other-client identifiers, unauthorised firms, staff fee access, self-approval, contract expiry, duplicate uploads and locked-week edits through direct API calls.
- Verify imports and edits from two separate staff sessions, including stale updates and simultaneous imports.
- Test private file access, expired download URLs, restricted folders and correction/version rules.
- Back up the database and object-storage files separately. Supabase database backups contain storage metadata, not the stored file objects. Perform a complete restore exercise before live use.
- Assign an operational owner for failed jobs, backups, access changes and support. Establish the acceptable recovery point and recovery time before launch.
- Keep the current accounting/filing process authoritative until its replacement module is accepted. A live task tracker does not make an unfinished tax return or finance ledger authoritative.

## Continuing improvements without interrupting live work

Each change should follow: development branch, automated tests, staging deployment, Manager acceptance, tagged production release and post-deployment smoke check. Use compatible database migrations and enable new modules only after their services are ready. Retain a prior application release for rollback; do not roll a live database backwards in a way that discards newly entered records.

Existing tests: `node --test tests/profile_edit.test.cjs tests/finance_import.test.cjs tests/tax_import.test.cjs tests/tax_review.test.cjs`. Their current browser/core coverage is useful but does not substitute for authentication, database, file-access and cross-device integration tests.

## Next external setup

1. Establish firm-owned Cloudflare and Supabase accounts, or identify an existing approved host providing equivalent capabilities.
2. Confirm project owners, hosting region and recurring budget. Approve any paid plan in the provider's billing screen; do not send payment details or secrets in chat.
3. Provide deployment access through the provider's supported authorisation mechanism. Keep privileged keys in the deployment secret store, never in public JavaScript.
4. Implement and test Release 0 and Release 1 before switching `pcl.phamalarcon.com` to the operational build.

Publication permission for the GitHub repository does not itself create cloud accounts, configure a backend, approve subscriptions or migrate client data.

## Provider references

Verified on 22 October 2026:

- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
