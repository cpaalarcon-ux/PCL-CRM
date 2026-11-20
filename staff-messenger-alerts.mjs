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
 // Call sounds. style 'ring' (the person being called): a loud phone ring, three bursts of three tones in a square wave, which carries
 // much further than a chime, through a limiter so small speakers do not crackle. style 'buzz' (the caller, while waiting): only a soft,
 // low double buzz. `volume` 0..1. Same browser rule as above about the first sound after a page load.
 const ring=(volume=1,style='ring')=>{
  try{
   if(!ctx||ctx.state!=='running')return false;
   const loud=style!=='buzz',level=Math.min(1,Math.max(0,Number(volume)||0)),t=ctx.currentTime,out=ctx.createGain(),comp=ctx.createDynamicsCompressor?.();
   out.gain.value=level*(loud?0.9:0.5);
   if(comp){if(comp.threshold)comp.threshold.value=-8;if(comp.ratio)comp.ratio.value=20;out.connect(comp);comp.connect(ctx.destination);}else out.connect(ctx.destination);
   const bursts=loud?[0,0.5,1]:[0,0.3],tones=loud?[740,880,1320]:[220],peak=loud?0.3:0.5,length=loud?0.36:0.2;
   for(const at of bursts)for(const freq of tones){
    const o=ctx.createOscillator(),g=ctx.createGain();o.type=loud?'square':'triangle';o.frequency.value=freq;
    g.gain.setValueAtTime(0.0001,t+at);g.gain.exponentialRampToValueAtTime(peak,t+at+0.02);g.gain.setValueAtTime(peak,t+at+length);g.gain.exponentialRampToValueAtTime(0.0001,t+at+length+0.05);
    o.connect(g);g.connect(out);o.start(t+at);o.stop(t+at+length+0.08);
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
