// Excise schedule screen (build 2794), opened from a client's tax profile. The person picks the month, picks each excise rule from a list and types only the
// quantity sold (or the value of sales) and the dates. The product code, unit and rate are read from the rule by the server, which works the duty out itself.
// The schedule feeds no return or filing. A rule used for staging tests, or still waiting for the Tax Lead, marks it TESTING - NOT FOR FILING.
const esc0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const money=v=>Number(v||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const monthBounds=ym=>{const [y,m]=String(ym).split('-').map(Number);if(!y||!m)return null;return {starts_on:`${ym}-01`,ends_on:`${ym}-${String(new Date(Date.UTC(y,m,0)).getUTCDate()).padStart(2,'0')}`};};
export const previousMonth=iso=>{const d=new Date(String(iso).slice(0,7)+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
export const EXCISE_NOTE='A working for review only. It feeds no return or filing. Enter the quantity sold (or the value of sales) for each excise product; the product code, unit and rate come from the dated excise rule. A different Manager or Partner reviews it.';

// The result as the person sees it: the testing banner first, then anything to fix, then the lines.
export function resultView(result,{esc=esc0,table}){
 if(!result)return '';
 const banner=result.not_for_filing?`<p class="info full"><b>TESTING — NOT FOR FILING.</b> This working uses a rule that is approved for staging tests only, or that is still waiting for the Tax Lead's written confirmation.</p>`:'';
 const notices=(result.notices||[]).filter(n=>!/^TESTING - NOT FOR FILING/.test(n));
 const issues=(result.issues||[]).length?`<div class="info full error"><b>To fix before review</b><ul>${result.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`:'';
 const rows=(result.lines||[]).map(l=>[`${esc(l.label||l.rate_key)}<small>${esc(l.rate_key)}${l.product_code?' · '+esc(l.product_code):''}</small>`,esc(l.from===l.to?day(l.from):day(l.from)+' – '+day(l.to)),l.basis==='Amount per unit'?`${esc(l.quantity??'')} ${esc(l.unit||'')} × KES ${money(l.rate_per_unit)}`:l.basis==='Percentage of value'?`KES ${money(l.value)} × ${esc(l.rate)}%`:'—',l.duty==null?'—':'KES '+money(l.duty)]);
 return `${banner}${notices.length?`<ul class="muted">${notices.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:''}${issues}${table(['Rule','Sold','Working','Duty'],rows)}<p><b>Total excise duty: KES ${money(result.total_duty)}</b></p>`;
}

export function createExciseScheduleUI(ctx){
 const {$,esc,field,select,form,modal,request,shortDate,badge,table,button,area,check,today}=ctx,d=()=>ctx.data(),s=()=>d().suite;
 const leader=()=>['PARTNER','MANAGER'].includes(d().me.category_code);
 let cid=null,rows=[],seq=0,prev=null,editing=null;
 // One entry per excise rule: the version with figures that ends last, else the last version. Used only to show the right box; the server decides.
 const ruleList=()=>{const m=new Map();for(const r of [...(s().rates||[])].filter(x=>x.tax_type==='Excise duty').sort((a,b)=>day(a.effective_to).localeCompare(day(b.effective_to)))){const old=m.get(r.rate_key);if(!old||Object.keys(r.parameters||{}).length||!Object.keys(old.parameters||{}).length)m.set(r.rate_key,r);}return [...m.values()].map(r=>({key:r.rate_key,label:String(r.label||r.rate_key).replace(/\s*\(rate pending\)\s*$/i,''),parameters:r.parameters||{}}));};
 const ruleOf=k=>ruleList().find(x=>x.key===k);
 const amountBox=(key,i,l={})=>{const p=ruleOf(key)?.parameters||{};
  if(p.excise_basis==='Amount per unit')return field('qty_'+i,`Quantity sold (${p.unit})`,l.quantity??'','number','min="0" step="0.001" required');
  if(p.excise_basis==='Percentage of value')return field('val_'+i,'Value of sales KES',l.value??'','number','min="0" step="0.01" required');
  return `<small class="muted">${key?'This rule has no figures yet, so nothing can be worked out.':'Choose the rule to see what to enter.'}</small>`;};
 const row=(l,i,b)=>`<div class="filters" data-xrow="${i}">${select('x_rule_'+i,'Excise rule *',ruleList().map(x=>[x.key,x.label+' · '+x.key]),l.rate_key||'').replace('<select','<select required')}<span data-amt="${i}">${amountBox(l.rate_key,i,l)}</span>${field('x_from_'+i,'Sold from *',day(l.from)||b.starts_on,'date','required')}${field('x_to_'+i,'Sold through *',day(l.to)||b.ends_on,'date','required')}${field('x_note_'+i,'Note (optional)',l.note||'','text','maxlength="200"')}${button('xsched-line-remove','Remove',String(i))}</div>`;
 const F=()=>$('#editForm');
 const who=(id,name)=>name||(d().staff||[]).find(x=>x.staff_id===id)?.full_name||'';
 const readLines=f=>[...f.querySelectorAll('[data-xrow]')].map(r=>{const i=r.dataset.xrow,e=f.elements;return {rate_key:e['x_rule_'+i].value,from:e['x_from_'+i].value,to:e['x_to_'+i].value,note:e['x_note_'+i].value,quantity:e['qty_'+i]?.value??'',value:e['val_'+i]?.value??''};});
 const body=f=>{const b=monthBounds(f.elements.month.value);if(!b)throw Error('Choose the month.');return {client_id:cid,...b,lines:readLines(f)};};

 async function list(clientId){
  cid=clientId||cid;const r=await request({action:'excise_schedule_read',client_id:cid});rows=r.schedules||[];
  const c=(d().clients||[]).find(x=>x.client_id===cid)||{};
  modal('Excise schedules · '+(c.company_name||''),`<p class="info">${esc(EXCISE_NOTE)}</p><p>${button('xsched-new','+ New monthly schedule',cid)}</p>${table(['Month','Duty KES','Rules','Status','Prepared by',''],rows.map(x=>[esc(day(x.starts_on).slice(0,7)),money(x.total_duty),esc(x.rules_status==='TESTING'?'Testing':x.rules_status==='CONFIRMED'?'Confirmed':'Unconfirmed'),badge(x.status),esc(who(x.created_by,x.prepared_by_name)),button('xsched-view','Open',x.schedule_id)]))}`);
 }
 function edit(schedule){
  editing=schedule||null;const m=schedule?day(schedule.starts_on).slice(0,7):previousMonth(today()),b=monthBounds(m);prev=b;seq=0;
  const lines=(schedule?.inputs||[{}]);
  modal(schedule?'Edit draft excise schedule':'New excise schedule',form(`<p class="info full">${esc(EXCISE_NOTE)}</p>`+field('month','Month *',m,'month',(schedule?'readonly ':'')+'required')+`<div id="exciseLines" class="full">${lines.map(l=>row(l,seq++,b)).join('')}</div>${button('xsched-line-add','+ Add another product')}${button('xsched-preview','Calculate duty')}<div id="excisePreview" class="full" aria-live="polite"></div>`,'Save draft schedule'),async f=>{await request({action:'excise_schedule_save',schedule_id:editing?.schedule_id,revision:editing?.revision,...body(F())});},()=>list(cid));
  const f=F();
  f.addEventListener('change',e=>{
   if(e.target.name?.startsWith('x_rule_')){const i=e.target.name.slice(7);f.querySelector(`[data-amt="${i}"]`).innerHTML=amountBox(e.target.value,i);}
   if(e.target.name==='month'){const b2=monthBounds(e.target.value);if(!b2)return;for(const r of f.querySelectorAll('[data-xrow]')){const i=r.dataset.xrow,fr=f.elements['x_from_'+i],to=f.elements['x_to_'+i];if(fr.value===prev.starts_on)fr.value=b2.starts_on;if(to.value===prev.ends_on)to.value=b2.ends_on;}prev=b2;}
  });
 }
 function view(id){
  const x=rows.find(r=>r.schedule_id===id);if(!x)return;
  const me=d().me,mine=String(x.created_by)===String(me.staff_id);
  modal('Excise schedule · '+day(x.starts_on).slice(0,7),`<p>${badge(x.status)} · Prepared by ${esc(who(x.created_by,x.prepared_by_name))} on ${shortDate(x.created_at)}${x.reviewed_at?` · Reviewed by ${esc(who(x.reviewed_by,x.reviewed_by_name))} on ${shortDate(x.reviewed_at)}: ${esc(x.review_note||'')}`:''}${x.status==='Withdrawn'?` · Withdrawn: ${esc(x.withdrawn_reason||'')}`:''}</p>${resultView(x.result,{esc,table})}<p>${x.status==='Draft'?button('xsched-edit','Edit',id):''}${x.status==='Draft'&&leader()&&!mine?button('xsched-review','Review',id):''}${x.status==='Draft'&&mine?'<small class="muted">A different Manager or Partner must review this schedule.</small>':''}${leader()&&x.status!=='Withdrawn'?button('xsched-withdraw','Withdraw',id):''}${button('xsched-list','Back to schedules',cid)}</p>`);
 }
 async function handle(action,id){
  if(!action.startsWith('xsched-'))return false;
  if(action==='xsched-schedule'||action==='xsched-list'){await list(id);return true;}
  if(action==='xsched-new'){cid=id||cid;edit(null);return true;}
  if(action==='xsched-edit'){edit(rows.find(r=>r.schedule_id===id));return true;}
  if(action==='xsched-view'){view(id);return true;}
  if(action==='xsched-line-add'){const f=F(),b=monthBounds(f.elements.month.value)||prev;$('#exciseLines').insertAdjacentHTML('beforeend',row({},seq++,b));return true;}
  if(action==='xsched-line-remove'){F().querySelector(`[data-xrow="${id}"]`)?.remove();return true;}
  if(action==='xsched-preview'){const box=$('#excisePreview');box.textContent='Working it out…';try{const r=await request({action:'excise_schedule_preview',...body(F())});box.innerHTML=resultView(r.result,{esc,table});}catch(e){box.innerHTML=`<p class="error">${esc(e.message)}</p>`;}return true;}
  if(action==='xsched-review'){const x=rows.find(r=>r.schedule_id===id);modal('Review excise schedule',form(`<p class="info full">Check the quantities or values against the client's sales records. You cannot review a schedule you prepared.</p>`+area('review_note','What you checked *','',true)+check('confirmed','The quantities or values agree to the sales records',false),'Mark as reviewed'),async f=>{await request({action:'excise_schedule_review',schedule_id:id,revision:x.revision,review_note:f.get('review_note'),confirmed:f.has('confirmed')});},()=>list(cid));return true;}
  if(action==='xsched-withdraw'){const x=rows.find(r=>r.schedule_id===id);modal('Withdraw excise schedule',form(`<p class="info full">A withdrawn schedule is kept for the record and no longer counts. You can then prepare a new one for the month.</p>`+area('reason','Reason for withdrawing *','',true),'Withdraw schedule'),async f=>{await request({action:'excise_schedule_withdraw',schedule_id:id,revision:x.revision,reason:f.get('reason')});},()=>list(cid));return true;}
  return false;
 }
 return {handle,list};
}
