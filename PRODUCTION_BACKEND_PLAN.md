# PCL Nexus: production backend plan

**Status:** 18 November 2026. The preliminary release review is in [PRODUCTION_RELEASE_REVIEW_2026-11-18.md](PRODUCTION_RELEASE_REVIEW_2026-11-18.md). It records migration findings and current blockers; it is not a production release approval. Draft PR #291 remains open against `main` and has been refreshed from the latest staging source commit.

## Decision and production project

Use a separate production Supabase project and separate Cloudflare Pages project, while keeping the staging project in the existing organization. The production Supabase project `pcl-erp-production` (`tafrrmcxrsorffkonrxq`) is Active/Healthy in Mumbai (`ap-south-1`) under the existing Pro organization. The user approved the quoted additional project cost of $10/month.

Production starts empty. No staging data is copied. No production schema, migrations, Edge Function or secrets have been applied by the release-review preparation. The Mumbai/data-transfer basis still requires written confirmation from the firm’s data-protection adviser before real client data is stored.

## Current environments

| Part | Current state |
|---|---|
| Staging database | Supabase `pcl-erp-staging` (`yfjiculexbzpkvtapudk`, `ap-south-1`); the current ledger lists 247 migrations, through `20261129100000_support_schedules`. |
| Future migration IDs | 20 staging versions are dated after 18 November 2026. They are preserved as applied version identifiers. See the release review for the full list and safe replay rule. |
| Production database | Supabase `pcl-erp-production` (`tafrrmcxrsorffkonrxq`); migration ledger is empty. |
| Production app config | `environments/production.json` still has placeholders for the project reference and publishable key. |
| Backend | The production workflow targets `staff-workspace-v12`, checks the exact `main` tip, requires typed confirmation and protected-environment approval, checks staging runs on the same commit and performs a migration dry-run before applying. |
| Web | A separate PCL Nexus production Pages project exists, but the canonical production hostname/custom-domain connection is not complete. The previous `pcl-crm` and legacy host must be handled carefully during cutover; do not change mail records. |
| Release checks | Latest staging source is `aab4245` (Build 2890, PR #297). Its hosted check (run `44312657819`) and browser UAT (run `44312657658`) both passed. The workflow-gate follow-up PR #295 also passed its full regression suite and browser UAT. |

## Repository and migration preparation

The staging source branch is `backend/staging-foundation` at `aab4245a7a294de73d98f64e6dc0cd924491efbf`. It is 536 commits ahead of `main`; draft PR #291 carries two release-review commits and therefore represents a broad ERP release that needs review across the full diff.

The production build tooling, per-environment configuration, origin checks, protected production workflow and guarded first-Partner bootstrap are present in the staging source. The earlier clean replay covered a 191-migration snapshot; it does not establish that the current 247-migration snapshot replays cleanly.

**Migration rule:** Do not retimestamp or rename migrations already applied in staging. On the empty production project, review a dry-run against the final release commit and confirm all 247 expected versions are pending in ascending order. Replay that exact set on a disposable empty database, then compare schema objects, functions, extensions, scheduled jobs and private storage configuration. Stop on any missing, skipped, duplicated or out-of-order version. No production dry-run or schema replay has been run for this release review.

## Owner steps

1. Obtain written data-residency/transfer advice for Mumbai and confirm whether local Kenyan storage or another control is required before entering real client data.
2. Complete the draft PR review and confirm hosted and browser UAT on the exact final release commit, including assistant, manager and partner role checks with staging-only test accounts. The latest staging hosted and browser checks on `aab4245` passed; the role-specific release verification still needs explicit confirmation.
3. Run the release test suite and the full empty-database replay on the final release commit. Record the exact migration list and comparison results in the PR.
4. Confirm the production hostname and attach it to the PCL Nexus Pages project only after a successful production web build. Preserve email-related DNS records during cutover.
5. After the release gates and a separate written release decision, add `PROD_PROJECT_REF`, `PROD_SITE_ORIGIN`, `PROD_ALLOWED_ORIGINS`, `PROD_SUPABASE_ACCESS_TOKEN` and `PROD_SUPABASE_DB_PASSWORD` to the protected GitHub `production` environment. Keep passwords and tokens there only; never put them in the repository or chat.
6. Run the guarded first-Partner bootstrap once after the production schema is deployed, then securely deliver its single-use setup link to the named Partner.

## Go-live gates

- The draft PR has a complete code review, resolved comments and green required checks.
- The full 247-migration set dry-runs and replays successfully against a disposable empty database; production’s first dry-run matches that reviewed set.
- Anonymous access, expired sessions, cross-client access, self-approval, locked-period edits and duplicate uploads are refused by direct API checks.
- Supabase security findings are reviewed and remediated; table and private-document access is verified by firm, client, role and assignment.
- A database and private-file restore is completed and timed. Database backups do not include stored file bytes.
- Production build, HTTPS, security headers, sign-in, setup links, custom domain and error monitoring are verified.
- A named owner is assigned for failed jobs, backups, restores and access changes.
- Data-transfer advice is documented before any real client data is loaded.

## Open decisions and follow-up

- Confirm the data-residency basis for the Mumbai region.
- Confirm the public production hostname.
- The server/page build mismatch and sign-in warning were reported on older commit `0e06d26`; later hosted checks, including the latest on `aab4245`, passed. Confirm role-specific access and approval checks on the exact final release head before closing this gate.
- Confirm the current tax-rule approvals and required payroll/tax case coverage before real work begins.
- Confirm backup retention and recovery time/point objectives; test the restore process.

**Current disposition:** Keep the candidate PR draft. Production secrets and schema remain untouched until the release review, UAT and migration replay gates are complete.