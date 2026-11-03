# Changelog

## 2026-11-03 — Alignment reconciliation candidate

- Reconciled current staging documentation around one source of truth for onboarding, KYC, dated activity/obligation dependencies, import controls, TOT/VAT/MRI treatment, Gates A–C and audit staging evidence. Older V6/V7 deployment and session descriptions are marked historical.
- Aligned the local staff session implementation and UI to a 30-minute inactivity timeout plus manual sign-out, including server metadata, browser cache keys, regression coverage and the current UAT case.
- Added one end-to-end UAT case from PIN-based onboarding through a Gate C audit staging pack. It remains **Not checked** until run with separate fictional staging roles.
- Local verification: `npm test` passes 249/249; `git diff --check`, JavaScript syntax checks and Python compile pass. Staging publication/deployment and hosted staff login are still pending for this candidate.
- The active KYC UI still uses the legacy evidence-link path, general account mappings still have a separate approval action, and PR #11 remains excluded pending selective reconciliation. Production remains held.

## 2026-11-03 — Staging foundation status

- Reconciled the root README and rollout plan with the connected staging environment and marked the browser-local prototype descriptions as historical.
- Added an evidence-based Release 0 status table for WP1.1–WP1.7 and a WP0–WP3 disposition. Items without evidence remain unverified or not built.
- Recorded staging project, migration, Edge Function, private bucket, RLS and release-check state. Production remains held.
- Added automated access-registry and fail-closed route checks; GitHub Actions run [#38](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/41655214804) passes 249/249 checks and a Chromium flow using a mocked backend. These checks do not substitute for role-based hosted UAT or the five end-to-end workflows.
- The staging access guard is deployed as `staff-workspace-v12` version 42 from commit `d43b6ca`. Staging code snapshot `1305f59` is on the restored branch; the connected page was reloaded and now serves build `2026-11-03.2`. Hosted role-based UAT remains open.
- Restored the full staging repository tree after an erroneous build-label commit reduced the branch tree to one file. The staging branch now has 330 entries; the prior tested code and the `.2` build label are preserved.
- Production was not changed. Keep production held until WP0–WP3 and the stated release gates are verified and approved.
