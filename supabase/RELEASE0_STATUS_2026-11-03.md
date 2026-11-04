# Release 0 implementation status

**Reviewed:** 3 November 2026, Africa/Nairobi  
**Environment:** staging review only  
**Disposition:** HOLD. This is an evidence snapshot, not production approval.

> **Canonical staging record:** This status, [ERP alignment control](ERP_ALIGNMENT_CONTROL.md), and [Full ERP staff UAT](FULL_ERP_STAFF_UAT.md) are the current source of truth. Older release guides are historical wherever their build, session, tax, KYC or approval wording differs. Candidate source and deployed service are separate until the exact commit and function version are recorded here.

## Observed deployment and candidate

| Item | Evidence | Status |
|---|---|---|
| Staging database | Supabase project `pcl-erp-staging` (`yfjiculexbzpkvtapudk`) returned `ACTIVE_HEALTHY`, region `ap-south-1`. | Verified as active |
| Deployed workspace function | `staff-workspace-v12` is `ACTIVE`, **version 48**, deployed on 4 November 2026 from commit `e517c85b4168a2decc70756e2a9e47b26df33c53` (build `2026-11-04.2`: dependency-map tasks #27 and bank-centred close #28, on top of v46 test alignment #23), gateway JWT verification off as before. The server reports build and commit through `release_info`. Version 46 (`187af16`) is the rollback point. | Staging hosted check passed for `e517c85`: page and server both 2026-11-04.2, anonymous call refused, Chromium sign-in ready. Role and workflow checks wait for the fictional UAT secrets and variables |
| Latest applied schema changes | Includes `20261103114700_tot_vat_obligation_alignment`, `20261103114818_kyc_evidence_and_beneficial_owners`, `20261103114941_dated_activity_obligation_dependency_map`, and `20261103172501_enforce_idle_timeout_server_side` and `20261103190829_kyc_evidence_record_policy` (applied 3 November 2026; repository file renamed to the staging version). The last migration restores the 30-minute cutoff in both session lookup functions. | Verified as applied; regression check added |
| Database safeguards | Read-only catalog query found 109 `erp_private` tables with RLS enabled; 107 have forced RLS. The remaining two tables need explicit review. | Verified; review open |
| File storage | Bucket `staff-pilot-private` exists with `public = false`; no Storage policies are present. Application file operations use server-side Edge Function calls. | Private bucket verified; per-client and per-role authorization remains unverified |
| Audit history | The `erp_private.audit_events_immutable` trigger exists. Application code writes audit events for selected actions, including access changes and file downloads. | Immutability mechanism verified; required event coverage and completeness are unverified |
| Release checks | `TOTVAT`, `KYCRULES`, and `KYCBO` are each `Not tested` in `erp_private.release_checks`. | Verified; sign-off remains open |
| Staging source | Runtime commits `08e76ef`, `2f7b334`, `2ad6b95` and `a9c50fb` are on `backend/staging-foundation`; docs/test follow-up `f6f6a82` is also on the branch. Run #44 passed on runtime candidate `a9c50fb`; run #46 passed on `f6f6a82`; run #47 passed on branch head `7e08c78`. PR #5 remains open. | Staging candidate only; keep main/production unchanged |
| Alternate mapping PR | PR #11 is open and not mergeable against the current branch. Its separate mapping-approval behavior is not aligned with the single period-review gate. | Do not merge as-is; selectively port only after reconciliation and test |
| Legacy functions | Function logs for 3 November 2026 show `staff-workspace-v12` serving all application traffic (about 11,000 requests); the only other calls were three direct browser GETs to `staff-workspace-v6` at 05:52–05:55 EAT (no origin, refused). `staff-workspace-v6` was replaced with a retired endpoint (version 13, HTTP 410) on 3 November 2026; its source stays in the repository. `staff-workspace-v7`–`v10` and `staff-pilot` receive no traffic; their source exists only in Supabase (not in the repository), so retiring them is waiting for a decision on archiving that source first. Hosted scripts that targeted v6–v8 and `staff-pilot` were removed from `tests/`; `scripts/hosted-uat.mjs` and `tests/idle_session_http.py` target v12. | v6 retired; v7–v10 and staff-pilot pending the archive decision |
| Automated suite | GitHub Actions run [#44](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41685064617) passed on `a9c50fbc5016259c183167f84e670632e59f39de`: 251 automated checks plus Chromium browser UAT, including a focused test of the active v12 TOT/VAT rules. | CI green for runtime and migration identifier; browser flow uses a local test server and mocked backend, not hosted role acceptance |
| Staging frontend | Cloudflare Pages deployment `a06d332d` of `7e08c78` completed at 21:05 EAT; the hosted page reports build `2026-11-03.4`, matching source. Hosted staff sign-in succeeded at 21:14 EAT after the browser's stored copy of build 03.2 was cleared. | Pages matches source and hosted sign-in works; manual logout, browser idle behavior and role-based UI/API acceptance remain open |
| Supabase advisors | Security advisor reports leaked-password protection disabled and private auth/control tables without general policies. Performance advisor reports unindexed foreign keys. | Track password protection and access-policy reviews as production items; triage indexes by query impact |
| Production separation | The connected Supabase project list showed the staging project only. No separate production project, keys, storage or deployment boundary was verified. | Not verified; production remains held |
| Staging data classification | The 30 October UAT record notes that records beyond the fictional UAT clients were visible in the workspace. No current data inventory or deletion date was verified. | Not verified; protect staging to production standard and do not share real client data in test evidence |

## WP1 foundation acceptance status

Status applies to each complete acceptance criterion: **Built and verified**, **Built not verified**, or **Not built**. A partial implementation does not count as accepted. “Built and verified” requires evidence from the deployed staging candidate and the required tests.

| Requirement | Status | Evidence and remaining work |
|---|---|---|
| 1.1 Authentication, recovery, rate limits and MFA | **Partial; not accepted** | v12 v43 returns the 30-minute policy, and migration `20261103172501` now blocks API/refresh after 30 minutes without activity. The hosted page is build 03.4 and hosted sign-in works; real login and browser/server boundary are not verified. MFA is absent. |
| 1.2 Server permission matrix | **Partial; not accepted** | The server enforces role defaults, individual area restrictions, role/action checks and assigned record scope. The new dispatcher denies unmapped actions. This is still a ten-area map, not the required per-item rights matrix for each role. Real role-based API denial tests remain open. |
| 1.3 Permission registry build test | **Built; staging UAT open** | CI enumerates route action names, fails when a protected action lacks an area, and checks the fail-closed dispatcher. Run #44 passed; separate-role API/browser evidence is still required. |
| 1.4 Private files and access logging | **Built not verified** | Private bucket and server file paths exist; client/role denial tests and complete access-log evidence are open. |
| 1.5 Backups and full restore | **Not built** | No backup configuration or restore record was evidenced. Set RPO/RTO and record a clean-environment database and file restore. |
| 1.6 Separate staging and production | **Built not verified** | Staging is active; a separate production project, keys, storage and credential boundary were not verified. |
| 1.7 Complete append-only audit log | **Built not verified** | Immutable trigger and selected writes exist; required event coverage is untested. |

## WP0–WP3 order and disposition

| Package | Status | Current evidence or blocker |
|---|---|---|
| WP0 — Reconcile status and documents | **In progress** | Branch head `7e08c78` passes run #47; v12 v43 and the new migration are deployed. Hosted frontend is build 03.4 and hosted sign-in works. Staging data inventory/classification and PR #11 reconciliation remain open. |
| WP1 — Production foundation | **Not accepted** | See the seven requirement rows above. MFA, complete permission registry, restore drill, environment separation and role-based negative testing remain open. |
| WP2 — Five core workflows | **Not accepted** | CI run #44 passes 251 checks plus mocked Chromium flow. None of the five required workflows has been evidenced end to end against the hosted staging backend with separate staff roles and touch counts. |
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
- The staging branch contains `08e76ef` (session policy), `2f7b334` (server-side idle guard), `2ad6b95` (migration ID aligned to staging history) and `a9c50fb` (active v12 TOT/VAT regression). GitHub Actions run #44 passed 251 checks and mocked Chromium UAT on `a9c50fb`. Supabase v12 v43 is active and migration `20261103172501` is applied. Branch head `7e08c78` passed run #47, and Pages deployment `a06d332d` now serves build 03.4, matching source; hosted sign-in succeeded on 3 November 2026. Do not mark role-based login or end-to-end UAT aligned until separate-role browser/API acceptance is verified.

No production database, function, frontend, DNS, user, credential or data was changed during this status review.
