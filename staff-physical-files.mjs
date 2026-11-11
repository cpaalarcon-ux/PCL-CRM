// Physical file register (Communications Hub > Client services). Files that arrive on paper: a unique reference, where the file is, who has it, every move, the scanned copy,
// the dispatch note when it goes back to the client, and the archive. The rules are in the database (20261111020000_physical_files.sql); this screen hides buttons that would be refused.
// Retention periods are not decided and not enforced here.
import {fileActions,isFinal} from './staff-physical-file-rules.mjs?v=20261111-physfile-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const day=v=>v?String(v).slice(0,10):'';
const stamp=v=>v?new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Nairobi'}).format(new Date(v)):'';
export const METHODS=['Hand delivery','Courier','Post','Collected by client'];
const LABEL={'pf-move':'Move','pf-copy':'Scanned copy','pf-pending':'Pending dispatch','pf-return':'Return to client','pf-archive':'Archive'};

export function filesView({files,me,button,nameOf=(id,fallback)=>fallback}){
 if(!files.length)return '<p class="muted">No physical files registered yet.</p>';
 return `<div class="scroll"><table id="physicalFiles"><thead><tr><th>File</th><th>Client</th><th>Where / who</th><th>Status</th><th>Scanned copy</th><th></th></tr></thead><tbody>${files.map(f=>{
  const a=fileActions(f,me);
  return `<tr><td><b>${esc(f.file_ref)}</b><small>${esc(f.description)}</small><small>Received ${esc(day(f.received_on))}${f.received_from?' from '+esc(f.received_from):''}</small>${f.ticket_number?`<small>Ticket CST-${esc(f.ticket_number)}</small>`:''}</td><td>${esc(f.company_name)}</td><td>${esc(f.location)}${f.holder_id?`<small>With ${esc(nameOf(f.holder_id,f.holder_name))}</small>`:''}</td><td>${esc(f.status)}${isFinal(f)?'<small>Locked</small>':''}</td><td>${f.digital_document_id?esc(f.digital_name||'Linked'):f.no_scan_reason?`<small>None: ${esc(f.no_scan_reason)}</small>`:'<small class="warn">Not linked</small>'}</td><td>${button('pf-history','History',f.file_id)} ${a.open.map(x=>button(x,LABEL[x],f.file_id)).join(' ')}${f.status==='Returned to client'?' '+button('pf-note','Dispatch note',f.file_id):''}${a.notes.map(n=>`<small class="muted">${esc(n)}</small>`).join('')}</td></tr>`;}).join('')}</tbody></table></div>`;
}

export function historyView(file,movements,nameOf=(id,fallback)=>fallback){
 return `<p class="full"><b>${esc(file.file_ref)}</b> · ${esc(file.company_name)} · ${esc(file.status)}</p><div class="scroll full"><table id="fileHistory"><thead><tr><th>When</th><th>What</th><th>By</th><th>Detail</th></tr></thead><tbody>${movements.map(m=>`<tr><td>${esc(stamp(m.moved_at))}</td><td>${esc(m.kind)}</td><td>${esc(m.moved_by_name)}</td><td>${[m.to_holder?'To '+nameOf(m.to_holder,m.to_name):'',m.to_location?'Place: '+m.to_location:'',m.dispatch_note_no?m.dispatch_note_no+' · '+(m.dispatch_method||'')+' · '+(m.dispatch_recipient||'')+' · ref '+(m.dispatch_reference||''):'',m.note||''].filter(Boolean).map(esc).join('<br>')}</td></tr>`).join('')}</tbody></table></div><p class="muted full">The movement log is only added to; an entry cannot be changed or removed.</p>`;
}

