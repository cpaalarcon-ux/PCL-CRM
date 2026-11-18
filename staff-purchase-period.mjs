// Purchases upload: which VAT category a worksheet is for, and the period it covers (build 2892). Pure; the server still re-checks everything.
// A sheet named 16%, 8%, 0% or Exempt (or the older Gen / Other / Zero / Exempt Purchase Upload names) suggests the category. The person can still change it.
export const PURCHASE_CATEGORIES=['16%','8%','0%','Exempt'];
export function purchaseCategoryFromSheet(sheetName){
 const name=String(sheetName||'').split(' :: ').at(-1).trim().toLowerCase().replace(/\s+/g,' ');
 if(!name)return '';
 if(/^(16\s*%|16|gen|general)(\b| purchase|$)/.test(name))return '16%';
 if(/^(8\s*%|8|other)(\b| purchase|$)/.test(name))return '8%';
 if(/^(0\s*%|0|zero)(\b| purchase|$)/.test(name))return '0%';
 if(/^(exempt)(\b| purchase|$)/.test(name))return 'Exempt';
 return '';
}
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s||'')&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
// kind: 'Month' (month = YYYY-MM) or 'Week' (weekStart = first day, the week runs seven days). Anything unreadable gives empty dates so the screen asks again.
export function purchasePeriod({kind='Month',month='',weekStart='',vat_category=''}={}){
 if(kind==='Week'){
  if(!isDate(weekStart))return {vat_category,period_kind:'Week',reporting_month:'',period_start:'',period_end:''};
  const end=new Date(Date.parse(weekStart+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
  return {vat_category,period_kind:'Week',reporting_month:weekStart.slice(0,7),period_start:weekStart,period_end:end};
 }
 if(!/^\d{4}-\d{2}$/.test(month||'')||Number(month.slice(5))<1||Number(month.slice(5))>12)return {vat_category,period_kind:'Month',reporting_month:month,period_start:'',period_end:''};
 const [year,mm]=month.split('-').map(Number);
 return {vat_category,period_kind:'Month',reporting_month:month,period_start:`${month}-01`,period_end:new Date(Date.UTC(year,mm,0)).toISOString().slice(0,10)};
}
