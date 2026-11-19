// Build 2903: the draft status line, autosave, Save draft & return, unsaved-change questions, sign-out warning and resume wiring.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const rd=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const {createDraftUI,collectFields,applyFields,savedLabel,nairobiTime,SECRET_NAME,LEAVE_TEXT,TAX_ASIDE_PREFIX,draftRow}=await import('../staff-drafts.mjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));

function setup(){
 const dom=new JSDOM('<body><dialog id="editor"><div id="editorBody"><form id="editForm"><input name="reference" value=""><textarea name="description"></textarea><input name="password" type="password"><input name="portal_token" value="x"><input name="agree" type="checkbox" value="yes"><select name="kind"><option>A</option><option>B</option></select><button type="button" id="addLine">+ Add line</button><button type="submit">Save</button></form></div></dialog></body>',{url:'https://staging.example/staff-pilot'});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 const calls=[],notices=[];let fail=null,returned=0;
 const request=async p=>{calls.push(p);if(fail)throw Error(fail);if(p.action==='form_draft_save')return {ok:true,saved_at:'2026-11-19T07:45:00Z',revision:'1'};return {ok:true};};
 const ui=createDraftUI({$:s=>dom.window.document.querySelector(s),request,notice:(m,bad)=>notices.push([m,!!bad]),document:dom.window.document,sessionStorage:dom.window.sessionStorage,autosaveMs:15,returnToQueue:()=>{returned++;}});
 return {dom,doc:dom.window.document,calls,notices,ui,request,form:dom.window.document.querySelector('#editForm'),setFail:m=>{fail=m;},returned:()=>returned};
}
const spec=(extra={})=>({kind:'ledger_journal',key:'ledger:p:q:new-adjustment',title:'Adjustment journal',project_id:'00000000-0000-4000-8000-000000000001',meta:{k:1},collect:()=>({lines:[{debit:'5'}]}),...extra});
const typeInto=(t,el,v)=>{el.value=v;el.dispatchEvent(new t.dom.window.Event('input',{bubbles:true}));};

test('the form values are read without secrets and put back in order',()=>{
 const t=setup();t.form.elements.reference.value='J-1';t.form.elements.description.value='Narration';t.form.elements.agree.checked=true;t.form.elements.kind.value='B';
 const f=collectFields(t.form);
 assert.deepEqual(f,{reference:'J-1',description:'Narration',agree:'yes',kind:'B'},'no password, no token, no buttons');
 for(const n of ['password','new_password','portal_token','api_key','Authorization'])assert.match(n,SECRET_NAME);
 assert.doesNotMatch('kra_pin',SECRET_NAME);
 const t2=setup();applyFields(t2.form,f);assert.equal(t2.form.elements.reference.value,'J-1');assert.equal(t2.form.elements.agree.checked,true);assert.equal(t2.form.elements.kind.value,'B');
 applyFields(t2.form,{password:'must-not-be-set',portal_token:'nor-this'});assert.equal(t2.form.elements.password.value,'');assert.equal(t2.form.elements.portal_token.value,'x');
 // repeated names (rows) are filled in order
 const dom=new JSDOM('<form><input name="code"><input name="code"><input name="code"></form>'),form=dom.window.document.forms[0];
 applyFields(form,{code:['a','b']});assert.deepEqual([...form.elements].map(e=>e.value),['a','b','']);
});

