// Build 2855: the POCAMLA screens. Staff fill the client's AML profile and refer it; the MLRO decides and keeps the lists; a Partner approves the lists
// and switches the engagement gate on. The page decides nothing: every action is checked again on the server and in the database.
const CHIP={INFO_NEEDED:'am-s-info',STAFF_REVIEW:'am-s-staff',MLRO_REVIEW:'am-s-mlro',EDD_REQUIRED:'am-s-edd',APPROVED:'am-s-ok',APPROVED_COND:'am-s-ok',REVIEW_DUE:'am-s-due',RESTRICTED:'am-s-edd',DECLINED:'am-s-edd'};
const TEXT_FIELDS=['purpose_of_relationship','expected_activity','expected_size_frequency','pep_type','pep_role','pep_jurisdiction','pep_from','pep_relationship','pep_doc_ref','screening_status','screening_list_source','screening_list_date','screening_note','screening_doc_ref'];

export function createAmlUI(ctx,{show}){
 const {esc,request,notice,shortDate}=ctx,doc=()=>globalThis.document;
 let st=null; // profile screen: {cid,view,fields,sel,errors:Map,dirty}
 let ov=null; // MLRO overview
 let rules=null; // MLRO service rules (build 2856)

 // ---------- the client's profile ----------
 const lk=(cat)=>st.view.lookups.filter(l=>l.category===cat);
 const attentionOf=(cat,v)=>!!lk(cat).find(l=>l.value===v)?.attention;
 const fieldVal=k=>st.fields[k]??'';
 function fromView(v){
  const p=v.profile||{},f={};for(const k of TEXT_FIELDS)f[k]=p[k]??'';
  f.screening_status=p.screening_status||'Not screened';f.pep_doc_ref=p.pep_doc_ref||'';f.screening_doc_ref=p.screening_doc_ref||'';
  for(const k of ['pep_from','screening_list_date'])f[k]=p[k]?String(p[k]).slice(0,10):'';
  return f;
 }
 const selFromView=v=>v.selections.map(s=>({category:s.category,context:s.context||'',value:s.lookup_value,note:s.note||'',doc_ref:s.doc_ref||''}));
 const err=k=>st.errors.get(k);
 const docOpts=cur=>`<option value="">${st.view.documents.length?'Evidence (DOC-…), optional':'No document on file yet'}</option>${st.view.documents.map(d=>`<option value="${esc(d.doc_ref)}"${d.doc_ref===cur?' selected':''}>${esc(d.doc_ref)} · ${esc(d.file_name)}${d.category?' · '+esc(d.category):''}</option>`).join('')}`;
 const miss=k=>st.view.missing.some(m=>m.key===k)&&!fieldVal(k);
 function cell(label,key,input,{must=false}={}){
  const bad=err(key),req=must&&miss(key);
  return `<div class="am-row${bad?' am-bad':''}${req?' am-req':''}"><label class="am-l" for="am-${esc(key)}">${esc(label)}${must?'<span class="kg-star" aria-hidden="true">*</span>':''}</label><div class="am-v">${input}${bad?`<small class="am-msg" role="alert">${esc(bad)}</small>`:''}</div></div>`;
 }
 const txt=(k,{area=false,type='text',ph=''}={})=>area?`<textarea id="am-${k}" data-am="${k}" rows="2" maxlength="1000">${esc(fieldVal(k))}</textarea>`:`<input id="am-${k}" data-am="${k}" type="${type}" value="${esc(fieldVal(k))}" maxlength="300" placeholder="${esc(ph)}">`;
 const sel=(k,opts,{blank=true}={})=>`<select id="am-${k}" data-am="${k}">${blank?'<option value=""></option>':''}${opts.map(o=>`<option${o===fieldVal(k)?' selected':''}>${esc(o)}</option>`).join('')}</select>`;
 const docSel=k=>`<select id="am-${k}" data-am="${k}">${docOpts(fieldVal(k))}</select>`;
 // A picker: choose a value from the MLRO's list; each chosen value gets a note and an optional evidence reference.
 function picker(cat,context,label,key){
  const items=st.sel.map((s,i)=>({...s,i})).filter(s=>s.category===cat&&(s.context||'')===context);
  const have=new Set(items.map(s=>s.value.toLowerCase()));
  const opts=lk(cat).filter(l=>!have.has(l.value.toLowerCase()));
  const rows=items.map(s=>{const flag=attentionOf(cat,s.value);return `<li class="am-chip${flag?' am-flag':''}"><span>${flag?'<span title="The MLRO looks at this first" aria-hidden="true">⚑ </span>':''}${esc(s.value)}</span><input data-am-note="${s.i}" value="${esc(s.note)}" placeholder="Note (optional)" maxlength="500" aria-label="Note for ${esc(s.value)}"><select data-am-doc="${s.i}" aria-label="Evidence for ${esc(s.value)}">${docOpts(s.doc_ref)}</select><button type="button" data-am-remove="${s.i}" aria-label="Remove ${esc(s.value)}">✕</button></li>`;}).join('');
  const bad=err(key)||'',req=st.view.missing.some(m=>m.key===key)&&!items.length;
  return `<div class="am-row${req?' am-req':''}"><span class="am-l">${esc(label)}${st.view.missing.some(m=>m.key===key)?'<span class="kg-star" aria-hidden="true">*</span>':''}</span><div class="am-v"><ul class="am-chips">${rows||'<li class="muted">Nothing chosen</li>'}</ul><div class="am-add"><select data-am-pick="${cat}|${esc(context)}" aria-label="Add to ${esc(label)}"><option value="">Add…</option>${opts.map(l=>`<option>${esc(l.value)}</option>`).join('')}</select></div>${bad?`<small class="am-msg">${esc(bad)}</small>`:''}</div></div>`;
 }
 // Build 2866: suggestions from facts already held. Nothing is saved until the person accepts it and saves the draft.
 function pendingSuggestions(){
  const sg=st.view.suggestions||{text:[],picks:[]};
  const text=sg.text.filter(t=>!String(fieldVal(t.key)||'').trim());
  const picks=sg.picks.filter(p=>!st.sel.some(x=>x.category===p.category&&(x.context||'')===(p.context||'')&&String(x.value).toLowerCase()===String(p.value).toLowerCase()));
  return {text,picks};
 }
 function suggestPanel(){
  if(!st.view.can.edit||(st.view.profile&&st.view.profile.stage!=='Staff review'))return '';
  const {text,picks}=pendingSuggestions();if(!text.length&&!picks.length)return '';
  const label=p=>p.category==='SERVICE_ACTIVITY'?'Services and AML-relevant activity':'Country · '+p.context;
  return `<section class="am-suggest" data-am-suggest><h3 class="kg-bar">Suggested from what we already hold (${text.length+picks.length})</h3><p class="info">Nothing here is saved until you accept it and press Save draft. Check each one against the evidence. The basis says where it came from.</p><ul class="am-sug">${text.map(t=>`<li><b>Purpose of the relationship</b>: ${esc(t.value)}<small>${esc(t.basis)}</small><button type="button" data-am-use="text:${esc(t.key)}">Use this</button></li>`).join('')}${picks.map((p,i)=>`<li><b>${esc(label(p))}</b>: ${esc(p.value)}${p.doc_ref?' · evidence '+esc(p.doc_ref):''}<small>${esc(p.basis)}</small><button type="button" data-am-use="pick:${i}">Use this</button></li>`).join('')}</ul><button type="button" data-am-use="all">Use all suggestions</button></section>`;
 }
 function useSuggestion(which){
  sync();const {text,picks}=pendingSuggestions();
  const addText=t=>{if(!String(st.fields[t.key]||'').trim())st.fields[t.key]=t.value;};
  const addPick=p=>{if(!st.sel.some(x=>x.category===p.category&&(x.context||'')===(p.context||'')&&String(x.value).toLowerCase()===String(p.value).toLowerCase()))st.sel.push({category:p.category,context:p.context||'',value:p.value,note:('Suggested: '+p.basis).slice(0,500),doc_ref:p.doc_ref||''});};
  if(which==='all'){text.forEach(addText);picks.forEach(addPick);}
  else if(which.startsWith('text:')){const t=text.find(x=>x.key===which.slice(5));if(t)addText(t);}
  else if(which.startsWith('pick:')){const p=picks[+which.slice(5)];if(p)addPick(p);}
  st.dirty=true;render();
 }
 function profileBody(){
  const v=st.view,pepFlag=fieldVal('pep_type')&&fieldVal('pep_type')!==v.options.pep_none&&attentionOf('PEP_TYPE',fieldVal('pep_type'));
  const ctxs=v.options.countries_contexts;
  return `<section class="am-sec"><h3 class="kg-bar">Purpose and expected activity</h3><div class="am-box">${cell('Purpose of the relationship','purpose_of_relationship',txt('purpose_of_relationship',{area:true}),{must:true})}${cell('Expected activity','expected_activity',txt('expected_activity',{area:true}),{must:true})}${cell('Size and frequency of transactions','expected_size_frequency',txt('expected_size_frequency'))}</div></section>
  <section class="am-sec"><h3 class="kg-bar">PEP status</h3><div class="am-box">${cell('PEP status','pep_type',sel('pep_type',lk('PEP_TYPE').map(l=>l.value)),{must:true})}${pepFlag?`${cell('Public role','pep_role',txt('pep_role'),{must:true})}${cell('Jurisdiction','pep_jurisdiction',txt('pep_jurisdiction'),{must:true})}${cell('Role start date','pep_from',txt('pep_from',{type:'date'}))}${cell('Relationship to the PEP','pep_relationship',txt('pep_relationship'))}${cell('Evidence (document reference)','pep_doc_ref',docSel('pep_doc_ref'))}`:''}<p class="muted am-hint">A PEP is not refused automatically. The MLRO decides what review applies.</p></div></section>
  <section class="am-sec"><h3 class="kg-bar">Screening</h3><div class="am-box">${cell('Screening result','screening_status',sel('screening_status',v.options.screening,{blank:false}),{must:true})}${fieldVal('screening_status')!=='Not screened'?`${cell('Screening list used','screening_list_source',txt('screening_list_source',{ph:'List name and where it came from'}),{must:true})}${cell('List effective date','screening_list_date',txt('screening_list_date',{type:'date'}),{must:true})}${cell('Result note','screening_note',txt('screening_note',{area:true}),{must:/match/i.test(fieldVal('screening_status'))})}${cell('Evidence (document reference)','screening_doc_ref',docSel('screening_doc_ref'))}`:''}</div></section>
  <section class="am-sec"><h3 class="kg-bar">Geography</h3><div class="am-box">${ctxs.map(c=>picker('COUNTRY',c,c,c==='Incorporation or residence'?'COUNTRY:Incorporation or residence':'COUNTRY:'+c)).join('')}</div></section>
  <section class="am-sec"><h3 class="kg-bar">Business, services and funds</h3><div class="am-box">${picker('SERVICE_ACTIVITY','','Services and AML-relevant activity','SERVICE_ACTIVITY')}${picker('SOURCE_OF_FUNDS','','Source of funds','SOURCE_OF_FUNDS')}${picker('SOURCE_OF_WEALTH','','Source of wealth (where relevant)','SOURCE_OF_WEALTH')}${picker('RISK_INDICATOR','','Risk indicators seen','RISK_INDICATOR')}</div></section>`;
 }
 function trail(){
  const p=st.view.profile,d=st.view.decisions;
  const log=d.length?`<ul>${d.slice(0,6).map(x=>`<li><b>${esc(x.kind==='Decision'?x.decision:x.kind)}</b>${x.risk_rating?' · '+esc(x.risk_rating)+' risk':''}<small>${esc(x.decided_by_name)} · ${esc(shortDate(x.decided_at))}${x.note?' · '+esc(x.note):''}</small></li>`).join('')}</ul>`:'<p class="muted">No decision yet.</p>';
  return `<h4>Approval trail</h4><p class="kg-k">Prepared by</p><p>${p&&p.last_edited_by_name?esc(p.last_edited_by_name):'<span class="muted">Not started</span>'}</p><p class="kg-k">Referred to the MLRO</p><p>${p&&p.submitted_by_name?esc(p.submitted_by_name)+' · '+esc(shortDate(p.submitted_at)):'<span class="muted">Not yet</span>'}</p><p class="kg-k">MLRO decisions</p>${log}`;
 }
 function decisionPanel(){
  const v=st.view,p=v.profile;if(!v.can.decide||!p)return '';
  const f=st.decide||{},r=k=>f[k]??'';
  const e=k=>st.errors.get('d:'+k)?`<small class="am-msg">${esc(st.errors.get('d:'+k))}</small>`:'';
  return `<section class="am-sec am-decide"><h3 class="kg-bar">MLRO decision</h3><div class="am-box">
   <div class="am-row"><label class="am-l" for="amd-risk_rating">Risk rating<span class="kg-star">*</span></label><div class="am-v"><select id="amd-risk_rating" data-amd="risk_rating"><option value=""></option>${v.options.ratings.map(x=>`<option${x===r('risk_rating')?' selected':''}>${x}</option>`).join('')}</select>${e('risk_rating')}</div></div>
   <div class="am-row"><label class="am-l" for="amd-risk_reasons">Reasons for the rating<span class="kg-star">*</span></label><div class="am-v"><textarea id="amd-risk_reasons" data-amd="risk_reasons" rows="2">${esc(r('risk_reasons'))}</textarea>${e('risk_reasons')}</div></div>
   <div class="am-row"><label class="am-l" for="amd-mitigating_controls">Mitigating controls</label><div class="am-v"><textarea id="amd-mitigating_controls" data-amd="mitigating_controls" rows="2">${esc(r('mitigating_controls'))}</textarea></div></div>
   <div class="am-row"><label class="am-l" for="amd-decision">Decision<span class="kg-star">*</span></label><div class="am-v"><select id="amd-decision" data-amd="decision"><option value=""></option>${v.options.decisions.map(x=>`<option${x===r('decision')?' selected':''}>${x}</option>`).join('')}</select>${e('decision')}<small class="muted">The rating and the decision are separate: a High-risk client can still be accepted with conditions.</small></div></div>
   <div class="am-row"><label class="am-l" for="amd-decision_conditions">Conditions or restrictions</label><div class="am-v"><textarea id="amd-decision_conditions" data-amd="decision_conditions" rows="2">${esc(r('decision_conditions'))}</textarea>${e('decision_conditions')}</div></div>
   <div class="am-row"><label class="am-l" for="amd-decision_reason">Reason (restrict or decline)</label><div class="am-v"><input id="amd-decision_reason" data-amd="decision_reason" value="${esc(r('decision_reason'))}">${e('decision_reason')}</div></div>
   <div class="am-row"><label class="am-l" for="amd-edd_note">Enhanced due diligence carried out</label><div class="am-v"><textarea id="amd-edd_note" data-amd="edd_note" rows="2">${esc(r('edd_note'))}</textarea>${e('edd_note')}<small class="muted">Required to accept a PEP or High-risk client. The KYC file must be verified first.</small></div></div>
   <div class="am-row"><label class="am-l" for="amd-next_review">Next review date</label><div class="am-v"><input id="amd-next_review" data-amd="next_review" type="date" value="${esc(r('next_review'))}">${e('next_review')}</div></div>
   <div class="am-row"><label class="am-l" for="amd-review_reason">Review reason</label><div class="am-v"><input id="amd-review_reason" data-amd="review_reason" value="${esc(r('review_reason'))}"></div></div>
   <div class="am-actions"><button type="button" class="primary" data-am-act="decide">Record decision</button><button type="button" data-am-act="edd">Ask for enhanced due diligence</button><button type="button" data-am-act="return">Return for information</button></div>
   <label class="am-l am-askl" for="amd-ask">Note for “ask” or “return”</label><textarea id="amd-ask" data-amd="ask" rows="2" placeholder="What staff must add or explain">${esc(r('ask'))}</textarea>${e('ask')}</div></section>`;
 }
 function flagsBlock(){
  const f=(st.view.service_flags||[]);if(!f.length)return '';
  return `<div class="am-flags"><b>Services set up for this client that the MLRO flagged</b><ul>${f.map(x=>`<li>${esc(x.service_name)} · ${esc(x.applicability)} · ${esc(shortDate(x.raised_at))} ${x.answered?'<span class="badge good">Answered by an MLRO decision</span>':'<span class="badge warn">Waiting for the MLRO\'s decision</span>'}</li>`).join('')}</ul></div>`;
 }
 function profileHtml(){
  const v=st.view,s=v.status,p=v.profile;
  const kycWarn=v.kyc&&p&&v.kyc.is_pep!==!!(p.pep_type&&attentionOf('PEP_TYPE',p.pep_type))?'<p class="info">The KYC file’s PEP flag differs from this profile. The Manager or Partner reconciles it when verifying the KYC file.</p>':'';
  const missLis=v.missing.map(m=>`<li><button type="button" class="link" data-am-jump="${esc(m.key)}">${esc(m.label)}</button></li>`).join('');
  return `<div class="am" data-am-root><p class="kg-title"><b>POCAMLA client profile</b> · ${esc(v.client.company_name)}${v.client.kra_pin?' · '+esc(v.client.kra_pin):''}</p>
   <div class="kg-statusbar"><span class="kg-chip ${CHIP[s.code]||''}" id="amChip">Status: ${esc(s.label)}</span>${v.gate_enforced?'<span class="kg-count">The firm requires an MLRO decision before an engagement starts.</span>':'<span class="kg-count">The engagement gate is not switched on yet.</span>'}</div>
   <p class="muted">${esc(s.next)}</p>${[...st.errors].filter(([k])=>k.startsWith('selection:')).map(([,m])=>`<p class="am-msg" role="alert">${esc(m)}</p>`).join('')}${p&&p.return_note&&p.stage==='Staff review'?`<p class="info"><b>From the MLRO:</b> ${esc(p.return_note)}</p>`:''}${v.attention.length?`<p class="am-attn"><b>For the MLRO’s attention:</b> ${v.attention.map(x=>`<span class="am-tag">${esc(x)}</span>`).join(' ')}</p>`:''}${kycWarn}
   ${flagsBlock()}<div class="kg-layout"><div class="kg-main">${suggestPanel()}${profileBody()}${decisionPanel()}</div><aside class="kg-side">${trail()}${missLis?`<h4>Still needed (${v.missing.length})</h4><ul class="kg-miss">${missLis}</ul>`:''}${p&&p.decision?`<h4>Current decision</h4><p><b>${esc(p.decision)}</b> · ${esc(p.risk_rating||'')} risk${p.next_review?'<br>Review by '+esc(shortDate(p.next_review)):''}${p.decision_conditions?'<br>'+esc(p.decision_conditions):''}</p>`:''}<div class="kg-links"><button type="button" data-am-act="kyc">Open KYC file and evidence</button><button type="button" data-am-act="facts">Client details grid</button></div></aside></div>
   <div class="kg-foot"><span class="muted" id="amDirty">${st.dirty?'Unsaved changes':'No unsaved changes'}</span><button type="button" data-am-act="save"${st.view.can.edit?'':' disabled'}>Save draft</button><button type="button" class="primary" data-am-act="submit"${v.can.edit&&p&&p.stage==='Staff review'?'':' disabled'} title="${p&&p.stage==='Staff review'?'Refer the profile to the MLRO':'Save the profile first, then refer it'}">Refer to the MLRO</button></div><p class="muted kg-note">${esc(v.note)} Staff cannot rate risk or decide; the person who prepared a profile cannot decide it.</p></div>`;
 }
 function render(){show('POCAMLA profile · '+st.view.client.company_name,profileHtml());const e=doc().querySelector('#editor');if(e)e.classList.add('ledger-dialog');}
 function sync(){
  const root=doc().querySelector('[data-am-root]');if(!root)return;
  for(const el of root.querySelectorAll('[data-am]'))st.fields[el.dataset.am]=el.value;
  for(const el of root.querySelectorAll('[data-am-note]'))if(st.sel[+el.dataset.amNote])st.sel[+el.dataset.amNote].note=el.value;
  for(const el of root.querySelectorAll('[data-am-doc]'))if(st.sel[+el.dataset.amDoc])st.sel[+el.dataset.amDoc].doc_ref=el.value;
  st.decide=st.decide||{};for(const el of root.querySelectorAll('[data-amd]'))st.decide[el.dataset.amd]=el.value;
 }
 async function open(cid){
  const v=await request({action:'aml_profile_read',client_id:cid});
  st={cid,view:v,fields:fromView(v),sel:selFromView(v),errors:new Map(),dirty:false,decide:{}};render();
 }
 function applyErrors(res,prefix=''){
  st.errors=new Map();for(const e of res.errors||[])st.errors.set(prefix+e.key,e.error);
 }
 async function save(quiet=false){
  sync();
  const body={action:'aml_profile_save',client_id:st.cid,fields:{...st.fields},selections:st.sel.map(s=>({category:s.category,context:s.context,value:s.value,note:s.note||undefined,doc_ref:s.doc_ref||undefined}))};
  if(st.view.profile)body.revision=st.view.profile.revision;
  const res=await request(body);
  if(res.saved===false){st.view=res;st.errors=new Map();for(const e of res.errors||[])st.errors.set(e.key,e.error);render();notice(`${res.errors.length} item${res.errors.length===1?'':'s'} need attention.`);return false;}
  st.view=res;st.fields=fromView(res);st.sel=selFromView(res);st.errors=new Map();st.dirty=false;render();if(!quiet)notice(res.changed===false?'Nothing had changed.':'Saved. Staff can keep editing until the profile is referred to the MLRO.');return true;
 }
 async function decideCall(kind){
  sync();const d=st.decide||{},base={client_id:st.cid,revision:st.view.profile.revision};
  let res;
  if(kind==='decide')res=await request({action:'aml_decide',...base,...d});
  else{const note=(d.ask||'').trim();if(note.length<5){st.errors=new Map([['d:ask','Say what staff must add or explain (at least 5 characters).']]);render();return;}res=await request({action:kind==='edd'?'aml_edd_request':'aml_return',...base,note});}
  if(res.decided===false){st.view=res;st.errors=new Map();for(const e of res.errors||[])st.errors.set('d:'+e.key,e.error);render();notice('The decision needs attention. See the red items.');return;}
  st.view=res;st.fields=fromView(res);st.sel=selFromView(res);st.errors=new Map();st.decide={};render();
  notice(kind==='decide'?'Decision recorded.':kind==='edd'?'Enhanced due diligence requested. The profile is back with staff.':'Returned to staff.');
 }

 // ---------- the MLRO's queue, lists and policy ----------
 const tbl=(heads,rows)=>`<div class="scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')||`<tr><td colspan="${heads.length}" class="muted">Nothing here.</td></tr>`}</tbody></table></div>`;
 const qrow=i=>`<tr><td><b>${esc(i.company_name)}</b>${i.attention.length?`<small>${i.attention.slice(0,3).map(esc).join(' · ')}</small>`:''}</td><td>${esc(i.status)}</td><td>${esc(i.risk_rating||'Not rated')}</td><td>${i.next_review?esc(shortDate(i.next_review)):''}</td><td><button type="button" data-am-open="${esc(i.client_id)}">Open</button></td></tr>`;
 const frow=f=>`<tr><td><b>${esc(f.company_name)}</b></td><td>${esc(f.service_name)}</td><td>${esc(f.applicability)}</td><td>${esc(shortDate(f.raised_at))} · ${esc(f.raised_by_name)}</td><td><button type="button" data-am-open="${esc(f.client_id)}">Open profile</button></td></tr>`;
 function rulesHtml(){
  if(!rules)return '';
  const rows=rules.services.map(r=>`<tr><td>${esc(r.service_name)}<small>${esc(r.service_group)}</small></td><td>${r.rule_id?`<span class="badge ${r.applicability==='Not relevant'?'':'warn'}">${esc(r.applicability)}</span>`:'<span class="badge">MLRO has not decided</span>'}</td><td>${r.activities&&r.activities.length?esc(r.activities.join(', ')):'<span class="muted">none listed</span>'}${r.reason?`<small>${esc(r.reason)}</small>`:''}</td><td>${r.rule_id&&rules.can_set?`<button type="button" data-am-rule-end="${esc(r.service_code)}">End rule</button>`:''}</td></tr>`);
  const opts=rules.services.map(r=>`<option value="${esc(r.service_code)}">${esc(r.service_name)}</option>`).join('');
  const acts=rules.activity_values.map(v=>`<label class="am-chk"><input type="checkbox" name="act" value="${esc(v)}"> ${esc(v)}</label>`).join('');
  return `<section class="am-sec"><h3 class="kg-bar">Services and AML scope (${ov.counts.services_undecided||0} not decided)</h3><div class="am-box am-pad"><p class="muted">Say, for each service, whether POCAMLA questions or a referral to you apply. A service you have not decided is not treated as exempt. A rule is never edited: setting a new one ends the old one.</p>
   ${tbl(['Service','Rule','Activities and reason',''],rows)}
   ${rules.can_set?`<form data-am-rule class="am-addform"><select name="service_code" required aria-label="Service">${opts}</select><select name="applicability" required aria-label="Applicability">${rules.applicability.map(a=>`<option>${esc(a)}</option>`).join('')}</select><input name="reason" placeholder="Reason" required maxlength="500" aria-label="Reason"><input name="source" placeholder="Source or reference" required maxlength="300" aria-label="Source"><details class="am-acts"><summary>AML-relevant activities this service usually involves</summary>${acts||'<span class="muted">No activities on your list yet.</span>'}</details><button type="submit">Set rule</button></form>`:'<p class="muted">Only the MLRO sets these rules.</p>'}</div></section>`;
 }
 function overviewHtml(){
  const q=ov.queue,c=ov.counts;
  const lists=Object.keys(ov.categories).map(cat=>{
   const rows=ov.lookups.filter(l=>l.category===cat),starters=rows.filter(l=>l.status==='Starter');
   return `<details class="am-list"><summary><b>${esc(ov.categories[cat])}</b> · ${rows.length} value${rows.length===1?'':'s'}${starters.length?` · <span class="badge warn">${starters.length} starter to confirm</span>`:''}</summary>
    ${starters.length?`<p><button type="button" data-am-confirm="${esc(cat)}">Confirm all ${starters.length} starter values</button> <small class="muted">Starter values come from the firm’s specification and are not yet checked by the MLRO.</small></p>`:''}
    <div class="scroll am-listbox"><table><thead><tr><th>Value</th><th>Looked at first</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(l=>`<tr><td>${esc(l.value)}</td><td>${l.attention?'⚑ Yes':''}</td><td>${esc(l.source)}</td><td>${esc(l.status)}</td><td><button type="button" data-am-end="${esc(l.lookup_id)}">End</button></td></tr>`).join('')}</tbody></table></div>
    <form data-am-add="${esc(cat)}" class="am-addform"><input name="value" placeholder="New value" required maxlength="120" aria-label="New value"><input name="source" placeholder="Source or reference" required maxlength="300" aria-label="Source"><label><input type="checkbox" name="attention"> Looked at first</label><button type="submit">Add</button></form></details>`;}).join('');
  const pol=ov.policy;
  return `<div class="am" data-am-ov><p class="kg-title"><b>POCAMLA · MLRO workspace</b></p><p class="muted">${esc(ov.note)}</p>
   <p><b>MLRO:</b> ${ov.mlro_holders.length?ov.mlro_holders.map(h=>esc(h.full_name)+(h.expires_on?' (until '+esc(shortDate(h.expires_on))+')':'')).join(', '):'<span class="muted">No Manager appointed. Engagement Partners hold the right by rank.</span>'} · ${c.profiles} profile${c.profiles===1?'':'s'} · ${c.without_profile} client${c.without_profile===1?'':'s'} without a profile</p>
   <section class="am-sec"><h3 class="kg-bar">Waiting for you (${q.waiting.length})</h3>${tbl(['Client','Status','Risk','Review by',''],q.waiting.map(qrow))}</section>
   <section class="am-sec"><h3 class="kg-bar">Enhanced due diligence (${q.edd.length})</h3>${tbl(['Client','Status','Risk','Review by',''],q.edd.map(qrow))}</section>
   <section class="am-sec"><h3 class="kg-bar">Screening matches (${q.matches.length})</h3>${tbl(['Client','Status','Risk','Review by',''],q.matches.map(qrow))}</section>
   <section class="am-sec"><h3 class="kg-bar">Reviews due within 30 days (${q.review_due.length})</h3>${tbl(['Client','Status','Risk','Review by',''],q.review_due.map(qrow))}</section>
   <section class="am-sec"><h3 class="kg-bar">High-risk clients accepted (${q.high_risk.length})</h3>${tbl(['Client','Status','Risk','Review by',''],q.high_risk.map(qrow))}</section>
   <section class="am-sec"><h3 class="kg-bar">Services set up that need AML scope (${(q.services||[]).length})</h3>${tbl(['Client','Service','Rule','Raised',''],(q.services||[]).map(frow))}</section>
   ${rulesHtml()}
   <section class="am-sec"><h3 class="kg-bar">Lists you maintain</h3><div class="am-box am-pad">${lists}</div></section>
   <section class="am-sec"><h3 class="kg-bar">Policy approval and the engagement gate</h3><div class="am-box am-pad">
    <p>${pol.gate_enforced?'<span class="badge good">Gate on</span> An engagement cannot start until the MLRO has decided.':'<span class="badge warn">Gate off</span> Engagements are not yet blocked by the MLRO decision.'}</p>
    ${ov.approvals.length?`<ul>${ov.approvals.map(a=>`<li>Approved ${esc(shortDate(a.approved_at))} by ${esc(a.approved_by_name)} · ${esc(a.reference)}</li>`).join('')}</ul>`:'<p class="muted">No Partner or Board approval of the lists recorded yet.</p>'}
    ${ov.can_approve_policy?`<form data-am-policy class="am-addform"><input name="reference" placeholder="Approval reference (minute or resolution)" required maxlength="300" aria-label="Approval reference"><input name="note" placeholder="Note (optional)" maxlength="1000" aria-label="Note"><button type="submit">Record Partner / Board approval</button></form>
    <form data-am-gate class="am-addform"><input name="reason" placeholder="Reason" required maxlength="500" aria-label="Reason"><button type="submit" data-enforce="${pol.gate_enforced?'0':'1'}">${pol.gate_enforced?'Switch the gate off':'Switch the gate on'}</button></form><p class="muted">The gate can be switched on only after the lists are approved and every starter value is confirmed.</p>`:'<p class="muted">An Engagement Partner records the approval of the lists and switches the gate.</p>'}</div></section></div>`;
 }
 async function openOverview(){ov=await request({action:'aml_overview'});rules=await request({action:'aml_service_rules_read'});show('POCAMLA · MLRO workspace',overviewHtml());const e=doc().querySelector('#editor');if(e)e.classList.add('ledger-dialog');}
 async function overviewDo(body,msg){try{await request(body);notice(msg);}catch(e){notice(e.message||'That could not be done.');}await openOverview();}

 // ---------- events, registered once ----------
 const root=e=>e.target&&e.target.closest&&e.target.closest('[data-am-root]');
 doc()?.addEventListener('input',e=>{if(!root(e)||!st)return;if(e.target.dataset.am||e.target.dataset.amNote||e.target.dataset.amd!==undefined){st.dirty=true;const d=doc().querySelector('#amDirty');if(d)d.textContent='Unsaved changes';}});
 doc()?.addEventListener('change',e=>{
  if(!root(e)||!st)return;const t=e.target;
  if(t.dataset.amPick!==undefined&&t.value){sync();const [cat,context]=t.dataset.amPick.split('|');st.sel.push({category:cat,context,value:t.value,note:'',doc_ref:''});st.dirty=true;render();return;}
  if(t.dataset.am==='pep_type'||t.dataset.am==='screening_status'){sync();st.dirty=true;render();const f=doc().querySelector('#am-'+t.dataset.am);if(f)f.focus();return;}
  if(t.dataset.amDoc!==undefined||t.dataset.am){sync();st.dirty=true;}
 });
 doc()?.addEventListener('click',async e=>{
  const b=e.target.closest&&e.target.closest('[data-am-act],[data-am-use],[data-am-remove],[data-am-jump],[data-am-open],[data-am-confirm],[data-am-end],[data-am-rule-end]');if(!b)return;
  try{
   if(b.dataset.amOpen){await open(b.dataset.amOpen);return;}
   if(b.dataset.amRuleEnd){const why=globalThis.prompt?globalThis.prompt('Why does this rule end? (at least 5 characters)'):'';if(!why)return;await overviewDo({action:'aml_service_rule_end',service_code:b.dataset.amRuleEnd,reason:why},'Rule ended. It stays in the history.');return;}
   if(b.dataset.amConfirm){const ids=ov.lookups.filter(l=>l.category===b.dataset.amConfirm&&l.status==='Starter').map(l=>l.lookup_id);await overviewDo({action:'aml_lookup_confirm',lookup_ids:ids},`Confirmed ${ids.length} value${ids.length===1?'':'s'}.`);return;}
   if(b.dataset.amEnd){const why=globalThis.prompt?globalThis.prompt('Why does this value end? (at least 5 characters)'):'';if(!why)return;await overviewDo({action:'aml_lookup_end',lookup_id:b.dataset.amEnd,reason:why},'Value ended. It stays in the history.');return;}
   if(!st||!root(e))return;
   if(b.dataset.amUse!==undefined){useSuggestion(b.dataset.amUse);return;}
   if(b.dataset.amRemove!==undefined){sync();st.sel.splice(+b.dataset.amRemove,1);st.dirty=true;render();return;}
   if(b.dataset.amJump){const k=b.dataset.amJump,el=doc().querySelector('#am-'+k)||doc().querySelector(`[data-am-pick^="${k.split(':')[0]}|${(k.split(':')[1]||'')}"]`);if(el){el.focus();el.scrollIntoView?.({block:'center'});}return;}
   const a=b.dataset.amAct;
   if(a==='save')await save();
   else if(a==='submit'){if(st.dirty&&!(await save(true)))return;const res=await request({action:'aml_profile_submit',client_id:st.cid,revision:st.view.profile.revision});st.view=res;render();notice('Referred to the MLRO.');}
   else if(a==='decide'||a==='edd'||a==='return')await decideCall(a);
   else if(a==='kyc'){const t=doc().createElement('button');t.type='button';t.dataset.suite='compliance';t.dataset.id=st.cid;t.hidden=true;doc().body.appendChild(t);t.click();t.remove();}
   else if(a==='facts'){const t=doc().createElement('button');t.type='button';t.dataset.v3='master';t.dataset.id=st.cid;t.hidden=true;doc().body.appendChild(t);t.click();t.remove();}
  }catch(x){notice(x.message||'That could not be done.');}
 });
 doc()?.addEventListener('submit',async e=>{
  const f=e.target;if(!f.closest||!f.closest('[data-am-ov]'))return;e.preventDefault();const d=Object.fromEntries(new FormData(f));
  if('amRule' in f.dataset){const acts=[...f.querySelectorAll('input[name=act]:checked')].map(x=>x.value);await overviewDo({action:'aml_service_rule_set',service_code:d.service_code,applicability:d.applicability,reason:d.reason,source:d.source,activities:acts},'Rule recorded.');}
  else if(f.dataset.amAdd)await overviewDo({action:'aml_lookup_add',category:f.dataset.amAdd,value:d.value,source:d.source,attention:!!d.attention},'Value added.');
  else if('amPolicy' in f.dataset)await overviewDo({action:'aml_policy_approve',reference:d.reference,note:d.note||undefined},'Approval recorded.');
  else if('amGate' in f.dataset)await overviewDo({action:'aml_gate_set',enforced:f.querySelector('button').dataset.enforce==='1',reason:d.reason},'The gate was updated.');
 });
 return {open,openOverview,_state:()=>st,_ov:()=>ov};
}
