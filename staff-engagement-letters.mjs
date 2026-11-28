// Engagement letters list screen. Pure markup; the actions are in engagement-letter-actions.ts.
const STATES=['Missing','Uploaded, not linked','Not verified','Expired','Verified'];
export function lettersHtml(r,{esc,state=''}){
 const c=r.counts||{};
 const chips=STATES.map(s=>`<button type="button" class="${state===s?'primary':''}" data-letter-state="${esc(s)}">${esc(s)} (${esc(c[s]||0)})</button>`).join('');
 const rows=(r.rows||[]);
 const table=rows.length?`<div class="scroll"><table><thead><tr><th>Client</th><th>Engagement</th><th>Letter</th><th>Expires</th><th>Uploaded file</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${esc(x.company_name)}</td><td>${esc(x.project_name)} <span class="muted">(${esc(x.project_status)})</span></td><td>${esc(x.letter_state)}</td><td>${esc(x.letter_expires_on?String(x.letter_expires_on).slice(0,10):'')}</td><td>${esc(x.uploaded_file||'')}</td></tr>`).join('')}</tbody></table></div>${r.total>rows.length&&!state?'<p class="muted">Showing the first 500. Pick a state above to narrow the list.</p>':''}`:'<p class="info">No engagements in this state.</p>';
 return `<p class="info">${esc(r.total||0)} open engagement${r.total===1?'':'s'}. A letter is signed outside the system and uploaded to the engagement as a PDF; billing stays locked until it is verified.</p><div class="actions">${chips}<button type="button" id="letterShowAll">Show all</button><button type="button" id="letterLinkReady">Link uploaded letters…</button></div>${table}`;
}
export function linkHtml(r,{esc}){
 const left=r.left||[];
 const leftList=left.length?`<details open><summary>Left for another person (${left.length})</summary><div class="scroll"><table><thead><tr><th>Client</th><th>Engagement</th><th>Why</th></tr></thead><tbody>${left.slice(0,200).map(x=>`<tr><td>${esc(x.company_name)}</td><td>${esc(x.project_name)}</td><td>${esc(x.why||'')}</td></tr>`).join('')}</tbody></table></div></details>`:'';
 if(!r.ready)return `<p class="info">No uploaded letters are waiting to be linked.</p>${leftList}`;
 if(r.over_limit)return `<p class="info"><b>${esc(r.ready)}</b> letters are ready, which is more than can be linked at once (200). Verify the rest on each engagement.</p>${leftList}`;
 return `<p class="info"><b>${esc(r.ready)}</b> uploaded signed letter${r.ready===1?'':'s'} can be linked and marked verified by you${r.sole_partner?', including any you uploaded, as your firm’s only Partner':'. Letters you uploaded yourself are left for another Manager or Partner'}. Expiry dates are not set here; add them on the engagement.</p>${leftList}
 <label>Why you are linking these (at least 10 characters)<input id="letterNote" maxlength="1000" placeholder="For example: opened each PDF and checked the signatures and dates"></label>
 <div class="actions"><label class="check"><input type="checkbox" id="letterConfirm"> I have opened these letters</label><button type="button" class="primary" id="letterApply" disabled>Link ${esc(r.ready)} letter${r.ready===1?'':'s'}</button></div>`;
}
export function linkDoneHtml(r,{esc}){
 return `<p class="info">Linked and verified <b>${esc(r.linked)}</b> letter${r.linked===1?'':'s'}.${(r.left||[]).length?` ${esc(r.left.length)} left for another person.`:''}</p>`;
}
