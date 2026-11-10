// Tax credit register on the tax case screen: withholding VAT, withholding income tax, instalment tax and carried-forward balances, each checked against the
// client's iTax ledger by a different person before a return can claim it. The rules live in the database (20261110273000_tax_credit_register.sql);
// this file draws the panel. It adds no figure to any computation: the amount a return claims is always a person's recorded decision.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const kes=n=>n===null||n===undefined||n===''?'—':new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n));
export const CREDIT_LABELS={WHT_VAT:'Withholding VAT credit',VAT_CARRIED_FORWARD:'VAT credit carried forward',WHT_INCOME_TAX:'Withholding income tax credit',INSTALMENT_TAX:'Instalment tax paid',INCOME_TAX_CARRIED_FORWARD:'Income tax credit carried forward'};
export const TYPES_FOR={VAT:['WHT_VAT','VAT_CARRIED_FORWARD'],INCOME_TAX:['WHT_INCOME_TAX','INSTALMENT_TAX','INCOME_TAX_CARRIED_FORWARD']};
export const STATUS_TEXT={PENDING:'Waiting for the iTax check',RECONCILED:'Agrees to iTax',DISPUTED:'Differs from iTax',MANAGER_APPROVED:'Difference approved',REJECTED:'Rejected'};
export const appliesToKind=kind=>kind==='VAT'?'VAT':['Company','Individual','Partnership'].includes(kind)?'INCOME_TAX':null;
// Which buttons a person sees on one entry. The database and server enforce the same rules; this only hides what would be refused.
export function entryActions(e,me,caseRec){
 const out=[],leader=['PARTNER','MANAGER'].includes(me?.category_code),own=e.entered_by===me?.staff_id,open=['Draft','Returned'].includes(caseRec?.status);
 if(e.claimed_in_case_id&&e.claimed_in_case_id===caseRec?.case_id&&open)out.push(['credit-release','Release from this return']);
 if(e.claimed_in_case_id)return out;
 if(['PENDING','DISPUTED'].includes(e.status)&&!own)out.push(['credit-itax',e.status==='PENDING'?'Record the iTax figure':'Record a corrected iTax figure']);
 if(e.status==='DISPUTED'&&leader&&!own)out.push(['credit-approve','Approve the difference']);
 if(['PENDING','DISPUTED'].includes(e.status)&&leader)out.push(['credit-reject','Reject']);
 if(['RECONCILED','MANAGER_APPROVED'].includes(e.status)&&open)out.push(['credit-claim','Claim in this return']);
 return out;
}
export function panelView({credits,caseRec,claimed,me,button}){
 const side=appliesToKind(caseRec?.kind);if(!side)return '';
 const rows=(credits||[]).filter(e=>e.applies_to===side&&e.status!=='REJECTED'&&e.period_start<=day(caseRec.ends_on)&&e.period_end>=day(caseRec.starts_on));
 const open=rows.filter(e=>['PENDING','DISPUTED'].includes(e.status)&&!e.claimed_in_case_id).length;
 const tbl=rows.length?`<div class="scroll"><table id="creditRegister"><thead><tr><th>Credit</th><th>Period</th><th>Reference</th><th>ERP</th><th>iTax</th><th>Status</th><th>Claimed here</th><th>Action</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(CREDIT_LABELS[e.credit_type]||e.credit_type)}</td><td>${esc(day(e.period_start))} – ${esc(day(e.period_end))}</td><td>${esc(e.source_reference)}</td><td>${kes(e.erp_amount)}</td><td>${kes(e.itax_amount)}${e.variance&&Number(e.variance)!==0?`<br><small class="warn">Difference ${kes(e.variance)}</small>`:''}</td><td><span class="badge ${['RECONCILED','MANAGER_APPROVED'].includes(e.status)?'good':e.status==='DISPUTED'?'red':'warn'}">${esc(STATUS_TEXT[e.status]||e.status)}</span>${e.decision_reason?`<br><small>${esc(e.decision_reason)}</small>`:''}</td><td>${e.claimed_in_case_id===caseRec.case_id?`<b>${kes(e.claim_amount)}</b>`:e.claimed_in_case_id?'In another return':'—'}</td><td>${entryActions(e,me,caseRec).map(([a,l])=>button(a,l,e.credit_id)).join(' ')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No credits recorded for this period yet.</p>';
 const total=(claimed||[]).map(c=>`${esc(CREDIT_LABELS[c.credit_type]||c.credit_type)}: <b>${kes(c.claim_total)}</b> (${c.entries})`).join(' · ');
 return `<section class="card section-space" id="creditPanel"><div class="section-head"><h3>Tax credits${side==='VAT'?' (VAT)':' (income tax)'}</h3>${button('credit-add','+ Add a credit',caseRec.project_id)}</div><p class="muted">Each credit is checked against the client's iTax ledger by a different person. A credit can be claimed only when the two figures agree, or a Manager or Partner has approved the difference with a reason. A credit is claimed once, and only in a return of its own tax.</p>${open?`<p class="warn"><b>${open}</b> credit ${open===1?'entry needs':'entries need'} the iTax check or a decision before this return can be submitted.</p>`:''}${total?`<p>Claimed in this return — ${total}</p>`:''}${tbl}</section>`;
}
export function createCreditUI(ctx){
 const {field,select,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 let cur=null,list=[];
 // The panel for one tax case; returns '' for kinds that have no credits or when the register cannot be read.
 async function panel(caseRec,claimed){
  if(!appliesToKind(caseRec.kind)||d().me.category_code==='INTERN')return '';
  try{const r=await request({action:'tax_credit_list',project_id:caseRec.project_id});list=r.credits;cur=caseRec;}catch{return '';}
  return panelView({credits:list,caseRec,claimed,me:d().me,button});
 }
 const back=()=>ctx.openTax&&cur?ctx.openTax(cur.case_id):undefined;
 async function handle(action,id){
  if(!action.startsWith('credit-'))return false;
  const e=list.find(x=>x.credit_id===id);
  if(action==='credit-add'){
   const side=appliesToKind(cur.kind),docs=d().documents.filter(x=>x.project_id===cur.project_id).map(x=>[x.document_id,x.file_name]);
   modal('Add a tax credit',form(select('credit_type','Kind of credit *',TYPES_FOR[side].map(t=>[t,CREDIT_LABELS[t]]))+field('period_start','Period the credit arises in: from *',String(cur.starts_on).slice(0,10),'date','required')+field('period_end','to *',String(cur.ends_on).slice(0,10),'date','required')+field('source_reference','Certificate, receipt or payment reference *','')+select('source_document_id','Supporting document',docs,'')+field('erp_amount','Amount recorded in the ERP *','','number','required min="0" step="0.01"')+'<p class="info full">A different person then checks the client\'s iTax ledger. Nothing is added to the computation until the credit is claimed in a return.</p>','Add credit'),
    f=>request({action:'tax_credit_add',project_id:cur.project_id,credit_type:f.get('credit_type'),period_start:f.get('period_start'),period_end:f.get('period_end'),source_reference:f.get('source_reference'),source_document_id:f.get('source_document_id')||null,erp_amount:f.get('erp_amount')}),back);
   return true;
  }
  if(!e)return true;
  if(action==='credit-itax'){
   const docs=d().documents.filter(x=>x.project_id===e.project_id).map(x=>[x.document_id,x.file_name]);
   modal('Record the iTax figure',form(`<p class="full">${esc(CREDIT_LABELS[e.credit_type])} · ${esc(e.source_reference)} · ERP ${kes(e.erp_amount)}</p>`+field('itax_amount','Amount shown on the client\'s iTax ledger *','','number','required min="0" step="0.01"')+select('itax_document_id','Screenshot or extract of the iTax ledger',docs,'')+'<p class="info full">You cannot check a credit you entered. If the figures agree the credit is ready to claim; if not, a Manager or Partner decides.</p>','Record'),
    f=>request({action:'tax_credit_itax',credit_id:id,revision:e.revision,itax_amount:f.get('itax_amount'),itax_document_id:f.get('itax_document_id')||null}),back);
   return true;
  }
  if(action==='credit-approve'){
   modal('Approve the difference',form(`<p class="full">ERP ${kes(e.erp_amount)} · iTax ${kes(e.itax_amount)} · difference ${kes(e.variance)}</p>`+field('claim_amount','Amount that may be claimed *',String(e.itax_amount),'number','required min="0" step="0.01"')+area('reason','Why the difference is accepted and which amount may be claimed *','',true),'Approve'),
    f=>request({action:'tax_credit_approve',credit_id:id,revision:e.revision,claim_amount:f.get('claim_amount'),reason:f.get('reason')}),back);
   return true;
  }
  if(action==='credit-reject'){
   modal('Reject this credit entry',form(`<p class="full">${esc(CREDIT_LABELS[e.credit_type])} · ${esc(e.source_reference)}</p>`+area('reason','Why is this entry rejected? *','',true),'Reject'),f=>request({action:'tax_credit_reject',credit_id:id,revision:e.revision,reason:f.get('reason')}),back);
   return true;
  }
  if(action==='credit-claim'){await request({action:'tax_credit_claim',credit_id:id,revision:e.revision,case_id:cur.case_id});await back();return true;}
  if(action==='credit-release'){await request({action:'tax_credit_release',credit_id:id,revision:e.revision});await back();return true;}
  return false;
 }
 return {panel,handle};
}

// Numbered computation snapshots (20261110274000_computation_snapshots.sql): what the reviewer was shown when the return was submitted and when it was locked.
export const RULES_TEXT={CONFIRMED:'Rates confirmed by the Tax Lead',UNCONFIRMED:'Rates not confirmed - cannot be filed',TESTING:'Test rates - not for filing'};
export function snapshotsView({snapshots,staffName}){
 if(!snapshots||!snapshots.length)return '<section class="card section-space" id="snapshotPanel"><h3>Computation snapshots</h3><p class="muted">A snapshot is recorded when the return is submitted and again when it is locked. None yet.</p></section>';
 const totals=t=>(t||[]).map(x=>`${esc(x.dataset)}: ${esc(x.rows)} rows, net ${kes(x.net)}, VAT ${kes(x.vat)}`).join('<br>')||'—';
 return `<section class="card section-space" id="snapshotPanel"><h3>Computation snapshots</h3><p class="muted">Recorded automatically and never changed. A return cannot be locked if its source rows differ from the last submission.</p><div class="scroll"><table><thead><tr><th>No.</th><th>Stage</th><th>Recorded</th><th>By</th><th>Source rows</th><th>Source totals</th><th>Rates and rules</th><th>Fingerprint</th></tr></thead><tbody>${snapshots.map(x=>`<tr><td>${esc(x.snapshot_no)}</td><td>${x.stage==='LOCKED'?'Locked':'Submitted'}</td><td>${esc(day(x.taken_at))}</td><td>${esc(staffName?staffName(x.taken_by):x.taken_by)}</td><td>${esc(x.source_row_count)}</td><td><small>${totals(x.source_totals)}</small></td><td><span class="badge ${x.rules_status==='CONFIRMED'?'good':x.rules_status==='TESTING'?'warn':'red'}">${esc(RULES_TEXT[x.rules_status]||x.rules_status)}</span></td><td><code>${esc(String(x.source_hash||'').slice(0,12))}</code></td></tr>`).join('')}</tbody></table></div></section>`;
}
