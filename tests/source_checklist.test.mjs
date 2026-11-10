// Source files checklist on a tax period: one short list that reads the same facts as the review gate.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const {sourceChecklist}=await import('../supabase/functions/staff-workspace-v12/source-checklist.mjs');
const {sourceChecklistPanel}=await import('../staff-source-checklist.mjs');
const root=path.resolve(import.meta.dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const b=(dataset)=>({dataset});
test('a VAT period lists sales, purchases and bank, each Provided only when the gate would accept it',()=>{
 const none=sourceChecklist({kind:'VAT',batches:[]});
 assert.deepEqual(none.items.map(i=>[i.key,i.state]),[['sales','Missing'],['purchases','Missing'],['bank','Missing']]);assert.equal(none.complete,false);
 const all=sourceChecklist({kind:'VAT',batches:[b('Sales'),b('Purchases'),b('Bank')]});assert.equal(all.complete,true);
 assert.equal(sourceChecklist({kind:'VAT',batches:[b('Sales'),b('Non-eTIMS'),b('Bank'),b('POS')]}).complete,true,'Non-eTIMS counts as a purchases source; POS counts for nothing');
 assert.equal(sourceChecklist({kind:'VAT',batches:[b('POS'),b('Purchases')]}).items[0].state,'Missing','a POS import is not the eTIMS sales source');
 const pending=sourceChecklist({kind:'VAT',batches:[b('Sales'),b('Expenditure')],bankPending:true});
 assert.equal(pending.items[2].state,'Deferred');assert.equal(pending.complete,false,'a deferral is shown, not treated as complete');
 assert.equal(sourceChecklist({kind:'VAT',batches:[b('Bank')],bankPending:true}).items[2].state,'Provided','a statement wins over a pending flag');
});
test('annual returns list the annual bank evidence; other kinds list nothing',()=>{
 assert.deepEqual(sourceChecklist({kind:'Company',annualBankDocLinked:false}).items.map(i=>i.state),['Missing']);
 assert.equal(sourceChecklist({kind:'Partnership',annualBankDocLinked:true}).complete,true);
 assert.deepEqual(sourceChecklist({kind:'PAYE'}),{items:[],complete:false});
});
test('the panel names each state, escapes text, and is empty when there is nothing to show',()=>{
 const html=sourceChecklistPanel(sourceChecklist({kind:'VAT',batches:[b('Sales')],bankPending:true}),{esc:s=>String(s).replace(/</g,'&lt;')});
 assert.match(html,/id="sourceChecklist"/);assert.match(html,/Provided/);assert.match(html,/Missing/);assert.match(html,/Deferred/);assert.match(html,/cannot be sent to review until each line is Provided/);
 assert.equal(sourceChecklistPanel(null),'');assert.equal(sourceChecklistPanel({items:[]}),'');
 assert.match(sourceChecklistPanel({items:[{label:'<b>x</b>',state:'Provided',detail:'d'}],complete:true},{esc:s=>String(s).replace(/</g,'&lt;')}),/&lt;b>x/);
});
test('the server adds the checklist next to the existing issues and the screen shows it',()=>{
 const t=read('supabase/functions/staff-workspace-v12/tax-review-actions.ts');
 assert.match(t,/import \{sourceChecklist\} from '\.\/source-checklist\.mjs'/);assert.match(t,/source_checklist=sourceChecklist\(/);assert.match(t,/return \{result,source_checklist,/);
 assert.match(t,/issues\.push\('Upload the bank control source for this period\.'\)/,'the existing gate is unchanged');
 const ui=read('staff-suite.mjs');assert.match(ui,/staff-source-checklist\.mjs\?v=20261111-srcchk-v1/);assert.match(ui,/sourceChecklistPanel\(r\.source_checklist,\{esc\}\)/);
});
