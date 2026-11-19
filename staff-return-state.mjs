// Smart Back: where a detail screen was opened from, and the list state to put back when the person returns.
// A returnTo value is only ever one of this app's own in-page routes; anything else is dropped, so it can never send a person to another site.
const VIEW=/^[a-z][a-z_]{1,29}$/,ID=/^[A-Za-z0-9_-]{1,64}$/;
export function safeReturnHash(raw){
 const text=String(raw||'').trim().replace(/^#/,'');
 if(!text||text.length>120||/[^\w\-=&%.]/.test(text))return '';
 let params;try{params=new URLSearchParams(text);}catch{return '';}
 const keys=[...params.keys()];
 if(keys.length!==1)return '';
 const key=keys[0],value=params.get(key)||'';
 if(key==='view')return VIEW.test(value)?'#view='+value:'';
 if(['task','client','project'].includes(key))return ID.test(value)?'#'+key+'='+value:'';
 return '';
}
export function returnLabel(hash){
 const h=safeReturnHash(hash);
 if(h==='#view=home'||!h)return 'Back to Home';
 if(h.startsWith('#project='))return 'Back to the project';
 if(h.startsWith('#task='))return 'Back to the task';
 if(h.startsWith('#client='))return 'Back to the client';
 if(h==='#view=clients')return 'Back to clients';
 if(h==='#view=projects')return 'Back to projects & tasks';
 return 'Back to the list';
}
// A list screen becomes a "from" only when the person is going deeper; detail to detail keeps the original place.
export function chooseReturn({currentHash,currentIsDetail,carried,nextIsDetail}){
 if(!nextIsDetail)return '';
 if(currentIsDetail)return safeReturnHash(carried);
 return safeReturnHash(currentHash)||'#view=home';
}
export function createReturnStore(storage,{max=20,key='pcl-return-state-v1'}={}){
 const read=()=>{try{const v=JSON.parse(storage?.getItem(key)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}};
 const write=v=>{try{storage?.setItem(key,JSON.stringify(v));}catch{}};
 return {
  save(hash,state){const h=safeReturnHash(hash);if(!h)return false;const all=read();delete all[h];all[h]={state,at:Date.now()};const names=Object.keys(all);for(const old of names.slice(0,Math.max(0,names.length-max)))delete all[old];write(all);return true;},
  peek(hash){const h=safeReturnHash(hash);return h?read()[h]?.state||null:null;},
  take(hash){const h=safeReturnHash(hash);if(!h)return null;const all=read(),found=all[h]?.state||null;if(found){delete all[h];write(all);}return found;},
  clear(){write({});}
 };
}
