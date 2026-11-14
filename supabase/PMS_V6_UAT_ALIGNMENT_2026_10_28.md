# PCL PMS v6.0 alignment and UAT release gate

**Date:** 28 October 2026
**Purpose:** Track how the attached PCL PMS v6.0 Testing Firm, Multi-Tenant, Subscription and UAT Plan aligns with the current staging source and what still needs hosted evidence. This document does not approve production.

> **Historical checkpoint — 28 October 2026.** This register predates the current staging candidate. Its branch, run, frontend and function-version references are historical; use [ERP alignment control](ERP_ALIGNMENT_CONTROL.md), [Release 0 status](RELEASE0_STATUS_2026-11-03.md) and [Full ERP staff UAT](FULL_ERP_STAFF_UAT.md) for current build evidence and workflow rules. Current branch candidate `a9c50fb` passed run #44 (251 checks plus mocked Chromium UAT); hosted role-based UAT remains open. This file remains useful for PMS-specific tenant and subscription gaps, which are not claimed as implemented.

## Release position

The current product is a **single PCL ERP workspace with access scoped by handling firm, client, project and staff assignment**. The current database and access rules use firm-level identifiers such as `firm_id` and `handling_firm_id`. That is useful firm access control, but it is **not a separate subscribing-practice tenant boundary**.

The reviewed migrations do not provide a tenant model or SaaS subscription lifecycle. Do not label the current workspace as multi-tenant SaaS-ready, do not treat a “Testing Firm” firm record as tenant isolation, and do not use subscription status to grant access until those server-side controls have been built and tested. The PCL, ACPA and ACL legal issuing firms remain separate from any future subscribing-practice tenant.

This is a staging/UAT release only. The banner must say **“STAGING ONLY — DO NOT FILE OR SEND.”** Staff should use approved fictional test records. A published staging build is not production approval, completed UAT, or proof of integrations.

## Current change alignment

| Area | Alignment in staging source | Release status |
|---|---|---|
| Staff orientation | Home links expose the workspace areas, including Audit & assurance. Role restrictions remain visible. | Existing branch scope; staff familiarisation still required. |
| Review summary | Label states that the count covers task, tax and sales reviews. It explicitly says journal and asset reviews are not included. | Local UI change; UAT not run. |
| Reconciliation alert | Label now matches the displayed sales and bank reconciliation controls. | Local UI change; UAT not run. |
| Staging warning | Persistent workspace warning prohibits filing, payment and client communication from staging and calls for fictional records. | Local UI change; confirm the deployed environment and external integrations are safely disabled before staff use. |
| Opening trial balance | Six-column blank template: source account code/name, ERP routing code, ERP TB item code, debit and credit. The ERP fills routing from the TB item, captures source evidence once, and retains each Excel row reference. | Source is in the staging branch; targeted automated checks passed. The connected frontend deployment and staff UAT remain unverified. |
| 2025 opening figures | Use the 2025 closing balances as the 1 January 2026 opening basis only after source date, account mapping and closing reconciliation are approved. | **Blocked for the supplied workbook:** its sheet label conflicts with its reported year and its Difference in Books control is materially non-zero. Reconcile and approve the 2025 close before importing or posting. Do not use the comparative 2024 columns as the opening basis. |
| Client setup to project to mapping | Saved client business activity and dated inventory settings are intended to carry through to projects and purchase mapping; mapping must use the policy effective on each invoice date. | Existing connected workflow; verify with UAT cases below. |
| Purchase upload and credit notes | Use one standard template, treat row 1 as headers, leave unused optional cells blank, and capture original invoice number/date for credit notes. Keep invoice date separate from client VAT reporting month. | Existing connected workflow; verify upload, rounding, duplicate and tax-review controls in UAT. |
| TOT, VAT and daily records | TOT is treated as final on covered income, with no expense deductions or duplicate ordinary income-tax/instalment-tax task for that covered income. VAT is a separate obligation and can coexist with TOT when taxable supplies meet KRA's VAT threshold. The TOT case accepts supported daily gross-sales and daily-purchase registers and a total from the daily sales record, without requiring transaction-by-transaction bookkeeping in the TOT case; eTIMS invoicing remains a separate compliance requirement. | Local staging candidate updated; do not use for filing. Registration, applicability, client status, evidence and threshold must be confirmed. New release check `TOTVAT` remains **Not tested** until evidence-backed staff UAT and Tax Lead review. |
| Import deletion | Wrong uploads should be removed through confirmed, reasoned archive/soft-delete controls that preserve the source and audit trail. | Existing connected control; verify role limits and recovery/correction in UAT. |
| Recurring projects | Client service defaults and project periods should carry forward; pause, resume, end and period archive remain separate actions. | Existing connected workflow; test year-end transition and duplicate prevention. |
| Client invoicing and SaaS billing | Client invoices belong to the firm's Billing & WIP workflow. SaaS subscription invoices, plan entitlements and payment lifecycle belong to a future tenant subscription service. Recurring client invoice generation is still a separate follow-up. | Do not conflate the two billing types; subscription billing is not implemented. |
| My Work pagination | The current interface does not yet evidence true server-side cursor pagination at the plan's 25-row page size. | **Release gap:** implement and test before claiming the PMS pagination requirement is met. |
| Tenant isolation | No separate `tenant_id` boundary is evidenced across database records, object paths, search, exports, caches and jobs. | **Release blocker for multi-tenant Testing Firm or SaaS claims.** |
| Subscription lifecycle | No server-enforced trial, active, grace, suspended, cancellation, export or retention entitlement lifecycle is evidenced. | **Separate build required.** A practice-client invoice is not SaaS subscription billing. |

