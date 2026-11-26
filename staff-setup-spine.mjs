// Build 2846: one list for client set-up. The client card, the client file and the set-up guide all read their steps and their count from here, so
// they can no longer count differently. Presentation only: nothing in this file approves, posts or decides a rule. The tests prove the step order is the
// order the card has always used for its "next step", and that "complete" means exactly what it meant before.

// Two phases belong to the client. The third belongs to a project (engagement checks are still done per project), so it has its own count.
export const PHASES=Object.freeze([
 {key:'know',title:'Know the client',scope:'client'},
 {key:'books',title:'Build the books',scope:'client'},
 {key:'work',title:'Start the work',scope:'project'}
]);
export const CLIENT_STEPS=Object.freeze([
 {key:'profile',phase:'know',title:'Client profile'},
 {key:'kyc',phase:'know',title:'KYC & contacts'},
 {key:'tax',phase:'know',title:'Tax profile'},
 {key:'activities',phase:'books',title:'Activities & mappings'},
 {key:'opening',phase:'books',title:'Opening trial balance'}
]);
export const PROJECT_STEPS=Object.freeze([
 {key:'source',phase:'work',title:'Source data'},
 {key:'reports',phase:'work',title:'Tax & reports'},
 {key:'release',phase:'work',title:'Release'}
]);

const clean=x=>String(x||'').trim();

// The two client-level facts the card and the guide both need. One definition, used by clientProgress and by the guide.
export function identityChecks({client,compliance,contacts=[],taxProfiles=[],registerFacts}){
 const kycMissing=[];
 if(!clean(client?.kra_pin))kycMissing.push('KRA PIN');
 if(!(registerFacts?.kyc_verified??compliance?.verified_at))kycMissing.push('KYC verification');
 if(!(registerFacts?.has_contact??contacts.length))kycMissing.push('a contact');
 const taxOk=registerFacts?.tax_verified??taxProfiles.some(x=>x.client_id===client?.client_id&&x.status==='Verified');
 return {kycOk:!kycMissing.length,kycMissing,taxOk};
}

// ready[key] is true (done), false (not done) or null (still being checked). The first step that is not done is the next one.
// A step still being checked is not counted as done and is never offered as the next step to act on.
export function buildSteps(defs,ready,detail={}){
 let next=null;
 const steps=defs.map(def=>{
  const r=ready[def.key];
  const state=r===true?'done':r===null||r===undefined?'checking':'todo';
  return {...def,state,done:r===true,detail:clean(detail[def.key])};
 });
 for(const s of steps){if(!s.done){next=s;break;}}
 for(const s of steps)if(s===next&&s.state==='todo')s.state='next';
 const done=steps.filter(s=>s.done).length,total=steps.length;
 return {steps,done,total,pct:total?Math.round(done/total*100):0,next,allDone:done===total,checking:steps.some(s=>s.state==='checking')};
}

// The client-level list, from the progress object the card already builds (clientProgress in staff-client-cards.mjs).
export function clientSpine(p){
 const profileText=p.missing.slice(0,3).join(', ')+(p.missing.length>3?` and ${p.missing.length-3} more`:'');
 const ready={profile:!!p.profileOk,kyc:!!p.kycOk,tax:!!p.taxOk,activities:p.activitiesOk===null?null:p.activitiesOk===true,opening:!!p.openingDone};
 const detail={
  profile:p.profileOk?'':profileText,
  kyc:p.kycOk?'':p.kycMissing.join(', ')+' outstanding',
  tax:p.taxOk?'':'No verified tax profile yet',
  activities:ready.activities===false&&p.profileOk?'Activities, stock set-up or general mappings incomplete':'',
  opening:p.openingDone?'':p.stagedTB?'Staged, still to be posted':'Not yet staged'
 };
 const spine=buildSteps(CLIENT_STEPS,ready,detail);
 // The lines the card's tooltip has always shown, in the same order and wording.
 const missing=[];
 if(!p.profileOk)missing.push('Client profile: '+profileText);
 if(!p.kycOk)missing.push('KYC and contacts: '+p.kycMissing.join(', '));
 if(!p.taxOk)missing.push('A verified tax profile');
 if(p.activitiesOk===false&&p.profileOk)missing.push('Activities, stock set-up or general mappings');
 if(!p.openingDone)missing.push(p.stagedTB?'Opening trial balance: staged, still to be posted':'Opening trial balance: not yet staged');
 return {...spine,missing};
}

// The project-level list (guide only). ready is {source,reports,release}.
export function projectSpine(ready,detail={}){return buildSteps(PROJECT_STEPS,ready,detail);}

const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PILL={done:['ok','✓'],next:['warn','!'],todo:['warn','!'],checking:['na','…']};
// The client file's overview: the same steps, grouped by phase, with the same count the card shows.
export function spineHtml(spine,{esc=e0}={}){
 const phases=PHASES.filter(ph=>ph.scope==='client').map(ph=>{
  const own=spine.steps.filter(s=>s.phase===ph.key);
  return `<div class="spine-phase"><span class="spine-phase-title">${esc(ph.title)}</span><div class="cc-pills">${own.map(s=>{const [cls,mark]=PILL[s.state]||PILL.todo;return `<span class="cc-pill ${cls}"${s.detail?` title="${esc(s.detail)}"`:''} data-spine-step="${esc(s.key)}"><i>${mark}</i>${esc(s.title)}</span>`;}).join('')}</div></div>`;
 }).join('');
 const count=spine.checking?'Checking…':`${spine.done} of ${spine.total} done`;
 return `<div class="spine" aria-label="Set-up steps"><p class="spine-count"><b>Set-up steps</b> · ${esc(count)}</p>${phases}</div>`;
}
