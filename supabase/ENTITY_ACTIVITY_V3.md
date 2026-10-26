# Entity, activity and usability testing release

This release extends the connected staff workspace (`staff-pilot`) on the review branch. The browser-local legacy root is unchanged. The connected API is `staff-workspace-v8`; v7 is retained as a rollback reference. Login still ends through manual sign-out, not an inactivity timer.

## Where staff test

1. **Clients → Entity / activities** (Partner or Manager): confirm legal identity and verified year-end, add dated activities/industry packs, verified reporting periods and stock-policy versions. Partnership agreement windows must total 100%. Identity, industry, client category, KYC type and tax profile remain separate. Missing fields remain visible. Linking a new successor entity closes the predecessor to new engagements while retaining its unfinished work and history.
2. **Projects & tasks → open project → Imported rows & mapping**: preview the original workbook, check the worksheet and period, then classify source lines. Date-formatted amounts are rejected without treating every number resembling an Excel date as invalid. Imported amounts remain immutable.
3. Tick rows on the page or choose **Select all matching cost rows**. Check the server-confirmed count/net/VAT/gross. The selection expires after 15 minutes and supports 10,000 matching rows. Changed revisions, locks, scope changes and altered retries are rejected atomically. Identical retries return the existing result.
4. Map inventory to a business activity and stock class for the stock-value control. PPE and expenditure remain separate from stock; VAT eligibility is independently reviewed. Supplier history is only a contextual prompt from the same client's reviewed rows. It never auto-classifies purchases. **Request missing category** routes a decision to another Manager/Partner. A new master account still needs Partner activation. **Undo my last mapping** applies only to the user's latest unreviewed original row in an unlocked period.
5. **Stock / requests / exports → Stock value control**: create a period for a dated activity/policy and stock class. The control derives signed resale purchases and landed costs from mapped, independently reviewed source rows, including non-recoverable VAT. Enter supported opening, cost/count or explicitly provisional margin, evidence and reconciliation. Other returns must exclude credits already present in sources. Submit to a different reviewer. Approved source/policy snapshots are immutable. Estimates remain provisional after review and cannot certify annual stock.
6. **Sales & VAT reconciliation → open monthly review → Bank pending / supplements**: a different Manager/Partner may approve a temporary deferral supported by alternative sales-completeness evidence, owner and expected statement date. Missing bank data remains null, never zero. A late statement gets its own evidence/conclusion and independent supplemental review; it does not rewrite the locked monthly snapshot. Required return amendments remain outstanding. Annual completion requires bank-review evidence and resolved supplements.
7. **Return export readiness** shows the prerequisites and blocks unsupported exports. It does not generate a filing-ready KRA file. New return identities are canonical per client/obligation/period across handling firms. Existing collisions, if any, are reserved as unresolved rather than silently merged.

## Release boundaries

- These are aggregate stock-value controls and balanced draft purchase accounting projections, not a posted general ledger or full trial balance.
- The period/deadline register does not silently rewrite existing recurring project schedules. Managers must reconcile those schedules to verified taxpayer-specific dates before live use.
- Wholesale is the tested first pack. Other pack labels are configuration defaults, not complete sector-specific engines or proof of a tax obligation.
- Full SKU quantities/cost layers and perpetual cost of sales, full annual ledger/assets/equity schedules, payroll/P10 and exact official VAT3/IT1/IT2P/IT2C adapters require separate builds and source/template validation. Multiple partner windows require supported subperiod profit allocation before an annual submission.
- Imported values are immutable. Rejected rows are corrected in the source workbook and re-imported; changed values against an already accepted invoice identity remain blocked. A general accepted-source amendment workflow is further work. Locked/filing snapshots cannot be overwritten.
- No live rate was changed, no statutory approval was granted, and no return is filed by this release. Existing testing-rate warnings remain.

## Verification

The Node tests exercise all migrations in an isolated PGlite database, five staff categories, firm isolation, multi-page mapping and idempotent retries, stale revisions, source immutability, undo locks, independent stock approval, canonical return identity, bank deferral and supplemental review. Existing regression tests cover the other connected modules.

Run the existing Node test environment with `PCL_TEST_MODULES` pointing to its installed `jsdom` and `@electric-sql/pglite` dependencies:

```sh
node --test tests/*.test.mjs tests/*.test.cjs
```

Run `node tests/improvement_browser.cjs` with Playwright installed (`PCL_BROWSER_MODULES` can identify the package directory; `PCL_BROWSER_EXECUTABLE` can identify Chromium). It uses fictional training data, checks native queued dialog-close events, saves an entity profile, maps selected purchases and a confirmed 205-row snapshot, and verifies the unsupported-return gate. It never connects to real client records.

Before production: reconcile migrated profiles and periods, validate applicable tax rules/templates, complete a restore test, review scope/role tests with staff, and sign off a supported end-to-end client period. Staging success is not production tax clearance.
