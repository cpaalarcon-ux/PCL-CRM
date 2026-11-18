# PCL Nexus: production backend plan

**Updated 19 November 2026.** [Draft PR #291](https://github.com/cpaalarcon-ux/PCL-CRM/pull/291) targets `main`. Follow the [release review](PRODUCTION_RELEASE_REVIEW_2026-11-18.md) for current evidence, remaining checks and the proposed 20 November merge window.

## Decision and production project

Use a separate production Supabase project and separate Cloudflare Pages project, while keeping the staging project in the existing organization. The production Supabase project `pcl-erp-production` (`tafrrmcxrsorffkonrxq`) is Active/Healthy in Mumbai (`ap-south-1`) under the existing Pro organization. The user approved the quoted additional project cost of $10/month.

Production starts empty. No staging data is copied. No production schema, migrations, Edge Function or secrets have been applied by the release-review preparation. The Mumbai/data-transfer basis still requires written confirmation from the firm’s data-protection adviser before real client data is stored.

## Current environments

| Part | Current state |
|---|---|
| Staging database | Supabase `pcl-erp-staging` (`yfjiculexbzpkvtapudk`, `ap-south-1`); the current ledger lists 249 migrations, through `20261201100000_report_notes_and_packs`. |
| Future migration IDs | 22 staging versions are dated after 18 November 2026. They are preserved as applied version identifiers. See the release review for the full list and safe replay rule. |
| Production database | Supabase `pcl-erp-production` (`tafrrmcxrsorffkonrxq`); migration ledger is empty. |
| Production app config | `environments/production.json` still has placeholders for the project reference and publishable key. |
| Backend | The production workflow targets `staff-workspace-v12`, checks the exact `main` tip, requires typed confirmation and protected-environment approval, checks staging runs on the same commit and performs a migration dry-run before applying. |
| Web | A separate PCL Nexus production Pages project exists, but the canonical production hostname/custom-domain connection is not complete. The previous `pcl-crm` and legacy host must be handled carefully during cutover; do not change mail records. |
| Release checks | Build 2892 (`299b599`, PR #300) passed hosted smoke, regression and browser UAT. The hosted run skipped signed-in role checks. All 249 candidate migrations replayed on a fresh local Supabase stack. |

## Repository and migration preparation

The staging source branch is `backend/staging-foundation` at `299b599530117af03d960049fedd1a6c404a3a60`. It is 539 commits ahead of `main`. Draft PR #291 carries the staging application plus review and deployment preparation.

The production build tooling, per-environment configuration, origin checks, protected production workflow and guarded first-Partner bootstrap are present in the staging source. The clean replay succeeded for the 249 migrations. The schema, functions, extensions, jobs and private storage comparison against staging is pending.

Preserve the applied staging migration identifiers. For the first production deployment, confirm the dry-run lists all 249 expected versions in ascending order. Stop if a version is missing, skipped, duplicated or out of order. This review used a disposable database.

## Owner steps

1. Obtain written data-residency/transfer advice for Mumbai and confirm whether local Kenyan storage or another control is required before entering real client data.
2. Complete the draft PR review and attach staging acceptance evidence from the Assistant, Manager and Partner on the agreed build. After the approved merge, manually run both required checks on the resulting `main` commit.
3. Confirm the final release carries the exact 249 replayed migrations and record the staging parity comparison in the PR.
4. Before merging, verify how the legacy Pages project handles `main` and confirm the cutover sequence. Attach the approved production hostname to the PCL Nexus Pages project after a successful production web build. Preserve email-related DNS records during cutover.
5. After the release gates and a separate written release decision, add `PROD_PROJECT_REF`, `PROD_SITE_ORIGIN`, `PROD_ALLOWED_ORIGINS`, `PROD_SUPABASE_ACCESS_TOKEN` and `PROD_SUPABASE_DB_PASSWORD` to the protected GitHub `production` environment. Keep passwords and tokens there only; never put them in the repository or chat.
6. Run the guarded first-Partner bootstrap once after the production schema is deployed, then securely deliver its single-use setup link to the named Partner.

## Go-live gates

- The draft PR has a complete code review, resolved comments and green required checks.
- The 249-migration replay passed on a disposable database. Production’s first dry-run must match the reviewed set.
- Anonymous access, expired sessions, cross-client access, self-approval, locked-period edits and duplicate uploads are refused by direct API checks.
- Supabase security findings are reviewed and remediated; table and private-document access is verified by firm, client, role and assignment.
- A database and private-file restore is completed and timed. Database backups do not include stored file bytes.
- Production build, HTTPS, security headers, sign-in, setup links, custom domain and error monitoring are verified.
- A named owner is assigned for failed jobs, backups, restores and access changes.
- Data-transfer advice is documented before any real client data is loaded.

## Open decisions and follow-up

- Confirm the data-residency basis for the Mumbai region.
- Confirm the public production hostname.
- The server/page build mismatch and sign-in warning were reported on older commit `0e06d26`; the Build 2892 hosted check passed. Confirm role-specific access and approval checks before closing this gate.
- Confirm the current tax-rule approvals and required payroll/tax case coverage before real work begins.
- Confirm backup retention and recovery time/point objectives; test the restore process.

Keep the PR in draft until the release review and role sign-off are recorded. The 20 November merge and production deployment require their release decisions.
