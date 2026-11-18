import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import fs from 'node:fs';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<body><div id="out"></div></body>',{url:'https://backend-staging-foundation.pcl-crm.pages.dev/staff-pilot'});
globalThis.document=dom.window.document;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calls=[],shown=[],notices=[];let reply={};
const request=async p=>{calls.push(p);const r=reply[p.action];return typeof r==='function'?r(p):r;};
const ctx={esc,request,notice:(m,e)=>notices.push([m,e]),shortDate:v=>String(v).slice(0,10),
 field:(n,l,v='',t='text',x='')=>`<label>${l}<input name="${n}" value="${esc(v)}" ${x}></label>`,form:(h,b)=>`<form>${h}<button>${b}</button></form>`};
const {createPagesUI}=await import('../staff-pages.mjs');
let changed=0;
const ui=createPagesUI(ctx,{payload:a=>({action:a,period_id:'p'}),show:(t,h,submit,done)=>{shown.push({t,h,submit,done});document.querySelector('#out').innerHTML=h;},onChange:()=>{changed++;}});
const rd=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const click=async(a,id)=>{const el=id?document.querySelector(`[data-pages="${a}"][data-id="${id}"]`):document.querySelector(`[data-pages="${a}"]`);el.click();await new Promise(r=>setTimeout(r,10));};
const fd=o=>{const m=new Map(Object.entries(o));return {get:k=>{const v=m.get(k);return Array.isArray(v)?v[0]:v===undefined?null:v;},getAll:k=>{const v=m.get(k);return v===undefined?[]:Array.isArray(v)?v:[v];},has:k=>m.has(k)};};
const field=(key,label,required=true,multiline=true)=>({key,label,min:2,max:300,required,multiline});
const dd=(code,title,o={})=>({code,title,fields:[field('bankers','Principal bankers',true,false)],can_be_not_applicable:code!=='ENTITY_INFO',state:'Not declared',approved:null,draft:null,returned:null,declared_by_me:false,can_review:false,prefill:null,...o});
const v=(o={})=>({page_id:'g1',version:1,state:'Declared',fields:{bankers:'Fictional Bank'},reason:null,declared_name:'Assistant One',declared_at:'2026-11-10T08:00:00Z',reviewed_name:null,reviewed_at:null,review_note:null,sole_partner_approval:false,...o});
const pg=(code,title,state,o={})=>({code,title,kind:'declared',state,blocks:[],problems:[],...o});
const base=(o={})=>({pages:[pg('COVER','Cover','Ready',{blocks:[{type:'title',text:'Fictional Mlima Traders'},{type:'text',text:'For the year ended 31 December 2026'}]}),pg('ENTITY_INFO','Entity information','Not ready',{problems:['The bankers, auditors and other lines are not declared yet.']}),pg('RESPONSIBILITIES','Statement of directors’ responsibilities','Not ready',{problems:['The statement of responsibilities is not declared yet.']}),
 pg('STATISTICS','Key figures','Ready',{blocks:[{type:'figures',unit:'KES',rows:[{label:'Revenue',current_text:'1,500,000',prior_text:'1,000,000'}]}]})],
 declared:[dd('ENTITY_INFO','Entity information'),dd('RESPONSIBILITIES','Statement of directors’ responsibilities',{fields:[field('statement','Statement of responsibilities',true,true)],prefill:{statement:'Draft statement text.',signatory_choices:['Fictional Amani Director','Fictional Zawadi Director'],note:'This text is a draft to read and change.'}})],
 complete:false,problems:['x'],candidates:[],locked:false,can_declare:true,note:'The cover and the key figures are built from verified client facts.',...o});

