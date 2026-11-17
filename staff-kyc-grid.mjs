// Build 2854: the client set-up grid, laid out like the KRA iTax "Taxpayer profile" page.
// Editable cells, Tab and Enter move through them like a spreadsheet, a mandatory cell has a red asterisk and turns red when left empty, and a person can
// leave any section at any time. Set-up is not done until every mandatory cell is filled and verified. The page decides no rule: it saves facts through
// client_master_record_many and verifies them through client_master_verify_many, and the server checks every one again.
import {LAYOUT,OTHER_TITLE,kindOf,display,toStored,cellProblem,isMandatory,indexRows,otherRows,gridStatus,approvalTrail} from './staff-kyc-grid-rules.mjs?v=20261120-grid-v1';

export function createKycGridUI(ctx,{show,openList}){
 const {esc,request,notice,shortDate}=ctx,d=()=>ctx.data(),doc=()=>globalThis.document;
 const reviewer=()=>['PARTNER','MANAGER','SUPERVISOR'].includes(d().me.category_code);
 let st=null; // {cid,x,idx,dirty:Map(key→typed text),touched:Set,errors:Map(key→message),source:{kind,ref,docId},lastResult}

 const rowOf=k=>st.idx.get(k)||null;
 const must=k=>isMandatory(rowOf(k));
 const savedText=k=>{const r=rowOf(k);return r&&r.fact?display(k,r.fact.value):'';};
 const typedText=k=>st.dirty.has(k)?st.dirty.get(k):savedText(k);
 const stateOf=k=>{const r=rowOf(k);return r&&r.fact?(r.state==='Differs'?'differs':r.fact.status==='Verified'?'ver':'rec'):'empty';};
 const nameOf=r=>r&&r.fact?`${r.fact.status==='Verified'?'Verified':'Recorded'}${r.fact.recorded_by_name?' by '+r.fact.recorded_by_name:''}${r.fact.recorded_at?' on '+shortDate(r.fact.recorded_at):''}${r.fact.status==='Verified'&&r.fact.verified_by_name?'; verified by '+r.fact.verified_by_name+' on '+shortDate(r.fact.verified_at):''}. Source: ${r.fact.source_kind}${r.fact.source_reference?' · '+r.fact.source_reference:''}`:'';

 function compliance(){return (d().suite?.compliance||[]).find(c=>c.client_id===st.cid)||null;}
 function statusNow(){
  const c=compliance(),x=st.x;
  return gridStatus({rows:x.rows,eddNeeded:!!(c&&(c.is_pep||c.risk_rating==='High')),eddApproved:!!(c&&c.edd_approved_by),structureKnown:!!x.template||!!x.client.legal_entity_type});
 }
 // The count that matters while typing: a mandatory cell counts as filled when it has a saved value or a valid typed one.
 function liveCounts(){
  const req=st.x.rows.filter(isMandatory);
  const filled=req.filter(r=>{const t=typedText(r.key);return t&&!cellProblem(r.key,t,{mandatory:true});}).length;
  return {mandatory:req.length,filled};
 }

 // ---- drawing ----
 const star=k=>must(k)?'<span class="kg-star" aria-hidden="true">*</span><span class="sr-only"> required</span>':'';
 function valueCell(spec,r,c){
  if(!spec)return '<div class="kg-l kg-void"></div><div class="kg-v kg-void"></div>';
  const lid=`kgl-${r}-${c}`;
  if(spec.from){const v=st.x.client[spec.from];return `<div class="kg-l" id="${lid}">${esc(spec.label)}</div><div class="kg-v kg-ro" title="Set from the client's legal structure. A Partner classifies it.">${v?esc(v):'<span class="muted">Not set</span>'}</div>`;}
  if(spec.mirror){const v=typedText(spec.mirror)||st.x.client.company_name;return `<div class="kg-l" id="${lid}">${esc(spec.label)}</div><div class="kg-v kg-ro" title="Same as the taxpayer name.">${esc(v||'')}</div>`;}
  const k=spec.key,row=rowOf(k),typed=typedText(k),kind=kindOf(k),state=stateOf(k),req=must(k);
  const bad=st.errors.get(k),empty=!typed;
  const cls=`kg-v kg-${state}${req&&empty?' kg-req':''}${st.dirty.has(k)?' kg-dirty':''}${bad?' kg-bad':''}`;
  const common=`id="kg-${esc(k)}" data-kg="${esc(k)}" data-r="${r}" data-c="${c}" aria-labelledby="${lid}" ${req?'aria-required="true"':''} ${bad?`aria-invalid="true" aria-describedby="kgm-${esc(k)}"`:''}`;
  let input;
  if(kind==='yesno')input=`<select ${common}><option value=""></option><option${typed==='Yes'?' selected':''}>Yes</option><option${typed==='No'?' selected':''}>No</option></select>`;
  else input=`<input type="text" ${common} value="${esc(typed)}" autocomplete="off" spellcheck="false" ${kind==='date'?'inputmode="numeric" placeholder="dd/mm/yyyy"':kind==='daymonth'?'inputmode="numeric" placeholder="dd/mm"':k==='contact_email'||k==='secondary_email'?'inputmode="email"':/phone|mobile|telephone/.test(k)?'inputmode="tel"':''} maxlength="500">`;
  const tip=nameOf(row)||(row?.hint||'');
  return `<div class="kg-l" id="${lid}">${esc(spec.label)}${star(k)}</div><div class="${cls}" data-kg-cell="${esc(k)}" title="${esc(tip)}">${input}<span class="kg-warn" aria-hidden="true">⚠</span><span class="kg-msg" id="kgm-${esc(k)}" role="alert">${bad?esc(bad):''}</span></div>`;
 }
 function rows(list,base){return list.map((pair,i)=>`<div class="kg-row">${valueCell(pair[0],base+i,0)}${valueCell(pair[1],base+i,1)}</div>`).join('');}
 function body(){
  let n=0,html='';
  for(const s of LAYOUT){
   html+=`<section class="kg-sec"><h3 class="kg-bar">${esc(s.title)}</h3>`;
   if(s.rows){html+=`<div class="kg-box">${rows(s.rows,n)}</div>`;n+=s.rows.length;}
   for(const g of s.groups||[]){html+=`<fieldset class="kg-grp"><legend>${esc(g.title)}</legend><div class="kg-box">${rows(g.rows,n)}</div></fieldset>`;n+=g.rows.length;}
   html+='</section>';
  }
  const extra=otherRows(st.x.rows);
  if(extra.length){
   const pairs=[];for(let i=0;i<extra.length;i+=2)pairs.push([{key:extra[i].key,label:extra[i].label},extra[i+1]?{key:extra[i+1].key,label:extra[i+1].label}:null]);
   html+=`<section class="kg-sec"><h3 class="kg-bar">${esc(OTHER_TITLE)}</h3><div class="kg-box">${rows(pairs,n)}</div></section>`;
  }
  return html;
 }
 function trail(){
  const t=approvalTrail(st.x.rows),c=compliance(),line=p=>`<li><b>${esc(p.name)}</b><small>${esc(shortDate(p.first))}${p.last!==p.first?' to '+esc(shortDate(p.last)):''} · ${p.n} cell${p.n===1?'':'s'}</small></li>`;
  const edd=c&&(c.is_pep||c.risk_rating==='High')?`<li><b>Partner approval (enhanced due diligence)</b><small>${c.edd_approved_by?'Approved'+(c.edd_approved_at?' on '+esc(shortDate(c.edd_approved_at)):''):'Waiting for a Partner'}</small></li>`:'';
  return `<h4>Approval trail</h4><p class="kg-k">Prepared by</p><ul>${t.prepared.map(line).join('')||'<li class="muted">Nothing recorded yet</li>'}</ul><p class="kg-k">Verified by</p><ul>${t.verified.map(line).join('')||'<li class="muted">Nothing verified yet</li>'}</ul>${edd?`<p class="kg-k">Partner step</p><ul>${edd}</ul>`:''}`;
 }
 function side(){
  const s=statusNow(),miss=s.missing.map(k=>`<li><button type="button" class="link" data-kg-jump="${esc(k)}">${esc(rowOf(k)?.label||k)}</button></li>`).join('');
  const verifiable=st.x.rows.filter(r=>r.can_verify&&r.fact&&r.fact.status==='Recorded'&&!st.dirty.has(r.key)).length;
  return `<aside class="kg-side" aria-label="Approval and set-up status">${trail()}${miss?`<h4>Still empty (${s.missing.length})</h4><ul class="kg-miss">${miss}</ul>`:''}<div class="kg-links"><button type="button" data-kg-act="kyc">Open KYC checks</button><button type="button" data-kg-act="list">Officers, evidence and people</button></div>${reviewer()&&verifiable?`<div class="kg-verify"><button type="button" class="primary" data-kg-act="verify-open">Verify ${verifiable} cell${verifiable===1?'':'s'}…</button><div id="kgVerifyBox" hidden><label for="kgNote">What did you check them against? *</label><textarea id="kgNote" rows="2" maxlength="500" placeholder="For example, the KRA iTax taxpayer profile viewed today"></textarea><button type="button" class="primary" data-kg-act="verify-go">Verify now</button></div></div>`:''}</aside>`;
 }
 function top(){
  const s=statusNow(),lc=liveCounts(),x=st.x;
  const kinds=x.source_kinds.map(k=>`<option${k===st.source.kind?' selected':''}>${esc(k)}</option>`).join('');
  const docs=(d().documents||[]).filter(z=>!z.client_id||z.client_id===st.cid).map(z=>`<option value="${esc(z.document_id)}"${z.document_id===st.source.docId?' selected':''}>${z.doc_ref?esc(z.doc_ref)+' · ':''}${esc(z.file_name)}</option>`).join('');
  return `<div class="kg-top"><div class="kg-statusbar"><span class="kg-chip kg-s-${esc(s.code)}" id="kgChip">Status: ${esc(s.label)}</span><span id="kgCount" class="kg-count">${lc.filled} of ${lc.mandatory} mandatory cells filled · ${s.verified} verified</span></div><p class="muted" id="kgNext">${esc(s.next)}</p>
  <div class="kg-src"><label>Source of what you type <select data-kg-source="kind">${kinds}</select></label><label>${'Document'===st.source.kind?'Uploaded document':'Register, record or file'} ${st.source.kind==='Document'?`<select data-kg-source="docId"><option value="">Choose…</option>${docs}</select>`:`<input type="text" data-kg-source="ref" value="${esc(st.source.ref)}" maxlength="300" placeholder="KRA iTax taxpayer profile, viewed today">`}</label></div></div>`;
 }
 function foot(){
  const dirty=st.dirty.size,replacing=[...st.dirty.keys()].some(k=>rowOf(k)?.fact);
  const verifiedChange=[...st.dirty.keys()].some(k=>rowOf(k)?.fact?.status==='Verified');
  return `<div class="kg-foot"><span id="kgDirty" class="muted">${dirty?`${dirty} unsaved cell${dirty===1?'':'s'}`:'No unsaved changes'}</span>${replacing?`<label class="kg-why">Why are you changing a saved value? *<input type="text" id="kgReason" maxlength="500" value="${esc(st.reason||'')}">${verifiedChange?'<small>A verified value changed here must be verified again.</small>':''}</label>`:''}<button type="button" class="primary" data-kg-act="save"${dirty?'':' disabled'}>Save draft</button></div>`;
 }
 function html(){
  const x=st.x;
  return `<div class="kg" data-kg-root><p class="kg-title"><b>${esc(x.client.legal_structure==='Individual'?'Individual':'Non-Individual')} taxpayer profile</b> · ${esc(x.client.company_name)}${x.client.legal_entity_type?' · '+esc(x.client.legal_entity_type):''}</p>${top()}<div class="kg-layout"><div class="kg-main" id="kgMain">${body()}</div>${side()}</div>${foot()}<p class="muted kg-note">${esc(x.note)} Move with Tab and Enter. A red cell never stops you moving on; set-up counts as done only when every mandatory cell is filled and verified.</p></div>`;
 }
 function render(){show('Client details · '+st.x.client.company_name,html());const e=doc().querySelector('#editor');if(e)e.classList.add('ledger-dialog');}

 // ---- live updates without redrawing (so the cursor stays where it is) ----
 function paintCell(k){
  const box=doc().querySelector(`[data-kg-cell="${k}"]`);if(!box)return;
  const empty=!typedText(k),bad=st.errors.get(k);
  box.classList.toggle('kg-bad',!!bad);box.classList.toggle('kg-dirty',st.dirty.has(k));box.classList.toggle('kg-req',must(k)&&empty&&!bad);
  const m=box.querySelector('.kg-msg');if(m)m.textContent=bad||'';
  const inp=box.querySelector('[data-kg]');if(inp){if(bad){inp.setAttribute('aria-invalid','true');inp.setAttribute('aria-describedby','kgm-'+k);}else{inp.removeAttribute('aria-invalid');inp.removeAttribute('aria-describedby');}}
 }
 function paintSummary(){
  const s=statusNow(),lc=liveCounts(),chip=doc().querySelector('#kgChip'),cnt=doc().querySelector('#kgCount'),nx=doc().querySelector('#kgNext'),dr=doc().querySelector('#kgDirty'),sv=doc().querySelector('[data-kg-act="save"]');
  if(chip){chip.className=`kg-chip kg-s-${s.code}`;chip.textContent='Status: '+s.label;}
  if(cnt)cnt.textContent=`${lc.filled} of ${lc.mandatory} mandatory cells filled · ${s.verified} verified`;
  if(nx)nx.textContent=s.next;
  if(dr)dr.textContent=st.dirty.size?`${st.dirty.size} unsaved cell${st.dirty.size===1?'':'s'}`:'No unsaved changes';
  if(sv)sv.disabled=!st.dirty.size;
  // The reason box appears the first time a saved value is changed. Redraw only the footer.
  const need=[...st.dirty.keys()].some(k=>rowOf(k)?.fact),has=!!doc().querySelector('#kgReason');
  if(need!==has){const f=doc().querySelector('.kg-foot');if(f){const t=doc().createElement('div');t.innerHTML=foot();f.replaceWith(t.firstElementChild);}}
 }
 function touch(k,typed){
  st.touched.add(k);
  const r=rowOf(k),saved=savedText(k),norm=v=>{const s=toStored(k,v);return s===null?String(v).trim():s;};
  if(norm(typed)===norm(saved))st.dirty.delete(k);else st.dirty.set(k,typed);
  const prob=cellProblem(k,typed,{mandatory:must(k),hadValue:!!r?.fact});
  if(prob&&(st.touched.has(k)))st.errors.set(k,prob);else st.errors.delete(k);
  paintCell(k);paintSummary();
 }
 const cells=()=>[...doc().querySelectorAll('[data-kg]')];
 function move(el,dr){
  const all=cells(),r=+el.dataset.r,c=+el.dataset.c;
  let t=all.find(x=>+x.dataset.c===c&&+x.dataset.r===r+dr);
  if(!t&&dr>0){const i=all.indexOf(el);t=all[i+1];}
  if(!t&&dr<0){const i=all.indexOf(el);t=all[i-1];}
  if(t){t.focus();if(t.select)t.select();}
 }

 // ---- saving and verifying ----
 const field=k=>doc().querySelector(`[data-kg="${k}"]`);
 function sourceNow(){return {kind:st.source.kind,ref:(st.source.ref||'').trim(),docId:st.source.docId||''};}
 async function save(){
  const cellsOut=[];let first=null;
  for(const [k,typed] of st.dirty){
   const r=rowOf(k),prob=cellProblem(k,typed,{mandatory:must(k),hadValue:!!r?.fact});
   if(prob){st.errors.set(k,prob);st.touched.add(k);first=first||k;continue;}
   const v=toStored(k,typed);if(!v)continue;cellsOut.push({field_key:k,value:v});
  }
  if(first){for(const k of st.errors.keys())paintCell(k);paintSummary();const f=field(first);if(f)f.focus();notice('Some cells need attention. They are red.');return;}
  const reasonEl=doc().querySelector('#kgReason');st.reason=reasonEl?reasonEl.value:st.reason;
  if(cellsOut.some(c=>rowOf(c.field_key)?.fact)&&String(st.reason||'').trim().length<5){if(reasonEl){reasonEl.focus();reasonEl.setAttribute('aria-invalid','true');}notice('Say why you are changing a saved value (at least 5 characters).');return;}
  const s=sourceNow(),body={action:'client_master_record_many',client_id:st.cid,cells:cellsOut,source_kind:s.kind,reason:st.reason||undefined};
  if(s.kind==='Document')body.document_id=s.docId||undefined;else if(s.ref)body.source_reference=s.ref;
  let res;try{res=await request(body);}catch(e){notice(e.message||'The cells could not be saved.');return;}
  if(!res.saved){
   for(const e of res.errors||[])st.errors.set(e.field_key,e.error);
   st.x=res;st.idx=indexRows(res.rows);render();notice(`${res.errors.length} cell${res.errors.length===1?'':'s'} could not be saved. Nothing was saved. They are marked red.`);
   const f=field((res.errors[0]||{}).field_key);if(f)f.focus();return;
  }
  st.x=res;st.idx=indexRows(res.rows);st.dirty.clear();st.errors.clear();st.reason='';render();
  notice(`Saved ${res.count} cell${res.count===1?'':'s'}${res.unchanged?` (${res.unchanged} already the same)`:''}. A different Supervisor, Manager or Partner verifies them.`);
 }
 async function verifyGo(){
  const note=(doc().querySelector('#kgNote')?.value||'').trim();
  if(note.length<3){notice('Say what you checked them against (at least 3 characters).');return;}
  const facts=st.x.rows.filter(r=>r.can_verify&&r.fact&&r.fact.status==='Recorded'&&!st.dirty.has(r.key)).map(r=>({fact_id:r.fact.fact_id,revision:r.fact.revision}));
  let res;try{res=await request({action:'client_master_verify_many',client_id:st.cid,facts,note});}catch(e){notice(e.message||'The cells could not be verified.');return;}
  st.x=res;st.idx=indexRows(res.rows);render();
  notice(`Verified ${res.verified_count} cell${res.verified_count===1?'':'s'}.${res.skipped.length?` ${res.skipped.length} skipped: ${res.skipped.slice(0,3).map(s=>s.reason).join(' ')}`:''}`);
 }

 async function open(cid){
  const x=await request({action:'client_master_read',client_id:cid});
  st={cid,x,idx:indexRows(x.rows),dirty:new Map(),touched:new Set(),errors:new Map(),source:{kind:'Online register',ref:'KRA iTax taxpayer profile',docId:''},reason:''};
  render();
 }

 // ---- events, registered once on the page ----
 const inGrid=e=>st&&e.target&&e.target.closest&&e.target.closest('[data-kg-root]');
 doc()?.addEventListener('input',e=>{if(!inGrid(e))return;const k=e.target.dataset?.kg;if(!k)return;
  const r=rowOf(k),saved=savedText(k);if(e.target.value===saved)st.dirty.delete(k);else st.dirty.set(k,e.target.value);
  if(st.errors.has(k)&&!cellProblem(k,e.target.value,{mandatory:must(k),hadValue:!!r?.fact}))st.errors.delete(k);
  paintCell(k);paintSummary();});
 doc()?.addEventListener('change',e=>{if(!inGrid(e))return;const s=e.target.dataset?.kgSource;if(s){st.source[s]=e.target.value;if(s==='kind'){const keep=st.source.kind;render();const sel=doc().querySelector('[data-kg-source="kind"]');if(sel)sel.value=keep;}return;}
  const k=e.target.dataset?.kg;if(k&&e.target.tagName==='SELECT')touch(k,e.target.value);});
 doc()?.addEventListener('focusout',e=>{if(!inGrid(e))return;const k=e.target.dataset?.kg;if(!k)return;
  let v=e.target.value;const kind=kindOf(k),stored=toStored(k,v);
  // A valid date or year end is shown in the one normal way as soon as the person leaves the cell.
  if(stored&&(kind==='date'||kind==='daymonth')){const norm=display(k,stored);if(norm!==v){e.target.value=norm;v=norm;}}
  touch(k,v);});
 doc()?.addEventListener('focusin',e=>{if(!inGrid(e))return;if(e.target.dataset?.kg&&e.target.select&&e.target.tagName==='INPUT')e.target.select();});
 doc()?.addEventListener('keydown',e=>{if(!inGrid(e))return;const el=e.target;if(!el.dataset||!el.dataset.kg||e.isComposing)return;
  if(e.key==='Enter'){e.preventDefault();move(el,e.shiftKey?-1:1);}
  else if((e.key==='ArrowDown'||e.key==='ArrowUp')&&el.tagName==='INPUT'){e.preventDefault();move(el,e.key==='ArrowDown'?1:-1);}});
 doc()?.addEventListener('click',async e=>{
  const b=e.target.closest&&e.target.closest('[data-kg-act],[data-kg-jump]');if(!b||!inGrid(e))return;
  if(b.dataset.kgJump){const f=field(b.dataset.kgJump);if(f){f.focus();f.scrollIntoView?.({block:'center'});}return;}
  const a=b.dataset.kgAct;
  if(a==='save')await save();
  else if(a==='verify-open'){const box=doc().querySelector('#kgVerifyBox');if(box){box.hidden=!box.hidden;if(!box.hidden)doc().querySelector('#kgNote')?.focus();}}
  else if(a==='verify-go')await verifyGo();
  else if(a==='kyc'){const id=st.cid;const t=doc().createElement('button');t.type='button';t.dataset.suite='compliance';t.dataset.id=id;t.hidden=true;doc().body.appendChild(t);t.click();t.remove();}
  else if(a==='list'&&openList)await openList(st.cid);
 });

 return {open,isAction:a=>a==='kyc-grid',_state:()=>st};
}
