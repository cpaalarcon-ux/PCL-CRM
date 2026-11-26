import {fail,fileType} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
import {createProposal} from './proposal-actions.ts';
import {attempt,sheetRows} from './owner-batch-actions.ts';
import {checkAmendRows,resultingTotal,sharesTotal100,MAX_AMEND_ROWS} from './owner-amend-rules.mjs';
// Owner share amendments from the client workbook. A preparer (Assistant or Supervisor) uploads the workbook's "Owner Amendments" sheet. Every row is checked first;
// one error stops the whole file and nothing is saved. Each owner must already be on the client's record, each client's shares must total 100% afterwards
// (the owners not named in the file keep the share on record), and every row carries the evidence it rests on.
// A clean file becomes one "Change owner share" proposal per owner under a batch reference starting OA-, so every existing rule still applies: a different
// Supervisor, Manager or Partner checks each proposal, a Manager or Partner who neither prepared nor checked it approves it, and a verified KYC file goes back for re-verification.
export async function ownerAmendStage(tx:any,a:any,f:FormData){
 if(!['ASSISTANT','SUPERVISOR'].includes(a.category_code))fail(403,'You do not have access to this action.');
 const file=f.get('file');if(!(file instanceof File))fail(400,'Choose an Excel workbook.');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(fileType(file.name,bytes)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')fail(400,'Use an XLSX workbook.');checkWorkbookZip(bytes);
 const names=(await readWorkbookSheet(bytes,null)).sheets.map((s:any)=>String(s.name));
 if(!names.includes('Owner Amendments'))fail(400,'The workbook needs a sheet named “Owner Amendments”.');
 const sheet=sheetRows((await readWorkbookSheet(bytes,'Owner Amendments')).sheet,MAX_AMEND_ROWS);
 for(const h of ['client_kra_pin','full_name','ownership_percentage','evidence_reference','sighted_by','sighted_on'])if(!sheet.heads.includes(h))fail(400,`The Owner Amendments sheet needs a column named ${h}.`);
 const checked=checkAmendRows(sheet.rows),errors:any[]=[...checked.errors],notices:any[]=[...checked.notices];
 const failed=(message:string)=>({status:'VALIDATION_FAILED',message,errors,notices,checked:checked.clients.length});
 if(errors.length)return failed('Nothing was proposed. Fix these rows in the workbook and upload it again.');
 const pins=checked.clients.map((c:any)=>c.pin);
 const found=await tx`select client_id,company_name,kra_pin from erp_private.clients where deleted_at is null and kra_pin=any(${pins})`;
 const byPin=new Map<string,any[]>();for(const r of found)byPin.set(r.kra_pin,[...(byPin.get(r.kra_pin)||[]),r]);
 const ref='OA-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().replace(/[^a-z0-9]/gi,'').slice(0,4).toUpperCase();
 const jobs:any[]=[],skipped:any[]=[];
 for(const c of checked.clients){
  const m=byPin.get(c.pin)||[];
  if(!m.length){errors.push({row:c.row,column:'Owner Amendments · client_kra_pin',issue:`${c.pin} is not a client you can open.`,suggestion:'Check the PIN or ask for access to the client.'});continue;}
  if(m.length>1){errors.push({row:c.row,column:'Owner Amendments · client_kra_pin',issue:`${c.pin} is the PIN of ${m.length} clients. Correct the PIN on the client records first.`,suggestion:null});continue;}
  const r=m[0];
  if(c.name&&String(r.company_name).trim().toLowerCase()!==c.name.toLowerCase())notices.push({row:c.row,column:'Owner Amendments · client_name',issue:`The workbook says “${c.name}” but the client on file is “${r.company_name}”. The client on file is used.`,suggestion:null});
  const pos=(await tx`select erp_private.owner_amend_position(${r.client_id}::uuid,${tx.array(c.owners.map((o:any)=>o.full_name.toLowerCase()))}::text[]) p`)[0].p;
  if(!pos){errors.push({row:c.row,column:'Owner Amendments · client_kra_pin',issue:`${r.company_name} is not a client you can open.`,suggestion:null});continue;}
  const waiting=await tx`select payload->>'owner_id' id from erp_private.change_proposals where client_id=${r.client_id} and action='owner_share_amend' and status in('Proposed','Checked')`;
  const waitingIds=new Set(waiting.map((x:any)=>x.id)),matched:any[]=pos.matched||[];
  let bad=false;const todo:any[]=[];
  for(const o of c.owners){
   const hits=matched.filter(m=>m.name===o.full_name.toLowerCase());
   if(!hits.length){bad=true;errors.push({row:o.row,column:'Owner Amendments · full_name',issue:`${o.full_name} is not recorded as an owner of ${r.company_name}.`,suggestion:'Check the spelling against the client record, or propose the owner first.'});continue;}
   if(hits.length>1){bad=true;errors.push({row:o.row,column:'Owner Amendments · full_name',issue:`${r.company_name} has more than one owner called ${o.full_name}. Ask a Manager to correct the record first.`,suggestion:null});continue;}
   todo.push({o,rec:hits[0]});
  }
  if(bad)continue;
  const total=resultingTotal(pos.other_total,c.owners);
  if(!sharesTotal100(total)){errors.push({row:c.row,column:'Owner Amendments · ownership_percentage',issue:`${r.company_name}: with the owners not in this file, the shares would add to ${total}%. They must total 100%.`,suggestion:'Correct the shares, or add the owner who holds the rest.'});continue;}
  for(const {o,rec} of todo){
   if(waitingIds.has(rec.owner_id)){skipped.push({row:o.row,name:o.full_name,reason:'A share change for this owner is already waiting for review.'});continue;}
   if(Math.abs(Number(rec.share)-o.share)<0.0001){skipped.push({row:o.row,name:o.full_name,reason:`The share on record is already ${o.share}%.`});continue;}
   jobs.push({row:o.row,name:o.full_name,delta:o.share-Number(rec.share),input:{action:'owner_share_amend',client_id:r.client_id,owner_id:rec.owner_id,revision:String(rec.revision),owner_name:o.full_name,ownership_percentage:o.share,
    evidence_reference:o.evidence_reference,sighted_by:o.sighted_by,sighted_on:o.sighted_on,change_reason:`Share amendment batch ${ref}, Owner Amendments row ${o.row}`,proposal_reason:`Batch ${ref} · Owner Amendments row ${o.row}`,batch_ref:ref}});
  }
 }
 if(errors.length)return failed('Nothing was proposed. Fix these rows and upload the workbook again.');
 // Decreases are applied first, so a client's shares never add to more than 100% part-way through an approval.
 jobs.sort((x,y)=>x.delta-y.delta||x.row-y.row);jobs.forEach((j,i)=>{j.input.batch_row=i+1;});
 for(const j of jobs){const r=await attempt(tx,false,t=>createProposal(t,a,j.input));if(!r.ok)errors.push({row:j.row,column:'Owner Amendments',issue:`${j.name}: ${r.reason}`,suggestion:null});}
 if(errors.length)return failed('Nothing was proposed. These entries cannot be proposed as they are.');
 const proposed:any[]=[];
 for(const j of jobs){const out=await createProposal(tx,a,j.input);proposed.push({row:j.row,sheet:'Owner Amendments',name:j.name,proposal_id:out.proposal_id});}
 if(proposed.length)await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'owner_batches','OWNER_AMEND_BATCH_PROPOSED',${crypto.randomUUID()},${tx.json({batch_ref:ref,file_name:String(file.name).slice(0,200),proposed:proposed.length,skipped:skipped.length})})`;
 return {status:'PROPOSED',batch_ref:proposed.length?ref:null,proposed,owners:proposed.length,contacts:0,skipped_existing:skipped,notices,checked:checked.clients.length,
  message:proposed.length?`${proposed.length} owner share change${proposed.length===1?'':'s'} sent for review under ${ref}. A different Supervisor, Manager or Partner checks them, then a Manager or Partner who did not prepare or check them approves. Nothing on the client records changes until then.`:'Nothing to propose: every share in the file is already recorded or waiting for review.'};
}
