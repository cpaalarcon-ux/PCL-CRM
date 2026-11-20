// Standard wording and client-specific disclosures (build 2878). The year's disclosures are declared as text or as "Nothing to report" and approved by a Manager or Partner who did not declare them;
// the firm's standard wording library is prepared by a Manager or Partner and approved by a Partner. Until all of it is approved the annual pack stays a draft. The server owns every rule;
// this file draws what it returns.
export function createWordingUI(ctx,{payload,show,onChange}){
 const {esc,field,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='',extra='')=>`<button type="button" data-wording="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 const BADGE={'Approved':'<span class="badge good">Approved</span>','Waiting for approval':'<span class="badge warn">Waiting for approval</span>','Waiting for a Partner':'<span class="badge warn">Waiting for a Partner</span>','Returned':'<span class="badge red">Returned</span>','Not declared':'<span class="badge red">Not declared</span>','Not prepared':'<span class="badge red">Not prepared</span>'};
 let data=null,lib=null;
 const who=(n,at)=>n?` ${esc(n)}${at?' on '+esc(shortDate(at)):''}`:'';
 const disclosureHtml=(d,i,n)=>{
  const shown=d.approved||d.draft||d.returned,text=shown?(shown.state==='Nothing to report'?'Nothing to report.':esc(shown.body||'')):'';
  const act=[
   data.can_declare?btn('declare',d.state==='Not declared'?'Declare':'Declare again',d.code):'',
   d.can_review?btn('approve',d.declared_by_me?'Approve (as the only Partner)':'Approve',d.draft.disclosure_id)+btn('return','Return',d.draft.disclosure_id):'',
   data.can_order?btn('up','Move up',d.code,i===0?'disabled':'')+btn('down','Move down',d.code,i===n-1?'disabled':''):''
  ].join('');
  return `<section class="card section-space"><h4>${esc(d.title)} ${BADGE[d.state]||''}</h4><p class="muted"><small>${esc(d.hint)}${d.allow_nothing?'':' “Nothing to report” is not allowed here.'}${d.inline?' Used inside the accounting policy wording.':''}</small></p>${shown?`<p>${text}</p><p class="muted"><small>Version ${shown.version} declared by${who(shown.declared_name,shown.declared_at)}${d.state==='Approved'&&shown.reviewed_name?'; approved by'+who(shown.reviewed_name,shown.reviewed_at)+(shown.sole_partner_approval?' (the firm’s only Partner)':''):''}${d.state==='Returned'&&shown.review_note?'; returned: '+esc(shown.review_note):''}.</small></p>`:''}${d.draft&&d.approved?`<p class="muted"><small>A new version by${who(d.draft.declared_name,d.draft.declared_at)} waits for approval. The approved text stands until then.</small></p>`:''}${act?`<div class="actions">${act}</div>`:''}</section>`;
 };
 const sectionHtml=s=>`<section class="card section-space"><h4>${esc(s.title)} <small class="muted">${esc(s.group)}</small></h4>${s.text===null?'<p class="missing">Not ready: see the list above.</p>':`<p>${esc(s.text)}</p>`}</section>`;
 async function open(){
  data=await request(payload('ledger_wording_read'));
  const list=data.disclosures,state=data.complete?'<p><span class="badge good">All wording and disclosures approved</span></p>':'<p><span class="badge red">Not complete</span></p>';
  show('Wording and disclosures',`<p class="info full">${esc(data.note)}</p>${data.locked?'<p class="error" role="alert">The pack is locked by an audit, so nothing here can change until a Partner ends the lock.</p>':''}${state}${data.problems.length?`<ul class="error" role="alert">${data.problems.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}<div class="actions">${btn('library','Standard wording library for '+(data.edition||'this edition'))}</div><h3>Disclosures for this year</h3>${list.map((d,i)=>disclosureHtml(d,i,list.length)).join('')}<h3>How the wording reads now</h3>${data.sections.map(sectionHtml).join('')||'<p class="missing">Nothing to show yet.</p>'}`);
 }
 const libRow=e=>{
  const sel=data&&lib.can_review&&e.draft?`<label><input type="checkbox" data-wsel value="${esc(e.draft.wording_id)}"> Select</label>`:'';
  const prep=lib.can_prepare?btn('lib-edit',e.draft||e.approved?'Edit and prepare':'Prepare',e.code+'|'+e.variant):'';
  return `<section class="card section-space"><h4>${esc(e.title)} <small class="muted">${esc(e.group)}${e.variant==='All'?'':' · '+esc(e.variant)}</small> ${BADGE[e.state]||''}</h4>${e.review_hint?`<p class="info"><small>${esc(e.review_hint)}</small></p>`:''}<p>${esc((e.draft||e.approved||{body:e.built_in}).body)}</p><p class="muted"><small>${e.draft?`Version ${e.draft.version} (${esc(e.draft.origin)}) prepared by${who(e.draft.prepared_name,e.draft.prepared_at)} waits for a Partner.`:e.approved?`Version ${e.approved.version} approved by${who(e.approved.reviewed_name,e.approved.reviewed_at)}${e.approved.sole_partner_approval?' (the firm’s only Partner)':''}.`:'Built-in draft. It is not used until a Partner approves it.'}${e.applies_when?' Used when the year has a '+esc(e.applies_when)+' note.':''}</small></p><div class="actions">${prep}${sel}</div></section>`;
 };
 async function openLibrary(){
  lib=await request({...payload('wording_library_read'),framework:data.framework,edition:data.edition});
  const drafts=lib.entries.filter(e=>e.draft).length,missing=lib.entries.filter(e=>e.state==='Not prepared').length;
  show('Standard wording library',`<p class="info full">${esc(lib.note)}</p><p>${esc(lib.framework)}, ${esc(lib.edition)}: ${lib.approved_count} of ${lib.total} approved.</p><div class="actions">${lib.can_prepare&&missing?btn('lib-prepare-all','Prepare all built-in drafts ('+missing+')'):''}${lib.can_review&&drafts?btn('lib-approve','Approve selected')+btn('lib-return','Return selected'):''}${btn('back','Back to the year')}</div>${lib.has_built_in?lib.entries.map(libRow).join(''):''}`);
 }
 const selected=()=>[...document.querySelectorAll('[data-wsel]:checked')].map(x=>x.value);
 const handlers={
  library:()=>openLibrary(),back:()=>open(),
  declare(code){
   const d=data.disclosures.find(x=>x.code===code),prev=d.draft||d.approved||d.returned;
   show('Declare: '+d.title,form(`<p class="info full">${esc(d.hint)}</p><label class="full">Declaration <select name="state"><option value="Text">I will write it</option>${d.allow_nothing?'<option value="Nothing to report">Nothing to report</option>':''}</select></label><label class="full">Text <textarea name="body" maxlength="4000">${esc(prev&&prev.body||'')}</textarea></label>`,'Declare'),
    f=>request({...payload('ledger_disclosure_declare'),code,state:f.get('state'),body:f.get('state')==='Nothing to report'?undefined:f.get('body')||''}),async()=>{notice('Declared. A Manager or Partner approves it.');await open();onChange?.();});
  },
  async approve(id){
   const d=data.disclosures.find(x=>x.draft&&x.draft.disclosure_id===id);
   if(d&&d.declared_by_me){
    show('Approve a disclosure you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>'+field('review_note','Note (optional)','','text','maxlength="500"'),'Approve'),
     f=>request({...payload('ledger_disclosure_review'),disclosure_id:id,decision:'Approved',sole_partner_approval:f.has('sole'),review_note:f.get('review_note')||''}),async()=>{notice('Approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_disclosure_review'),disclosure_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  return(id){show('Return the disclosure',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_disclosure_review'),disclosure_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});},
  async up(code){await move(code,-1);},down:code=>move(code,1),
  async 'lib-prepare-all'(){const r=await request({...payload('wording_library_prepare_all'),framework:data.framework,edition:data.edition});notice(`${r.prepared} built-in draft${r.prepared===1?'':'s'} prepared. A Partner approves them.`);await openLibrary();},
  'lib-edit'(key){
   const [code,variant]=key.split('|'),e=lib.entries.find(x=>x.code===code&&x.variant===variant);
   show('Prepare: '+e.title,form(`<p class="info full">Placeholders you may use: {entity}, {year_end}, {framework}, {edition}, {rounding}, {early_application}${e.code.startsWith('POLICY_')?', and the client’s own fact in double braces where the built-in text uses it':''}.</p><label class="full">Wording <textarea name="body" required minlength="20" maxlength="4000">${esc((e.draft||e.approved||{body:e.built_in}).body)}</textarea></label>`,'Prepare for approval'),
    f=>request({...payload('wording_library_prepare'),framework:data.framework,edition:data.edition,code,variant,body:f.get('body')}),async()=>{notice('Prepared. A Partner approves it.');await openLibrary();onChange?.();});
  },
  async 'lib-approve'(){
   const ids=selected();if(!ids.length){notice('Select the wording to approve.',true);return;}
   const own=lib.entries.some(e=>e.draft&&ids.includes(e.draft.wording_id)&&e.drafted_by_me);
   if(own){
    show('Approve wording you prepared',form('<p class="info full">Some of the selected wording was prepared by you. This is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>','Approve'),
     f=>request({...payload('wording_library_review'),framework:data.framework,edition:data.edition,wording_ids:ids,decision:'Approved',sole_partner_approval:f.has('sole')}),async()=>{notice('Approved.');await openLibrary();onChange?.();});
    return;
   }
   await request({...payload('wording_library_review'),framework:data.framework,edition:data.edition,wording_ids:ids,decision:'Approved'});notice(`${ids.length} approved.`);await openLibrary();onChange?.();
  },
  'lib-return'(){
   const ids=selected();if(!ids.length){notice('Select the wording to return.',true);return;}
   show('Return the wording',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
    f=>request({...payload('wording_library_review'),framework:data.framework,edition:data.edition,wording_ids:ids,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await openLibrary();onChange?.();});
  }
 };
 async function move(code,by){
  const order=data.disclosures.map(d=>d.code),i=order.indexOf(code),j=i+by;if(i<0||j<0||j>=order.length)return;
  [order[i],order[j]]=[order[j],order[i]];
  await request({...payload('ledger_disclosure_order'),codes:order});await open();
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-wording]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.wording]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
