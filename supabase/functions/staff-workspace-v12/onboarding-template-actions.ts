import {fail,fileType,text,uuid} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {createProposal} from './proposal-actions.ts';
import {amlAction} from './aml-actions.ts';
import {PEP_NONE,missingInfo} from './aml-rules.mjs';
import {pdfLib} from './suite-actions.ts';
import {onboardingConfirmationPdf} from './onboarding-confirmation-pdf.mjs';
import {grid,checkOnboardingTabs,cleanBatchChecks,confirmationText,CHECKS,NO_ID,NOT_SIGHTED,MAX_CLIENTS} from './onboarding-template-rules.ts';
// MLRO onboarding template (client onboarding batch form v3.1).
// A preparer (Assistant or Supervisor) uploads the form. Every row of the AML, Owners, Contacts and Tax Profile tabs is checked first; one error stops the whole file and nothing is saved.
// A clean file is saved as: one "Add owner" proposal per owner and one "Add contact" proposal per contact (each waits for an independent check and approval, like any other proposal),
// the AML answers as a draft profile in Staff review (the MLRO decision is its independent check), and a batch record. No identity-document number is read or kept.
// The MLRO records the batch checks and each client's rating on the batch, then accepts the clients that are complete. Each acceptance runs the ordinary AML decision, so its rules
// and the database rules (the preparer cannot decide, a High rating needs enhanced due diligence) apply to every client.
const ACTIONS=['onboarding_batch_read','onboarding_batch_check','onboarding_batch_approve','onboarding_batch_checks_save','onboarding_batch_ratings_save','onboarding_batch_accept','onboarding_batch_pdf','onboarding_batch_sign'];
const PROPOSALS=['owner_add','contact_save'];
const day=(v:any)=>v?(v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10)):null;
class Rollback extends Error{}
const plain=(e:any,fallback:string)=>e?.status?String(e.message):fallback;
async function attempt(tx:any,keep:boolean,fn:(t:any)=>Promise<any>):Promise<{ok:boolean,out?:any,reason?:string}>{
 let out:any;
 try{await tx.savepoint(async(t:any)=>{out=await fn(t);if(!keep)throw new Rollback();});return {ok:true,out};}
 catch(e:any){if(e instanceof Rollback)return {ok:true,out};if(!e?.status)console.error('Onboarding batch row failed',{code:e?.code||'INTERNAL',type:e?.name||'Error'});return {ok:false,reason:plain(e,'This row could not be saved. Check it and try it on its own.')};}
}
const isMlro=async(tx:any)=>!!(await tx`select erp_private.is_mlro() as ok`)[0].ok;
const nairobi=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);

