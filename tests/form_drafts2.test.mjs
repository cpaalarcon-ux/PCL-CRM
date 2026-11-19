// Build 2904: drafts for the opening-balance grid, the purchase/expenditure mapping forms and time entry.
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const rules=await import('../supabase/functions/staff-workspace-v12/form-draft-rules.mjs');
const {shortHash,compareRows,changedNote,createDraftUI}=await import('../staff-drafts.mjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('2904 server: the three new forms are accepted, unknown forms are still refused, secrets are still refused',()=>{
 for(const k of ['opening_balance','purchase_mapping','time_entry']){
  assert.ok(rules.kindLabel(k),k+' has a label');
  assert.deepEqual(rules.draftIssues({kind:k,subject_key:'x:1',title:'Draft'}),[],k+' accepted');
 }
 assert.deepEqual(rules.draftIssues({kind:'made_up',subject_key:'x',title:'t'}),['This form cannot be saved as a draft.']);
 assert.equal(rules.cleanPayload({fields:{hours:'2'},rows:[{code:'1000',debit:'5'}]}).ok,true);
 assert.equal(rules.cleanPayload({fields:{password:'x'}}).ok,false);
 assert.equal(rules.cleanPayload({fields:{note:'x'.repeat(70000)}}).ok,false);
});

test('2904 helpers: a short stable key, and changed rows are reported not applied',()=>{
 assert.equal(shortHash(['b','a']),shortHash(['a','b']),'order does not matter');
 assert.notEqual(shortHash(['a']),shortHash(['a','b']));
 const saved={row_ids:['1','2','3','4'],revisions:{1:'r1',2:'r1',3:'r1'}};
 const now=[{row_id:'1',revision:'r1'},{row_id:'2',revision:'r2'},{row_id:'3',revision:'r1',account_code:'5000'},{row_id:'9',revision:'r1'}];
 const out=compareRows(saved,now);
 assert.deepEqual(out.rows.map(r=>r.row_id),['1']);
 assert.deepEqual(out.changed.map(c=>c.row_id),['2','3','4']);
 assert.match(changedNote(out.changed),/^3 rows from your draft were left out/);
 assert.equal(changedNote([]),'');
 assert.match(changedNote([{row_id:'1',reason:'Changed since the draft was saved'}]),/^1 row from your draft was left out/);
});

test('2904 wiring: each form passes a draft to its modal, resumes by refilling, and is registered',()=>{
 const pilot=rd('staff-pilot.mjs'),led=rd('staff-ledger.mjs'),acc=rd('staff-accounting.mjs'),v6=rd('staff-workspace-v6.mjs');
 for(const [k,fn] of [['opening_balance','resumeOpeningDraft'],['purchase_mapping','resumeMappingDraft'],['time_entry','resumeTimeDraft']])
  assert.match(pilot,new RegExp(`drafts\\.register\\('${k}',d=>v6\\.${fn}\\(d\\)\\)`),k+' registered');
 assert.match(led,/kind:'opening_balance'/);assert.match(acc,/kind:'purchase_mapping'/);assert.match(v6,/kind:'time_entry'/);
 assert.match(led,/\{draft:openingDraft\(j\)\}/);
 assert.match(v6,/draft:timeDraft\(/);
 // the confirmations are never saved or restored
 assert.match(acc,/skip:/);assert.match(led,/skip:/);
});

test('2904 tokens: the changed modules carry the new cache token',()=>{
 assert.match(rd('staff-pilot.mjs'),/staff-improvements\.mjs\?v=20261119-drafts2-v1/);
 assert.match(rd('staff-pilot-auth.js'),/rev=20261119-(?:2904|2905|2906)/);
});

test('2904 the confirmation ticks are never saved in a draft, and a submit clears the draft',async()=>{
 const dom=new JSDOM('<body><dialog id="editor"><div id="editorBody"><form id="editForm"><input name="hours" value=""><input name="confirm_source" type="checkbox" value="yes"><input name="confirm_codes" type="checkbox" value="yes"></form></div></dialog></body>',{url:'https://staging.example/staff-pilot'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls=[],doc=dom.window.document;
 const ui=createDraftUI({$:s=>doc.querySelector(s),request:async p=>{calls.push(p);return {ok:true,saved_at:'2026-11-19T07:45:00Z',revision:'1'};},notice:()=>{},document:doc,sessionStorage:dom.window.sessionStorage,autosaveMs:15,returnToQueue:()=>{}});
 const form=doc.querySelector('#editForm');
 ui.attach(form,{kind:'purchase_mapping',key:'mapping:p:codes::abc',title:'Confirm',project_id:'00000000-0000-4000-8000-000000000001',skip:/^confirm/,meta:{row_ids:['1']}});
 form.elements.hours.value='3';form.elements.confirm_source.checked=true;form.elements.confirm_codes.checked=true;
 form.elements.hours.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 await wait(80);
 const save=calls.find(c=>c.action==='form_draft_save');assert.ok(save,'saved');
 const fields=save.payload?.fields||save.fields||{};
 assert.equal(fields.hours,'3');
 assert.equal('confirm_source' in fields,false,'confirmation not saved');assert.equal('confirm_codes' in fields,false);
 await ui.current().submitted();
 assert.ok(calls.some(c=>c.action==='form_draft_discard'),'submit clears the draft');
});