export function createPhysicalFilesUI(ctx){
 const {field,select,form,modal,request,button,area}=ctx,d=()=>ctx.data();
 let files=[],loaded=false,loading=false;
 async function load(){
  if(loading)return;loading=true;
  try{files=(await request({action:'physical_file_list'})).files;}catch(e){files=[];}
  finally{loaded=true;loading=false;ctx.render();}
 }
 const refresh=async()=>{loaded=false;await load();};
 function view(){
  if(!loaded){queueMicrotask(load);return '<h3 class="section-space">Physical files</h3><p class="muted">Loading physical files…</p>';}
  const me=d().me,canAdd=!['INTERN','ADMIN'].includes(me.category_code);
  return `<h3 class="section-space">Physical files</h3><div class="section-head"><p>Paper files that arrive at the office. Each gets a reference such as PHY-2026-001: write it on the folder. Every move is logged. Scan the contents and link the copy before a file goes back to the client or to the archive. Retention periods are not set yet, so nothing is moved or removed on a timer.</p>${canAdd?button('pf-new','+ Register a physical file','','class="primary"'):''}</div>${filesView({files,me,button,nameOf})}`;
 }
 const nameOf=(id,fallback)=>{const n=ctx.staffName?ctx.staffName(id):'';return n&&n!=='Assigned staff'?n:(fallback||'A colleague');};
 const staffOptions=()=>(d().staff||[]).filter(s=>!['INTERN','ADMIN'].includes(s.category_code)&&s.access_status==='Active').map(s=>[s.staff_id,s.full_name]);
 const placeOptions=()=>{const dd=d(),client=id=>dd.clients.find(c=>c.client_id===id)?.company_name||'Client',firm=id=>dd.firms.find(f=>f.firm_id===id)?.legal_name||'Firm';return (dd.client_firms||[]).map(l=>[`${l.client_id}|${l.firm_id}`,`${client(l.client_id)} · ${firm(l.firm_id)}`]);};
 const pdf=x=>{const bytes=Uint8Array.from(atob(x.base64),ch=>ch.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:x.mime_type})),a=document.createElement('a');a.href=url;a.download=x.file_name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 async function handle(action,id){
  if(!action.startsWith('pf-'))return false;
  if(action==='pf-new'){
   let tickets=[];
   try{tickets=(await request({action:'client_support_list'})).tickets.filter(t=>!['Closed','Cancelled'].includes(t.status));}catch(e){}
   modal('Register a physical file',form(select('place','Client and firm *',placeOptions(),'','Choose…')+field('description','What is in the file? *','','text','required maxlength="300"')+field('received_from','Received from','','text','maxlength="200"')+field('received_on','Received on',new Date().toISOString().slice(0,10),'date')+field('location','Where is it kept? * (for example Shelf B, Box 4)','','text','required maxlength="200"')+select('ticket_id','Related support ticket (optional)',tickets.map(t=>[t.ticket_id,`CST-${t.ticket_number} · ${t.company_name} · ${t.subject}`]),'','No ticket'),'Register file'),
    f=>{const [client_id,firm_id]=String(f.get('place')||'').split('|');return request({action:'physical_file_register',client_id,firm_id,ticket_id:f.get('ticket_id')||null,description:f.get('description'),received_from:f.get('received_from')||null,received_on:f.get('received_on')||null,location:f.get('location')});},refresh);
   return true;
  }
  const file=files.find(x=>x.file_id===id);if(!file)return true;
  if(action==='pf-history'){
   const r=await request({action:'physical_file_read',file_id:id});
   modal('History · '+file.file_ref,historyView(r.file,r.movements,nameOf),null,null);return true;
  }
  if(action==='pf-note'){pdf(await request({action:'physical_file_dispatch_note',file_id:id}));return true;}
  if(action==='pf-move'){
   modal('Move '+file.file_ref,form(select('to_holder','Who has it now?',staffOptions(),file.holder_id||'','Nobody: it is in store')+field('to_location','Where is it kept?',file.location,'text','maxlength="200"')+area('note','Note',''),'Record move'),
    f=>request({action:'physical_file_move',file_id:id,revision:file.revision,to_holder:f.get('to_holder')||null,to_location:f.get('to_location')||null,note:f.get('note')||null}),refresh);return true;
  }
  if(action==='pf-pending'){
   modal('Pending dispatch · '+file.file_ref,form('<p class="info full">The work is done and the file is ready to go back to the client. A dispatch note is made when it is returned.</p>'+area('note','Note',''),'Mark pending dispatch'),
    f=>request({action:'physical_file_pending',file_id:id,revision:file.revision,note:f.get('note')||null}),refresh);return true;
  }
  if(action==='pf-return'){
   modal('Return to client · '+file.file_ref,form('<p class="info full">This locks the record. A dispatch note with a signature block can be downloaded afterwards; keep the signed copy with the ticket.</p>'+select('dispatch_method','How is it going back? *',METHODS.map(x=>[x,x]),'','Choose…')+field('dispatch_recipient','Who receives it? *','','text','required maxlength="200"')+field('dispatch_reference','Signature or tracking reference *','','text','required maxlength="200"')+area('note','Note',''),'Return file and lock record'),
    f=>request({action:'physical_file_return',file_id:id,revision:file.revision,dispatch_method:f.get('dispatch_method'),dispatch_recipient:f.get('dispatch_recipient'),dispatch_reference:f.get('dispatch_reference'),note:f.get('note')||null}),refresh);return true;
  }
  if(action==='pf-archive'){
   modal('Archive · '+file.file_ref,form('<p class="info full">This locks the record. Retention periods have not been set, so nothing is removed.</p>'+field('to_location','Archive shelf or box *','','text','required maxlength="200"')+area('note','Note',''),'Archive file'),
    f=>request({action:'physical_file_archive',file_id:id,revision:file.revision,to_location:f.get('to_location'),note:f.get('note')||null}),refresh);return true;
  }
  if(action==='pf-copy'){
   let docs=[];
   try{docs=(await request({action:'physical_file_documents',client_id:file.client_id,firm_id:file.firm_id})).documents;}catch(e){}
   modal('Scanned copy · '+file.file_ref,form(select('document_id','Scanned document in the Documents list',docs.map(x=>[x.document_id,`${x.file_name} · ${day(x.uploaded_at)}`]),file.digital_document_id||'','None')+area('no_scan_reason','If there is no scanned copy, why? (at least 10 characters)',file.no_scan_reason||''),'Save'),
    f=>request({action:'physical_file_copy',file_id:id,revision:file.revision,document_id:f.get('document_id')||null,no_scan_reason:f.get('no_scan_reason')||null}),refresh);return true;
  }
  return false;
 }
 return {view,handle,refresh};
}
