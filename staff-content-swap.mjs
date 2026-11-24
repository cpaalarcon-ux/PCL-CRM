// Replaces the main content area without the page "shaking". The workspace rebuilds this area several times while data arrives (a first paint, the client list, card facts).
// A rebuild that would produce the same markup changes nothing. A real rebuild of the same screen keeps the scroll position, the focused box and anything the person has typed
// into a box that has an id, so a late-arriving list never wipes a half-typed note or throws the person back to the top.
export function createContentSwap(host,{win=globalThis.window,doc=globalThis.document}={}){
 let sig=null,screen=null,node=null;
 return function swap(html,name){
  const same=screen===name&&node===host.firstChild&&sig===html;
  if(same)return false;
  const sameScreen=screen===name&&node===host.firstChild;
  const y=sameScreen?(win?.scrollY??0):0,ae=doc.activeElement;
  const focus=sameScreen&&ae&&host.contains(ae)&&ae.id?{id:ae.id,s:ae.selectionStart,e:ae.selectionEnd}:null;
  const drafts=sameScreen?[...host.querySelectorAll('input[id],textarea[id]')].filter(x=>!['checkbox','radio','file','hidden'].includes(x.type)&&x.value!==x.defaultValue).map(x=>[x.id,x.value]):[];
  host.innerHTML=html;sig=html;screen=name;node=host.firstChild;
  for(const [id,v] of drafts){const n=doc.getElementById(id);if(n&&host.contains(n)&&n.value===n.defaultValue)n.value=v;}
  if(sameScreen&&win?.scrollTo&&y)win.scrollTo(0,y);
  if(focus){const n=doc.getElementById(focus.id);if(n&&host.contains(n)){try{n.focus({preventScroll:true});if(focus.s!=null)n.setSelectionRange(focus.s,focus.e);}catch{/* some boxes have no cursor */}}}
  return true;
 };
}
