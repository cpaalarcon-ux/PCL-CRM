# PCL Nexus production release review

**Updated 20 November 2026, 04:00 Africa/Nairobi.** The Engagement Partner makes the release decision after the outstanding checks are recorded. No production schema, secret, deployment or DNS change has been made.

## Candidate

| Item | Value |
|---|---|
| Release PR | [Draft PR #291](https://github.com/cpaalarcon-ux/PCL-CRM/pull/291), targeting `main` |
| Application source | `469c2be83f288b593f3df6e7300f5774c4a25b21` on `backend/staging-foundation`, Build 2906 (PR #315, granular access rights), merged into this branch |
| Main base | `ec16dc64563e7fef96d801a81f18a22d1c1878b0` (public Build 2905 changelog only), merged into this branch |
| Release size | 562 commits and 1,383 changed files against `main`. Beyond staging, the branch carries review documents, deployment workflow corrections, their regression test and the production project reference. |
| Changelog | The public client changelog from `main` is kept as `CHANGELOG.md` and still describes Build 2905. The Build 2906 entry needs the Partner's wording. The older internal changelog is kept unchanged as `supabase/STAGING_CHANGELOG_HISTORY.md`. |

Build 2906 adds per-function access switches on top of the existing area, role, record-scope and workflow checks. It narrows access only, adds no migration, and has not yet been tried on live screens by role.

## Evidence and open checks

| Check | Result |
|---|---|
| Regression, browser UAT, hosted check and staging deploy | **Passed** on `469c2be`: [Staging browser UAT](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44633565017), [Staging hosted check](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44633565002), [Staging backend deploy](https://github.com/cpaalarcon-ux/PCL-CRM/actions/runs/44633630263). These are the staging commit, not the merged release commit. They must be run again on the resulting `main` commit. |
| Authenticated release acceptance | **Pending.** The hosted run skips Assistant, Manager and Partner checks because the staging test credentials are unset. Attach sign-off from the three role tests on Build 2906, including maker-checker and role-scope results. |
| Empty-database migration replay | **Passed** for all 253 versions on this branch's staging commit, in order, on a disposable local Postgres with the auth schema stubbed (332 private tables, row security on every one). This is a local replay, not a Supabase reset. The production ledger is empty and no production dry-run has been performed. |
| Production web build | **Passed locally** with `environments/production.json`: 188 files built for project `tafrrmcxrsorffkonrxq`, and no trace of the staging project, key or address in the output. |
| Broad release review | **In progress.** Reviewed the post-2905 scope (Build 2906 rights module and server checks), the production deployment and build controls and the migration history. Full application diff sign-off, schema, function, extension and private-storage parity with staging, and final private-file isolation evidence are open. |
| Cloudflare merge prerequisite | **Blocked.** The `pcl-crm` Pages project has automatic production deployment from `main` enabled, serves `pcl.phamalarcon.com` and publishes the repository root. Pause legacy production auto-deploy under the approved cutover plan and verify the existing deployment remains active before merging. |
| Production launch preparations | **Open.** The separate `pcl-nexus-production` Pages project runs the isolated production build. The approved production hostname, the timed database and private-file restore, the written Mumbai data-transfer decision, the two production secrets in the GitHub environment and the required reviewer are outstanding or unverified from this branch. |

## Migration order

Preserve the 253 applied staging migration identifiers through `20261204120000_messenger_attachments`. The ledger includes these 22 versions dated 20 November 2026 or later, and three more after them (`20261202100000_client_routing_alias`, `20261203100000_upload_summary_views`, `20261204100000_staff_form_drafts`) plus `20261204120000_messenger_attachments`. The identifiers control replay order.

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

Confirm the first production dry-run matches the reviewed order before applying schema. Compare the replayed schema, functions, extensions, scheduled jobs and private storage with staging. The replay used a disposable database and no production dry-run has been performed. Note: the version prefixes in the table below are the repository file versions; the staging ledger is the authority.

## Merge and launch sequence

1. Keep the PR in draft until the application review and role sign-off are recorded. Pause automatic production deployments on the legacy Pages project as part of the approved cutover. Verify the existing site remains active at its current domain before proceeding with the merge.
2. Record the Engagement Partner’s release decision. On an approved merge, manually run **Staging browser UAT** and **Staging hosted check** on the resulting `main` commit. The draft enables manual dispatch of the hosted check and verifies production site addresses before database work. Both exact-commit checks must pass.
3. Obtain the separate production deployment approval. Use the protected production environment, verify the production migration dry-run and web build, and complete the cutover and live smoke checks before users start live work.

Production schema, secrets, deployment and DNS were untouched during this review.
