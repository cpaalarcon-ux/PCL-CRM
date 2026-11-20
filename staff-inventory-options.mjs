const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
export const mappingPeriod=row=>day(row.normalized?.return_month||row.period_start||row.normalized?.date);
export const mappingPeriods=(rows,snapshot)=>[...new Set((snapshot?.mapping_periods||rows.map(mappingPeriod)).map(x=>day(typeof x==='string'?x:x.period)).filter(Boolean))].sort();
export const mappingDates=(rows,snapshot)=>[...new Set(snapshot?.mapping_dates||rows.map(r=>day(r.normalized?.date||r.period_start||r.normalized?.return_month)).filter(Boolean))].sort();
export function inventoryMethod(data,activityId,dates){
 const versions=(data.policies||[]).filter(p=>p.activity_id===activityId).sort((a,b)=>day(b.effective_from).localeCompare(day(a.effective_from)));
 if(!dates.length)return {error:'Refresh the purchase selection to confirm its invoice dates.'};
 const activity=(data.activities||[]).find(a=>a.activity_id===activityId);
 if(activityId&&(!activity||dates.some(d=>day(activity.effective_from)>d||activity.effective_to&&day(activity.effective_to)<d)))return {error:'The selected activity does not cover every invoice date. Choose a valid activity or map the affected rows separately.'};
 const methods=dates.map(d=>(versions.length?versions.find(v=>day(v.effective_from)<=d):data.policy)?.inventory_method);
 if(methods.some(m=>!['Periodic','Perpetual'].includes(m)))return {error:'A Manager must configure the inventory method effective on each invoice date.'};
 if(new Set(methods).size!==1)return {error:'The selected invoices use different inventory methods. Map one effective policy period at a time.'};
 return {method:methods[0]};
}
export function inventoryAccountAllowed(code,use){
 if(use==='Construction raw materials')return ['10200','50010'].includes(code);
 if(use==='Goods for resale')return ['10190','10240','50000','50020','50030','50040','50050','50060','50090'].includes(code);
 return !['10190','50000','10200','50010'].includes(code);
}
export function stockChoices(data,activityId,use,currentRows=[]){
 const entries=[...(data.stock_categories||[]),...currentRows.filter(r=>r.review_details?.stock_class).map(r=>({stock_class:r.review_details.stock_class,activity_id:r.review_details.activity_id||null,inventory_use:r.review_details.inventory_use||(['10200','50010'].includes(r.account_code)?'Construction raw materials':['10190','50000'].includes(r.account_code)?'Goods for resale':'Other inventory')}))];
 return [...new Set(entries.filter(x=>(!x.activity_id||x.activity_id===activityId)&&(!x.inventory_use||x.inventory_use===use)).map(x=>x.stock_class).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
