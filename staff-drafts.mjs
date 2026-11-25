// Build 2903: resumable form drafts and unsaved-change protection.
// A form that opts in (modal option `draft`) gets a status line ("All changes saved at 10:45 EAT"), automatic saving to the server a moment after the last change, and a
// "Save draft & return to queue" button. A saved draft is private to its owner, is never an approval or a ledger record, and is removed when the form is submitted.
// Closing a form that holds changes which are not saved asks first. Passwords, tokens and other secrets are never read from a form.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const SECRET_NAME=/(passw|passcode|secret|token|api[_-]?key|authori[sz]ation|credential|\botp\b)/i;
export const LEAVE_TEXT='You have unsaved changes. Are you sure you want to leave?';
export const AUTOSAVE_MS=2500;
export const TAX_ASIDE_PREFIX='pcl-client-tax-draft:';
export const nairobiTime=(at=new Date())=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(at));
export const savedLabel=at=>`✓ All changes saved at ${nairobiTime(at)} EAT`;
export const UNSAVED_LABEL='Unsaved changes. They are saved as a draft a moment after you stop typing.';

// Values of a form's named controls, without anything secret. Repeated names (rows) come back in order as arrays; checkboxes and radios only when ticked.
export function collectFields(form){
 const out={};
 for(const el of form.elements||[]){
  const name=el.name;
  if(!name||el.disabled||SECRET_NAME.test(name))continue;
  const type=String(el.type||'').toLowerCase();
  if(['password','file','submit','button','reset','image'].includes(type))continue;
  if((type==='checkbox'||type==='radio')&&!el.checked)continue;
  const value=el.tagName==='SELECT'&&el.multiple?[...el.selectedOptions].map(o=>o.value):el.value;
  if(name in out){if(!Array.isArray(out[name]))out[name]=[out[name]];out[name].push(value);}else out[name]=value;
 }
 return out;
}
// Puts saved values back. Repeated names are filled in order. A control that no longer exists is skipped, never invented.
export function applyFields(form,fields={}){
 const seen={};
 for(const el of [...(form.elements||[])]){
  const name=el.name;
  if(!name||SECRET_NAME.test(name)||!(name in fields))continue;
  const type=String(el.type||'').toLowerCase();
  if(['password','file','submit','button','reset','image'].includes(type))continue;
  const saved=fields[name],list=Array.isArray(saved)?saved:[saved];
  if(type==='checkbox'||type==='radio'){el.checked=list.map(String).includes(String(el.value));continue;}
  const i=seen[name]=(seen[name]??-1)+1;
  const v=Array.isArray(saved)?saved[i]:(i===0?saved:undefined);
  if(v===undefined)continue;
  if(el.tagName==='SELECT'&&el.multiple){const want=Array.isArray(v)?v.map(String):[String(v)];for(const o of el.options)o.selected=want.includes(o.value);}
  else el.value=v;
 }
}
// Build 2904: a short stable key for a set of rows, so one draft belongs to one selection. It only names the draft; it is not a security value.
export function shortHash(list){let h=5381;const t=[...list].map(String).sort().join('|');for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))>>>0;return h.toString(36);}
// What a saved selection of rows looks like now. A row that is gone from the page, already mapped, or changed since the draft was saved is reported, never silently applied.
// saved: {row_ids:[...],revisions:{row_id:revision}}. current: the rows now on screen. Returns {rows:[rows still safe to use],changed:[{row_id,reason}]}.
export function compareRows(saved,current){
 const byId=new Map((current||[]).map(r=>[String(r.row_id),r])),rows=[],changed=[];
 for(const id of saved?.row_ids||[]){
  const r=byId.get(String(id));
  if(!r){changed.push({row_id:id,reason:'No longer on this page or in this filter'});continue;}
  if(r.account_code||r.is_split_parent){changed.push({row_id:id,reason:'Already mapped or split since the draft was saved'});continue;}
  const was=saved.revisions?.[id];
  if(was!==undefined&&was!==null&&String(was)!==String(r.revision)){changed.push({row_id:id,reason:'Changed since the draft was saved'});continue;}
  rows.push(r);
 }
 return {rows,changed};
}
export const changedNote=changed=>changed.length?`${changed.length} row${changed.length===1?'':'s'} from your draft ${changed.length===1?'was':'were'} left out: ${[...new Set(changed.map(c=>c.reason))].join('; ').toLowerCase()}. Check the rows before you save.`:'';
export const draftRow=(d,{esc=e0}={})=>`<div class="home-exception-row" data-draft-row="${esc(d.id||d.draft_id)}"><div><b>${esc(d.title)}</b><small>${esc(d.client_name||'')}${d.client_name&&d.project_name?' · ':''}${esc(d.project_name||'')}</small><small>${esc(d.stage||'Saved draft: resume where you stopped')}</small></div><div class="actions"><button type="button" data-draft-resume="${esc(d.id||d.draft_id)}">Resume draft</button><button type="button" data-draft-discard="${esc(d.id||d.draft_id)}" aria-label="Discard draft ${esc(d.title)}">Discard</button></div></div>`;

