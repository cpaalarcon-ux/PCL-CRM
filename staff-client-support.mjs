// Client support services (Communications Hub > Client services): requests a client makes of the firm, such as lifting a KRA agency notice.
// Not the internal staff help desk (the Support tab). A billable service gets a DRAFT invoice only when its ticket is closed; the database enforces this
// (20261110278000_client_support_services.sql). The fee is typed by the person closing the ticket; no rate is stored.
import {createPhysicalFilesUI} from './staff-physical-files.mjs?v=20261111-physfile-v1';
import {HIGH_PRIORITY_NOTE} from './staff-physical-file-rules.mjs?v=20261111-physfile-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const kes=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n||0));
export const PRIORITIES=['Low','Medium','High','Urgent'];
export const PRIORITY_TONE={Low:'muted',Medium:'',High:'warn',Urgent:'bad'};
export const dueText=t=>{const parts=[];if(t.response_due_on)parts.push('Respond by '+day(t.response_due_on)+(t.response_overdue?' (overdue)':''));if(t.resolution_due_on)parts.push('Resolve by '+day(t.resolution_due_on)+(t.resolution_overdue?' (overdue)':''));return parts;};
export const WORKING_STATUSES=['Open','In progress','Waiting on client','Work done'];
export const BILLING_TEXT={true:'Billable: a draft invoice is created when the ticket is closed',false:'Not billable: no invoice is created'};
export const CLOSE_NOTE='Closing a billable ticket creates a draft invoice for the fee you enter (before VAT; the firm\'s 16% VAT rule is applied automatically). A person with billing rights still posts it.';
const open=t=>!['Closed','Cancelled'].includes(t.status);

// What a person may do with one ticket. The database and server repeat these rules; this only hides buttons that would be refused.
export function ticketActions(t,me){
 if(!open(t)||['INTERN','ADMIN'].includes(me.category_code))return [];
 const out=['csup-edit'];
 out.push('csup-close','csup-cancel');
 return out;
}
const label={'csup-edit':'Update','csup-close':'Close','csup-cancel':'Cancel'};

