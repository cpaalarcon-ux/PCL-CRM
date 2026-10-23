# Connected staff pilot

The staging review branch now includes `staff-pilot.html`. This is the connected staff workspace. The older `index.html` modules remain browser-local previews; the new sign-in link opens the connected workspace without converting preview roles into real permissions.

## Included

- Staff-ID and password sign-in. No staff email address is required. Supabase Auth uses an internal, non-deliverable identifier managed exclusively by the server.
- Expiring, single-use password setup/reset links, shown once for copying. The user chooses their own password. Only token hashes are stored. Tokens are in URL fragments and are removed from the address bar immediately. No passwords or tokens are included in source control.
- Twenty-minute server-enforced inactivity timeout. Reset, disable, expired contract and logout are checked on subsequent requests, including requests with an otherwise valid JWT.
- Five staff categories, with roles read from the database. Partner/Manager staff administration cannot be reached by changing a browser category selector. Managers cannot promote staff into Partner/Manager accounts or reset those accounts.
- Shared clients across handling firms, incomplete profile markers, optimistic edit checks, draft projects, assignments and task status updates.
- Firm/project/task scopes. Interns see their assigned tasks and those tasks' working papers, without the client directory or client contact details.
- Private document uploads and authenticated downloads. KYC/permanent files, signed engagement letters, BRS receipts and final reports lock automatically. Assistants upload only working papers attached to their assigned tasks. Interns cannot upload. There is no overwrite or delete endpoint.
- Change events for core records, firm permissions and assignments. Upload/download access is recorded.

The current pilot supports manual client/staff entry. The preview's Excel parsers are not yet connected to authenticated import commits. Filing approvals, financial posting, production engagement activation, client portal access and the remaining ERP modules are not enabled by this release.

## Architecture and deployment

`staff-pilot.mjs` calls the `staff-pilot` Supabase Edge Function. The function verifies protected requests with Supabase Auth, checks a live server-side session, and executes business queries inside a transaction under the non-login, non-BYPASSRLS `erp_api` database role. JWT claims are established by the verified server, never accepted from request-body identity or role fields. Private policy lookup functions have fixed search paths and are not exposed through the Data API.

Gateway JWT checking is disabled for this one function because its login and one-time setup routes must accept unauthenticated requests. The function performs its own authentication and authorization on every protected action. Do not remove those checks. Browser publishable keys are not privileged credentials.

The function uses the platform-provided `SUPABASE_DB_URL`, `SUPABASE_URL` and Auth admin keys only on the server. Keep all of them out of GitHub, HTML, logs and frontend configuration. The browser receives only the publishable key and its own short-lived access token. Access tokens are held in tab session storage; no refresh token is returned to the browser.

Runtime imports are pinned in `supabase/functions/staff-pilot/deno.json`. `package.json` and `package-lock.json` support repeatable local npm installation and Deno checking. When deploying through MCP, upload `index.ts`, `validation.mjs` and `deno.json`, explicitly use `import_map_path: deno.json`, and do not upload the npm-only package files or `node_modules`. Local npm manual resolution is not the Edge bundler's resolution mode.

All SQL migrations must be applied in order. Their filenames match the remote migration history. The audit-permission follow-up does not grant access to managed Auth tables; the following actor migration removes the invoker audit code's dependency on Auth-schema usage. Do not expose `erp_private` as a REST schema or grant browser roles access to it.

Uploads are limited to 10 MB and PDF/XLSX/PNG/JPEG with extension/signature checks. The `staff-pilot-private` bucket is created as private on first authorized upload and its privacy is checked. Storage is accessed through the server; no public object URLs are returned. Files are never inserted as SQL binary data. Object creation uses unique paths and `upsert: false`; failed metadata/storage transactions remove only their newly created object. A storage/network failure may still leave an orphaned object requiring reconciliation. Production malware scanning and retention/backup processes are separate readiness gates.

## First staff pilot

