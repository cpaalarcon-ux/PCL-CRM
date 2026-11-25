// Client Set-up tab: an ordered checklist instead of one long block of buttons.
// Only statuses the client record can actually prove are shown (activities, VAT categories, reporting periods, stock settings,
// a change waiting for review). A step with no provable status shows no badge, so nothing looks done that is not.
const e0=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Four phases. Each phase groups the parts that belong together; a part shows a status only when the record proves it.
// A phase badge is shown only when every part in it can be measured. Phase 4 exists only for partnerships.
export function setupPhases({r,pending=[],isLeader=false,isReviewer=false}){
 const c=r?.client||{},acts=r?.activities||[],periods=r?.periods||[],policies=r?.policies||[],partners=r?.partners||[];
 const vat=Array.isArray(c.vat_categories_sold)&&c.vat_categories_sold.length>0;
 const part=(key,title,status,statusText,btns)=>({key,title,status,statusText,btns});
 const phases=[
  {key:'identity',title:'Company identity and KYC',hint:'Legal details, owners and the AML profile for the MLRO.',parts:[
   part('identity','Legal identity and master facts',null,'',[['identity','Confirm legal identity'],['master','Client master facts']]),
   part('kyc','Owners, KYC and AML',null,'',[['aml','AML / POCAMLA profile'],...(isLeader?[['aml-queue','MLRO workspace']]:[])])]},
  {key:'operations',title:'Operations and tax profile',hint:'What the client does, which VAT categories it sells, and stock.',parts:[
   part('activities','Services and activities',pending.length?'waiting':acts.length?'done':'todo',pending.length?'Change waiting for review':acts.length?`${acts.length} activit${acts.length===1?'y':'ies'}`:'None yet',[['activity','Activities / end dates'],...(isReviewer?[['setup','Set up a service']]:[]),['setup-review','Setup review'],...(isLeader?[['setup-queue','Review pending setup']]:[])]),
   part('vat','VAT categories sold',vat?'done':'todo',vat?c.vat_categories_sold.join(', '):'Not set',[['vat-cats',vat?'Change VAT categories':'Set VAT categories']]),
   ...(acts.length?[part('stock','Stock settings',policies.length?'done':'todo',policies.length?`${policies.length} setting${policies.length===1?'':'s'}`:'Not set',[['stock-policy',policies.length?'Change stock settings':'Set up stock'],...(isLeader?[['stock-category','Add stock category']]:[])])]:[])]},
  {key:'financials',title:'Financial configuration',hint:'The chart of accounts and the verified reporting periods.',parts:[
   part('chart','Chart of accounts',null,'',[['chart','Client chart of accounts']]),
   part('periods','Reporting periods',periods.length?'done':'todo',periods.length?`${periods.length} period${periods.length===1?'':'s'}`:'None yet',[['period','Verified reporting period']])]}
 ];
 if(c.legal_entity_type==='Partnership')phases.push({key:'profit',title:'Partner profit sharing',hint:'How profit is shared among the partners. Applies to partnerships only.',parts:[
  part('partners','Profit-sharing windows',partners.length?'done':'todo',partners.length?`${partners.length} window${partners.length===1?'':'s'}`:'None yet',[['partners','Profit-sharing window']])]});
 for(const ph of phases){
  const known=ph.parts.filter(x=>x.status),all=ph.parts.length===known.length&&known.length>0;
  ph.status=!all?null:known.some(x=>x.status==='waiting')?'waiting':known.every(x=>x.status==='done')?'done':'todo';
 }
 return phases;
}
export const setupSteps=o=>setupPhases(o).flatMap(p=>p.parts);

export function setupChecklistHtml({r,id,pending=[],isLeader=false,isReviewer=false,esc=e0,button}){
 const phases=setupPhases({r,pending,isLeader,isReviewer});
 const parts=phases.flatMap(p=>p.parts),known=parts.filter(s=>s.status),done=known.filter(s=>s.status==='done').length;
 const label=st=>st==='done'?'Done':st==='waiting'?'Waiting':'To do';
 const badge=(s,t)=>s.status?`<span class="step-status ${s.status}">${label(s.status)}${t&&s.statusText?' · '+esc(s.statusText):''}</span>`:'';
 const btn=([a,l],i)=>a==='stock-category'?`<button type="button" class="${i?'':'primary'}" data-accounting="client-stock-category" data-id="${esc(id)}">${esc(l)}</button>`:button(a,l,a==='setup-queue'||a==='aml-queue'?'':id);
 const partHtml=s=>`<div class="setup-part ${esc(s.status||'')}" data-step="${esc(s.key)}"><div class="part-head"><b>${esc(s.title)}</b>${badge(s,true)}</div><div class="step-actions">${s.btns.map(btn).join('')}</div></div>`;
 return `<section class="setup-checklist" aria-label="Client set-up phases"><p class="muted setup-summary"><b>${done} of ${known.length}</b> measurable parts done. Parts without a status have no automatic check yet: open them to see.</p><ol class="setup-steps">${phases.map((p,n)=>`<li class="setup-step ${esc(p.status||'')}" data-phase="${esc(p.key)}"><div class="step-head"><span class="step-num" aria-hidden="true">${n+1}</span><div class="step-text"><b>${esc(p.title)}</b><small>${esc(p.hint)}</small></div>${badge(p,false)}</div>${p.parts.map(partHtml).join('')}</li>`).join('')}</ol></section>`;
}
