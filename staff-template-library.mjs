// Template Library (build 2821), under Settings. Managers and Partners upload the firm's upload templates as numbered versions; a different Manager or Partner publishes one;
// a newer version replaces it and the old one is retired with the reason. Everyone with client access can download the published version. The server makes every decision.
import {settingsCard} from './staff-settings-cards.mjs?v=20261112-resources-v1';
const e0=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const LIBRARY_NOTE='Use the published version of each template for new uploads. A draft is published only by a different Manager or Partner (a Partner who is the firm\'s only Partner may publish their own upload, and that is recorded). A published version is never edited: upload a new version and publish it, and the old one is retired. Every import records the version that was in force.';
const TONE={Published:'good',Draft:'warn',Retired:'muted'};
export function libraryRows(list,{me,leader,esc=e0,today=''}={}){
 return (list||[]).map(t=>{
  const state=t.status==='Published'&&today&&t.effective_from>today?'Published, starts '+t.effective_from:t.status==='Published'&&t.effective_to&&today&&t.effective_to<today?'Published, ended '+t.effective_to:t.status==='Published'?'In force':t.status==='Draft'?'Waiting to be published':'Retired';
  const acts=[`<button type="button" data-tl="download" data-id="${esc(t.template_id)}">Download</button>`,
   t.status==='Draft'&&leader&&t.created_by===me?`<button type="button" data-tl="revise" data-id="${esc(t.template_id)}" data-rev="${esc(t.revision)}">Revise draft</button>`:'',
   t.status==='Draft'&&leader?`<button type="button" data-tl="publish" data-id="${esc(t.template_id)}" data-rev="${esc(t.revision)}" data-own="${t.created_by===me?'1':''}">Publish</button>`:'',
   t.status!=='Retired'&&leader?`<button type="button" data-tl="retire" data-id="${esc(t.template_id)}" data-rev="${esc(t.revision)}">Retire</button>`:''].join(' ');
  const cols=(t.required_columns||[]).map(c=>esc(c.name)+(c.required?'':' (optional)')).join(', ');
  return `<tr data-status="${esc(t.status)}"><td><b>${esc(t.key_label)}</b></td><td>${esc(t.name)}<small>Version ${esc(t.version)} · ${esc(t.file_name)}</small>${t.importer_profile?`<small>Feeds importer layout ${esc(t.importer_profile)}</small>`:''}</td><td><span class="badge ${TONE[t.status]||''}">${esc(state)}</span><small>From ${esc(t.effective_from)}${t.effective_to?' to '+esc(t.effective_to):''}</small></td><td><small>${cols}</small>${t.validation_notes?`<small>${esc(t.validation_notes)}</small>`:''}</td><td><small>Uploaded by ${esc(t.created_by_name||'a colleague')}${t.published_by_name?'; published by '+esc(t.published_by_name)+(t.sole_partner_publish?' (only Partner)':''):''}${t.retired_reason?'; retired: '+esc(t.retired_reason):''}${t.used_by?'; used by '+esc(t.used_by)+' import'+(t.used_by===1?'':'s'):''}</small></td><td>${acts}</td></tr>`;
 }).join('');
}
export function createTemplateLibraryUI(ctx){
 const {$,esc,field,select,form,modal,request,notice,today}=ctx,d=()=>ctx.data();
 const canUse=()=>!['INTERN','ADMIN'].includes(d().me?.category_code),leader=()=>['PARTNER','MANAGER'].includes(d().me?.category_code);
 let cur=null;
 const card=()=>canUse()?settingsCard({id:'templateLibraryCard',title:'Template library',purpose:'The firm\'s upload templates for sales, purchases, VAT and withholding, bank analysis, payroll, trial balance and non-eTIMS expenditure, as numbered, published versions.',audience:'Managers and Partners upload and publish; everyone downloads the published version',actions:ctx.button('template-library-open','Open')}):'';
 const download=r=>{const bytes=Uint8Array.from(atob(r.base64),c=>c.charCodeAt(0)),u=URL.createObjectURL(new Blob([bytes],{type:r.mime_type})),a=document.createElement('a');a.href=u;a.download=r.file_name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
 async function readFile(file){
  if(!file||!file.size)throw Error('Choose the template file.');
  const bytes=new Uint8Array(await file.arrayBuffer());let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {file_name:file.name,mime_type:file.type||'application/octet-stream',file_base64:btoa(s)};
 }
 const columnsHelp='One column per line: Column name | required or optional | example. For example: Net sales | required | 100000';
 function formFields(t){
  return field('name','Template name *',t?.name||'','text')+field('importer_profile','ERP importer layout it feeds (optional)',t?.importer_profile||'','text')+field('effective_from','First day it applies *',t?.effective_from||today(),'date')+field('effective_to','Last day it applies (optional)',t?.effective_to||'','date')+
   `<label class="full">Columns the template must have *<textarea name="required_columns" required rows="6" maxlength="4000" placeholder="Month | required | Jan 2026">${esc((t?.required_columns||[]).map(c=>`${c.name} | ${c.required?'required':'optional'} | ${c.example||''}`).join('\n'))}</textarea><small>${esc(columnsHelp)}</small></label>`+
   `<label class="full">Notes on checks and use<textarea name="validation_notes" maxlength="2000">${esc(t?.validation_notes||'')}</textarea></label>`;
 }
 async function open(){cur=await request({action:'template_library_list'});paint();}
 function paint(){
  const rows=libraryRows(cur.templates,{me:cur.me,leader:cur.can_manage,esc,today:today()});
  modal('Template library',`<p class="info full">${esc(LIBRARY_NOTE)}</p>${cur.can_manage?'<div class="actions"><button type="button" data-tl="add">Upload a template</button></div>':''}${rows?`<div class="scroll full"><table id="templateLibraryTable"><thead><tr><th>For</th><th>Template</th><th>State</th><th>Columns</th><th>History</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`:'<p class="muted full">No template has been uploaded yet.</p>'}`);
  const body=$('#editorBody');if(body)body.onclick=async ev=>{const b=ev.target.closest('[data-tl]');if(!b)return;const id=b.dataset.id,rev=b.dataset.rev,act=b.dataset.tl;
   try{
    if(act==='download')download(await request({action:'template_library_download',template_id:id}));
    else if(act==='add')modal('Upload a template',form(select('template_key','This template is for *',cur.keys.map(k=>[k.key,k.label]),'SALES','Choose')+formFields(null)+'<label class="full">Template file * (Excel or CSV, up to 2 MB)<input type="file" name="file" accept=".xlsx,.xlsm,.xls,.csv" required></label><p class="info full">It is saved as a draft. A different Manager or Partner publishes it before it is the version to use.</p>','Save draft'),
     async f=>request({action:'template_library_create',template_key:f.get('template_key'),name:f.get('name'),importer_profile:f.get('importer_profile')||null,effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,required_columns:f.get('required_columns'),validation_notes:f.get('validation_notes'),...(await readFile(f.get('file')))}),()=>open(),{refreshWorkspace:false});
    else if(act==='revise'){const t=cur.templates.find(x=>x.template_id===id);modal('Revise draft',form(formFields(t)+'<label class="full">Replace the file (optional)<input type="file" name="file" accept=".xlsx,.xlsm,.xls,.csv"></label>','Save changes'),
     async f=>{const file=f.get('file'),extra=file&&file.size?await readFile(file):{};return request({action:'template_library_revise',template_id:id,revision:rev,name:f.get('name'),importer_profile:f.get('importer_profile')||null,effective_from:f.get('effective_from'),effective_to:f.get('effective_to')||null,required_columns:f.get('required_columns'),validation_notes:f.get('validation_notes'),...extra});},()=>open(),{refreshWorkspace:false});}
    else if(act==='publish')modal('Publish template',form(`<p class="info full">${b.dataset.own?'You uploaded this draft. It can be published by you only if you are the firm\'s only Partner, and that is recorded.':'Check the columns and the file first.'} Publishing replaces the version now in force for this kind of template, which is retired.</p>`,'Publish'),()=>request({action:'template_library_publish',template_id:id,revision:rev}),out=>{notice(out.replaced?'Published. The earlier version is retired.':'Published.');return open();},{refreshWorkspace:false});
    else if(act==='retire')modal('Retire template',form('<p class="info full">Imports already loaded with this version keep it on record. New uploads should use the next published version.</p><label class="full">Why? *<textarea name="reason" required minlength="5" maxlength="500"></textarea></label>','Retire'),f=>request({action:'template_library_retire',template_id:id,revision:rev,reason:f.get('reason')}),()=>open(),{refreshWorkspace:false});
   }catch(err){notice(err.message,true);}
  };
 }
 async function handle(action){if(action!=='template-library-open')return false;await open();return true;}
 return {card,open,handle,canUse,leader};
}
