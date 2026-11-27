// Billing from the previous system (Odoo): the checks made on a load file before anything is kept. Pure rules, no database.
// One sheet, "Prior billing", one line per invoice, credit note or payment. Amounts are positive. Dates are YYYY-MM-DD.
// One error anywhere stops the whole file. Differences between a client's documents and the balance the previous system showed
// are listed for the approver; they do not stop the file, because money paid on account is a normal case.
export const PRIOR_SHEET='Prior billing',MAX_PRIOR_ROWS=5000;
export const PRIOR_COLUMNS=['kind','reference','client_name','firm_code','document_date','due_date','amount_before_vat','vat','total','amount_still_due','previous_status','reverses_invoice','method'];
const KINDS=['Invoice','Credit note','Payment'],r2=n=>Math.round((Number(n)+Number.EPSILON)*100)/100;
export const clientKey=s=>String(s??'').normalize('NFKC').replace(/[’‘]/g,"'").toUpperCase().replace(/\s+/g,' ').trim();
const isDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const day=v=>{if(v instanceof Date)return v.toISOString().slice(0,10);const s=String(v??'').trim();return s.length>=10&&isDay(s.slice(0,10))?s.slice(0,10):s;};
const num=v=>{const s=String(v??'').replace(/,/g,'').trim();if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:NaN;};
// rows: [{row,values}] as read from the sheet. clients: Map(clientKey -> client_id, or null when two clients share the name). firms: Map(firm_code -> firm_id).
export function checkPriorBilling(rows,{clients,firms,today,existing=new Set()}){
 const errors=[],clean=[],seen=new Set(),err=(row,field,message)=>errors.push({row,field,message});
 if(!rows.length)return {errors:[{row:0,field:'',message:'The sheet has no lines.'}],clean,summary:null};
 if(rows.length>MAX_PRIOR_ROWS)return {errors:[{row:0,field:'',message:`Load at most ${MAX_PRIOR_ROWS} lines in one file.`}],clean,summary:null};
 for(const {row,values:v} of rows){
  const kind=KINDS.find(k=>k.toLowerCase()===String(v.kind??'').trim().toLowerCase()),reference=String(v.reference??'').trim(),before=errors.length;
  if(!kind)err(row,'kind','Use Invoice, Credit note or Payment.');
  if(reference.length<3||reference.length>60)err(row,'reference','Give the document number from the previous system (3 to 60 characters).');
  const id=`${kind}|${reference.toUpperCase()}`;
  if(kind&&reference){if(seen.has(id))err(row,'reference','This number appears twice in the file.');else if(existing.has(id))err(row,'reference','This document is already loaded.');seen.add(id);}
  const key=clientKey(v.client_name),client=clients.get(key);
  if(!key)err(row,'client_name','Give the client name as it is in the ERP.');
  else if(client===undefined)err(row,'client_name',`No client named “${String(v.client_name).trim()}” is in the ERP.`);
  else if(client===null)err(row,'client_name',`More than one client is named “${String(v.client_name).trim()}”. Rename one before loading.`);
  const code=String(v.firm_code??'').trim().toUpperCase(),firm=code?firms.get(code):null;
  if(code&&!firm)err(row,'firm_code',`“${code}” is not one of the firms.`);
  if(!code&&kind&&kind!=='Payment')err(row,'firm_code','Give the firm that issued this document.');
  const date=day(v.document_date),due=day(v.due_date);
  if(!isDay(date))err(row,'document_date','Use a date as YYYY-MM-DD.');else if(date>today)err(row,'document_date','The date is in the future.');
  if(due&&!isDay(due))err(row,'due_date','Use a date as YYYY-MM-DD, or leave it blank.');
  const total=num(v.total),net=num(v.amount_before_vat),vat=num(v.vat),owed=num(v.amount_still_due);
  if(total===null||Number.isNaN(total)||total<=0)err(row,'total','Give the total as a number greater than zero.');
  if(kind==='Payment'){if(net!==null||vat!==null)err(row,'amount_before_vat','Leave the VAT columns blank for a payment.');if(owed)err(row,'amount_still_due','Leave this blank for a payment.');}
  else if(kind){
   if(net===null||vat===null||Number.isNaN(net)||Number.isNaN(vat)||net<=0||vat<0)err(row,'amount_before_vat','Give the amount before VAT and the VAT as numbers.');
   else if(total>0&&Math.abs(r2(net+vat)-total)>0.01)err(row,'total','The amount before VAT plus VAT does not equal the total.');
   if(kind==='Credit note'&&owed)err(row,'amount_still_due','Leave this blank for a credit note.');
   if(kind==='Invoice'&&(Number.isNaN(owed)||(owed??0)<0||(total>0&&(owed??0)>total+0.001)))err(row,'amount_still_due','The amount still due must be between zero and the total.');
  }
  const status=String(v.previous_status??'').trim();if(!status||status.length>40)err(row,'previous_status','Give the status the document had in the previous system.');
  if(errors.length===before)clean.push({row,kind,reference,client_id:client,client_name:String(v.client_name).trim(),firm_id:firm||'',firm_code:code,doc_date:date,due_date:kind==='Invoice'&&due&&due>=date?due:'',
   net_amount:kind==='Payment'?'':r2(net),vat_amount:kind==='Payment'?'':r2(vat),total_amount:r2(total),amount_due:kind==='Invoice'?r2(owed??0):0,prior_status:status,
   reverses_reference:kind==='Credit note'?String(v.reverses_invoice??'').trim():'',method:kind==='Payment'?String(v.method??'').trim().slice(0,40):''});
 }
 if(!errors.length){const invoices=new Map(clean.filter(d=>d.kind==='Invoice').map(d=>[d.reference.toUpperCase(),d]));
  for(const d of clean)if(d.kind==='Credit note'&&d.reverses_reference){const i=invoices.get(d.reverses_reference.toUpperCase());
   if(!i)err(d.row,'reverses_invoice','This invoice number is not in the file.');else if(i.client_id!==d.client_id)err(d.row,'reverses_invoice','That invoice belongs to a different client.');}}
 if(errors.length)return {errors,clean:[],summary:null};
 return {errors,clean,summary:summarise(clean)};
}
// Totals for the approver, and each client whose documents do not add up to the balance the previous system showed.
export function summarise(docs){
 const sum=(k,f='total_amount')=>r2(docs.filter(d=>d.kind===k).reduce((s,d)=>s+Number(d[f]||0),0)),n=k=>docs.filter(d=>d.kind===k).length,per=new Map();
 for(const d of docs){const c=per.get(d.client_id)||{client_id:d.client_id,client_name:d.client_name,invoiced:0,credited:0,paid:0,due:0};
  if(d.kind==='Invoice'){c.invoiced+=d.total_amount;c.due+=d.amount_due;}else if(d.kind==='Credit note')c.credited+=d.total_amount;else c.paid+=d.total_amount;per.set(d.client_id,c);}
 const differences=[...per.values()].map(c=>({...c,invoiced:r2(c.invoiced),credited:r2(c.credited),paid:r2(c.paid),due:r2(c.due),difference:r2(c.invoiced-c.credited-c.paid-c.due)})).filter(c=>Math.abs(c.difference)>0.5)
  .map(c=>({...c,meaning:c.difference<0?'Paid more than was invoiced: money held on account':'Less paid than the balance implies: a payment or credit note may be missing'})).sort((x,y)=>x.client_name.localeCompare(y.client_name));
 return {lines:docs.length,clients:per.size,invoices:n('Invoice'),credit_notes:n('Credit note'),payments:n('Payment'),invoiced:sum('Invoice'),credited:sum('Credit note'),paid:sum('Payment'),still_due:sum('Invoice','amount_due'),
  open_invoices:docs.filter(d=>d.kind==='Invoice'&&d.amount_due>0).length,differences};
}
