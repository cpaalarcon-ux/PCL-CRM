import {guideBanner,GUIDE} from './staff-guide-text.mjs?v=20261106-autofee-v1';
// Withholding schedule: tax withheld on payments for one month. Purchase rows marked on the purchases screen appear here automatically;
// payments that are not purchases (dividends, interest, royalties, rent to non-residents and similar) are added here. The withholding
// return and the monthly journal read this list only.
export function createWithholdingUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,shortDate,projectName}=ctx;
 const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
 const button=(action,label,id='',extra='')=>`<button type="button" data-wht="${action}" data-id="${esc(id)}" ${extra}>${esc(label)}</button>`;
 const table=(heads,rows)=>`<div class="scroll purchase-ledger-scroll"><table><thead><tr>${heads.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c??''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const lastDay=m=>new Date(Date.UTC(Number(m.slice(0,4)),Number(m.slice(5,7)),0)).toISOString().slice(0,10);
 let pid='',month='',data=null,periods=[];
 const show=(title,html,save,done)=>{if($('#editor').open)$('#editor').close();modal(title,html,save,done);$('#editor').classList.add('mapping-workspace');};
 async function open(id,m){
  pid=id;month=m||month||new Date().toISOString().slice(0,7);
  const [info,listing]=await Promise.all([request({action:'wht_list',project_id:pid,from:month+'-01',to:lastDay(month)}),request({action:'period_import_list',project_id:pid})]);
  data=info;periods=listing.periods||[];
  const testing=info.lines.some(l=>l.rate_status==='Testing');
  const body=guideBanner('How the withholding schedule works',GUIDE.withholding,esc,{open:false})
   +`<p><b>${esc(projectName(pid))}</b> · ${esc(month)}</p><div class="filters">${field('wht_month','Month',month,'month')}<button type="button" data-wht="load">Show month</button></div>`
   +(testing?'<p class="info">Some lines use testing rates. They need formal approval before the return is filed.</p>':'')
   +`<p>${info.totals.lines} line${info.totals.lines===1?'':'s'} · Subject to withholding ${money(info.totals.taxable_amount)} · <b>Tax withheld ${money(info.totals.tax_withheld)}</b> · ${info.totals.uncertificated} without a certificate · ${info.totals.unjournalled} not in a journal</p>`
   +(info.period_open?'':'<p class="missing">This month’s withholding return is submitted or locked. Return it before changing lines.</p>')
   +`<div class="actions">${button('add','Add a payment that is not a purchase',pid,info.period_open?'':'disabled')}${button('journal','Create the month’s journal',pid,info.totals.unjournalled&&info.period_open?'':'disabled')}<button type="button" data-purchase-ledger="${pid}">Purchase ledgers</button></div>`
   +(info.groups.length?`<h3>By payment category</h3>`+table(['Category','Lines','Subject to withholding','Rate','Tax withheld'],info.groups.map(g=>[esc(g.payment_label),g.lines,money(g.taxable_amount),g.rate+'%',money(g.tax_withheld)])):'<p class="muted">No withholding recorded for this month. On the purchases screen, tick professional or contractual fee rows and choose Withhold tax. Add other payments here.</p>')
   +(info.lines.length?`<h3>Lines</h3>`+table(['Payee / PIN','Payment date','Category','Subject to withholding','Rate','Tax withheld','Source','Certificate','Journal',''],info.lines.map(l=>[esc(l.payee_name)+`<small>${esc(l.payee_pin||'No PIN')} · ${esc(l.payee_residency)}</small>`,shortDate(l.payment_date),esc(l.payment_label)+(l.rate_status==='Testing'?'<small>Testing rate</small>':''),money(l.taxable_amount),l.rate+'%',money(l.tax_withheld),esc(l.source)+`<small>${esc(l.invoice_reference||'')} ${esc(l.evidence_reference)}</small>`,`<label><input type="checkbox" data-wht-cert="${l.line_id}" ${l.certificate_issued?'checked':''}> Issued</label>`,l.journal_id?'In journal':'Not yet',l.journal_id?'':button('void','Remove',l.line_id)])):'');
  show('Withholding schedule',body);
  const monthInput=$('#editorBody [name=wht_month]');if(monthInput)monthInput.value=month;
  document.querySelectorAll('#editorBody [data-wht-cert]').forEach(c=>c.onchange=async()=>{c.disabled=true;try{await request({action:'wht_certificate',project_id:pid,line_id:c.dataset.whtCert,issued:c.checked});await open(pid,month);}catch(e){notice(e.message,true);c.disabled=false;}});
 }
 function addForm(){
  const rates=(data.rates||[]).map(x=>[x.rate_key,x.label+' · '+x.rate+'%'+(x.status==='Testing'?' (testing rate)':'')]),accounts=(data.accounts||[]).map(x=>[x.code,x.code+' · '+x.name]);
  show('Add a payment with tax withheld',form(`<p class="full">For payments that are not on the purchases screen: dividends, interest, royalties, rent to non-residents and similar. Choose the account that was owed to the payee, such as dividends payable. The journal debits it and credits withholding income tax payable.</p>`
   +field('payee_name','Payee name *','','text','required maxlength="200"')+field('payee_pin','Payee KRA PIN','','text','maxlength="20"')
   +select('payee_residency','Payee residence *',['Resident','Non-resident'],'Resident')+field('payment_date','Payment date *',month+'-'+String(Math.min(new Date().getDate(),28)).padStart(2,'0'),'date','required')
   +select('payment_code','Payment category *',rates,'','Choose category')+field('taxable_amount','Amount subject to withholding *','','number','required min="0.01" step="0.01"')
   +select('counter_account','Account to debit *',accounts,'','Choose account')+field('invoice_reference','Invoice or document number','','text','maxlength="100"')
   +field('evidence_reference','Evidence: contract, payment advice or board minute *','','text','required maxlength="500"')
   +`<label class="full"><input type="checkbox" name="eligibility_confirmed" required> I confirmed the payee’s residence, the threshold and any exemption or treaty relief.</label>`,'Record payment'),
   f=>request({action:'wht_line_add',project_id:pid,payee_name:f.get('payee_name'),payee_pin:f.get('payee_pin'),payee_residency:f.get('payee_residency'),payment_date:f.get('payment_date'),payment_code:f.get('payment_code'),taxable_amount:f.get('taxable_amount'),counter_account:f.get('counter_account'),invoice_reference:f.get('invoice_reference'),evidence_reference:f.get('evidence_reference'),eligibility_confirmed:f.has('eligibility_confirmed')}),
   async r=>{notice(`Recorded. Tax withheld ${money(r.tax_withheld)} at ${r.rate}%.`);await open(pid,month);});
 }
 function voidForm(lineId){
  show('Remove a withholding line',form('<label class="full">Reason for removing this line * <textarea name="reason" required minlength="10" maxlength="1000"></textarea></label>','Remove line'),f=>request({action:'wht_line_void',project_id:pid,line_id:lineId,reason:f.get('reason')}),async()=>{notice('Line removed.');await open(pid,month);});
 }
 function journalForm(){
  const at=lastDay(month),period=periods.find(x=>String(x.starts_on).slice(0,10)<=at&&String(x.ends_on).slice(0,10)>=at);
  if(!period)throw Error('Create the client’s accounting year in Client accounting & profit first.');
  show('Create the withholding journal',form(`<p class="full">${data.totals.unjournalled} line${data.totals.unjournalled===1?'':'s'} for ${esc(month)}: debit the amounts owed to the payees, credit withholding income tax payable ${money(data.lines.filter(l=>!l.journal_id).reduce((s,l)=>s+l.tax_withheld,0))}. A different Manager or Partner reviews and posts it in Client accounting & profit.</p>`,'Create draft journal'),()=>request({action:'ledger_withholding_create',project_id:pid,period_id:period.period_id,month:month+'-01'}),async r=>{notice('Draft journal created. Open Client accounting & profit → Entry register to review and post.');await open(pid,month);});
 }
 document.addEventListener('click',async e=>{const b=e.target.closest('[data-wht]');if(!b)return;b.disabled=true;
  try{const a=b.dataset.wht;
   if(a==='open')await open(b.dataset.id);
   else if(a==='load'){const m=$('#editorBody [name=wht_month]')?.value;if(m)await open(pid,m);}
   else if(a==='add')addForm();
   else if(a==='void')voidForm(b.dataset.id);
   else if(a==='journal')journalForm();
  }catch(error){notice(error.message,true);}finally{b.disabled=false;}
 });
 return {open};
}
