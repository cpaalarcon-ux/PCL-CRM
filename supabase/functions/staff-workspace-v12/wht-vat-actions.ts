import {fail,uuid,text,date} from './validation.mjs';
import {stagingRates,preferredRates} from './testing-rates.mjs';
import {RATE_KEY,PIN_RE,ruleOn,withheldVat,purchaseEligibility,agentLineIssues,certificateLineIssues,certificateState} from './wht-vat-rules.mjs';
// Build 2834: withholding VAT. Supplier side: the sales invoices a certificate covers (the credit itself stays in the credit register). Agent side: the schedule of VAT withheld
// from suppliers, built from the retained KRA purchases CSV or from an invoice the preparer has sighted, with the rate taken from the rule in force on the payment date.
// Table rules are in 20261116210000_wht_vat.sql. Nothing here is sent to KRA.
const ACTIONS=['whtvat_read','whtvat_certificate_line','whtvat_agent_add','whtvat_agent_void','whtvat_agent_export'];
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
const one=(r:any[])=>{if(!r.length)fail(403,'This is unavailable to your account.');return r[0];};
const nairobiMonth=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,7);
const monthOf=(v:any)=>{const m=String(v||nairobiMonth());if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m))fail(400,'Choose the month as YYYY-MM.');return m;};
const cents=(v:any)=>Math.round((Number(v)||0)*100);
const money=(v:any,what:string)=>{const n=Number(v);if(v===''||v==null||!Number.isFinite(n)||n<=0||n>1e12)fail(400,`Enter ${what} as an amount above zero.`);return Math.round(n*100)/100;};
const said=(v:any,min:number,max:number,what:string)=>{const t=text(v,max);if(t.length<min)fail(400,`${what} (at least ${min} characters).`);return t;};
const pinOf=(v:any,what:string)=>{const s=String(v??'').trim().toUpperCase();if(!PIN_RE.test(s))fail(400,`Enter ${what} in the KRA format: a letter, nine digits and a letter.`);return s;};
const out=(l:any)=>({...l,invoice_date:day(l.invoice_date),payment_date:l.payment_date?day(l.payment_date):undefined,certificate_date:l.certificate_date?day(l.certificate_date):undefined,period_month:l.period_month?day(l.period_month).slice(0,7):undefined,
 invoice_net:Number(l.invoice_net),vat_withheld:Number(l.vat_withheld),rate:l.rate==null?undefined:Number(l.rate)});

async function rules(tx:any){
 const rows=await tx`select * from erp_private.tax_rates where rate_key=${RATE_KEY} and status in('Approved','Testing') and deleted_at is null`;
 return stagingRates(rows,typeof Deno==='undefined'?'https://yfjiculexbzpkvtapudk.supabase.co':Deno.env.get('SUPABASE_URL')||'');
}
const ruleFor=(all:any[],at:string)=>ruleOn(preferredRates(all,RATE_KEY,at,at),at);
// The latest (not superseded) KRA purchases CSV lines of the client, optionally one invoice. Lines already on an active schedule line are marked.
async function purchaseCsv(tx:any,cid:string,where:{pin?:string,invoice?:string,id?:string}={}){
 return await tx`select l.line_id,l.invoice_no,l.invoice_date,l.party_pin,l.party_name,l.net,l.vat,l.vat_category,l.document_type,b.period_month,b.section,
   exists(select 1 from erp_private.wht_vat_agent_lines w where w.csv_line_id=l.line_id and w.status='Active') as scheduled
   from erp_private.kra_csv_lines l join erp_private.kra_csv_batches b on b.batch_id=l.batch_id
   where l.client_id=${cid} and b.side='Purchases' and not exists(select 1 from erp_private.kra_csv_batches n where n.supersedes_batch_id=b.batch_id)
   and (${where.id??null}::uuid is null or l.line_id=${where.id??null}::uuid)
   and (${where.invoice??null}::text is null or upper(btrim(l.invoice_no))=upper(btrim(${where.invoice??null}::text)))
   and (${where.pin??null}::text is null or upper(btrim(coalesce(l.party_pin,'')))=upper(${where.pin??null}::text))
   order by b.period_month desc,l.invoice_date desc nulls last,l.line_no limit 600`;
}
async function context(tx:any,p:any){
 const project=one(await tx`select project_id,client_id,status from erp_private.projects where project_id=${uuid(p.project_id)} and deleted_at is null`);
 const client=one(await tx`select company_name,kra_pin from erp_private.clients where client_id=${project.client_id}`);
 return {project,client,cid:project.client_id as string};
}
async function agentLines(tx:any,cid:string,month:string){
 return (await tx`select line_id,period_month,supplier_pin,supplier_name,invoice_no,invoice_date,invoice_net,payment_date,rate,vat_withheld,vat_basis,csv_line_id,evidence_reference,status,void_reason,erp_private.reviewer_label(prepared_by) as prepared_by_name,created_at
  from erp_private.wht_vat_agent_lines where client_id=${cid} and period_month=${month+'-01'} order by payment_date,invoice_no`).map(out);
}

