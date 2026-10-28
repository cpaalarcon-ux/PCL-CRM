# PCL PMS v6.0 alignment and UAT release gate

**Date:** 28 October 2026
**Purpose:** Align the attached PCL PMS v6.0 Testing Firm, Multi-Tenant, Subscription and UAT Plan with the current PCL ERP staff workspace before publishing the next staging candidate.

## Release position

The current product is a **single PCL ERP workspace with access scoped by handling firm, client, project and staff assignment**. The current database and access rules use firm-level identifiers such as `firm_id` and `handling_firm_id`. That is useful firm access control, but it is **not a separate subscribing-practice tenant boundary**.

The reviewed migrations do not provide a tenant model or SaaS subscription lifecycle. Do not label the current workspace as multi-tenant SaaS-ready, do not treat a “Testing Firm” firm record as tenant isolation, and do not use subscription status to grant access until those server-side controls have been built and tested. The PCL, ACPA and ACL legal issuing firms remain separate from any future subscribing-practice tenant.

This is a staging/UAT release only. The banner must say **“STAGING ONLY — DO NOT FILE OR SEND.”** Staff should use approved fictional test records. A published staging build is not production approval, completed UAT, or proof of integrations.

## Current change alignment

| Area | Alignment in the local candidate | Release status |
|---|---|---|
| Staff orientation | Home links expose the workspace areas, including Audit & assurance. Role restrictions remain visible. | Existing branch scope; staff familiarisation still required. |
| Review summary | Label states that the count covers task, tax and sales reviews. It explicitly says journal and asset reviews are not included. | Local UI change; UAT not run. |
| Reconciliation alert | Label now matches the displayed sales and bank reconciliation controls. | Local UI change; UAT not run. |
| Staging warning | Persistent workspace warning prohibits filing, payment and client communication from staging and calls for fictional records. | Local UI change; confirm the deployed environment and external integrations are safely disabled before staff use. |
| Opening trial balance | Six-column blank template: source account code/name, ERP routing code, ERP TB item code, debit and credit. The ERP fills routing from the TB item, captures source evidence once, and retains each Excel row reference. | Local implementation; targeted automated checks passed. Not published. Staff UAT pending. |
| 2025 opening figures | Use the 2025 closing balances as the 1 January 2026 opening basis only after source date, account mapping and closing reconciliation are approved. | **Blocked for the supplied workbook:** its sheet label conflicts with its reported year and its Difference in Books control is materially non-zero. Reconcile and approve the 2025 close before importing or posting. Do not use the comparative 2024 columns as the opening basis. |
| Client setup to project to mapping | Saved client business activity and dated inventory settings are intended to carry through to projects and purchase mapping; mapping must use the policy effective on each invoice date. | Existing connected workflow; verify with UAT cases below. |
| Purchase upload and credit notes | Use one standard template, treat row 1 as headers, leave unused optional cells blank, and capture original invoice number/date for credit notes. Keep invoice date separate from client VAT reporting month. | Existing connected workflow; verify upload, rounding, duplicate and tax-review controls in UAT. |
| Import deletion | Wrong uploads should be removed through confirmed, reasoned archive/soft-delete controls that preserve the source and audit trail. | Existing connected control; verify role limits and recovery/correction in UAT. |
| Recurring projects | Client service defaults and project periods should carry forward; pause, resume, end and period archive remain separate actions. | Existing connected workflow; test year-end transition and duplicate prevention. |
| Client invoicing and SaaS billing | Client invoices belong to the firm's Billing & WIP workflow. SaaS subscription invoices, plan entitlements and payment lifecycle belong to a future tenant subscription service. Recurring client invoice generation is still a separate follow-up. | Do not conflate the two billing types; subscription billing is not implemented. |
| My Work pagination | The current interface does not yet evidence true server-side cursor pagination at the plan's 25-row page size. | **Release gap:** implement and test before claiming the PMS pagination requirement is met. |
| Tenant isolation | No separate `tenant_id` boundary is evidenced across database records, object paths, search, exports, caches and jobs. | **Release blocker for multi-tenant Testing Firm or SaaS claims.** |
| Subscription lifecycle | No server-enforced trial, active, grace, suspended, cancellation, export or retention entitlement lifecycle is evidenced. | **Separate build required.** A practice-client invoice is not SaaS subscription billing. |

The opening-balance and dashboard changes are in the local working tree. Targeted automated checks have passed. They are not yet committed or published to staging, and staff browser UAT remains pending.

## PMS v6.0 acceptance register

Run these additions alongside [the full ERP staff acceptance plan](FULL_ERP_STAFF_UAT.md). The status below is an implementation assessment, **not a test result**.

