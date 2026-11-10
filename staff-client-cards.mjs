import {lifecycleBadge} from './staff-client-lifecycle.mjs?v=20261109-ptm-v1';
// Client list as cards: three set-up pillars, one computed next step, one status badge.
// Pure functions so the rules can be tested without a browser. The page passes in its own helpers.

// Build 2690: the three card statuses a reader acts on. Red = something is due or waiting; amber = set-up is not finished; green = neither.
export const CLIENT_STATES=[['all','All'],['action','Action needed'],['setup','Setup required'],['healthy','Healthy']];

const cleanText=x=>String(x||'').trim();

// Everything the card needs to decide. `readiness` is the async per-client mapping read (undefined until loaded).
export function clientProgress({client:c,missing=[],compliance,contacts=[],taxProfiles=[],readiness,stagedTB=false}){
 const kycMissing=[];
 if(!cleanText(c.kra_pin))kycMissing.push('KRA PIN');
 if(!compliance?.verified_at)kycMissing.push('KYC verification');
 if(!contacts.length)kycMissing.push('a contact');
 const kycOk=!kycMissing.length;
 const taxOk=taxProfiles.some(x=>x.client_id===c.client_id&&x.status==='Verified');
 const profileOk=!missing.length;
 let activitiesOk=null; // null = still loading
 if(readiness){
  // General mappings are usable while pending review (they are reviewed when the opening journal is posted), so Active and Draft both count.
  // Stock method and categories are required only when an active activity carries stock; a salon or consultancy does not need them.
  const activities=Number(readiness.activity_count||0),accounts=Number(readiness.usable_account_count??readiness.approved_account_count??0);
  const stockNeeded=readiness.stock_required_count==null||Number(readiness.stock_required_count)>0;
  activitiesOk=profileOk&&activities>0&&accounts>0&&(!stockNeeded||(Number(readiness.stock_method_count||0)>0&&Number(readiness.category_count||0)>0));
 }
 const openingDone=!!c.has_opening_balance||c.opening_balance_status==='No opening balances';
 return {profileOk,missing,kycOk,kycMissing,taxOk,activitiesOk,openingDone,stagedTB};
}

// First thing that blocks the client, in the same order as the set-up guide. Tone: red = identity/KYC, amber = set-up, green = done.
export function nextStep(p){
 if(!p.profileOk)return {key:'profile',tone:'red',title:'Complete the client profile',detail:p.missing.slice(0,3).join(', ')+(p.missing.length>3?` and ${p.missing.length-3} more`:'')};
 if(!p.kycOk)return {key:'kyc',tone:'red',title:'Complete KYC',detail:`${p.kycMissing.join(', ')} outstanding`};
 if(!p.taxOk)return {key:'tax',tone:'amber',title:'Verify the tax profile',detail:'No verified tax profile yet'};
 if(p.activitiesOk===null)return {key:'loading',tone:'grey',title:'Checking set-up…',detail:''};
 if(!p.activitiesOk)return {key:'activities',tone:'amber',title:'Finish activities and mappings',detail:'Activities, stock set-up or general mappings incomplete'};
 if(!p.openingDone)return p.stagedTB
  ?{key:'tb-post',tone:'amber',title:'Post the opening TB',detail:'Staged. Map, import and independent posting still required'}
  :{key:'tb-stage',tone:'amber',title:'Stage the opening TB',detail:'Upload, map and import'};
 return {key:'ready',tone:'green',title:'✓ Ready for work',detail:'Client set-up is complete. Engagement checks are still done on each project'};
}

export function clientStatus(p,step){
 if(step.key==='ready')return {state:'ready',label:'Active',tone:'good'};
 if(['tb-post','tb-stage'].includes(step.key))return {state:'onboarding',label:'Opening TB pending',tone:'warn'};
 if(step.key==='loading')return {state:'onboarding',label:'Checking…',tone:''};
 return {state:'onboarding',label:'Onboarding',tone:'info'};
}

export function stateCounts(cards){
 const counts={all:cards.length,action:0,setup:0,healthy:0};
 for(const x of cards){const k=x.status.key;if(k==='action')counts.action++;else if(k==='healthy')counts.healthy++;else if(k==='setup'||k==='checking')counts.setup++;}
 return counts;
}