The opening-balance and dashboard changes are in the staging branch source. GitHub Actions run #38 passed 249 checks and a mocked Chromium flow. The connected frontend now serves build `2026-11-03.2`; staff browser/API UAT remains pending.

## PMS v6.0 acceptance register

Run these additions alongside [the full ERP staff acceptance plan](FULL_ERP_STAFF_UAT.md). The status below is an implementation assessment, **not a test result**.

| Test ID | Requirement and acceptance evidence | Current assessment |
|---|---|---|
| PMS-UAT-01 | **My Work:** load 1,500 assigned tasks; Home loads at most five priority items; My Work uses 25-row cursor pagination, indexed search and tenant scope. Verify stable next/previous navigation and correct totals. | Not ready: true server-side cursor pagination and tenant scope are not evidenced. |
| PMS-UAT-02 | **Review count:** compare the dashboard count to its underlying queues. The current label must disclose that it covers task, tax and sales reviews, excluding journal and asset reviews. | Source is in the staging branch and build `2026-11-03.2` is served; automated component coverage passed. Live dashboard UAT remains pending. |
| PMS-UAT-03 | **Reconciliation alerts:** confirm every listed alert comes from a sales/bank reconciliation and that the panel heading describes those sources. | Source is in the staging branch and build `2026-11-03.2` is served; automated component coverage passed. Live dashboard UAT remains pending. |
| PMS-UAT-04 | **Review lock:** submit a task for review, verify the preparer cannot change locked content, return it with an in-app notice, and confirm the correction creates a traceable new revision. | Procedure-stage and role-rule tests passed locally; the full notice/revision workflow remains untested in the deployed workspace. |
| PMS-UAT-05 | **Uploads:** try malformed, duplicate and corrected purchase files. Confirm exact row-level errors, duplicate no-repost behavior, archive history and source references. | Local upload/integration checks passed for row errors, duplicates, corrected credits, rounding and pending information. Confirmed archive/delete history was not exercised; live UAT not run. |
| PMS-UAT-06 | **Dated activity:** test multiple activities/effective dates, an invalid row, a date crossing the reporting period and purchase mapping against the policy effective on the invoice date. | Local activity, invoice-date policy and VAT-period checks passed; full client-to-project-to-mapping workflow was not exercised live. |
| PMS-UAT-07 | **Opening trial balance:** download the [blank six-column template](../Opening_TB_Upload_Template.xlsx), confirm automatic column mapping, map source accounts to ERP TB item codes, check routing, import the immediately preceding year’s approved closing figures, reconcile debits/credits and any “Difference in Books” control, then obtain independent approval before posting. Confirm evidence is entered once and Excel row references are retained automatically. | The supplied 2025 workbook was not uploaded: its date-label conflict and non-zero Difference in Books must be reconciled first. Automated local UAT is recorded below; live staff UAT remains pending. |
| PMS-UAT-08 | **Tax accounting:** reconcile VAT, withholding tax and payments to the original source rows and general-ledger balances; verify no amount appears twice in profit or loss. | Tax and accounting component checks passed locally; the complete VAT/withholding/payment-to-GL tie-out was not run. |
| PMS-UAT-09 | **Tenant isolation:** using two distinct subscribing-practice tenants, attempt cross-tenant URL/API access, search, file download, import/export and background-job access. All must be denied and audited. | Blocked: current firm-scoped access tests do not establish tenant isolation. A separate tenant model/build is required. |
| PMS-UAT-10 | **Subscription lifecycle:** test trial, active, past-due/grace, suspended, cancelled, retained/exported and deletion states. Verify entitlements server-side, read-only/export during non-payment, preserved ownership and SaaS billing separation. | Not implemented; separate build and UAT required. |
| PMS-UAT-11 | **TOT / VAT / eTIMS alignment:** use fictional profiles below and above the KES 5m taxable-supplies threshold. Verify VAT is allowed alongside TOT when required, while no ordinary income-tax or instalment task is generated for income covered by TOT; no expenses are deducted from the TOT base; daily sales and purchases registers support the simplified-record workflow; eTIMS invoice duties remain a distinct check; missing facts block work; every decision cites its evidence and approved rule version. | Implementation is on the staging candidate only. **Not tested:** Tax Lead and staff must record the live UI/API result and evidence before marking the release check Passed. |

