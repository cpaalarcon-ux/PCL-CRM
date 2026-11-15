// Report-readiness checklist shown beside the download choices (build 2815). The server works out every check and refuses a final export that has not passed;
// this only displays the list and says which download is available.
export function gateHtml(result,esc=v=>String(v??'')){
 const g=result&&result.gate;if(!g||!Array.isArray(g.checks))return '<p class="muted">The checks could not be read.</p>';
 const rows=g.checks.map(c=>`<li class="${c.ok?'ok':'bad'}"><b>${c.ok?'Passed':'Open'}:</b> ${esc(c.label)}${c.ok?'':'<br><span class="muted">'+esc(c.detail)+'</span>'}</li>`).join('');
 const head=g.ready?'<p class="ok" role="status"><b>All checks passed.</b> The final report can be downloaded.</p>':`<p class="info" role="status"><b>${g.checks.filter(c=>!c.ok).length} check(s) open.</b> You can download a draft preview, marked Draft on every sheet. The final report stays blocked until every check passes.</p>`;
 const declared=(result.sources||[]).filter(x=>x.declared);
 const decl=declared.length?`<p class="muted">${declared.length} source month(s) are covered by a documented "nothing to report" declaration. That satisfies the source check only; it does not file or acknowledge any return.</p>`:'';
 const warn=(g.warnings||[]).length?`<ul class="gate-warnings">${g.warnings.map(w=>`<li class="warn"><b>Warning, not a blocker:</b> ${esc(w.label)}<br><span class="muted">${esc(w.detail)}</span></li>`).join('')}</ul>`:'';
 return head+`<ul class="gate-checks">${rows}</ul>`+decl+warn;
}
// The "nothing to report" declarations of one client year: the active and ended ones, and the form to record another.
export function declarationsHtml(result,esc=v=>String(v??'')){
 const list=(result&&result.declarations)||[];
 const rows=list.map(d=>`<tr><td>${esc(d.month)}</td><td>${esc(d.source_label)}</td><td>${esc(d.obligation_code)}</td><td>${esc(d.declarant_name)}<br><span class="muted">${esc(d.declared_on)}</span></td><td>${esc(d.reason)}${d.status==='Ended'?`<br><span class="muted">Ended: ${esc(d.ended_reason)}</span>`:''}</td><td>${d.status==='Active'?`<span class="badge ok">Active</span> <button type="button" data-ledger="decl-end" data-id="${esc(d.declaration_id)}">End</button>`:'<span class="badge warn">Ended</span>'}</td></tr>`).join('');
 return (list.length?`<table class="declarations"><thead><tr><th>Month</th><th>Source</th><th>Obligation</th><th>Declared by</th><th>Reason</th><th></th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="muted">No declaration is recorded for this client year.</p>')
  +'<p class="info">A declaration says there is nothing to report for one source, obligation and month. It satisfies the source check for that month only. It does not file a NIL return or record an acknowledgement; those stay separate steps. It cannot be recorded for a month that already has data.</p>';
}
export const finalAvailable=result=>!!(result&&result.gate&&result.gate.ready);
