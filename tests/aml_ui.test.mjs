import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><dialog id="editor"><div id="editorBody"></div></dialog></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;globalThis.FormData=dom.window.FormData;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const C='00000000-0000-4000-8000-000000000001',W=dom.window;
const L=(category,value,attention=false)=>({lookup_id:'l-'+value,category,value,attention,status:'Confirmed',source:'Test'});
const lookups=[L('COUNTRY','Kenya'),L('COUNTRY','Uganda'),L('PEP_TYPE','No known PEP'),L('PEP_TYPE','Domestic PEP',true),L('SOURCE_OF_FUNDS','Business income'),L('SERVICE_ACTIVITY','Audit'),L('SERVICE_ACTIVITY','Managing client money or assets',true),L('RISK_INDICATOR','Nominee arrangements',true)];
const base=(over={})=>({client:{client_id:C,company_name:'Fictional Trading Limited',kra_pin:'A000000001Z'},profile:null,selections:[],lookups,kyc:null,decisions:[],attention:[],
 missing:[{key:'purpose_of_relationship',label:'Purpose of the relationship'},{key:'expected_activity',label:'Expected activity'},{key:'pep_type',label:'PEP status'},{key:'screening_status',label:'Screening result'},{key:'COUNTRY:Incorporation or residence',label:'Country of incorporation or residence'},{key:'SOURCE_OF_FUNDS',label:'Source of funds'},{key:'SERVICE_ACTIVITY',label:'Services'}],
 status:{code:'INFO_NEEDED',label:'Information needed',next:'7 items still needed before the profile can go to the MLRO.'},can:{edit:true,submit:false,decide:false,is_mlro:false},gate_enforced:false,
 documents:[{doc_ref:'DOC-2026-00001',file_name:'CR12.pdf',category:'Permanent File'}],options:{countries_contexts:['Incorporation or residence','Business operations','Counterparties','Source of funds'],screening:['Not screened','No match','Potential match','Confirmed match'],ratings:['Low','Medium','High'],decisions:['Accept','Accept with conditions','Restrict','Decline'],categories:{COUNTRY:'Countries'},pep_none:'No known PEP'},note:'Test note.',...over});
const calls=[];let responses=[];const notices=[];
const request=async p=>{calls.push(p);const r=responses.shift();if(r instanceof Error)throw r;return typeof r==='function'?r(p):r;};
const {createAmlUI}=await import('../staff-aml.mjs');
const ui=createAmlUI({esc,request,notice:m=>notices.push(m),shortDate:v=>String(v||'').slice(0,10),data:()=>({})},{show:(t,h)=>{$('#editorBody').innerHTML=h;}});
const pause=()=>new Promise(r=>setTimeout(r,10));
const open=async v=>{calls.length=0;responses=[v];await ui.open(C);};
const setv=(sel,v,ev='change')=>{const el=$(sel);el.value=v;el.dispatchEvent(new W.Event(ev,{bubbles:true}));};
const click=async s=>{$(s).click();await pause();};