| Test ID | Requirement and acceptance evidence | Current assessment |
|---|---|---|
| PMS-UAT-01 | **My Work:** load 1,500 assigned tasks; Home loads at most five priority items; My Work uses 25-row cursor pagination, indexed search and tenant scope. Verify stable next/previous navigation and correct totals. | Not ready: true server-side cursor pagination and tenant scope are not evidenced. |
| PMS-UAT-02 | **Review count:** compare the dashboard count to its underlying queues. The current label must disclose that it covers task, tax and sales reviews, excluding journal and asset reviews. | Local dashboard component check passed; live UAT not run because the deployed staging page still serves the previous version. |
| PMS-UAT-03 | **Reconciliation alerts:** confirm every listed alert comes from a sales/bank reconciliation and that the panel heading describes those sources. | Local dashboard component check passed; live UAT not run because the deployed staging page still serves the previous version. |
| PMS-UAT-04 | **Review lock:** submit a task for review, verify the preparer cannot change locked content, return it with an in-app notice, and confirm the correction creates a traceable new revision. | Procedure-stage and role-rule tests passed locally; the full notice/revision workflow remains untested in the deployed workspace. |
| PMS-UAT-05 | **Uploads:** try malformed, duplicate and corrected purchase files. Confirm exact row-level errors, duplicate no-repost behavior, archive history and source references. | Local upload/integration checks passed for row errors, duplicates, corrected credits, rounding and pending information. Confirmed archive/delete history was not exercised; live UAT not run. |
| PMS-UAT-06 | **Dated activity:** test multiple activities/effective dates, an invalid row, a date crossing the reporting period and purchase mapping against the policy effective on the invoice date. | Local activity, invoice-date policy and VAT-period checks passed; full client-to-project-to-mapping workflow was not exercised live. |
| PMS-UAT-07 | **Opening trial balance:** download the [blank six-column template](../Opening_TB_Upload_Template.xlsx), confirm automatic column mapping, map source accounts to ERP TB item codes, check routing, import the immediately preceding year’s approved closing figures, reconcile debits/credits and any “Difference in Books” control, then obtain independent approval before posting. Confirm evidence is entered once and Excel row references are retained automatically. | The supplied 2025 workbook was not uploaded: its date-label conflict and non-zero Difference in Books must be reconciled first. Automated local UAT is recorded below; live staff UAT remains pending. |
| PMS-UAT-08 | **Tax accounting:** reconcile VAT, withholding tax and payments to the original source rows and general-ledger balances; verify no amount appears twice in profit or loss. | Tax and accounting component checks passed locally; the complete VAT/withholding/payment-to-GL tie-out was not run. |
| PMS-UAT-09 | **Tenant isolation:** using two distinct subscribing-practice tenants, attempt cross-tenant URL/API access, search, file download, import/export and background-job access. All must be denied and audited. | Blocked: current firm-scoped access tests do not establish tenant isolation. A separate tenant model/build is required. |
| PMS-UAT-10 | **Subscription lifecycle:** test trial, active, past-due/grace, suspended, cancelled, retained/exported and deletion states. Verify entitlements server-side, read-only/export during non-payment, preserved ownership and SaaS billing separation. | Not implemented; separate build and UAT required. |

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

**Live staging outcome:** the staging URL opened signed out and still showed **“Connected testing release”** and the old footer. The updated banner/dashboard candidate is not deployed there. No approved UAT login or synthetic tenant fixture was available, so the live, role-based acceptance cases remain **Not tested**. No live records were created or changed.

**Browser smoke test:** blocked because this workspace has no installed local Chromium executable. The test did not launch. The current user browser session is signed out, so it could not substitute for that test.

The first automated run exposed outdated test expectations: one test assumed a malformed purchase row rejected the entire file, while the importer intentionally retains clean rows and records the malformed row separately. The expectation was aligned with the documented row-level behavior; the final affected suites passed. This updates the test, not the ERP import behavior.

## Test data, roles and safeguards

- Use a dedicated non-production dataset with synthetic clients and balances. Do not copy identifiable client information into the UAT tenant or evidence screenshots.
- Exercise separate Preparer, Supervisor, Manager/Tax Manager, Engagement Partner and Developer/QA accounts. Verify denied actions through the API as well as the screen.
- Keep outbound email, WhatsApp, KRA, payment and client-portal actions disabled or safely sandboxed for testing. Record how each integration was verified disabled.
- Record the exact commit/build ID and migration version with each test. Reset or reseed only through a reviewed, repeatable procedure that preserves evidence needed for defect analysis.
- Include approved sample files, expected row counts and control totals. Redact screenshots and retain restricted evidence under the agreed policy.

## Sequence before publishing and production

1. Commit and review the current local opening-balance and dashboard changes; keep the release labelled staging/UAT.
2. Publish only to the confirmed staging repository/branch and verify the exact deployed commit and migration state before staff begin testing.
3. Execute the UAT cases with the approved test data, correct roles and evidence register. Resolve all Critical/High defects; do not call a blocked case a pass.
4. Build and independently test tenant isolation and the subscription lifecycle before presenting a separate Testing Firm as a tenant or describing the ERP as multi-tenant SaaS.
5. Before any production decision, add restore/rollback evidence, security review, agreed load/performance results, operational monitoring, exact release approvals and data migration reconciliation. Production remains unauthorized until the accountable approvers sign off.

## Reference

Source: *PCL PMS v6.0 Testing Firm, Multi-Tenant, Subscription and UAT Plan*, dated 28 October 2026. The attachment is a target specification; its statements about publication, tenancy, subscription readiness or test outcomes must not be copied as facts without verification against the deployed build.
