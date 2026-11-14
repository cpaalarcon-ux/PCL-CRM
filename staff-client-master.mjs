// Client master (build 2807). Each key fact about a client carries its source and is verified by a different person.
// The screen lists every required fact with its state, so a reviewer only has to look at the exceptions. Every step is authorised again on the server.
export function createClientMasterUI(ctx,{show,button}){
 const {esc,field,select,form,request,notice,shortDate}=ctx,d=()=>ctx.data();
 let last=null;
 const tone={Verified:'good',Recorded:'warn',Differs:'bad',Missing:'bad'};
 const badge=s=>`<span class="badge ${tone[s]||''}">${esc(s)}</span>`;
 const reviewer=()=>['PARTNER','MANAGER','SUPERVISOR'].includes(d().me.category_code);
 function source(f){if(!f)return '';const doc=f.source_kind==='Document'?(f.document_name?esc(f.document_name):'Document'):esc(f.source_reference||'');return `${esc(f.source_kind)}${doc?' · '+doc:''}`;}
 function table(x){
  const rows=x.rows.map(r=>{
   const f=r.fact,acts=[];
   if(x.can_record)acts.push(button('cm-record',f?'Replace':'Record',x.client.client_id,`data-key="${esc(r.key)}"`));
   if(r.can_verify)acts.push(button('cm-verify','Verify',x.client.client_id,`data-key="${esc(r.key)}"`));
   return `<tr${r.state!=='Verified'?' class="exception"':''}><td>${esc(r.label)}</td><td>${f?esc(f.value):'<span class="muted">Not recorded</span>'}</td><td>${source(f)}</td><td>${badge(r.state)}${r.issue?`<small>${esc(r.issue)}</small>`:''}${f&&f.verified_at?`<small>Verified by ${esc(f.verified_by_name||'a colleague')} on ${esc(shortDate(f.verified_at))}</small>`:''}</td><td>${acts.join(' ')}</td></tr>`;
  }).join('');
  return `<div class="scroll"><table><thead><tr><th>Fact</th><th>Value</th><th>Source</th><th>State</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
 }
 function view(x){
  last=x;
  const timing=x.ready_at?`<p class="badge good">Ready ${esc(shortDate(x.ready_at))}${x.minutes_to_ready!=null?' · '+esc(String(x.minutes_to_ready))+' minutes from the first fact':''}</p>`:x.started_at?`<p class="muted">Started ${esc(shortDate(x.started_at))}.</p>`:'';
  const hist=x.history.length?`<details><summary>Replaced facts (${x.history.length})</summary><ul>${x.history.map(h=>`<li>${esc(h.field_key)}: ${esc(h.value)} (${esc(h.source_kind)}) · replaced ${esc(shortDate(h.superseded_at))}: ${esc(h.superseded_reason)}</li>`).join('')}</ul></details>`:'';
  show('Client master · '+x.client.company_name,`<p><b>${esc(x.client.legal_entity_type||'Legal entity not set')}</b> · ${x.verified} of ${x.required} facts verified (${x.percent}%)</p>${timing}<p class="info full">${esc(x.note)}</p>${x.exceptions.length?`<p><b>${x.exceptions.length} to look at.</b> Everything else is verified.</p>`:'<p class="badge good">Every required fact is verified.</p>'}${table(x)}${hist}<div class="actions">${reviewer()?button('cm-report','Set-up time report',x.client.client_id):''}</div>`);
 }
 async function open(cid){view(await request({action:'client_master_read',client_id:cid}));}
 async function handle(a,cid,key){
  if(a==='cm-report'){
   const r=await request({action:'client_master_report'});show('Client set-up time',`<p class="info full">${esc(r.summary.note)}</p><p>${r.summary.clients_ready} of ${r.summary.clients_started} clients ready · average ${r.summary.average_minutes==null?'not yet measured':esc(String(r.summary.average_minutes))+' minutes'}</p><div class="scroll"><table><thead><tr><th>Client</th><th>Started</th><th>Ready</th><th>Minutes</th><th>Client statement only</th></tr></thead><tbody>${r.rows.map(x=>`<tr><td>${esc(x.company_name)}</td><td>${esc(shortDate(x.started_at))}</td><td>${x.ready_at?esc(shortDate(x.ready_at)):'Not yet'}</td><td>${x.minutes==null?'':esc(String(x.minutes))}</td><td>${esc(String(x.statement_only))}</td></tr>`).join('')}</tbody></table></div>`);return;
  }
  const row=last.rows.find(r=>r.key===key);if(!row)return;
  if(a==='cm-record'){
   const docs=(d().documents||[]).filter(x=>!x.client_id||x.client_id===cid).map(x=>[x.document_id,x.file_name]);
   show((row.fact?'Replace ':'Record ')+row.label.toLowerCase(),form(`<p class="info full">${esc(row.hint||'')}</p>`+field('value',row.label+' *',row.fact?row.fact.value:'','text','required maxlength="500"')+select('source_kind','Where did this come from? *',last.source_kinds,'Document')+`<label class="full">Document (when the source is a document)<select name="document_id"><option value="">None</option>${docs.map(([i,n])=>`<option value="${esc(i)}">${esc(n)}</option>`).join('')}</select></label>`+field('source_reference','Register, record or import file (when that is the source)','','text','maxlength="300"')+(row.fact?`<label class="full">Why is it being replaced? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`:''),'Save fact'),
    f=>request({action:'client_master_record',client_id:cid,field_key:key,value:f.get('value'),source_kind:f.get('source_kind'),document_id:f.get('document_id')||undefined,source_reference:f.get('source_reference')||undefined,reason:f.get('reason')||undefined}),async x=>{view(x);notice('Fact recorded. A different Supervisor, Manager or Partner verifies it.');});
   return;
  }
  if(a==='cm-verify'){
   show('Verify '+row.label.toLowerCase(),form(`<p class="info full">Value: <b>${esc(row.fact.value)}</b><br>Source: ${source(row.fact)}</p><label class="full">What did you check it against? *<textarea name="note" required minlength="3" maxlength="500" placeholder="For example, the certificate of incorporation, page 1"></textarea></label>`,'Verify'),
    f=>request({action:'client_master_verify',fact_id:row.fact.fact_id,revision:row.fact.revision,note:f.get('note')}),async x=>{view(x);notice(x.ready?'Every required fact is verified. This client is ready.':'Fact verified.');});
  }
 }
 return {open,handle,isAction:a=>String(a).startsWith('cm-')};
}
