import test from 'node:test';
import assert from 'node:assert/strict';
import {currentReportingMonth,nextReportingMonthStart,previousReportingMonthStart,monthEndDate} from '../staff-reporting-calendar.mjs';

test('current reporting month is a complete calendar month and shows saved client year-end',()=>{
 assert.deepEqual(currentReportingMonth({year_end_month:6,year_end_day:30},'2026-11-02'),{
  starts_on:'2026-11-01',ends_on:'2026-11-30',label:'November 2026',financial_year_end:'30/06'
 });
 assert.equal(currentReportingMonth({year_end_month:2,year_end_day:29},'2024-02-15').ends_on,'2024-02-29');
});

test('a new recurring start advances to the next full month without using today mid-month',()=>{
 assert.equal(nextReportingMonthStart('2026-10-31',{year_end_month:6,year_end_day:30},'2026-11-02'),'2026-11-01');
 assert.equal(nextReportingMonthStart('2026-11-30',{},'2026-11-02'),'2026-12-01');
 assert.equal(nextReportingMonthStart('',{},'2026-11-02'),'2026-11-01');
});

test('catch-up range helper returns previous complete month and month-end',()=>{
 assert.equal(previousReportingMonthStart('2026-01-01'),'2025-12-01');
 assert.equal(previousReportingMonthStart('2026-01-02'),'');
 assert.equal(monthEndDate('2026-02'),'2026-02-28');
 assert.equal(monthEndDate('2024-02'),'2024-02-29');
});

test('invalid reporting dates are rejected or safely fall back',()=>{
 assert.throws(()=>currentReportingMonth({},'2026-02-30'));
 assert.equal(nextReportingMonthStart('2026-13-40',{},'2026-11-02'),'2026-11-01');
});

