// Step 5: the service profile and file checklist shown with a project's engagement controls. Pure view helpers; the rules live in the
// database (20261109262000_service_profiles.sql) and the server (engagement-actions.ts).
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const STAGES=['Acceptance','Execution','Issue'];
export const REFERENCE_KINDS=['Standard','Law','Guidance'];
export const REFERENCE_NOTE='Standards and laws are listed so the Compliance Lead can confirm them. None is applied as a rule until a Partner records that confirmation. The checklist shows what is present or missing; it blocks nothing except billing.';
export function engineLine(profile){
 if(!profile)return 'No service profile is recorded for this service.';
 const state=profile.engine_state==='Built'?'built':profile.engine_state==='Planned'?'not built yet':'partly built';
 return `Runs on: ${profile.engine} (${state}). ${profile.note||''}`.trim();
}
// Counts for the headline.
export function checklistCounts(items=[]){
 const req=items.filter(x=>x.required),missing=req.filter(x=>!x.present),optionalMissing=items.filter(x=>!x.required&&!x.present);
 return {required:req.length,present:req.length-missing.length,missing:missing.length,optionalMissing:optionalMissing.length};
}
export function headline(items=[]){
 const c=checklistCounts(items);
 if(!items.length)return {tone:'neutral',text:'No checklist is defined for this service.'};
 if(!c.missing)return {tone:'ok',text:`All ${c.required} required items are in place.`};
 return {tone:'warn',text:`${c.present} of ${c.required} required items are in place; ${c.missing} missing.`};
}
export function billingBanner(locked){
 return locked?'<p class="warn full" id="billingLocked"><b>Billing locked.</b> No invoice can be posted until a signed engagement letter is uploaded, verified and still current.</p>':'';
}
export function serviceFileSection({data,partner,button}){
 if(!data)return '';
 const h=headline(data.items||[]),svc=data.service||{};
 const rows=STAGES.map(stage=>{
  const its=(data.items||[]).filter(x=>x.stage===stage);if(!its.length)return '';
  return `<li><b>${esc(stage)}</b><ul>${its.map(x=>`<li class="${x.present?'ok':x.required?'missing':'muted'}">${x.present?'✓':x.required?'Missing:':'Optional, not yet:'} ${esc(x.label)}${x.check_kind==='Document'?' <small>(document)</small>':''}</li>`).join('')}</ul></li>`;
 }).join('');
 const refs=(data.references||[]).map(r=>`<li>${esc(r.kind)}: ${esc(r.reference)} <small>${r.rule_status==='Confirmed'?'Confirmed by the Compliance Lead, recorded by a Partner':'Suggested, not yet confirmed'}</small>${partner&&r.rule_status!=='Confirmed'?' '+button('reference-confirm','Record confirmation',r.reference_id):''}${partner&&r.rule_status!=='Retired'?' '+button('reference-retire','Retire',r.reference_id):''}</li>`).join('');
 return `${billingBanner(data.billing_locked)}<div class="info full" id="serviceFile"><b>${esc(svc.service_name||'Service')} · file checklist</b><p class="${h.tone==='warn'?'warn':'muted'}" id="checklistStatus">${esc(h.text)}</p><ul>${rows}</ul>`
  +`<p class="muted">${esc(engineLine(data.profile))}</p><details><summary>Standards, laws and guidance (${(data.references||[]).length})</summary><ul>${refs||'<li>None recorded.</li>'}</ul>${partner?`<p>${button('reference-add','+ Add a reference',svc.service_code)}</p>`:''}<p class="muted">${esc(REFERENCE_NOTE)}</p></details></div>`;
}
export function referenceAddFields({select,field}){
 return select('kind','Kind *',REFERENCE_KINDS,'Standard')+field('reference','Standard, law or guidance *','','text','required maxlength="500"');
}
