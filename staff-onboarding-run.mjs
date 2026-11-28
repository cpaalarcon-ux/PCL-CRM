// Onboarding run screen. Pure markup; the read is client_setup_onboarding_run and nothing on this screen changes a record.
export function runHtml(r,{esc,open=''}){
 const stages=r.stages||[],c=r.counts||{};
 const cards=stages.map(s=>{
  const n=c[s.key]||0,btn=s.action&&n&&s.key!=='DONE'?`<button type="button" class="primary" data-run-go="${esc(s.action)}" data-run-op="${esc(s.op||'')}">Open</button>`:'';
  const names=(r.rows||[]).filter(x=>x.stage===s.key);
  const list=n?`<details${open===s.key?' open':''}><summary>${esc(n)} client${n===1?'':'s'}</summary><div class="scroll"><ul>${names.slice(0,200).map(x=>`<li>${esc(x.company_name)}</li>`).join('')}</ul>${names.length>200?`<p class="muted">Showing 200 of ${esc(names.length)}.</p>`:''}</div></details>`:'<span class="muted">None</span>';
  return `<tr><td><b>${esc(s.label)}</b><div class="muted">${esc(s.help)}</div></td><td>${list}</td><td>${btn}</td></tr>`;
 }).join('');
 return `<p class="info">${esc(r.total||0)} active client${r.total===1?'':'s'}. Each client is shown at the first step it has not finished. Nothing changes here: <b>Open</b> goes to the screen that does that step for many clients at once.</p>
 <div class="scroll"><table><thead><tr><th>Step</th><th>Clients waiting</th><th></th></tr></thead><tbody>${cards}</tbody></table></div>`;
}
