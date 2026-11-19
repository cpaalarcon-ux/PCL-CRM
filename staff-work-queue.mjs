// Build 2896: the work queue. One list on Home in three groups (To do, In progress, Done) with a bulk bar for journals.
// The list is read from the server (action work_queue); every decision goes to work_queue_decide, which tests each journal against the same rules as a single approval
// and refuses the whole batch, naming the journals, if any one is not allowed. Buttons the person may not use are not shown. Nothing is posted until the person presses the final button.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const GROUPS=['To do','In progress','Done'];
export const TAB_KEY='pclWorkQueueTab';
export const DECISIONS={check:{label:'Check',button:'Record the check',verb:'check',note:'Check note'},return:{label:'Return with a reason',button:'Return to the preparer',verb:'return',note:'Reason for returning (the preparer sees it)'},approve:{label:'Approve and post',button:'Approve and post',verb:'approve and post',note:'Approval note'}};
const money=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n||0));
// Decisions every selected journal allows. A decision that one of them does not allow is not offered.
export function sharedDecisions(selected){
 if(!selected.length)return [];
 return Object.keys(DECISIONS).filter(d=>selected.every(x=>(x.can||[]).includes(d)));
}
export const selectedTotal=selected=>Math.round(selected.reduce((s,x)=>s+Number(x.amount||0),0)*100)/100;
export const tabItems=(items,group)=>(items||[]).filter(x=>x.group===group);
export const selectable=item=>item.kind==='journal'&&(item.can||[]).length>0;
export function summaryLine(decision,selected){
 const n=selected.length,what=`${n} journal${n===1?'':'s'}`;
 return `You are about to ${DECISIONS[decision].verb} ${what}, total ${money(selectedTotal(selected))}. If any one of them is not allowed, none is changed.`;
}
export function createWorkQueueUI(ctx){
 const {$,esc=e0,form,modal,request,notice,shortDate}=ctx,d=()=>ctx.data();
 let box=null,state={items:[],counts:{},error:''},tab='To do';const picked=new Set();
 try{const v=globalThis.sessionStorage?.getItem(TAB_KEY);if(GROUPS.includes(v))tab=v;}catch{/* the tab is only a convenience */}
 const mineSelected=()=>state.items.filter(x=>picked.has(x.key)&&selectable(x));
 function row(x){
  const can=selectable(x),open=x.kind==='unmapped'?`<button type="button" data-open-project="${esc(x.project_id)}">Open project</button>`:`<button type="button" data-my-review="${esc(x.kind)}" data-id="${esc(x.id)}" data-client="${esc(x.client_id)}" data-project="${esc(x.project_id||'')}" data-period="${esc(x.period_id||'')}">${x.group==='Done'?'View':x.kind==='escalation'?'Answer':x.can?.includes('check')&&!x.can.includes('approve')?'Open to check':x.group==='To do'&&x.own?'Open':'Open'}</button>`;
  return `<div class="home-exception-row" data-wq-row="${esc(x.key)}">${can?`<label class="wq-pick"><input type="checkbox" data-wq-pick="${esc(x.key)}"${picked.has(x.key)?' checked':''} aria-label="Select ${esc(x.title)}"></label>`:''}<div><b>${esc(x.client_name)}</b><small>${esc(x.title)}${x.at?` · ${esc(shortDate(x.at))}`:''}${x.amount!=null&&x.kind==='journal'?` · ${esc(money(x.amount))}`:''}</small><small><strong>${esc(x.stage)}</strong></small></div>${open}</div>`;
 }
 function bar(){
  const sel=mineSelected();if(!sel.length)return '';
  const shared=sharedDecisions(sel);
  const buttons=shared.map(k=>`<button type="button" data-wq-decide="${k}"${k==='approve'?' class="primary"':''}>${esc(DECISIONS[k].label)}</button>`).join(' ');
  return `<div class="wq-bar" role="group" aria-label="Actions for the selected journals"><b>${sel.length} selected · ${esc(money(selectedTotal(sel)))}</b> ${buttons||'<span class="muted">These journals need different decisions. Select ones that need the same decision.</span>'} <button type="button" data-wq-clear>Clear</button></div>`;
 }
 function paint(){
  if(!box)return;
  const head=box.querySelector('.section-head')?.outerHTML||'';
  if(state.error){box.innerHTML=head+`<p class="muted compact-empty">${esc(state.error)}</p>`;return;}
  const items=tabItems(state.items,tab),pickable=items.filter(selectable),allOn=pickable.length>0&&pickable.every(x=>picked.has(x.key));
  const tabs=GROUPS.map(g=>`<button type="button" data-wq-tab="${esc(g)}" aria-pressed="${g===tab}"${g===tab?' class="active"':''}>${esc(g)} · ${state.counts[g]||0}</button>`).join('');
  box.innerHTML=head+`<div class="items-switch" role="group" aria-label="Work queue groups">${tabs}</div>${pickable.length?`<label class="wq-all"><input type="checkbox" data-wq-all${allOn?' checked':''}> Select all ${pickable.length} that I can decide</label>`:''}${bar()}`+(items.map(row).join('')||`<p class="muted compact-empty">${tab==='To do'?'Nothing needs you right now.':tab==='In progress'?'Nothing is waiting on someone else.':'Nothing finished in the last two weeks.'}</p>`);
 }
 async function load(){
  try{const r=await request({action:'work_queue'});state={items:r.items||[],counts:r.counts||{},error:'',min_note:r.min_note||10};
   const keep=new Set(state.items.map(x=>x.key));for(const k of [...picked])if(!keep.has(k))picked.delete(k);
  }catch(e){state={items:[],counts:{},error:'The work queue could not be loaded. Refresh to try again.'};}
  paint();
 }
 function decide(k){
  const sel=mineSelected();if(!sel.length||!sharedDecisions(sel).includes(k))return;
  const m=DECISIONS[k],list=`<ul class="full">${sel.slice(0,12).map(x=>`<li>${esc(x.title)} · ${esc(money(x.amount))}</li>`).join('')}${sel.length>12?`<li>and ${sel.length-12} more</li>`:''}</ul>`;
  const tick=k==='approve'?`<label class="full"><input type="checkbox" name="confirm_reviewed" value="yes" required> I have reviewed these journals. Approving posts them to the ledger.</label>`:'';
  modal(`${m.label}: ${sel.length} journal${sel.length===1?'':'s'}`,form(`<p class="info full">${esc(summaryLine(k,sel))}</p>${list}<label class="full">${esc(m.note)} *<textarea name="note" required minlength="10" maxlength="5000" rows="3"></textarea></label>${tick}`,m.button),
   async f=>{
    const note=String(f.get('note')||'').trim();
    if(note.length<10)throw Error(k==='return'?'Give the reason for returning, at least 10 characters.':'Enter a note of at least 10 characters.');
    if(k==='approve'&&!f.get('confirm_reviewed'))throw Error('Tick the box to confirm you have reviewed these journals.');
    return request({action:'work_queue_decide',decision:k,journal_ids:sel.map(x=>x.id),note,confirm_reviewed:k==='approve'?true:undefined,revisions:sel.map(x=>({journal_id:x.id,revision:x.revision}))});
   },
   async r=>{picked.clear();notice(r?.note||'Done.');await load();},{pendingLabel:'Working…',pendingMessage:'Working on the selected journals. Please wait.',successMessage:'Saved.'});
 }
 function bind(){
  if(!box||box.dataset.wqBound)return;box.dataset.wqBound='1';
  box.addEventListener('click',ev=>{
   const t=ev.target.closest('[data-wq-tab],[data-wq-decide],[data-wq-clear]');if(!t)return;
   if(t.dataset.wqTab){tab=t.dataset.wqTab;try{globalThis.sessionStorage?.setItem(TAB_KEY,tab);}catch{/* not kept */}paint();}
   else if(t.dataset.wqDecide)decide(t.dataset.wqDecide);
   else if(t.hasAttribute('data-wq-clear')){picked.clear();paint();}
  });
  box.addEventListener('change',ev=>{
   const c=ev.target;
   if(c.matches?.('[data-wq-pick]')){if(c.checked)picked.add(c.dataset.wqPick);else picked.delete(c.dataset.wqPick);paint();}
   else if(c.matches?.('[data-wq-all]')){const items=tabItems(state.items,tab).filter(selectable);for(const x of items){if(c.checked)picked.add(x.key);else picked.delete(x.key);}paint();}
  });
 }
 return {
  card:()=>`<section class="card home-my-reviews" id="homeWorkQueue" aria-live="polite"><div class="section-head"><div><h2>Work queue</h2><p class="muted">Everything that needs you, is waiting on someone else, or was finished lately, in one place. Tick journals to check, return or approve several at once; each one is still tested on its own, and a journal you prepared or edited can never be selected.</p></div></div><p class="muted compact-empty">Loading…</p></section>`,
  mount:async()=>{box=$('#homeWorkQueue');if(!box)return;bind();await load();},
  groups:()=>[...GROUPS]
 };
}