test('the status line shows the Nairobi time in a polite live region, saves a moment after typing stops, and never saves an untouched form',async()=>{
 const t=setup();t.ui.attach(t.form,spec());
 const status=t.doc.querySelector('.draft-status');assert.equal(status.getAttribute('role'),'status');assert.equal(status.getAttribute('aria-live'),'polite');
 assert.equal(status.textContent,'No changes yet.');await wait(40);assert.equal(t.calls.length,0,'nothing typed, nothing saved');
 typeInto(t,t.form.elements.reference,'J-9');
 assert.match(status.textContent,/Unsaved changes/);
 await wait(60);
 const save=t.calls.find(c=>c.action==='form_draft_save');assert.ok(save,'saved by itself');
 assert.equal(save.form_kind,'ledger_journal');assert.equal(save.subject_key,'ledger:p:q:new-adjustment');assert.equal(save.project_id,'00000000-0000-4000-8000-000000000001');
 assert.deepEqual(save.payload.fields,{reference:'J-9',description:'',kind:'A'});assert.deepEqual(save.payload.lines,[{debit:'5'}]);assert.deepEqual(save.payload.meta,{k:1});
 assert.equal(JSON.stringify(save.payload).includes('portal_token'),false,'no secret leaves the browser');
 assert.equal(status.textContent,'✓ All changes saved at 10:45 EAT','07:45 UTC is 10:45 in Nairobi');assert.equal(nairobiTime('2026-11-19T07:45:00Z'),'10:45');assert.equal(savedLabel('2026-11-19T07:45:00Z'),'✓ All changes saved at 10:45 EAT');
 assert.equal(t.ui.current().saved(),true);
});

test('adding or removing a line counts as a change, and a failed save is shown and keeps the form unsaved',async()=>{
 const t=setup();t.ui.attach(t.form,spec());
 t.doc.querySelector('#addLine').click();assert.equal(t.ui.current().dirty(),true,'a script-made change is caught');
 t.setFail('The draft is too large to keep. Save the form instead.');await wait(60);
 const status=t.doc.querySelector('.draft-status');assert.match(status.textContent,/Not saved yet: The draft is too large/);assert.equal(status.getAttribute('role'),'alert');assert.equal(t.ui.current().saved(),false);
 t.setFail(null);await t.ui.current().saveNow(false);assert.equal(t.ui.current().saved(),true);assert.equal(status.getAttribute('role'),'status');
});

test('Save draft & return to queue saves now, asks for it to be recorded, then returns',async()=>{
 const t=setup();t.ui.attach(t.form,spec());typeInto(t,t.form.elements.description,'half done');
 const btn=t.doc.querySelector('.draft-return');assert.equal(btn.textContent,'Save draft & return to queue');
 btn.click();await wait(30);
 const save=t.calls.filter(c=>c.action==='form_draft_save').pop();assert.equal(save.explicit,true,'an explicit save is recorded in the audit log');
 assert.equal(t.returned(),1);assert.match(t.notices.at(-1)[0],/Draft saved/);
 // if the save fails the person stays on the form
 const t2=setup();t2.ui.attach(t2.form,spec());typeInto(t2,t2.form.elements.description,'x');t2.setFail('offline');t2.doc.querySelector('.draft-return').click();await wait(40);assert.equal(t2.returned(),0);
});

test('closing with unsaved changes asks first; saved changes close without a question; submitting removes the draft',async()=>{
 const t=setup();t.ui.attach(t.form,spec());typeInto(t,t.form.elements.reference,'J-2');
 const leave=t.ui.confirmLeave();await wait(5);
 const dlg=t.doc.querySelector('dialog.leave-dialog');assert.ok(dlg,'the question is shown');assert.match(dlg.textContent,new RegExp(LEAVE_TEXT.replace('?','\\?')));
 assert.deepEqual([...dlg.querySelectorAll('button')].map(b=>b.textContent),['Keep editing','Save draft and leave','Leave without saving']);
 assert.equal(dlg.getAttribute('aria-labelledby'),'leaveTitle');
 dlg.querySelector('[data-leave=stay]').click();assert.equal(await leave,false);assert.equal(t.doc.querySelector('dialog.leave-dialog'),null);
 typeInto(t,t.form.elements.reference,'J-3');const leave2=t.ui.confirmLeave();await wait(0);t.doc.querySelector('[data-leave=save]').click();assert.equal(await leave2,true);assert.ok(t.calls.some(c=>c.action==='form_draft_save'&&c.explicit),'Save draft and leave saved it');
 assert.equal(await t.ui.confirmLeave(),true,'now saved: no question');
 const t3=setup();t3.ui.attach(t3.form,spec());typeInto(t3,t3.form.elements.reference,'x');
 const p=t3.ui.confirmLeave();await wait(5);t3.doc.querySelector('[data-leave=leave]').click();assert.equal(await p,true);
 const t4=setup();t4.ui.attach(t4.form,spec());await t4.ui.current().submitted();
 const gone=t4.calls.find(c=>c.action==='form_draft_discard');assert.deepEqual([gone.form_kind,gone.subject_key,gone.reason],['ledger_journal','ledger:p:q:new-adjustment','submitted']);assert.equal(t4.ui.current(),null);
 // a form that cannot be saved as a draft still asks, with two choices
 const t5=setup();const p5=t5.ui.confirmLeave();await wait(5);assert.deepEqual([...t5.doc.querySelectorAll('dialog.leave-dialog button')].map(b=>b.textContent),['Keep editing','Leave without saving']);
 t5.doc.querySelector('dialog.leave-dialog').dispatchEvent(new t5.dom.window.Event('cancel',{cancelable:true}));assert.equal(await p5,false,'Escape means keep editing');
});

