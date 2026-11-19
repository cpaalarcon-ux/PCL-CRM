const nearBottom=box=>box.scrollHeight-box.clientHeight-box.scrollTop<=50;

// Keep a reader's anchor when the thread grows, including images that arrive after the text.
export function observeMessengerThread(box,timeline,newMessages,{onLatest=()=>{},Resize=globalThis.ResizeObserver}={}){
 let pinned=true,latest=null,pending=false;
 const button=()=>{newMessages.hidden=!pending;};
 function toBottom(){
  box.scrollTop=box.scrollHeight;
  pinned=true;
  if(pending){pending=false;button();}
  if(latest!==null)onLatest(latest);
 }
 function onScroll(){
  pinned=nearBottom(box);
  if(pinned)toBottom();
 }
 box.addEventListener('scroll',onScroll,{passive:true});
 const observer=Resize?new Resize(()=>{if(pinned)toBottom();}):null;
 observer?.observe(timeline);
 observer?.observe(box);
 return {
  render(html,sequence,{older=false}={}){
   const top=box.scrollTop, height=box.scrollHeight, shouldFollow=pinned;
   const incoming=latest!==null&&sequence>latest;
   latest=sequence;
   timeline.innerHTML=html;
   if(shouldFollow)toBottom();
   else{
    box.scrollTop=older?top+box.scrollHeight-height:top;
    if(incoming&&!older){pending=true;button();}
   }
  },
  toBottom,
  isAtBottom:()=>pinned,
  close(){observer?.disconnect();box.removeEventListener('scroll',onScroll);}
 };
}
