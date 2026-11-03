# ERP alignment control — staging release

**Reviewed:** 3 November 2026  
**Scope:** one coherent ERP release from client onboarding through project work, tax/accounting close and audit staging pack.  
**Release status:** staging only; production is held.

This is the decision and evidence map for reconciling the preceding workflow notes, screenshots, tax corrections and code reviews. It does not claim that a described workflow is implemented or accepted. The exact build, database migrations, Supabase function version and hosted test evidence must match before a row can be marked **Aligned**.

## Canonical rules for the release

### Client setup and engagement

- The KRA PIN is the client key. Validate required format and duplicates before save; do not silently make a second client record for an existing PIN.
- Identity, KYC evidence, tax profile, dated activities, dated obligations, engagement and financial years are saved once in their own records. Unknown facts stay **Unknown / To confirm**, never zero.
- Activities and obligations are multi-select effective-dated rows. Keep effective date separate from recorded date; one activity is primary. A dated dependency map produces a preview of downstream modules/tasks, deduplicates shared items, retains the source selection and applies only after the existing Gate A review.
- An obligation has four distinct facts: iTax registration, legal applicability, client status and whether this firm files it. A To-confirm item produces no task and does not block unrelated confirmed work.
- Engagements are per client and handling firm. Gate A is the only client activation/change approval; a submitter cannot approve their own change.
- KYC evidence supports upload, physical-document and online-check forms, links one evidence record to multiple requirements, records owners and screening, and reopens review only for affected changes. KYC changes after activation are dated versions routed through Gate A.

### Imports, accounting and period review

- Every source import uses line-level rows, stable shared keys/code lists, reference and PIN text values, a source control, an exceptions result and one month/date model. One upload sheet is used; templates have no external workbook links.
- Upload flow is **upload → auto-map → resolve exceptions → submit**. Mapping suggestions can use approved history, but changed/new treatments remain visible in the risk review. There is no separate mapping approval queue.
- Bank and M-Pesa statements are the cash control. Each line must match or be explained; unexplained lines remain in suspense and block close. Own-account transfers pair to an opposite line. Statement openings and closings, source totals and ledger balances must reconcile.
- Close checks name their blocker: source control totals, bank/suspense, transfers, sales bridge, VAT, payroll/statutory liabilities, loans/deposits, debtors/creditors and balanced TB. Legitimate timing/credit-sales differences can be reviewed with an explanation; they are not silently converted to zero.
- Gate B is one independent reviewer action for the complete period package. It approves, posts, locks and marks the filing check ready together. Any post-submission edit invalidates review; locked work changes through an adjusting journal. Opening TB mappings and the resulting journal are checked together at this gate.
- Gate C is the Partner year-end release. It locks the year, rolls balances, and releases the year-end accounts/audit pack after the year-end checks. The pack is built from approved, versioned evidence and shows unresolved gaps.
- Tax rules are released firm-wide by a separate author and approver. The package records the exact approved rule versions used. Client gates never replace rule approval.

### Kenyan tax treatment: TOT, VAT, MRI and eTIMS