For each case record: **Test ID, module, requirement, steps, expected result, implementation status, result, tester, date, environment/build, evidence, defect, retest date/result and approver.** Use `Pass`, `Fail`, `Blocked` or `Not tested`; never pre-fill a pass from code inspection.

## Execution record — 28 October 2026

**Scope:** automated local pre-UAT only, against the uncommitted working tree based on `0de2a1a`; no deployed build ID was available. These results do not certify the connected staff workspace.

| Automated check | Result |
|---|---|
| Dashboard, purchase uploads, activity choices, inventory date rules, procedures, accounting rules, workbook templates and upload-scope suite | **61 passed, 0 failed.** Dashboard checks assert the review count matches task/tax/sales queues and the labels exclude journal/asset review and name sales/bank alerts accurately. |
| Ledger integration against an ephemeral PGlite database and synthetic records | **1 passed, 0 failed.** Includes opening-journal balance, six-column opening import, upload-level source confirmation, automatic row references, routing validation, duplicate-opening protection, “Difference in Books” submission hold, independent approval, firm-scope restrictions and retained source checks. |
| Opening TB template and ledger regression tests | **9 passed, 0 failed.** ERP workbook reader reports exactly six upload columns; the standard UI mapping is automatic; opening evidence is required once; source rows remain traceable; and an unresolved source difference blocks submission. |
| Period-import integration against an ephemeral PGlite database and synthetic records | **4 passed, 0 failed.** Includes corrected/duplicate purchase uploads, row-level malformed rejection, pending credit notes, stock-category permissions and posting controls. |
| Tax, accounting, mapping, activity, import-profile, schedule, and task-workspace component checks | **43 passed, 0 failed.** |
| `git diff --check` | Passed. |

