// Report-readiness gate (build 2815). Pure rules.
// A final report needs every one of these to pass. Nothing passes by default: an empty list of sources, journals or totals fails, it does not pass.
// A draft preview is always available and is marked Draft until the gate passes.
const money=n=>Math.round((Number(n)||0)*100)/100;
const d=v=>v?String(v instanceof Date?v.toISOString():v).slice(0,10):'';
export const SOURCE_KEYS=['sales','purchases','bank','payroll'];
export const SOURCE_LABEL={sales:'Sales',purchases:'Purchases',bank:'Bank statements',payroll:'Payroll'};

export function monthsBetween(start,end){
 const s=d(start),e=d(end);if(!s||!e||e<s)return [];
 const out=[];let y=Number(s.slice(0,4)),m=Number(s.slice(5,7));
 while(`${y}-${String(m).padStart(2,'0')}`<=e.slice(0,7)&&out.length<60){out.push(`${y}-${String(m).padStart(2,'0')}`);m++;if(m>12){m=1;y++;}}
 return out;
}
const monthBounds=ym=>{const [y,m]=ym.split('-').map(Number);return {start:`${ym}-01`,end:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};};
const overlaps=(ym,s,e)=>{const b=monthBounds(ym);return d(s)<=b.end&&d(e)>=b.start;};

// facts: {imports:[{kind,status,starts_on,ends_on}], batches:[{dataset,period_start,period_end,rows,unmapped}]} for the whole client year.
// A source is expected for every month of the report when it has come in for any month of the year. When nothing has come in at all, that is a failure.
export function sourceChecks({months,facts}){
 const f=facts||{},imports=f.imports||[],batches=f.batches||[];
 const has={sales:imports.some(i=>i.kind==='Sales'&&i.status==='Confirmed')||batches.some(b=>b.dataset==='Sales'&&Number(b.rows)>0),
  purchases:batches.some(b=>b.dataset==='Purchases'&&Number(b.rows)>0),
  bank:batches.some(b=>b.dataset==='Bank'&&Number(b.rows)>0),
  payroll:imports.some(i=>i.kind==='Payroll'&&i.status==='Confirmed')};
 const expected=SOURCE_KEYS.filter(k=>has[k]);
 const rows=[];
 for(const key of expected)for(const ym of months||[]){
  let state,detail='';
  if(key==='sales'){
   const imp=imports.filter(i=>i.kind==='Sales'&&overlaps(ym,i.starts_on,i.ends_on)),bat=batches.filter(b=>b.dataset==='Sales'&&overlaps(ym,b.period_start,b.period_end)&&Number(b.rows)>0);
   if(imp.some(i=>i.status==='Confirmed')||bat.length)state='Received';else if(imp.length){state='Not confirmed';detail='A sales summary exists but is not confirmed.';}else state='Not received';
  }else if(key==='payroll'){
   const imp=imports.filter(i=>i.kind==='Payroll'&&overlaps(ym,i.starts_on,i.ends_on));
   if(imp.some(i=>i.status==='Confirmed'))state='Received';else if(imp.length){state='Not confirmed';detail='A payroll run exists but is not approved.';}else state='Not received';
  }else{
   const ds=key==='purchases'?'Purchases':'Bank',bat=batches.filter(b=>b.dataset===ds&&overlaps(ym,b.period_start,b.period_end)&&Number(b.rows)>0);
   if(!bat.length)state='Not received';else if(key==='purchases'&&bat.some(b=>Number(b.unmapped)>0)){state='Not mapped';detail=bat.reduce((n,b)=>n+Number(b.unmapped||0),0)+' purchase row(s) are not mapped.';}else state='Received';
  }
  rows.push({key,label:SOURCE_LABEL[key],month:ym,state,ok:state==='Received',detail});
 }
 return {expected,rows,none:expected.length===0};
}

// The report's profit must equal what the trial balance says. After a year close the income and expense accounts are closed to equity, so they must net to nil.
export function totalsTie({tb,reportedProfit,yearClosed}){
 const pl=(tb||[]).filter(a=>Number(a.code)>=40000&&Number(a.code)<=69999);
 const fromTb=money(-pl.reduce((n,a)=>n+Number(a.net||0),0));
 if(yearClosed)return {ok:Math.abs(fromTb)<0.01,from_tb:fromTb,reported:money(reportedProfit),detail:Math.abs(fromTb)<0.01?'':'The year is closed but income and expense accounts do not net to nil.'};
 const reported=money(reportedProfit),diff=money(reported-fromTb);
 return {ok:Math.abs(diff)<0.01,from_tb:fromTb,reported,detail:Math.abs(diff)<0.01?'':`Reported profit after tax is ${reported.toFixed(2)} but the trial balance gives ${fromTb.toFixed(2)} (difference ${diff.toFixed(2)}).`};
}

