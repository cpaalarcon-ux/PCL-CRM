# Staff and client profile editing

This release extends the existing **browser-local preview**, not a production identity or database service. No staff register or client spreadsheet is included in the repository.

## Where to find the changes

- **Clients → Bulk staff and client import**: visible only when previewing the Engagement Partner or Manager category. This does not require opening Settings.
- **Clients → Saved client records → click a name**: edit the existing profile, or save an incomplete draft. Required missing fields have red borders, a text label and a summary badge.
- **Time & HR → Team & HR → staff name**: edit staff category, employment/billing settings, dates, unapproved rates and scope. The existing Settings → Staff & users view remains available to users who also have System Administration permission.

Engagement Partners and Managers can reopen and save changes to existing staff and client profiles after manual creation or Excel import. This is not limited to initial onboarding. Click the person's or client's name, edit the fields, then select **Save staff changes** or **Save client changes**. Cancelling leaves the stored record unchanged. Other staff categories cannot save master-profile changes, even with System Administration permission; authorization is checked again when saving, not only when the editor opens.

## Data rules

- Staff ID and the internal Client ID are immutable. Login IDs must be unique. Existing staff-client links, task completion, timesheets, account status and unrelated metadata are retained.
- Client imports require at least Company Name or Client ID / Reference. Missing sector, branch, contact, firm and service information is not guessed. Unknown mapped values are kept for review.
- All named incomplete rows remain eligible as drafts. A shared KRA PIN is a review warning, not a reason to discard a distinct client. The client cards recompute that warning after identity corrections.
- For an established client list, choose **Existing clients — update files and data** before reviewing the import. Those records retain **Existing client** relationship status and show **Update required** in red when information is missing. They are not classified as new leads. Relationship status is separate from profile completeness, document verification and engagement activation.
- Import headers may appear below introductory rows; review messages retain the original Excel row numbers. `Client_External_ID`, `Regulatory_Bodies` and `Service_Lines` map to the corresponding master fields.
- KRA PIN, legal entity type, registration number, address, tax residence and source tax obligations are retained and editable. Other supplied columns are retained as source text, never interpreted as verified KYC or approval. Tax obligations require a separate work-pack review.
- For multi-sheet onboarding workbooks, prepare one client row with its primary contact and requested services matched by Client External ID. This importer does not automatically join Contact or Engagement worksheets or upload KYC documents.
- Missing servicing firms are not silently assigned during reload. An optional default firm can be selected explicitly for blank import cells.
- Existing and within-file duplicates are skipped using identifiers and normalized names. Import confirmation revalidates against the latest directory.
- Renaming a client retains previous names for legacy engagement links. Existing document and invoice snapshots are not rewritten.
- A draft is not an activated engagement or verified KYC record. Completing the details does not grant approval. Existing KYC, signed-EL and review gates remain applicable, and incomplete clients cannot start a new Tax Project.
- Optional audit exemption is not approved by Excel import; it requires review and a recorded basis.
- Profile edits retain browser-local before/after history and reject a stale editor snapshot. This is not an immutable audit log.
- Rates are pending Finance approval. Profile edits do not recalculate historical financials or create/reset real login credentials.

## Production enforcement required

The role selector and localStorage are editable by the browser user. They are **not security controls for operational staff/client data**. A production API must authenticate the user and enforce Engagement Partner / Manager authorization on upload, preview, confirm and edit routes, including firm/team scope. System Administration alone must not grant upload access. Validation, duplicate checks, draft status, approvals and change logging must be repeated server-side in a transaction. Secure credential generation, account deactivation and permission changes remain backend responsibilities.

## Automated checks

Run `node --test tests/profile_edit.test.cjs` from the repository root. The tests use synthetic records only and cover editing, ID preservation, rates, stale edits, duplicate imports, incomplete records, role denial and legacy-name matching. Browser interface verification is separate from these data-logic tests.

## Staff acceptance testing

The application displays a **Staff testing only** notice and an expandable checklist. The tested scope is client/staff creation, repeated editing, partial client import, duplicate handling and the Partner/Manager preview restrictions. Staff should record Pass / Fail / Blocked, steps, selected category, expected outcome and actual outcome for each check. A Manager should review results before requesting the next release.

Use fictional data in a dedicated test browser profile. Do not upload real identity, tax, payroll or client documents. Each browser has separate data; the testing category selector does not authenticate a real staff member. No automatic report delivery, shared backend, login credential service or live integration is introduced by this release. Existing local data must not be cleared to start a test.
