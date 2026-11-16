// Build 2842: bulk client set-up. Pure rules, no database, no clock.
// One set-up choice is applied to many clients. Each row is checked on its own through the same single-client rules (the server calls the existing action per row,
// inside a savepoint), so a row that passes here is applied exactly as if it had been done by hand, and a row that fails never blocks the others.
import {RETURNS,RETURN_CODES} from './export-profile-rules.mjs';
export const MAX_ROWS=200;
export const OPERATIONS=Object.freeze({
 ENGAGEMENT:'Set up a service for several clients (from an approved service template)',
 PAYROLL_RETURNS:'Choose the payroll returns several clients file (NSSF, SHIF, PAYE P10)'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const validDate=v=>{if(!DATE.test(v))return false;const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;};
const isId=v=>typeof v==='string'&&UUID.test(v);

// Checks what is common to every row and turns the submitted list into one entry per client and item. A request-level problem stops the whole run (nothing can be applied);
// a row-level problem only skips that row. Returns {problem} or {common,rows:[{row_no,client_id,item,input,problem?}]}.
export function expandRun(p){
 const op=clean(p?.operation);if(!OPERATIONS[op])return {problem:'Choose what to set up for these clients.'};
 const list=Array.isArray(p.rows)?p.rows:[];
 if(!list.length)return {problem:'Choose at least one client.'};
 if(list.length>MAX_ROWS)return {problem:`A run takes up to ${MAX_ROWS} clients. Split the list.`};
 let common,items;
 if(op==='ENGAGEMENT'){
  const scope=clean(p.scope),from=clean(p.period_start),to=clean(p.period_end);
  if(!isId(p.template_id))return {problem:'Choose the approved service template.'};
  if(!clean(p.service_code))return {problem:'Choose the service.'};
  if(!validDate(from)||!validDate(to))return {problem:'Enter the first and last day of the period.'};
  if(to<from)return {problem:'The period cannot end before it starts.'};
  if(scope.length<10||scope.length>2000)return {problem:'Describe the scope in at least 10 characters.'};
  if(!isId(p.responsible_staff)||!isId(p.reviewer_staff))return {problem:'Choose the responsible person and the reviewer.'};
  common={operation:op,template_id:p.template_id,service_code:clean(p.service_code),period_start:from,period_end:to,scope,responsible_staff:p.responsible_staff,reviewer_staff:p.reviewer_staff};
  items=[clean(p.service_code)];
 }else{
  const codes=[...new Set((Array.isArray(p.return_codes)?p.return_codes:[]).map(clean))];
  if(!codes.length||codes.some(c=>!RETURNS[c]))return {problem:'Choose at least one return.'};
  const from=clean(p.effective_from),note=clean(p.note);
  if(!validDate(from))return {problem:'Say the first day these returns apply.'};
  if(note.length>500)return {problem:'The note is too long (500 characters at most).'};
  common={operation:op,return_codes:RETURN_CODES.filter(c=>codes.includes(c)),effective_from:from,note:note||null};
  items=common.return_codes;
 }
 const rows=[],seen=new Set();let n=0;
 for(const r of list){
  const label=clean(r?.client_label||'').slice(0,200)||null;
  const cid=r?.client_id;
  for(const item of items){
   n++;
   const base={row_no:n,client_id:isId(cid)?cid:null,client_label:label,item:op==='PAYROLL_RETURNS'?(RETURNS[item]?.label||item):item,key:item};
   if(!isId(cid)){rows.push({...base,problem:'This row has no valid client reference.'});continue;}
   const dup=cid+'|'+item;if(seen.has(dup)){rows.push({...base,problem:'This client is listed more than once for the same item. Only the first row is used.'});continue;}
   seen.add(dup);
   if(op==='ENGAGEMENT'){
    const firm=r.firm_id==null||r.firm_id===''?null:r.firm_id;
    if(firm!==null&&!isId(firm)){rows.push({...base,problem:'The handling firm reference is not valid.'});continue;}
    const resp=r.responsible_staff||common.responsible_staff,rev=r.reviewer_staff||common.reviewer_staff;
    if(!isId(resp)||!isId(rev)){rows.push({...base,problem:'The responsible person or reviewer reference is not valid.'});continue;}
    rows.push({...base,input:{client_id:cid,firm_id:firm,responsible_staff:resp,reviewer_staff:rev}});
   }else rows.push({...base,input:{client_id:cid,return_code:item}});
  }
 }
 return {common,rows};
}

// Turns what one row did into the line shown to the person and stored in the audit record.
export const verdict=(row,applied,detail)=>applied?{...pick(row),outcome:'Applied',reason:null,record_ref:detail?.record_ref||null,note:detail?.note||null}
 :{...pick(row),outcome:'Skipped',reason:clean(detail?.reason||'Not applied.').slice(0,600),record_ref:null,note:null};
const pick=r=>({row_no:r.row_no,client_id:r.client_id,client_label:r.client_label||null,item:r.item});

// A preview verdict: ready means every check the apply would make passed; the row has not been applied.
export const previewVerdict=(row,ready,detail)=>ready?{...pick(row),outcome:'Ready',reason:null,note:detail?.note||null}:{...pick(row),outcome:'Skipped',reason:clean(detail?.reason||'Not ready.').slice(0,600),note:null};

export function summarise(results){
 const ready=results.filter(r=>r.outcome==='Ready'||r.outcome==='Applied');
 const skipped=results.filter(r=>r.outcome==='Skipped');
 return {total:results.length,ready:ready.length,applied:results.filter(r=>r.outcome==='Applied').length,skipped:skipped.length,exceptions:skipped.map(r=>({row_no:r.row_no,client_id:r.client_id,client_label:r.client_label,item:r.item,reason:r.reason}))};
}
