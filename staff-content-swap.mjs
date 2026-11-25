// Replaces the main content area without the page "shaking". The workspace rebuilds this area several times while data arrives (a first paint, the client list, card facts).
// A rebuild with the same markup changes nothing. A rebuild of the same screen keeps scroll, focus, input drafts and opted-in disclosure state.
export function createContentSwap(host,{win=globalThis.window,doc=globalThis.document,prepare}={}){
 let sig=null,screen=null,node=null,version=null,record=null;
 return function swap(html,name,displayVersion,recordKey=''){
  const sameScreen=screen===name&&record===recordKey&&node===host.firstChild;
  const same=sameScreen&&sig===html&&version===displayVersion;
  if(same)return false;
  const scroller=host.closest('.workspace-main-content');
  const y=sameScreen?(scroller?.scrollTop??win?.scrollY??0):0,ae=doc.activeElement;
  const focus=sameScreen&&ae&&host.contains(ae)&&ae.id?{id:ae.id,s:ae.selectionStart,e:ae.selectionEnd}:null;
  const drafts=sameScreen?[...host.querySelectorAll('input[id],textarea[id]')].filter(x=>!['checkbox','radio','file','hidden'].includes(x.type)&&x.value!==x.defaultValue).map(x=>[x.id,x.value]):[];
  const disclosures=sameScreen?new Map([...host.querySelectorAll('details[id][data-preserve-open]')].map(detail=>[detail.id,detail.open])):new Map();
  host.innerHTML=html;
  prepare?.(host,name);
  sig=html;screen=name;node=host.firstChild;version=displayVersion;record=recordKey;
  for(const [id,v] of drafts){const n=doc.getElementById(id);if(n&&host.contains(n)&&n.value===n.defaultValue)n.value=v;}
  if(disclosures.size){
   for(const detail of host.querySelectorAll('details[id][data-preserve-open]')){
    if(disclosures.has(detail.id))detail.open=disclosures.get(detail.id);
   }
  }
  if(sameScreen){
   if(scroller)scroller.scrollTop=y;
   else if(y)win?.scrollTo?.(0,y);
  }
  if(focus){const n=doc.getElementById(focus.id);if(n&&host.contains(n)){try{n.focus({preventScroll:true});if(focus.s!=null)n.setSelectionRange(focus.s,focus.e);}catch{/* some boxes have no cursor */}}}
  return true;
 };
}
