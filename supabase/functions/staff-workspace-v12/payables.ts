import {fail,text,uuid,choice} from './validation.mjs';
import {buildPayables,payablesChecks,PAYABLES_ACCOUNT,pinKey,nameKey} from './payables-rules.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
const PIN=/^[A-Z][0-9]{9}[A-Z]$/;

// The supplier ledger is rebuilt from the posted lines on the Trade payables control account (20000), so it can never drift
// from the general ledger. Suppliers are matched through the party on the source row; nothing is posted from here.
export async function payablesReport(tx:any,l:any,asOf:string){
 const suppliers=await tx`select supplier_id,name,kra_pin,aliases,currency,status,note,revision from erp_private.suppliers where client_id=${l.client_id} order by name`;
 const lines=await tx`select x.line_id,x.debit,x.credit,j.journal_date as date,j.kind,r.normalized->>'party' as party,r.normalized->>'party_pin' as pin
  from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id)
  left join erp_private.workbook_rows r on r.row_id::text=x.source_reference and r.project_id=x.project_id
  where x.project_id=${l.project_id} and j.period_id=${l.period_id} and x.account_code=${PAYABLES_ACCOUNT} and j.status='Posted' and j.journal_date<=${asOf}`;
 const rep=buildPayables({lines:lines.map((x:any)=>({...x,date:day(x.date),debit:Number(x.debit),credit:Number(x.credit)})),suppliers,asOf});
 const registerInUse=suppliers.some((s:any)=>s.status==='Active');
 return {...rep,register:suppliers,register_in_use:registerInUse,checks:payablesChecks(rep,{registerInUse})};
}

export async function supplierAction(tx:any,a:any,l:any,p:any){
 const cid=l.client_id;
 const tidy=(n:any)=>text(n,200).replace(/\s+/g,' ').trim();
 const pinOf=(v:any)=>{const s=String(v||'').toUpperCase().replace(/\s+/g,'');if(s&&!PIN.test(s))fail(400,'A KRA PIN looks like A123456789B: one letter, nine digits, one letter.');return s;};
 const dup=async(name:string,pin:string,except?:string)=>{
  const rows=await tx`select supplier_id,name,kra_pin from erp_private.suppliers where client_id=${cid} and (lower(btrim(name))=lower(btrim(${name})) or (${pin}<>'' and kra_pin=${pin}))`;
  const hit=rows.find((r:any)=>r.supplier_id!==except);if(hit)fail(409,`${hit.name} is already in the supplier register${hit.kra_pin?' ('+hit.kra_pin+')':''}.`);
 };
 if(p.action==='ledger_supplier_save'){
  const name=tidy(p.name);if(!name)fail(400,'Enter the supplier name as it appears on its invoices.');
  const pin=pinOf(p.kra_pin),currency=choice(p.currency||'KES',['KES','USD','EUR','GBP']),status=choice(p.status||'Active',['Active','Inactive']);
  const aliases=String(p.aliases||'').split(/[;\n]/).map((x:string)=>x.replace(/\s+/g,' ').trim()).filter(Boolean).map((x:string)=>tidy(x)).slice(0,20),note=text(p.note||'',500,false);
  if(p.supplier_id){
   const id=uuid(p.supplier_id),cur=(await tx`select * from erp_private.suppliers where supplier_id=${id} and client_id=${cid} for update`)[0];if(!cur)fail(403,'This record is not available to your account.');
   if(p.revision!=null&&Number(p.revision)!==Number(cur.revision))fail(409,'This supplier changed since you opened it. Reload and try again.');
   await dup(name,pin,id);
   return (await tx`update erp_private.suppliers set name=${name},kra_pin=${pin},aliases=${tx.array(aliases)}::text[],currency=${currency},status=${status},note=${note},updated_by=${a.staff_id} where supplier_id=${id} returning supplier_id,revision`)[0];
  }
  await dup(name,pin);
  return (await tx`insert into erp_private.suppliers(client_id,name,kra_pin,aliases,currency,status,note,created_by) values(${cid},${name},${pin},${tx.array(aliases)}::text[],${currency},'Active',${note},${a.staff_id}) returning supplier_id,revision`)[0];
 }
 if(p.action==='ledger_supplier_build'){
  // Create register entries from parties that already have posted payables movements. The list is rebuilt on the server.
  const rep=await payablesReport(tx,l,day(l.ends_on));
  const wanted=new Set((Array.isArray(p.keys)?p.keys:[]).map((k:any)=>String(k)));
  const chosen=rep.unregistered.filter((u:any)=>p.all===true||wanted.has(pinKey(u.pin)||nameKey(u.party)));
  if(!chosen.length)fail(400,'Choose at least one supplier to add.');
  let created=0;
  for(const u of chosen){
   const name=tidy(u.party||u.pin);if(!name)continue;const pin=PIN.test(pinKey(u.pin))?pinKey(u.pin):'';
   const exists=await tx`select 1 from erp_private.suppliers where client_id=${cid} and (lower(btrim(name))=lower(btrim(${name})) or (${pin}<>'' and kra_pin=${pin}))`;
   if(exists.length)continue;
   await tx`insert into erp_private.suppliers(client_id,name,kra_pin,created_by) values(${cid},${name},${pin},${a.staff_id})`;created++;
  }
  return {created};
 }
 fail(400,'Unknown supplier action.');
}
