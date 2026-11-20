> **Current release pointer:** Use [Full ERP staff UAT](FULL_ERP_STAFF_UAT.md), [Release 0 status](RELEASE0_STATUS_2026-11-03.md) and [ERP alignment control](ERP_ALIGNMENT_CONTROL.md). The V6 checkpoint below is historical; its function/session details do not establish the current staging behavior.

# V6 connected testing checkpoint — 23 October 2026

The coding environment was restored. The V6 database migrations and separate staff-workspace-v6 function are deployed to the staging project. The frontend and release documentation are published on backend/staging-foundation, keeping production main unchanged.

See [STAFF_PILOT.md](STAFF_PILOT.md) for available features, testing steps, verification and remaining production gates. The former planned SQL file is superseded by the applied migrations; do not reapply it.

V6 checkpoint scope: database-backed sectors, the earlier one-hour session policy, Supervisor project/task rights, recurring tax compilation schedules, task forwarding/escalation with message/history/in-app alert, private XLSX imports and purchase mapping, timesheets and scoped project reports. The session policy is superseded by the current 30-minute inactivity candidate, which still needs hosted verification.

No production DNS changes or main-branch merge are part of this staging release. Finance, tax approval and the other unconnected modules remain unavailable in the connected workspace.
