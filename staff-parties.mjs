// Step 3: directors, shareholders and trustees, the ownership link between entities, the 100% check and the group profile.
// Pure view helpers; the rules live in the database (20261109260000_ownership_parties.sql) and the server (engagement-actions.ts).
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PARTY_ROLES=['Director','Shareholder','Trustee'];
export const PARTY_KINDS=['Individual','Entity'];
export const GROUP_STATUSES=['Standalone','Part of a group'];
export const EXPECTATION_NOTE='What is expected for each legal structure is a default that the Compliance Lead has not yet confirmed. It does not block KYC verification.';
const day=v=>String(v||'').slice(0,10);

export const isCurrent=p=>!p.ceased_on;
export function shareholdingTotal(parties){
 return Math.round(parties.filter(p=>p.role==='Shareholder'&&isCurrent(p)).reduce((t,p)=>t+Number(p.shareholding_percentage||0),0)*10000)/10000;
}
// What the register says about itself: nothing expected, complete, or the gaps.
export function registerStatus(status,parties){
 const expects=status?.expects||[],issues=status?.issues||[],total=shareholdingTotal(parties||[]);
 if(!expects.length)return {tone:'neutral',text:'The register is optional for this legal structure.',issues:[],total};
 if(issues.length)return {tone:'warn',text:'Gaps in the register: '+issues.join('; ')+'.',issues,total};
 return {tone:'ok',text:'Complete for this legal structure ('+expects.join(', ').toLowerCase()+').',issues:[],total};
}
export function groupLine(g,clientName){
 if(!g)return 'Group membership has not been recorded.';
 if(g.group_status==='Standalone')return 'Standalone: not part of a group.';
 const parent=g.ultimate_parent_client_id?clientName(g.ultimate_parent_client_id):`${g.ultimate_parent_name||'?'} (${g.ultimate_parent_country||'?'})`;
 return 'Part of a group. Ultimate parent: '+parent+'. Operates in other countries: '+(g.operates_in_other_countries||'To confirm')+'.';
}
// The section shown under the beneficial owners on the KYC screen.
export function partiesSection({client,parties=[],everyParty=[],status,group,clientName,leader,table,button,shortDate}){
 const mine=parties.filter(p=>p.client_id===client.client_id),current=mine.filter(isCurrent),ended=mine.filter(p=>!isCurrent(p));
 const st=registerStatus(status,mine),held=everyParty.filter(p=>p.holder_client_id===client.client_id&&isCurrent(p));
 const row=p=>[esc(p.role),esc(p.full_name)+(p.holder_client_id?` <small>(client: ${esc(clientName(p.holder_client_id))})</small>`:'')+(p.share_class?` <small>${esc(p.share_class)}</small>`:''),esc(p.party_kind),p.role==='Shareholder'?esc(Number(p.shareholding_percentage))+'%':'',esc(shortDate(p.appointed_on)),isCurrent(p)?(leader?button('party-end','End',p.party_id):''):esc('Ended '+shortDate(p.ceased_on)+' · '+(p.end_reason||''))];
 return `<h3>Directors, shareholders and trustees</h3><p class="${st.tone==='warn'?'warn':'muted'}" id="registerStatus">${esc(st.text)}</p>`
  +(current.some(p=>p.role==='Shareholder')?`<p class="muted">Current shareholdings add up to <b>${esc(st.total)}%</b>.</p>`:'')
  +table(['Role','Name','Type','Shareholding','Since',''],current.map(row))
  +(held.length?`<p class="muted">This client also holds shares in: ${held.map(p=>esc(clientName(p.client_id))+' ('+esc(Number(p.shareholding_percentage))+'%)').join(', ')}.</p>`:'')
  +(ended.length?`<details><summary>Ended entries (${ended.length})</summary>${table(['Role','Name','Type','Shareholding','Since','Ended'],ended.map(row))}</details>`:'')
  +`<p class="muted">${esc(EXPECTATION_NOTE)}</p><div class="actions">${leader?button('party-new','+ Add director, shareholder or trustee',client.client_id):''}</div>`
  +`<h3>Group profile</h3><p id="groupLine">${esc(groupLine(group,clientName))}</p>`
  +(group?.note?`<p class="muted">${esc(group.note)}</p>`:'')
  +`<p class="muted">No group tax rules are applied from this profile. Top-up tax and similar rules wait for the Tax Lead's written confirmation.</p><div class="actions">${leader?button('group-edit',group?'Change group profile':'Record group profile',client.client_id):''}</div>`;
}
export function partyFormFields({field,select,area,clientOptions}){
 return select('role','Role *',PARTY_ROLES,'')+select('party_kind','Individual or entity *',PARTY_KINDS,'')
  +field('full_name','Full name *','','text','required maxlength="160"')+field('identity_reference','Identity reference (required for an individual)','','text','maxlength="100"')+field('kra_pin','KRA PIN','','text','maxlength="11"')
  +select('holder_client_id','Shareholder is one of our clients (optional, entities only)',clientOptions,'','Not one of our clients')
  +field('shareholding_percentage','Shareholding % (shareholders only)','','number','min="0.0001" max="100" step="0.0001"')+field('share_class','Share class (shareholders only)','','text','maxlength="60"')
  +field('appointed_on','Appointed / acquired on *','','date','required')+area('change_reason','Source of this entry (for example CR12 dated…)','',false);
}
export function groupFormFields({field,select,area,clientOptions,group}){
 return select('group_status','Is the client part of a group? *',GROUP_STATUSES,group?.group_status||'')
  +select('ultimate_parent_client_id','Ultimate parent is one of our clients',clientOptions,group?.ultimate_parent_client_id||'','Not one of our clients')
  +field('ultimate_parent_name','Ultimate parent name (if not our client)',group?.ultimate_parent_name||'','text','maxlength="200"')+field('ultimate_parent_country','Ultimate parent country',group?.ultimate_parent_country||'','text','maxlength="100"')
  +select('operates_in_other_countries','Operates in other countries',['Yes','No','To confirm'],group?.operates_in_other_countries||'To confirm')
  +area('note','Note',group?.note||'',false);
}
