// Client Set-up tab: an ordered checklist instead of one long block of buttons.
// Only statuses the client record can actually prove are shown (activities, VAT categories, reporting periods, stock settings,
// a change waiting for review). A step with no provable status shows no badge, so nothing looks done that is not.
const e0=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function setupSteps({r,pending=[],isLeader=false,isReviewer=false}){
 const c=r?.client||{},acts=r?.activities||[],periods=r?.periods||[],policies=r?.policies||[];
 const vat=Array.isArray(c.vat_categories_sold)&&c.vat_categories_sold.length>0;
 const steps=[
  {key:'identity',title:'Legal identity and master facts',hint:'Confirm the registration, year-end and the facts on the client record.',status:null,btns:[['identity','Confirm legal identity'],['master','Client master facts']]},
  {key:'kyc',title:'Owners, KYC and AML',hint:'Owners and contacts, then the AML profile for the MLRO.',status:null,btns:[['aml','AML / POCAMLA profile'],...(isLeader?[['aml-queue','MLRO workspace']]:[])]},
  {key:'activities',title:'Services and activities',hint:'Dated business activities and the services we provide.',status:pending.length?'waiting':acts.length?'done':'todo',statusText:pending.length?'Change waiting for review':acts.length?`${acts.length} activit${acts.length===1?'y':'ies'}`:'None yet',btns:[['activity','Activities / end dates'],...(isReviewer?[['setup','Set up a service']]:[]),['setup-review','Setup review'],...(isLeader?[['setup-queue','Review pending setup']]:[])]},
  {key:'chart',title:'Chart of accounts',hint:'The accounts this client can post to.',status:null,btns:[['chart','Client chart of accounts']]},
  {key:'vat',title:'VAT categories sold',hint:'Which VAT categories this client sells.',status:vat?'done':'todo',statusText:vat?c.vat_categories_sold.join(', '):'Not set',btns:[['vat-cats',vat?'Change VAT categories':'Set VAT categories']]},
  {key:'periods',title:'Reporting periods',hint:'Verified periods and their deadlines.',status:periods.length?'done':'todo',statusText:periods.length?`${periods.length} period${periods.length===1?'':'s'}`:'None yet',btns:[['period','Verified reporting period']]}
 ];
 if(acts.length)steps.push({key:'stock',title:'Stock settings',hint:'Stock method and count schedule per activity.',status:policies.length?'done':'todo',statusText:policies.length?`${policies.length} setting${policies.length===1?'':'s'}`:'Not set',btns:[['stock-policy',policies.length?'Change stock settings':'Set up stock'],...(isLeader?[['stock-category','Add stock category']]:[])]});
 if(c.legal_entity_type==='Partnership')steps.push({key:'partners',title:'Profit-sharing',hint:'Partner agreement windows.',status:(r?.partners||[]).length?'done':'todo',statusText:(r?.partners||[]).length?`${r.partners.length} window${r.partners.length===1?'':'s'}`:'None yet',btns:[['partners','Profit-sharing window']]});
 return steps;
}

export function setupChecklistHtml({r,id,pending=[],isLeader=false,isReviewer=false,esc=e0,button}){
 const steps=setupSteps({r,pending,isLeader,isReviewer});
 const known=steps.filter(s=>s.status),done=known.filter(s=>s.status==='done').length;
 const badge=s=>s.status?`<span class="step-status ${s.status}">${esc(s.status==='done'?'Done':s.status==='waiting'?'Waiting':'To do')}${s.statusText?' · '+esc(s.statusText):''}</span>`:'';
 const btn=([a,l],i)=>a==='stock-category'?`<button type="button" class="${i?'':'primary'}" data-accounting="client-stock-category" data-id="${esc(id)}">${esc(l)}</button>`:button(a,l,a==='setup-queue'||a==='aml-queue'?'':id);
 return `<section class="setup-checklist" aria-label="Client set-up steps"><p class="muted setup-summary"><b>${done} of ${known.length}</b> measurable steps done. Steps without a status have no automatic check yet: open them to see.</p><ol class="setup-steps">${steps.map((s,n)=>`<li class="setup-step ${esc(s.status||'')}" data-step="${esc(s.key)}"><div class="step-head"><span class="step-num" aria-hidden="true">${n+1}</span><div class="step-text"><b>${esc(s.title)}</b><small>${esc(s.hint)}</small></div>${badge(s)}</div><div class="step-actions">${s.btns.map(btn).join('')}</div></li>`).join('')}</ol></section>`;
}
