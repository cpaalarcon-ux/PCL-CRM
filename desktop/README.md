# PCL Nexus Offline for Windows

The Windows x64 app accepts assigned-task time drafts and procedure notes. Its **Open online ERP** button opens the browser workspace for other ERP work. Production uses [PCL Nexus Staff](https://pclnexus.com/staff). The staging pilot uses the separate staging project and fictional records.

## Build and publish

- With Node.js 24, run `npm ci` and `npm test` in this directory. On Windows, `npm run build:windows` builds the staging installer. `npm run test:windows` verifies Electron's Windows key protection.
- **Windows Store package** tests the package with a fictional publisher on pull requests. To produce the submission package, run the workflow from `main` using the Package identity name, Publisher and Publisher display name from the app's Partner Center identity page. These fields are public identity metadata.
- Use the production deploy workflow to apply the offline receipt migration and deploy the matching Edge Function. Check a draft and a retry with a controlled staff account before distributing the app.
- The production workflow artifact is a package for Microsoft Store submission. Microsoft Store signs the distributed package after certification. Select a private audience for staff distribution. Supply the firm's approved privacy policy, support address and certification instructions in Partner Center. Keep real client records out of review accounts.

## Use the app

1. Open PCL Nexus Offline and sign in online with your staff account. This verifies your access and unlocks the encrypted database for that account and environment.
2. Disconnect, select an assigned task in My Work, and save a time draft or work note. Notes are available on tasks with an open procedure.
3. Reconnect and select **Sync now**, or let the app sync in the background. Synced time appears in Time & Attendance as a draft. Notes appear under the task's procedure notes.
4. A draft stays on the device if the outcome is uncertain. If access to the task is removed, its details are hidden and the app shows **Needs attention** when the server refuses it. Leaving the app, inactivity, Windows lock and sign-out close the database. Reopen it with an online sign-in to the same account.

The snapshot contains up to 100 currently assigned tasks and expires within 24 hours. The app keeps the sign-in token in memory and honours the ERP session expiry and 30-minute inactivity rule. Avoid shared Windows profiles. The database key is protected by Windows DPAPI and stored separately for each staff account. DPAPI cannot shield data from other processes already running as the Windows user. Use only managed Windows devices with full-disk encryption and separate staff profiles.

The Windows build uses the open-source encrypted SQLite package and Electron's native secure storage. The ERP checks current access and assignment before applying an operation. The receipt and the resulting record commit together. Leave a receipt available for retries as long as an offline device might replay its operation. Treat any database without its matching key as unreadable and use the existing device disposal process. Pending drafts are device-local until synced.