export async function whtVatAction(tx:any,a:any,p:any):Promise<any>{
 if(!ACTIONS.includes(p.action))return undefined;
 if(['INTERN','ADMIN'].includes(a.category_code))fail(403,'Withholding VAT is handled by staff preparers.');
 const {project,client,cid}=await context(tx,p);
 if(p.action==='whtvat_read'){
  const month=monthOf(p.month),all=await rules(tx);
  const credits=await tx`select credit_id,period_start,period_end,source_reference,erp_amount,itax_amount,status,claimed_in_case_id from erp_private.tax_credit_entries where client_id=${cid} and credit_type='WHT_VAT' and status<>'REJECTED' order by period_start desc,created_at desc limit 60`;
  const ids=credits.map((c:any)=>c.credit_id),lines=ids.length?await tx`select line_id,credit_id,withholder_pin,withholder_name,certificate_no,certificate_date,invoice_no,invoice_date,invoice_net,vat_withheld from erp_private.wht_vat_certificate_lines where credit_id=any(${ids}::uuid[]) order by certificate_date,invoice_no`:[];
  const sales=(await tx`select distinct l.invoice_no from erp_private.kra_csv_lines l join erp_private.kra_csv_batches b on b.batch_id=l.batch_id where l.client_id=${cid} and b.side='Sales' and not exists(select 1 from erp_private.kra_csv_batches n where n.supersedes_batch_id=b.batch_id) limit 20000`).map((x:any)=>x.invoice_no);
  const mine=(c:any)=>lines.filter((l:any)=>l.credit_id===c.credit_id).map(out);
  const lastDay=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),rule=ruleFor(all,lastDay);
  const schedule=await agentLines(tx,cid,month),candidates=(await purchaseCsv(tx,cid)).filter((l:any)=>!l.scheduled&&purchaseEligibility(l).ok).slice(0,300).map((l:any)=>({...l,invoice_date:day(l.invoice_date),period_month:day(l.period_month).slice(0,7),net:Number(l.net),vat:Number(l.vat)}));
  return {month,client_pin:client.kra_pin||null,rate:rule.error?{error:rule.error}:{rate:rule.rate,label:rule.rule.label,rate_id:rule.rule.rate_id,effective_from:day(rule.rule.effective_from),effective_to:day(rule.rule.effective_to)},
   credits:credits.map((c:any)=>{const l=mine(c);return {credit_id:c.credit_id,period_start:day(c.period_start),period_end:day(c.period_end),source_reference:c.source_reference,erp_amount:Number(c.erp_amount),status:c.status,claimed:!!c.claimed_in_case_id,lines:l,state:certificateState(c,l,sales)};}),
   schedule,schedule_totals:{active:schedule.filter((l:any)=>l.status==='Active').length,exact:schedule.filter((l:any)=>l.status==='Active').reduce((s:number,l:any)=>s+cents(l.vat_withheld),0)/100,whole:schedule.filter((l:any)=>l.status==='Active').reduce((s:number,l:any)=>s+withheldVat(l.invoice_net,l.rate).whole,0)},
   candidates};
 }
 if(project.status==='Archived')fail(400,'Archived projects retain read-only history.');
 if(p.action==='whtvat_certificate_line'){
  const credit=one(await tx`select credit_id,client_id,project_id,credit_type,status,erp_amount,claimed_in_case_id from erp_private.tax_credit_entries where credit_id=${uuid(p.credit_id)} and client_id=${cid}`);
  if(credit.credit_type!=='WHT_VAT')fail(400,'Invoice lines belong to a withholding VAT credit.');
  if(credit.status==='REJECTED')fail(400,'This credit was rejected. Enter it again as a new credit.');
  if(credit.claimed_in_case_id)fail(409,'Release the credit from the return before changing the invoices it covers.');
  const l:any={withholder_pin:pinOf(p.withholder_pin,'the withholder\'s PIN'),withholder_name:said(p.withholder_name,2,200,'Enter the name of the customer who withheld'),certificate_no:said(p.certificate_no,1,60,'Enter the certificate number'),
   certificate_date:date(p.certificate_date),invoice_no:said(p.invoice_no,1,40,'Enter the sales invoice number exactly as issued'),invoice_date:date(p.invoice_date),invoice_net:money(p.invoice_net,'the invoice amount before VAT'),vat_withheld:money(p.vat_withheld,'the VAT withheld')};
  const issues=certificateLineIssues(l,{clientPin:client.kra_pin});if(issues.length)fail(400,issues[0]);
  const have=(await tx`select coalesce(sum(vat_withheld),0) as total from erp_private.wht_vat_certificate_lines where credit_id=${credit.credit_id}`)[0],after=cents(have.total)+cents(l.vat_withheld);
  if(after>cents(credit.erp_amount))fail(400,`The invoice lines would add up to ${(after/100).toFixed(2)}, more than the credit of ${Number(credit.erp_amount).toFixed(2)}.`);
  if((await tx`select 1 from erp_private.wht_vat_certificate_lines where credit_id=${credit.credit_id} and lower(btrim(invoice_no))=lower(${l.invoice_no}) and lower(btrim(certificate_no))=lower(${l.certificate_no})`).length)fail(409,'This invoice is already linked to this certificate.');
  const row=one(await tx`insert into erp_private.wht_vat_certificate_lines(credit_id,client_id,project_id,withholder_pin,withholder_name,certificate_no,certificate_date,invoice_no,invoice_date,invoice_net,vat_withheld,entered_by)
   values(${credit.credit_id},${cid},${credit.project_id},${l.withholder_pin},${l.withholder_name},${l.certificate_no},${l.certificate_date},${l.invoice_no},${l.invoice_date},${l.invoice_net},${l.vat_withheld},${a.staff_id}) returning line_id`);
  return {line_id:row.line_id,linked_total:after/100,credit_amount:Number(credit.erp_amount)};
 }
 if(p.action==='whtvat_agent_add'){
  const paid=date(p.payment_date),month=paid.slice(0,7),evidence=said(p.evidence_reference,3,500,'Give the evidence reference: the payment advice or bank reference');
  let src:any=null,basis='Invoice sighted',csvId:string|null=null;
  if(p.csv_line_id){
   src=(await purchaseCsv(tx,cid,{id:uuid(p.csv_line_id)}))[0];
   if(!src)fail(404,'That KRA purchases line is not in the latest uploaded version. Refresh the list.');
  }else{
   const pin=pinOf(p.supplier_pin,'the supplier PIN'),inv=said(p.invoice_no,1,40,'Enter the supplier invoice number');
   const hit=(await purchaseCsv(tx,cid,{pin,invoice:inv}))[0];
   if(hit)src=hit;
   else{if(p.vat_charged_confirmed!==true)fail(400,'This invoice is not in the retained KRA purchases CSV. Confirm that you have seen the supplier invoice and that it charges VAT.');}
  }
  let line:any;
  if(src){
   const e=purchaseEligibility(src);if(!e.ok)fail(400,e.reason!);
   if(src.scheduled)fail(409,'This invoice is already on an active schedule line.');
   if(!src.invoice_date)fail(400,'The KRA purchases line has no invoice date. Correct the CSV and upload a new version.');
   if(p.invoice_net!==undefined&&p.invoice_net!==''&&p.invoice_net!==null&&Math.abs(cents(p.invoice_net)-cents(src.net))>1)fail(409,`The invoice amount you entered differs from the KRA purchases CSV (${Number(src.net).toFixed(2)}). The CSV amount is used only when they agree.`);
   const name=String(src.party_name||p.supplier_name||'').trim();
   line={supplier_pin:String(src.party_pin||'').trim().toUpperCase(),supplier_name:name,invoice_no:String(src.invoice_no),invoice_date:day(src.invoice_date),invoice_net:Number(src.net)};basis='KRA purchases CSV';csvId=src.line_id;
  }else line={supplier_pin:pinOf(p.supplier_pin,'the supplier PIN'),supplier_name:said(p.supplier_name,2,200,'Enter the supplier name'),invoice_no:said(p.invoice_no,1,40,'Enter the supplier invoice number'),invoice_date:date(p.invoice_date),invoice_net:money(p.invoice_net,'the invoice amount before VAT')};
  line.payment_date=paid;
  const issues=agentLineIssues(line,{clientPin:client.kra_pin,month});if(issues.length)fail(400,issues[0]);
  const r=ruleFor(await rules(tx),paid);if(r.error)fail(400,r.error);
  const w=withheldVat(line.invoice_net,r.rate);
  if((await tx`select 1 from erp_private.wht_vat_agent_lines where client_id=${cid} and supplier_pin=${line.supplier_pin} and lower(btrim(invoice_no))=lower(${line.invoice_no}) and payment_date=${paid} and status='Active'`).length)fail(409,'This invoice is already scheduled with that payment date.');
  const row=one(await tx`insert into erp_private.wht_vat_agent_lines(client_id,project_id,period_month,supplier_pin,supplier_name,invoice_no,invoice_date,invoice_net,payment_date,rate_id,rate,vat_withheld,vat_basis,csv_line_id,evidence_reference,prepared_by)
   values(${cid},${project.project_id},${month+'-01'},${line.supplier_pin},${line.supplier_name},${line.invoice_no},${line.invoice_date},${line.invoice_net},${paid},${r.rule.rate_id},${r.rate},${w.exact},${basis},${csvId},${evidence},${a.staff_id}) returning line_id`);
  return {line_id:row.line_id,rate:r.rate,vat_withheld:w.exact,whole_shillings:w.whole,basis};
 }
 if(p.action==='whtvat_agent_void'){
  const l=one(await tx`select line_id,status from erp_private.wht_vat_agent_lines where line_id=${uuid(p.line_id)} and client_id=${cid}`);
  if(l.status!=='Active')fail(409,'This line is already voided.');
  const reason=said(p.reason,10,500,'Say why this line is voided');
  await tx`update erp_private.wht_vat_agent_lines set status='Voided',void_reason=${reason},voided_by=${a.staff_id},voided_at=now() where line_id=${l.line_id}`;
  return {voided:true};
 }
 // whtvat_agent_export
 const month=monthOf(p.month),lines=await agentLines(tx,cid,month);
 const {whtVatFile}=await import('./wht-vat-export.ts');
 const f=await whtVatFile(client,month,lines);
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'exports','DOWNLOAD',${cid},${tx.json({kind:'WHTVAT',name:f.name,month,lines:f.count})})`;
 return {name:f.name,mime:f.mime,base64:f.base64,issues:f.issues};
}
