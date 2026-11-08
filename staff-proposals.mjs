// Propose-and-approve for client onboarding. An Assistant or Supervisor's entry waits here. For an Assistant's entry a Supervisor, Manager or
// Partner checks it first; then a Manager or Partner who is neither the proposer nor the checker approves it. The server and the database
// enforce the same rules; this file only shows the queue and the buttons.
export const PROPOSER_ROLES=Object.freeze(['ASSISTANT','SUPERVISOR']);
export const canPropose=role=>PROPOSER_ROLES.includes(role);
export const PROPOSAL_HELP='Your entry is saved as a proposal and nothing on the client record changes yet. An Assistant’s proposal is checked by a Supervisor, Manager or Partner; a Manager or Partner who did not prepare or check it then approves it.';
const OPEN=['Proposed','Checked'];
export function proposalActions(p,me){
 const open=OPEN.includes(p.status),mine=p.proposed_by===me.staff_id,out=[];
 if(!open)return out;
 const lead=['PARTNER','MANAGER'].includes(me.category_code),checker=['SUPERVISOR','MANAGER','PARTNER'].includes(me.category_code);
 if(mine)out.push('withdraw');
 if(!mine&&checker&&p.status==='Proposed'&&p.proposed_role==='ASSISTANT')out.push('check');
 if(!mine&&lead&&p.checked_by!==me.staff_id&&(p.status==='Checked'||p.proposed_role==='SUPERVISOR'))out.push('approve');
 if(!mine&&checker&&!(me.category_code==='SUPERVISOR'&&p.proposed_role!=='ASSISTANT'))out.push('return');
 return out;
}
const LABEL={check:'Check',approve:'Approve and apply',return:'Return',withdraw:'Withdraw'};
export function proposalsCard(data,esc=v=>String(v??''),nameOf=()=>''){
 const list=data.proposals||[];if(!list.length||!data.me)return '';
 const rows=list.map(p=>{
  const acts=proposalActions(p,data.me).map(a=>`<button type="button" class="${a==='approve'?'primary':'secondary'}" data-proposal="${a}" data-id="${esc(p.proposal_id)}" data-rev="${esc(p.revision)}">${LABEL[a]}</button>`).join(' ');
  const trail=[`Proposed by ${esc(p.proposed_by_name||nameOf(p.proposed_by)||'a colleague')}`,p.checked_by?`checked by ${esc(p.checked_by_name||nameOf(p.checked_by)||'a colleague')}`:'',p.decided_by?`${p.status==='Returned'?'returned':'approved'} by ${esc(p.decided_by_name||nameOf(p.decided_by)||'a colleague')}`:''].filter(Boolean).join(' · ');
  const note=p.decision_note?`<small class="muted">Note: ${esc(p.decision_note)}</small>`:p.check_note?`<small class="muted">Check note: ${esc(p.check_note)}</small>`:p.reason?`<small class="muted">Reason: ${esc(p.reason)}</small>`:'';
  return `<tr><td><b>${esc(p.summary)}</b>${p.company_name?`<small class="muted">${esc(p.company_name)}</small>`:''}${note}</td><td><span class="badge ${p.status==='Approved'?'good':p.status==='Returned'||p.status==='Withdrawn'?'warn':'info'}">${esc(p.status)}</span></td><td><small>${trail}</small></td><td class="actions">${acts}</td></tr>`;
 }).join('');
 const waiting=list.filter(p=>OPEN.includes(p.status)).length;
 return `<div class="card" id="proposalsCard"><div class="section-head"><h2>Proposals <span class="badge ${waiting?'warn':'good'}">${waiting} waiting</span></h2></div><p class="muted">${esc(PROPOSAL_HELP)}</p><table><thead><tr><th>Change</th><th>Status</th><th>Who</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
export function proposeButtons(clientId,role,suiteButton,esc=v=>String(v??'')){
 if(!canPropose(role))return '';
 return `<button type="button" class="secondary" data-propose="client" data-id="${esc(clientId)}">Propose details change</button>`+suiteButton('contact-new','Propose contact',clientId)+suiteButton('owner-new','Propose owner',clientId);
}
export function bindProposals(ctx){
 const {$,esc,field,form,modal,request,data}=ctx;
 document.addEventListener('click',async e=>{
  const pb=e.target.closest('[data-propose="client"]');
  if(pb){
   const c=data().clients.find(x=>x.client_id===pb.dataset.id);if(!c)return;
   modal(`Propose a change: ${c.company_name}`,form(`<p class="info full">${esc(PROPOSAL_HELP)}</p>`+field('company_name','Company name *',c.company_name,'text','required maxlength="200"')+field('kra_pin','KRA PIN',c.kra_pin||'','text','maxlength="11"')+field('primary_sector','Primary sector',c.primary_sector||'','text','maxlength="100"')+field('proposal_reason','Why is this change needed? *','','text','required maxlength="300"'),'Send for review'),f=>{
    const v=Object.fromEntries(f);return request({action:'client_save',client_id:c.client_id,revision:c.revision,firm_ids:(data().client_firms||[]).filter(x=>x.client_id===c.client_id).map(x=>x.firm_id),...v});
   },undefined,{successMessage:'Proposal sent for review. Nothing on the client record has changed yet.'});
   return;
  }
  const b=e.target.closest('[data-proposal]');if(!b)return;
  const kind=b.dataset.proposal,base={proposal_id:b.dataset.id,revision:b.dataset.rev},p=(data().proposals||[]).find(x=>x.proposal_id===b.dataset.id);
  const ask=(title,label,required,action,success)=>modal(title,form(`<p class="info full">${esc(p?.summary||'')}</p>`+field('note',label,'','text',required?'required maxlength="500"':'maxlength="500"'),title),f=>request({action,...base,note:f.get('note')||''}),undefined,{successMessage:success});
  if(kind==='check')ask('Check this proposal','Check note (optional)',false,'client_proposal_check','Checked. A Manager or Partner can now approve it.');
  if(kind==='return')ask('Return this proposal','What needs to change? *',true,'client_proposal_return','Returned to the proposer.');
  if(kind==='approve')ask('Approve and apply','Note (optional)',false,'client_proposal_approve','Approved and applied to the client record.');
  if(kind==='withdraw'){try{await request({action:'client_proposal_withdraw',...base});await ctx.load();ctx.notice('Proposal withdrawn.');}catch(err){ctx.notice(err.message,true);}}
 });
}
