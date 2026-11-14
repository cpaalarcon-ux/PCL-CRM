// Home metrics for Partners (whole firm) and Managers (only the clients they oversee). Every figure is computed by the database.
// Realization = net fees billed (Posted invoices, excluding VAT) / standard value of approved billable hours x 100. Credit notes are not part of V1.
// Cash collected and gross margin are different measures and are shown separately, never folded into realization.
export function createMetricsUI(ctx){
 const {esc,request}=ctx;
 let preset='ytd',busy=false;
 const nairobi=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Nairobi'}).format(new Date());
 const shift=(iso,days)=>new Date(Date.parse(iso+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
 function range(){const t=nairobi();
  if(preset==='month')return {from:t.slice(0,8)+'01',to:t};
  if(preset==='90')return {from:shift(t,-89),to:t};
  if(preset==='12m')return {from:shift(t,-364),to:t};
  return {from:t.slice(0,4)+'-01-01',to:t};}
 const kes=n=>'KES '+Number(n||0).toLocaleString('en-KE',{maximumFractionDigits:0});
 const tile=(label,value,sub='',cls='')=>`<div class="metric-tile ${cls}"><span>${esc(label)}</span><b>${esc(value)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`;
 function html(m){
  const real=m.realization_pct===null||m.realization_pct===undefined?'No rated hours':Number(m.realization_pct).toFixed(1)+'%';
  const ag=m.ageing||{};
  return `<div class="metric-grid">${tile('Realization',real,`Billed ${kes(m.billed_net)} of ${kes(m.standard_value)} at standard rates`,'primary')}${tile('Net fees billed',kes(m.billed_net),'Posted invoices, excluding VAT')}${tile('Unbilled work (WIP)',kes(m.wip_unbilled),'Approximate: invoices are not tied to time lines')}${tile('Receivables',kes(m.receivables_total),'Posted invoices less payments, as at today')}</div>
  <h3>Cash and margin <small>(separate from realization)</small></h3><div class="metric-grid">${tile('Cash collected',kes(m.cash_collected),'Payments received in the period')}${tile('Staff cost',kes(m.staff_cost),'Approved hours at cost rate')}${tile('Gross margin',kes(m.gross_margin),'Net fees billed less staff cost')}</div>
  <details class="section-space"><summary>Receivables ageing</summary><div class="scroll"><table><thead><tr><th>Not yet due</th><th>1–30 days</th><th>31–60 days</th><th>61–90 days</th><th>Over 90 days</th></tr></thead><tbody><tr><td>${kes(ag.not_due)}</td><td>${kes(ag.d1_30)}</td><td>${kes(ag.d31_60)}</td><td>${kes(ag.d61_90)}</td><td>${kes(ag.over_90)}</td></tr></tbody></table></div></details>
  ${Number(m.hours_without_rate)>0?`<p class="info" role="status">${Number(m.hours_without_rate).toFixed(2)} approved billable hours have no standard rate for their date and are left out of realization. Add the rate in Staff rates.</p>`:''}
  <p class="muted">Realization uses invoices only, so credit notes are not yet taken off. ${esc(m.scope==='firm'?'Showing the whole firm.':'Showing only the '+m.client_count+' client'+(m.client_count===1?'':'s')+' you oversee.')}</p>`;
 }
 async function paint(){
  const box=document.querySelector('#homeMetrics');if(!box||busy)return;busy=true;
  const head=`<div class="section-head"><div><h2>Practice metrics</h2><p class="muted">Partners see the whole firm. Managers see the clients they oversee.</p></div><label class="inline">Period <select data-metrics="period" aria-label="Metrics period"><option value="month"${preset==='month'?' selected':''}>This month</option><option value="90"${preset==='90'?' selected':''}>Last 90 days</option><option value="ytd"${preset==='ytd'?' selected':''}>Year to date</option><option value="12m"${preset==='12m'?' selected':''}>Last 12 months</option></select></label></div>`;
  try{const r=range(),m=await request({action:'metrics_summary',period_from:r.from,period_to:r.to});box.innerHTML=head+html(m)+`<small class="muted">Period ${esc(r.from)} to ${esc(r.to)}</small>`;}
  catch(e){box.innerHTML=head+`<p class="info">${esc(e.message||'Metrics could not be loaded.')}</p>`;}
  finally{busy=false;}
 }
 document.addEventListener('change',e=>{const s=e.target.closest('select[data-metrics="period"]');if(s){preset=s.value;void paint();}});
 return {paint,range:()=>range(),setPreset:p=>{preset=p;}};
}
