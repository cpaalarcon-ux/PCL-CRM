# Staff access-control reconciliation

**Staging release:** 2 November 2026  
**Purpose:** Align the proposed `accessControl.js` role matrix with the access rules already enforced by the ERP.

## Decision

The attached `accessControl.js` is not used as a second authorization engine. The ERP already checks the active staff session, role, firm access, client/project/task scope, workflow status and reviewer independence in the edge function and PostgreSQL row-level security policies.

The attached proposal includes per-person permission overrides, but the ERP has no secured override table or audited override workflow. It also applies one general approval rule that conflicts with workflow-specific reviewer roles. Adding the file as-is could either deny valid existing Supervisor reviews or grant rights the backend does not permit. The staging interface therefore uses a plain-language role guide; backend handlers and database policies remain authoritative.

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

Per-person access exceptions are intentionally not enabled in this staging release. Supporting them would require an audited database model, restrictive RLS, server-side evaluation on every relevant action, and tests for grants, revocations, scope, self-change and reviewer independence before any override can be used.
