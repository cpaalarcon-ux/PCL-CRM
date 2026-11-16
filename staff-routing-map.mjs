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
export function createRoutingMapUI(ctx){
 const {$,esc,field,select,form,modal,request,notice}=ctx,d=()=>ctx.data();
 const leaderRole=()=>['PARTNER','MANAGER'].includes(d().me?.category_code),canUse=()=>!['INTERN','ADMIN'].includes(d().me?.category_code);
 let cid='',cur=null;
 function pickClient(){
  const clients=(d().clients||[]).map(c=>[c.client_id,c.legal_name||c.name||c.client_id]);
  modal('Client routing map',form(select('client_id','Client *',clients,'','Choose a client'),'Open'),async f=>{if(!f.get('client_id'))throw Error('Choose a client.');return f.get('client_id');},id=>open(id),{refreshWorkspace:false,pendingLabel:'Opening…',pendingMessage:'Opening the routing map.',successMessage:'Opened.'});
 }
 async function open(clientId){cid=clientId;cur=await request({action:'routing_map_read',client_id:cid});paint();}
 const accountList=()=>(cur.accounts||[]).map(a=>[a.code,`${a.code} · ${a.name}`]);
 function paint(){
  const maps=cur.maps||[],rows=mapRows(maps,{me:d().me,esc});
  modal('Routing map',`<p class="info full">${esc(ROUTING_NOTE)}</p><div class="actions">${leaderRole()?'<button type="button" data-rm="add">Propose a mapping</button><button type="button" data-rm="copy">Copy from another client</button>':''}</div>${rows?`<div class="scroll full"><table id="routingMapTable"><thead><tr><th>For</th><th>Routing code</th><th>Client account</th><th>Valid</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted full">No routing mappings yet for this client.</p>'}`);
  const body=$('#editorBody');if(body)body.onclick=async ev=>{const b=ev.target.closest('[data-rm]');if(!b)return;const id=b.dataset.id,rev=b.dataset.rev,act=b.dataset.rm;
   try{
    if(act==='add')add();
    else if(act==='copy')copyFrom();
    else if(act==='approve')modal('Approve mapping',form('<p class="info full">You did not propose this. Approve only after checking the account is right for this client, as the Engagement Partner. Every purchase row with the code, dated inside the mapping, will then be mapped automatically for review.</p>','Approve'),()=>request({action:'routing_map_approve',client_id:cid,routing_id:id,revision:rev}),()=>open(cid),{refreshWorkspace:false});
    else if(act==='end')modal('End mapping',form(field('effective_to','Last day it applies *','','date')+`<label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'End'),f=>request({action:'routing_map_end',client_id:cid,routing_id:id,revision:rev,effective_to:f.get('effective_to'),reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false});
    else if(act==='withdraw')modal('Withdraw mapping',form(`<p class="info full">Rows already mapped keep their classification, but no new row is mapped by it.</p><label class="full">Why? *<textarea name="reason" required minlength="10" maxlength="500"></textarea></label>`,'Withdraw'),f=>request({action:'routing_map_withdraw',client_id:cid,routing_id:id,revision:rev,reason:f.get('reason')}),()=>open(cid),{refreshWorkspace:false});
   }catch(err){notice(err.message,true);}
  };
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
