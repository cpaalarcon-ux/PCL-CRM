// Client Setup Tasks (build 2840). One queue of what is recorded as not finished for each active client, and the short Client Configuration list on the client's own
// set-up screen. This file only presents what the server returned; it never decides that something is done and it approves nothing. Search and filters run on the loaded list.
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Where each task goes, as an existing screen. Opening the Opening Trial Balance goes to the client file, where its project import and review already live.
export function linkHtml(t,{esc=e0,leader=false}={}){
 const id=esc(t.client_id);
 if(t.go==='setup')return `<button type="button" data-v3="setup-review" data-id="${id}">Open set-up sections</button>`;
 if(t.go==='review')return leader?`<button type="button" data-v3="setup-queue">Review sections</button>`:'<span class="muted">A Manager or Partner reviews these.</span>';
 if(t.go==='chart')return `<button type="button" data-v3="chart" data-id="${id}">Open chart of accounts</button>`;
 if(t.go==='opening')return `<button type="button" data-client-open="${id}" data-client-tab="projects">Open client file</button>`;
 if(t.go==='routing')return `<button type="button" data-suite="routing-map-open" data-id="${id}">Open routing map</button>`;
 if(t.go==='exceptions')return `<button type="button" data-v3="exceptions" data-id="${id}">Open tax rule exceptions</button>`;
 if(t.go==='engagement')return `<button type="button" data-v3="setup" data-id="${id}">Open service set-up</button>`;
 return '';
}

export const TASK_FILTERS=Object.freeze([['','Everything'],['mine','Needs my action'],['Preparer','To prepare'],['Reviewer','To review']]);

// Every word typed must appear in the client name, the heading or the detail. who is '', 'mine', 'Preparer' or 'Reviewer'.
export function filterTasks(tasks,{search='',who=''}={}){
 const words=String(search).toLowerCase().split(/\s+/).filter(Boolean);
 return (tasks||[]).filter(t=>(!who||(who==='mine'?t.needs_me:t.who===who))&&words.every(w=>`${t.company_name} ${t.title} ${t.detail}`.toLowerCase().includes(w)));
}

export function taskRow(t,opts={}){
 const esc=opts.esc||e0,note=t.blocked_mine?`<small>${esc(t.blocked_mine)} of these ${t.blocked_mine===1?'was':'were'} prepared by you, so another reviewer must decide ${t.blocked_mine===1?'it':'them'}.</small>`:'';
 return `<tr data-task-kind="${esc(t.kind)}" data-who="${esc(t.who)}"><td><b>${esc(t.company_name)}</b></td><td>${esc(t.title)}${t.count>1?` <span class="pill">${esc(t.count)}</span>`:''}<small>${esc(t.detail)}</small>${note}</td><td>${esc(t.who==='Reviewer'?'Review':'Prepare')}</td><td>${linkHtml(t,opts)}</td></tr>`;
}

export function queueBody(res,{esc=e0,search='',who=''}={}){
 const list=filterTasks(res.tasks,{search,who});
 if(!(res.tasks||[]).length)return `<p class="info">No client has unfinished set-up. ${esc(res.clients_checked)} active client${res.clients_checked===1?'':'s'} checked.</p>`;
 if(!list.length)return '<p class="muted">Nothing matches. Clear the search or choose Everything.</p>';
 return `<div class="scroll"><table><thead><tr><th>Client</th><th>What is not finished</th><th>Your part</th><th>Go to</th></tr></thead><tbody>${list.map(t=>taskRow(t,{esc,leader:res.leader})).join('')}</tbody></table></div>`;
}

export function queueHtml(res,{esc=e0}={}){
 return `<p class="info full">Set-up that is recorded as not finished for each active client, from approved records only. This is separate from the firm-wide approvals in Settings → My approvals. ${esc(res.clients_with_tasks)} of ${esc(res.clients_checked)} active client${res.clients_checked===1?'':'s'} ${res.clients_with_tasks===1?'has':'have'} something open.</p>`+
  `<div class="actions"><input type="search" id="setupTaskSearch" placeholder="Search client or task" aria-label="Search client set-up tasks" autocomplete="off"><select id="setupTaskWho" aria-label="Filter tasks">${TASK_FILTERS.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>${res.leader?'<button type="button" class="primary" data-v3="setup-approve-ready" title="Approves every pending section that has not been edited since it was sent, after you check the list.">Approve all ready…</button>':''}</div><div id="setupTaskList">${queueBody(res,{esc})}</div>`;
}

// The short Client Configuration list on the client's own set-up screen: only what needs the client's details or confirmation, one specific line each.
export function configurationHtml(res,{esc=e0}={}){
 const items=res?.configuration;
 if(!res)return '';
 if(!items.length)return '<h3>Client configuration</h3><p class="info">Nothing is waiting on the client’s details or confirmation.</p>';
 const task=i=>(res.tasks||[]).find(t=>t.client_id===i.client_id&&(t.items||[]).some(x=>x.code===i.code));
 return `<h3>Client configuration</h3><p class="info">Only what needs the client’s details or confirmation. Everything else is handled inside the firm.</p><ul class="plain" id="clientConfiguration">${items.map(i=>`<li data-code="${esc(i.code)}"><b>${esc(i.label)}</b> <span class="pill">${esc(i.status)}</span><small>${esc(i.reason)}</small> ${linkHtml(task(i)||{client_id:i.client_id,go:i.go},{esc,leader:res.leader})}</li>`).join('')}</ul>`;
}
