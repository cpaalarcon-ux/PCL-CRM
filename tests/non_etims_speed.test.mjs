import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createNonEtimsUI} from '../staff-non-etims.mjs';

const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const dom=new JSDOM('<dialog id="editor"><h2 id="title"></h2><div id="editorBody"></div></dialog><form id="editForm"><div id="neException"></div><button type="submit">Save</button></form>',{url:'https://example.test/staff-pilot'});
globalThis.document=dom.window.document;
const $=s=>document.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bases=[{basis_id:'b1',basis_code:'NE-TICKET',legal_category:'Travel',label:'Ticket',guidance:'g',legal_reference:'ref',status:'Active',revision:1,used:0}];
const calls=[];let release;
const request=p=>{calls.push(p);if(p.action==='non_etims_bases')return p.light?Promise.resolve({bases,categories:['Travel'],can_approve:true,can_edit:true}):new Promise(r=>{release=()=>r({bases:bases.map(b=>({...b,used:3})),categories:['Travel'],can_approve:true,can_edit:true});});return Promise.resolve({duplicates:{},window_days:7});};
const shown=[];
const ctx={$,esc,request,data:()=>({documents:[]}),modal:(title,body)=>{shown.push({title,body});$('#title').textContent=title;$('#editorBody').innerHTML=body;},form:(b)=>b,field:()=>'',select:()=>'',area:()=>'',check:()=>'',button:(a,l)=>`<button data-x="${a}">${l}</button>`,table:(h,rows)=>`<table>${rows.map(r=>`<tr><td>${r.join('</td><td>')}</td></tr>`).join('')}</table>`,shortDate:v=>v};
const pause=()=>new Promise(r=>setTimeout(r,10));

test('the legal-basis fields on the mapping form ask for the light list, and the list is reused for a minute',async()=>{
 const ui=createNonEtimsUI(ctx);
 const open=async()=>{const f=$('#editForm');await ui.exceptionFields(f,[{row_id:'r1',source_row:5,normalized:{date:'2026-01-05'}}],'p1',null);};
 await open();
 assert.equal($('#editForm button[type=submit]').disabled,false,'Save is switched back on once the fields have loaded');assert.ok($('[name=basis_code]'),'the legal-basis fields are on screen');
 assert.equal(calls.filter(c=>c.action==='non_etims_bases'&&c.light===true).length,1,'the mapping form asks for the list without usage counts');
 await open();
 assert.equal(calls.filter(c=>c.action==='non_etims_bases').length,1,'a second open within a minute reuses the list');
 assert.equal(calls.filter(c=>c.action==='non_etims_check').length,2,'the duplicate check still runs every time');
});

test('the legal bases screen opens at once with a loading line and then fills in, and it clears the reused list',async()=>{
 const ui=createNonEtimsUI(ctx);
 const pending=ui.adminBases();
 assert.equal(shown.at(-1).title,'Non-eTIMS legal bases');assert.match(shown.at(-1).body,/Loading the legal bases/,'the window is on screen before the server answers');
 release();await pending;
 assert.match($('#editorBody').innerHTML,/NE-TICKET/);assert.equal(calls.at(-1).light,undefined,'the admin screen reads the full list with usage counts');
});