export async function onboardingTemplateStage(tx:any,a:any,f:FormData){
 if(!['ASSISTANT','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
 const file=f.get('file');if(!(file instanceof File))fail(400,'Choose the onboarding workbook.');
 const firm=uuid(f.get('firm_id'));
 if(!(await tx`select firm_id from erp_private.firms where firm_id=${firm} and is_active and deleted_at is null and erp_private.firm_allowed(firm_id)`).length)fail(403,'Choose a handling firm that your account can access.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const names=(await readWorkbookSheet(bytes,null)).sheets.map((s:any)=>String(s.name));
 for(const n of ['AML','Owners','Contacts','Tax Profile'])if(!names.includes(n))fail(400,`The workbook needs a sheet named “${n}”. Use the current onboarding form (v3.1).`);
 const tabs:any={};for(const [k,n] of [['aml','AML'],['owners','Owners'],['contacts','Contacts'],['tax','Tax Profile']])tabs[k]=grid((await readWorkbookSheet(bytes,n)).sheet);
 const check=checkOnboardingTabs(tabs,{now:nairobi()});
 if(check.errors.length)return {status:'VALIDATION_FAILED',message:'Nothing was saved. Fix these rows in the workbook and upload it again.',errors:check.errors,notices:check.notices,checked:check.clients.length};
 if(check.clients.length>MAX_CLIENTS)fail(400,`Load up to ${MAX_CLIENTS} clients at a time.`);
 // Every client must already be on file and visible to this person.
 const pins=check.clients.map((c:any)=>c.pin);
 const found=await tx`select client_id,company_name,kra_pin from erp_private.clients where deleted_at is null and kra_pin=any(${pins})`;
 const byPin=new Map<string,any>(found.map((r:any)=>[r.kra_pin,r]));
 const errors:any[]=[],notices:any[]=[...check.notices];
 for(const c of check.clients){const r=byPin.get(c.pin);
  if(!r){errors.push({row:c.row,column:'AML · Client KRA PIN',issue:`${c.pin} is not a client you can open. Add the client first (client workbook loader) or check the PIN.`,suggestion:null});continue;}
  if(String(r.company_name).trim().toLowerCase()!==c.name.trim().toLowerCase())notices.push({row:c.row,column:'AML · Client',issue:`The form says “${c.name}” but the client on file is “${r.company_name}”. The client on file is used.`,suggestion:null});
 }
 if(errors.length)return {status:'VALIDATION_FAILED',message:'Nothing was saved. These clients are not on file for you.',errors,notices,checked:check.clients.length};
 const ref='OB-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().replace(/[^a-z0-9]/gi,'').slice(0,4).toUpperCase();
 const lookups=await tx`select category,value from erp_private.aml_lookups where status<>'Ended'`;
 const jobs:any[]=[],profiles:any[]=[],skipped:any[]=[];
 for(const c of check.clients){
  const r=byPin.get(c.pin),have=await tx`select lower(full_name) n from erp_private.beneficial_owners where client_id=${r.client_id} and deleted_at is null`;
  const haveNames=new Set(have.map((x:any)=>x.n));
  for(const o of c.owners){
   if(haveNames.has(o.full_name.toLowerCase())){skipped.push({row:o.row,name:o.full_name,reason:'Already recorded as an owner of this client.'});continue;}
   jobs.push({row:o.row,name:o.full_name,input:{action:'owner_add',client_id:r.client_id,full_name:o.full_name,identity_reference:o.sighted?NO_ID:NOT_SIGHTED,kra_pin:o.kra_pin||'',ownership_percentage:o.ownership_percentage??0,control_basis:o.role||'Owner or controller (as stated on the onboarding form)',
    identity_type:o.identity_type,nationality:o.nationality,holding_type:o.holding_type,pep_status:o.pep_status,identity_sighted:o.sighted,identity_sighted_on:o.sighted_on,identity_sighted_by:o.sighted_by,
    change_reason:`Onboarding batch ${ref}, form row ${o.row}`,proposal_reason:`Batch ${ref} · Owners row ${o.row}`,batch_ref:ref,batch_row:o.row}});
  }
  if(c.contact){
   const cs=await tx`select 1 from erp_private.client_contacts where client_id=${r.client_id} and deleted_at is null and lower(full_name)=lower(${c.contact.full_name})`;
   if(cs.length)skipped.push({row:c.row,name:c.contact.full_name,reason:'Already a contact of this client.'});
   else jobs.push({row:c.row,name:c.contact.full_name,input:{action:'contact_save',client_id:r.client_id,...c.contact,proposal_reason:`Batch ${ref} · Contacts row ${c.row}`,batch_ref:ref,batch_row:c.row}});
  }
  const prof=(await tx`select stage from erp_private.client_aml_profiles where client_id=${r.client_id}`)[0];
  if(prof&&prof.stage!=='Staff review'){notices.push({row:c.row,column:'AML',issue:`${c.name}: the AML profile is already with the MLRO or decided, so the form's AML answers were not applied.`,suggestion:null});continue;}
  const fields:any={purpose_of_relationship:c.aml.purpose||undefined,expected_activity:c.aml.activity||undefined,expected_size_frequency:c.aml.size||undefined};
  if(c.aml.pep==='No')fields.pep_type=PEP_NONE;else if(c.aml.pep==='Yes')notices.push({row:c.row,column:'AML · Any owner politically exposed?',issue:`${c.name}: a PEP is named. Record the PEP details on the client’s AML screen.`,suggestion:null});
  if(c.aml.exception)fields.screening_note=c.aml.exception;
  const sel:any[]=[];const m=c.aml.funds?lookups.find((l:any)=>l.category==='SOURCE_OF_FUNDS'&&String(l.value).toLowerCase()===c.aml.funds.toLowerCase()):null;
  if(m)sel.push({category:'SOURCE_OF_FUNDS',value:m.value,note:null});else if(c.aml.funds)notices.push({row:c.row,column:'AML · Source of funds',issue:`${c.name}: “${c.aml.funds}” is not on the MLRO’s source-of-funds list. Choose it on the client’s AML screen.`,suggestion:null});
  for(const k of Object.keys(fields))if(fields[k]===undefined)delete fields[k];
  profiles.push({client_id:r.client_id,name:c.name,fields,selections:sel});
 }
 // First pass changes nothing and finds every entry the proposal rules would refuse; the second pass saves.
 const refused:any[]=[];
 for(const j of jobs){const r=await attempt(tx,false,t=>createProposal(t,a,j.input));if(!r.ok)refused.push({row:j.row,column:'Client',issue:`${j.name}: ${r.reason}`,suggestion:null});}
 if(refused.length)return {status:'VALIDATION_FAILED',message:'Nothing was saved. These entries cannot be proposed as they are.',errors:refused,notices,checked:check.clients.length};
 await tx`insert into erp_private.onboarding_batches(batch_ref,firm_id,file_name,client_count,created_by) values(${ref},${firm},${String(file.name).slice(0,200)},${check.clients.length},${a.staff_id})`;
 for(const c of check.clients){
  const r=byPin.get(c.pin);
  await tx`insert into erp_private.onboarding_batch_clients(batch_ref,client_id,row_no,kra_pin,answers) values(${ref},${r.client_id},${c.row},${c.pin},${tx.json({aml:c.aml,tax:c.tax,type:c.type,contact:c.contact?{full_name:c.contact.full_name}:null,owners:c.owners.map((o:any)=>({full_name:o.full_name,ownership_percentage:o.ownership_percentage,sighted:o.sighted}))})})`;
 }
 const proposed:any[]=[];
 for(const j of jobs){const out=await createProposal(tx,a,j.input);proposed.push({row:j.row,name:j.name,proposal_id:out.proposal_id});}
 const profileNotes:any[]=[];
 for(const p of profiles){
  const r=await attempt(tx,true,async t=>{const o=await amlAction(t,a,{action:'aml_profile_save',client_id:p.client_id,fields:p.fields,selections:p.selections});if(o?.errors?.length)throw Object.assign(new Error(o.errors.map((e:any)=>e.error).join(' ')),{status:400});return o;});
  if(!r.ok)notices.push({row:null,column:'AML',issue:`${p.name}: the AML answers were not saved: ${r.reason}`,suggestion:null});else profileNotes.push(p.name);
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'onboarding_batches','ONBOARDING_BATCH_STAGED',${ref},${tx.json({batch_ref:ref,file_name:String(file.name).slice(0,200),clients:check.clients.length,proposals:proposed.length})})`;
 return {status:'PROPOSED',batch_ref:ref,proposed,skipped_existing:skipped,notices,checked:check.clients.length,aml_drafts:profileNotes.length,message:`${check.clients.length} client${check.clients.length===1?'':'s'}: ${proposed.length} proposal${proposed.length===1?'':'s'} for owners and contacts, ${profileNotes.length} AML draft${profileNotes.length===1?'':'s'}. Each proposal waits for an independent check and approval.`};
}

async function loadBatch(tx:any,ref:string,lock=false){
 const b=(await (lock?tx`select * from erp_private.onboarding_batches where batch_ref=${ref} for update`:tx`select * from erp_private.onboarding_batches where batch_ref=${ref}`))[0];
 if(!b)fail(404,'This batch is not available to your account.');return b;
}
async function batchView(tx:any,a:any,ref:string){
 const b=await loadBatch(tx,ref),mlro=await isMlro(tx);
 const rows=await tx`select bc.client_id,bc.row_no,bc.kra_pin,bc.answers,bc.risk_rating,bc.condition_text,c.company_name,p.stage,p.decision,p.pep_type,p.submitted_by,p.last_edited_by,p.next_review,
   (select count(*)::int from erp_private.change_proposals x where x.client_id=bc.client_id and x.payload->>'batch_ref'=${ref} and x.action='owner_add' and x.status in('Proposed','Checked')) owners_pending,
   (select count(*)::int from erp_private.change_proposals x where x.client_id=bc.client_id and x.payload->>'batch_ref'=${ref} and x.action='contact_save' and x.status in('Proposed','Checked')) contacts_pending,
   (select count(*)::int from erp_private.beneficial_owners o where o.client_id=bc.client_id and o.deleted_at is null) owners,
   (select count(*)::int from erp_private.beneficial_owners o where o.client_id=bc.client_id and o.deleted_at is null and o.identity_sighted is true) owners_sighted
  from erp_private.onboarding_batch_clients bc join erp_private.clients c on c.client_id=bc.client_id left join erp_private.client_aml_profiles p on p.client_id=bc.client_id where bc.batch_ref=${ref} order by bc.row_no`;
 const clients=rows.map((r:any)=>{
  const hold:string[]=[];
  if(r.owners_pending||r.contacts_pending)hold.push('Owner or contact proposals are still waiting for a check or approval.');
  if(!r.owners)hold.push('No owner is recorded yet.');else if(r.owners_sighted<r.owners)hold.push('An owner’s identity document is not recorded as sighted.');
  if(!r.stage)hold.push('The AML profile has not been started.');else if(r.stage==='Staff review')hold.push('The AML profile is still with staff: finish it and refer it to the MLRO.');
  if(r.answers?.aml?.exception)hold.push('An exception at screening is recorded.');
  if(r.answers?.aml?.pep==='Yes')hold.push('An owner is a PEP.');
  if(r.answers?.aml?.confirmed!=='Yes')hold.push('Details are not confirmed from original documents and interview.');
  return {client_id:r.client_id,row:r.row_no,name:r.company_name,pin:r.kra_pin,activity:r.answers?.aml?.activity||'',stage:r.stage||null,decision:r.decision||null,rating:r.risk_rating,condition:r.condition_text,tax:r.answers?.tax||{},owners:r.owners,owners_sighted:r.owners_sighted,hold,ready:r.stage==='MLRO review'&&!hold.length};
 });
 return {batch:{...b,decision_date:day(b.decision_date),next_screening_due:day(b.next_screening_due),full_review_due:day(b.full_review_due),exposure_instruction_on:day(b.exposure_instruction_on),staff_register_checked_on:day(b.staff_register_checked_on)},clients,
  checks_list:CHECKS.map(([k,l])=>({key:k,label:l})),can:{mlro:mlro&&b.created_by!==a.staff_id&&b.status!=='Confirmed',uploader:b.created_by===a.staff_id},
  note:'The MLRO records the checks and each rating. Accepting runs the ordinary AML decision for each complete client; any client that is not complete is held with the reason and is decided one by one on the AML screen.'};
}
async function proposalsOf(tx:any,ref:string,status:string){
 return await tx`select proposal_id,payload from erp_private.change_proposals where status=${status} and action=any(${PROPOSALS}) and payload->>'batch_ref'=${ref} order by (payload->>'batch_row')::int,proposal_id`;
}
export async function onboardingTemplateAction(tx:any,a:any,p:any,run:(p:any)=>Promise<any>):Promise<any>{
 const action=String(p.action||'');if(!ACTIONS.includes(action))return undefined;
 if(action==='onboarding_batch_read'){
  if(!p.batch_ref){
   const list=await tx`select batch_ref,file_name,client_count,status,created_at,decision_date,created_by,erp_private.aml_staff_name(created_by) created_by_name from erp_private.onboarding_batches order by created_at desc limit 50`;
   return {batches:list.map((b:any)=>({...b,decision_date:day(b.decision_date)})),is_mlro:await isMlro(tx)};
  }
  return await batchView(tx,a,text(p.batch_ref,40));
 }
 const ref=text(p.batch_ref,40);
 if(action==='onboarding_batch_check'||action==='onboarding_batch_approve'){
  const checking=action==='onboarding_batch_check',note=text(p.note||'',1000,false);
  if(note.length<10)fail(400,'Record your '+(checking?'check conclusion':'approval note')+' in at least 10 characters.');
  if(checking&&!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'You do not have access to this action.');
  if(!checking&&!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve a proposal.');
  await loadBatch(tx,ref);const rows=await proposalsOf(tx,ref,checking?'Proposed':'Checked');
  if(!rows.length)fail(409,checking?'No proposals in this batch are waiting for a check.':'No proposals in this batch are checked and waiting for approval.');
  const done:any[]=[],held:any[]=[];
  for(const r of rows){
   const label=String(r.payload.full_name||'entry');
   const res=await attempt(tx,true,()=>run({action:checking?'client_proposal_check':'client_proposal_approve',proposal_id:r.proposal_id,note}));
   (res.ok?done:held).push(res.ok?{proposal_id:r.proposal_id,name:label}:{proposal_id:r.proposal_id,name:label,reason:res.reason});
  }
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'onboarding_batches',${checking?'ONBOARDING_BATCH_CHECKED':'ONBOARDING_BATCH_APPROVED'},${ref},${tx.json({batch_ref:ref,done:done.length,held:held.length})})`;
  return {ok:true,batch_ref:ref,status:checking?'Checked':'Approved',done,held};
 }
 if(action==='onboarding_batch_pdf'){
  const view=await batchView(tx,a,ref),lib=pdfLib();if(!lib)fail(500,'PDF generation is not available.');
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
  const firm=(await tx`select legal_name,physical_address,phone,email from erp_private.firms where firm_id=${view.batch.firm_id}`)[0]||{legal_name:'PCL Nexus'};
  const t=confirmationText(view.batch,view.clients.map((c:any)=>({name:c.name,pin:c.pin,activity:c.activity,rating:c.rating,condition:c.condition})));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(t))))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const bytes=await onboardingConfirmationPdf(t,{firm,issued_at:new Date().toISOString(),digest},lib);
  let s='';for(let i=0;i<bytes.length;i+=16384)s+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {ok:true,file_name:`MLRO-confirmation-${ref}.pdf`,mime_type:'application/pdf',base64:btoa(s),fingerprint:digest.slice(0,16),status:view.batch.status};
 }
 // ---- the MLRO part: the right, and never the person who uploaded the batch ----
 if(!(await isMlro(tx)))fail(403,'Only the appointed MLRO or an Engagement Partner does this. An Engagement Partner appoints the MLRO under Staff, then Additional rights.');
 const b=await loadBatch(tx,ref,true);
 if(b.created_by===a.staff_id)fail(403,'The person who uploaded this batch cannot record its MLRO checks or decide it.');
 if(b.status==='Confirmed')fail(409,'This batch is confirmed and closed.');
 if(action==='onboarding_batch_checks_save'){
  const c=cleanBatchChecks(p.fields||{},{now:nairobi()});if(!c.ok)return {saved:false,errors:c.errors};
  const v=c.value,name=(await tx`select erp_private.aml_staff_name(${a.staff_id}) n`)[0].n;
  await tx`update erp_private.onboarding_batches set checks=${tx.json(v.checks)},exposure_instruction_on=${v.exposure_instruction_on}::date,evidence_reference=${v.evidence_reference},uncovered_clients=${v.uncovered_clients},staff_register_checked_on=${v.staff_register_checked_on}::date,
   conditions_cleared=${v.conditions_cleared},mlro_staff_id=${a.staff_id},mlro_name=${name},decision_date=${v.decision_date}::date,next_screening_due=${v.next_screening_due}::date,full_review_due=${v.full_review_due}::date,
   checks_saved_at=now(),status=${c.complete?'Checks complete':'Staged'} where batch_ref=${ref}`;
  return {...(await batchView(tx,a,ref)),saved:true,complete:c.complete};
 }
 if(action==='onboarding_batch_ratings_save'){
  const items=Array.isArray(p.items)?p.items:[];if(!items.length||items.length>MAX_CLIENTS)fail(400,'Send the clients you are rating.');
  for(const it of items){
   const cid=uuid(it.client_id),rating=String(it.risk_rating||''),cond=String(it.condition??'').replace(/\s+/g,' ').trim();
   if(!['Low','Medium','High'].includes(rating))fail(400,'Choose Low, Medium or High for every client you rate.');
   if(cond.length>1000)fail(400,'A condition of acceptance is too long (at most 1,000 characters).');
   const done=await tx`update erp_private.onboarding_batch_clients set risk_rating=${rating},condition_text=${cond||'None'},rated_by=${a.staff_id},rated_at=now() where batch_ref=${ref} and client_id=${cid} returning client_id`;
   if(!done.length)fail(404,'A client you rated is not in this batch.');
  }
  return {...(await batchView(tx,a,ref)),saved:true};
 }
 if(action==='onboarding_batch_accept'){
  if(b.status!=='Checks complete')fail(409,'Complete and save every MLRO check first (all six checks, the evidence reference, the staff-register date, the conditions answer, the clients not covered and the decision date).');
  const view=await batchView(tx,a,ref),uncovered=String(b.uncovered_clients||'').toLowerCase();
  const done:any[]=[],held:any[]=[];
  for(const c of view.clients){
   const why:string[]=[...c.hold];
   if(c.decision&&c.stage==='Decided')continue;
   if(!c.rating)why.push('No rating has been recorded for this client.');
   else if(c.rating==='High')why.push('A High rating needs enhanced due diligence: decide this client on the AML screen.');
   if(uncovered&&uncovered!=='none'&&(uncovered.includes(String(c.pin).toLowerCase())||uncovered.includes(String(c.name).toLowerCase())))why.push('This client is listed as not covered by a check.');
   const prof=(await tx`select submitted_by,last_edited_by,pep_type from erp_private.client_aml_profiles where client_id=${c.client_id}`)[0];
   if(prof&&(prof.submitted_by===a.staff_id||prof.last_edited_by===a.staff_id))why.push('You prepared or submitted this profile, so another MLRO or an Engagement Partner must decide it.');
   if(prof?.pep_type&&prof.pep_type!==PEP_NONE)why.push('A PEP status is recorded: decide this client on the AML screen.');
   const cond=(c.condition||'None').trim(),conditional=cond.toLowerCase()!=='none';
   if(conditional&&cond.length<10)why.push('The condition of acceptance is too short (at least 10 characters), or write None.');
   if(why.length){held.push({client_id:c.client_id,name:c.name,reasons:[...new Set(why)]});continue;}
   const res=await attempt(tx,true,()=>run({action:'aml_decide',client_id:c.client_id,decision:conditional?'Accept with conditions':'Accept',risk_rating:c.rating,
    risk_reasons:`Rated ${c.rating} under the firm’s client risk assessment matrix (version 1), batch ${ref}.`,decision_conditions:conditional?cond:undefined,decision_reason:`Accepted on the MLRO’s batch confirmation ${ref}.`,
    next_review:day(b.full_review_due),review_reason:`Full periodic review two years after the batch decision (${ref}).`}));
   if(res.ok&&res.out?.decided===false)held.push({client_id:c.client_id,name:c.name,reasons:(res.out.errors||[]).map((e:any)=>e.error)});
   else if(res.ok)done.push({client_id:c.client_id,name:c.name,rating:c.rating,decision:conditional?'Accept with conditions':'Accept'});
   else held.push({client_id:c.client_id,name:c.name,reasons:[res.reason||'Not accepted.']});
  }
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'onboarding_batches','ONBOARDING_BATCH_ACCEPTED',${ref},${tx.json({batch_ref:ref,accepted:done.length,held:held.length})})`;
  return {ok:true,batch_ref:ref,done,held};
 }
 if(action==='onboarding_batch_sign'){
  if(b.status!=='Checks complete')fail(409,'Complete the MLRO checks before attaching the signed confirmation.');
  const ref2=text(p.doc_ref,40).trim().toUpperCase();
  const doc=(await tx`select d.document_id,d.file_name,d.mime_type from erp_private.documents d join erp_private.onboarding_batch_clients bc on bc.client_id=d.client_id and bc.batch_ref=${ref} where d.doc_ref=${ref2} and d.deleted_at is null limit 1`)[0];
  if(!doc)fail(400,`${ref2} is not a document of a client in this batch. Upload the signed PDF to one of the batch’s clients first, then enter its DOC reference.`);
  if(doc.mime_type!=='application/pdf')fail(400,'The signed confirmation must be a PDF.');
  const open=(await tx`select count(*)::int n from erp_private.onboarding_batch_clients bc left join erp_private.client_aml_profiles p on p.client_id=bc.client_id where bc.batch_ref=${ref} and (p.stage is distinct from 'Decided' and (bc.risk_rating is not null))`)[0].n;
  if(open)fail(409,`${open} rated client${open===1?' is':'s are'} not yet decided. Accept them, or decide them on the AML screen, before confirming the batch.`);
  await tx`update erp_private.onboarding_batches set signed_doc_ref=${ref2},signed_document_id=${doc.document_id},signed_by=${a.staff_id},signed_at=now(),status='Confirmed' where batch_ref=${ref}`;
  return {...(await batchView(tx,a,ref)),signed:true};
 }
 return undefined;
}
