// One sticky bar on task, project and client screens: Back, then "Client › Project › Period", then the written status badge.
// The screens each draw their own header; this moves it into the Back bar so only one thing is ever pinned to the top.
export function trailTitle(header){
 const parts=[...header.querySelectorAll('.wh-trail .wh-part')].map(p=>p.textContent.replace(/\s+/g,' ').trim()).filter(Boolean);
 return parts.join(' › ');
}
export function foldHeader(root){
 const bar=root?.querySelector?.('.detail-return');
 if(!bar)return false;
 const loose=[...root.querySelectorAll('.workspace-header')].filter(h=>!bar.contains(h));
 if(!loose.length)return false;
 const header=loose[0];
 bar.querySelector('.workspace-header')?.remove();
 const trail=header.querySelector('.wh-trail');
 if(trail)trail.title=trailTitle(header);
 bar.append(header);
 bar.classList.add('has-header');
 return true;
}
// The height of the bar is published so focused fields are never scrolled under it (WCAG 2.2 2.4.11).
export function barHeight(root){
 const bar=root?.querySelector?.('.detail-return');
 return bar?Math.ceil(bar.getBoundingClientRect().height||0):0;
}
export function watchStickyBar(root){
 if(!root)return ()=>{};
 const win=root.ownerDocument.defaultView,page=root.ownerDocument.documentElement;
 const publish=()=>{page.style.setProperty('--detail-bar-h',barHeight(root)+'px');};
 const run=()=>{foldHeader(root);publish();};
 const observer=new win.MutationObserver(run);
 observer.observe(root,{childList:true,subtree:true});
 win.addEventListener('resize',publish);
 run();
 return ()=>{observer.disconnect();win.removeEventListener('resize',publish);};
}
