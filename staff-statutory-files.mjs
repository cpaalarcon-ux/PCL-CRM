// Statutory return file screens (build 2829): NSSF, SHIF and PAYE (P10) files from a confirmed payroll summary.
// The server (statutory-file-actions.ts, statutory-file-rules.mjs) owns every rule. This module only draws the readiness, the reconciliation and the download.
const kes=v=>v==null||v===''?'':Number(v).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const FILES_NOTE='A statutory file is built from a confirmed payroll summary. It is released only when every column the agency needs is filled from the payroll register, the file\'s totals equal the confirmed summary, and the summary agrees with the posted payroll journal. Each release is recorded with who produced it, the layout used and a fingerprint of the file.';
export const KIND_BUTTONS=[['NSSF','NSSF file'],['SHIF','SHIF file'],['PAYE_P10','PAYE (P10) workings']];
export function monthsPanel(r,esc){
 const rows=(r.months||[]).map(m=>`<tr><td>${esc(m.month)}</td><td class="num">${esc(m.employees)}</td><td>${m.journal_posted?'<span class="badge good">Journal posted</span>':'<span class="badge warn">Journal not posted</span>'}</td><td>${KIND_BUTTONS.map(([k,l])=>`<button type="button" data-period-action="statutory-prepare" data-id="${esc(m.import_id)}" data-kind="${esc(k)}">${esc(l)}</button>`).join('')}</td></tr>`).join('');
 const made=(r.exports||[]).slice(0,8).map(x=>`<li>${esc(x.month)} · ${esc(x.file_kind==='PAYE_P10'?'PAYE (P10)':x.file_kind)} · ${esc(x.row_count)} rows · ${esc(x.generated_by_name||'')} · ${esc(String(x.generated_at||'').slice(0,10))}</li>`).join('');
 return `<p class="info full">${esc(FILES_NOTE)}</p>${rows?`<div class="scroll"><table id="statutoryMonths"><thead><tr><th>Month</th><th class="num">Employees</th><th>Books</th><th>Build</th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted">No confirmed payroll summary yet. Confirm a month\'s payroll first.</p>'}${made?`<h4>Released files</h4><ul>${made}</ul>`:''}`;
}
// "Configure this setting" for a blocker that a setting fixes (build 2837). The button takes the person to that setting and brings them back here.
export function configureKinds(issues){
 const kinds=[];
 if((issues||[]).some(i=>/No published export profile/.test(i)))kinds.push('export_profile');
 if((issues||[]).some(i=>/No approved payroll mapping/.test(i)))kinds.push('routing_map');
 return kinds;
}
const CONFIGURE_FROM='the statutory file';
export const configureHtml=(issues,esc)=>configureKinds(issues).map(k=>`<button type="button" class="configure-link" data-suite="configure-go" data-id="${esc(k)}::${esc(CONFIGURE_FROM)}">Configure this setting${k==='export_profile'?' (export profile)':' (payroll mapping)'}</button>`).join(' ');
export function resultPanel(x,esc){
 const issues=(x.issues||[]).length?`<div class="notice error"><b>Not ready to release</b><ul>${x.issues.map(i=>`<li>${esc(i)}</li>`).join('')}</ul>${configureHtml(x.issues,esc)}</div>`:'<p><span class="badge good">Ready to release</span></p>';
 const rec=x.reconciliation||{},recLines=(rec.lines||[]).map(l=>`<tr><td>${esc(l.account_code)}</td><td class="num">${kes(l.expected)}</td><td class="num">${kes(l.posted)}</td><td class="num">${l.difference?`<b>${kes(l.difference)}</b>`:kes(l.difference)}</td></tr>`).join('');
 const t=Object.entries(x.totals||{}).map(([k,v])=>`<tr><td>${esc(k.replaceAll('_',' '))}</td><td class="num">${k==='employees'?esc(v):kes(v)}</td></tr>`).join('');
 const e=x.section_e?Object.entries(x.section_e).map(([k,v])=>`<tr><td>${esc(k.replaceAll('_',' '))}</td><td class="num">${/members|employees/.test(k)?esc(v):kes(v)}</td></tr>`).join(''):'';
 const head=(x.layout?.columns||[]).map(c=>`<th>${esc(c)}</th>`).join('');
 const body=(x.preview||[]).slice(0,25).map(r=>`<tr>${r.map(c=>`<td${typeof c==='number'?' class="num"':''}>${typeof c==='number'?kes(c):esc(c)}</td>`).join('')}</tr>`).join('');
 return `<p><b>${esc(x.layout?.label||'')}</b> · ${esc(x.month)} · ${esc(x.row_count)} rows<small> Layout ${esc(x.layout?.code||'')} from ${esc(x.layout?.source||'')}</small></p>`
  +(x.not_the_agency_file?'<p class="info full">This is the Section B workings in the P10 template\'s column order, for pasting into the official KRA P10 workbook. It is not the KRA file itself: the workbook recalculates and validates it.</p>':'')
  +(x.profile?`<p class="muted">Export profile version ${esc(x.profile.version)}: ${esc(x.profile.template_version)}. Checked ${esc(x.profile.verified_on)} against ${esc(x.profile.verified_against)}.</p>`:'')
  +issues+((x.notes||[]).length?`<ul class="muted">${x.notes.map(n=>`<li>${esc(n)}</li>`).join('')}</ul>`:'')
  +(x.needs_default_confirmation?'<label class="full"><input type="checkbox" id="statutoryDefaults"> Primary Employee and no disability apply to people not on the register.</label>':'')
  +`<h4>Totals</h4><table><tbody>${t}</tbody></table>`+(e?`<h4>P10 Section E</h4><table><tbody>${e}</tbody></table>`:'')
  +(Object.keys(x.rounding||{}).length?`<h4>Rounding in this file</h4><table><thead><tr><th>Column</th><th class="num">Exact</th><th class="num">In the file</th><th class="num">Difference</th></tr></thead><tbody>${Object.entries(x.rounding).map(([c,v])=>`<tr><td>${esc(c)}</td><td class="num">${kes(v.exact)}</td><td class="num">${kes(v.rounded)}</td><td class="num">${kes(v.difference)}</td></tr>`).join('')}</tbody></table>`:'')
  +(x.extra_tables||[]).map(t=>`<h4>${esc(t.label)} · ${esc(t.row_count)} rows</h4><table><tbody>${Object.entries(t.totals||{}).map(([k,v])=>`<tr><td>${esc(k)}</td><td class="num">${kes(v)}</td></tr>`).join('')}</tbody></table>`).join('')
  +`<h4>Posted journal: ${esc(rec.status||'')}${rec.journal_reference?' ('+esc(rec.journal_reference)+')':''}</h4>`+(recLines?`<div class="scroll"><table><thead><tr><th>Account</th><th class="num">From the summary</th><th class="num">Posted</th><th class="num">Difference</th></tr></thead><tbody>${recLines}</tbody></table></div>`:'')
  +(body?`<h4>First rows</h4><div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`:'')
  +`<div class="actions">${x.ready?`<button type="button" data-period-action="statutory-release" data-id="${esc(x.import_id)}" data-kind="${esc(x.kind)}">Release and download</button>`:''}<button type="button" data-period-action="statutory-files">Back</button></div>`;
}
export function idsForm(p,field,select,esc){
 const opt=(list,cur)=>list.map(x=>[x,x]);
 return `<p class="muted full">These details are the ones NSSF, SHA and KRA ask for and the payroll summary does not carry. Fill them once; every later file uses them.</p>`
  +field('surname','Surname',p.surname||'','text','maxlength="80"')+field('other_names','Other names',p.other_names||'','text','maxlength="120"')
  +select('id_type','ID type',opt(['National ID','Passport','Alien ID']),p.id_type||'','Choose')
  +field('payroll_number','Payroll number',p.payroll_number||'','text','maxlength="30"')+field('nssf_number','NSSF number',p.nssf_number||'','text','maxlength="20"')+field('sha_number','SHA (SHIF) number',p.sha_number||'','text','maxlength="20"')
  +select('p10_employee_type','P10 type of employee',opt(['Primary Employee','Secondary Employee']),p.p10_employee_type||'Primary Employee')
  +`<label><input type="checkbox" name="disability" value="yes"${p.disability?' checked':''}> Person with a disability</label>`+field('exemption_certificate','Exemption certificate number (disability)',p.exemption_certificate||'','text','maxlength="50"');
}
export function downloadCsv(name,csv){
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
