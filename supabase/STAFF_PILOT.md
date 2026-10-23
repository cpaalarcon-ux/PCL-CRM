# Connected staff testing release V6

Use https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot for connected testing. The root ERP screens remain browser-local previews; no production cutover or DNS change is included.

## Available in the connected workspace

- Staff-ID login and private copyable, single-use password setup/reset links. No email delivery is required. Login, logout, disabled accounts and contract expiry are checked on the server. Inactivity is limited to one hour; access tokens also expire after one hour and are not refreshed silently.
- Five staff categories: Engagement Partner, Manager, Audit Supervisor, Audit Assistant and Intern. Partner/Manager administer staff and incomplete clients; Managers cannot promote or reset other Managers/Partners. Supervisors can create and maintain projects and tasks within authorised firms without gaining staff-administration or financial rights.
- Shared clients across authorised firms, red missing-field markers and database-backed sectors. Partner/Manager can add a sector. Every project retains one client and handling firm; another firm requires a separate project.
- Editable project names auto-filled from client, service and year. Once-off, weekly, monthly, weekly + monthly, quarterly and annual schedules; explicit start/end, preparer, reviewer and applicable tax obligations. Schedule edits apply to future periods and preserve existing tasks and evidence.
- Weekly/monthly tax compilation tasks, due-task generation, upcoming schedule preview and daily missing-document escalation. The scheduler checks every minute, uses Africa/Nairobi dates, catches up missed releases and deduplicates occurrences. Quarterly/annual General packs are generic scheduled tasks, not a complete statutory calendar.
- Forward / Escalate on open tasks with a required message. Authorised recipients are selected on the server. Ordinary staff route only their own task to an existing project teammate or supervisory staff in the same firm; Interns route only to supervisory staff. Escalation requires a Supervisor, Manager or Partner. Editors may forward within their permitted firm. Handover changes ownership, preserves a history entry and creates an in-app alert. No emails are sent. Completed/cancelled tasks and stale updates are blocked.
- Private PDF/XLSX/PNG/JPEG documents with client → firm → project → task validation. KYC, signed engagement letters, BRS receipts and final reports lock automatically. Assistants upload working papers for their assigned tasks; Interns cannot upload. There is no overwrite/delete endpoint.
- Authenticated XLSX review, worksheet/header/data-range selection and column mapping. Imports show source, new, duplicate and rejected row counts. Blank template rows are ignored; exact duplicates are skipped; changed data for an existing identity is rejected. Purchase mapping separates resalable goods, expenditure categories and PPE. Imported source values stay immutable. These are working-paper controls, not a KRA verification or VAT eligibility decision.
- Own-task timesheets, weekly hours and submission; Partner/Manager review without self-approval. Approved time is immutable and corrections require an exact negative reversal. Project reports show permitted task progress, hours, import counts and mapping totals with a CSV download.

## Where staff test each feature

1. Sign in with the existing staff ID and password. Refresh the page after deployment; no new account is required.
2. **Projects & tasks → New project:** select client, handling firm and service; choose frequency and task pack, dates, preparer/reviewer and applicable obligations.
3. Select the project, then use **Weekly / Monthly**, **Upcoming schedule**, **Generate due tasks**, or **Edit project & schedule**. Future tasks appear in the preview until their release time. Generation is safe to repeat.
4. On an open task choose **Forward / Escalate**, select action and recipient, enter the handover message and confirm. The recipient sees it under **My alerts** and their assigned work; the sender sees **Tasks I forwarded or escalated**.
5. **Documents → Upload document:** select the correct links and XLSX. Choose **Review Excel**, preview the worksheet/header, map columns and import only the intended data rows. Then open **Projects & tasks → Imported rows & mapping**.
6. **Time & HR → Log time:** select an assigned task and enter work done. Managers use **Team approvals**. **Project report** contains scoped task and time totals.

An actual filing date is required when completing a filing task; a PDF receipt is optional. This records staff activity and does not enable tax approval or electronic filing.

## Architecture and deployment

The frontend calls **staff-workspace-v6**, separate from the retained **staff-pilot** function. Both authenticate protected actions themselves; gateway JWT verification is disabled only because login/setup routes accept unauthenticated requests. Auth.getUser and a live server session establish identity; request-body roles and IDs never establish permission. Business SQL runs transactionally as non-login, non-BYPASSRLS `erp_api`, with database RLS in the private schema.

Server secrets are platform-provided and must never be placed in HTML or GitHub. The browser has a publishable key and its own token in tab session storage. Do not expose `erp_private` through the Data API or grant browser roles access.

Apply migrations in filename order. The ten V6 migrations match the staging migration history. Deploy the eight runtime files in `supabase/functions/staff-workspace-v6`, including `deno.json`, with entrypoint `index.ts` and explicit import_map_path `deno.json`. Package files support local checking only; do not deploy node_modules. Dependencies are pinned.

XLSX parsing enforces upload/signature, archive expansion, sheet and row limits, and rejects macros, encryption and external links. Formulas are not evaluated; only cached results are read. Files stay in the private `staff-pilot-private` bucket and are streamed through authenticated downloads. Object storage writes use UUID paths and do not overwrite existing objects. Failed writes roll back metadata and remove their new object; production orphan reconciliation and malware scanning remain required.

## Verification

- 24 Node validation/upload/recurrence/import tests pass; both frontend modules pass syntax checks and the new Edge function passes Deno type checking.
- Database regression in a rolled-back transaction checks idempotent weekly/monthly generation, schedule-history preservation, immutable approved time, exact reversal and the activation gate. Scheduler runs were checked after fixing a SQL alias collision.
- Fictional live HTTP tests verify Supervisor project creation, Assistant/Supervisor privilege denials, assigned-task scope, recurrence, timesheet submission/approval/reversal, private XLSX upload/preview, purchase mapping and reports. The four-row import produced 2 new / 1 duplicate / 1 rejected; repeat import produced 0 new / 3 duplicates / 1 rejected.
- The real Wamumbi workbook was parsed privately to check worksheet/size compatibility; no real client workbook or credential is committed. This does not claim a completed Wamumbi import.
- Separate routing tests check required messages, authorised recipients, stale revisions, assignment movement, alerts, sender history and closed-task blocking.

Commands:

```sh
node --test tests/staff_pilot_validation.test.mjs tests/staff_pilot_upload.test.mjs tests/workspace_rules.test.mjs
npm ci --ignore-scripts --prefix supabase/functions/staff-workspace-v6
deno check --node-modules-dir=manual --config supabase/functions/staff-workspace-v6/deno.json supabase/functions/staff-workspace-v6/index.ts
python tests/workspace_v6_http.py /private/qa-fixture.json /private/fictional-import.xlsx --resume
python tests/workspace_routing_http.py /private/qa-fixture.json
```

Use only temporary fictional fixtures in staging. Disable QA accounts and revoke their sessions/setup links after testing. Archive fictional records while retaining audit history and locked evidence.

## Remaining release gates

The navigation explicitly labels Finance and Communications as not yet connected. Financial WIP, tax approvals, production engagement activation, full HR/attendance, the client portal, and staff/client bulk imports are not enabled by this release. Do not treat the preview modules as shared operational records.

The security advisor reports leaked-password protection disabled. Address it before production; local password-length checks are not compromised-password screening. See https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection. MFA, restore testing, malware scanning, retention controls, load testing and staff acceptance remain production gates. Closed private session/token/rate-limit tables intentionally have no application-role policies; see https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy.
