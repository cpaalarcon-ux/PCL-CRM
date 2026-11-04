import {fail,text,uuid} from './validation.mjs';
import {ageDebtors} from './debtors-rules.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v).slice(0,10);
const one=(rows:any[])=>{if(!rows.length)fail(403,'This record is not available to your account.');return rows[0];};
const num=(v:any)=>{const n=Number(v);return Number.isFinite(n)?n:0;};
const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;

// Debtors ageing for one client financial year. Sales invoices come from the client's sales rows; receipts are
// bank or mobile-money credits that staff allocated to an invoice. The schedule is a working paper: it does not post.
export async function debtorsRead(tx:any,l:any,asOf:string){
 const from=day(l.starts_on);
 if(asOf<from||asOf>day(l.ends_on))fail(400,'Choose an as-of date inside the financial year.');
 const sales=await tx`select r.row_id,r.source_row,r.normalized,exists(select 1 from erp_private.ledger_sources s join erp_private.ledger_journals j using(journal_id) where s.source_kind='Workbook row' and s.source_key=r.row_id::text and j.status='Posted') as posted
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${l.project_id} and r.dataset='Sales' and b.archived_at is null and not r.is_split_parent and coalesce(r.normalized->>'invoice','')<>''
   and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${from} and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)<=${asOf} order by r.created_at,r.source_row limit 20001`;
 if(sales.length>20000)fail(400,'More than 20,000 sales rows. Age the debtors for a shorter financial year.');
 const invoices=sales.map((r:any)=>({row_id:r.row_id,invoice:String(r.normalized.invoice),date:day(r.normalized.date||from),customer:String(r.normalized.party||''),pin:String(r.normalized.party_pin||''),gross:round(num(r.normalized.amount)+num(r.normalized.vat)),posted:r.posted}));
 const allocations=await tx`select a.allocation_id,a.sales_row_id,a.bank_row_id,a.amount,a.reverses_id,a.reason,a.created_at,coalesce(nullif(b.normalized->>'date',''),'') as receipt_date,b.normalized->>'reference' as reference
  from erp_private.customer_receipt_allocations a join erp_private.workbook_rows b on b.row_id=a.bank_row_id where a.project_id=${l.project_id} order by a.created_at`;
 const aged=ageDebtors({invoices,allocations:allocations.map((a:any)=>({sales_row_id:a.sales_row_id,amount:num(a.amount),receipt_date:a.receipt_date})),asOf});
 const bank=await tx`select r.row_id,r.source_row,r.normalized from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${l.project_id} and r.dataset='Bank' and b.archived_at is null and not r.is_split_parent and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${from} and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)<=${asOf} and coalesce(nullif(r.normalized->>'credit',''),'0')::numeric>0 order by r.normalized->>'date',r.source_row limit 5001`;
 const used=new Map<string,number>();for(const a of allocations)used.set(a.bank_row_id,round((used.get(a.bank_row_id)||0)+num(a.amount)));
 const receipts=bank.slice(0,5000).map((r:any)=>{const credit=num(r.normalized.credit),allocated=used.get(r.row_id)||0;return {row_id:r.row_id,date:day(r.normalized.date||from),reference:String(r.normalized.reference||r.normalized.description||'row '+r.source_row),credit,allocated,remaining:round(credit-allocated)};});
 const open=receipts.filter((r:any)=>r.remaining>0);
 const ledger=one(await tx`select coalesce(sum(x.debit-x.credit),0) balance from erp_private.ledger_lines x join erp_private.ledger_journals j using(journal_id) where j.period_id=${l.period_id} and j.status='Posted' and j.journal_date<=${asOf} and x.account_code='10060'`),
  ledgerBalance=round(num(ledger.balance)),postedSchedule=aged.totals.posted;
 const reversed=new Set(allocations.filter((a:any)=>a.reverses_id).map((a:any)=>a.reverses_id));
 const history=allocations.filter((a:any)=>!a.reverses_id).map((a:any)=>{const inv=invoices.find((i:any)=>i.row_id===a.sales_row_id),bk=receipts.find((x:any)=>x.row_id===a.bank_row_id);return {allocation_id:a.allocation_id,invoice:inv?.invoice||'',customer:inv?.customer||'',receipt_reference:bk?.reference||a.reference||'',receipt_date:a.receipt_date,amount:num(a.amount),reversed:reversed.has(a.allocation_id)};}).reverse().slice(0,300);
 return {as_of:asOf,...aged,unallocated_receipts:{count:open.length,value:round(open.reduce((s:number,r:any)=>s+r.remaining,0))},receipts:open.slice(0,500),allocations:history,
  reconciliation:{schedule_posted:postedSchedule,ledger_10060:ledgerBalance,difference:round(ledgerBalance-postedSchedule),not_posted:aged.totals.not_posted,
   note:'Compares posted sales on this schedule with the Trade receivables (10060) balance in the posted ledger. Differences are opening balances, receipts posted as journals, or sales not yet posted.'}};
}

