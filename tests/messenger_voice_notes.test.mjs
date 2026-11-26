import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createMessenger} from '../staff-messenger.mjs';
import {audioType,readAttachmentUpload} from '../supabase/functions/staff-workspace-v12/messenger-attachments.ts';

const require=createRequire(import.meta.url);
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

async function harness(t,{mic=true}={}){
 const dom=new JSDOM('<div id="messenger"></div>',{url:'https://pcl.example.test/',pretendToBeVisual:true});
 const {window}=dom,{document}=window;
 for(const key of ['window','document','localStorage'])globalThis[key]=key==='window'?window:window[key];
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 window.setInterval=()=>0;window.clearInterval=()=>{};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 let stopped=0;
 if(mic){
  globalThis.MediaRecorder=class{
   static isTypeSupported(m){return m==='audio/webm;codecs=opus';}
   constructor(stream,o){this.mimeType=o?.mimeType||'audio/webm';this.state='inactive';}
   start(){this.state='recording';}
   stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2,3])])});this.onstop?.();}
  };
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}},configurable:true});
 }else{delete globalThis.MediaRecorder;}
 const direct={channel_id:'direct',kind:'Direct',title:'Colleague',unread:0};
 const messages=[{sequence:1,message_id:'m1',author_id:'colleague',author_name:'Grace Wanjiru',body:'',has_attachments:true,created_at:'2026-11-26T08:00:00Z',reactions:[],
  attachments:[{attachment_id:'a1',file_name:'voice-note.webm',mime_type:'audio/webm',size_bytes:2048}]}];
 const sent=[],uploads=[],downloads=[];
 const request=async p=>{
  if(p.action==='discussion_list')return {channels:[direct]};
  if(p.action==='discussion_messages')return {channel:direct,messages,has_older:false,read_only:false,read_positions:[]};
  if(p.action==='discussion_send'){sent.push(p);return {message_id:'new'};}
  if(p.action==='discussion_attachment_download'){downloads.push(p.attachment_id);return new Blob([new Uint8Array([1,2,3,4,5])],{type:'audio/webm'});}
  return {};
 };
 const messenger=createMessenger({data:()=>({me:{staff_id:'me',category_code:'ASSISTANT'},tasks:[],documents:[]}),esc,request,notice(){},
  async uploadMessenger(f,channel,{onProgress}){uploads.push(f.file);onProgress(100);}});
 messenger.start();
 t.after(()=>{messenger.stop();dom.window.close();delete globalThis.ResizeObserver;delete globalThis.MediaRecorder;});
 const $=s=>document.querySelector(s),click=async el=>{assert.ok(el);el.click();await flush();};
 await click($('#messengerButton'));
 await click($('[data-msgr="open"][data-id="direct"]'));
 return {$,click,window,document,sent,uploads,downloads,stopped:()=>stopped};
}

test('recording a voice note uploads it as an audio file and sends it with the message',async t=>{
 URL.createObjectURL??=()=>'blob:test';
 const h=await harness(t);
 await h.click(h.$('[data-msgr="record"]'));
 assert.equal(h.$('[data-msgr="record"]').textContent,'⏹','the button turns into Stop while recording');
 await h.click(h.$('[data-msgr="record"]'));
 assert.equal(h.uploads.length,1);
 assert.match(h.uploads[0].name,/^voice-note-.*\.webm$/);
 assert.equal(h.uploads[0].type,'audio/webm');
 assert.equal(h.stopped(),1,'the microphone is released');
 assert.equal(h.$('[data-msgr="record"]').textContent,'🎙');
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.equal(h.sent[0].attachment_ids.length,1);
});

test('a voice note in the thread plays through an audio element after a private download',async t=>{
 URL.createObjectURL=()=>'blob:voice';
 const h=await harness(t);
 const play=h.$('[data-msgr="play"]');
 assert.ok(play,'a voice note shows a play button, not a download tile');
 await h.click(play);
 assert.deepEqual(h.downloads,['a1']);
 assert.ok(h.$('.messenger-bubble audio'));
});

test('without microphone support the composer says so and sends nothing',async t=>{
 const h=await harness(t,{mic:false});
 await h.click(h.$('[data-msgr="record"]'));
 assert.match(h.$('#messengerState').textContent,/not supported/);
 assert.equal(h.uploads.length,0);
});

test('the server checks audio signatures, so a renamed file is refused',async()=>{
 assert.equal(audioType('a.webm',new Uint8Array([0x1a,0x45,0xdf,0xa3,0])),'audio/webm');
 assert.equal(audioType('a.ogg',new TextEncoder().encode('OggS\0')),'audio/ogg');
 assert.equal(audioType('a.m4a',new TextEncoder().encode('\0\0\0\x18ftypM4A ')),'audio/mp4');
 assert.throws(()=>audioType('a.webm',new TextEncoder().encode('%PDF-1.7')));
 assert.throws(()=>audioType('a.ogg',new Uint8Array([1,2,3,4,5,6])));
 const form=new FormData();
 form.set('file',new File([new Uint8Array([0x1a,0x45,0xdf,0xa3,1,2])],'voice-note.webm',{type:'audio/webm'}));
 form.set('channel_id','11111111-1111-4111-8111-111111111111');form.set('attachment_id','22222222-2222-4222-8222-222222222222');
 const file=await readAttachmentUpload(form);
 assert.equal(file.mime_type,'audio/webm');
 const bad=new FormData();bad.set('file',new File([new Uint8Array([1,2,3,4,5,6])],'x.mp3'));
 bad.set('channel_id','11111111-1111-4111-8111-111111111111');bad.set('attachment_id','22222222-2222-4222-8222-222222222222');
 await assert.rejects(()=>readAttachmentUpload(bad));
});

test('the bucket and other uploads: audio is allowed in storage but only the messenger accepts it',()=>{
 const index=read('supabase/functions/staff-workspace-v12/index.ts');
 assert.equal((index.match(/'audio\/webm','audio\/ogg','audio\/mp4'/g)||[]).length,2);
 assert.doesNotMatch(read('supabase/functions/staff-workspace-v12/validation.mjs'),/audio\//);
});
