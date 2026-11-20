import {fail,uuid,text,choice,date} from './validation.mjs';
import {pickRate} from './tax-registry.mjs';
import {preferredRates,stagingRates} from './testing-rates.mjs';
// Withholding tax lines. A line records one payment that tax was withheld from. A purchase row (professional or contractual fees, for
// example) is marked on the purchases screen; payments that are not purchases (dividends, interest, royalties, rent to non-residents) are
// added to the monthly schedule. The withholding return and the withholding journal read these lines only.
const one=(r:any[])=>{if(!r.length)fail(403,'This record is unavailable to your account.');return r[0];};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const day=(v:any)=>v instanceof Date?v.toISOString().slice(0,10):String(v).slice(0,10);
const leader=(a:any)=>['PARTNER','MANAGER'].includes(a.category_code);
const monthStart=(d:string)=>d.slice(0,8)+'01';
const monthEnd=(d:string)=>new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),0)).toISOString().slice(0,10);
const COST_DATASETS=['Purchases','Expenditure','Non-eTIMS'];
export const WHT_COUNTER_ACCOUNT='20000';

async function whtRates(tx:any){
 return stagingRates(await tx`select * from erp_private.tax_rates where status in('Approved','Testing') and deleted_at is null and tax_type='Withholding tax'`,typeof Deno==='undefined'?'https://yfjiculexbzpkvtapudk.supabase.co':Deno.env.get('SUPABASE_URL')||'');
}
// The rate for a payment category on the payment date, checked against the payee's residence.
function rateFor(available:any[],code:string,at:string,residency:string){
 const r:any=pickRate(preferredRates(available,code,at,at),code,at,at);
 if(r.tax_type!=='Withholding tax')fail(400,'Choose a withholding tax payment category.');
 const expected=r.parameters?.payee_residency;
 if(expected&&expected!==residency)fail(400,`${r.label} applies to a ${String(expected).toLowerCase()} payee. Choose the matching category for a ${residency.toLowerCase()} payee.`);
 return r;
}
const statusOf=(r:any)=>r.approval_scope==='Testing'?'Testing':String(r.status);
async function periodOpen(tx:any,pid:string,at:string){
 const r=(await tx`select erp_private.tax_period_open(${pid}::uuid,${monthStart(at)}::date,${monthEnd(at)}::date) open`)[0];
 if(!r?.open)fail(409,'The withholding return for this month is submitted or locked. Return it first, or correct the amount in a later month.');
}
function lineFields(p:any){
 const evidence=text(p.evidence_reference||'',500,false).trim();
 if(evidence.length<3)fail(400,'Give the evidence reference: invoice, contract or payment advice.');
 if(p.eligibility_confirmed!==true)fail(400,'Confirm the payee’s residence, the threshold and any exemption before withholding.');
 return {evidence,residency:choice(p.payee_residency,['Resident','Non-resident'])};
}

