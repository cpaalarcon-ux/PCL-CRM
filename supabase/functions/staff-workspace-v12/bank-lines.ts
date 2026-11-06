import {fail,text,uuid,choice} from './validation.mjs';
import {chartCatalogue,requireChartAccount} from './client-chart.ts';
import {bankRegister} from './bank-accounts.ts';
import {fixItQueue,matchRule,ruleProblem,MATCH_MODES,DIRECTIONS} from './bank-rules.mjs';
import {BANK_LEDGER_CODES} from './bank-close.mjs';
import {bankSummary} from './bank-statement.mjs';
const day=(v:any)=>String(v instanceof Date?v.toISOString():v||'').slice(0,10);
const dayOf=(r:any)=>String(r.normalized?.date||day(r.period_start));

// Statement lines of a period (same window the bank close checks use).
async function periodRows(tx:any,l:any,to:string,ids?:string[]){
 return await tx`select r.row_id,r.batch_id,r.revision,r.source_row,r.account_code,r.normalized,r.review_details,b.bank_account_id,b.period_start,b.period_end
  from erp_private.workbook_rows r join erp_private.workbook_batches b using(batch_id)
  where r.project_id=${l.project_id} and b.archived_at is null and not r.is_split_parent and r.dataset='Bank'
  and coalesce(nullif(r.normalized->>'date',''),b.period_start::text)>=${day(l.starts_on)} and coalesce(nullif(r.normalized->>'date',''),b.period_end::text)<=${to}
  and (${ids?tx.array(ids):null}::uuid[] is null or r.row_id=any(${ids?tx.array(ids):null}::uuid[])) order by r.source_row limit 20000`;
}
const rulesOf=(tx:any,clientId:string)=>tx`select rule_id,keyword,match_mode,direction,account_code,status,note,created_by,created_at,reviewed_by,reviewed_at,review_note,revision,
  (select name from erp_private.account_catalog c where c.code=account_code) account_name from erp_private.bank_mapping_rules where client_id=${clientId} order by status,created_at desc`;

// Map statement lines to one ledger account. Used by staff (one or many lines) and by approved rules.
async function mapLines(tx:any,a:any,l:any,rows:any[],byRow:Map<string,{account:string,rule_id?:string}>,method:string,banks:any[]){
 if(!rows.length)return 0;
 const accounts=await tx`select code,name,route,category_code,status,is_legacy from erp_private.account_catalog where code=any(${tx.array([...new Set([...byRow.values()].map(x=>x.account))])}::text[])`;
 const gl=new Map(banks.map((b:any)=>[b.bank_account_id,String(b.gl_code)]));
 const closed=await tx`select b.batch_id from erp_private.workbook_batches b where b.batch_id=any(${tx.array([...new Set(rows.map((r:any)=>r.batch_id))])}::uuid[]) and not erp_private.tax_period_open(${l.project_id}::uuid,b.period_start,b.period_end) limit 1`;
 if(closed.length)fail(400,'This period is submitted or locked.');
 const stamp=new Date().toISOString(),checked=new Set<string>();
 let n=0;
 for(const r of rows){
  const pick=byRow.get(r.row_id)!,acct=accounts.find((x:any)=>x.code===pick.account);
  if(!acct||acct.status!=='Active'||acct.is_legacy)fail(400,`Ledger account ${pick.account} is not an active account.`);
  if(acct.route===1||acct.route===3)fail(400,`${acct.code} ${acct.name} is for stock or fixed assets, which are mapped through purchases. Choose another account for a bank line.`);
  if(gl.get(r.bank_account_id)===acct.code)fail(400,`A line cannot be mapped to its own bank's ledger account (${acct.code}).`);
  const key=acct.code+':'+dayOf(r).slice(0,7);if(!checked.has(key)){await requireChartAccount(tx,l.client_id,acct.code,dayOf(r));checked.add(key);}
  const details={mapping_confirmation:{method,rule_id:pick.rule_id||null,account_code:acct.code,mapped_at:stamp,mapped_by:a.staff_id}};
  await tx`update erp_private.workbook_rows set route=${acct.route},category_code=${acct.category_code},account_code=${acct.code},review_details=coalesce(review_details,'{}'::jsonb)||${tx.json(details)}::jsonb where row_id=${r.row_id}`;
  n++;
 }
 await tx`insert into erp_private.audit_events(actor_auth_id,database_role,table_name,action,record_key,after_values) values(${a.auth_user_id},current_user,'workbook_rows','BANK_LINE_MAPPING',${l.project_id},${tx.json({count:n,method})})`;
 return n;
}

