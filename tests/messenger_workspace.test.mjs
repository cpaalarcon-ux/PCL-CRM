import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {createMessenger} from '../staff-messenger.mjs';
import {postMessengerFile} from '../staff-messenger-upload.mjs';

const require=createRequire(import.meta.url);
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const staff={staff_id:'staff',category_code:'ASSISTANT'};
const now='2026-11-19T10:00:00Z';
const message=sequence=>({sequence,message_id:'message-'+sequence,author_id:'colleague',body:'Message '+sequence,created_at:now});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('Messenger preserves the ERP, restores drafts and protects the reader’s scroll position',async t=>{
 const dom=new JSDOM('<div id="messenger"></div><dialog id="erpEditor"><input id="erpDraft"></dialog><button id="share" data-messenger-share-task="task">Share task</button>',
  {url:'https://pcl.example.test/#task=task',pretendToBeVisual:true});
 const {window}=dom,{document}=window;
 for(const key of ['window','document','localStorage'])globalThis[key]=key==='window'?window:window[key];
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const timers=[];
 window.setInterval=callback=>timers.push(callback);
 window.clearInterval=()=>{};
 const observers=[];
 globalThis.ResizeObserver=class {
  constructor(callback){this.callback=callback;observers.push(this);}
  observe(){}
  disconnect(){}
 };
 Object.defineProperties(window.HTMLElement.prototype,{
  clientHeight:{get(){return 400;}},
  scrollHeight:{get(){return this.querySelectorAll('[data-message-id]').length*40+40;}},
  scrollTop:{get(){return this.scrollPosition||0;},set(top){this.scrollPosition=Math.max(0,Math.min(top,this.scrollHeight-this.clientHeight));}}
 });
 const group={channel_id:'group',kind:'Group',title:'Tax team',unread:2};
 const direct={channel_id:'direct',kind:'Direct',title:'Colleague',unread:0};
 let messages=Array.from({length:100},(_,i)=>message(i+1)),saved=null,active=true,uploadCount=0;
 const uploadIds=[];
 const data={me:staff,tasks:[{task_id:'task',task_name:'Prepare VAT Return'}],documents:[]};
 const request=async payload=>{
  if(payload.action==='discussion_list')return {channels:[group,direct]};
  if(payload.action==='discussion_messages'){
   const channel=payload.channel_id==='group'?group:direct;
   const page=(channel===group?messages:[]).filter(m=>!payload.before_sequence||m.sequence<payload.before_sequence);
   return {channel,messages:page.slice(-60),has_older:page.length>60};
  }
  if(payload.action==='discussion_group_overview')return {groups:[{members:[staff]}]};
  if(payload.action==='discussion_shared_link')throw Object.assign(Error('Forbidden'),{status:403});
  if(payload.action==='discussion_send'){saved=payload;return {message_id:'saved'};}
  return {};
 };
 const messenger=createMessenger({
  data:()=>active?data:null,esc,request,notice(){},
  async uploadMessenger(file,channel,{onProgress}){
   assert.equal(channel,'group');uploadIds.push(file.id);onProgress(60);uploadCount++;
   if(uploadCount===1)throw Error('Connection lost.');
  },openTask(){assert.fail('Forbidden tasks must never open');}
 });
 messenger.start();
 t.after(()=>{messenger.stop();active=false;dom.window.close();delete globalThis.ResizeObserver;});
 const $=s=>document.querySelector(s),click=async s=>{assert.ok($(s),s);$(s).click();await flush();};
 const opener=$('#messengerButton'),erp=$('#erpDraft');
 $('#erpEditor').open=true;erp.value='Unsaved ERP form';opener.focus();
 await click('#messengerButton');
 assert.equal($('#messengerPanel').open,true);
 assert.deepEqual([...document.querySelectorAll('[data-msgr="filter"]')].map(el=>el.textContent),['All','Unread','Direct','Groups']);
 await click('[data-msgr="filter"][data-id="Direct"]');
 assert.equal($('[data-msgr="open"][data-id="group"]'),null);
 await click('[data-msgr="filter"][data-id="Unread"]');
 await click('[data-msgr="open"][data-id="group"]');
 await click('[data-msgr="older"]');
 assert.equal(document.querySelectorAll('[data-message-id]').length,100);
 const box=$('#messengerMessages');box.scrollTop=50*40;box.dispatchEvent(new window.Event('scroll'));
 const anchor=box.scrollTop;
 messages.push(message(101));timers[0]();await flush();
 assert.equal(box.scrollTop,anchor,'the newest message does not move message 50');
 assert.equal($('#messengerNewMessages').hidden,false);
 observers.at(-1).callback();
 assert.equal(box.scrollTop,anchor,'late layout expansion does not pull a reader down');
 await click('#messengerNewMessages');
 assert.equal(box.scrollTop,box.scrollHeight-box.clientHeight);
 assert.equal($('#messengerNewMessages').hidden,true);

 const composer=$('#messengerSend textarea');
 composer.value='For today’s review';
 composer.dispatchEvent(new window.Event('input',{bubbles:true}));
 const drop=new window.Event('drop',{bubbles:true,cancelable:true});
 Object.defineProperty(drop,'dataTransfer',{value:{files:[new window.File(['%PDF- sample'],'Return.pdf',{type:'application/pdf'})]}});
 $('.messenger-detail').dispatchEvent(drop);await flush();
 assert.match($('#messengerAttachments').textContent,/Upload failed/);
 assert.equal(composer.value,'For today’s review');
 await click('[data-msgr="close"]');
 assert.equal($('#erpEditor').open,true);
 assert.equal($('#erpDraft'),erp);
 assert.equal(erp.value,'Unsaved ERP form');
 assert.equal(window.location.hash,'#task=task');
 assert.equal(document.activeElement,opener);
 await click('#messengerButton');
 assert.equal($('#messengerSend textarea').value,'For today’s review');
 await click('[data-msgr="retry"]');
 assert.equal(uploadIds.length,2);assert.equal(uploadIds[0],uploadIds[1]);
 assert.match($('#messengerAttachments').textContent,/Ready to send/);
 await click('#messengerSend [type="submit"]');
 assert.deepEqual(saved.attachment_ids,[uploadIds[0]]);
 assert.equal(saved.body,'For today’s review');

 await click('[data-msgr="close"]');
 await click('#share');
 await click('[data-msgr="open"][data-id="group"]');
 assert.match($('#messengerAttachments').textContent,/Prepare VAT Return/);
 await click('#messengerSend [type="submit"]');
 assert.equal(saved.shared_task_id,'task');
 messages.push({...message(102),shared_kind:'task',shared_title:null});
 timers[0]();await flush();
 await click('[data-msgr="shared"][data-id="message-102"]');
 assert.match($('.messenger-detail').textContent,/403 Forbidden/);
 assert.equal(window.location.hash,'#task=task');
});

test('file transport reports byte progress and handles interruption and retry',async()=>{
 const headers={},form=new FormData(),settings={};
 let progress;
 const xhr={
  upload:{},open(method,url){settings.method=method;settings.url=url;},
  setRequestHeader(name,value){headers[name]=value;},
  send(body){settings.body=body;},abort(){this.onabort();}
 };
 const broken=postMessengerFile('/upload',{Authorization:'Bearer fixture'},form,{xhr,onProgress:value=>{progress=value;}});
 xhr.upload.onprogress({lengthComputable:true,loaded:39,total:100});
 assert.equal(progress,39);
 xhr.onerror();
 await assert.rejects(broken,/Connection lost/);
 const retried=postMessengerFile('/upload',{Authorization:'Bearer fixture'},form,{xhr});
 xhr.status=200;xhr.response={attachment_id:'same-attachment'};xhr.onload();
 assert.deepEqual(await retried,{attachment_id:'same-attachment'});
 assert.equal(settings.body,form);
 assert.equal(headers.Authorization,'Bearer fixture');
});