export async function receiptAction(tx:any,a:any,l:any,p:any){
 const pid=l.project_id;
 if(p.action==='ledger_receipt_allocate'){
  const rid=uuid(p.request_id),dup=await tx`select allocation_id from erp_private.customer_receipt_allocations where request_id=${rid}`;if(dup.length)return dup[0];
  const bank=one(await tx`select * from erp_private.workbook_rows where row_id=${uuid(p.bank_row_id)} and project_id=${pid}`),sale=one(await tx`select * from erp_private.workbook_rows where row_id=${uuid(p.sales_row_id)} and project_id=${pid}`);
  if(bank.dataset!=='Bank'||sale.dataset!=='Sales')fail(400,'Choose a bank or mobile-money credit and a sales invoice.');
  const value=round(num(p.amount));if(!(value>0))fail(400,'Enter the amount of this receipt that settles the invoice.');
  const credit=num(bank.normalized.credit),gross=round(num(sale.normalized.amount)+num(sale.normalized.vat));
  if(credit<=0)fail(400,'That bank line is not money in.');if(gross<=0)fail(400,'Receipts are allocated to invoices, not to credit notes.');
  const usedBank=round(num(one(await tx`select coalesce(sum(amount),0) s from erp_private.customer_receipt_allocations where bank_row_id=${bank.row_id}`).s)),usedSale=round(num(one(await tx`select coalesce(sum(amount),0) s from erp_private.customer_receipt_allocations where sales_row_id=${sale.row_id}`).s));
  if(value>round(credit-usedBank))fail(400,`Only KES ${round(credit-usedBank).toLocaleString('en-KE',{minimumFractionDigits:2})} of this bank credit is left to allocate.`);
  if(value>round(gross-usedSale))fail(400,`The invoice balance is KES ${round(gross-usedSale).toLocaleString('en-KE',{minimumFractionDigits:2})}.`);
  const receiptDate=day(bank.normalized.date||''),invoiceDate=day(sale.normalized.date||'');if(receiptDate&&invoiceDate&&receiptDate<invoiceDate)fail(400,'The receipt is dated before the invoice. Check that this is the right invoice.');
  return one(await tx`insert into erp_private.customer_receipt_allocations(request_id,project_id,bank_row_id,sales_row_id,amount,allocated_by) values(${rid},${pid},${bank.row_id},${sale.row_id},${value},${a.staff_id}) returning allocation_id`);
 }
 if(p.action==='ledger_receipt_reverse'){
  if(!['PARTNER','MANAGER','SUPERVISOR'].includes(a.category_code))fail(403,'A Supervisor, Manager or Partner must reverse an allocation.');
  const rid=uuid(p.request_id),dup=await tx`select allocation_id from erp_private.customer_receipt_allocations where request_id=${rid}`;if(dup.length)return dup[0];
  const old=one(await tx`select * from erp_private.customer_receipt_allocations where allocation_id=${uuid(p.allocation_id)} and project_id=${pid}`);
  if(old.reverses_id)fail(400,'A reversal cannot be reversed. Allocate the receipt again instead.');
  if((await tx`select 1 from erp_private.customer_receipt_allocations where reverses_id=${old.allocation_id}`).length)fail(400,'This allocation was already reversed.');
  const reason=text(p.reason||'',1000,false).trim();if(reason.length<10)fail(400,'Give the reason for the reversal (at least 10 characters).');
  return one(await tx`insert into erp_private.customer_receipt_allocations(request_id,project_id,bank_row_id,sales_row_id,amount,reverses_id,reason,allocated_by) values(${rid},${pid},${old.bank_row_id},${old.sales_row_id},${-num(old.amount)},${old.allocation_id},${reason},${a.staff_id}) returning allocation_id`);
 }
 return undefined;
}
