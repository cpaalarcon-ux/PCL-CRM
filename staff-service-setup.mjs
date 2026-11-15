// Client-type templates and service set-up (build 2810).
// The type of client decides what the client file asks for. It never selects a service: a Supervisor, Manager or Partner chooses the service, period, scope,
// responsible person and reviewer, previews the tasks, and only then confirms. Tasks that need a registration the client's verified profile does not show
// are not created, and the plan says why. Every step is authorised again on the server.
export function createServiceSetupUI(ctx){
 const {esc,field,select,form,modal,request,notice,shortDate}=ctx,d=()=>ctx.data();
 const editor=()=>['PARTNER','MANAGER','SUPERVISOR'].includes(d().me?.category_code);
 const leader=()=>['PARTNER','MANAGER'].includes(d().me?.category_code);
 const tone={Verified:'good',Recorded:'warn',Differs:'bad',Missing:'bad','Not visible':'muted',Approved:'good',Draft:'warn',Retired:'muted',Released:'good',Waiting:'warn'};
 const badge=s=>`<span class="badge ${tone[s]||''}">${esc(s)}</span>`;
 const day=v=>String(v||'').slice(0,10);
 // The part of the client master panel that shows what the client type asks for beyond the facts.
 function clientTypeBlock(t){
  if(!t)return '';
  const list=(rows,empty)=>rows&&rows.length?`<ul>${rows.map(r=>`<li>${badge(r.state)} <b>${esc(r.label)}</b>${r.requirement&&r.requirement!=='Required'?' <small>('+esc(r.requirement.toLowerCase())+')</small>':''}${r.issue?`<small>${esc(r.issue)}</small>`:''}</li>`).join('')}</ul>`:`<p class="muted">${esc(empty)}</p>`;
  return `<details open><summary><b>${esc(t.name)}</b> · what this client type asks for</summary><p class="muted">${esc(t.controls)}.${t.restricted?' Evidence, people and licences are kept by Managers and Partners.':''}</p>
   <h4>Evidence on the KYC file</h4>${list(t.evidence,'No evidence list for this legal structure yet.')}
   <h4>People</h4>${list(t.parties,'None asked for.')}
   ${t.licences&&t.licences.length?`<h4>Regulator licences</h4>${list(t.licences,'')}`:''}
   <p class="muted">Nothing here selects a service. A service is set up on purpose, from the client's page.</p></details>`;
 }
 // Plan preview.
 function planView(plan){
  const created=plan.create.length?`<ul>${plan.create.map(c=>`<li><b>${esc(c.task_name)}</b>${c.recurrence==='Once'?'':' · '+esc(c.period_start)} · due ${esc(c.due_on)} · ${c.owner_role==='REVIEWER'?'reviewer':'responsible'}${c.mandatory?'':' <small>(optional)</small>'}</li>`).join('')}</ul>`:'<p class="muted">No tasks would be created.</p>';
  const skipped=plan.skipped.length?`<ul>${plan.skipped.map(s=>`<li>${badge(s.kind)} <b>${esc(s.task_name)}</b>: ${esc(s.reason)}</li>`).join('')}</ul>`:'';
  const probs=plan.problems.length?`<div class="notice bad"><b>Fix before continuing</b><ul>${plan.problems.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:'';
  const warn=plan.warnings.length?`<ul>${plan.warnings.map(x=>`<li class="muted">${esc(x)}</li>`).join('')}</ul>`:'';
  return `${probs}<p><b>${plan.create.length}</b> task${plan.create.length===1?'':'s'} would be created from <b>${esc(plan.template.name)}</b> (version ${esc(plan.template.version)})${plan.late?`, ${plan.late} already past due`:''}. ${plan.project?'Project: '+esc(plan.project.project_name)+' ('+esc(plan.project.status)+').':'A new draft project would be created, through the usual checks.'}</p>${warn}<h4>Would be created</h4>${created}${skipped?`<h4>Not created, and why</h4>${skipped}`:''}`;
 }
 async function open(cid){
  const o=await request({action:'engagement_setup_options',client_id:cid});
  const setups=await request({action:'engagement_setup_list',client_id:cid});
  const prior=setups.setups.length?`<h4>Already set up</h4><ul>${setups.setups.map(s=>`<li>${badge(s.status)} <b>${esc(s.template_name)}</b> v${esc(s.version)} · ${esc(s.service_code)} · ${esc(day(s.period_start))} to ${esc(day(s.period_end))} · ${esc(String(s.tasks_created))} task${s.tasks_created===1?'':'s'}${s.status==='Waiting'?` ${editor()?`<button type="button" data-svc="release" data-id="${esc(s.setup_id)}" data-client="${esc(cid)}">Release if ready</button>`:''}`:''}</li>`).join('')}</ul>`:'';
  if(!o.templates.length){modal('Set up a service · '+o.client.company_name,`<p class="info full">${esc(o.note)}</p><p>No service template has been approved yet. A Partner approves the firm's service templates first${leader()?' (Projects, Service templates)':''}.</p>${prior}`);return;}
  const svcOptions=o.templates.flatMap(t=>t.services.map(s=>[t.template_id+'|'+s.service_code,`${s.service_name} — ${t.name}`]));
  const firms=o.firms.map(f=>[f.firm_id,f.legal_name]);
  const firmName=new Map(o.firms.map(f=>[f.firm_id,f.legal_name]));
  const staff=o.staff.filter(s=>firmName.has(s.firm_id)).map(s=>[s.staff_id+'|'+s.firm_id,`${s.full_name} (${s.category_code.toLowerCase()}) · ${firmName.get(s.firm_id)}`]);
  const projects=[['','A new draft project']].concat(o.projects.map(p=>[p.project_id,`${p.project_name} (${p.status})`]));
  modal('Set up a service · '+o.client.company_name,form(`<p class="info full">${esc(o.note)}${o.client_template?' This client uses the "'+esc(o.client_template.name)+'" file template.':' This client\'s legal structure has no client-type template.'}</p>`+
   select('svc','Service and template *',svcOptions)+select('firm_id','Handling firm *',firms)+select('project_id','Project',projects,'')+field('period_start','Period starts *','','date','required')+field('period_end','Period ends *','','date','required')+
   `<label class="full">Scope *<textarea name="scope" required minlength="10" maxlength="2000" placeholder="What is included, and what is not"></textarea></label>`+
   select('responsible','Responsible person *',staff)+select('reviewer','Reviewer *',staff)+`<p class="info full">The reviewer must be a different Supervisor, Manager or Partner. People are listed with their handling firm; choose people from the firm above.</p>`+prior,'Preview tasks'),
   async f=>{const [template_id,service_code]=f.get('svc').split('|');return request({action:'engagement_setup_plan',...base(cid,f,template_id,service_code)});},
   async r=>{await review(cid,r.plan,lastInput);},{refreshWorkspace:false,pendingLabel:'Planning…',pendingMessage:'Working out the tasks. Nothing is created yet.',successMessage:null});
 }
 let lastInput=null;
 function base(cid,f,template_id,service_code,exclusions){
  const [responsible]=f.get('responsible').split('|'),[reviewer]=f.get('reviewer').split('|');
  lastInput={client_id:cid,firm_id:f.get('firm_id'),template_id,service_code,project_id:f.get('project_id')||undefined,period_start:f.get('period_start'),period_end:f.get('period_end'),scope:f.get('scope'),responsible_staff:responsible,reviewer_staff:reviewer,exclusions:exclusions||[]};
  return lastInput;
 }
 async function review(cid,plan,input){
  const drop=plan.create.concat(plan.skipped.filter(s=>s.kind==='Dropped')).reduce((m,c)=>m.set(c.task_key,c),new Map());
  const dropForm=[...drop.values()].map(c=>`<label class="full"><input type="checkbox" name="drop_${esc(c.task_key)}"${plan.skipped.some(s=>s.task_key===c.task_key&&s.kind==='Dropped')?' checked':''}> Drop <b>${esc(c.task_name)}</b>${c.mandatory?' (required: a Manager or Partner, with a reason)':''}</label>`).join('');
  modal('Preview · tasks for this set-up',planView(plan)+(plan.problems.length?'':form(`<p class="info full">Review the tasks above. To tailor the set-up, tick any task to drop and give a reason. Then confirm.</p>${dropForm}<label class="full">Reason for dropping *<input name="reason" maxlength="300" placeholder="Only needed when you drop something"></label>`,'Create the set-up')),
   async f=>{const ex=[...drop.keys()].filter(k=>f.get('drop_'+k)).map(k=>({task_key:k,reason:f.get('reason')||''}));
    const payload={...input,exclusions:ex};
    if(ex.length){const re=await request({action:'engagement_setup_plan',...payload});if(!re.ok){throw new Error(re.plan.problems[0]);}}
    return request({action:'engagement_setup_apply',...payload,confirm:true});},
   r=>{notice(r.released?`Set-up created: ${r.tasks_created} task${r.tasks_created===1?'':'s'} made.`:'Set-up saved. The tasks are made as soon as the project can take them: '+(r.waiting_reason||''));},
   {refreshWorkspace:true,pendingLabel:'Creating…',pendingMessage:'Creating the set-up.',successMessage:null});
 }
 async function templates(){
  const x=await request({action:'service_template_list'});
  const rows=x.templates.map(t=>{
   const tasks=`<details><summary>${t.tasks.length} tasks · ${t.services.map(s=>esc(s.service_code)).join(', ')}</summary><ul>${t.tasks.map(k=>`<li><b>${esc(k.task_name)}</b> · ${esc(k.stage)} · ${esc(k.recurrence)}${k.mandatory?'':' · optional'}${k.requires_obligation?' · needs '+esc(k.requires_obligation)+' on the verified tax profile':''}</li>`).join('')}</ul></details>`;
   const acts=[];
   if(t.status==='Draft'&&x.can_approve)acts.push(`<button type="button" data-svc="approve" data-id="${esc(t.template_id)}" data-rev="${esc(t.revision)}">Approve</button>`);
   if(t.status!=='Retired'&&x.can_approve)acts.push(`<button type="button" data-svc="retire" data-id="${esc(t.template_id)}" data-rev="${esc(t.revision)}">Retire</button>`);
   if(t.status==='Approved'&&x.can_propose)acts.push(`<button type="button" data-svc="propose" data-id="${esc(t.template_id)}">Propose a changed version</button>`);
   return `<tr><td><b>${esc(t.name)}</b> v${esc(t.version)}<small>${esc(t.service_group)}</small>${tasks}</td><td>${badge(t.status)}<small>${t.status==='Approved'?'Approved by '+esc(t.approved_by_name||'a Partner'):t.source==='Starter'?'Starter set, not yet approved':'Proposed by '+esc(t.proposed_by_name||'staff')}</small></td><td>${acts.join(' ')}</td></tr>`;
  }).join('');
  modal('Service templates',`<p class="info full">${esc(x.note)}</p><div class="scroll"><table><thead><tr><th>Template</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`);
  return x;
 }
 async function handle(a,id,ds={}){
  if(a==='setup')return open(id);
  if(a==='templates')return templates();
  if(a==='release'){const r=await request({action:'engagement_setup_release',setup_id:id});notice(r.released?`Released: ${r.tasks_created} task${r.tasks_created===1?'':'s'} made.`:'Still waiting: '+r.waiting_reason);return open(ds.client);}
  if(a==='approve'){await request({action:'service_template_approve',template_id:id,revision:ds.rev});notice('Template approved.');return templates();}
  if(a==='retire'){return modal('Retire this template',form(`<label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>`,'Retire'),f=>request({action:'service_template_retire',template_id:id,revision:ds.rev,reason:f.get('reason')}),()=>templates(),{refreshWorkspace:false,successMessage:'Template retired.'});}
  if(a==='propose'){
   const x=await request({action:'service_template_list'}),t=x.templates.find(y=>y.template_id===id);
   return modal('Propose a changed version of '+t.name,form(`<p class="info full">The approved template stays as it is. This makes version ${t.version+1} as a draft for a different Partner to approve. Tick any task to leave out of the new version.</p>`+t.tasks.map(k=>`<label class="full"><input type="checkbox" name="drop_${esc(k.task_key)}"> Leave out <b>${esc(k.task_name)}</b></label>`).join(''),'Propose version'),
    f=>request({action:'service_template_propose',from_template_id:id,drop_task_keys:t.tasks.filter(k=>f.get('drop_'+k.task_key)).map(k=>k.task_key)}),()=>templates(),{refreshWorkspace:false,successMessage:'Draft version proposed. A different Partner approves it.'});
  }
 }
 if(typeof document!=='undefined')document.addEventListener('click',async e=>{const b=e.target.closest?.('[data-svc]');if(!b)return;e.preventDefault();b.disabled=true;try{await handle(b.dataset.svc,b.dataset.id,{rev:b.dataset.rev,client:b.dataset.client});}catch(err){ctx.notice(err.message,true);}finally{b.disabled=false;}});
 return {open,templates,handle,clientTypeBlock,editor,button:()=>editor()?'<button type="button" data-svc="templates">Service templates</button>':'',isAction:a=>['setup','templates','release','approve','retire','propose'].includes(a)};
}
