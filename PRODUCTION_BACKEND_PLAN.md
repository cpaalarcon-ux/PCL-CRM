# PCL Nexus: production backend plan

Status: updated 18 November 2026. The 14 November observations below are historical where they differ from [the current production release review](PRODUCTION_RELEASE_REVIEW_2026-11-18.md). A separate production Supabase project now exists, but it is empty: no schema, function, secrets or staging data have been copied. This file does not approve a production release.

## Decision

A separate production Supabase project (own database, storage, keys and secrets) and a separate Cloudflare Pages project, with the same migrations and Edge Function code as staging. No staging data is copied: it is all fictional, so production starts empty. Region: Mumbai (`ap-south-1`), pending the data-protection adviser's confirmation of the transfer basis. A project's region cannot be changed later.

## What staging is today

| Part | State |
|---|---|
| Database | Supabase `pcl-erp-staging` (`yfjiculexbzpkvtapudk`, `ap-south-1`), 191 migrations, 242 tables in the private `erp_private` schema, 550 functions, 13 pg_cron jobs created by migrations. |
| Server | One Edge Function, `staff-workspace-v12`, deployed with `--no-verify-jwt`; it authenticates every action itself. |
| Files | Private bucket `staff-pilot-private`; migration `20261114100000_private_evidence_bucket.sql` creates it where missing. |
| Web | Cloudflare Pages `pcl-crm`: production deployment is `main`; other branches get public previews. |
| Deploy | Push to `deploy/staging-backend` runs the staging workflow (hard-coded to the staging project). |

## What the repository now provides

- `scripts/build-site.mjs` and `environments/*.json`: build the staff app for one environment from only the files it loads, swap in that environment's project address and publishable key, redirect `/` to `/staff-pilot`, and refuse a production build that is a placeholder or still names staging.
- Server settings `PCL_SITE_ORIGIN` and `PCL_ALLOWED_ORIGINS` for setup links and allowed browser origins. Staging keeps its addresses as the default; any other project with no settings issues no setup links and allows no browser origin.
- `.github/workflows/production-backend-deploy.yml`: manual start, typed confirmation (`DEPLOY TO PRODUCTION`), approval from the GitHub `production` environment, tip of `main` only, refuses the staging project, needs green staging checks on the same commit, sets the two server settings (refusing staging addresses) before the function goes live, uses its own secrets, and dry-runs migrations.
- `supabase/bootstrap/first-partner.sql`: one guarded statement that creates the firm, the first Partner in "Pending setup" with firm-wide access, and one 24-hour single-use setup link. It refuses to run if any staff record exists.
- Tests for the build, the workflow and the bootstrap (`tests/environment_build.test.mjs`, `tests/production_workflow.test.mjs`, `tests/first_partner_bootstrap.test.mjs`).
- An empty-database replay of all 191 migrations matched staging (tables, functions, jobs, bucket, extensions).

## Owner steps (no one else can do these)

1. Decide region, plan (Pro with daily backups; add point-in-time recovery if a day of lost work is unacceptable), named system administrator and recovery targets; get the adviser's confirmation for the chosen region.
2. Create the production Supabase project in the firm-owned organisation. Choose the database password yourself; it goes only into a GitHub secret.
3. Create a new Supabase access token for production deploys (not the staging one).
4. In the GitHub `production` environment (reviewer and origin variables already set): add variable `PROD_PROJECT_REF` and secrets `PROD_SUPABASE_ACCESS_TOKEN`, `PROD_SUPABASE_DB_PASSWORD`.
5. Give the project reference and publishable key (public by design) so `environments/production.json` can be filled in. Never share secret keys or passwords in chat or in the repository.
6. Run the first-Partner bootstrap once in the production SQL editor and give the setup link to the named Partner.
7. Later, with the Partner's written release decision: move the staging line onto `main`, then point `pcl.phamalarcon.com` at the production Pages project (the old `pcl-crm` project must release it first; change only that one DNS record, never mail records).

## Go-live gates (all before real client data)

- Test suite and browser UAT green on the release commit; empty-database replay passed.
- Fictional-client guard off; no "Testing" tax rate relied on for a real client (the Tax Lead verifies and approves each rate; a new database seeds all rates as Draft).
- Anonymous access, expired sessions, other clients' identifiers, self-approval, locked periods and duplicate uploads are refused when called directly against the production API.
- A restore of database and files is done and timed. Database backups do not include stored file bytes, so files need their own backup.
- Build label, security headers and sign-in verified on the production URL; a setup link opens the production site, not staging.
- A named owner for failed jobs, backups and access changes.
- The adviser has signed off the transfer basis (and whether any local copy in Kenya is required); consent wording is in client forms and staff contracts.

## Open items

- Tax Lead: confirm the testing rates and the 2027 COMPUTER rate.
- Decide whether production launches without case kinds for housing levy, NSSF, SHIF and individual income tax.
- The staging Supabase access token expires on 7 December 2026.
- The set-up guide status check takes 30 to 40 seconds on staging.
- Every non-`main` branch gets a public Cloudflare preview of the whole repository, including SQL.