// A small in-app question that does not depend on the browser's own dialog. Resolves with the id of the button pressed; Escape means the first (safe) choice.
export function ask(doc,{title,text,choices}){
 return new Promise(resolve=>{
  const dlg=doc.createElement('dialog');dlg.className='leave-dialog';dlg.setAttribute('aria-labelledby','leaveTitle');
  dlg.innerHTML=`<h2 id="leaveTitle">${e0(title)}</h2><p>${e0(text)}</p><div class="actions">${choices.map((c,i)=>`<button type="button" data-leave="${e0(c.id)}"${i===0?' class="primary" autofocus':''}>${e0(c.label)}</button>`).join('')}</div>`;
  const sessionEnded=()=>done(choices[0].id);
  const done=id=>{doc.removeEventListener('pcl-staff-session-ended',sessionEnded);dlg.close();dlg.remove();resolve(id);};
  dlg.addEventListener('click',ev=>{const b=ev.target.closest?.('[data-leave]');if(b)done(b.dataset.leave);});
  dlg.addEventListener('cancel',ev=>{ev.preventDefault();done(choices[0].id);});
  doc.addEventListener('pcl-staff-session-ended',sessionEnded);
  doc.body.appendChild(dlg);dlg.showModal();
 });
}

export function createDraftUI(ctx){
 const {$,request,notice,esc=e0}=ctx,doc=ctx.document||globalThis.document,openers=new Map();
 let active=null; // the controller of the form that is open now

 // Attach to the form that modal() has just drawn. spec: {kind,key,title,project_id,client_id,collect(form)->extra,aside()->{storageKey:value}}.
 function attach(form,spec){
  detach();
  const bar=doc.createElement('div');bar.className='draft-bar';bar.setAttribute('role','group');bar.setAttribute('aria-label','Draft');
  bar.innerHTML=`<p class="draft-status" role="status" aria-live="polite"></p><button type="button" class="draft-return">Save draft &amp; return to queue</button>`;
  form.parentNode.insertBefore(bar,form);
  const status=bar.querySelector('.draft-status'),returnBtn=bar.querySelector('.draft-return');
  let timer=null,dirty=false,savedAt=spec.savedAt||null,busy=null,failed='',editVersion=0;
  const text=()=>{
   status.classList.toggle('error',!!failed);status.setAttribute('role',failed?'alert':'status');
   status.textContent=failed?`Not saved yet: ${failed}`:dirty?UNSAVED_LABEL:savedAt?savedLabel(savedAt):'No changes yet.';
  };
  const fieldsOf=()=>{const out=collectFields(form);if(spec.skip)for(const k of Object.keys(out))if(spec.skip.test(k))delete out[k];return out;};
  const payload=()=>({meta:spec.meta||{},fields:fieldsOf(),...(spec.collect?spec.collect(form):{}),...(spec.aside?{aside:spec.aside()}:{})});
  async function saveNow(explicit=false){
   clearTimeout(timer);timer=null;
   while(busy)await busy.catch(()=>{});
   if(!dirty&&!explicit&&savedAt)return true;
   const savingVersion=editVersion;
   const run=(async()=>{
    try{
     const r=await request({action:'form_draft_save',form_kind:spec.kind,subject_key:spec.key,title:typeof spec.title==='function'?spec.title(form):spec.title,project_id:spec.project_id||undefined,client_id:spec.client_id||undefined,payload:payload(),explicit:explicit||undefined});
     dirty=savingVersion!==editVersion;failed='';savedAt=r.saved_at||new Date().toISOString();text();return true;
    }catch(err){failed=err.message||'The draft could not be saved.';text();return false;}
   })();
   busy=run;const ok=await run;busy=null;return ok;
  }
  const changed=()=>{editVersion++;dirty=true;failed='';text();clearTimeout(timer);timer=setTimeout(()=>{void saveNow(false);},ctx.autosaveMs??AUTOSAVE_MS);};
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  // Rows added or removed by script (journal lines) do not fire input events, so those buttons count as a change too.
  form.addEventListener('click',ev=>{if(ev.target.closest?.('button[type=button]:not(.draft-return)'))changed();});
  returnBtn.onclick=async()=>{returnBtn.disabled=true;const ok=await saveNow(true);returnBtn.disabled=false;if(ok&&!dirty){ctx.returnToQueue?.();notice?.('Draft saved. Find it under To do on Home.');}};
  const c={spec,saved:()=>!dirty&&!!savedAt&&!failed,dirty:()=>dirty,saveNow,markSaved(at){savedAt=at||new Date().toISOString();dirty=false;failed='';text();},
   async submitted(){clearTimeout(timer);timer=null;if(busy)await busy.catch(()=>{});try{await request({action:'form_draft_discard',form_kind:spec.kind,subject_key:spec.key,reason:'submitted'});}catch{/* a stale draft is harmless and can be discarded from the queue */}active=null;},
   stop(){clearTimeout(timer);timer=null;}};
  active=c;text();return c;
 }
 function detach(){active?.stop();active=null;}
 const current=()=>active;

 // Leave a form that holds changes. Returns true when it is safe to close.
 async function confirmLeave(title='Leave this form?'){
  const c=active;
  if(c?.saved())return true;
  const choices=c?[{id:'stay',label:'Keep editing'},{id:'save',label:'Save draft and leave'},{id:'leave',label:'Leave without saving'}]:[{id:'stay',label:'Keep editing'},{id:'leave',label:'Leave without saving'}];
  const pick=await ask(doc,{title,text:LEAVE_TEXT+(c?' You can save it as a draft first.':''),choices});
  if(pick==='stay')return false;
  if(pick==='save'){const ok=await c.saveNow(true);if(!ok||!c.saved()){notice?.('The latest changes are still unsaved. The form stays open.',true);return false;}}
  return true;
 }

 // Sign-out: warn first about an open form with unsaved changes and about a client set-up schedule held only in this browser tab.
 const asides=()=>{const out=[];try{const s=ctx.sessionStorage||globalThis.sessionStorage;for(let i=0;i<s.length;i++){const k=s.key(i);if(k?.startsWith(TAX_ASIDE_PREFIX))out.push({key:k,client_id:k.slice(TAX_ASIDE_PREFIX.length),value:s.getItem(k)});}}catch{/* no storage */}return out;};
 const clearAsides=()=>{try{const s=ctx.sessionStorage||globalThis.sessionStorage;for(const a of asides())s.removeItem(a.key);}catch{/* nothing to clear */}};
 async function beforeSignOut({editorEdited=false}={}){
  const c=active,openUnsaved=editorEdited&&!(c&&c.saved()),held=asides();
  if(!openUnsaved&&!held.length){clearAsides();return true;}
  const canSave=(openUnsaved&&!!c)||held.length>0;
  const what=[openUnsaved?'a form with changes that are not saved':'',held.length?'a client set-up schedule kept only in this browser tab':''].filter(Boolean).join(' and ');
  const pick=await ask(doc,{title:'Sign out?',text:`You have ${what}. Signing out would lose ${openUnsaved&&held.length?'them':'it'}.`,choices:[{id:'stay',label:'Stay signed in'},...(canSave?[{id:'save',label:'Save as a draft and sign out'}]:[]),{id:'leave',label:'Sign out without saving'}]});
  if(pick==='stay')return false;
  if(pick==='save'){
   if(openUnsaved&&c&&!(await c.saveNow(true))){notice?.('The draft could not be saved, so you are still signed in.',true);return false;}
   for(const a of held){
    try{await request({action:'form_draft_save',form_kind:'client_edit',subject_key:'client-schedule:'+a.client_id,title:'Client set-up: project schedule not yet saved',client_id:a.client_id,payload:{meta:{client_id:a.client_id},fields:{},aside:{[a.key]:a.value}},explicit:true});}
    catch(err){notice?.('The set-up schedule could not be saved as a draft: '+err.message,true);return false;}
   }
  }
  clearAsides();return true;
 }

 // Resume from the queue. Each form registers how to reopen itself; the server only hands back what the person typed.
 const register=(kind,fn)=>openers.set(kind,fn);
 async function resume(draftId){
  const r=await request({action:'form_draft_read',draft_id:draftId});
  const d=r.draft;if(!d){notice?.('That draft is no longer available.',true);return false;}
  const open=openers.get(d.form_kind);if(!open){notice?.('This kind of draft cannot be reopened here.',true);return false;}
  await open(d);return true;
 }
 async function discard(draftId){await request({action:'form_draft_discard',draft_id:draftId});}
 const confirmDiscard=async title=>(await ask(doc,{title:'Discard this draft?',text:`"${title}" will be removed for good. Nothing else is changed.`,choices:[{id:'keep',label:'Keep the draft'},{id:'discard',label:'Discard it'}]}))==='discard';
 async function list(){const r=await request({action:'form_draft_list'});return (r.drafts||[]).map(d=>({...d,id:d.draft_id,stage:'Saved draft: resume where you stopped'}));}
 return {attach,detach,current,confirmLeave,beforeSignOut,register,resume,discard,confirmDiscard,list,draftRow:d=>draftRow(d,{esc}),asides,clearAsides};
}