// ---- Set-up completion: four equal parts. The ring shows the share done; the tooltip lists exactly what is missing. ----
export function setupCompletion(p){
 const missing=[];
 if(!p.profileOk)missing.push('Client profile: '+p.missing.slice(0,3).join(', ')+(p.missing.length>3?` and ${p.missing.length-3} more`:''));
 if(!p.kycOk)missing.push('KYC and contacts: '+p.kycMissing.join(', '));
 if(!p.taxOk)missing.push('A verified tax profile');
 if(p.activitiesOk===false&&p.profileOk)missing.push('Activities, stock set-up or general mappings');
 if(!p.openingDone)missing.push(p.stagedTB?'Opening trial balance: staged, still to be posted':'Opening trial balance: not yet staged');
 const parts=[p.kycOk,p.taxOk,p.activitiesOk===true,p.openingDone],done=parts.filter(Boolean).length,checking=p.activitiesOk===null;
 return {done,total:parts.length,pct:Math.round(done/parts.length*100),missing,checking};
}

// ---- Status: red first, then amber, then green. Overdue tasks are known only where the register figures are loaded (Managers and Partners). ----
export function cardStatus(p,{flags=null,meta=null}={}){
 const reasons=[];
 if(flags?.kra_open>0)reasons.push('A KRA notice is due soon or past due');
 if(flags?.incoming_overdue>0)reasons.push('A file has waited too long in Incoming review');
 if(meta?.overdue_tasks>0)reasons.push(`${meta.overdue_tasks} overdue task${meta.overdue_tasks===1?'':'s'}`);
 if(reasons.length)return {key:'action',label:'Action needed',tone:'bad',icon:'●',reasons};
 const c=setupCompletion(p);
 if(c.checking)return {key:'checking',label:'Checking…',tone:'',icon:'○',reasons:[]};
 if(c.pct<100)return {key:'setup',label:'Setup required',tone:'warn',icon:'●',reasons:c.missing};
 return {key:'healthy',label:'Healthy',tone:'good',icon:'●',reasons:[]};
}

const dayText=d=>d<0?`overdue by ${-d} day${d===-1?'':'s'}`:d===0?'due today':`${d} day${d===1?'':'s'} left`;
// Warnings on the card: KRA notices and Incoming review only.
export function alertBadges(flags,esc){
 if(!flags)return '';
 const out=[];
 if(flags.kra_open>0)out.push(`<button type="button" class="cc-alert red" data-suite="kra-open" data-id=""><span aria-hidden="true">🚨</span> KRA notice: ${esc(dayText(flags.kra_days))}${flags.kra_open>1?` (+${flags.kra_open-1} more)`:''}</button>`);
 if(flags.incoming_waiting>0)out.push(`<button type="button" class="cc-alert amber" data-suite="incoming-open" data-id=""><span aria-hidden="true">⚠️</span> Incoming review: ${flags.incoming_waiting} file${flags.incoming_waiting===1?'':'s'}${flags.incoming_overdue>0?`, ${flags.incoming_overdue} overdue`:''}</button>`);
 return out.length?`<div class="cc-alerts" aria-label="Warnings for this client">${out.join('')}</div>`:'';
}

const ringSvg=(pct,tone)=>{const r=17,c=2*Math.PI*r,on=c*pct/100;return `<svg class="cc-ring-svg" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="4"/><circle cx="20" cy="20" r="${r}" fill="none" stroke="${tone}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${on.toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 20 20)"/></svg>`;};
export function setupRing(c,id,esc){
 const tone=c.checking?'#94a3b8':c.pct>=100?'#067647':'#b45f06';
 const summary=c.checking?'Checking activities and mappings…':c.pct>=100?'Client set-up is complete.':'Missing: '+c.missing.join('; ')+'.';
 const label=c.checking?'Client set-up: checking':`Client set-up ${c.pct}%`;
 return `<span class="cc-setup"><span class="cc-ring" tabindex="0" role="group" aria-label="${esc(label+'. '+summary)}" aria-describedby="cc-tip-${id}">${ringSvg(c.checking?0:c.pct,tone)}<b class="cc-ring-pct" aria-hidden="true">${c.checking?'…':c.pct+'%'}</b><span class="cc-tip" role="tooltip" id="cc-tip-${id}">${esc(summary)}${c.checking||c.pct>=100?'':'<br><small>Click the main button to continue.</small>'}</span></span><span class="cc-setup-label"><b>Client set-up</b><small>${c.checking?'checking…':c.pct>=100?'complete':`${c.done} of ${c.total} parts done`}</small></span></span>`;
}

