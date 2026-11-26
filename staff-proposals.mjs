// Propose-and-approve for client onboarding. An Assistant or Supervisor's entry waits here. For an Assistant's entry a Supervisor, Manager or
// Partner checks it first; then a Manager or Partner who is neither the proposer nor the checker approves it. The server and the database
// enforce the same rules; this file only shows the queue and the buttons.
import {canUseAction} from './staff-action-rights.mjs?v=20261119-2906';
import {assistantEntryOpen} from './staff-policies.mjs?v=20261109-dr-v1';
import {legalStructureFields,structureRows} from './staff-legal-structure.mjs?v=20261110-taxrole-v3';
export const PROPOSER_ROLES=Object.freeze(['ASSISTANT','SUPERVISOR']);
export const canPropose=role=>PROPOSER_ROLES.includes(role);
export function addClientButton(data){
 const {category_code:role,restricted_rights:rights}=data.me||{};
 if(rights?.includes('client.details')||!canUseAction(rights,{action:'client_save'},'clients'))return '';
 if(['MANAGER','PARTNER'].includes(role))return '<button type="button" class="primary" data-new="client">+ Add client</button>';
 if(!canPropose(role)||!data.firms?.length||(role==='ASSISTANT'&&!assistantEntryOpen(data)))return '';
 return '<button type="button" class="primary" data-propose="new-client">+ Add client</button><button type="button" class="secondary" data-propose="client-batch">Propose clients from Excel</button><button type="button" class="secondary" data-propose="owner-batch">Propose owners and contacts from Excel</button><button type="button" class="secondary" data-propose="owner-amend">Propose owner share changes from Excel</button>';
}
export const PROPOSAL_HELP='Your entry is saved as a proposal and nothing on the client record changes yet. Every proposal is checked by a Supervisor, Manager or Partner other than the person who proposed it; a Manager or Partner who neither prepared nor checked it then approves it. Each step needs a note of at least 10 characters.';
export const KYC_HELP='The file is stored where only Managers and Partners can open it. It becomes KYC evidence only after a Supervisor, Manager or Partner checks it and a different Manager or Partner approves it. The client must already have a saved KYC profile.';
const OPEN=['Proposed','Checked'];
export function proposalActions(p,me){
 const open=OPEN.includes(p.status),mine=p.proposed_by===me.staff_id,out=[];
 if(!open)return out;
 const lead=['PARTNER','MANAGER'].includes(me.category_code),checker=['SUPERVISOR','MANAGER','PARTNER'].includes(me.category_code);
 if(mine)out.push('withdraw');
 if(!mine&&checker&&p.status==='Proposed')out.push('check');
 if(!mine&&lead&&p.checked_by!==me.staff_id&&p.status==='Checked')out.push('approve');
 if(!mine&&checker)out.push('return');
 return out;
}
const OWNER_BATCH_ACTIONS=['owner_add','owner_share_amend','contact_save'];
const LABEL={check:'Check',approve:'Approve and apply',return:'Return',withdraw:'Withdraw'};
// One batch is the set of proposals created from one workbook. The buttons run the same single-proposal check or approval for each, so no rule is skipped.
export function batchGroups(list,me){
 const lead=['PARTNER','MANAGER'].includes(me.category_code),checker=['SUPERVISOR','MANAGER','PARTNER'].includes(me.category_code),map=new Map();
 // A client batch (CB-) holds "Add client" proposals; an owners batch (OW-) holds "Add owner" and "Add contact" proposals from the client workbook.
 const kindOf=p=>p.action==='client_save'?'client':OWNER_BATCH_ACTIONS.includes(p.action)&&/^O[WA]-/.test(String(p.payload?.batch_ref||''))?'owner':null;
 for(const p of list){const ref=p.payload?.batch_ref;if(!ref||!kindOf(p)||!OPEN.includes(p.status))continue;map.set(ref,[...(map.get(ref)||[]),p]);}
 return [...map].map(([ref,items])=>({ref,kind:kindOf(items[0]),total:items.length,
  check:checker?items.filter(p=>p.status==='Proposed'&&p.proposed_by!==me.staff_id).length:0,
  approve:lead?items.filter(p=>p.status==='Checked'&&p.proposed_by!==me.staff_id&&p.checked_by!==me.staff_id).length:0}));
}
export function batchBar(list,me,esc=v=>String(v??'')){
 const groups=batchGroups(list,me).filter(g=>g.check||g.approve);if(!groups.length)return '';
 return '<div class="info" id="clientBatches">'+groups.map(g=>`<p><b>Batch ${esc(g.ref)}</b> · ${g.total} ${g.kind==='owner'?'owner or contact entr'+(g.total===1?'y':'ies'):'client'+(g.total===1?'':'s')} waiting ${g.check?`<button type="button" class="secondary" data-batch="check" data-kind="${g.kind}" data-ref="${esc(g.ref)}">Check all (${g.check})</button> `:''}${g.approve?`<button type="button" class="primary" data-batch="approve" data-kind="${g.kind}" data-ref="${esc(g.ref)}">Approve all (${g.approve})</button>`:''}</p>`).join('')+'</div>';
}
export function batchIssuesHtml(out,esc=v=>String(v??'')){
 const rows=(items,limit)=>`<table><thead><tr><th>Row</th><th>Column</th><th>Problem</th><th>Suggestion</th></tr></thead><tbody>${items.slice(0,limit).map(x=>`<tr><td>${esc(x.row)}</td><td>${esc(x.column)}</td><td>${esc(x.issue)}</td><td>${esc(x.suggestion||'')}</td></tr>`).join('')}</tbody></table>${items.length>limit?`<p class="muted">Showing the first ${limit} of ${items.length}.</p>`:''}`;
 return `<p class="missing">${esc(out.message||'Nothing was proposed.')}</p>${rows(out.errors||[],100)}`;
}
export function ownerBatchResultHtml(out,esc=v=>String(v??'')){
 const skipped=out.skipped_existing||[],notices=out.notices||[];
 return `<p class="info">${esc(out.message)}</p><p>Owners proposed: <b>${esc(out.owners)}</b> · Contacts proposed: <b>${esc(out.contacts)}</b> · Already on file or waiting (left unchanged): <b>${skipped.length}</b>${notices.length?` · Values not recorded: <b>${notices.length}</b>`:''}</p>${notices.length?`<p><b>Not recorded</b></p><ul>${notices.slice(0,50).map(x=>`<li>Row ${esc(x.row)} · ${esc(x.column)}: ${esc(x.issue)}</li>`).join('')}</ul>${notices.length>50?`<p class="muted">Showing the first 50 of ${notices.length}.</p>`:''}`:''}`;
}
export function proposalsCard(data,esc=v=>String(v??''),nameOf=()=>''){
 const list=data.proposals||[];if(!list.length||!data.me)return '';
 const rows=list.map(p=>{
  const acts=proposalActions(p,data.me).map(a=>`<button type="button" class="${a==='approve'?'primary':'secondary'}" data-proposal="${a}" data-id="${esc(p.proposal_id)}" data-rev="${esc(p.revision)}">${LABEL[a]}</button>`).join(' ');
  const lead=['PARTNER','MANAGER'].includes(data.me.category_code),file=lead&&p.action==='compliance_evidence_save'&&p.payload?.document_id?` <button type="button" class="secondary" data-kyc-file="${esc(p.payload.document_id)}">View file</button>`:'';
  const trail=[`Proposed by ${esc(p.proposed_by_name||nameOf(p.proposed_by)||'a colleague')}`,p.checked_by?`checked by ${esc(p.checked_by_name||nameOf(p.checked_by)||'a colleague')}`:'',p.decided_by?`${p.status==='Returned'?'returned':'approved'} by ${esc(p.decided_by_name||nameOf(p.decided_by)||'a colleague')}`:''].filter(Boolean).join(' · ');
  const note=p.decision_note?`<small class="muted">Note: ${esc(p.decision_note)}</small>`:p.check_note?`<small class="muted">Check note: ${esc(p.check_note)}</small>`:p.reason?`<small class="muted">Reason: ${esc(p.reason)}</small>`:'';
  return `<tr><td><b>${esc(p.summary)}</b>${p.company_name?`<small class="muted">${esc(p.company_name)}</small>`:''}${note}</td><td><span class="badge ${p.status==='Approved'?'good':p.status==='Returned'||p.status==='Withdrawn'?'warn':'info'}">${esc(p.status)}</span></td><td><small>${trail}</small></td><td class="actions">${acts}${file}</td></tr>`;
 }).join('');
 const waiting=list.filter(p=>OPEN.includes(p.status)).length;
 return `<details class="settings-fold" id="proposalsCard" data-preserve-open>
  <summary id="proposalsSummary">Proposals <span class="badge ${waiting?'warn':'good'}">${waiting} waiting</span></summary>
  <div><p class="muted">${esc(PROPOSAL_HELP)}</p>${batchBar(list,data.me,esc)}
   <table><thead><tr><th>Change</th><th>Status</th><th>Who</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  </div>
 </details>`;
}
export function proposeButtons(clientId,role,suiteButton,esc=v=>String(v??'')){
 if(!canPropose(role))return '';
 return `<button type="button" class="secondary" data-propose="client" data-id="${esc(clientId)}">Propose details change</button>`+`<button type="button" class="secondary" data-propose="kyc" data-id="${esc(clientId)}">Propose KYC file</button>`+suiteButton('contact-new','Propose contact',clientId)+suiteButton('owner-new','Propose owner',clientId);
}
export function bindProposals(ctx){
 const {esc,field,select,options,form,modal,request,data}=ctx;
 document.addEventListener('click',async e=>{
  if(e.target.closest('[data-propose="new-client"]')){
   const workspace=data(),firms=workspace.firms||[];
   if(!canPropose(workspace.me?.category_code)||!addClientButton(workspace))return;
   const initialFirm=ctx.currentFirm();
   const firmOptions=options(firms.map(f=>[f.firm_id,f.firm_code+' · '+f.legal_name]),firms.length===1?firms[0].firm_id:initialFirm);
   modal('Propose a new client',form(
    '<p class="info full">Send the client details for an independent check and approval. The client will appear in the register after approval.</p>'+
    field('company_name','Registered client name *','','text','required maxlength="200"')+
    `<label>Handling firm *<select name="firm_id" required>${firmOptions}</select></label>`+
    field('kra_pin','KRA PIN','','text','maxlength="11"')+
    select('branch_location','Branch',['Nairobi','Bungoma','Kisii','Other'])+
    legalStructureFields({rows:structureRows(workspace),esc,options})+
    field('proposal_reason','Note for the reviewer','','text','maxlength="300"'),
    'Send for review'
   ),f=>{
    const {firm_id,...fields}=Object.fromEntries(f);
    return request({action:'client_save',...fields,firm_ids:[firm_id]});
   },undefined,{successMessage:'New client proposal sent for review. Follow its progress under Proposals.'});
   return;
  }
  if(e.target.closest('[data-propose="client-batch"]')){
   const workspace=data(),firms=workspace.firms||[];
   if(!canPropose(workspace.me?.category_code)||!firms.length)return;
   const firmOptions=options(firms.map(f=>[f.firm_id,f.firm_code+' · '+f.legal_name]),firms.length===1?firms[0].firm_id:ctx.currentFirm());
   modal('Propose clients from an Excel workbook',form(
    '<p class="info full">Use the PCL client workbook. The “Client Import” sheet lists the clients; “Client Details”, “Industry &amp; Activities” and “Contacts” are matched by KRA PIN. Every row is checked first. If one row has a problem, nothing is proposed. Each client then waits for an independent check and approval. A client that is already on file is left alone unless you tick “Also update clients already on file”.</p>'+
    `<label>Handling firm *<select name="firm_id" required>${firmOptions}</select></label>`+
    field('file','Workbook (.xlsx) *','','file','required accept=".xlsx"')+
    '<label class="full"><input type="checkbox" name="existing" value="update"> Also update clients already on file. Only what the workbook adds or changes is proposed (sector, branch, category, and details not yet recorded). Blank cells never erase anything and recorded details are never overwritten.</label>',
    'Check and propose'
   ),async f=>{
    const file=f.get('file');if(!file||!file.name)throw Error('Choose the workbook.');
    const up=new FormData();up.set('firm_id',f.get('firm_id'));up.set('file',file);if(f.get('existing'))up.set('existing','update');
    const out=await request(up,{file:true,uploadKind:'client_batch'});
    if(out.status==='VALIDATION_FAILED'){setTimeout(()=>modal('Nothing was proposed',batchIssuesHtml(out,esc)),20);return;}
    setTimeout(()=>modal('Proposals sent for review',`<p class="info">${esc(out.message)}</p><p>Proposed: <b>${out.proposed.length}</b>${out.updates?` (changes to existing clients: <b>${out.updates}</b>)`:''} · Already clients (left unchanged): <b>${out.skipped_existing.length}</b>${out.notices?.length?` · Values tidied or not recorded: <b>${out.notices.length}</b>`:''}</p>${out.proposed.some(x=>x.update)?`<p><b>Changes proposed</b></p><ul>${out.proposed.filter(x=>x.update).map(x=>`<li>Row ${esc(x.row)} · ${esc(x.name)}: ${esc(x.changes.join('; '))}</li>`).join('')}</ul>`:''}${out.skipped_existing.length?`<ul>${out.skipped_existing.map(x=>`<li>Row ${esc(x.row)} · ${esc(x.name)}${x.reason?': '+esc(x.reason):''}</li>`).join('')}</ul>`:''}`),20);
   },undefined,{successMessage:'Workbook checked. Proposals are waiting under Proposals.'});
   return;
  }
  if(e.target.closest('[data-propose="owner-batch"]')){
   if(!canPropose(data().me?.category_code))return;
   modal('Propose owners and contacts from an Excel workbook',form(
    '<p class="info full">Use the PCL client workbook. The “Beneficial Owners” sheet lists the owners and directors of each client, matched by client KRA PIN; they are recorded as the client’s beneficial owners. “Contacts” is loaded too when it is there. Every client must already be on file. Every owner needs a share, and each client’s shares must total 100%. Every row is checked first. If one row has a problem, nothing is proposed. Each owner and contact then waits for an independent check and approval. No ID or passport number is read or kept, and screening results are not loaded.</p>'+
    field('file','Workbook (.xlsx) *','','file','required accept=".xlsx"'),
    'Check and propose'
   ),async f=>{
    const file=f.get('file');if(!file||!file.name)throw Error('Choose the workbook.');
    const up=new FormData();up.set('file',file);
    const out=await request(up,{file:true,uploadKind:'owner_batch'});
    if(out.status==='VALIDATION_FAILED'){setTimeout(()=>modal('Nothing was proposed',batchIssuesHtml(out,esc)),20);return;}
    setTimeout(()=>modal(out.proposed.length?'Proposals sent for review':'Nothing new to propose',ownerBatchResultHtml(out,esc)),20);
   },undefined,{successMessage:'Workbook checked. See the result.'});
   return;
  }
  if(e.target.closest('[data-propose="owner-amend"]')){
   if(!canPropose(data().me?.category_code))return;
   modal('Propose owner share changes from an Excel workbook',form(
    '<p class="info full">Use the workbook\'s “Owner Amendments” sheet. Each row changes the share of an owner who is already on the client\'s record, matched by client KRA PIN and the owner\'s name. Every row needs the new share, the evidence it rests on (for example “CR12 dated 20 Nov 2026”), who saw it and the date. After the changes, each client\'s owners must total 100%. Nothing changes on a client record until a different person checks the proposals and a Manager or Partner approves them.</p>'+
    field('file','Workbook (.xlsx) *','','file','required accept=".xlsx"'),
    'Check and propose'
   ),async f=>{
    const file=f.get('file');if(!file||!file.name)throw Error('Choose the workbook.');
    const up=new FormData();up.set('file',file);up.set('mode','amend');
    const out=await request(up,{file:true,uploadKind:'owner_batch'});
    if(out.status==='VALIDATION_FAILED'){setTimeout(()=>modal('Nothing was proposed',batchIssuesHtml(out,esc)),20);return;}
    setTimeout(()=>modal(out.proposed.length?'Proposals sent for review':'Nothing to propose',ownerBatchResultHtml(out,esc)),20);
   },undefined,{successMessage:'Workbook checked. See the result.'});
   return;
  }
  const bb=e.target.closest('[data-batch]');
  if(bb){
   const kind=bb.dataset.batch,ref=bb.dataset.ref,title=kind==='check'?'Check every proposal in this batch':'Approve every proposal in this batch';
   modal(title,form(`<p class="info full">Batch ${esc(ref)}. This runs the same check or approval that one proposal would get, one entry at a time, under your name. An entry you are not allowed to handle is skipped and listed.</p>`+field('note',kind==='check'?'Check conclusion * (at least 10 characters)':'Approval note * (at least 10 characters)','','text','required minlength="10" maxlength="500"'),title),async f=>{
    const out=await request({action:(bb.dataset.kind==='owner'?'owner_batch_':'client_batch_')+(kind==='check'?'check':'approve'),batch_ref:ref,note:f.get('note')});
    setTimeout(()=>modal('Batch result',`<p>${kind==='check'?'Checked':'Approved'}: <b>${out.done.length}</b> · Held back: <b>${out.held.length}</b></p>${out.held.length?`<ul>${out.held.map(x=>`<li>${esc(x.name)}: ${esc(x.reason)}</li>`).join('')}</ul>`:''}${kind==='approve'&&out.done.some(x=>x.activity)?`<p class="muted">Business activities are prepared for a different Manager or Partner to apply: ${out.done.filter(x=>x.activity==='submitted').length} ready, ${out.done.filter(x=>x.activity&&x.activity!=='submitted'&&x.activity!=='none').length} to do by hand.</p>`:''}`),20);
   },undefined,{successMessage:kind==='check'?'Batch checked.':'Batch approved.'});
   return;
  }
  const pb=e.target.closest('[data-propose="client"]');
  if(pb){
   const c=data().clients.find(x=>x.client_id===pb.dataset.id);if(!c)return;
   modal(`Propose a change: ${c.company_name}`,form(`<p class="info full">${esc(PROPOSAL_HELP)}</p>`+field('company_name','Company name *',c.company_name,'text','required maxlength="200"')+field('kra_pin','KRA PIN',c.kra_pin||'','text','maxlength="11"')+field('primary_sector','Primary sector',c.primary_sector||'','text','maxlength="100"')+field('proposal_reason','Why is this change needed? *','','text','required maxlength="300"'),'Send for review'),f=>{
    const v=Object.fromEntries(f);return request({action:'client_save',client_id:c.client_id,revision:c.revision,firm_ids:(data().client_firms||[]).filter(x=>x.client_id===c.client_id).map(x=>x.firm_id),...v});
   },undefined,{successMessage:'Proposal sent for review. Nothing on the client record has changed yet.'});
   return;
  }
  const kf=e.target.closest('[data-kyc-file]');
  if(kf){kf.disabled=true;try{const blob=await request({action:'download',document_id:kf.dataset.kycFile},{blob:true}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download='kyc-file';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}catch(err){ctx.notice(err.message,true);}finally{kf.disabled=false;}return;}
  const kb=e.target.closest('[data-propose="kyc"]');
  if(kb){
   const c=data().clients.find(x=>x.client_id===kb.dataset.id);if(!c)return;
   let rules=[];try{rules=(await request({action:'kyc_proposal_options'})).rules||[];}catch(err){ctx.notice(err.message,true);return;}
   const firm=(data().client_firms||[]).find(x=>x.client_id===c.client_id)?.firm_id;
   if(!firm){ctx.notice('This client has no handling firm yet, so a KYC file cannot be proposed.',true);return;}
   const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
   modal(`Propose a KYC file: ${c.company_name}`,form(`<p class="info full">${esc(KYC_HELP)}</p><label class="full">Evidence type *<select name="document_type" required><option value="">Choose…</option>${rules.map(r=>`<option value="${esc(r.rule_code)}">${esc(r.label)}</option>`).join('')}</select></label>`+field('file','File (PDF, PNG or JPEG) *','','file','required accept=".pdf,.png,.jpg,.jpeg"')+field('evidence_date','Date of the document *',today,'date','required max="'+today+'"')+field('expires_on','Expiry date, if it has one','','date','')+field('proposal_reason','Note for the reviewer','','text','maxlength="500"'),'Upload and propose'),async f=>{
    const file=f.get('file');if(!file||!file.name)throw Error('Choose the KYC file.');
    const up=new FormData();up.set('client_id',c.client_id);up.set('firm_id',firm);up.set('category','KYC Pending');up.set('file',file);
    const saved=await request(up,{file:true});
    return request({action:'compliance_evidence_save',client_id:c.client_id,document_type:f.get('document_type'),evidence_form:'upload',document_id:saved.document_id,evidence_date:f.get('evidence_date'),expires_on:f.get('expires_on')||null,proposal_reason:f.get('proposal_reason')||''});
   },undefined,{successMessage:'KYC file proposed. Only Managers and Partners can open it, and nothing is recorded as evidence until one of them approves.'});
   return;
  }
  const b=e.target.closest('[data-proposal]');if(!b)return;
  const kind=b.dataset.proposal,base={proposal_id:b.dataset.id,revision:b.dataset.rev},p=(data().proposals||[]).find(x=>x.proposal_id===b.dataset.id);
  let details='';
  if(p?.action==='client_save'&&!p.client_id&&p.payload){
   const {company_name,kra_pin,branch_location,legal_structure,legal_subtype,primary_sector,firm_ids}=p.payload;
   const firms=(Array.isArray(firm_ids)?firm_ids:[]).map(id=>(data().firms||[]).find(f=>f.firm_id===id)?.legal_name||'Firm unavailable').join(', ');
   const items=[['Registered client name',company_name],['Handling firm',firms],['KRA PIN',kra_pin],['Branch',branch_location],['Legal structure',legal_structure],['Subcategory',legal_subtype],['Sector',primary_sector],['Proposer note',p.reason]];
   details=`<dl class="full">${items.filter(([,value])=>value).map(([label,value])=>`<dt><b>${label}</b></dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
  }
  const ask=(title,label,required,action,success)=>modal(title,form(`<p class="info full">${esc(p?.summary||'')}</p>`+details+field('note',label,'','text',required?'required minlength="10" maxlength="500"':'maxlength="500"'),title),f=>request({action,...base,note:f.get('note')||''}),undefined,{successMessage:success});
  if(kind==='check')ask('Check this proposal','Check conclusion * (at least 10 characters)',true,'client_proposal_check','Checked. A Manager or Partner can now approve it.');
  if(kind==='return')ask('Return this proposal','What needs to change? * (at least 10 characters)',true,'client_proposal_return','Returned to the proposer.');
  if(kind==='approve')ask('Approve and apply','Approval note * (at least 10 characters)',true,'client_proposal_approve','Approved and applied to the client record.');
  if(kind==='withdraw'){try{await request({action:'client_proposal_withdraw',...base});await ctx.load();ctx.notice('Proposal withdrawn.');}catch(err){ctx.notice(err.message,true);}}
 });
}
