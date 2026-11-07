# PCL ERP phased production rollout

Status reviewed: 3 November 2026 (Africa/Nairobi). This file records staging evidence and gates before production; it does not approve a production release. For the authoritative current snapshot, use [ERP alignment control](supabase/ERP_ALIGNMENT_CONTROL.md) and [Release 0 status](supabase/RELEASE0_STATUS_2026-11-03.md). Older rows below are planning/history when they differ from those records.

## Current observed position

The connected staging workspace is available at `https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot`. The sign-in page renders and Sign in is enabled, but no credentials were used. Supabase project `pcl-erp-staging` is active in `ap-south-1`; `staff-workspace-v12` version **43** is active with a 30-minute session response, and the server-side idle migration is applied. The hosted page still reports build `2026-11-03.2`; branch source is build `2026-11-03.4`.

Staging runtime commits `08e76ef`, `2f7b334`, `2ad6b95` and `a9c50fb` carry the session policy, server guard and v12 tax regression. Run [#44](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41685064617) passed 251 checks and Chromium on `a9c50fb`; documentation/test follow-up `f6f6a82` passed [run #46](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41686880098) with 251 checks and Chromium. Both browser flows use a local server and mocked backend. The hosted page remains build `2026-11-03.2`, so real staff login and role-based API tests have not been recorded. See [ERP alignment control](supabase/ERP_ALIGNMENT_CONTROL.md) and [Release 0 status](supabase/RELEASE0_STATUS_2026-11-03.md) for the canonical state.

Production remains held. The connected Supabase account exposed only the staging project during this status check, so a separate production database, keys, storage and deployment boundary have not been verified. Staging was not confirmed to contain only fictional records; it must be treated as sensitive and protected to production standard until the data inventory and deletion date are recorded.

See the [Release 0 status table](supabase/RELEASE0_STATUS_2026-11-03.md) for evidence against each foundation requirement. Authentication, per-action permissions, private-file access tests, backup/restore and audit coverage are not accepted as complete until their stated evidence is recorded.

## Remaining environment and release decisions

| Component | Observed state | Required before production |
|---|---|---|
| Source and release history | Commits `08e76ef`, `2f7b334`, `2ad6b95` and `a9c50fb` are on `backend/staging-foundation`; run #44 passed on `a9c50fb` with 251 checks and mocked Chromium UAT. | Keep changes on the authorized staging branch and bind source, CI, Pages build, function source and hosted evidence before calling it aligned. |
| Staging interface and backend | v12 v43 and server-side idle migration are active; Pages is still build `2026-11-03.2` while branch source is 03.4. | Deploy the current Pages build; verify hosted sign-in, 30-minute boundary and role-based UI/API denials with fictional accounts. |
| Production interface and backend | No production deployment or separate project was verified in this check. | Establish and independently verify production hosting, project, secrets, storage and access boundaries. Keep production untouched until written Partner approval. |
| Evidence vault | A private `staff-pilot-private` bucket exists. The functions use server-side storage calls. | Test per-client and per-role authorization, downloads and access logging; complete a separate file backup and restore drill. |
| Staging data | Fictional-only status was not established. | Inventory and classify staging records; use fictional copies or document production-standard safeguards and a deletion date. |

GitHub Pages can retain the current demonstration during development. Move the authenticated operational interface to the application host before collecting credentials or live records. GitHub's Pages limits discourage sensitive transactions, including passwords.

The existing subdomain can be retained. After associating it with the new host and checking the deployment, change only its DNS record at the authoritative DNS provider. If Namecheap still hosts DNS, update the `pcl` CNAME there using the exact target returned by Cloudflare. Do not change mail records or invent a target hostname. A Cloudflare Pages subdomain does not require moving the whole domain's nameservers.

## Required release sequence

| Release | Scope | Acceptance gate |
|---|---|---|
| 0: production foundation | Tested database migrations, staff identity, role and assignment scopes, private files, audit events, backup/restore and staging | Server tests prove access restrictions and a database-plus-files restore succeeds. |
| 1: limited staff launch | Staff directory, client master, shared assigned tasks, document uploads, personal work queue and basic communication notes | Two different users on separate devices see the same authorised records; inappropriate requests are rejected by the API. Pilot with 3–5 staff and a small authorised client set. |
| 2: controlled tax operations | Persistent source rows, purchase splits, review assignments, duplicate prevention, bank/ledger checks, week locks and filing date | A preparer cannot approve their own work, simultaneous imports cannot duplicate an invoice, locked periods reject API edits, and filing checks run on the server. |
| 3: finance and time | Invoice history and approved invoice creation, Cash/M-Pesa/Bank/Cheque receipts, reconciliation, firm statements, group summaries, approved time and WIP | Imported totals reconcile; no cross-firm payment allocation; approvals and reversals preserve the ledger and historical rates. |
| 4: remaining tax schedules and reports | Opening balances/TB, payroll employee/employer split, supported non-eTIMS expenses, rate-band checks, PDF/XLSX/ZIP export jobs | Source totals reconcile and exceptions are explained and approved; authorised downloads include actual working papers and an access log. |
| 5: extended operations | Full audit workspace, HR/attendance, live collaboration, mail integration, client portal and advanced analytics | Each module passes its own access, workflow, retention and recovery tests before activation. |

This order allows useful work to begin before every enhancement is finished. It does not defer authentication, access checks, private files or recoverable storage. No calendar completion dates are committed until the implementation and hosting setup have been assessed.

## Release 0 engineering status and remaining work

The original rollout plan below has been reconciled to the connected staging candidate. A connected backend, login flow, server-side area restrictions and a private file bucket exist, but their presence does not satisfy the full Release 0 acceptance gates. See [Release 0 implementation status](supabase/RELEASE0_STATUS_2026-11-03.md) for evidence and pass status.

### 1. Authentication, permissions and audit

- Staff-ID sign-in, session validation/refresh, single-use account setup links and server-side request limits exist in the current function source. The link expiry is 24 hours, not the 15 minutes in this historical plan. The aligned session policy is 30 minutes of inactivity or manual sign-out; test the browser, server and exact idle boundary together on staging.
- MFA is not present in the inspected source. Add and verify MFA for Partner, Manager and administrator roles before accepting Release 0.
- The code enforces staff-area limits, role/scope checks in handlers and default-denies route actions that have no area mapping. The five staff roles are Partner, Manager, Supervisor, Assistant and Intern. It does not yet provide the complete approved per-item permission matrix or live role-based API evidence.
- The private `staff-pilot-private` bucket and server-side file operations exist. Test client, firm and role isolation through the deployed API, and verify that all required accesses and denials are logged.
- An immutable audit-event trigger and selected audit writes exist. Exercise every required event type before describing the audit log as complete.
- Record an independent database-and-files backup/restore drill, set RPO/RTO with the Partner, and prove production and staging credentials, projects and storage are separated.

### 2. Data migration and module controls

- Identify every browser/device holding records. Browser-local data is not already on GitHub or in a central database.
- Export to a restricted migration workspace, take a backup and inventory clients, staff, assignments, invoices, payments, documents and tax batches. Do not upload those exports to the public repository.
- Preview imports, retain source IDs in a migration map, detect duplicates and reconcile record counts and finance balances before approval.
- Import incomplete historical clients with explicit missing-data markers. Do not invent PINs or documents, mark KYC complete, or activate new engagements without the required checks.
- Preserve authoritative invoice numbers and firm ownership. Historical balances must be reviewed before finance is enabled for operational use.
- Earlier tax batches contain counts/fingerprints rather than complete source rows. Recover the original files and establish the new row register; do not manufacture missing rows from counts.
- Browser-position approvals are not proof of authenticated review. Carry them as legacy history and obtain named-user review for any live approval that depends on them.
- Add and test server-side module flags so unfinished modules cannot be reached by direct URL or API. Flag changes require Partner approval and an audit event.

### 3. Acceptance and recovery

- Test anonymous access, expired sessions, a user's other-client identifiers, unauthorised firms, staff fee access, self-approval, contract expiry, duplicate uploads and locked-week edits through direct API calls.
- Verify imports and edits from two separate staff sessions, including stale updates and simultaneous imports.
- Test private file access, expired download URLs, restricted folders and correction/version rules.
- Back up the database and object-storage files separately. Supabase database backups contain storage metadata, not the stored file objects. Perform a complete restore exercise before live use.
- Assign an operational owner for failed jobs, backups, access changes and support. Establish the acceptable recovery point and recovery time before launch.
- Keep the current accounting/filing process authoritative until its replacement module is accepted. A live task tracker does not make an unfinished tax return or finance ledger authoritative.

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

Current test command: `npm test`. GitHub Actions run [#44](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41685064617) passed 251 checks and Chromium flow against a local test server with mocked backend. This does not replace hosted role-based UAT or prove the five end-to-end workflows against staging. The deployed `staff-workspace-v12` function is v43 with server idle enforcement; the hosted Pages build is still `2026-11-03.2`.

## Remaining external setup before production

1. Verify the production Cloudflare and Supabase projects, owners, region, secrets and storage as separate from staging. Only the staging Supabase project was visible in the connected account during the current review.
2. Confirm project owners, hosting region and recurring budget. Approve any paid plan in the provider's billing screen; do not send payment details or secrets in chat.
3. Continue publishing staging-only changes to the already authorized repository `cpaalarcon-ux/PCL-CRM`, branch `backend/staging-foundation`. Keep privileged keys in the deployment secret store, never in public JavaScript. The prior authorization does not include production or `main`.
4. Finish and accept WP0–WP3, then complete role-based staff UAT and obtain written Partner approval before creating a tagged production release or changing `pcl.phamalarcon.com`.

Repository authorization alone does not create a production cloud account, approve subscriptions, verify data migration or authorize a live release.

## Provider references

Verified on 22 October 2026:

- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