export function ticketsView({tickets,me,button}){
 if(!tickets.length)return '<p class="muted">No client support tickets yet.</p>';
 return `<div class="scroll"><table><thead><tr><th>Ticket</th><th>Client / service</th><th>Status</th><th>Assigned to</th><th>Due</th><th>Billing</th><th></th></tr></thead><tbody>${tickets.map(t=>`<tr><td>CST-${esc(t.ticket_number)}<small>${esc(t.subject)}</small><small>${esc(day(t.opened_at))}</small></td><td>${esc(t.company_name)}<small>${esc(t.service_name)}</small>${t.kra_case_id?`<small>KRA notice ${esc(t.kra_reference)}${t.kra_tax_head?' · '+esc(t.kra_tax_head):''}</small>`:''}</td><td>${esc(t.status)}${t.resolution?`<small>${esc(t.resolution)}</small>`:''}</td><td>${esc(t.assigned_name)}${t.priority&&t.priority!=='Medium'?`<small class="${PRIORITY_TONE[t.priority]||''}">${esc(t.priority)} priority</small>`:''}${t.assignment_note?`<small>${esc(t.assignment_note)}</small>`:''}${t.high_priority_stale?`<small class="warn" title="${esc(HIGH_PRIORITY_NOTE)}">High priority and not started within 24 hours</small>`:''}${Number(t.files_in_office)>0?`<small>${esc(t.files_in_office)} physical file${Number(t.files_in_office)===1?'':'s'} still in the office</small>`:''}</td><td>${dueText(t).map(x=>`<small class="${/overdue/.test(x)?'warn':''}">${esc(x)}</small>`).join('')||'<small class="muted">no dates</small>'}</td><td>${t.is_billable?(t.invoice_id?`Draft invoice created${t.invoice_number?' ('+esc(t.invoice_number)+')':''}<small>${esc(kes(t.fee_amount))} before VAT</small>`:t.status==='Cancelled'?'Cancelled: no invoice':'Billable: invoice when closed'):'Not billable'}</td><td>${ticketActions(t,me).map(a=>button(a,label[a],t.ticket_id)).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
}

export function servicesView({services,me,button}){
 return `<h3 class="section-space">Services and billing</h3><p class="muted">Which services are billed was set by the Partner's written instruction of 10 November 2026. ${me.category_code==='PARTNER'?'You can change it here; record where the decision is written.':'Only a Partner can change it.'}</p><div class="scroll"><table><thead><tr><th>Service</th><th>Billing</th><th>Note</th><th></th></tr></thead><tbody>${services.map(s=>`<tr><td>${esc(s.service_name)}${s.is_active?'':'<small>Switched off</small>'}</td><td>${esc(BILLING_TEXT[s.is_billable])}</td><td>${esc(s.source_note)}</td><td>${me.category_code==='PARTNER'?button('csup-service','Change',s.service_code):''}</td></tr>`).join('')}</tbody></table></div>`;
}

export function createClientSupportUI(ctx){
 const {field,select,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 const physical=createPhysicalFilesUI(ctx);
 let tickets=[],services=[],loaded=false,loading=false;
 async function load(){
  if(loading)return;loading=true;
  try{const [t,s]=await Promise.all([request({action:'client_support_list'}),request({action:'client_support_services'})]);tickets=t.tickets;services=s.services;}
  catch(e){tickets=[];services=[];}
  finally{loaded=true;loading=false;ctx.render();}
 }
 // The tab body. The first time it is drawn it asks for the list and draws again.
 function view(){
  if(!loaded){queueMicrotask(load);return '<p class="muted">Loading client support tickets…</p>';}
  const me=d().me;
  return `<div class="section-head"><p>Requests clients make of the firm. This is separate from the internal Support tab, which is for staff IT and system requests.</p>${['INTERN','ADMIN'].includes(me.category_code)?'':button('csup-new','+ New client ticket','','class="primary"')}</div>${ticketsView({tickets,me,button})}${physical.view()}${servicesView({services,me,button})}`;
 }
 const refresh=async()=>{loaded=false;await Promise.all([load(),physical.refresh()]);};
 const placeOptions=()=>{
  const dd=d(),client=id=>dd.clients.find(c=>c.client_id===id)?.company_name||'Client',firm=id=>dd.firms.find(f=>f.firm_id===id)?.legal_name||'Firm';
  const withProject=ctx.filtered().projects.map(p=>[`${p.client_id}|${p.handling_firm_id}|${p.project_id}`,`${client(p.client_id)} · ${p.project_name} · ${firm(p.handling_firm_id)}`]);
  const clientOnly=(dd.client_firms||[]).map(l=>[`${l.client_id}|${l.firm_id}|`,`${client(l.client_id)} · ${firm(l.firm_id)} (no engagement)`]);
  return [...withProject,...clientOnly];
 };
 const staffOptions=t=>{const dd=d();const list=(dd.staff||[]).filter(s=>!['INTERN','ADMIN'].includes(s.category_code)&&s.access_status==='Active');return list.length?list.map(s=>[s.staff_id,s.full_name]):[[dd.me.staff_id,dd.me.full_name||'Me']];};
 const projectOptionsFor=t=>ctx.filtered().projects.filter(p=>p.client_id===t.client_id&&p.handling_firm_id===t.firm_id).map(p=>[p.project_id,p.project_name]);
 // The KRA notices of the chosen client, for the optional link. Only open or responded notices are offered; the database checks the same rule.
 async function fillKra(formEl,clientId,current){
  const sel=formEl.elements.kra_case_id;if(!sel)return;
  const opts=(list)=>'<option value="">No KRA notice</option>'+list.map(c=>`<option value="${esc(c.case_id)}"${c.case_id===current?' selected':''}>${esc(c.notice_reference+' · '+c.tax_head+' · reply by '+day(c.deadline_date))}</option>`).join('');
  if(!clientId){sel.innerHTML=opts([]);return;}
  try{const r=await request({action:'client_support_kra_cases',client_id:clientId});sel.innerHTML=opts(r.cases||[]);}catch(e){sel.innerHTML=opts([]);}
 }
 async function handle(action,id){
  if(action.startsWith('pf-'))return physical.handle(action,id);
  if(!action.startsWith('csup-'))return false;
  if(action==='csup-new'){
   const svc=services.filter(s=>s.is_active);
   modal('New client support ticket',form(select('place','Client and engagement *',placeOptions(),'','Choose…')+select('service_code','Service *',svc.map(s=>[s.service_code,`${s.service_name}${s.is_billable?' (billable)':''}`]),'','Choose…')+field('subject','Subject *','','text','required maxlength="200"')+area('details','What does the client need? *','',true)+select('assigned_to','Assigned to *',staffOptions(),d().me.staff_id)+area('assignment_note','Notes for the person it is assigned to','')+select('priority','Priority',PRIORITIES.map(x=>[x,x]),'Medium')+field('response_due_on','Response due date *','','date','required')+field('resolution_due_on','Resolution due date *','','date','required')+select('kra_case_id','Related KRA notice (optional)',[],'','No KRA notice'),'Open ticket'),
    f=>{const [client_id,firm_id,project_id]=String(f.get('place')||'').split('|');return request({action:'client_support_open',client_id,firm_id,project_id:project_id||null,service_code:f.get('service_code'),subject:f.get('subject'),details:f.get('details'),assigned_to:f.get('assigned_to'),assignment_note:f.get('assignment_note')||null,priority:f.get('priority'),response_due_on:f.get('response_due_on'),resolution_due_on:f.get('resolution_due_on'),kra_case_id:f.get('kra_case_id')||null});},refresh);
   const form0=ctx.$?ctx.$('#editForm'):null;if(form0&&form0.elements.place)form0.elements.place.onchange=()=>fillKra(form0,String(form0.elements.place.value||'').split('|')[0],'');
   return true;
  }
  if(action==='csup-service'){
   const s=services.find(x=>x.service_code===id);if(!s)return true;
   modal('Change · '+s.service_name,form(select('is_billable','Billing *',[['true','Billable'],['false','Not billable']],String(s.is_billable))+select('is_active','Availability *',[['true','Available'],['false','Switched off']],String(s.is_active))+area('source_note','Where is the Partner\'s decision written? * (at least 10 characters)','',true),'Save'),
    f=>request({action:'client_support_service_set',service_code:id,revision:s.revision,is_billable:f.get('is_billable')==='true',is_active:f.get('is_active')==='true',source_note:f.get('source_note')}),refresh);
   return true;
  }
  const t=tickets.find(x=>x.ticket_id===id);if(!t)return true;
  if(action==='csup-edit'){
   modal('Update CST-'+t.ticket_number,form(select('status','Status',WORKING_STATUSES.map(x=>[x,x]),t.status)+select('assigned_to','Assigned to',staffOptions(),t.assigned_to)+select('project_id','Engagement',projectOptionsFor(t),t.project_id||'','No engagement')+area('assignment_note','Notes for the person it is assigned to',t.assignment_note||'')+select('priority','Priority',PRIORITIES.map(x=>[x,x]),t.priority||'Medium')+field('response_due_on','Response due date',day(t.response_due_on),'date')+field('resolution_due_on','Resolution due date',day(t.resolution_due_on),'date')+select('kra_case_id','Related KRA notice (optional)',t.kra_case_id?[[t.kra_case_id,'KRA notice '+(t.kra_reference||'')]]:[],t.kra_case_id||'','No KRA notice'),'Save'),
    f=>request({action:'client_support_update',ticket_id:id,revision:t.revision,status:f.get('status'),assigned_to:f.get('assigned_to'),project_id:f.get('project_id')||null,assignment_note:f.get('assignment_note')||null,priority:f.get('priority'),response_due_on:f.get('response_due_on')||undefined,resolution_due_on:f.get('resolution_due_on')||undefined,kra_case_id:f.get('kra_case_id')||null}),refresh);
   const form1=ctx.$?ctx.$('#editForm'):null;if(form1&&form1.elements.kra_case_id)fillKra(form1,t.client_id,t.kra_case_id||'');
   return true;
  }
  if(action==='csup-close'){
   const billable=t.is_billable;
   modal('Close CST-'+t.ticket_number,form(`<p class="full">${esc(t.service_name)} · ${esc(t.company_name)}</p><p class="info full">${esc(billable?CLOSE_NOTE:'This service is not billable, so no invoice is created.')}</p>`+(billable?field('fee_amount','Fee before VAT (KES) *','','number','required min="0.01" step="0.01"')+select('project_id','Engagement it is billed under *',projectOptionsFor(t),t.project_id||'','Choose…'):'')+area('resolution','What was done, and the outcome? * (at least 10 characters)','',true),billable?'Close and create draft invoice':'Close ticket'),
    f=>request({action:'client_support_close',ticket_id:id,revision:t.revision,resolution:f.get('resolution'),fee_amount:billable?f.get('fee_amount'):undefined,project_id:billable?(f.get('project_id')||undefined):undefined}),refresh);
   return true;
  }
  if(action==='csup-cancel'){
   modal('Cancel CST-'+t.ticket_number,form(area('reason','Why is it cancelled? * (at least 10 characters)','',true),'Cancel ticket'),f=>request({action:'client_support_cancel',ticket_id:id,revision:t.revision,reason:f.get('reason')}),refresh);
   return true;
  }
  return false;
 }
 return {view,handle,refresh};
}
