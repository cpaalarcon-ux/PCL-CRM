// Build 2835: the register that measures the 95% reduction target. A reduction is a MEASURE of minutes against the firm's own baseline, not a promise: it is shown
// only after three periods of current entries, and it sits beside rework, first-pass and missed deadlines so a faster result that is less accurate is visible.
export const ACTIVITIES=['Client setup','Engagement setup','Period opening','Payroll preparation','Bank and receipts routing','VAT return preparation','Annual statements','Year rollover','Review pack','Other'];
export const METHODS=['Timed','Timesheet','Estimated'];
export const TARGET_PCT=95,PERIODS_NEEDED=3;
const num=v=>Number(v||0),r1=v=>Math.round(v*10)/10,r2=v=>Math.round(v*100)/100;
const mean=a=>a.length?a.reduce((s,x)=>s+num(x),0)/a.length:0;
export function entryIssues(e,{hasBaseline=true}={}){
 const out=[];
 if(!ACTIVITIES.includes(e.activity))out.push('Choose the activity.');
 if(!['Baseline','Current'].includes(e.kind))out.push('Choose baseline or current.');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(e.period_label||'')))out.push('Enter the month the work belongs to.');
 const m=num(e.minutes);if(!(m>0)||m>20000)out.push('Enter the minutes taken (more than 0).');
 if(!METHODS.includes(e.method))out.push('Say how the minutes were obtained.');
 if(e.method==='Estimated'&&String(e.note||'').trim().length<10)out.push('An estimate needs a note saying what it is based on (at least 10 characters).');
 if(e.kind==='Current'){if(typeof e.first_pass!=='boolean')out.push('Say whether the work passed review first time.');if(num(e.rework_minutes)<0)out.push('Rework minutes cannot be negative.');if(!hasBaseline)out.push('Record the baseline for this activity first.');}
 return out;
}
// One row per activity. `entries` are Active rows only. The baseline is the average of its entries; the current figure is the average of the latest PERIODS_NEEDED
// distinct months, so an old slow month does not hold the figure down once the work has settled.
export function summarise(entries,{target=TARGET_PCT}={}){
 const rows=ACTIVITIES.map(activity=>{
  const base=entries.filter(e=>e.activity===activity&&e.kind==='Baseline'),cur=entries.filter(e=>e.activity===activity&&e.kind==='Current');
  const months=[...new Set(cur.map(e=>e.period_label))].sort(),latest=months.slice(-PERIODS_NEEDED),used=cur.filter(e=>latest.includes(e.period_label));
  const baselineMinutes=mean(base.map(e=>e.minutes)),currentMinutes=mean(used.map(e=>e.minutes));
  const firstPass=used.length?used.filter(e=>e.first_pass===true).length/used.length:null,rework=used.reduce((s,e)=>s+num(e.rework_minutes),0),missed=used.filter(e=>e.missed_deadline).length;
  let state,reduction=null;
  if(!base.length)state=cur.length?'No baseline':'Nothing recorded';
  else if(months.length<PERIODS_NEEDED)state=`Needs ${PERIODS_NEEDED-months.length} more period${PERIODS_NEEDED-months.length===1?'':'s'}`;
  else{reduction=r1((1-currentMinutes/baselineMinutes)*100);state=reduction>=target?'Target reached':'Below target';}
  const accuracy=used.length?(missed===0&&firstPass===1?'No missed deadlines, all passed review first time':[missed?`${missed} missed deadline${missed===1?'':'s'}`:'',firstPass<1?`${Math.round((1-firstPass)*used.length)} needed rework after review`:''].filter(Boolean).join('; ')):'';
  return {activity,baseline_entries:base.length,baseline_minutes:r1(baselineMinutes),current_entries:cur.length,periods:months.length,periods_used:latest,current_minutes:r1(currentMinutes),reduction_pct:reduction,first_pass_rate:firstPass==null?null:r2(firstPass),rework_minutes:r1(rework),missed_deadlines:missed,accuracy_note:accuracy,state};
 }).filter(r=>r.baseline_entries||r.current_entries);
 const comparable=rows.filter(r=>r.reduction_pct!==null),b=comparable.reduce((s,r)=>s+r.baseline_minutes,0),c=comparable.reduce((s,r)=>s+r.current_minutes,0);
 return {target,periods_needed:PERIODS_NEEDED,rows,overall:comparable.length?{activities:comparable.length,baseline_minutes:r1(b),current_minutes:r1(c),reduction_pct:r1((1-c/b)*100),reached:comparable.every(r=>r.reduction_pct>=target)&&(1-c/b)*100>=target}:null,
  note:'A reduction is a measure of minutes against your own baseline. It is not a promise, and it is read beside rework, first-pass review and missed deadlines.'};
}
