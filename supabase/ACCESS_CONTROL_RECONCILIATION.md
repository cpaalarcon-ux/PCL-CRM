# Staff access-control reconciliation

**Staging release:** 2 November 2026  
**Purpose:** Align the proposed `accessControl.js` role matrix with the access rules already enforced by the ERP.

## Decision

The attached `accessControl.js` is not used as a second authorization engine. The ERP already checks the active staff session, role, firm access, client/project/task scope, workflow status and reviewer independence in the edge function and PostgreSQL row-level security policies.

The attached proposal includes per-person permission overrides and one general approval rule. The approval rule conflicts with workflow-specific reviewer roles, so it is not used. The staff workspace now supports audited per-person **area restrictions**: a Partner or a Manager managing a direct report can remove areas included in the staff member's role. These settings cannot add role authority or change firm/project scope. Backend handlers and database policies remain authoritative for every action.

## Reconciled role guide

| Role | Current ERP scope and work |
| --- | --- |
| Engagement Partner | All active handling firms and their authorised client work. Partner-only actions include chart-account activation, audit framework approval and final audit-file approval. |
| Manager | Authorised firms and managed team/project scope. Can manage client/project setup, approve client account mappings independently, and review/post client-ledger journals. Cannot create or change Partner or Manager staff accounts. |
| Audit Supervisor | Assigned project/task scope. Can oversee project tasks and review designated period imports, reconciliations, stock controls and workpapers when that workflow permits. This does not confer client-account-mapping approval or ledger posting. |
| Audit Assistant | Assigned client/project/task scope. Can prepare uploads, classify supported source rows and submit work for review. Cannot independently approve or post work. |
| Intern | Assigned task-level support work only. Interns do not receive client-ledger, purchase-mapping, source-import or audit-workpaper access. |

All roles remain limited by server-enforced firm and record scope. A page or button visible in the browser does not grant permission.

## Approval boundaries

| Workflow | Server-enforced reviewer |
| --- | --- |
| Client source-account to ERP-account mappings | Manager or Partner; reviewer must differ from the mapping creator. Eligible mappings can be batch approved. |
| Chart-account activation | Partner only. |
| Opening TB and client-ledger journals | Manager or Partner; reviewer must differ from the preparer and last editor. |
| Designated period-imports and reconciliations | Supervisor, Manager or Partner where that workflow permits; reviewer must differ from the preparer. |
| Audit framework and final audit file | Partner only. The final-file preparer cannot approve their own file. |

Do not replace these workflow checks with a shared `approveRoles` list. In particular, Supervisor review rights are valid for selected imports and reconciliations, but not for account-master approvals, ledger posting, chart-account activation or final audit approval.

## Code locations checked

- Session, firm, client, project and task scope: `20261022183641_staff_pilot_access.sql`, `20261023143710_connected_project_permissions_v6.sql` and later scoped-policy migrations.
- Client account mapping setup and batch approval: `supabase/functions/staff-workspace-v12/improvement-actions.ts`.
- Period-import and reconciliation review: `period-import-actions.ts` and `accounting-actions.ts`.
- Opening TB and journal review/post: `ledger-actions.ts` and `ledger-rules.mjs`.
- Audit framework and final-file approval: `audit-actions.ts`.
- The Home and Staff & Access role guide is rendered by `staff-access-guide.mjs` and checked against these handler boundaries in `tests/access_guide.test.mjs`.

## Individual area restrictions and role assignment

- **Role assignment:** each staff member has one existing ERP category. Any number of staff can share that role. Managers can assign team roles to their managed direct reports; Partner/Manager promotion remains Partner-controlled under the existing staff policies.
- **Per-person adjustment:** from Staff & Access → **Edit access**, a Manager or Partner can switch off areas present in a person's role defaults, record a reason, and restore those areas later. Areas outside the role remain unavailable and cannot be switched on here.
- **Server enforcement:** every mapped action checks the staff member's effective area access. The workspace response also omits restricted data, and file uploads/downloads and import actions are checked separately.
- **Scope and approvals:** area settings do not alter firm, client, project, or task scope. They do not override role-specific approval rules, maker-checker separation, or Partner-only decisions.
- **Audit:** each change records the target staff member, role, restricted/restored areas, actor, and reason in the immutable audit log. Staff cannot change their own access; Managers cannot change Partner or Manager accounts.
- **Reassignment behavior:** a restriction remains on record if the staff member changes to a role that does not include that area. Changing the role can therefore reveal that an area is still restricted; a Partner or authorized Manager can review and restore it explicitly.
