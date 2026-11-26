import {fail,fileType,text,uuid} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {cleanCell} from './suite-rules.mjs';
import {createProposal} from './proposal-actions.ts';
import {checkOwnerRows,checkContactRows,NOT_SIGHTED,SHARE_TOLERANCE,MAX_OWNER_ROWS} from './owner-batch-rules.mjs';
// Owners and contacts from the client workbook. A preparer (Assistant or Supervisor) uploads the workbook the firm already keeps: its "Beneficial Owners" sheet and, when present,
// its "Contacts" sheet. The owners and directors listed are the client's beneficial owners. Every row is checked first; one error stops the whole file and nothing is saved.
// Rules: every client must already be on file; every owner needs a share; a client's shares must total 100%, counting the owners already on its record.
// A clean file becomes one ordinary "Add owner" proposal per owner and one "Add contact" proposal per contact, tagged with a batch reference, so every existing rule still applies:
// a different Supervisor, Manager or Partner checks each proposal, and a Manager or Partner who neither prepared nor checked it approves it.
// No identity-document number is read or kept, and the screening columns of the sheet are not loaded: screening is recorded by the MLRO.
const ACTIONS=['owner_batch_check','owner_batch_approve'];
const KINDS=['owner_add','owner_share_amend','contact_save'];
export class Rollback extends Error{}
const plain=(e:any,fallback:string)=>e?.status?String(e.message):e?.code==='23505'?'This record already exists for the client.':fallback;
export async function attempt(tx:any,keep:boolean,fn:(t:any)=>Promise<any>):Promise<{ok:boolean,out?:any,reason?:string}>{
 let out:any;
 try{await tx.savepoint(async(t:any)=>{out=await fn(t);if(!keep)throw new Rollback();});return {ok:true,out};}
 catch(e:any){if(e instanceof Rollback)return {ok:true,out};if(!e?.status)console.error('Owner batch row failed',{code:e?.code||'INTERNAL',type:e?.name||'Error'});return {ok:false,reason:plain(e,'This row could not be saved. Check it and try it on its own.')};}
}
const key=(h:any)=>cleanCell(h).toLowerCase().replaceAll(' ','_').replaceAll('&','and');
export function sheetRows(sheet:any,max:number){
 const heads=Array.from({length:sheet.columnCount},(_,i)=>key(sheet.getRow(1).getCell(i+1).value)),out:any[]=[];
 for(let r=2;r<=sheet.rowCount&&out.length<=max;r++){
  const raw=Array.from({length:sheet.columnCount},(_,i)=>sheet.getRow(r).getCell(i+1).value);if(raw.every(v=>v==null||String(v).trim()===''))continue;
  const values:any={};heads.forEach((h,i)=>{if(h){const v=raw[i];values[h]=v&&typeof v==='object'&&'formula' in v?cleanCell((v as any).result??''):cleanCell(v);}});
  out.push({row:r,values});
 }
 return {heads,rows:out};
}
export async function ownerBatchStage(tx:any,a:any,f:FormData){
 if(!['ASSISTANT','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
 const file=f.get('file');if(!(file instanceof File))fail(400,'Choose an Excel workbook.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const names=(await readWorkbookSheet(bytes,null)).sheets.map((s:any)=>String(s.name));
 if(!names.includes('Beneficial Owners'))fail(400,'The workbook needs a sheet named “Beneficial Owners”.');
 const own=sheetRows((await readWorkbookSheet(bytes,'Beneficial Owners')).sheet,MAX_OWNER_ROWS);
 for(const h of ['client_kra_pin','full_name','ownership_percentage'])if(!own.heads.includes(h))fail(400,`The Beneficial Owners sheet needs a column named ${h}.`);
 const con=names.includes('Contacts')?sheetRows((await readWorkbookSheet(bytes,'Contacts')).sheet,MAX_OWNER_ROWS):{heads:[],rows:[]};
 const oc=checkOwnerRows(own.rows),cc=con.rows.length&&con.heads.includes('full_name')?checkContactRows(con.rows):{errors:[],notices:[],contacts:[]};
 const errors:any[]=[...oc.errors,...cc.errors],notices:any[]=[...oc.notices,...cc.notices],checked=oc.clients.length;
 const failed=(message:string)=>({status:'VALIDATION_FAILED',message,errors,notices,checked});
 if(errors.length)return failed('Nothing was proposed. Fix these rows in the workbook and upload it again.');
 // Every client must already be on file and visible to this person. One PIN must mean one client.
 const pins=[...new Set([...oc.clients.map((c:any)=>c.pin),...cc.contacts.map((c:any)=>c.pin)])];
 const found=await tx`select client_id,company_name,kra_pin from erp_private.clients where deleted_at is null and kra_pin=any(${pins})`;
 const byPin=new Map<string,any[]>();for(const r of found)byPin.set(r.kra_pin,[...(byPin.get(r.kra_pin)||[]),r]);
 const client=(pin:string,row:number,sheet:string)=>{const m=byPin.get(pin)||[];
  if(!m.length){errors.push({row,column:sheet+' · client_kra_pin',issue:`${pin} is not a client you can open. Add the client first or check the PIN.`,suggestion:null});return null;}
  if(m.length>1){errors.push({row,column:sheet+' · client_kra_pin',issue:`${pin} is the PIN of ${m.length} clients (${m.map((x:any)=>x.company_name).join('; ')}). Correct the PIN on the client records first.`,suggestion:null});return null;}
  return m[0];};
 const ref='OW-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().replace(/[^a-z0-9]/gi,'').slice(0,4).toUpperCase();
 const jobs:any[]=[],skipped:any[]=[];
 for(const c of oc.clients){
  const r=client(c.pin,c.row,'Beneficial Owners');if(!r)continue;
  if(c.name&&String(r.company_name).trim().toLowerCase()!==c.name.toLowerCase())notices.push({row:c.row,column:'Beneficial Owners · client_name',issue:`The workbook says “${c.name}” but the client on file is “${r.company_name}”. The client on file is used.`,suggestion:null});
  // A preparer cannot read the owners table. The database tells them only the share already recorded and which of these names are already recorded.
  const names=c.owners.map((o:any)=>o.full_name.toLowerCase());
  const pos=(await tx`select recorded_total,recorded_names from erp_private.owner_batch_position(${r.client_id}::uuid,${tx.array(names)}::text[])`)[0];
  const waiting=await tx`select lower(btrim(payload->>'full_name')) n,(payload->>'ownership_percentage')::numeric p from erp_private.change_proposals where client_id=${r.client_id} and action='owner_add' and status in('Proposed','Checked')`;
  const onFile=new Set<string>(pos.recorded_names||[]),pending=new Set(waiting.map((x:any)=>x.n));
  // The shares on the client after this file: owners already recorded or already proposed keep their share; the file adds the rest.
  let total=Number(pos.recorded_total||0);for(const w of waiting)total+=Number(w.p||0);
  const adds:any[]=[];
  for(const o of c.owners){const n=o.full_name.toLowerCase();
   if(onFile.has(n)){skipped.push({row:o.row,name:o.full_name,reason:'Already recorded as an owner of this client.'});continue;}
   if(pending.has(n)){skipped.push({row:o.row,name:o.full_name,reason:'Already proposed as an owner of this client and waiting for review.'});continue;}
   total+=o.ownership_percentage;adds.push(o);
  }
  if(adds.length&&Math.abs(total-100)>SHARE_TOLERANCE){errors.push({row:c.row,column:'Beneficial Owners · ownership_percentage',issue:`${r.company_name}: with the owners already on the client record or waiting for review, the shares would add to ${Math.round(total*100)/100}%. They must total 100%.`,suggestion:'Correct the shares in the workbook or on the client record.'});continue;}
  for(const o of adds)jobs.push({row:o.row,name:o.full_name,sheet:'Beneficial Owners',input:{action:'owner_add',client_id:r.client_id,full_name:o.full_name,identity_reference:NOT_SIGHTED,kra_pin:o.kra_pin||'',ownership_percentage:o.ownership_percentage,control_basis:o.control_basis,
   identity_type:o.identity_type,nationality:o.nationality,holding_type:o.holding_type,pep_status:o.pep_status,change_reason:`Client workbook batch ${ref}, Beneficial Owners row ${o.row}`,proposal_reason:`Batch ${ref} · Beneficial Owners row ${o.row}`,batch_ref:ref,batch_row:o.row}});
 }
 for(const k of cc.contacts){
  const r=client(k.pin,k.row,'Contacts');if(!r)continue;
  const {row,pin,...fields}=k;
  const cs=await tx`select 1 from erp_private.client_contacts where client_id=${r.client_id} and deleted_at is null and lower(btrim(full_name))=lower(${k.full_name})`;
  const cw=await tx`select 1 from erp_private.change_proposals where client_id=${r.client_id} and action='contact_save' and status in('Proposed','Checked') and lower(btrim(payload->>'full_name'))=lower(${k.full_name})`;
  if(cs.length)skipped.push({row,name:k.full_name,reason:'Already a contact of this client.'});
  else if(cw.length)skipped.push({row,name:k.full_name,reason:'Already proposed as a contact of this client and waiting for review.'});
  else jobs.push({row,name:k.full_name,sheet:'Contacts',input:{action:'contact_save',client_id:r.client_id,...fields,proposal_reason:`Batch ${ref} · Contacts row ${row}`,batch_ref:ref,batch_row:row}});
 }
 if(errors.length)return failed('Nothing was proposed. Fix these rows and upload the workbook again.');
 // First pass changes nothing and finds every entry the proposal rules would refuse; the second pass saves.
 for(const j of jobs){const r=await attempt(tx,false,t=>createProposal(t,a,j.input));if(!r.ok)errors.push({row:j.row,column:j.sheet,issue:`${j.name}: ${r.reason}`,suggestion:null});}
 if(errors.length)return failed('Nothing was proposed. These entries cannot be proposed as they are.');
 const proposed:any[]=[];
 for(const j of jobs){const out=await createProposal(tx,a,j.input);proposed.push({row:j.row,sheet:j.sheet,name:j.name,proposal_id:out.proposal_id});}
 const owners=proposed.filter(p=>p.sheet==='Beneficial Owners').length,contacts=proposed.length-owners;
 if(proposed.length)await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'owner_batches','OWNER_BATCH_PROPOSED',${crypto.randomUUID()},${tx.json({batch_ref:ref,file_name:String(file.name).slice(0,200),owners,contacts,skipped_existing:skipped.length})})`;
 return {status:'PROPOSED',batch_ref:proposed.length?ref:null,proposed,owners,contacts,skipped_existing:skipped,notices,checked,
  message:proposed.length?`${owners} owner${owners===1?'':'s'} and ${contacts} contact${contacts===1?'':'s'} sent for review under ${ref}. A different Supervisor, Manager or Partner checks them, then a Manager or Partner who did not prepare or check them approves.`:'Nothing new to propose: every owner and contact in the workbook is already on the client records or waiting for review.'};
}
export async function ownerBatchAction(tx:any,a:any,p:any,run:(p:any)=>Promise<any>):Promise<any>{
 const action=String(p.action||'');if(!ACTIONS.includes(action))return undefined;
 const ref=text(p.batch_ref,40),note=text(p.note||'',1000,false),checking=action==='owner_batch_check';
 if(note.length<10)fail(400,'Record your '+(checking?'check conclusion':'approval note')+' in at least 10 characters.');
 if(checking&&!['SUPERVISOR','MANAGER','PARTNER'].includes(a.category_code))fail(403,'You do not have access to this action.');
 if(!checking&&!['MANAGER','PARTNER'].includes(a.category_code))fail(403,'Only a Manager or Partner can approve a proposal.');
 const rows=await tx`select proposal_id,client_id,action,payload from erp_private.change_proposals where action=any(${KINDS}) and status=${checking?'Proposed':'Checked'} and payload->>'batch_ref'=${ref} order by action desc,(payload->>'batch_row')::int`;
 if(!rows.length)fail(409,checking?'No proposals in this batch are waiting for a check.':'No proposals in this batch are checked and waiting for approval.');
 const done:any[]=[],held:any[]=[];
 for(const r of rows){
  const name=String(r.payload.full_name||r.payload.owner_name||'entry');
  const res=await attempt(tx,true,()=>run({action:checking?'client_proposal_check':'client_proposal_approve',proposal_id:r.proposal_id,note}));
  (res.ok?done:held).push(res.ok?{proposal_id:r.proposal_id,name}:{proposal_id:r.proposal_id,name,reason:res.reason});
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'owner_batches',${checking?'OWNER_BATCH_CHECKED':'OWNER_BATCH_APPROVED'},${crypto.randomUUID()},${tx.json({batch_ref:ref,done:done.length,held:held.length})})`;
 return {ok:true,batch_ref:ref,status:checking?'Checked':'Approved',done,held};
}