// review: the latest report review for this kind and date (or null). digestOk: the posted figures still match the figures that were signed off.
export function signOffCheck({review,digestOk}){
 if(!review)return {ok:false,detail:'No one has signed this report off. A different Manager or Partner approves it first.'};
 if(review.status!=='Approved')return {ok:false,detail:review.status==='Submitted'?'The report is waiting for a reviewer.':`The latest review is ${String(review.status||'').toLowerCase()}, not approved.`};
 if(!review.reviewed_by||review.reviewed_by===review.prepared_by)return {ok:false,detail:'The sign-off must be by someone other than the preparer.'};
 if(!digestOk)return {ok:false,detail:'The posted figures changed after sign-off. Submit the report again for review.'};
 return {ok:true,detail:''};
}

// Everything in one list. input: {sources,tbTotals,postedJournals,draftJournals,unmapped,issues,tie,signOff,reportedTotals}
export function reportGate(input){
 const i=input||{},checks=[];
 const add=(code,label,ok,detail)=>checks.push({code,label,ok:!!ok,detail:ok?'':detail});
 const src=i.sources||{rows:[],none:true},badSrc=(src.rows||[]).filter(r=>!r.ok);
 add('SOURCES','Expected sources received for every month',!src.none&&!badSrc.length,src.none?'No sales, purchase, bank or payroll source has come in for this client year.':badSrc.slice(0,6).map(r=>`${r.label} ${r.month}: ${r.state}${r.detail?' ('+r.detail+')':''}`).join('; ')+(badSrc.length>6?` and ${badSrc.length-6} more`:''));
 add('MAPPINGS','All rows mapped to accounts',Number(i.unmapped?.count)===0&&Number.isFinite(Number(i.unmapped?.count)),`${i.unmapped?.count??'Unknown'} purchase or expenditure row(s) are not mapped to an account.`);
 add('JOURNALS','Journals posted, none waiting',Number(i.postedJournals)>0&&Number(i.draftJournals)===0,Number(i.postedJournals)>0?`${i.draftJournals} journal(s) still await preparation or review.`:'No journal has been posted for this client year.');
 const t=i.tbTotals||{},bal=Number.isFinite(Number(t.debit))&&Number.isFinite(Number(t.credit))&&(Number(t.debit)!==0||Number(t.credit)!==0)&&Math.abs(money(t.debit)-money(t.credit))<0.01;
 add('TB_BALANCED','Trial balance is balanced',bal,(Number(t.debit)===0&&Number(t.credit)===0)?'The trial balance is empty.':`Debits ${money(t.debit).toFixed(2)} and credits ${money(t.credit).toFixed(2)} differ.`);
 const rt=i.reportedTotals,haveTotals=rt&&['sales','profit_before_tax','profit_after_tax'].every(k=>rt[k]!==undefined&&rt[k]!==null&&Number.isFinite(Number(rt[k])));
 add('REPORT_TOTALS','Report totals present',haveTotals,'The report is missing required totals (sales, profit before tax, profit after tax).');
 add('TOTALS_TIE','Report totals tie to the trial balance',i.tie?.ok===true,i.tie?.detail||'The report has not been compared with the trial balance.');
 const issues=i.issues||[];
 add('EXCEPTIONS','No open exceptions',issues.length===0,issues.slice(0,5).join(' ')+(issues.length>5?` (+${issues.length-5} more)`:''));
 add('SIGN_OFF','Signed off by an independent reviewer',i.signOff?.ok===true,i.signOff?.detail||'No independent sign-off.');
 const failing=checks.filter(c=>!c.ok);
 return {ready:failing.length===0,checks,failing:failing.map(c=>c.code),mark:failing.length?'DRAFT':'FINAL'};
}
export function draftBanner(gate){
 return gate.ready?'':'DRAFT — NOT FOR RELEASE. Open checks: '+gate.checks.filter(c=>!c.ok).map(c=>c.label).join('; ')+'.';
}
