import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const {createContentSwap}=await import('../staff-content-swap.mjs');
const setup=()=>{const dom=new JSDOM('<body><div id="content"></div></body>',{pretendToBeVisual:true}),w=dom.window,host=w.document.getElementById('content');let y=0;Object.defineProperty(w,'scrollY',{get:()=>y});w.scrollTo=(x,v)=>{y=v;};return {w,host,setY:v=>{y=v;},getY:()=>y,swap:createContentSwap(host,{win:w,doc:w.document})};};
test('an identical rebuild changes nothing, so the page does not flicker',()=>{
 const {host,swap}=setup();assert.equal(swap('<p id="a">hi</p>','clients'),true);const first=host.firstChild;
 assert.equal(swap('<p id="a">hi</p>','clients'),false);assert.equal(host.firstChild,first,'the same node stays on screen');
});
test('a real rebuild of the same screen keeps scroll, focus and typed text',()=>{
 const {w,host,swap,setY,getY}=setup();swap('<input id="note"><p>1</p>','clients');
 const n=w.document.getElementById('note');n.value='half typed';n.focus();n.setSelectionRange(3,3);setY(420);
 assert.equal(swap('<input id="note"><p>2 rows</p>','clients'),true);
 const m=w.document.getElementById('note');assert.notEqual(m,n);assert.equal(m.value,'half typed');assert.equal(w.document.activeElement,m);assert.equal(m.selectionStart,3);assert.equal(getY(),420);
});
test('moving to another screen starts clean with no carried-over text',()=>{
 const {w,host,swap,setY,getY}=setup();swap('<input id="note"><p>1</p>','clients');w.document.getElementById('note').value='old';setY(300);
 swap('<input id="note"><p>other</p>','home');assert.equal(w.document.getElementById('note').value,'');
});
test('content replaced from outside is rebuilt rather than assumed unchanged',()=>{
 const {host,swap}=setup();swap('<p>x</p>','clients');host.innerHTML='<p>changed elsewhere</p>';assert.equal(swap('<p>x</p>','clients'),true);assert.equal(host.textContent,'x');
});
