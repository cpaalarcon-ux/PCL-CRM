import test from 'node:test';
import assert from 'node:assert/strict';
import {rateApprovalIssue,taxSourceIssue} from '../supabase/functions/staff-workspace-v12/tax-registry.mjs';

const legalNote='Value Added Tax Act section 5 and Legal Notice No. 128 of 2026; confirm the effective dates and listed tariff codes.';

test('official Kenyan legal and tax authority sources can support approval',()=>{
 assert.equal(taxSourceIssue('https://new.kenyalaw.org/akn/ke/act/2013/35',legalNote),null);
 assert.equal(taxSourceIssue('https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye','Income Tax Act section 37 and Third Schedule; current PAYE rates.'),null);
 assert.equal(taxSourceIssue('https://www.nssf.or.ke/employers/notice','NSSF Act section 19 and Year 4 employer notice.'),null);
});

test('secondary, malformed and lookalike sources cannot support formal approval',()=>{
 assert.match(taxSourceIssue('https://pwc.com/ke/en/publications/tax','Finance Act 2023 section 5'),/official/);
 assert.match(taxSourceIssue('https://kra.go.ke.example.com/tax','VAT Act section 5'),/official/);
 assert.match(taxSourceIssue('http://www.kra.go.ke/tax','VAT Act section 5'),/official/);
 assert.match(taxSourceIssue('https://www.kra.go.ke/tax','Rate is 16 percent'),/Act, section, Legal Notice/);
});

test('a preparer cannot approve their own rule',()=>{
 assert.match(rateApprovalIssue({created_by:'staff-a',source_url:'https://www.kra.go.ke/tax',source_note:legalNote},'staff-a'),/cannot approve/);
 assert.equal(rateApprovalIssue({created_by:'staff-a',source_url:'https://www.kra.go.ke/tax',source_note:legalNote},'staff-b'),null);
});
