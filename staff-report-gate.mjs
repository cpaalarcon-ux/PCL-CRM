// Report-readiness checklist shown beside the download choices (build 2815). The server works out every check and refuses a final export that has not passed;
// this only displays the list and says which download is available.
export function gateHtml(result,esc=v=>String(v??'')){
 const g=result&&result.gate;if(!g||!Array.isArray(g.checks))return '<p class="muted">The checks could not be read.</p>';
 const rows=g.checks.map(c=>`<li class="${c.ok?'ok':'bad'}"><b>${c.ok?'Passed':'Open'}:</b> ${esc(c.label)}${c.ok?'':'<br><span class="muted">'+esc(c.detail)+'</span>'}</li>`).join('');
 const head=g.ready?'<p class="ok" role="status"><b>All checks passed.</b> The final report can be downloaded.</p>':`<p class="info" role="status"><b>${g.checks.filter(c=>!c.ok).length} check(s) open.</b> You can download a draft preview, marked Draft on every sheet. The final report stays blocked until every check passes.</p>`;
 return head+`<ul class="gate-checks">${rows}</ul>`;
}
export const finalAvailable=result=>!!(result&&result.gate&&result.gate.ready);
