// One source of truth for client tax positions and the recurring PCL work
// that may be scheduled from a verified, dated tax profile.
export const clientObligationGroups=[
 {title:'Income tax and tax regimes',help:'Choose the income tax type and any special regime that applies to the client. The taxpayer type above must match the supporting records.',items:[
  ['Company','Company income tax'],['Partnership','Partnership income tax'],['Individual','Individual income tax'],['TOT','Turnover Tax (TOT)'],['MRI','Residential rental income tax (MRI)']
 ]},
 {title:'VAT and withholding positions',help:'Record VAT registration, appointment as a withholding agent, and withholding tax credits received as separate positions.',items:[
  ['VAT','VAT registered'],['Withholding VAT agent','Appointed withholding VAT agent'],['Withholding VAT credits received','Withholding VAT credits received'],['WHT','Withholding income tax agent / payer'],['Withholding income tax credits received','Withholding income tax credits received']
 ]},
 {title:'Employer and payroll obligations',help:'Select only where supported by the client’s employer status, payroll records or registration.',items:[
  ['PAYE','PAYE'],['Housing levy','Affordable Housing Levy'],['SHIF','Social Health Insurance (SHIF)'],['NSSF','NSSF'],['NITA','NITA employer levy'],['Fringe benefit','Fringe benefit tax'],['Deemed interest','Deemed interest tax']
 ]},
 {title:'Other and transaction-triggered taxes',help:'These depend on a licence, transaction or tax position. Keep them on the profile; create a one-off task when the relevant filing period or transaction is confirmed.',items:[
  ['Excise duty','Excise duty'],['CGT','Capital Gains Tax (CGT)'],['Instalment tax','Instalment tax'],['Advance tax','Advance tax']
 ]}
];

const recurringServiceGroups=[
 {title:'Monthly returns and reviews',items:[
  {value:'VAT',label:'VAT return',profile:['VAT'],cadence:'monthly'},
  {value:'PAYE',label:'PAYE return',profile:['PAYE'],cadence:'monthly'},
  {value:'TOT',label:'Turnover Tax return',profile:['TOT'],cadence:'monthly'},
  {value:'MRI',label:'Residential rental income tax (MRI) return',profile:['MRI'],cadence:'monthly'}
 ]},
 {title:'Payroll and employer reviews',items:[
  {value:'Payroll',label:'Payroll preparation (PCL service)',profile:[],cadence:'monthly'},
  {value:'Housing levy',label:'Affordable Housing Levy review',profile:['Housing levy'],cadence:'monthly'},
  {value:'SHIF',label:'SHIF contribution review',profile:['SHIF'],cadence:'monthly'},
  {value:'NSSF',label:'NSSF contribution review',profile:['NSSF'],cadence:'monthly'},
  {value:'NITA',label:'NITA employer levy review',profile:['NITA'],cadence:'monthly'},
  {value:'Fringe benefit',label:'Fringe benefit tax review',profile:['Fringe benefit'],cadence:'monthly'},
  {value:'Deemed interest',label:'Deemed interest tax review',profile:['Deemed interest'],cadence:'monthly'}
 ]}
];

export const profileOnlyPositions=[
 'Withholding VAT agent','Withholding VAT credits received','WHT','Withholding income tax credits received',
 'Excise duty','CGT','Instalment tax','Advance tax'
];
export const legacyScheduleObligations=['VAT','PAYE','TOT','Payroll'];

export function verifiedClientTaxProfile(workspace,clientId,onDate){
 if(!clientId||!onDate)return null;
 return (workspace?.suite?.tax_profiles||[])
  .filter(p=>p.client_id===clientId&&p.status==='Verified'&&String(p.effective_from).slice(0,10)<=onDate&&String(p.effective_to).slice(0,10)>=onDate)
  .sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)))[0]||null;
}

export function eligibleScheduleDefaults(profile){
 if(!profile||profile.status!=='Verified')return [];
 const confirmed=new Set(profile.obligations||[]);
 return recurringServiceGroups.flatMap(group=>group.items).filter(item=>!item.profile.length||item.profile.some(code=>confirmed.has(code))).map(item=>item.value);
}

export function scheduleChecks(name,selected=[],profile=null,esc=value=>String(value??'')){
 const selectedSet=new Set(selected),profileSet=new Set(profile?.obligations||[]);
 const eligible=item=>item.value==='Payroll'||(!profile&&legacyScheduleObligations.includes(item.value))||item.profile.some(code=>profileSet.has(code));
 const groups=recurringServiceGroups.map((group,index)=>{
  const available=group.items.filter(item=>eligible(item)||selectedSet.has(item.value));
  if(!available.length)return '';
  return `<details class="full" ${index===0?'open':''}><summary>${esc(group.title)}</summary>${available.map(item=>`<label class="obligation-choice"><input name="${esc(name)}" type="checkbox" value="${esc(item.value)}" ${selectedSet.has(item.value)?'checked':''}><span>${esc(item.label)}</span></label>`).join('')}</details>`;
 }).filter(Boolean).join('');
 const profileMessage=profile?`<p class="muted full">Available services match the verified client tax profile for ${esc(String(profile.effective_from).slice(0,10))}–${esc(String(profile.effective_to).slice(0,10))}. This list sets PCL work; it does not itself confirm a filing or approve a tax claim.</p>`:`<p class="info full">A Manager or Partner must verify the client tax profile before adding services beyond VAT, PAYE, TOT and payroll. Open the client’s Tax profile to record registrations and tax positions.</p>`;
 return `${profileMessage}${groups||'<p class="muted full">No recurring PCL services match the verified profile yet.</p>'}<p class="muted full">Annual schedules create general annual compilation, review and reporting tasks. Confirm the client year-end before assigning a separate income-tax return task.</p><p class="muted full">Withholding VAT, withholding income tax, credits received, CGT, excise, advance tax and instalment tax remain on the client profile. Add a one-off task when the transaction or client filing calendar calls for it; these choices do not create guessed recurring deadlines.</p><p class="muted full">Dates generated by this schedule are internal work targets. Check the client reporting period and current statutory due date separately.</p>`;
}

export function profileObligationChecks(selected=[],esc=value=>String(value??'')){
 const checked=new Set(selected);
 return clientObligationGroups.map((group,index)=>`<details class="full" ${index===0?'open':''}><summary>${esc(group.title)}</summary><p class="muted">${esc(group.help)}</p>${group.items.map(([value,label])=>`<label class="obligation-choice"><input type="checkbox" name="obligations" value="${esc(value)}" ${checked.has(value)?'checked':''}><span>${esc(label)}</span></label>`).join('')}</details>`).join('');
}
