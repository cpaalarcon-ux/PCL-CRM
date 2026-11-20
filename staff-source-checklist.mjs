// Source files checklist panel for a tax period. Read-only: it lists what the review gate already checks.
export const STATE_TEXT={Provided:'Provided',Deferred:'Deferred',Missing:'Missing'};
export function sourceChecklistPanel(list,{esc=s=>String(s??'')}={}){
 if(!list||!Array.isArray(list.items)||!list.items.length)return '';
 const rows=list.items.map(i=>`<tr><td>${esc(i.label)}</td><td><span class="badge ${i.state==='Provided'?'ok':i.state==='Deferred'?'warn':'bad'}">${esc(STATE_TEXT[i.state]||i.state)}</span></td><td>${esc(i.detail)}</td></tr>`).join('');
 return `<section class="info section-space" id="sourceChecklist"><h3>Source files for this period</h3><p class="muted">${list.complete?'All source files are in. Review decisions and reconciliations are still checked below.':'The period cannot be sent to review until each line is Provided, or the bank is deferred and approved.'}</p><table><thead><tr><th>Source</th><th>State</th><th>What is needed</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}