**Live staging outcome:** the initial read-only page check displayed build `2026-11-03.1`. After publishing the restored staging tree, a reload showed build `2026-11-03.2` on the signed-out sign-in page. No real staff login or hosted role-based API acceptance was performed. Those checks remain **Not tested**. No live records were created or changed during the check.

**Browser smoke test:** blocked because this workspace has no installed local Chromium executable. The test did not launch. The current user browser session is signed out, so it could not substitute for that test.

The first automated run exposed outdated test expectations: one test assumed a malformed purchase row rejected the entire file, while the importer intentionally retains clean rows and records the malformed row separately. The expectation was aligned with the documented row-level behavior; the final affected suites passed. This updates the test, not the ERP import behavior.

## Test data, roles and safeguards

- Use a dedicated non-production dataset with synthetic clients and balances. Do not copy identifiable client information into the UAT tenant or evidence screenshots.
- Exercise separate Preparer, Supervisor, Manager/Tax Manager, Engagement Partner and Developer/QA accounts. Verify denied actions through the API as well as the screen.
- Keep outbound email, WhatsApp, KRA, payment and client-portal actions disabled or safely sandboxed for testing. Record how each integration was verified disabled.
- Record the exact commit/build ID and migration version with each test. Reset or reseed only through a reviewed, repeatable procedure that preserves evidence needed for defect analysis.
- Include approved sample files, expected row counts and control totals. Redact screenshots and retain restricted evidence under the agreed policy.

## Sequence before UAT and production

1. The staging source has been published to the authorized repository branch `backend/staging-foundation`; verify each new branch commit and CI result.
2. The connected page now serves build `2026-11-03.2`; perform hosted role-based UI/API checks with approved synthetic users and data before staff acceptance.
3. Execute the UAT cases with the approved test data, correct roles and evidence register. Resolve all Critical/High defects; do not call a blocked case a pass.
4. Build and independently test tenant isolation and the subscription lifecycle before presenting a separate Testing Firm as a tenant or describing the ERP as multi-tenant SaaS.
5. Before any production decision, add restore/rollback evidence, security review, agreed load/performance results, operational monitoring, exact release approvals and data migration reconciliation. Production remains unauthorized until the accountable approvers sign off.

## Reference

Source: *PCL PMS v6.0 Testing Firm, Multi-Tenant, Subscription and UAT Plan*, dated 28 October 2026. The attachment is a target specification; its statements about publication, tenancy, subscription readiness or test outcomes must not be copied as facts without verification against the deployed build.

## Dated client setup dependency alignment — 3 November 2026

The staging schema now supports multi-select dated activities, activity codes, one primary activity at a time, turnover shares, a versioned dependency map, dated per-obligation records and de-duplicated dependency-source links. Activity and tax-profile changes show a dependency preview before independent Manager/Partner confirmation. Purchase mappings carry the applicable activity code, including split rows. The seeded map is `Testing`; no production rule release is implied.

**Still required before this area can be called aligned:** execute UAT cases U39–U45 in `FULL_ERP_STAFF_UAT.md`; connect and exercise the new KYC evidence and beneficial-owner fields on the client screen; implement/verify ongoing mid-period obligation changes after client activation; test all downstream feature/task generation from the dependency map; reconcile existing client activity and obligation history; and obtain Tax Lead/Compliance Lead sign-off. Production remains blocked until that evidence is recorded.

## Staging candidate disposition — 3 November 2026

The staging code snapshot is `1305f59e044b9caf80d3f6bbcd69ec71a7e732b9`. GitHub Actions run #38 passed 249 automated checks and a Chromium flow that uses a local test server and mocked backend. The deployed `staff-workspace-v12` function is version 42 from `d43b6ca`; the connected frontend now serves build `2026-11-03.2`. This candidate is for staging UAT only. KYC screen integration, broad account-mapping approval consolidation, dependency-map task generation, release-check sign-off and hosted role-based UAT remain open. Do not treat automated checks or the existing staging schema as evidence that these requirements have passed. Keep production deployment and live filing held until the exact candidate has passed UAT and the accountable reviewers have recorded approval.
