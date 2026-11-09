# Joined practice, step 4: licences and permits per client (2026-11-09)

Staging only. Fictional data. Production untouched. PR #5 (staging to main) stays unmerged until a Partner's written release decision.

This is step 4 of the build order in `ERP_joined_practice_onboarding_alignment_2026-11-09.md`. Steps 1 to 3 are in their own notes.

## What was asked

Licences and permits per client with expiry dates (EPRA, NTSA, county permit, SACCO licence), with a flag to audit when one expires.

## What was built

**A register of licences, one row per licence.** Each has a type, number, issuing authority, optional issue date, an expiry date, and an optional link to KYC evidence. Types today: EPRA, NTSA, County single business permit, SACCO licence (SASRA), and Other (needs a description).

**Who can record.** Manager or Partner only, the same as the ownership register. Staff below that cannot read the register.

**Never deleted, never edited.** A licence's number, dates and issuer cannot be changed after entry. A mistake is ended with a reason (10+ characters) and re-entered. Ended entries stay in the history. Every change goes to the firm change log.

**Renewal.** A renewal is a new row that points at the licence it renews (same client, same type, later expiry). The old entry is ended as "Renewed" and kept. The renewal may keep the same licence number.

**State from the expiry date, using the Nairobi date.**
- Valid
- Expiring (expiry within the type's warning window)
- Expired (expiry date before today; a licence that expires today is still Expiring)
- Missing (see expected licences below)

**Expected licences.** Only one rule is seeded: a Deposit-taking SACCO is expected to hold a SACCO licence. That matches the structure checklist, which already marks the SASRA licence Required for that type. The non-withdrawable type is not flagged because the checklist says "if applicable". Nothing else is invented.

**The flag to audit.** The audit file's Overview now has a "Client licences and permits" card. It shows type, issuer, expiry and state, and never the licence number or evidence. It is open to anyone who can see the client, because the audit team needs it, while the register itself stays Manager and Partner only. It creates no risk, blocks no sign-off and changes no progress count.

**Client screen.** A "Licences and permits" section sits under the ownership register on the KYC screen, with Add, Renew and End.

**Go-live checks.** Three new counts: `licences_expired`, `licences_expiring`, `expected_licences_missing`.

## Rules for the Partner and Compliance Lead (defaults, not confirmed)

All of these show as "default - not yet confirmed" on screen and in the database (`rule_status = Suggested`).

1. **Warning window: 60 days.** It is a column on each licence type (`warn_days`), so it can differ by type. There is no screen to change it yet.
2. **Which licences a legal structure must hold.** Only the deposit-taking SACCO rule exists. The Compliance Lead should list the rest.
3. **Activity to licence (for example transport to NTSA, fuel to EPRA).** Not built. The client activity packs today are Wholesale, Hospitality, Consultancy, Construction and Other, so there is nothing to map from. This needs a Compliance Lead decision and probably a new activity list.
4. **KYC re-verification.** Adding or renewing a licence does not send a verified KYC file back for re-verification. A yearly renewal should not undo a verified file. If the Partner wants a licence change to do that, it is a one-line change in the server.
5. **Should an expired licence block audit approval or require a Partner acknowledgement?** Not built. Today it is information only. This is a Partner decision.
6. **No automatic risk.** An expired licence does not create an audit risk or a going-concern flag. The audit team judges it.
7. **No tax rule is stored.** Nothing here is a tax rate, threshold or rule.

## Checks run

- New DB test `tests/client_licences.test.mjs`: who may record, the exact expiry boundaries (today, day 60, day 61, expired), duplicate numbers, entry rules, no editing, ending, renewal rules including keeping the same number, expected-licence gaps appearing and disappearing, the audit flag (no number, no access for staff without the client).
- New UI and server test `tests/client_licences_ui.test.mjs` (12 tests): screen text and escaping, buttons only for leaders, audit card, rights, release counts, build label, migration safety.
- Full suite result is recorded in the PR.

## Not done

- Browser click-test of the new screens (the sandbox cannot reach staging). Please try: KYC screen of a fictional client, Add licence, Renew, End; open an audit file for the same client and look at the Overview card.
- Editing the warning window or the expected-licence list from a screen.
- Reminder messages for expiring licences.

## Next in the build order

Step 5: client service subscriptions with an independence-check activation step. Do not start until you say so.
