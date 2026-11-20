import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultTaxReportingPeriod} from '../staff-tax-period-defaults.mjs';

const suiteUi=fs.readFileSync(new URL('../staff-suite.mjs',import.meta.url),'utf8');
const importerUi=fs.readFileSync(new URL('../staff-period-imports.mjs',import.meta.url),'utf8');

test('monthly tax periods default to the latest complete calendar month',()=>{
 assert.deepEqual(defaultTaxReportingPeriod('VAT',{},'2026-10-31'),{starts_on:'2026-10-01',ends_on:'2026-10-31',basis:'Defaults to the latest complete calendar month. Confirm the client’s reporting month; edit the dates if needed.'});
 assert.equal(defaultTaxReportingPeriod('PAYE',{},'2026-11-01').starts_on,'2026-10-01');
 assert.equal(defaultTaxReportingPeriod('WHT',{},'2026-10-15').ends_on,'2026-09-30');
});

test('annual tax periods follow the client financial year-end',()=>{
 assert.deepEqual(defaultTaxReportingPeriod('Company',{year_end_month:6,year_end_day:30},'2026-10-31'),{starts_on:'2025-07-01',ends_on:'2026-06-30',basis:'Client financial year ending 2026-06-30. Confirm it matches the verified reporting period.'});
 assert.equal(defaultTaxReportingPeriod('Partnership',{year_end_month:6,year_end_day:30},'2026-06-30').ends_on,'2026-06-30');
 assert.equal(defaultTaxReportingPeriod('Individual',{year_end_month:2,year_end_day:29},'2025-01-15').ends_on,'2024-02-29');
 assert.match(defaultTaxReportingPeriod('Company',{},'2026-10-31').basis,/year-end is not set/);
 assert.equal(defaultTaxReportingPeriod('Company',{},'2026-12-31').ends_on,'2026-12-31');
});

test('tax and payroll previews clearly remain unsaved and hide incomplete tax values',()=>{
 assert.match(importerUi,/Preview ready — not saved/);
 assert.match(importerUi,/Nothing will be saved yet/);
 assert.match(suiteUi,/No tax periods yet/);
 assert.match(suiteUi,/Not ready/);
 assert.match(suiteUi,/defaultTaxReportingPeriod/);
});
