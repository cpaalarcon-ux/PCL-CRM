import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><dialog id="editor"><div id="editorBody"></div></dialog></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const C='00000000-0000-4000-8000-000000000001';
const fact=(k,v,x={})=>({fact_id:'f-'+k,value:v,source_kind:'Online register',source_reference:'iTax',status:'Recorded',recorded_by:'other',recorded_by_name:'Preparer One',recorded_at:'2026-11-10T08:00:00Z',revision:'1',...x});
const row=(key,label,o={})=>({key,label,state:o.fact?o.fact.status:'Missing',fact:o.fact||null,optional:!!o.optional,can_verify:!!o.can_verify,issue:null});
const view=(over={})=>({client:{client_id:C,company_name:'Fictional Trading Limited',kra_pin:'A000000001Z',legal_entity_type:'Limited company',legal_structure:'Non-Individual',legal_subtype:'Company'},
 rows:[row('kra_pin','KRA PIN',{fact:fact('kra_pin','A000000001Z',{status:'Verified',verified_by:'v',verified_by_name:'Verifier Two',verified_at:'2026-11-11T08:00:00Z'})}),row('company_name','Company name',{fact:fact('company_name','Fictional Trading Limited',{can_verify:true}),can_verify:true}),
  row('registration_number','Registration number'),row('street_road','Street / Road'),row('county','County'),row('postal_code','Postal code'),row('po_box','P.O. Box'),row('commencement_date','Business commencement date'),row('contact_email','Main email'),row('telephone','Telephone',{optional:true})],
 source_kinds:['Document','Online register','Prior record','Import','Client statement'],note:'Facts are checked by a different person.',template:{template_code:'COMPANY'},history:[],...over});
const calls=[];let responses=[];
const request=async p=>{calls.push(p);const r=responses.shift();if(r instanceof Error)throw r;return typeof r==='function'?r(p):r;};
const notices=[];const state={me:{staff_id:'me',category_code:'ASSISTANT'},documents:[],suite:{compliance:[]}};
const {createKycGridUI}=await import('../staff-kyc-grid.mjs');
const ui=createKycGridUI({esc,request,notice:m=>notices.push(m),shortDate:v=>String(v||'').slice(0,10),data:()=>state},{show:(t,h)=>{$('#editorBody').innerHTML=h;}});
const pause=()=>new Promise(r=>setTimeout(r,10));
const W=dom.window;
const cell=k=>$(`[data-kg="${k}"]`),box=k=>$(`[data-kg-cell="${k}"]`);
const type=(k,v)=>{const el=cell(k);el.value=v;el.dispatchEvent(new W.Event('input',{bubbles:true}));};
const leave=k=>cell(k).dispatchEvent(new W.FocusEvent('focusout',{bubbles:true}));
const key=(k,name,extra={})=>cell(k).dispatchEvent(new W.KeyboardEvent('keydown',{key:name,bubbles:true,cancelable:true,...extra}));
const open=async(v=view())=>{calls.length=0;responses=[v];await ui.open(C);};

test('the page follows the iTax layout and marks mandatory cells with a red asterisk',async()=>{
 await open();
 assert.match($('.kg-title').textContent,/Non-Individual taxpayer profile/);
 assert.deepEqual($$('.kg-bar').map(x=>x.textContent).slice(0,2),['PIN Details','Section A : Basic Information']);
 assert.ok($$('.kg-grp legend').map(x=>x.textContent).includes('Principal Physical Address'));
 assert.ok($('#kg-street_road').closest('.kg-v').previousElementSibling.querySelector('.kg-star'),'mandatory cell has an asterisk');
 assert.equal($('#kg-telephone').closest('.kg-v').previousElementSibling.querySelector('.kg-star'),null,'optional cell has none');
 assert.ok(box('street_road').classList.contains('kg-req'),'empty mandatory cell is marked before it is touched');
 assert.ok(!box('telephone').classList.contains('kg-req'));
 assert.equal(cell('kra_pin').value,'A000000001Z');assert.ok(box('kra_pin').classList.contains('kg-ver'));
 assert.match($('#kgChip').textContent,/DRAFT/);assert.match($('#kgCount').textContent,/of 9 mandatory|of \d+ mandatory/);
 assert.equal(document.querySelector('#editor').classList.contains('ledger-dialog'),true);
});

test('leaving an empty mandatory cell turns it red, typing clears it, and nothing stops the person moving on',async()=>{
 await open();
 leave('county');assert.ok(box('county').classList.contains('kg-bad'));assert.equal(cell('county').getAttribute('aria-invalid'),'true');assert.match($('#kgm-county').textContent,/./);
 leave('telephone');assert.ok(!box('telephone').classList.contains('kg-bad'),'optional empty is fine');
 type('county','Nairobi');assert.ok(!box('county').classList.contains('kg-bad'));assert.ok(box('county').classList.contains('kg-dirty'));
 assert.match($('#kgDirty').textContent,/1 unsaved/);
 assert.equal($('[data-kg-act="save"]').disabled,false);
});