1. The Engagement Partner uses their privately provided, 24-hour setup link and login ID. Choose a password, then sign in.
2. Confirm the handling firm names in **Firms**.
3. In **Staff & access**, add 3–5 pilot staff with their positions, employment types, contract end dates and authorised firms.
4. Click **Generate login link**, confirm, then copy and share the login ID and link privately with that person. Existing ERP access stops immediately when a reset link is issued.
5. Add fictional client records, including an incomplete profile, and confirm the red missing-data markers.
6. Create a draft project for the correct client and handling firm. Assign a task to each pilot staff member.
7. Verify that each staff member sees only permitted work and working papers. Upload a fictional PDF and test its download.
8. Record pilot feedback before connecting imports or authorising operational client files.

Do not reuse QA accounts. Temporary test accounts must be disabled and their sessions/setup links revoked after verification. Fictional test clients/projects/firms are archived so they do not appear in the initial workspace; their audit history is retained. Locked test evidence is retained with its archived parent record.

## Verification commands and limits

### Upload correction and main-platform readiness — 23 October 2026

The upload form now narrows choices in order: client, linked handling firm, open project, and matching task. Changing an earlier selection clears dependent selections. Partners and Managers may save a client-level document when the client has no project yet; Supervisors require a project and Assistants require their assigned task. The server still checks permissions and all relationships independently and reports a visible-record mismatch without disclosing inaccessible records.

New storage keys use document UUIDs and a validated file extension. The original filename remains metadata used for display and download, so Unicode or punctuation in a workbook filename is not part of the object key. Existing stored documents keep their keys and remain downloadable. Failed storage writes roll back their metadata.

Run `node --test tests/staff_pilot_validation.test.mjs tests/staff_pilot_upload.test.mjs` for the 13 validation and upload regression tests. The upload fix still needs an authenticated browser upload/download check before it can be called fully accepted. No client workbook is included in the repository.

The main interface and the connected pilot are still different data paths. Publishing the main preview does not connect its modules or transfer browser-local data. The operational move requires connecting the chosen main screens to authenticated APIs, reconciling existing records, verifying private uploads, and completing the production gates below. Recurring weekly/monthly tax generation, Excel row imports, shared timesheets and project reports remain unconnected. Keep tax approvals and finance unavailable until those services are implemented and tested. No production cutover is included in the upload correction.

### Verified in staging on 22 October 2026

The Edge Function and connected sign-in page are deployed. The browser check verified the public sign-in page at `https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot`; authenticated browser workflows still require the staff pilot walkthrough.

Seven validation tests and the Deno type check passed. Live HTTP tests with fictional Partner, Manager, Assistant and Intern accounts passed setup-link replay rejection, login, cross-firm denial, Manager privilege-escalation denial, incomplete client records, task assignment, stale-edit rejection, private upload/download permissions, and immediate access revocation after reset, disable and logout. The final resumed task/document phase passed 23 HTTP assertions. The rolled-back foundation constraint suite also passed after the pilot migrations.

The upload bucket was verified private. Temporary QA accounts are inactive and archived, with sessions and links revoked. Fictional QA clients, projects and firms are archived; locked evidence and audit history remain. Three firm names are available in the initial workspace. No historical client/staff import or production DNS cutover was performed. The first Partner receives a private, expiring setup link outside source control.

- `node --test tests/staff_pilot_validation.test.mjs`
- `npm ci --ignore-scripts` inside `supabase/functions/staff-pilot`
- `deno check --node-modules-dir=manual --config supabase/functions/staff-pilot/deno.json supabase/functions/staff-pilot/index.ts`
- `python tests/staff_pilot_http.py /path/to/private-qa-fixture.json` against this dedicated staging project only. The fixture must contain an authorised temporary QA Partner, never a real staff password in the repository. The script creates labelled fictional fixtures. `--resume` resumes the task/document checks after fixtures exist.
- `supabase/tests/foundation_rollback.sql` verifies foundational constraints in one rolled-back transaction; it is not a replacement for live staff-scope tests.

The security advisor's informational no-policy notices for session, token, rate-limit, capability and not-yet-connected import tables are intentional: these tables remain closed to application-role direct access. See [the RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

Supabase's **leaked-password protection is not enabled**. This was reported by the security advisor and must be addressed in the production security review; no paid plan has been activated for it. See [password strength and leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The pilot's password validation is a length/character check, not a compromised-password check. MFA, operational backup/restore testing, malware scanning, complete retention controls and load testing remain production gates.
