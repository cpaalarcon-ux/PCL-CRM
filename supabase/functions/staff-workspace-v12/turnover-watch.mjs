// Turnover watch: compares a client's rolling 12-month sales with the limits held in the Rate Register.
// No figure is written here. A limit that is missing from the register is reported as "not set"; a limit still
// awaiting the Tax Lead's written confirmation is shown as provisional. The watch raises questions; it never decides.
const kes=n=>'KES '+Number(n).toLocaleString('en-KE',{minimumFractionDigits:0,maximumFractionDigits:2});
const num=v=>{const n=Number(v);return v!==null&&v!==undefined&&v!==''&&Number.isFinite(n)?n:null;};
const provisional=rule=>rule?.legal_review_status==='Pending'?' Provisional: this limit awaits the Tax Lead\'s written confirmation.':'';

export function turnoverWatch({turnover=null,taxableSupplies=null,monthsCovered=0,profile=null,totRule=null,vatRule=null}={}){
 const alerts=[],add=(code,level,message)=>alerts.push({code,level,message});
 const t=num(turnover),v=num(taxableSupplies??turnover);
 if(t===null||monthsCovered<=0){
  add('NO_SALES_DATA','Info','No confirmed sales were found for the last 12 months, so turnover cannot be compared with any limit.');
  return {turnover:null,taxable_supplies:null,months_covered:0,alerts,status:'No data'};
 }
 if(monthsCovered<12)add('PARTIAL_COVERAGE','Info',`Sales evidence covers ${monthsCovered} of the last 12 months. The figures below are a minimum; the true 12-month turnover may be higher.`);
 const vatLimit=num(vatRule?.parameters?.threshold);
 const vat=profile?.obligation_statuses?.VAT,vatRegistered=!!profile&&(profile.obligations||[]).includes('VAT')&&vat?.registered==='YES';
 if(vatLimit===null)add('VAT_THRESHOLD_NOT_SET','Review','The VAT registration threshold has not been entered in the Rate Register (awaiting the Tax Lead), so taxable supplies cannot be compared with it.');
 else if(v>=vatLimit){
  if(!vatRegistered)add('VAT_REGISTRATION','Review',`Taxable supplies for the last 12 months are ${kes(v)}, at or above the VAT registration threshold of ${kes(vatLimit)}, and the client is not recorded as VAT-registered. Check VAT registration. VAT and TOT can coexist.${provisional(vatRule)}`);
  else add('VAT_REGISTERED','Info',`Taxable supplies of ${kes(v)} are at or above the VAT registration threshold of ${kes(vatLimit)}; the client is recorded as VAT-registered.${provisional(vatRule)}`);
 }
 if(!profile)add('NO_VERIFIED_PROFILE','Review','No verified tax profile covers today, so the client\'s tax regime is unknown. Verify a profile before relying on this watch.');
 else if(profile.regime==='TOT'){
  const lo=num(totRule?.parameters?.minimum_turnover_exclusive),hi=num(totRule?.parameters?.maximum_turnover);
  if(hi===null&&lo===null)add('TOT_BAND_NOT_SET','Review','The client is under the TOT regime but the TOT turnover band is not in the Rate Register, so turnover cannot be compared with it.');
  else {
   if(hi!==null&&t>hi)add('TOT_CEILING','Review',`Turnover for the last 12 months is ${kes(t)}, above the TOT upper limit of ${kes(hi)}. Review whether the client can stay on TOT.${provisional(totRule)}`);
   if(lo!==null&&t<=lo)add('TOT_FLOOR','Info',`Turnover for the last 12 months is ${kes(t)}, at or below the TOT lower limit of ${kes(lo)}. Confirm TOT still applies.${provisional(totRule)}`);
  }
 }
 const review=alerts.some(a=>a.level==='Review');
 return {turnover:t,taxable_supplies:v,months_covered:monthsCovered,alerts,status:review?'Review':'Clear'};
}

// 12 months ending on asOf (inclusive), as dates.
export function trailingYear(asOf){
 const end=new Date(asOf+'T00:00:00Z');if(Number.isNaN(end.getTime()))throw new Error('Choose a valid date.');
 const start=new Date(Date.UTC(end.getUTCFullYear()-1,end.getUTCMonth(),end.getUTCDate()+1));
 return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};
}
