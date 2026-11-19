// The approved routing map (build 2802). One list per client of which of the client's accounts a routing code posts to, for purchases, sales and payroll.
// A Manager or Partner proposes a mapping; a Partner who did not propose it approves it. An approved mapping is ended on a date or withdrawn with a reason, never edited.
// Once approved, every purchase row with that routing code and an invoice date inside the mapping is mapped automatically as "Mapped, awaiting review". Nothing is posted.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
export const ROUTING_NOTE='A routing code says which of the client\'s accounts a purchase, sale or payroll line belongs to. Approve it once and every row with that code is mapped automatically for the dates it covers, ready for review. Rows with no approved mapping, or more than one, are listed with the reason. Nothing is posted by a mapping.';
export function mapRows(maps,{me,esc=e0}){
 const mine=me?.staff_id,leader=['PARTNER','MANAGER'].includes(me?.category_code),partner=me?.category_code==='PARTNER';
 return (maps||[]).map(m=>{
  const acts=[m.status==='Draft'&&partner&&m.created_by!==mine?`<button type="button" data-rm="approve" data-id="${esc(m.routing_id)}" data-rev="${esc(m.revision)}">Approve</button>`:'',
   m.status==='Active'&&leader&&!m.effective_to?`<button type="button" data-rm="end" data-id="${esc(m.routing_id)}" data-rev="${esc(m.revision)}">End on a date</button>`:'',
   m.status!=='Inactive'&&(leader||m.status==='Draft'&&m.created_by===mine)?`<button type="button" data-rm="withdraw" data-id="${esc(m.routing_id)}" data-rev="${esc(m.revision)}">Withdraw</button>`:''].join(' ');
  const state=m.status==='Active'?(m.effective_to?'Ended':'Approved'):m.status==='Draft'?'Waiting for approval':'Withdrawn';
  return `<tr data-status="${esc(m.status)}"><td>${esc(m.module)}</td><td><b>${esc(m.routing_code)}</b><small>Version ${esc(m.version||1)}</small>${m.item_code?`<small>TB item code ${esc(m.item_code)}</small>`:''}</td><td>${esc(m.erp_account_code)} · ${esc(m.account_name||'')}${m.side?`<small>${esc(m.side)}</small>`:''}</td><td>${esc(day(m.effective_from))} to ${m.effective_to?esc(day(m.effective_to)):'open'}</td><td><span class="badge ${m.status==='Active'&&!m.effective_to?'good':m.status==='Draft'?'warn':''}">${esc(state)}</span>${m.approved_by_name?`<small>${esc(m.approved_by_name)}</small>`:m.created_by_name?`<small>Proposed by ${esc(m.created_by_name)}</small>`:''}${m.closed_reason?`<small>${esc(m.closed_reason)}</small>`:''}</td><td>${acts}</td></tr>`;
 }).join('');
}
// The Manager's queue (firm approval rule): valid routing code and TB code pairs from uploads that have no approved mapping. Nothing here is mapped or posted.
export function queueRows(queue,{esc=e0}={}){
 const pairs=queue?.pairs||[];
 return pairs.map(x=>`<tr data-state="${esc(x.state)}"><td><b>${esc(x.routing_code)}</b></td><td>${esc(x.tb_code)}${x.account_name?` · ${esc(x.account_name)}`:''}</td><td>${esc(x.rows)}</td><td>${esc(x.first_date)}${x.last_date!==x.first_date?' to '+esc(x.last_date):''}</td><td>${esc(x.state)}${x.drafted_by_name?`<small>Proposed by ${esc(x.drafted_by_name)}</small>`:''}</td><td>${queue.can_propose&&!x.draft_id?`<button type="button" data-rm="suggest" data-rc="${esc(x.routing_code)}" data-tb="${esc(x.tb_code)}">Propose this mapping</button>`:''}</td></tr>`).join('');
}
// Supplier aliases (build 2899, amendment F): which approved routing code and TB item code a supplier's exact text uses. An alias never approves a pair; it is dated and never edited.
export const ALIAS_NOTE='An alias tells the system that a supplier name, written exactly like this on the invoices, uses a routing code and TB item code you have already approved. Only an exact match after trimming and ignoring capitals, spaces and punctuation maps a row; similar names never do. An alias cannot approve a pair, and a Partner who did not propose it must approve it.';
export function aliasRows(list,{me,esc=e0}={}){
 const mine=me?.staff_id,leader=['PARTNER','MANAGER'].includes(me?.category_code),partner=me?.category_code==='PARTNER';
 return (list||[]).map(x=>{
  const acts=[x.status==='Draft'&&partner&&x.created_by!==mine?`<button type="button" data-rm="alias-approve" data-id="${esc(x.alias_id)}" data-rev="${esc(x.revision)}">Approve</button>`:'',
   x.status==='Active'&&leader&&!x.effective_to?`<button type="button" data-rm="alias-end" data-id="${esc(x.alias_id)}" data-rev="${esc(x.revision)}">End on a date</button>`:'',
   x.status!=='Inactive'&&leader?`<button type="button" data-rm="alias-withdraw" data-id="${esc(x.alias_id)}" data-rev="${esc(x.revision)}">Withdraw</button>`:''].join(' ');
  const state=x.status==='Active'?(x.effective_to?'Ended':'Approved'):x.status==='Draft'?'Waiting for approval':'Withdrawn';
  return `<tr data-status="${esc(x.status)}"><td><b>${esc(x.party_label)}</b>${x.description_key?`<small>Description: ${esc(x.description_key)}</small>`:''}</td><td>${esc(x.routing_code)}</td><td>${esc(x.item_code)}${x.account_name?` · ${esc(x.account_name)}`:''}</td><td>${esc(day(x.effective_from))}${x.effective_to?' to '+esc(day(x.effective_to)):' onwards'}</td><td>${esc(state)}${x.created_by_name?`<small>Proposed by ${esc(x.created_by_name)}</small>`:''}${x.approved_by_name?`<small>Approved by ${esc(x.approved_by_name)}</small>`:''}${x.closed_reason?`<small>${esc(x.closed_reason)}</small>`:''}</td><td>${acts}</td></tr>`;
 }).join('');
}
export function createRoutingMapUI(ctx){
 const {$,esc,field,select,form,modal,request,notice}=ctx,d=()=>ctx.data();
 const leaderRole=()=>['PARTNER','MANAGER'].includes(d().me?.category_code),canUse=()=>!['INTERN','ADMIN'].includes(d().me?.category_code);
 let cid='',cur=null;const approvable=()=>d().me?.category_code==='PARTNER'?(cur?.maps||[]).filter(m=>m.status==='Draft'&&m.created_by!==d().me.staff_id):[];
 function pickClient(){
  const clients=(d().clients||[]).map(c=>[c.client_id,c.legal_name||c.name||c.client_id]);
  modal('Client routing map',form(select('client_id','Client *',clients,'','Choose a client'),'Open'),async f=>{if(!f.get('client_id'))throw Error('Choose a client.');return f.get('client_id');},id=>open(id),{refreshWorkspace:false,pendingLabel:'Opening…',pendingMessage:'Opening the routing map.',successMessage:'Opened.'});
 }
 async function open(clientId){cid=clientId;cur=await request({action:'routing_map_read',client_id:cid});cur.queue=await request({action:'routing_map_suggestions',client_id:cid}).catch(()=>null);cur.alias=await request({action:'routing_map_alias_read',client_id:cid}).catch(()=>null);paint();}
 const aliasPanel=()=>{const l=cur.alias?.aliases||[],r=aliasRows(l,{me:d().me,esc});return `<section class="info full" id="routingAliases"><h3>Supplier aliases</h3><p>${esc(ALIAS_NOTE)}</p>${leaderRole()?'<div class="actions"><button type="button" data-rm="alias-add">Propose an alias</button></div>':''}${r?`<div class="scroll full"><table id="routingAliasTable"><thead><tr><th>Supplier text</th><th>Routing code</th><th>TB item code</th><th>Valid</th><th>State</th><th></th></tr></thead><tbody>${r}</tbody></table></div>`:'<p class="muted">No aliases yet for this client.</p>'}</section>`;};
 const accountList=()=>(cur.accounts||[]).map(a=>[a.code,`${a.code} · ${a.name}`]);
 const queuePanel=()=>{const q=cur.queue,qr=q?queueRows(q,{esc}):'';return qr?`<section class="info full" id="routingQueue"><h3>Suggested - Awaiting Approval · ${(q.pairs||[]).length} pair${(q.pairs||[]).length===1?'':'s'}</h3><p>These uploaded routing code and TB code pairs are valid, but no mapping is approved for this client, so nothing is mapped or posted. A Manager proposes each pair; a Partner who did not propose it approves it. Rows missing a code (${esc(q.exception_rows||0)} now) stay in the exception queue for manual review.</p><div class="actions">${q.can_propose&&(q.pairs||[]).some(x=>!x.draft_id)?'<button type="button" data-rm="suggest-all">Propose all</button>':''}</div><div class="scroll"><table><thead><tr><th>Routing code</th><th>TB code</th><th>Rows</th><th>Dates</th><th>State</th><th></th></tr></thead><tbody>${qr}</tbody></table></div></section>`:'';};
 function paint(){
  const maps=cur.maps||[],rows=mapRows(maps,{me:d().me,esc});const approvableList=approvable();
  modal('Routing map',`<p class="info full">${esc(ROUTING_NOTE)}</p><div class="actions">${leaderRole()?'<button type="button" data-rm="add">Propose a mapping</button><button type="button" data-rm="copy">Copy from another client</button>':''}${approvableList.length?`<button type="button" data-rm="approve-all">Approve all ${approvableList.length} draft${approvableList.length===1?'':'s'} I did not propose</button>`:''}</div>${queuePanel()}${rows?`<div class="scroll full"><table id="routingMapTable"><thead><tr><th>For</th><th>Routing code</th><th>Client account</th><th>Valid</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted full">No routing mappings yet for this client.</p>'}${aliasPanel()}`);
  const body=$('#editorBody');if(body)body.onclick=async ev=>{const b=ev.target.closest('[data-rm]');if(!b)return;const id=b.dataset.id,rev=b.dataset.rev,act=b.dataset.rm;
   try{
    if(act==='add')add();
    else if(act==='alias-add')addAlias();
    else if(act==='alias-approve')modal('Approve alias',form('<p class="info full">You did not propose this. Approve only after checking that this supplier text always belongs to this routing code and TB item code. The alias does not approve the pair itself; the pair is already approved. Rows still unmapped will map automatically for review.</p>','Approve'),()=>request({action:'routing_map_alias_approve',client_id:cid,alias_id:id,revision:rev}),()=>open(cid),{refreshWorkspace:false,pendingLabel:'Approving…',pendingMessage:'Approving the alias.'});
    else if(act==='alias-end')modal('End alias',form(field('effective_to','Last day it applies *','','date')+`<label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'End'),f=>request({action:'routing_map_alias_end',client_id:cid,alias_id:id,revision:rev,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false,pendingLabel:'Ending…',pendingMessage:'Ending the alias.'});
    else if(act==='alias-withdraw')modal('Withdraw alias',form('<p class="info full">Rows already mapped keep their account, but no new row is mapped by this alias.</p><label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>','Withdraw'),f=>request({action:'routing_map_alias_withdraw',client_id:cid,alias_id:id,revision:rev,reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false,pendingLabel:'Withdrawing…',pendingMessage:'Withdrawing the alias.'});
    else if(act==='copy')copyFrom();
    else if(act==='suggest'||act==='suggest-all'){const pairs=act==='suggest'?[{routing_code:b.dataset.rc,tb_code:b.dataset.tb}]:(cur.queue.pairs||[]).filter(x=>!x.draft_id).map(x=>({routing_code:x.routing_code,tb_code:x.tb_code}));const out=await request({action:'routing_map_suggest_propose',client_id:cid,pairs});notice(`${out.saved} draft mapping${out.saved===1?'':'s'} proposed. A Partner who did not propose them approves each one.`+(out.problems?.length?` ${out.problems.length} could not be proposed: ${out.problems[0].issues[0]}`:''));await open(cid);}
    else if(act==='approve-all'){const ids=approvable().map(m=>m.routing_id);modal('Approve all drafts',form(`<p class="info full">You are about to approve ${ids.length} mapping${ids.length===1?'':'s'} that you did not propose: ${esc(approvable().map(m=>m.routing_code+(m.item_code?' / '+m.item_code:'')+' → '+m.erp_account_code).slice(0,12).join('; '))}${ids.length>12?'…':''}. Check the accounts are right for this client. Every purchase row with these codes, dated inside the mapping, is then mapped automatically for review. Nothing is posted. If you proposed any of them, nothing is approved.</p>`,'Approve all'),()=>request({action:'routing_map_approve_batch',client_id:cid,routing_ids:ids}),()=>open(cid),{refreshWorkspace:false,pendingLabel:'Approving…',pendingMessage:'Approving the drafts.',successMessage:'Approved.'});}
    else if(act==='approve')modal('Approve mapping',form('<p class="info full">You did not propose this. Approve only after checking the account is right for this client, as the Engagement Partner. Every purchase row with the code, dated inside the mapping, will then be mapped automatically for review.</p>','Approve'),()=>request({action:'routing_map_approve',client_id:cid,routing_id:id,revision:rev}),()=>open(cid),{refreshWorkspace:false});
    else if(act==='end')modal('End mapping',form(field('effective_to','Last day it applies *','','date')+`<label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'End'),f=>request({action:'routing_map_end',client_id:cid,routing_id:id,revision:rev,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false});
    else if(act==='withdraw')modal('Withdraw mapping',form(`<p class="info full">Rows already mapped keep their classification, but no new row is mapped by it.</p><label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'Withdraw'),f=>request({action:'routing_map_withdraw',client_id:cid,routing_id:id,revision:rev,reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false});
   }catch(err){notice(err.message,true);}
  };
 }
 function addAlias(){
  const pairs=(cur.alias?.approved_pairs||[]).map(x=>[x.routing_code+'|'+x.item_code,`${x.routing_code} with TB item code ${x.item_code}`]);
  if(!pairs.length){notice('There is no approved purchase mapping yet. A Partner approves the routing code and TB item code first; an alias only points to an approved pair.',true);return;}
  modal('Propose a supplier alias',form(field('party','Supplier name, exactly as on the invoices *','','text')+field('description','Description (only if the same supplier uses different codes for different goods)','','text')+select('pair','Approved pair it uses *',pairs,'','Choose an approved pair')+field('effective_from','Applies from *','','date')+field('effective_to','Applies until (optional)','','date'),'Propose'),
   f=>{const pair=String(f.get('pair')||'').split('|');return request({action:'routing_map_alias_propose',client_id:cid,party:f.get('party'),description:f.get('description')||null,routing_code:pair[0],item_code:pair[1],effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null});},
   ()=>{notice('Alias proposed. A Partner who did not propose it must approve it before it maps anything.');return open(cid);},{refreshWorkspace:false,pendingLabel:'Proposing…',pendingMessage:'Saving the proposed alias.'});
 }
 function copyFrom(){
  const clients=(d().clients||[]).filter(c=>c.client_id!==cid).map(c=>[c.client_id,c.legal_name||c.name||c.client_id]);
  modal('Copy routing map as drafts',form('<p class="info full">The other client\'s approved mappings that are in force today become new drafts for this client. Nothing maps anything until a different Partner approves each one. Codes this client already has are skipped.</p>'+select('from_client_id','Copy from *',clients,'','Choose a client')+field('effective_from','Apply from *','','date','required'),'Copy as drafts'),
   f=>request({action:'routing_map_copy',client_id:cid,from_client_id:f.get('from_client_id'),effective_from:f.get('effective_from')}),out=>{notice('Copied '+out.saved+' of '+out.offered+' as drafts'+(out.skipped.length?'; '+out.skipped.length+' skipped':'')+'.');return open(cid);},{refreshWorkspace:false,pendingLabel:'Copying…',pendingMessage:'Copying the approved mappings as drafts.',successMessage:'Copied.'});
 }
 function add(){
  const codes=(cur.payroll_codes||[]).map(x=>[x.code,`${x.code} · ${x.label}`]);
  modal('Propose a mapping',form(select('module','For *',['Purchases','Sales','Payroll'],'Purchases','Choose')+field('routing_code','Routing code * (for payroll, one of: '+(codes.map(c=>c[0]).join(', '))+')','','text')+field('item_code','TB item code (optional: only to choose between several accounts for one purchase code)','','text')+select('erp_account_code','Client account *',accountList(),'','Choose an account')+field('effective_from','Applies from *','','date')+field('effective_to','Applies to (leave blank if open)','','date')+field('label','Note (optional)','','text'),'Propose'),
   f=>request({action:'routing_map_propose',client_id:cid,module:f.get('module'),routing_code:f.get('routing_code'),item_code:f.get('item_code')||null,erp_account_code:f.get('erp_account_code'),effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,label:f.get('label')||null}),()=>open(cid),{refreshWorkspace:false});
 }
 // From a client's own Client Setup screen the id is given and that client's map opens; from the Settings register no client is named, so one is chosen first.
 async function handle(action,id){
  if(action!=='routing-map-open')return false;
  if(id){if($('#editor')?.open)$('#editor').close();await open(id);return true;}
  pickClient();return true;
 }
 return {open,handle,canUse};
}
