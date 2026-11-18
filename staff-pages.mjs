// Client pages of the annual pack (build 2884): the cover, entity information, report of the directors or partners, statement of responsibilities and key figures.
// The cover and the key figures are built from verified client facts and the statements. The other three are declared for the year and approved by a Manager or Partner who did not declare them.
// The server owns every rule; this file draws what it returns.
export function createPagesUI(ctx,{payload,show,onChange}){
 const {esc,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='',extra='')=>`<button type="button" data-pages="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 const BADGE={'Approved':'<span class="badge good">Approved</span>','Waiting for approval':'<span class="badge warn">Waiting for approval</span>','Returned':'<span class="badge red">Returned</span>','Not declared':'<span class="badge red">Not declared</span>',
  'Ready':'<span class="badge good">Ready</span>','Not ready':'<span class="badge red">Not ready</span>','Not applicable':'<span class="badge">Not applicable</span>'};
 let data=null;
 const who=(n,at)=>n?` ${esc(n)}${at?' on '+esc(shortDate(at)):''}`:'';
 const blockHtml=b=>{
  if(b.type==='title')return `<h3>${esc(b.text)}</h3>`;
  if(b.type==='subtitle')return `<h4>${esc(b.text)}</h4>`;
  if(b.type==='heading')return `<h4>${esc(b.text)}</h4>`;
  if(b.type==='text')return `<p>${esc(b.text).replace(/\n/g,'<br>')}</p>`;
  if(b.type==='note')return `<p class="muted"><small>${esc(b.text)}</small></p>`;
  if(b.type==='lines')return `<dl>${b.lines.map(l=>`<dt>${esc(l[0])}</dt><dd>${esc(l[1])}</dd>`).join('')}</dl>`;
  if(b.type==='signatures')return `<ul>${b.names.map(n=>`<li>${esc(n)} ______________________</li>`).join('')}</ul>`;
  if(b.type==='figures')return `<table><thead><tr><th>${esc(b.unit)}</th><th>Current year</th><th>Prior year</th></tr></thead><tbody>${b.rows.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.current_text)}</td><td>${esc(r.prior_text)}</td></tr>`).join('')}</tbody></table>`;
  return '';
 };
 const pageHtml=p=>{
  const d=data.declared.find(x=>x.code===p.code);
  const shown=d&&(d.approved||d.draft||d.returned);
  const act=d?[
   data.can_declare?btn('declare',d.state==='Not declared'?'Declare':'Declare again',d.code):'',
   d.can_review?btn('approve',d.declared_by_me?'Approve (as the only Partner)':'Approve',d.draft.page_id)+btn('return','Return',d.draft.page_id):''
  ].join(''):'';
  const meta=d&&shown?`<p class="muted"><small>Version ${shown.version} declared by${who(shown.declared_name,shown.declared_at)}${d.state==='Approved'&&shown.reviewed_name?'; approved by'+who(shown.reviewed_name,shown.reviewed_at)+(shown.sole_partner_approval?' (the firm’s only Partner)':''):''}${d.state==='Returned'&&shown.review_note?'; returned: '+esc(shown.review_note):''}.</small></p>${d.draft&&d.approved?`<p class="muted"><small>A new version by${who(d.draft.declared_name,d.draft.declared_at)} waits for approval. The approved text stands until then.</small></p>`:''}`:'';
  const status=d?BADGE[d.state]||'':'';
  return `<section class="card section-space"><h4>${esc(p.title)} ${BADGE[p.state]||''} ${status&&d.state!==p.state?status:''}</h4>${p.problems.length?`<ul class="error">${p.problems.map(m=>`<li>${esc(m)}</li>`).join('')}</ul>`:p.blocks.map(blockHtml).join('')}${meta}${act?`<div class="actions">${act}</div>`:''}</section>`;
 };
 async function open(){
  data=await request(payload('ledger_pages_read'));
  const state=data.complete?'<p><span class="badge good">All client pages ready</span></p>':'<p><span class="badge red">Not complete</span></p>';
  show('Client pages',`<p class="info full">${esc(data.note)}</p>${data.locked?'<p class="error" role="alert">The pack is locked by an audit, so nothing here can change until a Partner ends the lock.</p>':''}${state}${data.pages.map(pageHtml).join('')}`);
 }
 const val=(prev,k)=>esc(prev&&prev.fields&&prev.fields[k]||'');
 const handlers={
  back:()=>open(),
  declare(code){
   const d=data.declared.find(x=>x.code===code),prev=d.draft||d.approved||d.returned,pre=d.prefill,prevNA=prev&&prev.state==='Not applicable';
   const rows=d.fields.map(f=>f.multiline?`<label class="full">${esc(f.label)}${f.required?' *':''} <textarea name="f_${esc(f.key)}" maxlength="${f.max}" ${f.required?'required':''}>${val(prev,f.key)}</textarea></label>`:`<label class="full">${esc(f.label)}${f.required?' *':''} <input name="f_${esc(f.key)}" maxlength="${f.max}" value="${val(prev,f.key)}" ${f.required?'required':''}></label>`);
   let extra='';
   if(code==='RESPONSIBILITIES'){
    const chosen=new Set((prev&&prev.fields&&prev.fields.signatories)||[]);
    rows.length=0;
    rows.push(`<p class="info full">${esc(pre.note)}</p><label class="full">Statement * <textarea name="f_statement" rows="9" maxlength="3000" required>${esc(prev&&prev.fields&&prev.fields.statement||pre.statement)}</textarea></label>`,
     `<label class="full">Date the financial statements were approved * <input name="approved_on" type="date" value="${esc(prev&&prev.fields&&prev.fields.approved_on||'')}"></label>`,
     `<fieldset class="full"><legend>Who signs (one to three, from the client’s record) *</legend>${pre.signatory_choices.length?pre.signatory_choices.map(n=>`<label><input type="checkbox" name="signatories" value="${esc(n)}" ${chosen.has(n)?'checked':''}> ${esc(n)}</label>`).join(''):'<p class="missing">No director, partner or verified officer is on the client’s record yet.</p>'}</fieldset>`);
   }
   if(d.can_be_not_applicable)extra=`<label class="full">This page <select name="state"><option value="Declared"${prevNA?'':' selected'}>applies; I will write it</option><option value="Not applicable"${prevNA?' selected':''}>does not apply (a Partner approves this)</option></select></label><label class="full">If it does not apply, why? (at least 10 characters) <textarea name="reason" maxlength="500">${esc(prev&&prev.reason||'')}</textarea></label>`;
   show('Declare: '+d.title,form(`${extra}${rows.join('')}<p class="muted full"><small>Write “None” where there is none. A blank is not read as none.</small></p>`,'Declare'),
    f=>{
     const state=d.can_be_not_applicable?f.get('state'):'Declared';
     if(state==='Not applicable')return request({...payload('ledger_page_declare'),code,state,reason:f.get('reason')||''});
     const fields={};for(const x of d.fields){const v=f.get('f_'+x.key);if(v!==null&&String(v).trim()!=='')fields[x.key]=String(v);}
     if(code==='RESPONSIBILITIES'){fields.approved_on=f.get('approved_on')||'';fields.signatories=f.getAll('signatories');}
     return request({...payload('ledger_page_declare'),code,state:'Declared',fields});
    },async()=>{notice('Declared. A Manager or Partner approves it.');await open();onChange?.();});
  },
  async approve(id){
   const d=data.declared.find(x=>x.draft&&x.draft.page_id===id);
   if(d&&d.declared_by_me){
    show('Approve a page you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner</label>','Approve'),
     f=>request({...payload('ledger_page_review'),page_id:id,decision:'Approved',sole_partner_approval:f.has('sole')}),async()=>{notice('Approved.');await open();onChange?.();});
    return;
   }
   await request({...payload('ledger_page_review'),page_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  return(id){show('Return the page',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),
   f=>request({...payload('ledger_page_review'),page_id:id,decision:'Returned',review_note:f.get('review_note')}),async()=>{notice('Returned to the preparer.');await open();onChange?.();});}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-pages]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.pages]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
