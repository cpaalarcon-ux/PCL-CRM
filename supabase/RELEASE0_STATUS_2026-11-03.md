# Release 0 implementation status

**Reviewed:** 3 November 2026, Africa/Nairobi  
**Environment:** staging review only  
**Disposition:** HOLD. This is an evidence snapshot, not production approval.

> **Canonical staging record:** This status, [ERP alignment control](ERP_ALIGNMENT_CONTROL.md), and [Full ERP staff UAT](FULL_ERP_STAFF_UAT.md) are the current source of truth. Older release guides are historical wherever their build, session, tax, KYC or approval wording differs. Candidate source and deployed service are separate until the exact commit and function version are recorded here.

## Observed deployment and candidate

| Item | Evidence | Status |
|---|---|---|
| Staging database | Supabase project `pcl-erp-staging` (`yfjiculexbzpkvtapudk`) returned `ACTIVE_HEALTHY`, region `ap-south-1`. | Verified as active |
| Deployed workspace function | `staff-workspace-v12` is `ACTIVE`, version 42. Its deployed session response still reports `idle_timeout_seconds:null` and `logout_policy:'manual'`; it does not match the current 30-minute idle policy in source. | Verified; deploy and verify the aligned candidate before staff UAT |
| Latest applied schema changes | Migration history includes `20261103114700_tot_vat_obligation_alignment`, `20261103114818_kyc_evidence_and_beneficial_owners`, and `20261103114941_dated_activity_obligation_dependency_map`. | Verified as applied |
| Database safeguards | Read-only catalog query found 109 `erp_private` tables with RLS enabled; 107 have forced RLS. The remaining two tables need explicit review. | Verified; review open |
| File storage | Bucket `staff-pilot-private` exists with `public = false`; no Storage policies are present. Application file operations use server-side Edge Function calls. | Private bucket verified; per-client and per-role authorization remains unverified |
| Audit history | The `erp_private.audit_events_immutable` trigger exists. Application code writes audit events for selected actions, including access changes and file downloads. | Immutability mechanism verified; required event coverage and completeness are unverified |
| Release checks | `TOTVAT`, `KYCRULES`, and `KYCBO` are each `Not tested` in `erp_private.release_checks`. | Verified; sign-off remains open |
| Staging source | Branch head is `fb6de5fa8215af6131df0f4e346b238d81f8048d`; PR #5 remains open. A later local candidate change is not yet part of this branch head. | Keep production/main unchanged; run CI against the final pushed candidate |
| Alternate mapping PR | PR #11 is open and not mergeable against the current branch. Its separate mapping-approval behavior is not aligned with the single period-review gate. | Do not merge as-is; selectively port only after reconciliation and test |
| Legacy functions | Staging lists active `staff-workspace-v6`, v7, v8, v9 and v10 functions as well as v12. Current staff-pilot frontend points to v12. | Inventory usage, confirm no supported caller, then retire legacy endpoints through a reviewed staging change |
| Automated suite | GitHub Actions run [#40](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41661816234) passed 249 tests and the Chromium browser flow on `fb6de5fa8215af6131df0f4e346b238d81f8048d`. | Verified for that commit; browser flow uses a local test server and mocked backend, not hosted role acceptance |
| Staging frontend | Last observed hosted page reported build `2026-11-03.2`. Current local candidate source is build `2026-11-03.4` and has not yet been published. | Hosted role-based UI/API acceptance remains open |
| Supabase advisors | Security advisor reports leaked-password protection disabled and private auth/control tables without general policies. Performance advisor reports unindexed foreign keys. | Track password protection and access-policy reviews as production items; triage indexes by query impact |
| Production separation | The connected Supabase project list showed the staging project only. No separate production project, keys, storage or deployment boundary was verified. | Not verified; production remains held |
| Staging data classification | The 30 October UAT record notes that records beyond the fictional UAT clients were visible in the workspace. No current data inventory or deletion date was verified. | Not verified; protect staging to production standard and do not share real client data in test evidence |

## WP1 foundation acceptance status

Status applies to each complete acceptance criterion: **Built and verified**, **Built not verified**, or **Not built**. A partial implementation does not count as accepted. “Built and verified” requires evidence from the deployed staging candidate and the required tests.

| Requirement | Status | Evidence and remaining work |
|---|---|---|
| 1.1 Authentication, recovery, rate limits and MFA | **Partial; not accepted** | Current local candidate sets a 30-minute idle timeout plus manual sign-out. Deployed v12 version 42 is still manual-only. MFA and deployed role UAT are absent. |
| 1.2 Server permission matrix | **Partial; not accepted** | The server enforces role defaults, individual area restrictions, role/action checks and assigned record scope. The new dispatcher denies unmapped actions. This is still a ten-area map, not the required per-item rights matrix for each role. Real role-based API denial tests remain open. |
| 1.3 Permission registry build test | **Built; staging UAT open** | CI enumerates route action names, fails when a protected action lacks an area, and checks the fail-closed dispatcher. Run #40 passed; separate-role API/browser evidence is still required. |
| 1.4 Private files and access logging | **Built not verified** | Private bucket and server file paths exist; client/role denial tests and complete access-log evidence are open. |
| 1.5 Backups and full restore | **Not built** | No backup configuration or restore record was evidenced. Set RPO/RTO and record a clean-environment database and file restore. |
| 1.6 Separate staging and production | **Built not verified** | Staging is active; a separate production project, keys, storage and credential boundary were not verified. |
| 1.7 Complete append-only audit log | **Built not verified** | Immutable trigger and selected writes exist; required event coverage is untested. |

## WP0–WP3 order and disposition

| Package | Status | Current evidence or blocker |
|---|---|---|
| WP0 — Reconcile status and documents | **In progress** | Branch head, v12 version 42, last observed frontend build 03.2 and CI run #40 are identified. The new local timeout candidate is not yet published; staging data inventory and classification remain open. |
| WP1 — Production foundation | **Not accepted** | See the seven requirement rows above. MFA, complete permission registry, restore drill, environment separation and role-based negative testing remain open. |
| WP2 — Five core workflows | **Not accepted** | CI run #40 passes 249/249 plus a mocked Chromium flow, including ledger integration. None of the five required workflows has been evidenced end to end against the hosted staging backend with separate staff roles and touch counts. |
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
- Current observed branch head: `fb6de5fa8215af6131df0f4e346b238d81f8048d`; GitHub Actions run #40 passed 249 automated checks and a mocked Chromium flow. Current local source includes a 30-minute inactivity alignment and build `2026-11-03.4`, not yet published. Supabase still serves v12 version 42 with manual-only session metadata, and the last observed hosted frontend was build `2026-11-03.2`. Do not mark the candidate deployed until both hosted components are checked against the same release commit.

No production database, function, frontend, DNS, user, credential or data was changed during this status review.
