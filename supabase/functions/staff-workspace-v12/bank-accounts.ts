import {fail,text,uuid,choice,date} from './validation.mjs';
import {requireChartAccount,approvedChart,clientChartAction} from './client-chart.ts';
import {BANK_LEDGER_CODES,BANK_KINDS,suggestBankCode} from './bank-close.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);

// The client's registered bank, savings and mobile-money accounts. Only the last four characters of an account number are kept.
export async function bankRegister(tx:any,clientId:string){
 const rows=await tx`select bank_account_id,bank_name,account_label,account_last4,kind,gl_code,currency,status,opened_on,closed_on,note,revision,
   (select name from erp_private.account_catalog c where c.code=gl_code) gl_name,
   (select count(*)::int from erp_private.workbook_batches b where b.bank_account_id=client_bank_accounts.bank_account_id and b.archived_at is null) statements
  from erp_private.client_bank_accounts where client_id=${clientId} order by status,bank_name,gl_code`;
 return rows.map((r:any)=>({...r,opened_on:r.opened_on?day(r.opened_on):null,closed_on:r.closed_on?day(r.closed_on):null}));
}

// A statement import must say which bank it came from once the client has registered any. Returns the bank id to store, or null.
export async function statementBank(tx:any,clientId:string,raw:any){
 const active=await tx`select bank_account_id,gl_code from erp_private.client_bank_accounts where client_id=${clientId} and status='Active'`;
 if(!raw){
  if(active.length)fail(400,'Choose which bank this statement came from. Register banks under Banks in the ledger.');
  return null;
 }
 const id=uuid(raw),hit=active.find((b:any)=>b.bank_account_id===id);
 if(!hit)fail(400,'Choose an active bank account registered for this client.');
 return id;
}

export async function bankAccountAction(tx:any,a:any,l:any,p:any){
 if(p.action==='ledger_bank_suggest'||p.action==='ledger_bank_propose_chart')return await bankSuggestion(tx,a,l,p);
 if(p.action!=='ledger_bank_save')fail(400,'Unknown bank action.');
 const cid=l.client_id,leader=['PARTNER','MANAGER'].includes(a.category_code);
 const bank=text(p.bank_name,120).replace(/\s+/g,' ').trim(),label=text(p.account_label||'',120,false).replace(/\s+/g,' ').trim();
 const last4=String(p.account_last4||'').trim().toUpperCase();if(last4&&!/^[0-9A-Z]{4}$/.test(last4))fail(400,'Enter only the last four characters of the account number, or leave it blank.');
 const kind=choice(p.kind,BANK_KINDS),code=choice(String(p.gl_code||''),BANK_LEDGER_CODES),currency=choice(p.currency||'KES',['KES','USD','EUR','GBP']);
 if((code==='20080')!==(kind==='Overdraft'))fail(400,code==='20080'?'Ledger account 20080 is the bank overdraft; choose the Overdraft type.':'The Overdraft type uses ledger account 20080.');
 const status=choice(p.status||'Active',['Active','Closed']),opened=date(p.opened_on)||null,closed=date(p.closed_on)||null,note=text(p.note||'',500,false);
 if(status==='Closed'){if(!leader)fail(403,'A Manager or Partner must close a bank account.');if(!closed)fail(400,'Enter the date the account was closed.');}
 if(opened&&closed&&closed<opened)fail(400,'The closing date cannot be before the opening date.');
 const acct=(await tx`select code,status from erp_private.account_catalog where code=${code} and not is_legacy`)[0];
 if(!acct)fail(400,'That ledger account does not exist.');
 if(acct.status!=='Active')fail(400,`Ledger account ${code} is not approved yet. A Partner must approve it before it can be used.`);
 if(status==='Active')await requireChartAccount(tx,cid,code,day(l.starts_on));
 const clash=async(except?:string)=>{
  if(status==='Active'){const x=(await tx`select bank_account_id,bank_name from erp_private.client_bank_accounts where client_id=${cid} and gl_code=${code} and status='Active'`).find((r:any)=>r.bank_account_id!==except);
   if(x)fail(409,`Ledger account ${code} is already used by ${x.bank_name}. Use a different ledger account for each bank.`);}
 };
 if(p.bank_account_id){
  const id=uuid(p.bank_account_id),cur=(await tx`select * from erp_private.client_bank_accounts where bank_account_id=${id} and client_id=${cid} for update`)[0];
  if(!cur)fail(403,'This record is not available to your account.');
  if(p.revision!=null&&Number(p.revision)!==Number(cur.revision))fail(409,'This bank account changed since you opened it. Reload and try again.');
  if(cur.status==='Closed')fail(400,'A closed bank account cannot be changed. Add a new bank account.');
  await clash(id);
  return (await tx`update erp_private.client_bank_accounts set bank_name=${bank},account_label=${label},account_last4=${last4},kind=${kind},gl_code=${code},currency=${currency},status=${status},opened_on=${opened},closed_on=${closed},note=${note},updated_by=${a.staff_id} where bank_account_id=${id} returning bank_account_id,revision`)[0];
 }
 if(status==='Closed')fail(400,'Add the bank account first, then close it when it is shut.');
 await clash();
 return (await tx`insert into erp_private.client_bank_accounts(client_id,bank_name,account_label,account_last4,kind,gl_code,currency,status,opened_on,closed_on,note,created_by) values(${cid},${bank},${label},${last4},${kind},${code},${currency},'Active',${opened},null,${note},${a.staff_id}) returning bank_account_id,revision`)[0];
}

