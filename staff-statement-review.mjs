// Statement-line mapping review (build 2839), opened from Settings. A Partner reviews the Draft mappings in groups instead of approving them blind:
// mappings that are consistent are shown one group per statement line with every account listed, mappings already approved on the same line are shown apart, and exceptions
// are listed one by one with the reason each one needs a decision. The server (ledger_statement_map_review_*, statement-review-rules.mjs) classifies, and re-checks at approval time.
// A group is approved only after the reviewer ticks that they reviewed the accounts listed. The reviewer is recorded on every mapping. Nothing is posted by a mapping.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const REVIEW_NOTE='A Partner who did not propose a mapping approves it. Consistent mappings are approved by statement line; everything else is decided one by one with a reason. The person approving is recorded on every mapping, and an approved mapping is never edited: a change ends it and starts a new one.';
const btn=(action,label,id='',extra='')=>`<button type="button" data-suite="${action}" data-id="${e0(id)}" ${extra}>${e0(label)}</button>`;
export function summaryLine(s){
 return `<p id="stmtSummary"><b>${e0(s.total)}</b> mapping${s.total===1?'':'s'} waiting: <b>${e0(s.consistent)}</b> consistent, <b>${e0(s.unchanged)}</b> already approved on the same line, <b>${e0(s.exceptions)}</b> exception${s.exceptions===1?'':'s'}${s.blocked?` (${e0(s.blocked)} cannot be approved yet)`:''}.</p>`;
}
export function groupBlock(g,{canApprove,esc=e0}={}){
 const rows=g.accounts.map(a=>`<tr><td>${esc(a.account_code)}</td><td>${esc(a.account_name)}</td><td>${esc(a.effective_from)}</td><td>${a.seeded?'Seeded':'Proposed'}</td></tr>`).join('');
 return `<details class="card section-space" data-group="${esc(g.line_code)}"><summary><b>${esc(g.label)}</b> <small>${esc(g.statement)} · ${esc(g.count)} account${g.count===1?'':'s'}</small></summary>
  <div class="scroll"><table><thead><tr><th>Account</th><th>Name</th><th>From</th><th>Origin</th></tr></thead><tbody>${rows}</tbody></table></div>
  ${canApprove?`<label class="full"><input type="checkbox" data-stmt-ack="${esc(g.line_code)}"> I reviewed the ${esc(g.count)} account${g.count===1?'':'s'} listed for ${esc(g.label)}.</label>${btn('stmt-review-group','Approve this group',g.line_code)}`:''}</details>`;
}
export function exceptionRow(x,{canApprove,esc=e0}={}){
 const reasons=x.reasons.map(r=>`<li>${esc(r.text)}${r.blocks?' <span class="badge bad">Blocks approval</span>':''}</li>`).join('');
 const replaces=x.replaces?`<small>Replaces its approved line ${esc(x.replaces.line_code)} (from ${esc(x.replaces.from)}).</small>`:'';
 const act=canApprove?`<label class="sr-only" for="stmtNote_${esc(x.map_id)}">Reason</label><input id="stmtNote_${esc(x.map_id)}" data-stmt-note="${esc(x.map_id)}" maxlength="500" placeholder="Reason (at least 10 characters)">${x.blocked?'':btn('stmt-review-one','Approve with reason',x.map_id)} ${btn('stmt-review-reject','Reject',x.map_id)}`:'';
 return `<tr data-exception="${esc(x.map_id)}"><td><b>${esc(x.account_code)}</b> ${esc(x.account_name)}</td><td>${esc(x.line_label)}<small>${esc(x.line_statement)} · from ${esc(x.effective_from)}</small>${replaces}</td><td><ul>${reasons}</ul></td><td>${act}</td></tr>`;
}
export function reviewView(r,{canApprove=false,esc=e0}={}){
 const s=r.summary,groups=r.groups.map(g=>groupBlock(g,{canApprove,esc})).join('');
 const consistentTotal=r.groups.reduce((n,g)=>n+g.count,0),tooMany=consistentTotal>r.max_batch;
 const all=canApprove&&consistentTotal?`<div class="info full"><label><input type="checkbox" id="stmtAckAll"${tooMany?' disabled':''}> I reviewed every consistent group below (${esc(consistentTotal)} accounts).</label> ${tooMany?`<small>Approve by group: more than ${esc(r.max_batch)} at once is not allowed.</small>`:btn('stmt-review-all','Approve all consistent groups')}<label class="full">Note for the record (optional)<input id="stmtGroupNote" maxlength="500"></label></div>`:'';
 const unchanged=r.unchanged.length?`<h3>Already approved on the same line (${esc(r.unchanged.length)})</h3><p class="muted">Nothing to approve: the account is already on this line. Reject the draft to clear it.</p><ul>${r.unchanged.map(x=>`<li>${esc(x.account_code)} ${esc(x.account_name)} on ${esc(x.line_label)}${canApprove?` ${btn('stmt-review-reject','Reject draft',x.map_id)}`:''}</li>`).join('')}</ul>`:'';
 const ex=r.exceptions.length?`<h3>Exceptions (${esc(r.exceptions.length)})</h3><div class="scroll"><table id="stmtExceptions"><thead><tr><th>Account</th><th>Proposed line</th><th>Why it needs a decision</th><th>Decision</th></tr></thead><tbody>${r.exceptions.map(x=>exceptionRow(x,{canApprove,esc})).join('')}</tbody></table></div>`:'';
 return `<p class="info full">${esc(REVIEW_NOTE)}</p>${summaryLine(s)}${s.total===0?'<p class="ok">Nothing is waiting for review.</p>':''}${all}${r.groups.length?`<h3>Consistent (${esc(consistentTotal)})</h3><p class="muted">The account's own statement matches the line's statement, the account is active, and it has no other change waiting.</p>${groups}`:''}${unchanged}${ex}${canApprove?'':'<p class="muted">A Partner approves. You can read the review.</p>'}`;
}
export function createStatementReviewUI(ctx){
 const {request,modal,notice}=ctx;
 let cur=null;
 const canApprove=()=>ctx.data().me?.category_code==='PARTNER';
 async function load(){cur=await request({action:'ledger_statement_map_review_read'});}
 function paint(){modal('Statement-line mapping review',reviewView(cur,{canApprove:canApprove(),esc:e0}),null,null,{refreshWorkspace:false});}
 async function open(){try{await load();paint();}catch(e){notice(e.message||'The review could not be opened.',true);}}
 const ack=sel=>!!document.querySelector(sel)?.checked;
 async function approve(payload,done){
  try{const r=await request({action:'ledger_statement_map_review_approve',...payload});notice(`${r.reviewed} mapping${r.reviewed===1?'':'s'} approved. Approved by you and recorded on each one.`);await load();paint();if(done)done(r);}
  catch(e){notice(e.message||'The approval did not go through.',true);}
 }
 async function handle(action,id){
  if(action==='stmt-review-open'){await open();return true;}
  if(!['stmt-review-group','stmt-review-all','stmt-review-one','stmt-review-reject'].includes(action))return false;
  if(!cur)return true;
  const note=()=>String(document.querySelector('#stmtGroupNote')?.value||'');
  if(action==='stmt-review-group'){
   if(!ack(`[data-stmt-ack="${id}"]`)){notice('Tick that you reviewed the accounts in this group first.',true);return true;}
   const g=cur.groups.find(x=>x.line_code===id);if(!g)return true;
   await approve({scope:'group',map_ids:g.accounts.map(a=>a.map_id),review_note:''});return true;
  }
  if(action==='stmt-review-all'){
   if(!ack('#stmtAckAll')){notice('Tick that you reviewed every consistent group first.',true);return true;}
   await approve({scope:'group',map_ids:cur.groups.flatMap(g=>g.accounts.map(a=>a.map_id)),review_note:note()});return true;
  }
  const reason=String(document.querySelector(`[data-stmt-note="${id}"]`)?.value||'').trim();
  if(action==='stmt-review-one'){await approve({scope:'one',map_id:id,review_note:reason});return true;}
  if(action==='stmt-review-reject'){
   if(reason.length<10&&!cur.unchanged.some(x=>x.map_id===id)){notice('Say why you reject it (at least 10 characters).',true);return true;}
   try{const r=await request({action:'ledger_statement_map_reject',map_ids:[id],review_note:reason||'Already approved on this line; the draft is not needed.'});notice(`${r.reviewed} mapping rejected.`);await load();paint();}
   catch(e){notice(e.message||'The rejection did not go through.',true);}
   return true;
  }
  return false;
 }
 return {open,handle,view:()=>cur};
}
