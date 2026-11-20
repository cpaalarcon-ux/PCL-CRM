// Partner and Manager metrics. The database computes everything and decides the scope: a Partner sees the whole firm, a Manager only the
// clients they oversee. Anyone else is refused. Realization uses invoices only (V1); cash collected and gross margin are separate figures.
import {fail,date} from './validation.mjs';
export async function metricsAction(tx:any,a:any,p:any){
 if(!['metrics_summary','metrics_wip','metrics_realization'].includes(String(p.action||'')))return undefined;
 if(!['PARTNER','MANAGER'].includes(a.category_code))fail(403,'Metrics are for Managers and Partners.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
 const from=p.period_from?date(p.period_from):today.slice(0,4)+'-01-01',to=p.period_to?date(p.period_to):today;
 const [row]=await tx`select erp_private.metrics_summary(${from}::date,${to}::date) m`;const m=row.m;
 if(p.action==='metrics_wip')return {scope:m.scope,client_count:m.client_count,period_from:m.period_from,period_to:m.period_to,wip_unbilled:m.wip_unbilled,receivables_total:m.receivables_total,ageing:m.ageing};
 if(p.action==='metrics_realization')return {scope:m.scope,client_count:m.client_count,period_from:m.period_from,period_to:m.period_to,billed_net:m.billed_net,standard_value:m.standard_value,realization_pct:m.realization_pct,hours_without_rate:m.hours_without_rate};
 return m;
}
