import test from 'node:test';import assert from 'node:assert/strict';
const {reportPeriodLine}=await import('../supabase/functions/staff-workspace-v12/ledger-rules.mjs');
test('report header shows the reporting period and the prepared date, never the current week',()=>{
 assert.equal(reportPeriodLine('2026-01-01','2026-03-31','2026-11-13'),'Reporting period: 1 Jan to 31 Mar 2026. Prepared: 13 Nov 2026.');
 assert.equal(reportPeriodLine('2026-07-01','2027-06-30','2026-11-13'),'Reporting period: 1 Jul 2026 to 30 Jun 2027. Prepared: 13 Nov 2026.');
 assert.equal(reportPeriodLine('2026-01-01','2026-12-31','2026-12-31'),'Reporting period: 1 Jan to 31 Dec 2026. Prepared: 31 Dec 2026.');
 assert.doesNotMatch(reportPeriodLine('2026-01-01','2026-03-31','2026-11-13'),/Week/);
});