test('Enter and the arrow keys move between cells like a spreadsheet',async()=>{
 await open();
 const first=cell('street_road');first.focus();
 key('street_road','Enter');const below=document.activeElement;assert.ok(below&&below!==first&&below.dataset.kg,'moved');
 assert.equal(+below.dataset.c,+first.dataset.c);assert.equal(+below.dataset.r,+first.dataset.r+1);
 key(below.dataset.kg,'ArrowUp');assert.equal(document.activeElement,first);
 key('street_road','Enter',{shiftKey:true});assert.equal(+document.activeElement.dataset.r,+first.dataset.r-1);
});

test('dates are typed as dd/mm/yyyy and saved as one batch with the source, only for changed cells',async()=>{
 await open();
 type('commencement_date','5/3/2020');leave('commencement_date');assert.equal(cell('commencement_date').value,'05/03/2020');
 type('street_road','Fictional Road');leave('street_road');
 type('postal_code','00100');leave('postal_code');
 responses=[view({rows:view().rows.map(r=>['commencement_date','street_road','postal_code'].includes(r.key)?{...r,state:'Recorded',fact:fact(r.key,r.key==='commencement_date'?'2020-03-05':r.key==='street_road'?'Fictional Road':'00100')}:r)}).rows&&{...view(),saved:true,count:3,unchanged:0,errors:[],rows:view().rows.map(r=>['commencement_date','street_road','postal_code'].includes(r.key)?{...r,state:'Recorded',fact:fact(r.key,r.key==='commencement_date'?'2020-03-05':r.key==='street_road'?'Fictional Road':'00100')}:r)}];
 calls.length=0;$('[data-kg-act="save"]').click();await pause();
 const p=calls[0];assert.equal(p.action,'client_master_record_many');assert.equal(p.client_id,C);
 assert.deepEqual(p.cells.map(c=>c.field_key).sort(),['commencement_date','postal_code','street_road']);
 assert.equal(p.cells.find(c=>c.field_key==='commencement_date').value,'2020-03-05');
 assert.equal(p.source_kind,'Online register');assert.match(p.source_reference,/iTax/);
 assert.match(notices.at(-1),/Saved 3 cells/);assert.match($('#kgDirty').textContent,/No unsaved/);
 assert.equal(cell('commencement_date').value,'05/03/2020','saved date is shown in the normal way');
});

test('a bad cell stops the save before it reaches the server and is marked red',async()=>{
 await open();
 type('postal_code','abc');type('commencement_date','31/02/2020');
 calls.length=0;$('[data-kg-act="save"]').click();await pause();
 assert.equal(calls.length,0,'nothing sent');assert.ok(box('postal_code').classList.contains('kg-bad'));assert.ok(box('commencement_date').classList.contains('kg-bad'));
 assert.match(notices.at(-1),/need attention/);
});

test('the server refusing a cell marks it red and keeps what was typed',async()=>{
 await open();
 type('county','Nairobi');
 responses=[{...view(),saved:false,count:0,unchanged:0,errors:[{field_key:'county',error:'County is not valid.'}]}];
 $('[data-kg-act="save"]').click();await pause();
 assert.ok(box('county').classList.contains('kg-bad'));assert.match($('#kgm-county').textContent,/not valid/);
});

test('replacing a saved value asks for a reason before anything is sent',async()=>{
 await open();
 type('kra_pin','A000000002Z');
 assert.ok($('#kgReason'),'the reason box appears');
 calls.length=0;$('[data-kg-act="save"]').click();await pause();
 assert.equal(calls.length,0);assert.match(notices.at(-1),/why/i);
});

test('only a reviewer sees the verify button, and it sends the recorded cells it may verify',async()=>{
 await open();assert.equal($('[data-kg-act="verify-open"]'),null,'an assistant sees no verify button');
 state.me.category_code='SUPERVISOR';await open();
 assert.ok($('[data-kg-act="verify-open"]'));$('[data-kg-act="verify-open"]').click();
 $('#kgNote').value='Checked against the iTax profile';
 responses=[{...view(),verified_count:1,skipped:[]}];calls.length=0;$('[data-kg-act="verify-go"]').click();await pause();
 assert.equal(calls[0].action,'client_master_verify_many');assert.deepEqual(calls[0].facts,[{fact_id:'f-company_name',revision:'1'}]);assert.match(calls[0].note,/iTax/);
 state.me.category_code='ASSISTANT';
});

test('the approval trail and the Partner step come from today\'s rules',async()=>{
 state.suite.compliance=[{client_id:C,is_pep:true,risk_rating:'Low',edd_approved_by:null}];
 await open();
 assert.match($('.kg-side').textContent,/Prepared by/);assert.match($('.kg-side').textContent,/Preparer One/);assert.match($('.kg-side').textContent,/Verifier Two/);
 assert.match($('.kg-side').textContent,/Waiting for a Partner/);
 state.suite.compliance=[];
});