test('signing out with unsaved work asks, offers a server draft, and clears the schedule kept in this tab',async()=>{
 const t=setup();
 assert.equal(await t.ui.beforeSignOut({editorEdited:false}),true,'nothing to lose: signs out at once');
 t.dom.window.sessionStorage.setItem(TAX_ASIDE_PREFIX+'client-1','{"firm_id":"f"}');
 const stay=t.ui.beforeSignOut({editorEdited:false});await wait(5);
 const dlg=t.doc.querySelector('dialog.leave-dialog');assert.match(dlg.textContent,/client set-up schedule kept only in this browser tab/);
 assert.deepEqual([...dlg.querySelectorAll('button')].map(b=>b.textContent),['Stay signed in','Save as a draft and sign out','Sign out without saving']);
 dlg.querySelector('[data-leave=stay]').click();assert.equal(await stay,false);assert.equal(t.dom.window.sessionStorage.getItem(TAX_ASIDE_PREFIX+'client-1'),'{"firm_id":"f"}','staying keeps it');
 const save=t.ui.beforeSignOut({editorEdited:false});await wait(5);t.doc.querySelector('[data-leave=save]').click();assert.equal(await save,true);
 const s=t.calls.find(c=>c.action==='form_draft_save');assert.equal(s.form_kind,'client_edit');assert.equal(s.subject_key,'client-schedule:client-1');assert.equal(s.client_id,'client-1');assert.deepEqual(s.payload.aside,{[TAX_ASIDE_PREFIX+'client-1']:'{"firm_id":"f"}'});
 assert.equal(t.dom.window.sessionStorage.getItem(TAX_ASIDE_PREFIX+'client-1'),null,'nothing client-related stays in the browser after sign-out');
 // an open form with unsaved changes and a draft controller
 const t2=setup();t2.ui.attach(t2.form,spec());typeInto(t2,t2.form.elements.reference,'J-3');
 const p=t2.ui.beforeSignOut({editorEdited:true});await wait(5);t2.doc.querySelector('[data-leave=save]').click();assert.equal(await p,true);assert.ok(t2.calls.some(c=>c.action==='form_draft_save'&&c.explicit));
 // if the draft cannot be saved the person stays signed in
 const t3=setup();t3.ui.attach(t3.form,spec());typeInto(t3,t3.form.elements.reference,'J-4');t3.setFail('offline');
 const p3=t3.ui.beforeSignOut({editorEdited:true});await wait(5);t3.doc.querySelector('[data-leave=save]').click();assert.equal(await p3,false);assert.match(t3.notices.at(-1)[0],/still signed in/);
});

