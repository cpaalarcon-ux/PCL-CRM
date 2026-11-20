// The PPE register (build 2881): property, plant and equipment across the years. Staff declare an asset or a disposal; a Manager or Partner who did not declare it approves it. The year's cost,
// accumulated depreciation, carrying amount and tax written-down value are worked out from the approved records and checked against the trial balance. The server owns every rule;
// this file draws what it returns. Build 2883: classes with no reviewed rate for a year are listed, and a Partner can prepare the missing rate from the nearest existing one.
export function createPpeUI(ctx,{payload,show,onChange}){
 const {esc,field,select,form,request,notice,shortDate}=ctx;
 const btn=(a,l,id='',extra='')=>`<button type="button" data-ppe="${a}" data-id="${esc(id)}" ${extra}>${esc(l)}</button>`;
 const n=v=>v===null||v===undefined?'':v===0?'–':v<0?'('+Math.abs(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})+')':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const BADGE={'Approved':'<span class="badge good">Approved</span>','Waiting for approval':'<span class="badge warn">Waiting for approval</span>','Returned':'<span class="badge red">Returned</span>'};
 let data=null,from=null;
 const who=(name,at)=>name?` ${esc(name)}${at?' on '+esc(shortDate(at)):''}`:'';
 const table=(head,rows,foot='')=>`<div class="table-wrap"><table><thead><tr>${head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody>${foot?`<tfoot>${foot}</tfoot>`:''}</table></div>`;
 const money=v=>`<td class="num">${n(v)}</td>`;
 function registerHtml(){
  const r=data.register,t=r.totals;
  if(!r.rows.length)return '<p class="muted">No approved assets fall in this year yet.</p>';
  const book=table(['Asset','Cost at start','Additions','Disposals','Cost at end','Depreciation at start','Charge','Released on disposal','Depreciation at end','Carrying amount','Gain or (loss) on disposal'],
   r.rows.map(x=>`<tr><td>${esc(x.asset_name)} <small class="muted">${esc(x.asset_account)} · ${esc(x.class_code)}</small></td>${[x.opening_cost,x.additions,x.disposal_cost,x.closing_cost,x.opening_acc,x.charge,x.released,x.closing_acc,x.nbv,x.disposed?x.gain_loss:null].map(money).join('')}</tr>`),
   `<tr><th>Total</th>${[t.opening_cost,t.additions,t.disposal_cost,t.closing_cost,t.opening_acc,t.charge,t.released,t.closing_acc,t.nbv,t.gain_loss].map(money).join('')}</tr>`);
  const tax=table(['Asset','Tax value at start','Added','Wear and tear','Balancing allowance','Balancing charge','Tax value at end'],
   r.rows.map(x=>`<tr><td>${esc(x.asset_name)}</td>${[x.tax_opening,x.tax_addition,x.tax_allowance,x.tax_balancing_allowance,x.tax_balancing_charge,x.tax_closing].map(money).join('')}</tr>`),
   `<tr><th>Total</th>${[t.tax_opening,r.rows.reduce((s,x)=>s+(x.tax_addition||0),0),t.tax_allowance,t.tax_balancing_allowance,t.tax_balancing_charge,t.tax_closing].map(money).join('')}</tr>`);
  return `<h4>Book values</h4>${book}<h4>Tax written-down values</h4>${tax}`;
 }
 function gapsHtml(){
  const g=data.register.rate_gaps||[];
  if(!g.length)return '';
  return `<h3>Rates needed</h3><p class="muted">These classes have no reviewed rate for the year shown, so the register cannot work out depreciation or wear and tear for them. The register never fills in a rate by itself.${data.can_add_rate?'':' A Partner adds the rate.'}</p>`+
   table(['Class','Year','Assets affected',''],g.map((x,i)=>`<tr><td>${esc(x.class_code)}</td><td>${esc(shortDate(x.start))} to ${esc(shortDate(x.end))}</td><td>${x.assets.map(esc).join(', ')}</td><td>${data.can_add_rate&&x.fill?btn('rate','Prepare the rate',String(i)):data.can_add_rate?'<small class="muted">No earlier rate for this class to start from.</small>':''}</td></tr>`));
 }
 function reconHtml(){
  const rc=data.reconciliation;
  if(!rc.lines.length)return '<p class="muted">There is nothing to compare: the trial balance has no property, plant and equipment and the register is empty.</p>';
  return table(['Account','What','Register','Trial balance','Difference'],rc.lines.map(l=>`<tr class="${l.ties?'':'missing'}"><td>${esc(l.account)} ${esc(l.name)}</td><td>${esc(l.kind)}</td>${money(l.register)}${money(l.trial_balance)}${money(l.difference)}</tr>`));
 }
 function assetHtml(a){
  const shown=a.draft||a.approved||a.returned,d=a.disposal;
  const act=[
   a.can_review?btn('approve',a.draft.declared_by_me?'Approve (as the only Partner)':'Approve',a.draft.record_id)+btn('return','Return',a.draft.record_id):'',
   data.can_declare&&(a.approved||a.returned)&&!a.draft?btn('change','Change (new version)',a.asset_key):'',
   a.can_dispose?btn('dispose','Record a disposal',a.asset_key):'',
   a.can_end?btn('end','End this record',a.asset_key):''
  ].join('');
  const dact=[d.state==='Waiting for approval'&&a.can_review_disposal?btn('d-approve',d.draft.declared_by_me?'Approve disposal (as the only Partner)':'Approve disposal',d.draft.record_id)+btn('d-return','Return disposal',d.draft.record_id):'',
   a.can_end_disposal?btn('d-end','End the disposal',a.asset_key):''].join('');
  const dsh=d.draft||d.approved||d.returned;
  return `<section class="card section-space"><h4>${esc(a.name)} ${BADGE[a.state]||''}</h4><p class="muted"><small>${esc(shown.asset_account)} · class ${esc(shown.class_code)} · ${esc(shown.origin)}${shown.origin==='Brought forward'?' at '+esc(shortDate(shown.bf_as_of)):''} · cost ${n(shown.cost)} · acquired ${esc(shortDate(shown.acquired_on))}, first used ${esc(shortDate(shown.first_use_on))} · business use ${esc(shown.business_percentage)}%</small></p>
   <p class="muted"><small>Version ${shown.version} declared by${who(shown.prepared_name,shown.prepared_at)}${a.state==='Approved'&&shown.reviewed_name?'; approved by'+who(shown.reviewed_name,shown.reviewed_at)+(shown.sole_partner_approval?' (the firm’s only Partner)':''):''}${a.state==='Returned'?'; returned: '+esc(shown.review_note||''):''}. Support: ${esc(shown.evidence)}</small></p>
   ${a.draft&&a.approved?'<p class="muted"><small>A new version waits for approval. The approved version stands until then.</small></p>':''}
   ${dsh?`<p>${BADGE[d.state]||''} Disposal ${esc(dsh.kind)} on ${esc(shortDate(dsh.disposed_on))}, proceeds ${n(dsh.proceeds)}. <small class="muted">${esc(dsh.evidence)}${dsh.review_note&&d.state==='Returned'?' Returned: '+esc(dsh.review_note):''}</small></p>`:''}
   ${act||dact?`<div class="actions">${act}${dact}</div>`:''}</section>`;
 }
 async function open(){
  data=await request(payload('ledger_ppe_read'));
  const rd=data.readiness,state=!rd.relevant?'<p><span class="badge good">No property, plant and equipment this year</span></p>':rd.ok?'<p><span class="badge good">Approved and agrees to the trial balance</span></p>':'<p><span class="badge red">Not ready</span></p>';
  show('Property, plant and equipment register',`<p class="info full">${esc(data.note)}</p>${data.locked?'<p class="error" role="alert">The pack is locked by an audit, so the register cannot change until a Partner ends the lock.</p>':''}${state}${rd.problems&&rd.problems.length?`<ul class="error" role="alert">${rd.problems.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`:''}
   <div class="actions">${data.can_declare?btn('add','Add an asset')+btn('add-bf','Add a brought-forward asset')+(data.bf?.pending?.length?btn('bf',`Complete the ${data.bf.pending.length} brought-forward balance${data.bf.pending.length===1?'':'s'} from the trial balance`):'')+(data.candidates.length?btn('additions',`Add the ${data.candidates.length} purchase${data.candidates.length===1?'':'s'} to the register`):''):''}${btn('refresh','Refresh')}</div>
   ${gapsHtml()}<h3>Year ${esc(shortDate(data.year.start))} to ${esc(shortDate(data.year.end))}</h3>${registerHtml()}
   <h3>Agreement to the trial balance</h3>${reconHtml()}
   ${data.candidates.length&&data.can_declare?`<h3>Purchases mapped to property, plant and equipment, not yet in the register</h3>${table(['Date','Description','Account','Cost',''],data.candidates.map(c=>`<tr><td>${esc(shortDate(c.acquired_on))}</td><td>${esc(c.asset_name)} <small class="muted">${esc(c.supplier)}</small></td><td>${esc(c.asset_account)}</td>${money(c.cost)}<td>${btn('from-purchase','Add to the register',c.source_row_id)}</td></tr>`))}`:''}
   <h3>Assets</h3>${data.assets.length?data.assets.map(assetHtml).join(''):'<p class="muted">No assets are recorded for this client yet.</p>'}
   <h3>How the register works things out</h3><ul class="muted">${data.register.policy.map(p=>`<li>${esc(p)}</li>`).join('')}</ul>`);
 }
 const assetForm=(v={},origin='Added in the year')=>{
  const bf=origin==='Brought forward';
  return form(`<p class="info full">${bf?'An asset that was already in use at the start of the first year the ERP holds. Enter the accumulated depreciation and tax written-down value at the brought-forward year end, as agreed to the prior-year schedule.':'An asset acquired in the period. Cost and dates come from the purchase invoice.'}</p>
   ${field('asset_name','Asset *',v.asset_name||'','text','required minlength="3" maxlength="160"')}
   ${select('asset_account','Cost account *',data.accounts.map(x=>[x.code,x.code+' '+x.name]),v.asset_account||'')}
   ${select('class_code','Asset class *',data.classes.map(x=>[x.code,x.name]),v.class_code||'')}
   <input type="hidden" name="origin" value="${esc(origin)}">
   ${field('acquired_on','Date acquired *',v.acquired_on||'','date','required')}${field('first_use_on','Date first used *',v.first_use_on||'','date','required')}
   ${field('cost','Cost *',v.cost??'','number','required min="0.01" step="0.01"')}${field('business_percentage','Business use %',v.business_percentage??100,'number','min="0" max="100" step="0.01"')}
   <label class="full"><input type="checkbox" name="noncommercial_vehicle" ${v.noncommercial_vehicle?'checked':''}> A vehicle that is not commercial (the statutory cost cap applies to the tax figures)</label>
   ${bf?field('bf_as_of','Brought forward at (a financial year end) *',v.bf_as_of||'','date','required')+field('bf_accumulated_depreciation','Accumulated depreciation brought forward *',v.bf_accumulated_depreciation??'','number','required min="0" step="0.01"')+field('bf_tax_wdv','Tax written-down value brought forward *',v.bf_tax_wdv??'','number','required min="0" step="0.01"'):''}
   <label class="full">What supports the cost and dates? * <textarea name="evidence" required minlength="10" maxlength="500">${esc(v.evidence||'')}</textarea></label>`,'Declare for approval');
 };
 const read=f=>({asset_name:f.get('asset_name'),asset_account:f.get('asset_account'),class_code:f.get('class_code'),origin:f.get('origin'),acquired_on:f.get('acquired_on'),first_use_on:f.get('first_use_on'),cost:f.get('cost'),business_percentage:f.get('business_percentage'),noncommercial_vehicle:f.has('noncommercial_vehicle'),
  bf_as_of:f.get('bf_as_of')||undefined,bf_accumulated_depreciation:f.get('bf_accumulated_depreciation')||undefined,bf_tax_wdv:f.get('bf_tax_wdv')||undefined,evidence:f.get('evidence')});
 const declare=(extra={})=>f=>request({...payload('ledger_ppe_asset_declare'),...read(f),...extra});
 const done=msg=>async()=>{notice(msg);await open();onChange?.();};
 const assetOf=key=>data.assets.find(x=>x.asset_key===key);
 const handlers={
  refresh:()=>open(),
  rate(i){
   const g=data.register.rate_gaps[Number(i)],f=g&&g.fill;if(!f)throw Error('There is no earlier rate for this class to start from. Add it from the rates screen.');
   const hid=(k,v)=>`<input type="hidden" name="${k}" value="${esc(v??'')}">`,b=f.based_on;
   show('Prepare the rate for class '+f.class_code,form(`<p class="info full">Copied from the ${esc(f.class_code)} rate that applied from ${esc(shortDate(b.effective_from))} to ${esc(shortDate(b.effective_to))} (${esc(b.source_reference||'no source recorded')}). Nothing has been checked against the law for these dates. Check the Income Tax Act for the new dates, change any figure that has changed, then type the authority you checked and the date. Once saved, the rate cannot be edited; a correction is a later dated version.</p>
    ${hid('class_code',f.class_code)}${hid('name',f.name)}${hid('expense_account',f.expense_account)}${hid('contra_account',f.contra_account)}
    ${field('effective_from','Effective from *',f.effective_from,'date','required')}${field('effective_to','Effective to *',f.effective_to,'date','required')}
    ${field('first_rate','First-use annual rate % *',f.first_rate,'number','required min="0" max="100" step="0.0001"')}${field('annual_rate','Later annual rate % *',f.annual_rate,'number','required min="0" max="100" step="0.0001"')}
    ${field('later_basis_percentage','Later qualifying cost basis % *',f.later_basis_percentage,'number','required min="0" max="100" step="0.0001"')}${field('tax_cost_cap','Noncommercial motor cost cap KES (if applicable)',f.tax_cost_cap??'','number','min="0" step="0.01"')}
    ${field('source_checked_on','Authority checked on *','','date','required')}
    <label class="full">Official authority and reference you checked for these dates * <textarea name="source_reference" required minlength="10" maxlength="4000"></textarea></label>
    <label class="full">Qualifying scope and restrictions * <textarea name="scope" required minlength="10" maxlength="2000">${esc(f.scope||'')}</textarea></label>`,'Save the rate'),
    fd=>request({...payload('ledger_rate_add'),...Object.fromEntries(fd)}),done('The rate is saved. The register has been refreshed.'));
  },
  add(){from=null;show('Add an asset',assetForm({}),declare(),done('Declared. A Manager or Partner approves it.'));},
  'add-bf'(){from=null;show('Add a brought-forward asset',assetForm({},'Brought forward'),declare(),done('Declared. A Manager or Partner approves it.'));},
  bf(){
   const b=data.bf,classOpts=`<option value="">Leave out for now</option>`+data.classes.map(x=>`<option value="${esc(x.code)}">${esc(x.name)}</option>`).join('');
   const rows=b.pending.map((r,i)=>`<tr><td>${esc(r.asset_account)} ${esc(r.name)}</td>${money(r.cost)}<td><select aria-label="Asset class for ${esc(r.asset_account)}" name="bf_class_${i}">${classOpts}</select></td><td><input aria-label="First-use date for ${esc(r.asset_account)}" type="date" name="bf_use_${i}" max="${esc(b.as_of)}"></td><td><input aria-label="Tax written-down value for ${esc(r.asset_account)}" type="number" name="bf_tax_${i}" min="0" step="0.01"></td><td><input aria-label="Accumulated depreciation for ${esc(r.asset_account)}" type="number" name="bf_acc_${i}" min="0" step="0.01" placeholder="from the trial balance"></td></tr>`);
   show('Brought-forward balances from the trial balance',form(`<p class="info full">Cost comes from the opening trial balance at ${esc(shortDate(b.as_of))}. The register also needs what a trial balance does not carry: the asset class, the date the assets were first used, and the tax written-down value from the prior-year tax computation. Nothing is filled in for you. Leave an account out to do it later.</p>
    <p class="muted full">Each row becomes one pool for the account. If an account holds a non-commercial vehicle above the statutory cost cap, or assets with different first-use dates or business use, add those assets one by one with “Add a brought-forward asset” and leave the account out here. Accumulated depreciation is taken from the trial balance for the class’s account; enter it only when two accounts share one depreciation account or you are not completing every account.</p>
    ${table(['Account','Cost (trial balance)','Asset class','First used','Tax written-down value','Accumulated depreciation'],rows)}
    <label class="full">What do the class, dates and tax values come from? * <textarea name="evidence" required minlength="10" maxlength="500" placeholder="For example: prior-year tax computation and fixed asset schedule, year ended 31 December 2025"></textarea></label>`,'Declare for approval'),
    f=>request({...payload('ledger_ppe_bf_declare'),evidence:f.get('evidence'),rows:b.pending.map((r,i)=>({asset_account:r.asset_account,class_code:f.get('bf_class_'+i),first_use_on:f.get('bf_use_'+i),tax_wdv:f.get('bf_tax_'+i),accumulated_depreciation:f.get('bf_acc_'+i)})).filter(x=>x.class_code)}),
    async r=>{notice(`Declared ${r.declared} brought-forward record${r.declared===1?'':'s'}. A Manager or Partner who did not declare them approves them.`);await open();onChange?.();});
  },
  additions(){
   const classOpts=sel=>`<option value="">Choose the class</option>`+data.classes.map(x=>`<option value="${esc(x.code)}"${x.code===sel?' selected':''}>${esc(x.name)}</option>`).join('');
   const rows=data.candidates.map((c,i)=>`<tr><td><input type="checkbox" name="add_pick_${i}" checked aria-label="Include ${esc(c.asset_name)}"></td><td>${esc(shortDate(c.acquired_on))}</td><td>${esc(c.asset_name)} <small class="muted">${esc(c.supplier)} ${esc(c.invoice)}</small></td><td>${esc(c.asset_account)}</td>${money(c.cost)}<td><select aria-label="Asset class for ${esc(c.asset_name)}" name="add_class_${i}">${classOpts(c.suggested_class)}</select></td><td><input aria-label="First-use date for ${esc(c.asset_name)}" type="date" name="add_use_${i}" value="${esc(c.acquired_on)}"></td></tr>`);
   show('Add purchases to the register',form(`<p class="info full">Name, account, date and cost come from the purchase. Choose the asset class for each and check the first-use date (it starts as the invoice date). A class is pre-chosen only when the register already uses one class for that account. Untick a purchase to leave it out.</p>
    ${table(['','Date','Purchase','Account','Cost','Asset class','First used'],rows)}`,'Declare for approval'),
    f=>request({...payload('ledger_ppe_additions_declare'),rows:data.candidates.map((c,i)=>({pick:f.has('add_pick_'+i),source_row_id:c.source_row_id,class_code:f.get('add_class_'+i),first_use_on:f.get('add_use_'+i)})).filter(x=>x.pick).map(({pick,...x})=>x)}),
    async r=>{notice(`Declared ${r.declared} purchase${r.declared===1?'':'s'}. A Manager or Partner who did not declare them approves them.`);await open();onChange?.();});
  },
  'from-purchase'(id){const c=data.candidates.find(x=>x.source_row_id===id);show('Add to the register: '+c.asset_name,assetForm({asset_name:c.asset_name,asset_account:c.asset_account,acquired_on:c.acquired_on,first_use_on:c.acquired_on,cost:c.cost,evidence:'Purchase row in the ERP, supplier '+(c.supplier||'')}),declare({source_row_id:id}),done('Declared from the purchase. A Manager or Partner approves it.'));},
  change(key){const a=assetOf(key),r=a.draft||a.approved||a.returned;show('New version of '+a.name,assetForm(r,r.origin),declare({asset_key:key}),done('Declared as a new version. A Manager or Partner approves it.'));},
  async approve(id){
   const a=data.assets.find(x=>x.draft&&x.draft.record_id===id);
   if(a&&a.draft.declared_by_me){show('Approve an asset you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>','Approve'),
    f=>request({...payload('ledger_ppe_asset_review'),record_id:id,decision:'Approved',sole_partner_approval:f.has('sole')}),done('Approved.'));return;}
   await request({...payload('ledger_ppe_asset_review'),record_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  return(id){show('Return the asset',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),f=>request({...payload('ledger_ppe_asset_review'),record_id:id,decision:'Returned',review_note:f.get('review_note')}),done('Returned to the preparer.'));},
  end(key){show('End this asset record',form('<p class="info full">Use this for a record made in error. A real disposal is recorded as a disposal.</p><label class="full">Why? (at least 10 characters) <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','End the record'),f=>request({...payload('ledger_ppe_asset_end'),asset_key:key,reason:f.get('reason')}),done('The record is ended.'));},
  dispose(key){const a=assetOf(key);show('Record a disposal: '+a.name,form(`${select('kind','How was it disposed of? *',data.kinds,'Sold')}${field('disposed_on','Date *','','date','required')}${field('proceeds','Proceeds (zero if none)',0,'number','min="0" step="0.01"')}<label class="full">What supports it? * <textarea name="evidence" required minlength="10" maxlength="500"></textarea></label>`,'Declare for approval'),
   f=>request({...payload('ledger_ppe_disposal_declare'),asset_key:key,kind:f.get('kind'),disposed_on:f.get('disposed_on'),proceeds:f.get('proceeds')||0,evidence:f.get('evidence')}),done('Declared. A Manager or Partner approves it.'));},
  async 'd-approve'(id){
   const a=data.assets.find(x=>x.disposal.draft&&x.disposal.draft.record_id===id);
   if(a&&a.disposal.draft.declared_by_me){show('Approve a disposal you declared',form('<p class="info full">You declared this. That is allowed only when you are your firm’s only Partner, and it is recorded that way.</p><label class="full"><input type="checkbox" name="sole" required> I am my firm’s only Partner.</label>','Approve'),
    f=>request({...payload('ledger_ppe_disposal_review'),record_id:id,decision:'Approved',sole_partner_approval:f.has('sole')}),done('Approved.'));return;}
   await request({...payload('ledger_ppe_disposal_review'),record_id:id,decision:'Approved'});notice('Approved.');await open();onChange?.();
  },
  'd-return'(id){show('Return the disposal',form('<label class="full">Why are you returning it? (at least 10 characters) <textarea name="review_note" required minlength="10" maxlength="500"></textarea></label>','Return'),f=>request({...payload('ledger_ppe_disposal_review'),record_id:id,decision:'Returned',review_note:f.get('review_note')}),done('Returned to the preparer.'));},
  'd-end'(key){show('End the disposal',form('<label class="full">Why? (at least 10 characters) <textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','End the disposal'),f=>request({...payload('ledger_ppe_disposal_end'),asset_key:key,reason:f.get('reason')}),done('The disposal is ended.'));}
 };
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-ppe]');if(!b)return;b.disabled=true;try{await handlers[b.dataset.ppe]?.(b.dataset.id);}catch(error){notice(error.message,true);}finally{b.disabled=false;}});
 return {open};
}
