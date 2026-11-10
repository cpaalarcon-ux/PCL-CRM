// Client support services (Communications Hub > Client services): requests a client makes of the firm, such as lifting a KRA agency notice.
// Not the internal staff help desk (the Support tab). A billable service gets a DRAFT invoice only when its ticket is closed; the database enforces this
// (20261110278000_client_support_services.sql). The fee is typed by the person closing the ticket; no rate is stored.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const kes=n=>new Intl.NumberFormat('en-KE',{style:'currency',currency:'KES'}).format(Number(n||0));
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
 return `<div class="scroll"><table><thead><tr><th>Ticket</th><th>Client / service</th><th>Status</th><th>Assigned to</th><th>Billing</th><th></th></tr></thead><tbody>${tickets.map(t=>`<tr><td>CST-${esc(t.ticket_number)}<small>${esc(t.subject)}</small><small>${esc(day(t.opened_at))}</small></td><td>${esc(t.company_name)}<small>${esc(t.service_name)}</small></td><td>${esc(t.status)}${t.resolution?`<small>${esc(t.resolution)}</small>`:''}</td><td>${esc(t.assigned_name)}</td><td>${t.is_billable?(t.invoice_id?`Draft invoice created${t.invoice_number?' ('+esc(t.invoice_number)+')':''}<small>${esc(kes(t.fee_amount))} before VAT</small>`:t.status==='Cancelled'?'Cancelled: no invoice':'Billable: invoice when closed'):'Not billable'}</td><td>${ticketActions(t,me).map(a=>button(a,label[a],t.ticket_id)).join(' ')}</td></tr>`).join('')}</tbody></table></div>`;
}

export function servicesView({services,me,button}){
 return `<h3 class="section-space">Services and billing</h3><p class="muted">Which services are billed was set by the Partner's written instruction of 10 November 2026. ${me.category_code==='PARTNER'?'You can change it here; record where the decision is written.':'Only a Partner can change it.'}</p><div class="scroll"><table><thead><tr><th>Service</th><th>Billing</th><th>Note</th><th></th></tr></thead><tbody>${services.map(s=>`<tr><td>${esc(s.service_name)}${s.is_active?'':'<small>Switched off</small>'}</td><td>${esc(BILLING_TEXT[s.is_billable])}</td><td>${esc(s.source_note)}</td><td>${me.category_code==='PARTNER'?button('csup-service','Change',s.service_code):''}</td></tr>`).join('')}</tbody></table></div>`;
}

export function createClientSupportUI(ctx){
 const {field,select,form,modal,request,button,area}=ctx,d=()=>ctx.data();
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
  return `<div class="section-head"><p>Requests clients make of the firm. This is separate from the internal Support tab, which is for staff IT and system requests.</p>${['INTERN','ADMIN'].includes(me.category_code)?'':button('csup-new','+ New client ticket','','class="primary"')}</div>${ticketsView({tickets,me,button})}${servicesView({services,me,button})}`;
 }
 const refresh=async()=>{loaded=false;await load();};
 const placeOptions=()=>{
  const dd=d(),client=id=>dd.clients.find(c=>c.client_id===id)?.company_name||'Client',firm=id=>dd.firms.find(f=>f.firm_id===id)?.legal_name||'Firm';
  const withProject=ctx.filtered().projects.map(p=>[`${p.client_id}|${p.handling_firm_id}|${p.project_id}`,`${client(p.client_id)} · ${p.project_name} · ${firm(p.handling_firm_id)}`]);
  const clientOnly=(dd.client_firms||[]).map(l=>[`${l.client_id}|${l.firm_id}|`,`${client(l.client_id)} · ${firm(l.firm_id)} (no engagement)`]);
  return [...withProject,...clientOnly];
 };
 const staffOptions=t=>{const dd=d();const list=(dd.staff||[]).filter(s=>!['INTERN','ADMIN'].includes(s.category_code)&&s.access_status==='Active');return list.length?list.map(s=>[s.staff_id,s.full_name]):[[dd.me.staff_id,dd.me.full_name||'Me']];};
 const projectOptionsFor=t=>ctx.filtered().projects.filter(p=>p.client_id===t.client_id&&p.handling_firm_id===t.firm_id).map(p=>[p.project_id,p.project_name]);
 async function handle(action,id){
  if(!action.startsWith('csup-'))return false;
  if(action==='csup-new'){
   const svc=services.filter(s=>s.is_active);
   modal('New client support ticket',form(select('place','Client and engagement *',placeOptions(),'','Choose…')+select('service_code','Service *',svc.map(s=>[s.service_code,`${s.service_name}${s.is_billable?' (billable)':''}`]),'','Choose…')+field('subject','Subject *','','text','required maxlength="200"')+area('details','What does the client need? *','',true)+select('assigned_to','Assigned to *',staffOptions(),d().me.staff_id),'Open ticket'),
    f=>{const [client_id,firm_id,project_id]=String(f.get('place')||'').split('|');return request({action:'client_support_open',client_id,firm_id,project_id:project_id||null,service_code:f.get('service_code'),subject:f.get('subject'),details:f.get('details'),assigned_to:f.get('assigned_to')});},refresh);
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
   modal('Update CST-'+t.ticket_number,form(select('status','Status',WORKING_STATUSES.map(x=>[x,x]),t.status)+select('assigned_to','Assigned to',staffOptions(),t.assigned_to)+select('project_id','Engagement',projectOptionsFor(t),t.project_id||'','No engagement'),'Save'),
    f=>request({action:'client_support_update',ticket_id:id,revision:t.revision,status:f.get('status'),assigned_to:f.get('assigned_to'),project_id:f.get('project_id')||null}),refresh);
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
