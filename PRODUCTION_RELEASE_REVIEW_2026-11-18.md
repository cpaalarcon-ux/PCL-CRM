# PCL Nexus production release review

**Review date:** 18 November 2026 (Africa/Nairobi)  
**Status:** Draft release review — not a production deployment approval  
**Purpose:** Record the future-version migration resolution and current release gates before production secrets or schema are applied.

## Candidate source

| Item | Verified value |
|---|---|
| Repository | `cpaalarcon-ux/PCL-CRM` |
| Candidate branch | `release/pcl-nexus-reviewed-2026-11-18` |
| Source staging branch | `backend/staging-foundation` |
| Source staging commit | `aab4245a7a294de73d98f64e6dc0cd924491efbf` (Build 2890, latest staging head) |
| Main base | `c7ccf3f4e586da8060ed89eeeb2fe1b188aec088` |
| Change size to main | 538 commits ahead, 0 behind (536 from staging plus two release-review commits) |
| Proposed review | Draft PR to `main`; the candidate includes the whole staging release, not only this review note |

The PR is intentionally draft. It needs a full code and product review because the staging-to-main change is a broad release. This note records readiness evidence; it does not claim that every ERP feature has passed UAT.

## Future-dated migration resolution

The staging database currently lists 247 migrations. The newly created production project `pcl-erp-production` (`tafrrmcxrsorffkonrxq`, Mumbai `ap-south-1`) is Active/Healthy and its migration ledger is empty. No production schema has been applied.

Twenty staging migration version IDs are dated after the review date. These are version identifiers, not scheduled execution dates:

| Version | Migration |
|---|---|
| `20261120100000` | `itax_profile_fields` |
| `20261121100000` | `mlro_aml_profile` |
| `20261121110000` | `aml_service_scope` |
| `20261121120000` | `fuel_gas_pack` |
| `20261121130000` | `evidence_folders` |
| `20261121140000` | `setup_baselines` |
| `20261121150000` | `drop_setup_baselines` |
| `20261121160000` | `engagement_scope` |
| `20261121170000` | `aml_restricted_reports` |
| `20261121180000` | `client_understanding` |
| `20261121190000` | `licence_accounts` |
| `20261122110000` | `partner_profit_shares` |
| `20261122120000` | `period_note_sets` |
| `20261123100000` | `period_audit_lock` |
| `20261124110000` | `p9_releases` |
| `20261125100000` | `standard_wording` |
| `20261126100000` | `ppe_register` |
| `20261127120000` | `settings_approval_batches` |
| `20261128100000` | `client_pages` |
| `20261129100000` | `support_schedules` |

**Resolution:** Keep these version IDs and filenames unchanged. Migrations `20261127120000` and `20261128100000` were already applied to staging before the 29 November support-schedules migration was added. Rewriting or renaming an applied migration would make the repository disagree with the staging migration ledger. The production database is empty, so its first replay should apply the release’s complete migration set in ascending version order.

**Required before any production apply:** Use the exact reviewed release commit against a disposable empty database; confirm the dry-run enumerates the complete expected set (247 migrations for the current snapshot), then replay and compare the resulting schema, functions, extensions, jobs and private storage setup with the expected staging state. Stop if the migration tool reports missing, skipped, duplicate or out-of-order versions. The current production workflow performs a dry-run before its apply step; its output must be reviewed before an approved manual run. No production dry-run or replay was run for this review.

## Staging checks observed on the refreshed source

For latest staging source commit `aab4245a7a294de73d98f64e6dc0cd924491efbf` (Build 2890, PR #297), GitHub Actions reports:

- **Staging hosted check:** passed (run `44312657819`).
- **Staging browser UAT:** passed (run `44312657658`), including the full automated regression suite and browser workflow.
- **Workflow-gate follow-up PR #295:** its full regression and browser UAT passed; the 11 focused workflow tests and server-wiring checks also passed locally.
- The current staging source includes the workflow-gate corrections merged in PRs #294 and #295.

PR #291 adds two release-review commits on top of this staging snapshot. Keep it draft until the exact candidate head has been reviewed and role-specific checks for assistant, manager and partner have been confirmed with staging-only accounts. The latest staging checks are green, but do not infer untested role coverage from the overall workflow result.

## Production boundary and remaining configuration

- The production Supabase project is in the existing Pro organization; the user approved the quoted additional project cost of $10/month.
- The production migration ledger is empty. No production migrations, Edge Function or production secrets were applied by this review.
- `environments/production.json` still contains placeholders. The production project reference and publishable key need to be configured separately; no private keys or passwords belong in that file or in this review.
- GitHub production environment secrets and origin variables are not being configured in this step.
- The production hostname and Cloudflare Pages custom-domain attachment are still pending. Do not change mail DNS records during the eventual cutover.
- The Mumbai region/data-transfer basis still needs the firm’s data-protection adviser’s written confirmation before real client information is stored.

## Release gates before schema application

1. Review the entire staging-to-main code diff and resolve all PR comments.
2. Confirm hosted and browser UAT on the exact final release PR head and verify assistant, manager and partner role checks. The latest staging checks passed; role-specific coverage on the release head remains to be confirmed.
3. Run the release tests and the empty-database migration replay; attach the results to the PR.
4. Review Supabase security findings and verify firm, client, role, assignment and document-storage isolation.
5. Complete and time a database-and-files restore drill; database backups do not include private file bytes.
6. Obtain the data-residency approval and confirm the production hostname and cutover plan.
7. Only after these gates and a separate written release decision should production credentials be added to the protected GitHub environment and the production workflow be manually approved and run.

**Current disposition:** Keep PR #291 as a draft. The future-dated IDs are preserved and production remains untouched. Hosted and browser checks passed on latest staging Build 2890; complete review and role-specific verification on the exact release head before any production release decision.