# PCL Nexus Offline Windows pilot

The Edge app remains the entry point for the live ERP and PCL Messenger. This Windows x64 pilot connects only to staging and accepts assigned-task time drafts and procedure notes. Use fictional staging records for pilot testing.

## Build and verify

- With Node.js 24, run `npm ci` and `npm test` in this directory. The local tests use the real encrypted SQLite module.
- The **Windows offline pilot** GitHub Actions workflow builds the Windows installer and tests Electron's Windows key protection. The staging installer is an unsigned CI artifact. Install it only through an approved company device and software distribution policy. A trusted signing or managed distribution decision is required before firm-wide rollout.
- Release the matching staging migration and Edge Function before using the installer. The full online ERP opens in the normal browser.

## Use the pilot

1. Open PCL Nexus Offline and sign in online with your staging staff account. This verifies the account and unlocks its own encrypted database.
2. Disconnect, select an assigned task in My Work, and save a time draft or work note. Notes are available on tasks with an open procedure.
3. Reconnect and select **Sync now**, or let the app sync in the background. Synced time appears in Time & Attendance as a draft. Notes appear under the task's procedure notes.
4. A draft stays on the device if the outcome is uncertain. If access to the task is removed, its details are hidden and the app shows **Needs attention** when the server refuses it. Leaving the app, inactivity, Windows lock and sign-out close the database. Reopen it with an online sign-in to the same account.

The snapshot contains up to 100 currently assigned tasks and expires within 24 hours. The app keeps the sign-in token in memory and honours the ERP session expiry and 30-minute inactivity rule. Avoid shared Windows profiles. The database key is protected by Windows DPAPI and stored separately for each staff account. DPAPI cannot shield data from other processes already running as the Windows user. Use only managed Windows devices with full-disk encryption and separate staff profiles.

The Windows build uses the open-source encrypted SQLite package and Electron's native secure storage. The ERP checks current access and assignment before applying an operation. The receipt and the resulting record commit together. Leave a receipt available for retries as long as an offline device might replay its operation. Treat any database without its matching key as unreadable and use the existing device disposal process. Pending drafts are device-local until synced.
