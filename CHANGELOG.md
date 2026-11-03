# Changelog

## 2026-11-03 — Current staging reconciliation at `a9c50fb`

- The authorized branch `backend/staging-foundation` contains the reconciled session policy, server-side idle guard, migration-history identifier and active v12 TOT/VAT regression commits: `08e76ef`, `2f7b334`, `2ad6b95`, `a9c50fb`.
- Supabase `staff-workspace-v12` is active at version 43; migration `20261103172501_enforce_idle_timeout_server_side` is applied. GitHub Actions [run #44](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41685064617) passed 251 checks and a Chromium flow against a local test server with a mocked backend.
- The hosted Pages screen was last observed at build `2026-11-03.2`; source is `2026-11-03.4`. No staff credentials were entered and hosted login/role UAT is not verified.
- The first documentation reconciliation run (#45) failed because a coverage test still asserted the prior UAT wording and run #40 count. The assertion was updated to check the current UAT wording and run #44/251 evidence; #45 failed before Chromium and does not establish hosted or runtime acceptance.
- KYC screen integration, general mapping-approval reconciliation, downstream dependency-generated tasks, template parity, complete hosted client-to-audit-pack UAT and rule-owner sign-off remain open. Production is held.
- Earlier same-day entries below are historical snapshots; use [ERP alignment control](supabase/ERP_ALIGNMENT_CONTROL.md) and [Release 0 status](supabase/RELEASE0_STATUS_2026-11-03.md) for current disposition.


## 2026-11-03 — Alignment reconciliation candidate (historical snapshot; superseded above)

- Reconciled current staging documentation around one source of truth for onboarding, KYC, dated activity/obligation dependencies, import controls, TOT/VAT/MRI treatment, Gates A–C and audit staging evidence. Older V6/V7 deployment and session descriptions are marked historical.
- Aligned the local staff session implementation and UI to a 30-minute inactivity timeout plus manual sign-out, including server metadata, browser cache keys, regression coverage and the current UAT case.
- Added one end-to-end UAT case from PIN-based onboarding through a Gate C audit staging pack. It remains **Not checked** until run with separate fictional staging roles.
- Local verification: `npm test` passes 249/249; `git diff --check`, JavaScript syntax checks and Python compile pass. Staging publication/deployment and hosted staff login are still pending for this candidate.
- The active KYC UI still uses the legacy evidence-link path, general account mappings still have a separate approval action, and PR #11 remains excluded pending selective reconciliation. Production remains held.

## 2026-11-03 — Staging foundation status (historical snapshot; superseded above)

- Reconciled the root README and rollout plan with the connected staging environment and marked the browser-local prototype descriptions as historical.
- Added an evidence-based Release 0 status table for WP1.1–WP1.7 and a WP0–WP3 disposition. Items without evidence remain unverified or not built.
- Recorded staging project, migration, Edge Function, private bucket, RLS and release-check state. Production remains held.
- Added automated access-registry and fail-closed route checks; GitHub Actions run [#38](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41655214804) passes 249/249 checks and a Chromium flow using a mocked backend. These checks do not substitute for role-based hosted UAT or the five end-to-end workflows.
- The staging access guard is deployed as `staff-workspace-v12` version 42 from commit `d43b6ca`. Staging code snapshot `1305f59` is on the restored branch; the connected page was reloaded and now serves build `2026-11-03.2`. Hosted role-based UAT remains open.
- Restored the full staging repository tree after an erroneous build-label commit reduced the branch tree to one file. The staging branch now has 330 entries; the prior tested code and the `.2` build label are preserved.
- Production was not changed. Keep production held until WP0–WP3 and the stated release gates are verified and approved.
