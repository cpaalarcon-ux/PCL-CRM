# Connected workspace V6 — interrupted verification checkpoint

Status as of 23 October 2026: **not released**.

## Applied and committed
- Supabase staging migration `20261023140533_connected_workspace_sectors_v6`: 22 sectors, parent categories, client sector foreign key.
- Migration is recorded in this branch. The deployed frontend/API still use the earlier static sector choices.
- No production DNS or main-branch cutover.

## Prepared locally, not committed or deployed
Workspace: `/workspace/scratch/be0c02b89903/pcl-crm-build`.
The execution environment became unavailable during integration testing. Recover and inspect these files before continuing:
- `staff-workspace-v6.mjs`, edits to `staff-pilot.mjs`, `staff-pilot.html`, `staff-pilot.css`.
- `supabase/functions/staff-pilot/workspace-actions.ts`, `workbook-actions.ts`, `workspace-rules.mjs`, `purchase-categories.json`.
- Edits to `index.ts`, `deno.json`, `package.json`, `package-lock.json`.
- `tests/workspace_rules.test.mjs`.
- `supabase/connected_workspace_v6.sql` and a provisional local migration file. Do not apply the sector portion again.

The pending SQL is preserved in `supabase/planned/connected_workspace_v6_remaining.sql`. It is a draft, not an applied migration.

## Verification completed before disconnect
- 24 Node tests passed: existing validation/upload tests plus 11 workspace-rule tests.
- Deno type check passed for the expanded edge function.
- JavaScript syntax checks passed for the modified frontend modules.
- SQL/RLS integration, authenticated UI, real XLSX import, schedule cron and deployment acceptance remain incomplete.
- Read-only database verification confirmed `project_schedules` and `project_editor()` do not exist. Only the sector migration succeeded.
- Larger Supabase migration requests returned `Invalid or expired requestState`; do not describe them as applied.

## Intended features under test
- Dynamic sectors and one-hour sessions.
- Supervisor project/task creation in authorised scope.
- Editable once-off/weekly/monthly/combined schedules and automatic period tasks.
- Reasoned reassignment and in-app overdue/missing-document escalation.
- Own-task timesheets, Manager review, immutable approvals and reversal entries.
- Server-side XLSX preview, worksheet/header/column mapping, duplicate skipping, rejection counts and immutable source rows.
- Purchase mapping to resale, expenditure categories and PPE.
- Scoped project activity reports.

## Resume safely
1. Recover local files; reconcile the SQL against the actual migration history.
2. Finish database tests with fictional records and rollback, including cross-firm denials, Supervisor rights, self-approval denial, reversal locks, recurrence idempotency and future-only schedule edits.
3. Check workbook parser against the private Wamumbi workbook without committing its contents. Verify repeated upload counts and changed-reference rejection.
4. Verify optional filing evidence and required actual filing date for filing tasks.
5. Deploy the compatible database, edge function and frontend together after tests.
6. Keep engagement activation gated. Finance, tax approval, complete HR, communications, audit and external portal remain outside this connected testing release.

No client workbook, staff credential or authentication token belongs in this public repository.