- TOT and VAT are separate obligations and may coexist. KRA says a TOT taxpayer supplying vatable goods/services at KES 5 million or more must also register for VAT. Do not restore a mutual-exclusion rule.
- TOT is final for the income it covers; no ordinary income-tax, instalment-tax or advance-tax task is generated for the same TOT-covered sales. MRI is final for qualifying residential rental income. Do not tax the same income source twice. A taxpayer-level profile that mixes a final-tax source with separate income sources needs an explicit, source-based Tax Lead determination; block uncertain mixed-source cases rather than guessing. VAT is a separate obligation and may coexist with TOT when required.
- TOT uses gross sales with no expense deductions and simplified daily gross-sales and daily-purchase records. Store the supported daily-register totals separately from detailed bookkeeping. Do not require one accounting ledger entry per daily sale merely to calculate TOT.
- eTIMS invoicing is a separate compliance control. KRA states persons engaged in business must onboard eTIMS and issue electronic invoices; it describes buyer-initiated invoicing where a small-business supplier's annual turnover does not exceed KES 5 million. Keep invoice compliance distinct from the simplified TOT daily records and confirm the applicable current rule for the taxpayer and supply.
- Current KRA reference pages: [Turnover Tax](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/turnover-tax-tot), [VAT](https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax), [eTIMS categories](https://www.kra.go.ke/component/kra_faq/faq/653), [KRA explanation of TOT record keeping](https://www.kra.go.ke/news-center/blog/1546-understanding-turnover-tax). Tax Lead sign-off remains required for the ERP's dated rule versions before live use.

## One release identity and evidence chain

Use one staging candidate branch and one immutable release commit. Do not rewrite the shared branch history to make old commits look aligned. Instead, add a reconciliation commit at the branch head, run the full suite on that head, and reject or selectively port any side branch that reintroduces retired approval or tax logic.

The runtime candidate `a9c50fb` passed run #44. Documentation/coverage follow-up `f6f6a82` passed run #46 after the earlier reconciliation run surfaced stale test wording. Both runs include 251 automated checks and mocked Chromium; neither is hosted staff-role acceptance.

For each candidate, record this chain in `RELEASE0_STATUS_2026-11-03.md`:

1. Git commit SHA and pull request diff.
2. CI result for that exact SHA, including the full automated count and browser job.
3. Applied migration versions and database health/security review.
4. Cloudflare Pages build and Supabase function name/version/source fingerprint, both tied to the same candidate.
5. Hosted browser/API evidence with separate fictional preparer, reviewer and approver accounts.
6. Named rule-owner decisions and UAT sign-off; unresolved controls remain **Not tested**.

A green unit suite or a loaded sign-in page is not evidence of successful hosted login, role authorization, a posted accounting period or a completed audit pack.

## Current alignment snapshot

| Area | Current state | Required evidence before marking aligned |
|---|---|---|
| Sign-in and idle security | v12 v43 returns a 1,800-second timeout; migration `20261103172501` restores the server-side cutoff in both session lookup functions. Hosted Pages remains build 03.2. | Deploy the matching Pages build and verify login, manual logout and the 30-minute boundary in the browser with fictional staff accounts. |
| Client onboarding and dated dependency map | Schema and several code paths exist; full five-step UI, complete import and automatic downstream task generation are not evidenced end to end. | Run U05–U10 and U39–U41; reconcile every step and resulting task against the selected dated facts. |
| KYC and beneficial owners | Schema exists, but the active KYC screen and `compliance_save` path remain the older document-link flow. Physical/online evidence, one-save behavior, changed-only invalidation and versioned Gate A review are not fully wired. | Complete U44 and related KYC tests before claiming the attached design is implemented. |
| Approval model | Opening TB uses one reviewer action in its current flow. General client account mappings still have their own Manager/Partner approval actions, which conflicts with the three-gate model. | Move mapping changes into Gate A for client setup or Gate B when they are period-specific; remove the extra approval route only after the replacement is tested. PR #11 must not be merged as-is. |
| Imports and bank-centered close | Import, control-total and ledger modules exist; full common-template parity and line-by-line bank close are not evidenced across all source types. | Run bank, sales, purchase, payroll and asset scenarios with control totals, suspense blockers and transfer pairing. |
| TOT/VAT/MRI and eTIMS | v12 permits TOT and VAT together, requires VAT evidence at the KES 5m rolling taxable-supplies threshold, treats TOT/MRI as final, and blocks ordinary income-tax obligations on the same final-tax profile. The focused regression is included in commit `a9c50fb` and passed in run #44 (251 checks). The database release checks and Rule Lead/Tax Lead sign-off remain open. | Tax Lead signs dated rules and any separate-income exception; test daily records, eTIMS separation and VAT coexistence; keep release checks Not tested until signed evidence exists. |
| Period close, filing and audit staging pack | Named close checks, filing stages, year-end and audit modules exist in code/spec. Hosted end-to-end workflows and complete pack evidence are not verified. | Complete U24–U28 and U46–U62 with separate roles; inspect source index, journals, reconciliation, audit events and export contents. |
| Historical endpoints and side branches | Supabase still lists active v6–v10 functions. PR #11 is separate and not mergeable. | Confirm no supported caller uses old endpoints; retire only after compatibility review. Reconcile commits into the canonical branch and run the full suite on the final head. |

## Release rule

Nothing reaches production until Release 0 foundation, the five core workflows, the aligned KYC/approval/import paths, current tax rule approvals, role-based hosted UAT, backup/restore and the Partner's written release decision are recorded. The latest approval for staging does not authorize production.