// One main button: the next thing to do. Detail text moved into the ring's tooltip.
export function nextAction(step,meta){
 if(step.key!=='ready')return {label:step.title.replace(/^Complete the client profile$/,'Complete the profile'),step:step.key};
 const n=Number(meta?.open_tasks||0);
 return n>0?{label:`Review ${n} task${n===1?'':'s'}`,step:'tasks'}:{label:'Open client file',step:'file'};
}

// Leaders get the full card. Others get a light card: name, PIN, entity type and what their role allows.
export function clientCard({client:c,progress:p,esc,structureLabel,leader,lightActions='',searchText,detailsVisible,extra='',flags=null,meta=null}){
 const step=leader?nextStep(p):null,status=leader?cardStatus(p,{flags,meta}):null;
 const id=esc(c.client_id);
 const sub=detailsVisible?[cleanText(c.kra_pin)||'KRA PIN missing',structureLabel(c,esc)].filter(Boolean).join(' · '):'Assigned work needed to open the client file';
 const tags=detailsVisible?`<div class="cc-tags">${c.primary_sector?`<span class="cc-tag">🏢 ${esc(c.primary_sector)}</span>`:'<span class="cc-tag missing">Missing sector</span>'}${c.branch_location?`<span class="cc-tag">${esc(c.branch_location)}</span>`:''}</div>`:'';
 const attrs=`data-search="${esc(searchText)}" data-structure="${esc(c.legal_structure||'')}" data-state="${leader?(status.key==='checking'?'setup':status.key):'all'}"`;
 if(!leader)return `<article class="client-card" ${attrs}><div class="cc-head"><div><h3>${detailsVisible?`<button class="link" data-client-view="${id}">${esc(c.company_name)}</button>`:esc(c.company_name)}</h3><div class="cc-meta">${esc(sub)}${lifecycleBadge(c,esc)}</div></div></div>${tags}${lightActions?`<div class="cc-foot">${lightActions}</div>`:''}</article>`;
 const comp=setupCompletion(p),act=nextAction(step,meta);
 const target={profile:`data-v3="client" data-id="${id}"`,kyc:`data-suite="compliance" data-id="${id}"`,tax:`data-suite="tax-profile" data-id="${id}"`,activities:`data-setup-guide="${id}"`,'tb-post':`data-setup-guide="${id}"`,'tb-stage':`data-setup-guide="${id}"`,loading:`data-setup-guide="${id}"`,tasks:`data-client-open="${id}" data-client-tab="projects"`,file:`data-client-open="${id}"`}[act.step];
 const menu=[[`data-client-open="${id}"`,'Open client file'],[`data-client="${id}"`,'View details'],[`data-client-accounts="${id}"`,'Client accounts'],[`data-setup-guide="${id}"`,'Continue set-up'],[`data-suite="compliance" data-id="${id}"`,'Edit KYC and contacts'],[`data-suite="tax-profile" data-id="${id}"`,'Tax profile'],[`data-v3="client" data-id="${id}"`,'Entity and activities']]
  .map(([a,l])=>`<button type="button" role="menuitem" ${a}>${l}</button>`).join('');
 return `<article class="client-card" ${attrs}><div class="cc-head"><div><h3><button class="link" data-client-open="${id}">${esc(c.company_name)}</button></h3><div class="cc-meta">${esc(sub)}${lifecycleBadge(c,esc)}</div></div><span class="badge ${status.tone}" data-client-status="${id}"${status.reasons.length?` title="${esc(status.reasons.join('. '))}"`:''}><span aria-hidden="true">${status.icon}</span> ${esc(status.label)}</span></div>${tags}${alertBadges(flags,esc)}${extra}${setupRing(comp,id,esc)}<div class="cc-foot"><button type="button" class="primary cc-main" ${target}>${esc(act.label)}</button><details class="cc-more"><summary aria-label="More actions for ${esc(c.company_name)}" title="More actions"><span aria-hidden="true">⋯</span></summary><div class="cc-menu" role="menu" aria-label="More actions">${menu}</div></details></div></article>`;
}

export const chipRow=(counts,current,esc)=>`<div class="cc-chips" role="group" aria-label="Filter clients by status">${CLIENT_STATES.map(([k,l])=>`<button type="button" class="cc-chip${k===current?' on':''}" data-client-state="${k}" aria-pressed="${k===current}">${esc(l)}<em>${counts[k]??0}</em></button>`).join('')}</div>`;
