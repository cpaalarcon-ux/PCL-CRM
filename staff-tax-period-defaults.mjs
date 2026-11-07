const annualKinds=new Set(['Company','Individual','Partnership']);
const iso=(y,m,d)=>`${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
const endOfMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();

// Monthly obligations default to the latest complete calendar month. Annual
// income-tax obligations default to the client's most recently completed year.
// These are editable defaults: staff must confirm the client's actual period.
export function defaultTaxReportingPeriod(kind,client={},asOf){
 const today=String(asOf||'').slice(0,10),[yearText,monthText,dayText]=today.split('-');
 let year=Number(yearText),month=Number(monthText),day=Number(dayText);
 if(!Number.isInteger(year)||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1)throw new Error('Use a valid as-of date.');
 if(annualKinds.has(kind)){
  const fyeMonth=Number(client.year_end_month),fyeDay=Number(client.year_end_day);
  if(Number.isInteger(fyeMonth)&&fyeMonth>=1&&fyeMonth<=12&&Number.isInteger(fyeDay)&&fyeDay>=1){
   const actualEndDay=Math.min(fyeDay,endOfMonth(year,fyeMonth));
   const candidate=iso(year,fyeMonth,actualEndDay),end=candidate<=today?candidate:iso(year-1,fyeMonth,Math.min(fyeDay,endOfMonth(year-1,fyeMonth)));
   const priorYear=Number(end.slice(0,4))-1,priorEnd=iso(priorYear,fyeMonth,Math.min(fyeDay,endOfMonth(priorYear,fyeMonth)));
   const start=new Date(Date.parse(priorEnd+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   return {starts_on:start,ends_on:end,basis:`Client financial year ending ${end}. Confirm it matches the verified reporting period.`};
  }
  const endYear=today.slice(5)>='12-31'?year:year-1;
  return {starts_on:`${endYear}-01-01`,ends_on:`${endYear}-12-31`,basis:'Client financial year-end is not set. Confirm the reporting period before saving.'};
 }
 // If today is the final day of a month, treat that month as the current
 // reporting period; otherwise use the latest fully completed month.
 const currentIsComplete=day===endOfMonth(year,month);
 if(!currentIsComplete){month--;if(month===0){month=12;year--;}}
 return {starts_on:iso(year,month,1),ends_on:iso(year,month,endOfMonth(year,month)),basis:'Defaults to the latest complete calendar month. Confirm the client’s reporting month; edit the dates if needed.'};
}
