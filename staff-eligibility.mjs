// Service eligibility (build 2833), under Settings. Restricted and specialist services stay unavailable until the evidence they need is recorded by a Manager or Partner,
// verified by a Partner and still in date. This records evidence a person supplies; it does not establish that anyone holds a licence. The server makes every decision (eligibility-actions.ts).
import {settingsCard} from './staff-settings-cards.mjs?v=20261112-resources-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const ELIGIBILITY_NOTE='A restricted or specialist service cannot be activated on a client until each kind of evidence it needs has been recorded, verified by a Partner and is still in date. Expired or ended evidence stops it. Check licences, appointments and competence against the official source before recording them: this screen keeps what you saw, it does not prove it.';
const TONE={Valid:'good',Expiring:'warn',Recorded:'warn',Expired:'bad','Not yet valid':'warn',Ended:'muted'};
export function recordLine(r,{esc=e0,canVerify=false,canRecord=false,me=''}={}){
 const who=r.practitioner_name?` · ${esc(r.practitioner_name)}`:'',left=r.state==='Expiring'?` (${esc(r.days_left)} days left)`:'';
 const acts=[canVerify&&r.state==='Recorded'?`<button type="button" data-el="verify" data-id="${esc(r.record_id)}" data-rev="${esc(r.revision)}" data-own="${r.recorded_by===me?'1':''}">Verify</button>`:'',canRecord&&r.status!=='Ended'?`<button type="button" data-el="end" data-id="${esc(r.record_id)}" data-rev="${esc(r.revision)}">End</button>`:''].join(' ');
 return `<tr><td>${esc(r.kind)}${who}</td><td><span class="badge ${TONE[r.state]||'warn'}">${esc(r.state)}</span>${left}</td><td>${esc(r.authority)} · ${esc(r.reference)}<small>${esc(r.valid_from)} to ${esc(r.expires_on)} · recorded by ${esc(r.recorded_by_name||'')}${r.verified_by_name?' · verified by '+esc(r.verified_by_name)+(r.sole_partner_verify?' (sole Partner)':''):''}${r.ended_reason?' · ended: '+esc(r.ended_reason):''}</small></td><td>${acts}</td></tr>`;
}
export function serviceBlock(s,opts={}){
 const esc=opts.esc||e0,fr=s.firm_readiness||{},miss=(fr.missing||[]),named=s.named_kinds||[];
 const status=miss.length?`<span class="badge bad">Not available: missing ${esc(miss.join(', '))}</span>`:'<span class="badge good">Firm-level evidence in place</span>';
 return `<section class="card section-space" data-service="${esc(s.service_code)}"><div class="section-head"><div><h3>${esc(s.service_name)}</h3><small class="muted">${esc(s.service_group)} · needs ${esc(s.requirements.join(', '))}</small></div><div>${status}${named.length?`<small class="muted">${esc(named.join(' and '))} must be verified for the named practitioner who owns the engagement.</small>`:''}${(fr.expiring||[]).map(x=>`<small class="muted">${esc(x.kind)} expires in ${esc(x.days_left)} days.</small>`).join('')}</div></div>${opts.canRecord?`<div class="actions"><button type="button" data-el="record" data-service="${esc(s.service_code)}">Record evidence</button></div>`:''}${s.records.length?`<div class="scroll"><table><thead><tr><th>Kind</th><th>State</th><th>Evidence</th><th></th></tr></thead><tbody>${s.records.map(r=>recordLine(r,opts)).join('')}</tbody></table></div>`:'<p class="muted">Nothing recorded yet.</p>'}</section>`;
}
export function createEligibilityUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,today}=ctx,d=()=>ctx.data();
 const canUse=()=>!['INTERN','ADMIN'].includes(d().me?.category_code);
 let cur=null;
 const card=()=>canUse()?settingsCard({id:'eligibilityCard',title:'Service eligibility',purpose:'Evidence that must be in place before a restricted or specialist service can be activated: licence, practitioner authorization, competence, independence, appointment or management approval, each with an expiry date.',audience:'Managers and Partners record; Partners verify',actions:ctx.button('eligibility-open','Open')}):'';
 async function open(){cur=await request({action:'eligibility_read'});paint();}
 function paint(){
  const opts={esc,canVerify:cur.can_verify,canRecord:cur.can_record,me:cur.me};
  modal('Service eligibility',`<p class="info full">${esc(ELIGIBILITY_NOTE)}</p>${cur.services.map(s=>serviceBlock(s,opts)).join('')}`,null,null,{refreshWorkspace:false});
  const b0=$('#editorBody');if(b0)b0.onclick=async ev=>{const b=ev.target.closest('[data-el]');if(!b)return;const act=b.dataset.el;
   try{
    if(act==='record'){const s=cur.services.find(x=>x.service_code===b.dataset.service);
     modal('Record evidence · '+s.service_name,form(select('kind','Kind of evidence *',s.requirements.map(k=>[k,k]),'','Choose')+(s.named_kinds.length?select('staff_id','Named practitioner (for authorization and competence)',cur.staff.map(x=>[x.staff_id,x.full_name]),'','Not needed for other kinds'):'')+field('authority','Authority or body *','','text','required minlength="2" maxlength="200"')+field('reference','Reference or number *','','text','required minlength="3" maxlength="200"')+field('valid_from','Valid from *',cur.today,'date','required')+field('expires_on','Expires on *','','date','required')+`<label class="full">What you saw and where it is kept *<textarea name="evidence_note" required minlength="10" maxlength="1000"></textarea></label>`,'Record'),
      f=>request({action:'eligibility_record',service_code:s.service_code,kind:f.get('kind'),staff_id:f.get('staff_id')||undefined,authority:f.get('authority'),reference:f.get('reference'),valid_from:f.get('valid_from'),expires_on:f.get('expires_on'),evidence_note:f.get('evidence_note')}),()=>open(),{refreshWorkspace:false});}
    else if(act==='verify')modal('Verify evidence',form(`<p class="info full">${b.dataset.own?'You recorded this. You can verify it only if you are the firm\'s only Partner, and that is recorded.':'Check the evidence against the official source.'}</p><label class="full">What you checked it against *<textarea name="verification_note" required minlength="10" maxlength="1000"></textarea></label>`,'Verify'),f=>request({action:'eligibility_verify',record_id:b.dataset.id,revision:b.dataset.rev,verification_note:f.get('verification_note')}),()=>open(),{refreshWorkspace:false});
    else if(act==='end')modal('End this evidence',form(`<p class="info full">The entry stays in the history. The service can no longer be activated on it.</p><label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`,'End'),f=>request({action:'eligibility_end',record_id:b.dataset.id,revision:b.dataset.rev,reason:f.get('reason')}),()=>open(),{refreshWorkspace:false});
   }catch(err){notice(err.message,true);}
  };
 }
 async function handle(action){if(action!=='eligibility-open')return false;await open();return true;}
 return {card,open,handle,canUse};
}
