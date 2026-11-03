# Release 0 implementation status

**Reviewed:** 3 November 2026, Africa/Nairobi  
**Environment:** staging review only  
**Disposition:** HOLD. This is an evidence snapshot, not production approval.

## Observed deployment and candidate

| Item | Evidence | Status |
|---|---|---|
| Staging database | Supabase project `pcl-erp-staging` (`yfjiculexbzpkvtapudk`) returned `ACTIVE_HEALTHY`, region `ap-south-1`. | Verified as active |
| Deployed workspace function | `staff-workspace-v12` is `ACTIVE`, version 40. `staff-pilot` is `ACTIVE`, version 3. | Verified; deployed source is not matched to the current local candidate |
| Latest applied schema changes | Migration history includes `20261103114700_tot_vat_obligation_alignment`, `20261103114818_kyc_evidence_and_beneficial_owners`, and `20261103114941_dated_activity_obligation_dependency_map`. | Verified as applied |
| Database safeguards | Read-only catalog query found 109 `erp_private` tables with RLS enabled; 107 have forced RLS. The remaining two tables need explicit review. | Verified; review open |
| File storage | Bucket `staff-pilot-private` exists with `public = false`; no Storage policies are present. Application file operations use server-side Edge Function calls. | Private bucket verified; per-client and per-role authorization remains unverified |
| Audit history | The `erp_private.audit_events_immutable` trigger exists. Application code writes audit events for selected actions, including access changes and file downloads. | Immutability mechanism verified; required event coverage and completeness are unverified |
| Release checks | `TOTVAT`, `KYCRULES`, and `KYCBO` are each `Not tested` in `erp_private.release_checks`. | Verified; sign-off remains open |
| Local candidate | Branch `backend/staging-foundation`, based on `05b68d7c7d23a741dbba0ba7a56c841f0bb68d27`; candidate files are uncommitted. | Verified local state; no candidate commit reference yet |
| Automated suite | `npm test` passed 247 tests, 0 failed, 0 skipped. `git diff --check` passed. The run includes the ledger integration test and its ExcelJS import path. | Verified locally; does not prove hosted end-to-end workflow acceptance |
| Production separation | The connected Supabase project list showed the staging project only. No separate production project, keys, storage or deployment boundary was verified. | Not verified; production remains held |
| Staging data classification | The 30 October UAT record notes that records beyond the fictional UAT clients were visible in the workspace. No current data inventory or deletion date was verified. | Not verified; protect staging to production standard and do not share real client data in test evidence |

## WP1 foundation acceptance status

Status applies to each complete acceptance criterion: **Built and verified**, **Built not verified**, or **Not built**. A partial implementation does not count as accepted. “Built and verified” requires evidence from the deployed staging candidate and the required tests.

| Requirement | Status | Evidence and remaining work |
|---|---|---|
| 1.1 Authentication, recovery, rate limits and MFA | **Not built** | Local source has staff sign-in, single-use 24-hour setup, request limits and manual sign-out. MFA and deployed role UAT are absent. |
| 1.2 Server permission matrix | **Not built** | Server role/scope checks exist; the current map has ten broad areas and five roles, not the required per-action matrix. |
| 1.3 Permission registry build test | **Not built** | No test enumerates every route/action and fails when a permission key is missing. |
| 1.4 Private files and access logging | **Built not verified** | Private bucket and server file paths exist; client/role denial tests and complete access-log evidence are open. |
| 1.5 Backups and full restore | **Not built** | No backup configuration or restore record was evidenced. Set RPO/RTO and record a clean-environment database and file restore. |
| 1.6 Separate staging and production | **Built not verified** | Staging is active; a separate production project, keys, storage and credential boundary were not verified. |
| 1.7 Complete append-only audit log | **Built not verified** | Immutable trigger and selected writes exist; required event coverage is untested. |

## WP0–WP3 order and disposition

| Package | Status | Current evidence or blocker |
|---|---|---|
| WP0 — Reconcile status and documents | **In progress** | Root `README.md`, `PRODUCTION_ROLLOUT.md`, this status table and `CHANGELOG.md` now describe the connected staging state. The current candidate is not committed, so there is no commit reference for the document update; hosted source matching also remains open. |
| WP1 — Production foundation | **Not accepted** | See the seven requirement rows above. MFA, complete permission registry, restore drill, environment separation and role-based negative testing remain open. |
| WP2 — Five core workflows | **Not accepted** | The local suite passes 247/247, including a ledger integration test. The five specified workflows have not all been evidenced end to end on a clean hosted staging database, with staff roles and touch counts. |
| WP3 — Hide unfinished modules | **Not built** | No complete server-side per-module feature-flag system with logged Partner-approved changes was verified. A disabled module must be blocked by URL and direct API as well as hidden in the interface. |
| WP4–WP8 | **Held by order** | Do not begin new module work until WP0–WP3 are completed and accepted. |

### WP2 hosted workflow evidence

| Workflow | Hosted staging status | Evidence still required |
|---|---|---|
| Onboard a client through Gate A | Not verified | Two separate roles; KYC evidence forms; engagement and years; generated projects/tasks; reviewer approval and audit trail. |
| Monthly VAT period | Not verified | Upload and control totals; exceptions; Gate B approve/post/lock; filing acknowledgement record. |
| Monthly payroll | Not verified | P10 import, statutory/payables reconciliation, independent review, and filed status with due dates. |
| Catch-up year | Not verified | One annual upload with period columns; year opening TB; one year-level Gate B; oldest-first handling. |
| Year end | Not verified | Gate C, year lock, balance roll-forward, and audit pack generated without manual assembly. |

The automated suite includes local integration coverage but is not evidence for these hosted acceptance criteria. No per-workflow human-touch counts have been recorded.

## Evidence references

- Developer instructions v1.06 supplied with this review — work packages, acceptance criteria and evidence format.
- [Full ERP staff UAT](FULL_ERP_STAFF_UAT.md) — staging scenarios and outstanding tests.
- [Alignment review](PMS_V6_UAT_ALIGNMENT_2026_10_28.md) — ERP specification checks and release gaps.
- [Connected workspace status](CONNECTED_WORKSPACE_V6_STATUS.md) — earlier staging verification; not evidence for the current candidate unless its build is matched.
- Base commit checked: `05b68d7c7d23a741dbba0ba7a56c841f0bb68d27`. No new commit was created for this candidate.

No production database, function, frontend, DNS, user, credential or data was changed during this status review.
