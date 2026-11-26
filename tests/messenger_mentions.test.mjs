import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createMessenger} from '../staff-messenger.mjs';
import {shouldBeep} from '../staff-messenger-alerts.mjs';

const require=createRequire(import.meta.url);
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');

async function harness(t){
 const dom=new JSDOM('<div id="messenger"></div>',{url:'https://pcl.example.test/',pretendToBeVisual:true});
 const {window}=dom,{document}=window;
 for(const key of ['window','document','localStorage'])globalThis[key]=key==='window'?window:window[key];
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 window.setInterval=()=>0;window.clearInterval=()=>{};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const group={channel_id:'group',kind:'Group',title:'Tax team',unread:1,unread_mentions:1,last_sequence:2,last_author_id:'grace'};
 const messages=[{sequence:1,message_id:'m1',author_id:'grace',author_name:'Grace Wanjiru',body:'Hello @Peter Otieno please review',created_at:'2026-11-26T08:00:00Z',reactions:[],mentions:[{staff_id:'peter',name:'Peter Otieno'}]}];
 const sent=[],asked=[];
 const request=async p=>{
  if(p.action==='discussion_list')return {channels:[group]};
  if(p.action==='discussion_messages')return {channel:group,messages,has_older:false,read_only:false,read_positions:[]};
  if(p.action==='discussion_mentionable'){asked.push(p.channel_id);return {people:[{staff_id:'grace',full_name:'Grace Wanjiru'},{staff_id:'peter',full_name:'Peter Otieno'},{staff_id:'amina',full_name:'Amina Hassan'}]};}
  if(p.action==='discussion_send'){sent.push(p);return {message_id:'new'};}
  return {};
 };
 const messenger=createMessenger({data:()=>({me:{staff_id:'me',category_code:'ASSISTANT'},tasks:[],documents:[]}),esc,request,notice(){}});
 messenger.start();
 t.after(()=>{messenger.stop();dom.window.close();delete globalThis.ResizeObserver;});
 const $=s=>document.querySelector(s),click=async el=>{assert.ok(el);el.click();await flush();};
 const type=async text=>{const area=$('#messengerSend textarea');area.value=text;area.setSelectionRange(text.length,text.length);area.dispatchEvent(new window.Event('input',{bubbles:true}));await flush();await flush();};
 return {$,click,type,window,document,sent,asked};
}
const open=async h=>{await h.click(h.$('#messengerButton'));await h.click(h.$('[data-msgr="open"][data-id="group"]'));};

test('a conversation with an unread mention is marked in the list, and the mention is highlighted in the thread',async t=>{
 const h=await harness(t);
 await h.click(h.$('#messengerButton'));
 assert.ok(h.$('[data-msgr="open"][data-id="group"] .messenger-at'),'the @ mark shows in the list');
 await h.click(h.$('[data-msgr="open"][data-id="group"]'));
 const mark=h.$('[data-message-id="m1"] mark.messenger-mention');
 assert.equal(mark.textContent,'@Peter Otieno');
});

test('typing @ offers the people in this conversation and sending carries their ids',async t=>{
 const h=await harness(t);await open(h);
 await h.type('Please check @Pe');
 const options=[...h.document.querySelectorAll('#messengerMention [data-msgr="mention-pick"]')];
 assert.deepEqual(options.map(o=>o.textContent),['Peter Otieno'],'the list narrows to the typed letters');
 assert.deepEqual(h.asked,['group']);
 await h.click(options[0]);
 assert.equal(h.$('#messengerSend textarea').value,'Please check @Peter Otieno ');
 assert.equal(h.$('#messengerMention').hidden,true);
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.deepEqual(h.sent[0].mention_ids,['peter']);
});

test('a mention that was deleted from the text is not sent, and a typed name that was never picked is just text',async t=>{
 const h=await harness(t);await open(h);
 await h.type('Hi @Am');
 await h.click(h.$('#messengerMention [data-msgr="mention-pick"]'));
 await h.type('Hi there, never mind');
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.deepEqual(h.sent[0].mention_ids,[]);
 await h.type('cc @Grace Wanjiru');
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.deepEqual(h.sent[1].mention_ids,[],'only people chosen from the list count');
});

test('a mention sounds even when the conversation is muted',()=>{
 const prefs={sound:true,muted:{a:true}};
 assert.equal(shouldBeep([{channel_id:'a'}],prefs),false);
 assert.equal(shouldBeep([{channel_id:'a',unread_mentions:1}],prefs),true);
});

test('the database, server and rights are wired for mentions',()=>{
 const sql=read('supabase/migrations/20261214700000_chat_mentions.sql');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);assert.match(sql,/GRANT SELECT ON erp_private.discussion_mentions TO erp_api/);
 assert.doesNotMatch(sql,/GRANT[^;]*INSERT[^;]*discussion_mentions/,'mentions are written only through the checked function');
 assert.match(sql,/only mention people who are part of this conversation/);
 const server=read('supabase/functions/staff-workspace-v12/discussion-actions.ts');
 assert.match(server,/discussion_mention\(/);assert.match(server,/unread_mentions/);assert.match(server,/discussion_mentionable/);
 for(const f of ['staff-action-rights.mjs','supabase/functions/staff-workspace-v12/staff-action-rights.mjs'])assert.match(read(f),/'discussion_mentionable'/);
});