export async function withholdingAction(tx:any,a:any,p:any){
 if(!String(p.action).startsWith('wht_'))return undefined;
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const pid=uuid(p.project_id),project=one(await tx`select * from erp_private.projects where project_id=${pid} and deleted_at is null`);
 const readOnly=['wht_list'].includes(p.action);
 if(!readOnly&&project.status==='Archived')fail(400,'Archived projects retain read-only history.');

 if(p.action==='wht_list'){
  const from=date(p.from||'')||monthStart(new Date().toISOString().slice(0,10)),to=date(p.to||'')||monthEnd(from);
  const lines=await tx`select * from erp_private.withholding_lines where project_id=${pid} and payment_date between ${from} and ${to} and (status='Active' or ${p.include_voided===true}) order by payment_date,created_at limit 1000`;
  const active=lines.filter((l:any)=>l.status==='Active'),groups=new Map<string,any>();
  for(const l of active){const g=groups.get(l.payment_code)||{payment_code:l.payment_code,payment_label:l.payment_label,rate:Number(l.rate),lines:0,taxable_amount:0,tax_withheld:0};g.lines++;g.taxable_amount=round(g.taxable_amount+Number(l.taxable_amount));g.tax_withheld=round(g.tax_withheld+Number(l.tax_withheld));groups.set(l.payment_code,g);}
  const at=to,rates=(await whtRates(tx)).filter((r:any)=>day(r.effective_from)<=at&&(!r.effective_to||day(r.effective_to)>=at)&&!/^QA/i.test(r.rate_key)&&!r.is_test).map((r:any)=>({rate_key:r.rate_key,label:r.label,rate:Number(r.parameters?.rate),payee_residency:r.parameters?.payee_residency||null,status:r.status}));
  const accounts=await tx`select code,name from erp_private.account_catalog where status='Active' and not is_legacy order by code limit 500`;
  const open=(await tx`select erp_private.tax_period_open(${pid}::uuid,${from}::date,${to}::date) open`)[0]?.open!==false;
  return {from,to,lines:lines.map((l:any)=>({...l,rate:Number(l.rate),taxable_amount:Number(l.taxable_amount),tax_withheld:Number(l.tax_withheld)})),groups:[...groups.values()],totals:{taxable_amount:round(active.reduce((s:number,l:any)=>s+Number(l.taxable_amount),0)),tax_withheld:round(active.reduce((s:number,l:any)=>s+Number(l.tax_withheld),0)),lines:active.length,uncertificated:active.filter((l:any)=>!l.certificate_issued).length,unjournalled:active.filter((l:any)=>!l.journal_id).length},rates,accounts,period_open:open};
 }

 const available=await whtRates(tx);

 if(p.action==='wht_row_set'){
  const ids=Array.isArray(p.row_ids)?[...new Set(p.row_ids.map((x:any)=>uuid(x)))]:[];if(!ids.length||ids.length>500)fail(400,'Select between 1 and 500 purchase rows.');
  const {evidence,residency}=lineFields(p),code=text(p.payment_code||'',60);
  const rows=await tx`select r.row_id,r.dataset,r.route,r.account_code,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id) where r.project_id=${pid} and b.archived_at is null and r.row_id=any(${tx.array(ids)}::uuid[]) and not r.is_split_parent`;
  if(rows.length!==ids.length)fail(403,'All rows must belong to this project and still be current.');
  let count=0,tax=0;
  for(const r of rows){
   const n=r.normalized||{},label=`${n.party||'Supplier'} ${n.invoice||''}`.trim();
   if(!COST_DATASETS.includes(r.dataset))fail(400,`${label}: withholding is recorded on purchase and expenditure rows only.`);
   if(!r.account_code||![2,3].includes(Number(r.route)))fail(400,`${label}: map the row to an expense or fixed-asset account first. Stock purchases do not carry withholding here.`);
   const at=day(n.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(at))fail(400,`${label}: the invoice date is missing.`);
   const amount=Number(n.amount);if(!(amount>0))fail(400,`${label}: only a positive invoice amount (before VAT) can carry withholding.`);
   await periodOpen(tx,pid,at);
   const rate:any=rateFor(available,code,at,residency),withheld=round(amount*Number(rate.parameters.rate)/100);
   const existing=(await tx`select line_id,journal_id from erp_private.withholding_lines where row_id=${r.row_id} and status='Active' for update`)[0];
   if(existing?.journal_id)fail(409,`${label}: this withholding is already in a journal. Reverse the journal before changing it.`);
   if(existing)await tx`update erp_private.withholding_lines set payee_name=${text(String(n.party||'Supplier'),200)},payee_pin=${String(n.party_pin||'').slice(0,20)},payee_residency=${residency},payment_date=${at},payment_code=${code},payment_label=${rate.label},rate_id=${rate.rate_id},rate=${rate.parameters.rate},rate_status=${statusOf(rate)},taxable_amount=${round(amount)},tax_withheld=${withheld},invoice_reference=${String(n.invoice||'').slice(0,100)},evidence_reference=${evidence},eligibility_confirmed=true where line_id=${existing.line_id}`;
   else await tx`insert into erp_private.withholding_lines(project_id,client_id,source,row_id,payee_name,payee_pin,payee_residency,payment_date,payment_code,payment_label,rate_id,rate,rate_status,taxable_amount,tax_withheld,invoice_reference,evidence_reference,eligibility_confirmed,counter_account,prepared_by) values(${pid},${project.client_id},'Purchase row',${r.row_id},${text(String(n.party||'Supplier'),200)},${String(n.party_pin||'').slice(0,20)},${residency},${at},${code},${rate.label},${rate.rate_id},${rate.parameters.rate},${statusOf(rate)},${round(amount)},${withheld},${String(n.invoice||'').slice(0,100)},${evidence},true,${WHT_COUNTER_ACCOUNT},${a.staff_id})`;
   count++;tax=round(tax+withheld);
  }
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'withholding_lines','WITHHOLDING_SET_ON_PURCHASES',${pid},${tx.json({count,tax_withheld:tax,payment_code:code})})`;
  return {ok:true,count,tax_withheld:tax};
 }

 if(p.action==='wht_line_add'){
  const {evidence,residency}=lineFields(p),code=text(p.payment_code||'',60),at=date(p.payment_date||'');
  if(!at)fail(400,'Enter the payment date.');
  const amount=round(Number(p.taxable_amount));if(!(amount>0)||amount>1e12)fail(400,'Enter the amount subject to withholding.');
  const payee=text(p.payee_name||'',200).trim(),pin=text(p.payee_pin||'',20,false).trim().toUpperCase();
  const counter=text(p.counter_account||'',5,false).trim();
  if(counter&&!(await tx`select 1 from erp_private.account_catalog where code=${counter} and status='Active' and not is_legacy`).length)fail(400,'Choose an active account to debit.');
  await periodOpen(tx,pid,at);
  const rate:any=rateFor(available,code,at,residency),withheld=round(amount*Number(rate.parameters.rate)/100);
  const line=one(await tx`insert into erp_private.withholding_lines(project_id,client_id,source,payee_name,payee_pin,payee_residency,payment_date,payment_code,payment_label,rate_id,rate,rate_status,taxable_amount,tax_withheld,invoice_reference,evidence_reference,eligibility_confirmed,counter_account,prepared_by) values(${pid},${project.client_id},'Schedule',${payee},${pin},${residency},${at},${code},${rate.label},${rate.rate_id},${rate.parameters.rate},${rate.status},${amount},${withheld},${text(p.invoice_reference||'',100,false).trim()},${evidence},true,${counter||null},${a.staff_id}) returning line_id`);
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'withholding_lines','WITHHOLDING_LINE_ADDED',${line.line_id},${tx.json({project_id:pid,payment_code:code,taxable_amount:amount,tax_withheld:withheld})})`;
  return {ok:true,line_id:line.line_id,tax_withheld:withheld,rate:Number(rate.parameters.rate),testing:statusOf(rate)==='Testing'};
 }

 if(p.action==='wht_line_void'){
  const l=one(await tx`select * from erp_private.withholding_lines where line_id=${uuid(p.line_id)} and project_id=${pid} for update`);
  const why=text(p.reason||'',1000,false).trim();if(why.length<10)fail(400,'Give the reason for removing the line (at least 10 characters).');
  if(l.status!=='Active')fail(409,'This line was already removed.');
  if(l.journal_id)fail(409,'This withholding is in a journal. Reverse the journal first.');
  if(l.prepared_by!==a.staff_id&&!leader(a))fail(403,'Only the preparer, a Manager or a Partner can remove this line.');
  await periodOpen(tx,pid,day(l.payment_date));
  await tx`update erp_private.withholding_lines set status='Voided',void_reason=${why},voided_by=${a.staff_id} where line_id=${l.line_id}`;
  await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,before_values) values(${a.auth_user_id},current_user,'withholding_lines','WITHHOLDING_LINE_REMOVED',${l.line_id},${tx.json({tax_withheld:Number(l.tax_withheld),reason:why})})`;
  return {ok:true};
 }

 if(p.action==='wht_certificate'){
  const l=one(await tx`select line_id,status from erp_private.withholding_lines where line_id=${uuid(p.line_id)} and project_id=${pid} for update`);
  if(l.status!=='Active')fail(409,'This line was removed.');
  await tx`update erp_private.withholding_lines set certificate_issued=${p.issued===true} where line_id=${l.line_id}`;
  return {ok:true};
 }
 return undefined;
}
