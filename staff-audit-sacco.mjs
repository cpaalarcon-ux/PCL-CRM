// Audit build S4: SACCO statements.
// A SACCO audit file builds its financial statements from a SACCO statement layout that a Partner approves, from the firm's account-to-line map,
// from equity movements (one column per reserve), from statistics and from the section-10 list. The server does the arithmetic and enforces every gate;
// this module shows the result and collects input. No SASRA figure or regulatory caption is fixed here.
export const MOVE_KINDS=['Transfer to or from reserve','Dividend on shares','Shares issued or redeemed','Revaluation','Other'];
export const ROLE_LABELS={TOTAL_ASSETS:'Total assets (balance check)',TOTAL_LIABILITIES_EQUITY:'Total liabilities and equity (balance check)',SURPLUS:'Surplus for the year',EQUITY_COLUMN:'Equity column in the statement of changes in equity',SURPLUS_COLUMN:'Column that receives the surplus',ECL_ALLOWANCE:'Expected credit loss allowance',PRUDENTIAL_PROVISION:'Prudential provision (statistic)'};
export const STATEMENTS=['Financial position','Income statement','Statistical','Disclosure'];
export const KINDS=['Line','Total','Statistic','Check'];
export const AUTO_KEYS=['EQUITY_RECONCILES','ECL_PRUDENTIAL','CAPITAL_FIGURES'];
const MAKERS=['ASSISTANT','SUPERVISOR','MANAGER','PARTNER'];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money=v=>{if(v==null||v==='')return '—';const n=Number(v);if(!Number.isFinite(n))return esc(v);const t=Math.abs(n).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`(${t})`:t;};
const count=v=>v==null?'—':Number(v).toLocaleString('en-KE');
const badge=(t,tone='')=>`<span class="badge ${tone}">${esc(t)}</span>`;
export const checkTone=c=>c.status==='Reviewed'?'ok':c.status==='Prepared'?'':'warn';
export const supportTone=s=>s?.state==='ok'?'ok':'warn';
// The line codes an account can be mapped to, in layout order, grouped by section.
export function mapChoices(layout){
 const groups=[];
 for(const l of (layout?.lines||[]).filter(x=>x.kind==='Line').sort((a,b)=>a.sort_order-b.sort_order)){
  let g=groups.find(x=>x.section===l.section&&x.statement===l.statement);if(!g){g={statement:l.statement,section:l.section,lines:[]};groups.push(g);}g.lines.push(l);
 }
 return groups;
}
// A short description of how a line's side applies: debit-side lines are debit less credit, credit-side lines the reverse.
export const sideNote=side=>side==='Credit'?'credit less debit':'debit less credit';

