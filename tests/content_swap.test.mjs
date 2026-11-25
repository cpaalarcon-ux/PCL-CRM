import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{JSDOM}=require('jsdom');
const {createContentSwap}=await import('../staff-content-swap.mjs');
const {foldRecordLists,observeRecordLists}=await import('../staff-record-lists.mjs');
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
test('an opened disclosure stays open when its screen refreshes and closes on reentry',()=>{
 const {host,swap}=setup();
 const html=count=>`<details id="proposalsCard" data-preserve-open><summary>Proposals ${count} waiting</summary></details>`;
 swap(html(1),'clients');
 host.querySelector('summary').click();
 assert.equal(host.firstChild.open,true);
 swap(html(0),'clients');
 assert.equal(host.firstChild.open,true);
 assert.match(host.firstChild.textContent,/0 waiting/);
 swap('<p>Home</p>','home');
 swap(html(0),'clients');
 assert.equal(host.firstChild.open,false);
});
test('content replaced from outside is rebuilt rather than assumed unchanged',()=>{
 const {host,swap}=setup();swap('<p>x</p>','clients');host.innerHTML='<p>changed elsewhere</p>';assert.equal(swap('<p>x</p>','clients'),true);assert.equal(host.textContent,'x');
});
test('refreshing the client register restores the scrollable workspace position',()=>{
 const {w,host,swap,getY}=setup(),scroller=w.document.createElement('div');
 scroller.className='workspace-main-content';
 host.before(scroller);scroller.append(host);
 swap('<p>First results</p>','clients');
 let position=575;
 Object.defineProperty(scroller,'scrollTop',{get:()=>position,set:next=>{position=next;}});
 const setHTML=Object.getOwnPropertyDescriptor(w.Element.prototype,'innerHTML').set;
 Object.defineProperty(host,'innerHTML',{set(html){position=0;setHTML.call(host,html);}});
 swap('<p>Updated results</p>','clients');
 assert.equal(position,575);
 assert.equal(getY(),0);
});
test('record lists are folded once, including tables mounted after the screen renders',async()=>{
 const {host,w}=setup();
 const table='<table aria-label="Staff roster"><thead><tr><th>Staff</th></tr></thead><tbody><tr><td><button>Open member</button></td></tr></tbody></table>';
 host.innerHTML='<button>Add staff</button><div class="scroll">'+table+'</div><section id="later"></section><form>'+table+'</form>';
 const button=host.querySelector('table button');
 let clicked=false;
 button.onclick=()=>{clicked=true;};
 foldRecordLists(host);
 foldRecordLists(host);
 const disclosure=host.querySelector('details');
 assert.equal(disclosure.open,false);
 assert.equal(disclosure.querySelector('summary').textContent,'Staff roster');
 assert.equal(host.querySelectorAll('details').length,1);
 assert.equal(host.querySelector('form details'),null);
 disclosure.querySelector('summary').click();
 assert.equal(disclosure.open,true);
 button.click();
 assert.equal(clicked,true);
 observeRecordLists(host);
 host.querySelector('#later').innerHTML=table;
 await new Promise(resolve=>w.setTimeout(resolve,0));
 assert.equal(host.querySelector('#later details').open,false);
 w.close();
});
