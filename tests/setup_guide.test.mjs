import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {openingProgress} from '../staff-setup-guide.mjs';

const balancedLines=[{debit:125,credit:0},{debit:0,credit:125}];
const guideSource=fs.readFileSync(new URL('../staff-setup-guide.mjs',import.meta.url),'utf8');
const clientUi=fs.readFileSync(new URL('../staff-pilot.mjs',import.meta.url),'utf8');

test('client list opens an ordered, read-only setup and reporting guide',()=>{
 assert.match(clientUi,/data-setup-guide=/);
 for(const label of ['Client profile & financial year','General account mappings','Opening trial balance','Purchases, sales, payroll & assets','VAT, Income Tax & Source and Application','Project release & handover'])assert.ok(guideSource.includes(label),`missing guide step: ${label}`);
 assert.match(guideSource,/Staged','Mapped & imported','Balanced','Submitted','Reviewed & posted/);
 assert.match(guideSource,/Read-only checklist/);
 assert.doesNotMatch(guideSource,/action:'(?:ledger_journal_save|ledger_journal_review|ledger_journal_submit|tax_create|project_activate)'/);
});

test('opening TB guide separates staged from imported and balanced states',()=>{
 const staged=openingProgress({openingStatus:'Pending',sourceStaged:true});
 assert.equal(staged.label,'Staged');
 assert.equal(staged.imported,false);
 const draft=openingProgress({openingStatus:'Pending',sourceStaged:true,journal:{status:'Draft'},lines:balancedLines,detailsAvailable:true});
 assert.equal(draft.label,'Balanced');
 assert.equal(draft.imported,true);
 assert.equal(draft.blocker,'Submit this balanced draft for independent review.');
});

test('opening TB guide never marks missing details or unbalanced entries as balanced',()=>{
 const missing=openingProgress({openingStatus:'Pending',journal:{status:'Draft'}});
 assert.equal(missing.label,'Imported');
 assert.equal(missing.balanced,false);
 const unbalanced=openingProgress({openingStatus:'Pending',journal:{status:'Draft'},lines:[{debit:125,credit:0}],detailsAvailable:true});
 assert.equal(unbalanced.label,'Imported');
 assert.match(unbalanced.blocker,/Correct the opening entry issues/);
});

test('opening TB guide makes review and posted states explicit',()=>{
 const submitted=openingProgress({openingStatus:'Pending',journal:{status:'Submitted'},lines:balancedLines,detailsAvailable:true});
 assert.equal(submitted.label,'In review');
 assert.match(submitted.blocker,/different Manager or Partner/);
 const posted=openingProgress({openingStatus:'Pending',journal:{status:'Posted'},lines:balancedLines,detailsAvailable:true});
 assert.equal(posted.label,'Posted');
 assert.equal(posted.blocker,'');
});

test('no-opening-balance decisions bypass the journal workflow',()=>{
 const none=openingProgress({openingStatus:'No opening balances',sourceStaged:false});
 assert.equal(none.label,'No opening balances apply');
 assert.equal(none.notApplicable,true);
});