// Apply every Active rule to the unmapped statement lines of a period. Returns how many lines were mapped.
export async function applyBankRules(tx:any,a:any,l:any,to:string,only?:string[]){
 const [rules,banks,rows]=await Promise.all([rulesOf(tx,l.client_id),bankRegister(tx,l.client_id),periodRows(tx,l,to,only)]);
 const gl=new Map(banks.map((b:any)=>[b.bank_account_id,String(b.gl_code)])),byRow=new Map<string,{account:string,rule_id:string}>(),picked:any[]=[];
 for(const r of rows){
  if(r.account_code)continue;
  const rule=matchRule(rules,r,gl.get(r.bank_account_id));if(!rule)continue;
  const open=(await tx`select 1 from erp_private.account_catalog where code=${rule.account_code} and status='Active' and not is_legacy and coalesce(route,0) not in (1,3)`).length;if(!open)continue;
  byRow.set(r.row_id,{account:rule.account_code,rule_id:rule.rule_id});picked.push(r);
 }
 const mapped=await mapLines(tx,a,l,picked,byRow,'Bank rule',banks);
 return {mapped,left:rows.filter((r:any)=>!r.account_code).length-mapped};
}

export async function bankLineAction(tx:any,a:any,l:any,p:any){
 const leader=['PARTNER','MANAGER'].includes(a.category_code),to=p.as_of?day(p.as_of):day(l.ends_on),cid=l.client_id;
 if(p.action==='ledger_bank_fixit_read'){
  const [rules,banks,rows]=await Promise.all([rulesOf(tx,cid),bankRegister(tx,cid),periodRows(tx,l,to)]);
  const catalog=await tx`select code,name,status,is_legacy,route,category_code,account_group from erp_private.account_catalog order by code`;
  const accounts=(await chartCatalogue(tx,catalog,cid,day(l.starts_on))).filter((x:any)=>x.status==='Active'&&!x.is_legacy&&x.in_client_chart!==false&&![1,3].includes(x.route)).map((x:any)=>({code:x.code,name:x.name,group:x.account_group}));
  return {...fixItQueue({rows:rows.map((r:any)=>({...r})),rules,bankAccounts:banks}),rules,accounts,lines:rows.length,mapped:rows.filter((r:any)=>r.account_code).length};
 }
 if(p.action==='ledger_bank_lines_map'){
  const items=Array.isArray(p.items)?p.items:[];if(!items.length||items.length>500)fail(400,'Select between 1 and 500 statement lines.');
  const ids=items.map((i:any)=>uuid(i.row_id));if(new Set(ids).size!==ids.length)fail(400,'A line was selected more than once.');
  const account=text(p.account_code,5);
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.project_id+':tax'},0))`;
  const rows=await periodRows(tx,l,to,ids);
  if(rows.length!==ids.length)fail(403,'Every selected line must be a statement line of this period for this client.');
  for(const i of items){const r=rows.find((x:any)=>x.row_id===i.row_id);if(String(r.revision)!==String(i.revision))fail(409,'A statement line changed. Refresh the list and try again.');}
  const banks=await bankRegister(tx,cid),by=new Map(rows.map((r:any)=>[r.row_id,{account}]));
  return {mapped:await mapLines(tx,a,l,rows,by,'Staff choice',banks)};
 }
 if(p.action==='ledger_bank_apply_rules'){
  await tx`select pg_advisory_xact_lock(hashtextextended(${l.project_id+':tax'},0))`;
  return await applyBankRules(tx,a,l,to);
 }
 if(p.action==='ledger_bank_rule_save'){
  const keyword=text(p.keyword,60).replace(/\s+/g,' ').trim(),match_mode=choice(p.match_mode||'Contains',MATCH_MODES),direction=choice(p.direction||'Either',DIRECTIONS),account=text(p.account_code,5),note=text(p.note||'',300,false);
  const bad=ruleProblem({keyword,match_mode,direction});if(bad)fail(400,bad);
  const acct=(await tx`select code,status,is_legacy,route from erp_private.account_catalog where code=${account}`)[0];
  if(!acct||acct.status!=='Active'||acct.is_legacy)fail(400,'Choose an active ledger account.');
  if([1,3].includes(acct.route))fail(400,'Stock and fixed-asset accounts are mapped through purchases, not bank rules.');
  await requireChartAccount(tx,cid,account,day(l.starts_on));
  const dup=(await tx`select rule_id from erp_private.bank_mapping_rules where client_id=${cid} and lower(btrim(keyword))=lower(${keyword}) and match_mode=${match_mode} and direction=${direction} and status<>'Retired'`)[0];
  if(dup)fail(409,'A rule with this keyword, match and direction already exists. Retire it first to replace it.');
  return (await tx`insert into erp_private.bank_mapping_rules(client_id,keyword,match_mode,direction,account_code,note,created_by) values(${cid},${keyword},${match_mode},${direction},${account},${note},${a.staff_id}) returning rule_id,status`)[0];
 }
 if(p.action==='ledger_bank_rule_review'){
  if(!leader)fail(403,'A Manager or Partner must approve or retire a bank rule.');
  const rule=(await tx`select * from erp_private.bank_mapping_rules where rule_id=${uuid(p.rule_id)} and client_id=${cid} for update`)[0];if(!rule)fail(403,'This record is not available to your account.');
  if(p.revision!=null&&Number(p.revision)!==Number(rule.revision))fail(409,'This rule changed since you opened it. Reload and try again.');
  const status=choice(p.status,['Active','Retired']),note=text(p.review_note||'',500,false);
  if(status==='Active'&&rule.status!=='Proposed')fail(400,'Only a proposed rule can be approved.');
  if(status==='Active'&&rule.created_by===a.staff_id)fail(403,'A different Manager or Partner must approve a rule you proposed.');
  if(rule.status==='Retired')fail(400,'This rule is already retired.');
  if(status==='Retired'&&note.length<5)fail(400,'Give a short reason for retiring the rule.');
  return (await tx`update erp_private.bank_mapping_rules set status=${status},reviewed_by=${a.staff_id},reviewed_at=now(),review_note=${note||null} where rule_id=${rule.rule_id} returning rule_id,status,revision`)[0];
 }
 if(p.action==='ledger_bank_summary_read'){
  const [banks,rows]=await Promise.all([bankRegister(tx,cid),periodRows(tx,l,to)]);
  const categories=await tx`select category_id,name,account_codes,note,status,revision,(select array_agg(c.code||' '||c.name order by c.code) from erp_private.account_catalog c where c.code=any(account_codes)) accounts from erp_private.bank_summary_categories where client_id=${cid} order by status,name`;
  const filter=p.bank_account_id?uuid(p.bank_account_id):null;
  return {...bankSummary({rows,categories,bankAccounts:banks,bankAccountId:filter}),categories,banks:banks.map((b:any)=>({bank_account_id:b.bank_account_id,label:b.bank_name+(b.account_label?' '+b.account_label:'')+(b.account_last4?' ····'+b.account_last4:'')})),bank_account_id:filter,as_of:to};
 }
 if(p.action==='ledger_bank_category_save'){
  if(!leader)fail(403,'A Manager or Partner must define a non-trade category.');
  const name=text(p.name,80).replace(/\s+/g,' ').trim(),note=text(p.note||'',300,false);if(name.length<3)fail(400,'Give the category a name of at least three characters.');
  const codes=[...new Set(String(Array.isArray(p.account_codes)?p.account_codes.join(','):p.account_codes||'').split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean))];
  if(!codes.length||codes.length>30)fail(400,'Enter between 1 and 30 ledger account codes.');
  const found=await tx`select code,status,is_legacy,route from erp_private.account_catalog where code=any(${tx.array(codes)}::text[])`;
  for(const c of codes){const x=found.find((y:any)=>y.code===c);if(!x||x.status!=='Active'||x.is_legacy)fail(400,`${c} is not an active ledger account.`);if([1,3].includes(x.route))fail(400,`${c} is a stock or fixed-asset account.`);if(BANK_LEDGER_CODES.includes(c))fail(400,`${c} is a bank account. Own-account transfers are shown separately.`);}
  if((await tx`select 1 from erp_private.bank_summary_categories where client_id=${cid} and status='Active' and lower(btrim(name))=lower(${name})`).length)fail(409,'A category with this name already exists.');
  const taken=await tx`select name from erp_private.bank_summary_categories where client_id=${cid} and status='Active' and account_codes && ${tx.array(codes)}::text[] limit 1`;if(taken.length)fail(409,`An account in this list already belongs to the category ${taken[0].name}. An account can be in one category.`);
  return (await tx`insert into erp_private.bank_summary_categories(client_id,name,account_codes,note,created_by) values(${cid},${name},${tx.array(codes)}::text[],${note},${a.staff_id}) returning category_id`)[0];
 }
 if(p.action==='ledger_bank_category_retire'){
  if(!leader)fail(403,'A Manager or Partner must retire a non-trade category.');
  const c=(await tx`select category_id,revision,status from erp_private.bank_summary_categories where category_id=${uuid(p.category_id)} and client_id=${cid} for update`)[0];if(!c)fail(403,'This record is not available to your account.');
  if(p.revision!=null&&Number(p.revision)!==Number(c.revision))fail(409,'This category changed. Reload and try again.');
  if(c.status==='Retired')fail(400,'This category is already retired.');
  return (await tx`update erp_private.bank_summary_categories set status='Retired',retired_by=${a.staff_id},retired_at=now() where category_id=${c.category_id} returning category_id,status`)[0];
 }
 fail(400,'Unknown bank action.');
}
