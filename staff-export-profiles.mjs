// Statutory export profiles (build 2830), under Settings, Templates and Statutory Rules. A profile fixes how one authority's monthly file is formatted: template version,
// rounding rule, accepted ID types and how the employer housing levy is shown. Exact payroll values never change; a month always uses the profile in force on its last day.
// The server makes every decision (export-profile-actions.ts). This module draws the list and the forms.
import {settingsCard} from './staff-settings-cards.mjs?v=20261112-resources-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const PROFILES_NOTE='An export profile decides only how a file is formatted when it is created. The ledger and payroll records keep exact values, and the difference made by any rounding is stored with the file. A profile is drafted by one Manager or Partner and published by another, who records what it was checked against. A published profile is never edited: end it on a date and save a new version, so an old month is always produced under the profile that was in force for it.';
const TONE={Published:'good',Draft:'warn',Retired:'muted'};
export function profileRows(list,{me,leader,esc=e0,today=''}={}){
 return (list||[]).map(t=>{
  const live=t.status==='Published'&&t.effective_from<=today&&(!t.effective_to||t.effective_to>=today),state=t.status==='Published'?(t.effective_to&&t.effective_to<today?'Published, ended '+t.effective_to:t.effective_from>today?'Published, starts '+t.effective_from:live?'In force':'Published'):t.status==='Draft'?(t.provenance==='Starter'?'Starter draft, not yet confirmed':'Draft'):'Retired';
  const acts=[
   leader&&t.status==='Draft'&&t.created_by===me?`<button type="button" data-ep="revise" data-id="${esc(t.profile_id)}" data-rev="${esc(t.revision)}">Revise draft</button>`:'',
   leader&&t.status==='Draft'?`<button type="button" data-ep="publish" data-id="${esc(t.profile_id)}" data-rev="${esc(t.revision)}" data-own="${t.created_by===me?'1':''}">Publish</button>`:'',
   leader&&t.status==='Published'?`<button type="button" data-ep="end" data-id="${esc(t.profile_id)}" data-rev="${esc(t.revision)}">End on a date</button>`:'',
   leader&&t.status!=='Retired'&&!(t.status==='Published'&&t.used_by>0)?`<button type="button" data-ep="retire" data-id="${esc(t.profile_id)}" data-rev="${esc(t.revision)}">Retire</button>`:'',
   leader?`<button type="button" data-ep="copy" data-id="${esc(t.profile_id)}">New version from this</button>`:''].join(' ');
  const rule=t.rounding_rule==='ROUND_UP_WHOLE'?`${esc(t.rounding_label)}: ${esc((t.rounded_columns||[]).join(', '))}`:esc(t.rounding_label||'');
  return `<tr data-status="${esc(t.status)}"><td><b>${esc(t.return_label)}</b><small>${esc(t.authority)} · version ${esc(t.version)} · ${esc(t.template_version)}</small></td><td>${rule}${(t.accepted_id_types||[]).length?`<small>ID types: ${esc(t.accepted_id_types.join(', '))}</small>`:''}${t.return_code==='PAYE_P10'?`<small>Employer housing levy: ${esc(t.housing_label)}</small>`:''}</td><td>${esc(t.effective_from)}${t.effective_to?' to '+esc(t.effective_to):' onwards'}<small><span class="badge ${TONE[t.status]||''}">${esc(state)}</span></small>${t.verified_on?`<small>Checked ${esc(t.verified_on)}: ${esc(t.verified_against)}</small>`:''}${t.published_by_name?`<small>Published by ${esc(t.published_by_name)}${t.sole_partner_publish?' (sole Partner)':''}</small>`:''}${t.ended_reason?`<small>Ended: ${esc(t.ended_reason)}</small>`:''}${t.notes?`<small>${esc(t.notes)}</small>`:''}</td><td>${acts}</td></tr>`;
 }).join('');
}
export function createExportProfilesUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,today}=ctx,d=()=>ctx.data();
 const canUse=()=>!['INTERN','ADMIN'].includes(d().me?.category_code);
 let cur=null;
 const card=()=>canUse()?settingsCard({id:'exportProfilesCard',title:'Statutory export profiles',purpose:'Templates and statutory rules: how the NSSF, SHIF and PAYE files are formatted, rounded and versioned. Exact payroll values stay in the ledger.',audience:'Managers and Partners draft and publish; everyone with client access sees what is in force',actions:ctx.button('export-profiles-open','Open')}):'';
 const checks=(name,items,chosen)=>items.map(x=>`<label><input type="checkbox" name="${esc(name)}" value="${esc(x)}"${(chosen||[]).includes(x)?' checked':''}> ${esc(x)}</label>`).join(' ');
 function fieldsFor(rt,t){
  const r=cur.returns.find(x=>x.code===rt);
  return field('template_version','Template version this profile is for *',t?.template_version||'','text','required maxlength="80"')
   +field('effective_from','First day it applies *',t?.effective_from||today(),'date','required')+field('effective_to','Last day (blank = no end yet)',t?.effective_to||'','date')
   +select('rounding_rule','Rounding in the export *',Object.entries(cur.rounding_rules),t?.rounding_rule||'EXACT_2DP')
   +(r.roundable.length?`<fieldset class="full"><legend>Columns rounded up (only if the round-up rule is chosen)</legend>${checks('rounded_columns',r.roundable,t?.rounded_columns)}</fieldset>`:'')
   +(r.ids?`<fieldset class="full"><legend>ID types the authority accepts *</legend>${checks('accepted_id_types',cur.id_types,t?.accepted_id_types)}</fieldset>`:'')
   +(r.housing?select('employer_housing_levy','Employer housing levy *',Object.entries(cur.housing_modes),t?.employer_housing_levy||'SEPARATE_SHEET'):'')
   +`<label class="full">Notes: what to check before publishing<textarea name="notes" maxlength="2000">${esc(t?.notes||'')}</textarea></label>`;
 }
 const body=f=>({template_version:f.get('template_version'),effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,rounding_rule:f.get('rounding_rule'),rounded_columns:f.getAll('rounded_columns'),accepted_id_types:f.getAll('accepted_id_types'),employer_housing_levy:f.get('employer_housing_levy')||'NOT_DECLARED',notes:f.get('notes')||''});
 async function open(){cur=await request({action:'export_profile_list'});paint();}
 function paint(){
  const rows=profileRows(cur.profiles,{me:cur.me,leader:cur.can_manage,esc,today:today()});
  modal('Statutory export profiles',`<p class="info full">${esc(PROFILES_NOTE)}</p>${cur.can_manage?`<div class="actions">${cur.returns.map(r=>`<button type="button" data-ep="add" data-return="${esc(r.code)}">New ${esc(r.label)} version</button>`).join('')}</div>`:''}<div class="scroll full"><table id="exportProfilesTable"><thead><tr><th>Return</th><th>Formatting</th><th>Applies</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`);
  const b0=$('#editorBody');if(b0)b0.onclick=async ev=>{const b=ev.target.closest('[data-ep]');if(!b)return;const id=b.dataset.id,rev=b.dataset.rev,act=b.dataset.ep,t=cur.profiles.find(x=>x.profile_id===id);
   try{
    if(act==='add'||act==='copy'){const rt=act==='add'?b.dataset.return:t.return_code,base=act==='copy'?{...t,effective_from:today(),effective_to:null}:null;
     modal('New version: '+cur.returns.find(x=>x.code===rt).label,form(fieldsFor(rt,base),'Save draft'),f=>request({action:'export_profile_create',return_code:rt,...body(f)}),()=>open(),{refreshWorkspace:false});}
    else if(act==='revise')modal('Revise draft',form(fieldsFor(t.return_code,t),'Save changes'),f=>request({action:'export_profile_revise',profile_id:id,revision:rev,...body(f)}),()=>open(),{refreshWorkspace:false});
    else if(act==='publish')modal('Publish profile',form(`<p class="info full">${b.dataset.own?'You drafted this profile. You can publish it only if you are the firm\'s only Partner, and that is recorded.':'Check the profile against its source first.'} Publishing records what you checked it against and when. It cannot be edited afterwards.</p>`+field('verified_against','Checked against *','','text','required minlength="5" maxlength="400" placeholder="For example, the current NSSF return specification or the SHA employer upload"')+field('verified_on','Date checked *',today(),'date','required'),'Publish'),f=>request({action:'export_profile_publish',profile_id:id,revision:rev,verified_against:f.get('verified_against'),verified_on:f.get('verified_on')}),out=>{notice(out.sole_partner_publish?'Published as the sole Partner, and recorded.':'Published.');return open();},{refreshWorkspace:false});
    else if(act==='end')modal('End on a date',form(`<p class="info full">Months up to this date keep this profile. Save a new version that starts the next day.</p>`+field('effective_to','Last day it applies *','','date','required')+`<label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`,'End profile'),f=>request({action:'export_profile_end',profile_id:id,revision:rev,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>open(),{refreshWorkspace:false});
    else if(act==='retire')modal('Retire profile',form(`<p class="info full">A profile that has produced files is ended on a date instead. Retiring is for a draft or a profile that was never used.</p><label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`,'Retire'),f=>request({action:'export_profile_retire',profile_id:id,revision:rev,reason:f.get('reason')}),()=>open(),{refreshWorkspace:false});
   }catch(err){notice(err.message,true);}
  };
 }
 async function handle(action){if(action!=='export-profiles-open')return false;await open();return true;}
 return {card,open,handle,canUse};
}
