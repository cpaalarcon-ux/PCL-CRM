import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingRates,preferredRates,taxTestingEnabled,testingAuthorizationIssue,TAX_TESTING_PROJECT_URL} from '../supabase/functions/staff-workspace-v12/testing-rates.mjs';

const formal={rate_id:'formal',rate_key:'KE_CIT_RES',status:'Approved',effective_from:'2021-01-01',effective_to:'9999-12-31',parameters:{rate:30}};
const testing={rate_id:'testing',rate_key:'KE_CIT_RES',status:'Testing',effective_from:'2021-01-01',effective_to:'9999-12-31',parameters:{rate:25}};

test('only the configured staging project loads Testing rules',()=>{
 assert.equal(taxTestingEnabled(TAX_TESTING_PROJECT_URL),true);
 assert.equal(taxTestingEnabled('https://production.example.supabase.co'),false);
 const stage=stagingRates([formal,testing],TAX_TESTING_PROJECT_URL);
 assert.equal(stage.length,2);
 assert.equal(stage.find(r=>r.rate_id==='testing').approval_scope,'Testing');
 assert.equal(stage.find(r=>r.rate_id==='testing').status,'Approved');
 const production=stagingRates([formal,testing],'https://production.example.supabase.co');
 assert.deepEqual(production.map(r=>r.rate_id),['formal']);
});

test('an authorized staged test rule is used for UAT and excluded from production',()=>{
 const stage=stagingRates([formal,testing],TAX_TESTING_PROJECT_URL);
 assert.equal(preferredRates(stage,'KE_CIT_RES','2026-01-01','2026-12-31')[0].rate_id,'testing');
 const production=stagingRates([formal,testing],'https://production.example.supabase.co');
 assert.equal(preferredRates(production,'KE_CIT_RES','2026-01-01','2026-12-31')[0].rate_id,'formal');
});

test('test-only rules never enter calculations, even if a legacy row says Approved',()=>{
 const fixture={rate_id:'qa-fixture',rate_key:'QA123',status:'Approved',effective_from:'2021-01-01',effective_to:'9999-12-31',parameters:{rate:99}};
 assert.deepEqual(stagingRates([formal,testing,fixture],TAX_TESTING_PROJECT_URL).map(r=>r.rate_id),['formal','testing']);
 assert.deepEqual(stagingRates([formal,testing,fixture],'https://production.example.supabase.co').map(r=>r.rate_id),['formal']);
});

test('staging authorization requires a test purpose and confirmation, not source evidence',()=>{
 const note='Test the 2026 payroll rules for the assigned staging period.';
 assert.equal(testingAuthorizationIssue(true,note),null);
 assert.match(testingAuthorizationIssue(false,note),/Confirm/);
 assert.match(testingAuthorizationIssue(true,'short'),/test purpose/);
});

test('a rate version outside the requested period is not used as a fallback',()=>{
 const nssfYear4={rate_id:'nssf-year4',rate_key:'KE_NSSF',status:'Testing',effective_from:'2026-02-01',effective_to:'2027-01-31',parameters:{lower_limit:9000,upper_limit:108000,employee_rate:6,employer_rate:6}};
 const stage=stagingRates([nssfYear4],TAX_TESTING_PROJECT_URL);
 assert.deepEqual(preferredRates(stage,'KE_NSSF','2026-01-01','2026-01-31'),[]);
 assert.equal(preferredRates(stage,'KE_NSSF','2026-02-01','2026-02-28')[0].rate_id,'nssf-year4');
});
