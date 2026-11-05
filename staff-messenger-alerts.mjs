// Messenger alerts and read ticks. Pure helpers plus a small sound player, kept apart from the screen code so they can be tested.
// Preferences live in this browser only (localStorage) because they are personal conveniences, not records.
const KEY='pcl-messenger-prefs-v1';

export function loadPrefs(storage=globalThis.localStorage){
 const base={sound:true,muted:{}};
 try{const raw=JSON.parse(storage?.getItem(KEY)||'null');if(raw&&typeof raw==='object')return {sound:raw.sound!==false,muted:raw.muted&&typeof raw.muted==='object'?{...raw.muted}:{}};}catch{ /* Private window or blocked storage: use the defaults. */ }
 return base;
}
export function savePrefs(prefs,storage=globalThis.localStorage){try{storage?.setItem(KEY,JSON.stringify(prefs));}catch{ /* Not saving is harmless; the choice lasts until the page closes. */ }}

// Which chats just received something from someone else? `prev` is the earlier list (null on the very first load, which never beeps),
// `next` the new one. A chat counts when its unread count grew or its newest message is newer, and that message is not mine and is
// not in the conversation the person is looking at right now.
export function incomingChats(prev,next,meId,{viewing=null}={}){
 if(!prev)return [];
 const before=new Map(prev.map(c=>[c.channel_id,c]));
 return next.filter(c=>{
  if(c.last_author_id===meId||c.channel_id===viewing)return false;
  const old=before.get(c.channel_id),grew=Number(c.unread||0)>Number(old?.unread||0),newer=Number(c.last_sequence||0)>Number(old?.last_sequence||0);
  return old?grew&&newer:Number(c.unread||0)>0;
 });
}
export const shouldBeep=(chats,prefs)=>!!prefs.sound&&chats.some(c=>!prefs.muted[c.channel_id]);

export function titleWithCount(base,n){const count=Number(n)||0;return count>0?`(${count>99?'99+':count}) ${base}`:base;}

// A short two-note chime made in the browser, so no audio file is needed. Browsers keep sound off until the person has clicked or
// pressed a key on the page, so the first message after a fresh page load can arrive silently; that is a browser rule.
export function createBeeper(win=globalThis,{minGapMs=2000}={}){
 let ctx=null,last=0;
 const Ctx=win.AudioContext||win.webkitAudioContext;
 const unlock=()=>{try{if(!Ctx)return false;ctx??=new Ctx();if(ctx.state==='suspended')void ctx.resume();return true;}catch{return false;}};
 const play=(now=Date.now(),force=false)=>{
  try{
   if(!ctx||ctx.state!=='running'||(!force&&now-last<minGapMs))return false;last=now;
   const t=ctx.currentTime;
   [[880,0],[660,0.14]].forEach(([freq,at])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(0.0001,t+at);g.gain.exponentialRampToValueAtTime(0.07,t+at+0.02);g.gain.exponentialRampToValueAtTime(0.0001,t+at+0.16);o.connect(g);g.connect(ctx.destination);o.start(t+at);o.stop(t+at+0.18);});
   return true;
  }catch{return false;}
 };
 // A phone-style ring for calls: two bursts of a two-tone sound, much louder than the message chime, with a limiter so small speakers
 // do not crackle. `volume` 0..1; the caller hears a soft version (ring-back) while waiting. Same browser rule as above about first sound.
 const ring=(volume=1)=>{
  try{
   if(!ctx||ctx.state!=='running')return false;
   const t=ctx.currentTime,out=ctx.createGain(),comp=ctx.createDynamicsCompressor?.();
   out.gain.value=Math.min(1,Math.max(0,Number(volume)||0))*0.5;
   if(comp){out.connect(comp);comp.connect(ctx.destination);}else out.connect(ctx.destination);
   for(const at of [0,0.55])for(const freq of [740,880]){
    const o=ctx.createOscillator(),g=ctx.createGain();o.type='triangle';o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t+at);g.gain.exponentialRampToValueAtTime(0.5,t+at+0.03);g.gain.setValueAtTime(0.5,t+at+0.4);g.gain.exponentialRampToValueAtTime(0.0001,t+at+0.46);
    o.connect(g);g.connect(out);o.start(t+at);o.stop(t+at+0.5);
   }
   return true;
  }catch{return false;}
 };
 return {unlock,play,ring};
}

// Tick state of one of my messages. Only one-to-one chats and groups have read positions; task and project discussions get none.
// Sent = the server has it. Read = the person has opened the chat past it. (There is no separate "delivered" state: the server
// records only how far each person has read.)
export function tickFor(message,meId,positions){
 if(!positions||message.author_id!==meId)return null;
 const others=positions.filter(p=>p.staff_id!==meId);if(!others.length)return null;
 const seq=Number(message.sequence),read=others.filter(p=>Number(p.last_sequence)>=seq).length;
 if(read===0)return {state:'sent',glyph:'✓',label:'Sent'};
 if(read<others.length)return {state:'partial',glyph:'✓✓',label:`Read by ${read} of ${others.length}`};
 return {state:'read',glyph:'✓✓',label:others.length===1?'Read':'Read by everyone'};
}
