import {fail,fileType,text,uuid} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {cleanCell} from './suite-rules.mjs';
import {checkClientRows,normaliseDate,normaliseYearEnd} from './client-import-check.mjs';
import {cleanValue} from './client-master-rules.mjs';
import {importFacts} from './client-master-import.ts';
import {sectorForActivity} from './activity-sectors.ts';
import {createProposal} from './proposal-actions.ts';
// Client batch loader. A preparer (Assistant or Supervisor) uploads a client workbook. Every row is checked first; one error stops the whole file and nothing is saved.
// By default a client already on file is left alone. When the preparer ticks "update existing clients", a client matched by PIN (or exact name) instead gets one ordinary "Change client details"
// proposal that carries only what the workbook adds or changes (sector, branch, category and facts not yet recorded). A blank cell never blanks a field and a recorded fact is never overwritten.
// A clean file becomes one ordinary "Add client" proposal per new client, tagged with a batch reference, so every existing rule still applies: a different Supervisor, Manager
// or Partner checks each proposal, and a Manager or Partner who neither prepared nor checked it approves it. "Check all" and "Approve all" run the same single-proposal
// actions one by one; they cannot skip a rule that one proposal would enforce. Approval also records the workbook's other facts (as Recorded, source Import, for a different person
// to verify) and prepares the client's business activity as a change set, which a different Manager or Partner must still apply.
const ACTIONS=['client_batch_check','client_batch_approve'];
const MAX_ROWS=200;
class Rollback extends Error{}
const plain=(e:any,fallback:string)=>e?.status?String(e.message):e?.code==='23505'?'A record already exists for this client.':fallback;
async function attempt(tx:any,keep:boolean,fn:(t:any)=>Promise<any>):Promise<{ok:boolean,out?:any,reason?:string}>{
 let out:any;
 try{await tx.savepoint(async(t:any)=>{out=await fn(t);if(!keep)throw new Rollback();});return {ok:true,out};}
 catch(e:any){if(e instanceof Rollback)return {ok:true,out};if(!e?.status)console.error('Client batch row failed',{code:e?.code||'INTERNAL',type:e?.name||'Error'});return {ok:false,reason:plain(e,'This row could not be saved. Check it and try it on its own.')};}
}
const key=(h:any)=>cleanCell(h).toLowerCase().replaceAll(' ','_').replaceAll('&','and');
function sheetRows(sheet:any){
 const heads=Array.from({length:sheet.columnCount},(_,i)=>key(sheet.getRow(1).getCell(i+1).value)),out:any[]=[];
 for(let r=2;r<=Math.min(sheet.rowCount,MAX_ROWS+1);r++){
  const raw=Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(r).getCell(i+1).value);if(raw.every(v=>v==null||String(v).trim()===''))continue;
  const values:any={};heads.forEach((h,i)=>{if(h){const v=raw[i];values[h]=v&&typeof v==='object'&&'formula' in v?'':cleanCell(v);}});
  out.push({row:r,values});
 }
 return out;
}
const pinOf=(v:any)=>String(v??'').trim().toUpperCase();
const CORE=['primary_sector','branch_location','client_category'];
// The workbook says which accounting family a client is in (Limited company, Partnership, Sole proprietor). The ERP also needs the subcategory. A column named legal_structure and legal_subtype
// on Client Details is used as written. Otherwise a sole proprietor is certain; a company or partnership is taken as the most common subcategory and the proposal says so, so the checker confirms it
// against the certificate. Any other family is not guessed.
const FAMILY:any={'limited company':['Limited Company','Private Limited Company',true],'partnership':['Partnership','General Partnership',true],'sole proprietor':['Individual','Sole Proprietor',false]};
function structureFor(d:any){
 const s=String(d.legal_structure||'').trim(),t=String(d.legal_subtype||'').trim();
 if(s&&t)return {legal_structure:s,legal_subtype:t,assumed:false};
 const m=FAMILY[String(d.legal_entity_type||'').trim().toLowerCase()];
 return m?{legal_structure:m[0],legal_subtype:m[1],assumed:m[2]}:null;
}
export async function clientBatchStage(tx:any,a:any,f:FormData){
 if(!['ASSISTANT','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
 const file=f.get('file');if(!(file instanceof File))fail(400,'Choose an Excel workbook.');
 const firm=uuid(f.get('firm_id'));
 const updateMode=String(f.get('existing')||'')==='update';
 if(!(await tx`select firm_id from erp_private.firms where firm_id=${firm} and is_active and deleted_at is null and erp_private.firm_allowed(firm_id)`).length)fail(403,'Choose a handling firm that your account can access.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const names=(await readWorkbookSheet(bytes,null)).sheets.map((s:any)=>String(s.name));
 if(!names.includes('Client Import'))fail(400,'The workbook needs a sheet named “Client Import”.');
 const read=async(name:string)=>names.includes(name)?sheetRows((await readWorkbookSheet(bytes,name)).sheet):[];
 const base=await read('Client Import'),details=await read('Client Details'),activities=await read('Industry & Activities'),contacts=await read('Contacts');
 if(!base.length)fail(400,'The Client Import sheet has no clients.');
 if(base.length>MAX_ROWS)fail(400,`Load up to ${MAX_ROWS} clients at a time.`);
 const byPin=(rows:any[])=>{const m=new Map<string,any>();for(const r of rows){const p=pinOf(r.values.kra_pin||r.values.client_kra_pin);if(p&&!m.has(p))m.set(p,r.values);}return m;};
 const det=byPin(details),act=byPin(activities),con=byPin(contacts);
 const sectors=(await tx`select name from erp_private.sectors where deleted_at is null order by name`).map((x:any)=>x.name);
 const merged=base.map(({row,values:v}:any)=>{
  const d=det.get(pinOf(v.kra_pin))||{},x=act.get(pinOf(v.kra_pin))||{};
  const month=Number(d.year_end_month),day=Number(d.year_end_day);
  return {row,values:{company_name:v.company_name,kra_pin:v.kra_pin,primary_sector:v.primary_sector,branch_location:v.branch_location,client_category:v.client_category,
   incorporation_date:d.incorporation_date||'',year_end:month&&day?String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0'):'',activity_code:x.activity_code||'',pack_code:x.pack_code||''}};
 });
 const check=checkClientRows(merged,{sectors,activitySectors:sectorForActivity});
 if(check.errors.length)return {status:'VALIDATION_FAILED',message:'Nothing was proposed. Fix these rows in the workbook and upload it again.',...check};
 const ref='CB-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,4).toUpperCase();
 const skipped:any[]=[],jobs:any[]=[],updates:any[]=[],missing:any[]=[],notices:any[]=[...check.notices];
 for(const {row,values:v} of merged){
  const name=String(v.company_name).trim(),pin=pinOf(v.kra_pin)||null;
  const same=await tx`select client_id,company_name,kra_pin,primary_sector,branch_location,client_category from erp_private.clients where deleted_at is null and ((${pin}::text is not null and kra_pin=${pin}) or lower(btrim(company_name))=lower(btrim(${name})))`;
  if(same.length&&!updateMode){skipped.push({row,name,reason:'Already a client. Existing details are never overwritten.'});continue;}
  if(same.length>1){skipped.push({row,name,reason:'More than one client matches this name or PIN. Change it on the client record.'});continue;}
  const d=det.get(pinOf(v.kra_pin))||{},x=act.get(pinOf(v.kra_pin))||{},c=con.get(pinOf(v.kra_pin))||{};
  const facts:any={};
  const put=(k:string,raw:any)=>{const s=String(raw??'').trim();if(!s)return;const clean=cleanValue(k,s,{});if(clean.ok)facts[k]=clean.value;else notices.push({row,column:k,issue:'Not recorded: '+clean.error,suggestion:null});};
  put('incorporation_date',normaliseDate(v.incorporation_date)||v.incorporation_date);put('year_end',normaliseYearEnd(v.year_end)||v.year_end);
  if(d.trading_name&&String(d.trading_name).trim().toLowerCase()!==name.toLowerCase())put('trading_name',d.trading_name);
  put('contact_person',c.full_name);put('contact_email',c.email_address);put('contact_phone',c.phone_number);
  if(same.length===1){
   const live=same[0],changes:string[]=[],input:any={action:'client_save',client_id:live.client_id,company_name:live.company_name,kra_pin:live.kra_pin};
   if(String(live.company_name).trim().toLowerCase()!==name.toLowerCase())notices.push({row,column:'Client name',issue:`The workbook says “${name}” but the client is “${live.company_name}”. The name was not changed.`,suggestion:null});
   for(const k of CORE){const w=String(v[k]??'').trim(),cur=String((live as any)[k]??'').trim();if(w&&w!==cur){input[k]=w;changes.push(`${k.replace('_',' ')}: ${cur||'(blank)'} → ${w}`);}}
   const recorded=await tx`select field_key,value from erp_private.client_field_facts where client_id=${live.client_id} and status<>'Superseded'`;
   for(const r of recorded){const k=String(r.field_key);if(facts[k]===undefined)continue;if(String(facts[k]).trim()!==String(r.value).trim())notices.push({row,column:k,issue:`${name}: ${k.replace('_',' ')} is already recorded as “${r.value}”. The workbook value “${facts[k]}” was not applied.`,suggestion:null});delete facts[k];}
   for(const k of Object.keys(facts))changes.push(`record ${k.replace('_',' ')}: ${facts[k]}`);
   if(!changes.length){skipped.push({row,name,reason:'No change needed. The client already has these details.'});continue;}
   const firms=(await tx`select firm_id from erp_private.client_firm_links where client_id=${live.client_id}`).map((r:any)=>r.firm_id);
   updates.push({row,name,pin,input:{...input,firm_ids:firms.length?firms:[firm],proposal_reason:`Batch ${ref} · workbook row ${row} · update: ${changes.join('; ')}`.slice(0,900),batch_ref:ref,batch_row:row,batch_mode:'update',import_facts:facts},changes});
   continue;
  }
  const planned=x.activity_code?{activity_code:String(x.activity_code).trim().toLowerCase(),effective_from:normaliseDate(x.effective_from)||'',evidence:String(x.evidence||'Client workbook').slice(0,500)}:null;
  const ls=structureFor(d);
  if(!ls){missing.push({row,column:'Legal entity type',issue:Object.keys(d).length?`${name}: the Client Details sheet does not say what kind of entity this is (Limited company, Partnership or Sole proprietor).`:`${name}: this PIN has no row on the Client Details sheet, so the kind of entity is not known.`,suggestion:String(v.client_category||'').trim()==='Individual'?'Sole proprietor':null});continue;}
  if(ls.assumed)notices.push({row,column:'Legal subcategory',issue:`${ls.legal_subtype} is assumed from “${d.legal_entity_type}”. The checker confirms it against the certificate.`,suggestion:null});
  jobs.push({row,name,pin,input:{action:'client_save',company_name:name,kra_pin:pin,primary_sector:v.primary_sector||null,branch_location:v.branch_location||null,client_category:v.client_category||null,...(ls?{legal_structure:ls.legal_structure,legal_subtype:ls.legal_subtype}:{}),firm_ids:[firm],
   proposal_reason:`Batch ${ref} · workbook row ${row}${ls?.assumed?` · ${ls.legal_subtype} assumed from the workbook: confirm on the certificate`:''}`.slice(0,300),batch_ref:ref,batch_row:row,import_facts:facts,planned_activity:planned&&planned.effective_from?planned:null}});
 }
 if(missing.length)return {status:'VALIDATION_FAILED',message:'Nothing was proposed. Add the missing details to the workbook and upload it again.',errors:missing,notices,checked:merged.length};
 // First pass changes nothing and finds every row the proposal rules would refuse; the second pass saves.
 const refused:any[]=[];
 for(const j of [...jobs,...updates]){const r=await attempt(tx,false,t=>createProposal(t,a,j.input));if(!r.ok)refused.push({row:j.row,name:j.name,reason:r.reason});}
 if(refused.length)return {status:'VALIDATION_FAILED',message:'Nothing was proposed. These rows cannot be proposed as they are.',errors:refused.map(x=>({row:x.row,column:'Client',issue:`${x.name}: ${x.reason}`,suggestion:null})),notices,checked:merged.length};
 const proposed:any[]=[];
 for(const j of [...jobs,...updates]){const out=await createProposal(tx,a,j.input);proposed.push({row:j.row,name:j.name,proposal_id:out.proposal_id,...(j.changes?{update:true,changes:j.changes}:{})});}
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_batches','BATCH_PROPOSED',${crypto.randomUUID()},${tx.json({batch_ref:ref,file_name:file.name,proposed:proposed.length,updates:updates.length,skipped_existing:skipped.length})})`;
 return {status:'PROPOSED',batch_ref:ref,proposed,skipped_existing:skipped,notices,checked:merged.length,updates:updates.length,message:`${proposed.length} client proposal${proposed.length===1?'':'s'}${updates.length?` (${updates.length} changing existing clients)`:''} sent for review under ${ref}. A different Supervisor, Manager or Partner checks them, then a Manager or Partner who did not prepare or check them approves.`};
}
async function openRows(tx:any,ref:string,status:string){
 return await tx`select proposal_id,client_id,payload,revision,proposed_by from erp_private.change_proposals where action='client_save' and status=${status} and payload->>'batch_ref'=${ref} order by (payload->>'batch_row')::int`;
}
export async function clientBatchAction(tx:any,a:any,p:any,run:(p:any)=>Promise<any>):Promise<any>{
 const action=String(p.action||'');if(!ACTIONS.includes(action))return undefined;
 const ref=text(p.batch_ref,40),note=text(p.note||'',1000,false);
 if(note.length<10)fail(400,'Record your '+(action==='client_batch_check'?'check conclusion':'approval note')+' in at least 10 characters.');
 const checking=action==='client_batch_check';
 if(checking&&!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'You do not have access to this action.');
 if(!checking&&!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve a proposal.');
 const rows=await openRows(tx,ref,checking?'Proposed':'Checked');
 if(!rows.length)fail(409,checking?'No proposals in this batch are waiting for a check.':'No proposals in this batch are checked and waiting for approval.');
 const done:any[]=[],held:any[]=[];
 for(const r of rows){
  const name=String(r.payload.company_name||'client');
  const res=await attempt(tx,true,async t=>{
   if(checking)return await run({action:'client_proposal_check',proposal_id:r.proposal_id,note});
   const out=await run({action:'client_proposal_approve',proposal_id:r.proposal_id,note});
   const cid=out?.applied?.client_id||(r.payload.batch_mode==='update'?r.client_id:null);if(!cid)throw Object.assign(new Error('The client was not created.'),{status:409});
   if(r.payload.import_facts&&Object.keys(r.payload.import_facts).length)await importFacts(t,a,cid,r.payload.import_facts,'Batch '+ref,Number(r.payload.batch_row||0));
   let activity='none';
   if(r.payload.planned_activity){
    const step=await attempt(t,true,async s=>{const pv=await run({action:'v3_activities_preview',client_id:cid,activities:[r.payload.planned_activity]});return await run({action:'v3_activities_submit',client_id:cid,change_id:pv.change_id,revision:pv.revision,confirm_preview:true});});
    activity=step.ok?'submitted':'not prepared: '+step.reason;
   }
   return {client_id:cid,activity};
  });
  (res.ok?done:held).push(res.ok?{proposal_id:r.proposal_id,name,...(res.out?.client_id?{client_id:res.out.client_id,activity:res.out.activity}:{})}:{proposal_id:r.proposal_id,name,reason:res.reason});
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'client_batches',${checking?'BATCH_CHECKED':'BATCH_APPROVED'},${crypto.randomUUID()},${tx.json({batch_ref:ref,done:done.length,held:held.length})})`;
 return {ok:true,batch_ref:ref,status:checking?'Checked':'Approved',done,held};
}
