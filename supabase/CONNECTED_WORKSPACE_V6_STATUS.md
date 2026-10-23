# V6 connected testing checkpoint — 23 October 2026

The coding environment was restored. The V6 database migrations and separate staff-workspace-v6 function are deployed to the staging project. The frontend and release documentation are published on backend/staging-foundation, keeping production main unchanged.

See [STAFF_PILOT.md](STAFF_PILOT.md) for available features, testing steps, verification and remaining production gates. The former planned SQL file is superseded by the applied migrations; do not reapply it.

Latest scope: database-backed sectors, one-hour sessions, Supervisor project/task rights, recurring tax compilation schedules, task forwarding/escalation with message/history/in-app alert, private XLSX imports and purchase mapping, timesheets and scoped project reports.

No production DNS changes or main-branch merge are part of this staging release. Finance, tax approval and the other unconnected modules remain unavailable in the connected workspace.
