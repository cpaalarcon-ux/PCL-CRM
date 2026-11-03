# Changelog

## 2026-11-03 — Staging foundation status

- Reconciled the root README and rollout plan with the connected staging environment and marked the browser-local prototype descriptions as historical.
- Added an evidence-based Release 0 status table for WP1.1–WP1.7 and a WP0–WP3 disposition. Items without evidence remain unverified or not built.
- Recorded staging project, migration, Edge Function, private bucket, RLS and release-check state. Production remains held.
- Added automated access-registry and fail-closed route checks; GitHub Actions run #36 passes 249/249 checks and a Chromium flow using a mocked backend. These checks do not substitute for role-based hosted UAT or the five end-to-end workflows.
- The staging access guard was subsequently deployed as `staff-workspace-v12` version 42 from commit `d43b6ca`. The current Pages deployment still serves build `2026-11-03.1` while the staging branch source is `2026-11-03.2`; frontend deployment and role-based hosted UAT remain open.
- Production was not changed. Keep production held until WP0–WP3 and the stated release gates are verified and approved.
