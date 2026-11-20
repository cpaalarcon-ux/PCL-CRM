// Build 2847: how the client card and the client file show the server's work-ready answer. Presentation only: the page never works the gates out itself.
// The server (client_work_ready) returns {ready, gates, progress} for each client; this file turns that into a badge reason list, a progress bar,
// the first thing to fix, and the gate list on the client file. Nothing here approves, posts or decides a rule.

// The first open gate decides what the card's main button offers. Order is the server's order: KYC, PIN, engagement, letter, then the Partner's chart choice.
const GATE_ACTION={
 kyc:{label:'Complete KYC',attr:id=>`data-suite="compliance" data-id="${id}"`},
 pin:{label:'Fix the KRA PIN',attr:id=>`data-v3="client" data-id="${id}"`},
 engagement:{label:'Create the engagement',attr:id=>`data-client-open="${id}" data-client-tab="projects"`},
 letter:{label:'Add the signed letter',attr:id=>`data-client-open="${id}" data-client-tab="projects"`},
 chart:{label:'Approve the chart',attr:id=>`data-setup-guide="${id}"`}
};
export function gateAction(wr,id){
 if(!wr||wr.ready)return null;
 const g=(wr.gates||[]).find(x=>!x.ok);
 const a=g&&GATE_ACTION[g.key];
 return a?{label:a.label,attr:a.attr(id),key:g.key}:null;
}

// The lines the badge tooltip shows when the card is red because a gate is open.
export const gateReasons=wr=>wr&&!wr.ready?(wr.gates||[]).filter(g=>!g.ok).map(g=>g.detail?`${g.label}: ${g.detail}`:g.label):[];

// The set-up progress bar. Shown only while something is outstanding. The bar is amber and never blocks the card; the tooltip names what is missing.
export function progressBar(wr,id,esc){
 const pr=wr?.progress;if(!pr)return '';
 const before=pr.needed_before_posting||[];
 if(pr.pct>=100&&!before.length)return '';
 const names=(pr.missing||[]).map(m=>m.label);
 const tip=(names.length?'Missing: '+names.join('; ')+'.':'All nine set-up sections are approved.')+(before.length?' Needed before posting: '+before.join(' and ')+'.':'')+(wr.ready?' The client can still be worked on.':'');
 const label=`Set-up progress ${pr.pct}%, ${pr.sections_done} of ${pr.sections_total} sections approved`;
 return `<div class="cc-prog" data-set-up-progress="${esc(id)}"><div class="cc-prog-head"><b>Set-up progress</b><small>${pr.pct}% · ${pr.sections_done} of ${pr.sections_total} sections approved</small></div><div class="cc-bar" tabindex="0" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.pct}" aria-label="${esc(label+'. '+tip)}" aria-describedby="cc-prog-tip-${esc(id)}"><i style="width:${pr.pct}%"></i><span class="cc-tip" role="tooltip" id="cc-prog-tip-${esc(id)}">${esc(tip)}</span></div>${before.length&&pr.pct>=100?`<small class="cc-prog-before">Needed before posting: ${esc(before.join(' and '))}</small>`:''}</div>`;
}

// The client file's Overview: each gate with its result, then the progress line. Same facts the card uses.
export function gatesHtml(wr,{esc,requireChart=false}={}){
 if(!wr)return '';
 const pr=wr.progress||{};
 const rows=(wr.gates||[]).map(g=>`<span class="cc-pill ${g.ok?'ok':'warn'}"${g.detail?` title="${esc(g.detail)}"`:''} data-gate="${esc(g.key)}"><i>${g.ok?'✓':'!'}</i>${esc(g.label)}</span>`).join('');
 const head=wr.ready?'Healthy: this client can be worked on':'Action needed before this client is Healthy';
 const note=requireChart?'A Partner has chosen to require an approved Chart of Accounts.':'The Chart of Accounts and the other set-up sections do not hold the status back.';
 return `<div class="spine work-ready" aria-label="Work-ready status"><p class="spine-count"><b>${esc(head)}</b></p><div class="cc-pills">${rows}</div><p class="muted">${esc(note)} Set-up progress: ${pr.pct??0}% (${pr.sections_done??0} of ${pr.sections_total??9} sections approved).${(pr.needed_before_posting||[]).length?` Needed before posting: ${esc((pr.needed_before_posting||[]).join(' and '))}.`:''}</p></div>`;
}

// ---- Settings: the Partner's choice about what Healthy means. Default OFF. Each change is a dated record with a reason; nothing is overwritten. ----
export function statusPolicyCard(state,{esc,fmt=v=>String(v||'').slice(0,10)}={}){
 if(!state)return `<div class="card" id="clientStatusCard"><div class="section-head"><h2>What “Healthy” means on a client card</h2></div><p class="muted">Loading…</p></div>`;
 const on=!!state.require_chart,cur=state.current;
 const line=cur?`Set by <b>${esc(cur.set_by_name)}</b> on ${esc(fmt(cur.set_at))}. Reason: ${esc(cur.reason)}`:'No Partner choice recorded yet, so the default applies.';
 const hist=(state.history||[]).slice(1).map(h=>`<li>${esc(fmt(h.set_at))} · ${h.require_chart?'Required':'Not required'} · ${esc(h.set_by_name)} · ${esc(h.reason)}</li>`).join('');
 const button=state.can_set?`<button type="button" class="primary" data-status-policy="${on?'off':'on'}">${on?'Stop requiring the approved chart':'Require the approved chart'}</button>`:'<p class="muted">Only a Partner can change this.</p>';
 return `<div class="card" id="clientStatusCard"><div class="section-head"><h2>What “Healthy” means on a client card</h2></div><p>A client is <b>Healthy</b> when it can be worked on: KYC verified, a KRA PIN in the right format, an engagement created with a Manager or Partner assigned, and a verified signed engagement letter. The other set-up sections show as a progress bar and never turn the card red.</p><p><b>Require an approved Chart of Accounts before a client is Healthy:</b> <span class="badge ${on?'good':''}">${on?'ON':'OFF (default)'}</span></p><p class="muted">${line}</p><p class="muted">This changes only what the card shows. Posting and reporting still need an approved chart whichever way this is set.</p>${button}${hist?`<details class="section-space"><summary>Earlier choices</summary><ul>${hist}</ul></details>`:''}</div>`;
}