// ---- The statements, as shown on the SACCO tab and in the report version ------------------------------------------------------------------
export function saccoFsView(b){
 if(!b)return '';
 const cmp=!!b.comparative_available;
 const lineRow=l=>`<tr class="${l.kind==='Total'?'total-row':''}"><td>${l.kind==='Total'?`<b>${esc(l.caption)}</b>`:esc(l.caption)}</td><td>${l.kind==='Total'?`<b>${money(l.current)}</b>`:money(l.current)}</td><td>${cmp?money(l.comparative):''}</td></tr>`;
 const stmt=(title,sections)=>`<h4>${esc(title)}</h4><div class="scroll"><table><thead><tr><th>Caption</th><th>Current year</th><th>${cmp?'Prior year':''}</th></tr></thead><tbody>${(sections||[]).map(s=>`<tr><td colspan="3"><b>${esc(s.section)}</b></td></tr>${(s.lines||[]).map(lineRow).join('')}`).join('')}</tbody></table></div>`;
 const soce=b.soce||{columns:[],rows:[]};
 const soceTable=(soce.columns||[]).length?`<h4>Statement of changes in equity</h4><div class="scroll"><table><thead><tr><th></th>${soce.columns.map(c=>`<th>${esc(c.caption)}</th>`).join('')}<th>Total</th></tr></thead><tbody>${(soce.rows||[]).map(r=>`<tr class="${['closing','difference'].includes(r.key)?'total-row':''}"><td>${['closing','difference'].includes(r.key)?`<b>${esc(r.label)}</b>`:esc(r.label)}</td>${soce.columns.map(c=>`<td>${money(r.values?.[c.code])}</td>`).join('')}<td>${money(r.total)}</td></tr>`).join('')}</tbody></table></div>${cmp?'':'<p class="muted">Opening balances need the comparative trial balance.</p>'}`:'';
 const stats=(b.statistics||[]).length?`<h4>Financial and statistical information</h4><div class="scroll"><table><thead><tr><th>Item</th><th>Value</th><th>Source</th></tr></thead><tbody>${b.statistics.map(x=>`<tr><td>${esc(x.caption)}</td><td>${x.value==null?'<span class="missing">not entered</span>':x.unit==='Count'?count(x.value):money(x.value)}</td><td>${esc(x.source_note||'')}</td></tr>`).join('')}</tbody></table></div>`:'';
 const ratios=(b.ratios||[]).length?`<h4>Prudential ratios (Partner-confirmed table)</h4><div class="scroll"><table><thead><tr><th>Ratio</th><th>Requirement</th><th>This file</th><th>Result</th></tr></thead><tbody>${b.ratios.map(r=>`<tr><td>${esc(r.label)}</td><td>${esc(r.comparator)} ${esc(r.threshold)}${r.measure==='Percentage'?'%':''}</td><td>${r.value==null?'—':esc(r.value)}</td><td>${badge(r.state,r.state==='Met'?'ok':'warn')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No prudential ratio is confirmed for this SACCO and year end yet.</p>';
 return `<p class="muted">${esc(b.entity)} · period ended ${esc(b.period_end)} · ${esc(b.framework)} · framework ${esc(b.framework_status)} · SACCO layout version ${esc(b.layout_version)} (${esc(b.layout_status)})</p>
  ${(b.blocking||[]).length?`<div class="audit-note warn"><b>What stops these statements being submitted</b><ul>${b.blocking.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
  ${(b.warnings||[]).length?`<ul class="muted">${b.warnings.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
  ${stmt('Statement of financial position',b.position)}${stmt('Statement of surplus or deficit',b.income)}${soceTable}${stats}${ratios}
  ${b.balances===false?'<p class="missing">The statement of financial position does not balance.</p>':''}<p class="info">${esc(b.note||'')}</p>`;
}

export function createSaccoUI(ctx){
 const {field,select,form,modal,request,notice,shortDate}=ctx;
 const staff=()=>ctx.data()?.me||{};
 const textArea=(name,label,value='',max=1500,req=true)=>`<label class="full">${label}<textarea name="${name}" maxlength="${max}" ${req?'required':''}>${esc(value||'')}</textarea></label>`;
 const open=file=>file&&!['Approved','Completion','Archived'].includes(file.file_status);
 const mapOptions=(layout,chosen)=>`<option value="">— choose a line —</option>`+mapChoices(layout).map(g=>`<optgroup label="${esc(g.statement)} · ${esc(g.section)}">${g.lines.map(l=>`<option value="${esc(l.line_code)}" ${l.line_code===chosen?'selected':''}>${esc(l.caption)}</option>`).join('')}</optgroup>`).join('');

 function layoutCard(w,role){
  const lay=w.layout,draft=w.draft,editing=lay?.status==='Draft'?lay:draft,leader=['MANAGER','PARTNER'].includes(role);
  const lineTable=(L,canEdit)=>`<div class="scroll"><table><thead><tr><th>Code</th><th>Statement · section</th><th>Caption</th><th>Kind</th><th>Rule</th>${canEdit?'<th>Action</th>':''}</tr></thead><tbody>${[...L.lines].sort((a,b)=>a.sort_order-b.sort_order).map(l=>`<tr><td><b>${esc(l.line_code)}</b></td><td>${esc(l.statement)}<small>${esc(l.section)}</small></td><td>${esc(l.caption)}${l.detail?`<small>${esc(l.detail)}</small>`:''}</td><td>${esc(l.kind)}</td><td>${l.kind==='Line'?esc(l.side)+'-side ('+sideNote(l.side)+')':l.kind==='Total'?esc((l.total_of||[]).join(' + ').replace(/\+ -/g,'− ')):l.kind==='Statistic'?esc(l.unit):esc(l.auto_key||'')}${(l.roles||[]).length?`<small>${(l.roles||[]).map(r=>esc(ROLE_LABELS[r]||r)).join(' · ')}</small>`:''}</td>${canEdit?`<td><div class="actions"><button data-sacco-line-edit="${esc(l.line_code)}">Edit</button><button data-sacco-line-remove="${esc(l.line_code)}">Remove</button></div></td>`:''}</tr>`).join('')}</tbody></table></div>`;
  return `<section class="card section-space"><div class="section-head"><div><h3>Statement layout</h3><p class="muted">The captions, order and totals the SACCO statements use. A Partner must approve a version before the statements can be submitted. The first version is a draft written without the specimen statements; read every caption before approving it.</p></div>${leader&&!editing?'<button data-sacco-layout-copy>Start a new version</button>':''}</div>
   <p>Version in use: <b>${esc(lay?.version)}</b> ${badge(lay?.status||'None',lay?.status==='Approved'?'ok':'warn')} ${lay?.status==='Approved'?`<span class="muted">Approved by ${esc(lay.approved_by_name||'a Partner')}${lay.approved_at?' on '+esc(shortDate(lay.approved_at)):''}${lay.approval_note?': '+esc(lay.approval_note):''}</span>`:'<span class="muted">Not yet approved by a Partner.</span>'}</p>
   <p class="muted">${esc(lay?.source_note||'')}</p>
   ${editing?`<div class="audit-note"><b>Draft version ${esc(editing.version)}</b>${editing.problem?` · <span class="missing">${esc(editing.problem)}</span>`:' · the layout is consistent and can be approved.'}
     <div class="actions">${leader?`<button data-sacco-line-new="${esc(editing.layout_id)}">+ Add a line</button>`:''}${role==='PARTNER'?`<button class="primary" data-sacco-layout-approve="${esc(editing.layout_id)}">Approve this layout</button>`:'<small>A Partner approves it.</small>'}</div></div>${lineTable(editing,leader)}`
     :`<details class="audit-history"><summary>Lines in version ${esc(lay?.version)} · ${(lay?.lines||[]).length}</summary>${lay?lineTable(lay,false):''}</details>`}
   ${(w.versions||[]).length>1?`<details class="audit-history"><summary>Earlier versions</summary>${w.versions.map(v=>`<p><b>Version ${esc(v.version)}</b> ${badge(v.status)}<small>${v.approved_by_name?'Approved by '+esc(v.approved_by_name)+' · '+esc(v.approval_note||''):''}</small></p>`).join('')}</details>`:''}</section>`;
 }
 function mapCard(w,role,file){
  const lay=w.layout,accts=w.accounts||[],unm=accts.filter(a=>(Number(a.cur_net)||Number(a.cmp_net))&&!a.line_code),prop=accts.filter(a=>a.map_status==='Proposed'),can=MAKERS.includes(role)&&open(file);
  return `<section class="card section-space"><div class="section-head"><div><h3>Account mapping</h3><p class="muted">Each of the firm's audit accounts goes to one statement line. A Manager proposes and a Partner approves; a Partner's own choice is approved when saved. The map is shared by every SACCO the firm audits.</p></div><div class="actions">${can?'<button class="primary" data-sacco-map-save>Save mapping</button>':''}${role==='PARTNER'&&prop.length?'<button data-sacco-map-approve>Approve proposed ('+prop.length+')</button>':''}</div></div>
   ${unm.length?`<p class="missing">${unm.length} account${unm.length===1?'':'s'} with a balance ${unm.length===1?'is':'are'} not mapped.</p>`:''}
   ${accts.length?`<div class="scroll"><table><thead><tr><th>Account</th><th>Audit area</th><th>Adjusted balance</th><th>Prior year</th><th>Statement line</th><th>Status</th></tr></thead><tbody>${accts.map(a=>`<tr><td><b>${esc(a.account_code)}</b> ${esc(a.account_name)}</td><td>${esc(a.audit_area)}</td><td>${money(a.cur_net)}</td><td>${money(a.cmp_net)}</td><td>${can?`<select data-sacco-map="${esc(a.audit_account_id)}" data-was="${esc(a.line_code||'')}">${mapOptions(lay,a.line_code)}</select>`:esc(a.line_code||'—')}</td><td>${a.line_code?badge(a.map_status,a.map_status==='Approved'?'ok':'warn'):badge('Not mapped','warn')}${a.map_status==='Proposed'&&a.proposed_by_name?`<small>Proposed by ${esc(a.proposed_by_name)}</small>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="missing">Confirm and map a trial balance first.</p>'}</section>`;
 }
 function movesCard(w,role,file){
  const cols=(w.preview?.soce?.columns)||[],me=staff().staff_id,can=MAKERS.includes(role)&&open(file),name=c=>cols.find(x=>x.code===c)?.caption||c;
  const rows=(w.moves||[]);
  return `<section class="card section-space"><div class="section-head"><div><h3>Movements in equity</h3><p class="muted">Record each transfer between reserves, dividend, share issue or revaluation. With the comparative trial balance, the opening balance plus the surplus plus these movements must equal the closing balance of every reserve. Transfers between reserves must net to zero.</p></div>${can?'<button class="primary" data-sacco-move-new>+ Record a movement</button>':''}</div>
   ${rows.length?`<div class="scroll"><table><thead><tr><th>Reserve</th><th>Kind</th><th>Amount</th><th>Evidence</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(m=>`<tr><td>${esc(name(m.line_code))}</td><td>${esc(m.kind)}</td><td>${money(m.amount)}</td><td>${esc(m.note)}<small>${esc(m.entered_by_name||'')}</small></td><td>${badge(m.status,m.status==='Active'?'':'')}${m.withdraw_note?`<small>${esc(m.withdraw_note)}</small>`:''}</td><td>${m.status==='Active'&&can&&(m.entered_by===me||['MANAGER','PARTNER'].includes(role))?`<button data-sacco-move-withdraw="${esc(m.move_id)}">Withdraw</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No movement has been recorded.</p>'}</section>`;
 }
 function statsCard(w,role,file){
  const can=MAKERS.includes(role)&&open(file);
  return `<section class="card section-space"><div class="section-head"><div><h3>Statistics</h3><p class="muted">Figures for the financial and statistical page that do not come from the trial balance. Each value is entered with its source; the latest entry is used and earlier ones are kept.</p></div></div>
   <div class="scroll"><table><thead><tr><th>Item</th><th>Value</th><th>Source</th><th></th></tr></thead><tbody>${(w.preview?.statistics||[]).map(x=>`<tr><td>${esc(x.caption)}${x.detail?`<small>${esc(x.detail)}</small>`:''}</td><td>${x.value==null?'<span class="missing">not entered</span>':x.unit==='Count'?count(x.value):money(x.value)}</td><td>${esc(x.source_note||'')}${x.entered_by_name?`<small>${esc(x.entered_by_name)}</small>`:''}</td><td>${can?`<button data-sacco-stat="${esc(x.code)}">${x.value==null?'Enter':'Update'}</button>`:''}</td></tr>`).join('')}</tbody></table></div></section>`;
 }
 function checksCard(w,role,file){
  const me=staff().staff_id,can=MAKERS.includes(role)&&open(file),leader=['MANAGER','PARTNER'].includes(role);
  const list=w.preview?.checks||[];
  return `<section class="card section-space"><div class="section-head"><div><h3>Section 10 · matters for the SACCO report</h3><p class="muted">Each matter is prepared by one person and reviewed by a Manager or Partner who did not prepare it. A matter that does not apply is marked so, with the reason. Final sign-off waits until every matter is reviewed.</p></div></div>
   ${list.map(c=>`<article class="card section-space"><div class="section-head"><div><h4>${esc(c.caption)}</h4><small>${esc(c.detail||'')}</small></div><div>${badge(c.status==='Open'?'Not started':c.status,checkTone(c))}${c.status!=='Open'&&c.applicable===false?' '+badge('Not applicable'):''}</div></div>
    ${c.support?`<p class="${c.support.state==='ok'?'info':'missing'}">${esc(c.support.text)}</p>`:''}
    ${c.note?`<p class="muted">${esc(c.note)} — ${esc(c.prepared_by_name||'')}${c.prepared_at?' · '+esc(shortDate(c.prepared_at)):''}</p>`:''}${c.reviewer_name?`<p class="muted">Reviewed by ${esc(c.reviewer_name)}${c.review_note?': '+esc(c.review_note):''}</p>`:''}
    <div class="actions">${can?`<button data-sacco-check-prepare="${esc(c.code)}">${c.status==='Open'?'Prepare':'Prepare again'}</button>`:''}${c.status==='Prepared'&&leader&&c.prepared_by!==me&&open(file)?`<button class="primary" data-sacco-check-review="${esc(c.code)}">Review</button>`:''}${c.status==='Prepared'&&c.prepared_by===me?'<small>Waiting for another reviewer.</small>':''}</div></article>`).join('')}</section>`;
 }
 function panel(file,s){
  const w=s?.sacco;if(!w)return '<section class="card"><h3>SACCO statements</h3><p class="muted">This tab is for SACCO audit files.</p></section>';
  const role=staff().category_code;
  return `<section class="card"><div class="section-head"><div><h3>SACCO statements</h3><p class="muted">The financial statements for a SACCO are built from the approved layout, the account map, the equity movements and the statistics below. They appear as the Financial statements report on the Reports tab.</p></div></div>${saccoFsView(w.preview)}</section>
   ${layoutCard(w,role)}${mapCard(w,role,file)}${movesCard(w,role,file)}${statsCard(w,role,file)}${checksCard(w,role,file)}`;
 }

 function lineForm(layout,x=null){
  const roles=Object.entries(ROLE_LABELS).map(([k,v])=>`<label class="check"><input type="checkbox" name="role" value="${k}" ${(x?.roles||[]).includes(k)?'checked':''}> ${esc(v)}</label>`).join('');
  const body=field('line_code','Line code *',x?.line_code||'','text',`required maxlength="40" pattern="[A-Za-z]{1,3}\\.[A-Za-z0-9_]{2,30}" placeholder="A.CASH" ${x?'readonly':''}`)
   +select('statement','Statement *',STATEMENTS,x?.statement||'Financial position')+field('section','Section *',x?.section||'','text','required maxlength="80" placeholder="Assets"')
   +field('caption','Caption *',x?.caption||'','text','required maxlength="200"')+textArea('detail','Note shown with the line',x?.detail||'',500,false)
   +select('kind','Kind *',KINDS,x?.kind||'Line')+select('side','Side (lines only)',['Debit','Credit'],x?.side||'Debit')
   +field('total_of','Total of (totals only; line codes separated by commas, a minus sign subtracts)',(x?.total_of||[]).join(', '),'text','maxlength="600"')
   +select('unit','Unit (statistics only)',['KES','Count'],x?.unit||'KES')+select('auto_key','System support (checks only)',AUTO_KEYS,x?.auto_key||'','None')
   +field('sort_order','Order number *',String(x?.sort_order??''),'text','required inputmode="numeric"')
   +`<fieldset class="full"><legend>What the line is used for</legend>${roles}</fieldset>`;
  modal(x?'Edit '+x.line_code:'Add a line',form(body,'Save line'),f=>{
   const o=Object.fromEntries(f);const kind=o.kind;
   return request({action:'audit_sacco_layout_line_save',layout_id:layout.layout_id,line:{line_code:o.line_code,statement:o.statement,section:o.section,caption:o.caption,detail:o.detail||'',kind,side:kind==='Line'?o.side:null,
    total_of:kind==='Total'?String(o.total_of||'').split(',').map(v=>v.trim()).filter(Boolean):[],roles:f.getAll('role'),unit:kind==='Statistic'?o.unit:null,auto_key:kind==='Check'?(o.auto_key||null):null,sort_order:o.sort_order}});
  },()=>ctx.refresh(),{refreshWorkspace:false});
 }

 async function handle(b,file){
  const s=ctx.snapshot(),w=s?.sacco;
  const has=a=>b.hasAttribute&&b.hasAttribute(a);
  if(!w)return false;
  const editing=w.layout?.status==='Draft'?w.layout:w.draft;
  if(has('data-sacco-layout-copy')){modal('Start a new layout version',`<p>This copies the layout in use into a draft version. Nothing changes for the statements until a Partner approves the draft.</p><button class="primary" id="saccoCopyGo">Start the draft</button>`);
   document.querySelector('#saccoCopyGo').onclick=async()=>{try{await request({action:'audit_sacco_layout_copy'});document.querySelector('#editor').close();await ctx.refresh();}catch(e){document.querySelector('#editorNotice').textContent=e.message;}};return true;}
  if(b.dataset.saccoLayoutApprove){const id=b.dataset.saccoLayoutApprove;modal('Partner · approve the SACCO statement layout',form(`<p class="full">Approving makes this version the one every SACCO statement uses, and replaces the version now in use. Read every caption, total and note first.</p>`+textArea('note','What did you check? (at least 10 characters) *','',1000),'Approve layout'),f=>request({action:'audit_sacco_layout_approve',layout_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-sacco-line-new')){if(editing)lineForm(editing);return true;}
  if(b.dataset.saccoLineEdit){const x=(editing?.lines||[]).find(l=>l.line_code===b.dataset.saccoLineEdit);if(x)lineForm(editing,x);return true;}
  if(b.dataset.saccoLineRemove){const code=b.dataset.saccoLineRemove;modal('Remove '+code,form(`<p class="full">Remove this line from the draft layout. A total that uses it, or an account mapped to it, stops this being approved until you change them.</p>`,'Remove line'),()=>request({action:'audit_sacco_layout_line_remove',layout_id:editing.layout_id,line_code:code}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(has('data-sacco-map-save')){
   const items=[...document.querySelectorAll('[data-sacco-map]')].filter(el=>el.value&&el.value!==el.dataset.was).map(el=>({audit_account_id:el.dataset.saccoMap,line_code:el.value}));
   if(!items.length){notice('Choose a statement line for at least one account first.',true);return true;}
   try{const r=await request({action:'audit_sacco_map_save',items});notice(r?.status==='Approved'?`${r.saved} mapping${r.saved===1?'':'s'} saved and approved.`:`${r?.saved||items.length} mapping${items.length===1?'':'s'} saved. A Partner must approve them.`);await ctx.refresh();}catch(e){notice(e.message,true);}
   return true;}
  if(has('data-sacco-map-approve')){const ids=(w.accounts||[]).filter(a=>a.map_status==='Proposed').map(a=>a.audit_account_id);
   modal('Partner · approve proposed mappings',`<p>Approve ${ids.length} proposed account mapping${ids.length===1?'':'s'}? They apply to every SACCO the firm audits.</p><button class="primary" id="saccoMapGo">Approve</button>`);
   document.querySelector('#saccoMapGo').onclick=async()=>{try{await request({action:'audit_sacco_map_approve',accounts:ids});document.querySelector('#editor').close();await ctx.refresh();}catch(e){document.querySelector('#editorNotice').textContent=e.message;}};return true;}
  if(has('data-sacco-move-new')){
   const cols=(w.preview?.soce?.columns||[]).map(c=>[c.code,c.caption]);
   modal('Record a movement in equity',form(select('line_code','Reserve *',cols,cols[0]?.[0]||'')+select('kind','Kind *',MOVE_KINDS,'Transfer to or from reserve')+field('amount','Amount (KES; negative for a decrease) *','','text','required inputmode="decimal"')
    +textArea('note','Where is it evidenced? (at least 5 characters) *','',500)+'<p class="info full">A transfer between reserves is two entries that net to zero: a positive one to the reserve receiving it and a negative one to the reserve it comes from.</p>','Save movement'),
    f=>request({action:'audit_sacco_move_save',audit_file_id:file.audit_file_id,...Object.fromEntries(f)}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.saccoMoveWithdraw){const id=b.dataset.saccoMoveWithdraw;modal('Withdraw movement',form(textArea('note','Why is it withdrawn? (at least 5 characters) *','',500),'Withdraw'),f=>request({action:'audit_sacco_move_withdraw',move_id:id,note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.saccoStat){const code=b.dataset.saccoStat,x=(w.preview?.statistics||[]).find(t=>t.code===code);if(!x)return true;
   modal(x.caption,form(field('amount',`Value${x.unit==='Count'?' (a whole number)':' (KES)'} *`,x.value==null?'':String(x.value),'text','required inputmode="decimal"')+textArea('note','Source (at least 5 characters) *','',500),'Save value'),f=>request({action:'audit_sacco_value_save',audit_file_id:file.audit_file_id,line_code:code,amount:f.get('amount'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.saccoCheckPrepare){const code=b.dataset.saccoCheckPrepare,c=(w.preview?.checks||[]).find(t=>t.code===code);if(!c)return true;
   modal('Prepare · '+c.caption,form(`<p class="full">${esc(c.detail||'')}</p>${c.support?`<p class="full info">${esc(c.support.text)}</p>`:''}`+select('applicable','Does it apply to this SACCO? *',[['true','Yes, it applies'],['false','No, it does not apply']],c.applicable===false?'false':'true')+textArea('note','What was done, or why it does not apply (at least 10 characters) *',c.note||'',1000),'Save for review'),
    f=>request({action:'audit_sacco_check_prepare',audit_file_id:file.audit_file_id,line_code:code,applicable:f.get('applicable')==='true',note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  if(b.dataset.saccoCheckReview){const code=b.dataset.saccoCheckReview,c=(w.preview?.checks||[]).find(t=>t.code===code);if(!c)return true;
   modal('Review · '+c.caption,form(`<p class="full">${esc(c.note||'')}</p>`+select('decision','Decision *',['Accept','Return'],'Accept')+textArea('note','Review note (at least 5 characters to return)','',1000,false),'Save review'),
    f=>request({action:'audit_sacco_check_review',audit_file_id:file.audit_file_id,line_code:code,decision:f.get('decision'),note:f.get('note')}),()=>ctx.refresh(),{refreshWorkspace:false});return true;}
  return false;
 }
 return {panel,handle};
}