test('resuming reads the draft, hands it to the form that registered for its kind, and a draft with no opener says so',async()=>{
 const t=setup();let opened=null;
 t.ui.register('ledger_journal',async d=>{opened=d;});
 const ask=t.ui.resume;
 const ui=createDraftUI({$:()=>null,request:async p=>p.draft_id==='gone'?{draft:null}:{draft:{draft_id:p.draft_id,form_kind:p.draft_id==='odd'?'nothing':'ledger_journal',payload:{fields:{reference:'J-5'}}}},notice:(m,bad)=>t.notices.push([m,bad]),document:t.doc,sessionStorage:t.dom.window.sessionStorage});
 ui.register('ledger_journal',async d=>{opened=d;});
 assert.equal(await ui.resume('d1'),true);assert.equal(opened.payload.fields.reference,'J-5');
 assert.equal(await ui.resume('gone'),false);assert.match(t.notices.at(-1)[0],/no longer available/);
 assert.equal(await ui.resume('odd'),false);assert.match(t.notices.at(-1)[0],/cannot be reopened/);
 assert.match(draftRow({id:'d1',title:'Adjustment journal · J-5',client_name:'Fictional Client',project_name:'Fictional accounting'}),/data-draft-resume="d1"[^>]*>Resume draft[\s\S]*data-draft-discard="d1"/);
});

test('the screens are wired: modal option, leave question, page-leave warning, sign-out, work queue row, openers, cache tokens',()=>{
 const pilot=rd('staff-pilot.mjs'),ledger=rd('staff-ledger.mjs'),imp=rd('staff-improvements.mjs'),queue=rd('staff-work-queue.mjs'),v6=rd('staff-workspace-v6.mjs'),css=rd('staff-pilot.css');
 assert.match(pilot,/onBack=null,draft=null\}=\{\}\)/);assert.match(pilot,/if\(draft&&drafts\)drafts\.attach\(form,draft\)/);assert.match(pilot,/await drafts\?\.current\(\)\?\.submitted\(\)/);
 assert.match(pilot,/if\(editorEdited&&drafts&&!\(await drafts\.confirmLeave\(\)\)\)return;/,'Return to list asks first');
 assert.match(pilot,/addEventListener\?\.\('beforeunload'/);assert.match(pilot,/event\.preventDefault\(\);event\.returnValue=''/);
 assert.match(pilot,/logout:async\(\)=>\{if\(await drafts\.beforeSignOut\(\{editorEdited:editorEdited&&\$\('#editor'\)\.open\}\)\)signedOut\('Signed out\.'\);\}/);
 assert.match(pilot,/function showSignedOut\(message=''\)\{drafts\?\.detach\(\);drafts\?\.clearAsides\(\);/);
 for(const k of ['ledger_journal','client_activity','client_edit'])assert.match(pilot,new RegExp("drafts\\.register\\('"+k+"'"));
 assert.match(pilot,/b\.dataset\.draftResume/);assert.match(pilot,/confirmDiscard/);assert.match(pilot,/kind:'client_edit',key:c\.client_id\?`client:\$\{c\.client_id\}`:'client:new'/);
 assert.match(ledger,/\{draft:journalDraft\(kind,j\)\}/);assert.match(ledger,/async function resumeDraft\(d\)/);assert.match(v6,/resumeJournalDraft:d=>ledger\.resumeDraft\(d\)/);
 assert.match(imp,/kind:'client_activity'/);assert.match(imp,/async function resumeActivityDraft/);assert.match(queue,/x\.kind==='draft'\?/);assert.match(queue,/data-draft-resume/);
 for(const f of [pilot.match(/staff-drafts\.mjs\?v=([\w-]+)/)[1],imp.match(/staff-drafts\.mjs\?v=([\w-]+)/)[1]])assert.equal(f,'20261119-drafts2-v1','one cache token for the new module');
 assert.match(pilot,/staff-work-queue\.mjs\?v=20261119-draft-v1/);assert.match(pilot,/staff-workspace-v6\.mjs\?v=20261119-drafts2-v1/);assert.match(pilot,/staff-improvements\.mjs\?v=20261119-drafts2-v1/);assert.match(v6,/staff-ledger\.mjs\?v=20261119-drafts2-v1/);
 assert.match(css,/\.draft-bar\{/);assert.match(css,/\.leave-dialog\{/);
});
