# PCL Nexus production release review

**Updated 19 November 2026, Africa/Nairobi.** The proposed merge window is Friday, 20 November 2026. The Engagement Partner makes the release decision after the outstanding checks are recorded.

## Candidate

| Item | Value |
|---|---|
| Release PR | [Draft PR #291](https://github.com/cpaalarcon-ux/PCL-CRM/pull/291), targeting `main` |
| Application source | `299b599530117af03d960049fedd1a6c404a3a60` on `backend/staging-foundation`, Build 2892 |
| Main base | `c7ccf3f4e586da8060ed89eeeb2fe1b188aec088` |
| Release size | Staging contributes 539 commits and changes 1,326 files against the current `main`. The release branch also carries review documents, deployment workflow corrections and their regression test. |

The updates after Build 2890 reconcile the staging migration ledger, simplify project activation and add the four-sheet purchases template and multi-month sales workflow. The draft keeps the Build 2892 application and migrations as tested on staging.

## Evidence and open checks

| Check | Result |
|---|---|
| Regression and browser UAT | **Passed** on Build 2892. All 1,751 regression tests passed and the browser UAT job passed. [Run 44382818372](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44382818372) |
| Hosted staging smoke check | **Passed** on Build 2892. Page and server labels matched. Anonymous access to a protected action was refused and Chromium found the sign-in page ready. [Run 44382818313](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44382818313) |
| Authenticated release acceptance | **Pending.** The hosted run skipped Assistant, Manager and Partner checks because the staging test credentials were unset. Attach sign-off from the staff tests on the agreed build, including maker-checker and role-scope results. |
| Empty-database migration replay | **Passed for the candidate migration files.** A clean, unlinked local Supabase reset applied all 249 versions in order. The reset log order matches the candidate filenames and the complete migration tree is identical to Build 2892. [Run 44344081974](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44344081974) |
| Broad release review | **In progress.** Reviewed the post-2890 scope, production deployment and build controls, first-Partner bootstrap and migration history. Full application diff sign-off, database object parity with staging, and final security and private-file isolation evidence are open. |
| Production launch preparations | **Open.** The production web build still requires its public project configuration. Verify the legacy Pages connection to `main` before merging. The approved production hostname, timed database and private-file restore, and written Mumbai data-transfer decision are also outstanding. |

## Migration order

Preserve the 249 applied staging migration identifiers through `20261201100000_report_notes_and_packs`. The ledger includes these 22 versions with identifiers later than 18 November 2026. The identifiers control replay order.

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
| `20261130100000` | `partner_equity` |
| `20261201100000` | `report_notes_and_packs` |

Confirm the first production dry-run matches the reviewed order before applying schema. Compare the replayed schema, functions, extensions, scheduled jobs and private storage with staging. The replay used a disposable database and no production dry-run has been performed.

## Merge and launch sequence

1. Keep the PR in draft until the application review and role sign-off are recorded. Confirm whether the legacy Cloudflare Pages project would publish the `main` merge to the current hostname, and put the approved cutover arrangement in place before merging.
2. Record the Engagement Partner’s release decision. On an approved merge, manually run **Staging browser UAT** and **Staging hosted check** on the resulting `main` commit. The draft enables manual dispatch of the hosted check and verifies production site addresses before database work. Both exact-commit checks must pass.
3. Obtain the separate production deployment approval. Use the protected production environment, verify the production migration dry-run and web build, and complete the cutover and live smoke checks before users start live work.

Production schema, secrets, deployment and DNS were untouched during this review.
