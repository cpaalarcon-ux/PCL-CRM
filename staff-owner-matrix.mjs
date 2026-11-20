// Owner Matrix (build 2839), under Settings > Access & Approvals. One table of every settings section, who the build suggests should own it, and who a Partner has confirmed.
// A Partner confirms the owners of many sections in one pass. A confirmation is never edited: confirming a different owner ends the earlier one and keeps it in the history.
// An owner is information for staff (who prepares, reviews and approves a section). It changes nobody's rights, and the person who prepared a record still never approves it.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const MATRIX_NOTE='The owner of a section is who prepares, reviews and approves it. Owners shown as suggestions come from the build and have not been confirmed. Confirming an owner does not change anyone\'s rights: each setting\'s own approval rule still applies, and the person who prepared a record never approves it.';
// picks: {section_key:{role,staff_id}} from the form. Only rows whose choice differs from what is confirmed are sent.
export function ownerItems(rows,picks){
 const out=[];
 for(const r of rows||[]){
  const p=picks?.[r.key];if(!p||!p.role)continue;
  const cur=r.confirmed;
  if(cur&&cur.role===p.role&&String(cur.staff_id||'')===String(p.staff_id||''))continue;
  out.push({section_key:r.key,owner_role:p.role,staff_id:p.staff_id||undefined});
 }
 return out;
}
export function matrixView(m,{esc=e0}={}){
 const roleOpts=(sel)=>`<option value="">Choose…</option>${m.roles.map(r=>`<option value="${esc(r.code)}"${r.code===sel?' selected':''}>${esc(r.label)}</option>`).join('')}`;
 const staffOpts=(sel)=>`<option value="">No named person</option>${m.staff.map(s=>`<option value="${esc(s.staff_id)}"${s.staff_id===sel?' selected':''}>${esc(s.name)}</option>`).join('')}`;
 let last='';
 const body=m.rows.map(r=>{
  const head=r.group!==last?(last=r.group,`<tr class="hub-group"><th colspan="${m.can_confirm?4:3}">${esc(r.group)}</th></tr>`):'';
  const c=r.confirmed;
  const now=c?`<span class="badge ok">Confirmed</span> ${esc(c.role_label)}${c.staff_name?' · '+esc(c.staff_name):''}<small>by ${esc(c.confirmed_by||'')} on ${esc(String(c.confirmed_at||'').slice(0,10))}</small>`:`<span class="badge warn">Suggestion</span> ${esc(r.suggested_owner||'No suggestion')}`;
  const edit=m.can_confirm?`<td><select name="role" data-owner-role="${esc(r.key)}" aria-label="Owner of ${esc(r.title)}">${roleOpts(c?c.role:(r.suggested_role||''))}</select> <select data-owner-staff="${esc(r.key)}" aria-label="Named person for ${esc(r.title)}">${staffOpts(c?c.staff_id:'')}</select></td>`:'';
  return `${head}<tr data-owner-row="${esc(r.key)}"><td><b>${esc(r.title)}</b>${r.where?`<small>${esc(r.where)}</small>`:''}</td><td>${now}</td>${m.can_confirm?edit:''}</tr>`;
 }).join('');
 return `<p class="info full">${esc(MATRIX_NOTE)}</p><p><b>${esc(m.confirmed)}</b> of ${esc(m.rows.length)} sections have a confirmed owner.</p>
  <div class="scroll"><table id="ownerMatrix"><thead><tr><th>Section</th><th>Owner now</th>${m.can_confirm?'<th>Confirm as</th>':''}</tr></thead><tbody>${body}</tbody></table></div>
  ${m.can_confirm?'<p class="muted">The role shown first for an unconfirmed section is the build\'s suggestion. Nothing is confirmed until you press the button.</p><button type="button" class="primary" data-suite="owners-confirm" data-id="">Confirm the owners shown</button>':'<p class="muted">A Partner confirms owners.</p>'}`;
}
export function createOwnerMatrixUI(ctx){
 const {request,notice}=ctx;
 let m=null,loading=false,failed='';
 async function load(){
  if(loading)return;loading=true;
  try{const r=await request({action:'settings_owners_read'});if(!r||!Array.isArray(r.rows)||!Array.isArray(r.roles))throw Error('The owner matrix answer was not in the expected form.');m=r;failed='';}catch(e){failed=e.message||'The owner matrix could not be loaded.';}
  finally{loading=false;ctx.render();}
 }
 function card(){
  if(!['PARTNER','MANAGER'].includes(ctx.data().me?.category_code))return '';
  const head=inner=>`<section class="card settings-card" id="ownerMatrixCard"><h2>Owner Matrix</h2><p class="muted">Who owns each settings section. A Partner confirms; Managers can read it.</p>${inner}</section>`;
  if(!m&&!failed){queueMicrotask(load);return head('<p class="muted">Loading…</p>');}
  if(failed)return head(`<p class="error" role="alert">${e0(failed)}</p>`);
  return head(matrixView(m));
 }
 async function handle(action){
  if(action!=='owners-confirm')return false;
  const picks={};
  for(const el of document.querySelectorAll('[data-owner-role]')){const k=el.dataset.ownerRole;picks[k]={role:el.value,staff_id:document.querySelector(`[data-owner-staff="${k}"]`)?.value||''};}
  const items=ownerItems(m?.rows||[],picks);
  if(!items.length){notice('Nothing has changed. Choose an owner for a section first.',true);return true;}
  try{const r=await request({action:'settings_owners_confirm',items});m=null;ctx.hubRefresh?.();notice(`${r.confirmed} owner${r.confirmed===1?'':'s'} confirmed${r.unchanged?`, ${r.unchanged} unchanged`:''}. Confirmed by you and kept in the history.`);ctx.render();}
  catch(e){notice(e.message||'The owners were not confirmed.',true);}
  return true;
 }
 return {card,handle,refresh:()=>{m=null;failed='';}};
}
