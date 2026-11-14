// Monthly bank totals (build 2799), opened from Client accounting > Banks. The firm's five-bank workbook (sheet BANK INPUTS) is chosen from the client's
// uploaded files and read as it is. The server reads the file and works every figure out; this screen only shows the result. It feeds no ledger entry, return
// or statement line. A different Manager or Partner confirms a saved draft; a confirmed batch is withdrawn with a reason, never edited.
export const BANK_TOTALS_NOTE='A review working for the client\'s five-bank workbook (sheet BANK INPUTS). It shows statement credits, bank charges and finance costs by bank and month, and the non-trade credits, bounced cheques and trade receipt corrections that adjust the credits to trade collections. It posts nothing and feeds no return. The workbook\'s own reviewer names and Approved status are not accepted: a different Manager or Partner confirms it here.';
export const kes=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function resultView(result,{esc=e0,table}){
 if(!result)return '';
 const issues=(result.issues||[]).length?`<div class="info full error"><b>To fix in the workbook before saving</b><ul>${result.issues.slice(0,30).map(i=>`<li>${esc(i)}</li>`).join('')}</ul>${result.issues.length>30?`<p class="muted">${result.issues.length-30} more.</p>`:''}</div>`:'';
 const warns=(result.warnings||[]).length?`<div class="info full"><b>Check</b><ul>${result.warnings.slice(0,20).map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'';
 const t=result.totals||{};
 const months=table(['Month','Statement credits','Non-trade credits','Bounced cheques','Receipt corrections','Adjusted trade collections','Finance costs'],[...(result.by_month||[]).map(m=>[esc(m.month),kes(m.credits),kes(m.non_trade),kes(m.bounced),kes(m.correction),kes(m.adjusted_trade),kes(m.finance_costs)]),['<b>Total</b>',...['credits','non_trade','bounced','correction','adjusted_trade','finance_costs'].map(k=>'<b>'+kes(t[k])+'</b>')]]);
 const kinds=Object.entries(result.by_kind||{});
 const links=(result.links||[]).length?table(['Workbook bank','Last four','Registered bank'],result.links.map(l=>[esc(l.code+' '+l.name),esc(l.last4||''),l.bank_account_id?esc(l.erp_name):'<span class="muted">Not matched</span>'])):'';
 return `${issues}${warns}<h4>By month, all banks</h4>${months}${kinds.length?`<h4>Non-trade credits by kind</h4>${table(['Kind','Amount'],kinds.map(([k,v])=>[esc(k),kes(v)]))}`:''}${links?`<h4>Banks</h4>${links}`:''}`;
}
export function createBankTotalsUI(ctx){
 const {$,esc,field,select,form,modal,request,shortDate,table,notice}=ctx,d=()=>ctx.data();
 const leader=()=>['PARTNER','MANAGER'].includes(d().me.category_code);
 let cid='';
 const status=b=>`<span class="badge ${b.status==='Confirmed'?'good':b.status==='Draft'?'warn':''}">${esc(b.status)}</span>`;
 const raw=(name,label,type='text')=>`<label class="full">${esc(label)}<textarea name="${name}" maxlength="500" required minlength="10"></textarea></label>`;
 async function open(clientId){cid=clientId;paint(await request({action:'bank_totals_read',client_id:cid}));}
 function paint(r){
  const mine=d().me.staff_id,rows=(r.batches||[]).map(b=>{
   const acts=[b.status==='Draft'&&leader()&&b.created_by!==mine?`<button type="button" data-bt="confirm" data-id="${esc(b.batch_id)}" data-rev="${esc(b.revision)}">Confirm</button>`:'',b.status!=='Withdrawn'&&leader()?`<button type="button" data-bt="withdraw" data-id="${esc(b.batch_id)}" data-rev="${esc(b.revision)}">Withdraw</button>`:'',`<button type="button" data-bt="view" data-id="${esc(b.batch_id)}">Open</button>`].join(' ');
   return [esc(String(b.starts_on).slice(0,4)),status(b),esc(b.file_name||''),esc((b.prepared_by_name||'')+' · '+shortDate(b.created_at)),esc(b.confirmed_by_name?b.confirmed_by_name+' · '+shortDate(b.confirmed_at):b.status==='Withdrawn'?'Withdrawn: '+(b.withdrawn_reason||''):''),acts];});
  modal('Monthly bank totals (workbook)',form(`<p class="info full">${esc(BANK_TOTALS_NOTE)}</p>${rows.length?table(['Year','Status','Workbook','Prepared','Confirmed',''],rows):'<p class="muted full">No bank totals have been saved for this client.</p>'}`+
   ((r.documents||[]).length?select('document_id','Workbook to read *',r.documents.map(x=>[x.document_id,x.file_name]),'','Choose the workbook')+'<p class="muted full">Upload the five-bank workbook under Documents first, linked to one of the client\'s engagements. It is read exactly as it is.</p>':'<p class="info full">No Excel files are filed for this client yet. Upload the five-bank workbook under Documents, linked to an engagement.</p>'),'Check workbook'),
   async f=>{if(!f.get('document_id'))throw Error('Choose the workbook.');const x=await request({action:'bank_totals_preview',client_id:cid,document_id:f.get('document_id')});return {x,document_id:f.get('document_id')};},
   ({x,document_id})=>preview(x,document_id),{refreshWorkspace:false,pendingLabel:'Reading the workbook…',pendingMessage:'Checking every row. Nothing is saved yet.',successMessage:'Checked — not saved.'});
  const body=$('#editorBody');if(body)body.onclick=async ev=>{const b=ev.target.closest('[data-bt]');if(!b)return;const id=b.dataset.id,rev=b.dataset.rev;
   try{
    if(b.dataset.bt==='confirm')modal('Confirm bank totals',form(`<p class="info full">You did not prepare this. Confirm only after checking the totals against the bank statements.</p>${raw('confirm_note','What did you check? *')}<label class="full"><input type="checkbox" name="agrees" required> The totals agree to the bank statements.</label>`,'Confirm'),f=>request({action:'bank_totals_confirm',client_id:cid,batch_id:id,revision:rev,confirm_note:f.get('confirm_note'),agrees:f.has('agrees')}),()=>open(cid));
    else if(b.dataset.bt==='withdraw')modal('Withdraw bank totals',form(`<p class="info full">The batch is kept in the history. Upload the corrected workbook afterwards.</p>${raw('reason','Why is it withdrawn? *')}`,'Withdraw'),f=>request({action:'bank_totals_withdraw',client_id:cid,batch_id:id,revision:rev,reason:f.get('reason')}),()=>open(cid));
    else{const batch=(r.batches||[]).find(x=>x.batch_id===id);modal('Bank totals '+String(batch?.starts_on||'').slice(0,4),`<p>${status(batch||{status:''})} ${esc(batch?.file_name||'')}</p>${resultView(batch?.result,{esc,table})}`);}
   }catch(err){notice(err.message,true);}
  };
 }
 function preview(x,document_id){
  modal('Bank totals for '+x.year,form(`<p class="full"><b>${esc(x.file_name||'')}</b> · sheet ${esc(x.sheet)} · financial year ${esc(x.year)}</p>${resultView(x.result,{esc,table})}${x.blocked?'':'<p class="muted full">Saving makes a draft. A different Manager or Partner confirms it. Saving again for the same year replaces the draft.</p>'}`,x.blocked?'Close':'Save as draft'),
   async()=>{if(x.blocked)throw Error('Correct the listed rows in the workbook and check it again.');return await request({action:'bank_totals_save',client_id:cid,document_id});},()=>open(cid),{refreshWorkspace:false});
 }
 return {open};
}
