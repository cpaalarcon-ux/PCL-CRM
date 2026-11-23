import {fail,revision,uuid} from './validation.mjs';
import {canUseAction} from './staff-action-rights.mjs';
import {areaForStaffAction,staffAreaCanUse} from './staff-access-control.mjs';

const types=['tax_rate','chart_account','statement_map'] as const;
type Type=typeof types[number];

const underlying={tax_rate:['rate_save','settings.edit'],chart_account:['accounting_account_add','acct.setup'],statement_map:['ledger_statement_map_propose','fs.map']};

export async function settingsStarterProposalAction(tx:any,a:any,p:any){
 if(!['settings_starter_proposals_read','settings_starter_propose'].includes(p.action))return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'A Manager or Partner must propose starter settings.');
 const denied=(await tx`select right_code from erp_private.staff_right_restrictions where staff_id=${a.staff_id}`).map((r:any)=>r.right_code);
 if(denied.includes('settings.approvals')||!canUseAction(denied,{action:'settings_starter_propose'},'settings'))fail(403,'Your access to propose starter settings is switched off.');
 const areas=(await tx`select area_code from erp_private.staff_area_restrictions where staff_id=${a.staff_id}`).map((r:any)=>r.area_code);
 const canPropose=(type:Type)=>{
  const [action,right]=underlying[type],area=areaForStaffAction(action);
  return staffAreaCanUse(a.category_code,areas,area)&&!denied.includes(right)&&canUseAction(denied,{action},area);
 };
 if(p.action==='settings_starter_proposals_read'){
  const rates=canPropose('tax_rate')?await tx`
   select rate_id as id,revision,rate_key as code,label,tax_type,effective_from::text,effective_to::text,parameters,source_url,source_note,legal_citation,legal_review_status
   from erp_private.tax_rates
   where status='Draft' and created_by is null and deleted_at is null and not is_test and rate_key !~* '^QA' and label !~* '(FICTIONAL|SYNTHETIC TEST)'
   order by rate_key,effective_from,rate_id`:[];
  const accounts=canPropose('chart_account')?await tx`
   select code as id,code,revision,name as label,account_group,route,category_code,statement,tax_note,evidence,notes
   from erp_private.account_catalog where status='Draft' and proposed_by is null order by code`:[];
  const mappings=canPropose('statement_map')?await tx`
   select m.map_id as id,m.account_code as code,c.name as label,m.line_code,l.label as line_label,m.effective_from::text,m.reason,c.status as account_status,c.is_legacy
   from erp_private.account_statement_map m
   join erp_private.account_catalog c on c.code=m.account_code
   join erp_private.statement_lines l on l.line_code=m.line_code
   where m.status='Draft' and m.proposed_by is null order by m.account_code,m.map_id`:[];
  return {groups:[{type:'tax_rate',items:rates},{type:'chart_account',items:accounts},{type:'statement_map',items:mappings}]};
 }

 if(p.review_confirmed!==true)fail(400,'Confirm that you reviewed the selected starter drafts.');
 if(!Array.isArray(p.items)||!p.items.length||p.items.length>500)fail(400,'Select between 1 and 500 starter drafts.');
 const selected=new Map<Type,Map<string,string>>();
 for(const item of p.items){
  const type=item?.type as Type;
  if(!types.includes(type))fail(400,'A selected starter draft has an unknown type.');
  if(!canPropose(type))fail(403,'Your access to propose this type of setting is switched off.');
  const id=type==='chart_account'?String(item.id||''):uuid(item.id);
  if(type==='chart_account'&&!/^\d{5}$/.test(id))fail(400,'A selected account code is invalid.');
  if(!selected.has(type))selected.set(type,new Map());
  const group=selected.get(type)!;
  if(group.has(id))fail(400,'A starter draft was selected twice.');
  group.set(id,type==='statement_map'?'':revision(item.revision));
 }

 for(const type of types){
  const group=selected.get(type);
  if(!group)continue;
  const ids=[...group.keys()].sort(),revisions=ids.map(id=>group.get(id));
  let changed;
  if(type==='tax_rate')changed=await tx`
   update erp_private.tax_rates r set created_by=${a.staff_id}
   from unnest(${ids}::uuid[],${revisions}::bigint[]) selected(id,revision)
   where r.rate_id=selected.id and r.revision=selected.revision and r.status='Draft'
     and r.created_by is null and r.deleted_at is null and not r.is_test
     and r.rate_key !~* '^QA' and r.label !~* '(FICTIONAL|SYNTHETIC TEST)' returning r.rate_id`;
  else if(type==='chart_account')changed=await tx`
   update erp_private.account_catalog c set proposed_by=${a.staff_id}
   from unnest(${ids}::text[],${revisions}::bigint[]) selected(code,revision)
   where c.code=selected.code and c.revision=selected.revision and c.status='Draft'
     and c.proposed_by is null returning c.code`;
  else {
   await tx`select pg_advisory_xact_lock(hashtextextended('statement-map',0))`;
   changed=await tx`
    update erp_private.account_statement_map set proposed_by=${a.staff_id},proposed_at=now()
    where map_id=any(${ids}::uuid[]) and status='Draft' and proposed_by is null returning map_id`;
  }
  if(changed.length!==ids.length)fail(409,'A selected draft changed or now has a proposer. Reopen the list and review the current drafts.');
 }
 return {proposed:p.items.length};
}
