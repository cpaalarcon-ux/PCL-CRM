// The "Send set-up for approval" screen shows a chosen number of clients at a time, and never more than 100 can be ticked.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const {bulkSubmitHtml,showScreen,tickShown,untickAll,BULK_MAX}=await import('../staff-setup-bulk.mjs');
const clients=Array.from({length:189},(_,i)=>({client_id:'00000000-0000-4000-8000-'+String(i).padStart(12,'0'),company_name:'Client '+String(i+1).padStart(3,'0'),kra_pin:'P'+String(i).padStart(9,'0')+'Z'}));
const make=()=>{const dom=new JSDOM('<div id="h"></div>');const host=dom.window.document.getElementById('h');host.innerHTML=bulkSubmitHtml(clients);return host;};
const ticked=h=>h.querySelectorAll('[data-bulk-row] input:checked').length;
test('a screen shows only the chosen number of clients and pages through the rest',()=>{
 const h=make();
 let r=showScreen(h,{size:50,page:0});assert.deepEqual([r.total,r.pages,r.from,r.to,r.shown],[189,4,1,50,50]);assert.equal(h.querySelectorAll('[data-bulk-row]:not([hidden])').length,50);
 r=showScreen(h,{size:50,page:3});assert.deepEqual([r.from,r.to,r.shown],[151,189,39]);
 r=showScreen(h,{size:25,page:99});assert.equal(r.page,7,'a page past the end is held to the last page');
 r=showScreen(h,{term:'client 019',size:50,page:0});assert.equal(r.total,1);
 assert.ok(h.querySelector('#setupBulkSize')&&h.querySelector('#setupBulkNext')&&h.querySelector('#setupBulkPrev')&&h.querySelector('#setupBulkNone'),'the screen has the size selector, paging and Untick all');
});
test('ticking the screen ticks only what is shown, and never more than 100 in all',()=>{
 const h=make();showScreen(h,{size:50,page:0});assert.equal(tickShown(h,true),0);assert.equal(ticked(h),50);
 showScreen(h,{size:50,page:1});assert.equal(tickShown(h,true),0);assert.equal(ticked(h),100);
 showScreen(h,{size:50,page:2});assert.equal(tickShown(h,true),50,'a third screen would pass 100, so none of it is ticked');assert.equal(ticked(h),100);
 untickAll(h);assert.equal(ticked(h),0);
 showScreen(h,{size:100,page:0});tickShown(h,true);assert.equal(ticked(h),BULK_MAX);tickShown(h,false);assert.equal(ticked(h),0);
});