// The ledger account a new bank account should use, and whether the client chart already allows it. When the account exists in the master
// chart but not in the client's approved chart, `ledger_bank_propose_chart` drafts the chart amendment (an extra account with a reason, keeping the
// extras already approved) for a different Manager or Partner to review; the bank account can be saved once it is approved.
async function bankSuggestion(tx:any,a:any,l:any,p:any){
 if(a.category_code==='INTERN')fail(403,'Assigned accounting staff are required.');
 const cid=l.client_id,kind=choice(p.kind||'Bank current',BANK_KINDS),at=day(l.starts_on);
 const used=new Set<string>((await tx`select gl_code from erp_private.client_bank_accounts where client_id=${cid} and status='Active' and (${p.bank_account_id||null}::uuid is null or bank_account_id<>${p.bank_account_id||null}::uuid)`).map((r:any)=>r.gl_code));
 const code=suggestBankCode(kind,used);
 if(!code)return {code:null,state:'none_free',message:'All ledger accounts for bank accounts are in use. Close a bank account that is no longer used first.'};
 const acct=(await tx`select code,name,status,is_legacy from erp_private.account_catalog where code=${code}`)[0];
 if(!acct||acct.is_legacy)return {code,state:'none_free',message:`Ledger account ${code} is not available.`};
 const chart=await approvedChart(tx,cid,at),name=acct.name;
 if(acct.status!=='Active')return {code,name,state:'needs_partner_approval',message:`Use ${code} ${name}. A Partner must approve this ledger account in the master chart before it can be used.`};
 if(chart&&!chart.codes.has(code)){
  if(p.action!=='ledger_bank_propose_chart')return {code,name,state:'needs_chart_amendment',message:`Use ${code} ${name}. It is not in this client's approved chart yet: propose a chart amendment, and a different Manager or Partner approves it.`};
  const bank=text(p.bank_name||'',120,false).trim()||'a new bank account';
  const current=(await tx`select extra_accounts from erp_private.client_chart_versions where client_id=${cid} and status='Approved' and effective_from<=${at} order by effective_from desc,reviewed_at desc limit 1`)[0];
  const extras=(Array.isArray(current?.extra_accounts)?current.extra_accounts:[]).filter((x:any)=>x?.code&&x.code!==code).map((x:any)=>({code:x.code,reason:x.reason}));
  extras.push({code,reason:`Ledger account for the bank account of ${bank}`.slice(0,500)});
  const made=await clientChartAction(tx,a,{action:'v3_client_chart_propose',client_id:cid,effective_from:at,extra_accounts:extras,note:`Drafted automatically for a new bank account (${bank}).`});
  return {code,name,state:'amendment_proposed',version_id:made.version_id,message:`A chart amendment adding ${code} ${name} was proposed. A different Manager or Partner must approve it before this bank account can be saved.`};
 }
 return {code,name,state:'ready',message:`Use ${code} ${name}.`};
}
