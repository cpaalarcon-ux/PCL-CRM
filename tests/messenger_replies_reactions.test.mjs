import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createMessenger} from '../staff-messenger.mjs';

const require=createRequire(import.meta.url);
const {JSDOM}=require(require.resolve('jsdom',{paths:[process.env.PCL_TEST_MODULES||process.cwd()]}));
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const now='2026-11-26T08:00:00Z';

async function harness(t,{readOnly=false}={}){
 const dom=new JSDOM('<div id="messenger"></div>',{url:'https://pcl.example.test/',pretendToBeVisual:true});
 const {window}=dom,{document}=window;
 for(const key of ['window','document','localStorage'])globalThis[key]=key==='window'?window:window[key];
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 window.setInterval=()=>0;window.clearInterval=()=>{};
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const direct={channel_id:'direct',kind:'Direct',title:'Colleague',unread:0};
 const messages=[
  {sequence:1,message_id:'m1',author_id:'colleague',author_name:'Grace Wanjiru',body:'Please send the PAYE schedule',created_at:now,reactions:[]},
  {sequence:2,message_id:'m2',author_id:'me',body:'On it',created_at:now,reply_to:'m1',reply_author_name:'Grace Wanjiru',reply_body:'Please send the PAYE schedule',
   reactions:[{emoji:'👍',count:2,mine:true,names:['Grace Wanjiru','You']}]}
 ];
 const sent=[],reacted=[];
 const request=async p=>{
  if(p.action==='discussion_list')return {channels:[direct]};
  if(p.action==='discussion_messages')return {channel:direct,messages,has_older:false,read_only:readOnly,read_positions:[]};
  if(p.action==='discussion_send'){sent.push(p);return {message_id:'new'};}
  if(p.action==='discussion_react'){reacted.push(p);return {ok:true};}
  return {};
 };
 const messenger=createMessenger({data:()=>({me:{staff_id:'me',category_code:'ASSISTANT'},tasks:[],documents:[]}),esc,request,notice(){}});
 messenger.start();
 t.after(()=>{messenger.stop();dom.window.close();delete globalThis.ResizeObserver;});
 const $=s=>document.querySelector(s),click=async el=>{assert.ok(el);el.click();await flush();};
 await click($('#messengerButton'));
 await click($('[data-msgr="open"][data-id="direct"]'));
 return {$,click,window,document,sent,reacted};
}

test('a reply shows the quoted message and is sent with the reply reference',async t=>{
 const h=await harness(t);
 const quote=h.$('[data-message-id="m2"] .messenger-quote');
 assert.ok(quote,'the reply quotes the earlier message');
 assert.match(quote.textContent,/Grace Wanjiru/);assert.match(quote.textContent,/PAYE schedule/);
 await h.click(h.$('[data-message-id="m1"] [data-msgr="reply"]'));
 assert.match(h.$('.messenger-replying').textContent,/Replying to Grace Wanjiru/);
 const area=h.$('#messengerSend textarea');area.value='Sending it now';area.dispatchEvent(new h.window.Event('input',{bubbles:true}));
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.equal(h.sent.length,1);
 assert.equal(h.sent[0].reply_to,'m1');
 assert.equal(h.$('.messenger-replying'),null,'the reply bar clears after sending');
});

test('a reply can be cancelled before sending, and then carries no reference',async t=>{
 const h=await harness(t);
 await h.click(h.$('[data-message-id="m1"] [data-msgr="reply"]'));
 await h.click(h.$('[data-msgr="cancel-reply"]'));
 assert.equal(h.$('.messenger-replying'),null);
 const area=h.$('#messengerSend textarea');area.value='Hello';area.dispatchEvent(new h.window.Event('input',{bubbles:true}));
 await h.click(h.$('#messengerSend [type="submit"]'));
 assert.equal(h.sent[0].reply_to,null);
});

test('reactions show counts, toggle on and off, and name who reacted',async t=>{
 const h=await harness(t);
 const chip=h.$('[data-message-id="m2"] .messenger-reaction');
 assert.match(chip.textContent,/👍 2/);
 assert.equal(chip.getAttribute('aria-pressed'),'true');
 assert.match(chip.title,/Grace Wanjiru/);
 await h.click(chip);
 assert.deepEqual({e:h.reacted[0].emoji,on:h.reacted[0].on,m:h.reacted[0].message_id},{e:'👍',on:false,m:'m2'},'tapping your own reaction removes it');
 const heart=[...h.document.querySelectorAll('[data-message-id="m1"] .messenger-react-bar [data-emoji]')].find(b=>b.dataset.emoji==='❤️');
 await h.click(heart);
 assert.equal(h.reacted[1].on,true,'a new reaction is added');
 assert.equal(h.reacted[1].emoji,'❤️');
});

test('a closed conversation offers no reply or reaction tools',async t=>{
 const h=await harness(t,{readOnly:true});
 assert.equal(h.$('[data-msgr="reply"]'),null);
 assert.equal(h.$('.messenger-react-bar'),null);
 assert.ok(h.$('[data-message-id="m2"] .messenger-reaction'),'existing reactions stay visible');
});

test('reactions are stored safely: fixed set, row security, own removal only, and a message list that returns them',()=>{
 const sql=read('supabase/migrations/20261214600000_chat_reactions.sql'),server=read('supabase/functions/staff-workspace-v12/discussion-actions.ts');
 assert.match(sql,/FORCE ROW LEVEL SECURITY/);
 assert.match(sql,/emoji IN \('👍','❤️','😂','😮','🙏','✅'\)/);
 assert.match(sql,/discussion_reaction_remove[\s\S]*staff_id = \(erp_private\.actor\(\)\)\.staff_id/);
 assert.match(sql,/GRANT SELECT, INSERT, DELETE ON erp_private\.discussion_reactions TO erp_api/);
 assert.doesNotMatch(sql,/GRANT[^;]*UPDATE[^;]*discussion_reactions/,'reactions are never edited');
 assert.match(sql,/This conversation is closed/);
 assert.match(server,/REACTIONS=\['👍','❤️','😂','😮','🙏','✅'\]/);
 assert.match(server,/discussion_react/);assert.match(server,/coalesce\(rx\.items,'\[\]'::jsonb\) reactions/);
 assert.match(server,/reply_body/);
 assert.match(read('supabase/functions/staff-workspace-v12/staff-action-rights.mjs'),/'discussion_send','discussion_react'/);
});
