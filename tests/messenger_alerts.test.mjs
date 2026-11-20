import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {loadPrefs,savePrefs,incomingChats,shouldBeep,titleWithCount,createBeeper,tickFor} from '../staff-messenger-alerts.mjs';
const mem=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,v)};};
const ch=(id,o={})=>({channel_id:id,unread:0,last_sequence:0,last_author_id:'them',...o});

test('preferences default to sound on, survive a round trip, and fall back safely when storage is broken',()=>{
 const s=mem();assert.deepEqual(loadPrefs(s),{sound:true,muted:{}});
 const p={sound:false,muted:{c1:true}};savePrefs(p,s);assert.deepEqual(loadPrefs(s),p);
 s.setItem('pcl-messenger-prefs-v1','{not json');assert.deepEqual(loadPrefs(s),{sound:true,muted:{}});
 assert.deepEqual(loadPrefs({getItem(){throw new Error('blocked');}}),{sound:true,muted:{}});savePrefs(p,{setItem(){throw new Error('blocked');}});
});

test('only a new message from someone else, outside the chat being read, counts as incoming',()=>{
 const prev=[ch('a',{unread:1,last_sequence:5}),ch('b')];
 assert.deepEqual(incomingChats(null,[ch('a',{unread:3,last_sequence:7})],'me'),[],'the first load never beeps');
 assert.deepEqual(incomingChats(prev,prev,'me'),[],'nothing changed');
 assert.deepEqual(incomingChats(prev,[ch('a',{unread:2,last_sequence:6}),ch('b')],'me').map(c=>c.channel_id),['a']);
 assert.deepEqual(incomingChats(prev,[ch('a',{unread:2,last_sequence:6,last_author_id:'me'}),ch('b')],'me'),[],'my own message is silent');
 assert.deepEqual(incomingChats(prev,[ch('a',{unread:2,last_sequence:6}),ch('b')],'me',{viewing:'a'}),[],'the chat I am looking at is silent');
 assert.deepEqual(incomingChats(prev,[ch('a',{unread:0,last_sequence:6}),ch('b')],'me'),[],'reading a chat on another device is silent');
 assert.deepEqual(incomingChats(prev,[...prev,ch('c',{unread:1,last_sequence:1})],'me').map(c=>c.channel_id),['c'],'a brand-new chat with something unread counts');
});

test('muting a chat or switching sound off silences the beep; a muted chat does not hide an unmuted one',()=>{
 const chats=[ch('a'),ch('b')];
 assert.equal(shouldBeep(chats,{sound:true,muted:{}}),true);assert.equal(shouldBeep(chats,{sound:false,muted:{}}),false);
 assert.equal(shouldBeep(chats,{sound:true,muted:{a:true}}),true);assert.equal(shouldBeep(chats,{sound:true,muted:{a:true,b:true}}),false);assert.equal(shouldBeep([],{sound:true,muted:{}}),false);
});

test('the tab title shows the unread count and caps at 99+',()=>{
 assert.equal(titleWithCount('PCL ERP',0),'PCL ERP');assert.equal(titleWithCount('PCL ERP',3),'(3) PCL ERP');assert.equal(titleWithCount('PCL ERP',250),'(99+) PCL ERP');assert.equal(titleWithCount('PCL ERP',undefined),'PCL ERP');
});

test('ticks: sent until someone reads; partial and full read in a group; none on other people\'s messages or without positions',()=>{
 const me='me',msg={author_id:me,sequence:'5'},pos=(...v)=>v.map(([id,n])=>({staff_id:id,last_sequence:String(n)}));
 assert.equal(tickFor(msg,me,pos(['me',9],['a',0],['b',0])).state,'sent');
 assert.deepEqual(tickFor(msg,me,pos(['me',9],['a',5],['b',0])),{state:'partial',glyph:'✓✓',label:'Read by 1 of 2'});
 assert.deepEqual(tickFor(msg,me,pos(['me',9],['a',6],['b',5])),{state:'read',glyph:'✓✓',label:'Read by everyone'});
 assert.equal(tickFor(msg,me,pos(['me',0],['a',5])).label,'Read','one-to-one says Read');
 assert.equal(tickFor({author_id:'a',sequence:'5'},me,pos(['a',9])),null,'no ticks on messages from others');
 assert.equal(tickFor(msg,me,null),null,'task and project discussions have no positions');assert.equal(tickFor(msg,me,pos(['me',9])),null);
 assert.equal(tickFor({author_id:me,sequence:'4'},me,pos(['a',4])).state,'read','read up to exactly that message counts');
});

test('the beeper stays silent until the browser allows sound, then plays a two-note chime no more than once every two seconds',()=>{
 const notes=[];class Fake{constructor(){this.state='suspended';this.currentTime=0;this.destination={};}resume(){this.state='running';}createOscillator(){const o={frequency:{},connect(){},start(t){notes.push(o.frequency.value);},stop(){}};return o;}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}}
 const b=createBeeper({AudioContext:Fake});assert.equal(b.play(1000),false,'locked before any click');
 assert.equal(b.unlock(),true);assert.equal(b.play(10000),true);assert.deepEqual(notes,[880,660]);
 assert.equal(b.play(10500),false,'rate limited');assert.equal(b.play(12100),true);assert.equal(b.play(12200,true),true,'the sound test button always plays');
 assert.equal(createBeeper({}).unlock(),false,'no audio support means no sound and no error');assert.equal(createBeeper({}).play(),false);
});

test('the messenger is wired to the alerts, the sound and mute buttons, the tab title and the ticks, and polls in the background',()=>{
 const m=fs.readFileSync(new URL('../staff-messenger.mjs',import.meta.url),'utf8'),css=fs.readFileSync(new URL('../staff-pilot.css',import.meta.url),'utf8');
 assert.match(m,/from '\.\/staff-messenger-alerts\.mjs\?v=/);assert.match(m,/data-msgr="sound"/);assert.match(m,/data-msgr="mute-chat"/);
 assert.match(m,/shouldBeep\(fresh,prefs\)/);assert.match(m,/titleWithCount\(baseTitle,n\)/);assert.match(m,/tickFor\(m,me,positions\)/);assert.match(m,/read_positions:r\.read_positions/);
 assert.doesNotMatch(m,/if\(!d\(\)\|\|document\.visibilityState!=='visible'\)return;void refreshList/,'a hidden tab must still check for new messages');
 assert.match(css,/\.messenger-tick\.read/);
});
