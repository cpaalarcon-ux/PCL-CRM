// Client list as cards: three set-up pillars, one computed next step, one status badge.
// Pure functions so the rules can be tested without a browser. The page passes in its own helpers.

export const CLIENT_STATES=[['all','All'],['action','Needs action'],['onboarding','Onboarding'],['ready','Ready for work']];

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
 const counts={all:cards.length,action:0,onboarding:0,ready:0};
 for(const x of cards){if(x.status.state==='ready')counts.ready++;else{counts.onboarding++;counts.action++;}}
 return counts;
}

// Leaders get the full card. Others get a light card: name, PIN, entity type and what their role allows.
export function clientCard({client:c,progress:p,esc,structureLabel,leader,lightActions='',searchText,detailsVisible}){
 const step=leader?nextStep(p):null,status=leader?clientStatus(p,step):null;
 const id=esc(c.client_id);
 const sub=detailsVisible?[cleanText(c.kra_pin)||'KRA PIN missing',structureLabel(c,esc)].filter(Boolean).join(' · '):'Assigned work needed to open the client file';
 const tags=detailsVisible?`<div class="cc-tags">${c.primary_sector?`<span class="cc-tag">🏢 ${esc(c.primary_sector)}</span>`:'<span class="cc-tag missing">Missing sector</span>'}${c.branch_location?`<span class="cc-tag">${esc(c.branch_location)}</span>`:''}</div>`:'';
 const attrs=`data-search="${esc(searchText)}" data-structure="${esc(c.legal_structure||'')}" data-state="${leader?status.state:'all'}"`;
 if(!leader)return `<article class="client-card" ${attrs}><div class="cc-head"><div><h3>${detailsVisible?`<button class="link" data-client-view="${id}">${esc(c.company_name)}</button>`:esc(c.company_name)}</h3><div class="cc-meta">${esc(sub)}</div></div></div>${tags}${lightActions?`<div class="cc-foot">${lightActions}</div>`:''}</article>`;
 const cls=ok=>ok===null?'na':ok?'ok':'warn',mark=ok=>ok===null?'…':ok?'✓':'!';
 const sb=(action,cl,inner)=>`<button type="button" data-suite="${action}" data-id="${id}" class="${cl}">${inner}</button>`;
 const kyc=sb('compliance',`cc-pill ${cls(p.kycOk)}`,`<i>${mark(p.kycOk)}</i>KYC &amp; contacts`);
 const tax=sb('tax-profile',`cc-pill ${cls(p.taxOk)}`,`<i>${mark(p.taxOk)}</i>Tax profile`);
 const act=`<button class="cc-pill ${cls(p.activitiesOk)}" data-v3="client" data-id="${id}"><i>${mark(p.activitiesOk)}</i>Entity &amp; activities</button>`;
 const target={profile:`data-v3="client" data-id="${id}"`,activities:`data-setup-guide="${id}"`,'tb-post':`data-setup-guide="${id}"`,'tb-stage':`data-setup-guide="${id}"`,ready:`data-setup-guide="${id}"`,loading:`data-setup-guide="${id}"`}[step.key];
 const next=['kyc','tax'].includes(step.key)
  ?sb(step.key==='kyc'?'compliance':'tax-profile',`cc-next ${step.tone}`,`<span>${esc(step.title)}${step.detail?`<small>${esc(step.detail)}</small>`:''}</span><span>›</span>`)
  :`<button class="cc-next ${step.tone}" ${target}><span>${esc(step.title)}${step.detail?`<small>${esc(step.detail)}</small>`:''}</span><span>›</span></button>`;
 return `<article class="client-card" ${attrs}><div class="cc-head"><div><h3><button class="link" data-client-open="${id}">${esc(c.company_name)}</button></h3><div class="cc-meta">${esc(sub)}</div></div><span class="badge ${status.tone}" data-client-status="${id}">${esc(status.label)}</span></div>${tags}<div class="cc-pills">${kyc}${tax}${act}</div>${next}<div class="cc-foot"><button data-client="${id}">View details</button><button data-client-accounts="${id}">Client accounts</button><button class="primary" data-setup-guide="${id}">Continue setup</button></div></article>`;
}

export const chipRow=(counts,current,esc)=>`<div class="cc-chips" role="group" aria-label="Filter clients by status">${CLIENT_STATES.map(([k,l])=>`<button type="button" class="cc-chip${k===current?' on':''}" data-client-state="${k}" aria-pressed="${k===current}">${esc(l)}<em>${counts[k]??0}</em></button>`).join('')}</div>`;