test('the profile opens as "Information needed" with mandatory items marked and nothing decided by staff',async()=>{
 await open(base());
 assert.match($('#amChip').textContent,/Information needed/);
 assert.ok($('#am-purpose_of_relationship').closest('.am-row').classList.contains('am-req'),'an empty mandatory item is marked red');
 assert.ok($('#am-purpose_of_relationship').closest('.am-row').querySelector('.kg-star'));
 assert.equal($('[data-amd]'),null,'staff see no decision panel');
 assert.equal($('[data-am-act="submit"]').disabled,true,'cannot refer before the profile is saved');
 assert.equal($$('.kg-miss li').length,7);
 assert.match($('.kg-side').textContent,/Prepared by/);
});
test('values come from the MLRO\'s list; a flagged value is marked; added values can be removed; PEP details appear for a flagged PEP type',async()=>{
 await open(base());
 setv('[data-am-pick="COUNTRY|Incorporation or residence"]','Kenya');
 assert.match($('.am-chips').textContent,/Kenya/);
 setv('[data-am-pick="SERVICE_ACTIVITY|"]','Managing client money or assets');
 assert.ok($('.am-chip.am-flag'),'a value the MLRO looks at first is flagged');
 assert.ok(![...$$('[data-am-pick="SERVICE_ACTIVITY|"] option')].some(o=>o.textContent==='Managing client money or assets'),'a chosen value leaves the list');
 await click('[data-am-remove="1"]');assert.ok(!$('.am-chip.am-flag'));
 assert.equal($('#am-pep_role'),null);setv('#am-pep_type','Domestic PEP');assert.ok($('#am-pep_role'),'PEP details appear');assert.ok($('#am-pep_doc_ref'));
 assert.match($('#amDirty').textContent,/Unsaved/);
});
test('saving sends the facts and selections with evidence references, and server errors are shown on the item',async()=>{
 await open(base());
 setv('#am-purpose_of_relationship','Annual tax compliance','input');
 setv('[data-am-pick="COUNTRY|Incorporation or residence"]','Kenya');
 setv('[data-am-doc="0"]','DOC-2026-00001');
 responses=[{...base(),saved:false,errors:[{key:'purpose_of_relationship',error:'Purpose is too long.'}]}];calls.length=0;
 await click('[data-am-act="save"]');
 const b=calls[0];assert.equal(b.action,'aml_profile_save');assert.equal(b.client_id,C);assert.equal(b.fields.purpose_of_relationship,'Annual tax compliance');
 assert.deepEqual(b.selections,[{category:'COUNTRY',context:'Incorporation or residence',value:'Kenya',note:undefined,doc_ref:'DOC-2026-00001'}]);
 assert.match($('.am-bad .am-msg').textContent,/too long/);
});
test('after saving, the profile can be referred; the revision is sent so a stale screen is refused',async()=>{
 const saved=base({profile:{revision:'3',stage:'Staff review',purpose_of_relationship:'x',screening_status:'No match',last_edited_by_name:'Preparer One'},missing:[],status:{code:'STAFF_REVIEW',label:'Staff review',next:'Everything is filled.'},can:{edit:true,submit:true,decide:false,is_mlro:false}});
 await open(saved);assert.equal($('[data-am-act="submit"]').disabled,false);assert.match($('.kg-side').textContent,/Preparer One/);
 responses=[{...saved,profile:{...saved.profile,stage:'MLRO review',revision:'4'},status:{code:'MLRO_REVIEW',label:'MLRO review',next:'Waiting for the MLRO.'}}];calls.length=0;
 await click('[data-am-act="submit"]');
 assert.equal(calls[0].action,'aml_profile_submit');assert.equal(calls[0].revision,'3');assert.match($('#amChip').textContent,/MLRO review/);assert.match(notices.at(-1),/Referred to the MLRO/);
});
test('only the MLRO sees the decision panel; it sends the decision, shows missing items in red, and can return or ask for EDD',async()=>{
 const referred=base({profile:{revision:'4',stage:'MLRO review',screening_status:'No match'},missing:[],status:{code:'MLRO_REVIEW',label:'MLRO review',next:'Waiting for the MLRO.'},can:{edit:true,submit:false,decide:true,is_mlro:true}});
 await open(referred);assert.ok($('[data-amd="risk_rating"]'));
 responses=[{...referred,decided:false,errors:[{key:'risk_rating',error:'Choose the risk rating.'}]}];calls.length=0;
 await click('[data-am-act="decide"]');assert.equal(calls[0].action,'aml_decide');assert.equal(calls[0].revision,'4');assert.match($('.am-decide .am-msg').textContent,/risk rating/);
 setv('#amd-risk_rating','Low','change');setv('#amd-risk_reasons','Routine local client with clear records','input');setv('#amd-decision','Accept');setv('#amd-next_review','2027-11-17','input');
 responses=[{...referred,decided:true,profile:{...referred.profile,stage:'Decided',decision:'Accept',risk_rating:'Low',next_review:'2027-11-17'},status:{code:'APPROVED',label:'Approved',next:'Approved by the MLRO.'},can:{...referred.can,decide:false}}];calls.length=0;
 await click('[data-am-act="decide"]');
 assert.equal(calls[0].risk_rating,'Low');assert.equal(calls[0].decision,'Accept');assert.equal(calls[0].next_review,'2027-11-17');assert.match($('#amChip').textContent,/Approved/);assert.equal($('[data-amd]'),null);
 await open(referred);calls.length=0;await click('[data-am-act="edd"]');assert.equal(calls.length,0,'asking for EDD needs a note');assert.match($('.am-decide .am-msg').textContent,/what staff must add/i);
 setv('#amd-ask','Please obtain source of wealth evidence','input');responses=[{...referred,status:{code:'EDD_REQUIRED',label:'EDD required',next:'x'},profile:{...referred.profile,stage:'Staff review',edd_required:true}}];
 await click('[data-am-act="edd"]');assert.equal(calls[0].action,'aml_edd_request');assert.match(calls[0].note,/source of wealth/);
});
test('the MLRO workspace shows the queue, the lists and the policy forms, and posts through the server',async()=>{
 const item=(n,x={})=>({client_id:C,company_name:n,status:'MLRO review',risk_rating:null,next_review:null,attention:['PEP: Domestic PEP'],...x});
 const ov={queue:{waiting:[item('Waiting Ltd')],edd:[],matches:[],review_due:[],high_risk:[]},counts:{profiles:1,without_profile:4,starter_values:2},lookups:[{...L('COUNTRY','Kenya'),status:'Starter'},L('PEP_TYPE','Domestic PEP',true)],policy:{gate_enforced:false},approvals:[],mlro_holders:[{full_name:'Fictional Manager',expires_on:'2027-01-01'}],can_approve_policy:true,categories:{COUNTRY:'Countries',PEP_TYPE:'PEP status'},note:'You maintain the lists.'};
 calls.length=0;responses=[ov];await ui.openOverview();
 assert.match($('[data-am-ov]').textContent,/Waiting Ltd/);assert.match($('[data-am-ov]').textContent,/Fictional Manager/);assert.match($('[data-am-ov]').textContent,/4 clients without a profile/);
 assert.ok($('[data-am-confirm="COUNTRY"]'),'starter values can be confirmed');
 responses=[{ok:true},ov];calls.length=0;await click('[data-am-confirm="COUNTRY"]');assert.equal(calls[0].action,'aml_lookup_confirm');assert.deepEqual(calls[0].lookup_ids,['l-Kenya']);
 const f=$('form[data-am-add="PEP_TYPE"]');f.querySelector('[name=value]').value='International organisation function';f.querySelector('[name=source]').value='MLRO review';
 responses=[{ok:true},ov];calls.length=0;f.dispatchEvent(new W.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.equal(calls[0].action,'aml_lookup_add');assert.equal(calls[0].category,'PEP_TYPE');assert.equal(calls[0].attention,false);
 const g=$('form[data-am-policy]');g.querySelector('[name=reference]').value='Board minute 4/2026';responses=[{ok:true},ov];calls.length=0;g.dispatchEvent(new W.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.equal(calls[0].action,'aml_policy_approve');assert.equal(calls[0].reference,'Board minute 4/2026');
 const gt=$('form[data-am-gate]');gt.querySelector('[name=reason]').value='Lists approved';responses=[{ok:true},ov];calls.length=0;gt.dispatchEvent(new W.Event('submit',{bubbles:true,cancelable:true}));await pause();
 assert.equal(calls[0].action,'aml_gate_set');assert.equal(calls[0].enforced,true);
 responses=[new Error('Only the appointed MLRO or an Engagement Partner does this.')];await ui.openOverview().catch(e=>notices.push(e.message));assert.match(notices.at(-1),/MLRO/);
});