test('the pages show what is ready and what is missing; the cover and key figures cannot be declared',async()=>{
 reply={ledger_pages_read:base()};await ui.open();
 const t=document.querySelector('#out').textContent;
 assert.match(t,/Fictional Mlima Traders/);assert.match(t,/1,500,000/);assert.match(t,/not declared yet/);assert.match(t,/Not complete/);
 assert.ok(document.querySelector('[data-pages="declare"][data-id="ENTITY_INFO"]'));assert.equal(document.querySelector('[data-pages="declare"][data-id="COVER"]'),null);
});
test('declaring: the form sends the fields; a page that may not apply offers that choice with a reason',async()=>{
 reply={ledger_pages_read:base({pages:[pg('REPORT','Report of the directors','Not ready',{problems:['not declared yet']})],declared:[dd('REPORT','Report of the directors',{fields:[field('review','Review of the business',true,true)]})]}),ledger_page_declare:{page_id:'x'}};await ui.open();
 await click('declare','REPORT');let h=shown.at(-1).h;assert.match(h,/does not apply \(a Partner approves this\)/);assert.match(h,/name="f_review"/);
 await shown.at(-1).submit(fd({state:'Declared',f_review:'Fictional review text.'}));
 let c=calls.filter(x=>x.action==='ledger_page_declare').at(-1);assert.equal(c.code,'REPORT');assert.equal(c.state,'Declared');assert.deepEqual(c.fields,{review:'Fictional review text.'});
 await shown.at(-1).submit(fd({state:'Not applicable',reason:'No report is produced for this client.'}));
 c=calls.filter(x=>x.action==='ledger_page_declare').at(-1);assert.equal(c.state,'Not applicable');assert.equal(c.reason,'No report is produced for this client.');assert.equal(c.fields,undefined);
 await shown.at(-1).done?.();assert.ok(changed>0);
 reply.ledger_pages_read=base();await ui.open();await click('declare','ENTITY_INFO');assert.doesNotMatch(shown.at(-1).h,/does not apply/,'entity information always applies');
});
test('the statement of responsibilities starts from the draft text and offers only people on the client record',async()=>{
 reply={ledger_pages_read:base(),ledger_page_declare:{page_id:'x'}};await ui.open();await click('declare','RESPONSIBILITIES');
 const h=shown.at(-1).h;assert.match(h,/Draft statement text\./);assert.match(h,/value="Fictional Amani Director"/);assert.match(h,/value="Fictional Zawadi Director"/);assert.match(h,/draft to read and change/);
 await shown.at(-1).submit(fd({state:'Declared',f_statement:'Edited statement text.',approved_on:'2027-02-15',signatories:['Fictional Amani Director','Fictional Zawadi Director']}));
 const c=calls.filter(x=>x.action==='ledger_page_declare').at(-1);assert.equal(c.code,'RESPONSIBILITIES');assert.deepEqual(c.fields,{statement:'Edited statement text.',approved_on:'2027-02-15',signatories:['Fictional Amani Director','Fictional Zawadi Director']});
});
test('a page waiting for approval shows Approve and Return only to a reviewer; one they declared needs the sole-Partner confirmation',async()=>{
 const d=dd('ENTITY_INFO','Entity information',{state:'Waiting for approval',draft:v(),can_review:true});
 reply={ledger_pages_read:base({declared:[d]}),ledger_page_review:{status:'Approved'}};await ui.open();
 assert.match(document.querySelector('#out').textContent,/Waiting for approval/);
 await click('approve','g1');let c=calls.filter(x=>x.action==='ledger_page_review').at(-1);assert.equal(c.decision,'Approved');assert.equal(c.page_id,'g1');assert.equal(c.sole_partner_approval,undefined);
 await click('return','g1');assert.match(shown.at(-1).h,/at least 10 characters/);await shown.at(-1).submit(fd({review_note:'Add the second banker, please.'}));
 c=calls.filter(x=>x.action==='ledger_page_review').at(-1);assert.equal(c.decision,'Returned');assert.equal(c.review_note,'Add the second banker, please.');
 reply.ledger_pages_read=base({declared:[{...d,declared_by_me:true}]});await ui.open();await click('approve','g1');assert.match(shown.at(-1).h,/only Partner/);
 await shown.at(-1).submit(fd({sole:'on'}));c=calls.filter(x=>x.action==='ledger_page_review').at(-1);assert.equal(c.sole_partner_approval,true);
 reply.ledger_pages_read=base({declared:[{...d,can_review:false}]});await ui.open();assert.equal(document.querySelector('[data-pages="approve"]'),null);
});
test('a locked pack offers no change',async()=>{
 reply={ledger_pages_read:base({locked:true,can_declare:false})};await ui.open();
 assert.match(document.querySelector('#out').textContent,/locked by an audit/);assert.equal(document.querySelector('[data-pages="declare"]'),null);
});
test('wiring: the annual pack has the button and the cache token',()=>{
 const led=rd('staff-ledger.mjs');
 assert.match(led,/staff-pages\.mjs\?v=20261128-pages-v1/);assert.match(led,/btn\('pages','Client pages'\)/);assert.match(led,/a==='pages'\)\{await pagesScr\(\)\.open\(\);return;\}/);
});
