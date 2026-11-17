// Build 2855: POCAMLA client profile rules (pure; the server action file calls these and the database enforces the same limits again).
// The MLRO owns the lists, the risk rating and the decision. These rules only say what information must be present, how a status is named,
// and who is sent to the MLRO. No screening list, risk weight or legal threshold is written here.

export const CATEGORIES=['COUNTRY','PEP_TYPE','SOURCE_OF_FUNDS','SOURCE_OF_WEALTH','SERVICE_ACTIVITY','RISK_INDICATOR'];
export const SELECTION_CATEGORIES=['COUNTRY','SOURCE_OF_FUNDS','SOURCE_OF_WEALTH','SERVICE_ACTIVITY','RISK_INDICATOR'];
export const CATEGORY_LABELS={COUNTRY:'Countries',PEP_TYPE:'PEP status',SOURCE_OF_FUNDS:'Source of funds',SOURCE_OF_WEALTH:'Source of wealth',SERVICE_ACTIVITY:'Services and AML-relevant activity',RISK_INDICATOR:'Risk indicators'};
// A country selection says which part of the relationship it concerns.
export const COUNTRY_CONTEXTS=['Incorporation or residence','Business operations','Counterparties','Source of funds'];
export const SCREENING=['Not screened','No match','Potential match','Confirmed match'];
export const RATINGS=['Low','Medium','High'];
export const DECISIONS=['Accept','Accept with conditions','Restrict','Decline'];
export const PEP_NONE='No known PEP';

const clip=(v,max)=>{const s=String(v??'').replace(/\s+/g,' ').trim();return s.length>max?null:s;};
const isoDate=v=>{const s=String(v||'').trim();if(!s)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s?s:null;};

const TEXTS=[['purpose_of_relationship','Purpose of the relationship',1000],['expected_activity','Expected activity',1000],['expected_size_frequency','Expected size and frequency of transactions',500],
 ['pep_role','PEP public role',300],['pep_jurisdiction','PEP jurisdiction',120],['pep_relationship','Relationship to the PEP',300],
 ['screening_list_source','Screening list used',300],['screening_note','Screening result note',1000]];
const DATES=[['pep_from','PEP role start date'],['screening_list_date','Screening list effective date']];

// What staff may save. Anything the MLRO decides (rating, decision, review date) is not accepted here.
export function cleanProfile(input,{pepTypes=[]}={}){
 const out={},errors=[];
 for(const [k,label,max] of TEXTS){if(input[k]===undefined)continue;const v=clip(input[k],max);if(v===null)errors.push({key:k,error:label+' is too long (at most '+max+' characters).'});else out[k]=v||null;}
 for(const [k,label] of DATES){if(input[k]===undefined)continue;const v=isoDate(input[k]);if(v===null)errors.push({key:k,error:label+' is not a valid date.'});else out[k]=v||null;}
 if(input.pep_type!==undefined){const v=clip(input.pep_type,120);if(v&&pepTypes.length&&!pepTypes.includes(v))errors.push({key:'pep_type',error:'Choose a PEP status from the MLRO’s list.'});else out.pep_type=v||null;}
 if(input.screening_status!==undefined){if(!SCREENING.includes(input.screening_status))errors.push({key:'screening_status',error:'Choose a screening result.'});else out.screening_status=input.screening_status;}
 return {ok:!errors.length,value:out,errors};
}

// Selections: one row per (category, context, value). The value must be on the MLRO's current list.
export function cleanSelections(list,lookups){
 const errors=[],rows=[],seen=new Set();
 for(const [i,s] of (Array.isArray(list)?list:[]).entries()){
  const category=String(s?.category||''),value=clip(s?.value,120),context=category==='COUNTRY'?String(s?.context||''):'',note=s?.note?clip(s.note,500):'';
  if(!SELECTION_CATEGORIES.includes(category)){errors.push({row:i,error:'Unknown category.'});continue;}
  if(category==='COUNTRY'&&!COUNTRY_CONTEXTS.includes(context)){errors.push({row:i,error:'Say which part of the relationship the country concerns.'});continue;}
  const hit=(lookups||[]).find(l=>l.category===category&&l.status!=='Ended'&&l.value.toLowerCase()===String(value||'').toLowerCase());
  if(!value||!hit){errors.push({row:i,error:`${value||'This value'} is not on the MLRO's current ${CATEGORY_LABELS[category].toLowerCase()} list.`});continue;}
  if(note===null){errors.push({row:i,error:'A note is too long (at most 500 characters).'});continue;}
  const key=[category,context,hit.value.toLowerCase()].join('|');if(seen.has(key))continue;seen.add(key);
  rows.push({category,context,lookup_value:hit.value,note:note||null,doc_ref:s?.doc_ref?String(s.doc_ref).trim().toUpperCase():null,attention:!!hit.attention});
 }
 return {ok:!errors.length,rows,errors};
}

// What is still missing before staff may refer the profile to the MLRO. Each item names the cell so the screen can mark it red.
export function missingInfo({profile,selections,attentionOf}){
 const p=profile||{},sel=selections||[],m=[],has=(c,ctx)=>sel.some(s=>s.category===c&&(ctx===undefined||s.context===ctx));
 if(!p.purpose_of_relationship)m.push({key:'purpose_of_relationship',label:'Purpose of the relationship'});
 if(!p.expected_activity)m.push({key:'expected_activity',label:'Expected activity'});
 if(!p.pep_type)m.push({key:'pep_type',label:'PEP status'});
 else if(p.pep_type!==PEP_NONE&&(attentionOf?attentionOf('PEP_TYPE',p.pep_type):true)){
  if(!p.pep_role)m.push({key:'pep_role',label:'PEP public role'});
  if(!p.pep_jurisdiction)m.push({key:'pep_jurisdiction',label:'PEP jurisdiction'});
 }
 if(!p.screening_status||p.screening_status==='Not screened')m.push({key:'screening_status',label:'Screening result'});
 else{
  if(!p.screening_list_source)m.push({key:'screening_list_source',label:'Screening list used'});
  if(!p.screening_list_date)m.push({key:'screening_list_date',label:'Screening list effective date'});
  if((p.screening_status==='Potential match'||p.screening_status==='Confirmed match')&&!p.screening_note)m.push({key:'screening_note',label:'Screening result note'});
 }
 if(!has('COUNTRY','Incorporation or residence'))m.push({key:'COUNTRY:Incorporation or residence',label:'Country of incorporation or residence'});
 if(!has('SOURCE_OF_FUNDS'))m.push({key:'SOURCE_OF_FUNDS',label:'Source of funds'});
 if(!has('SERVICE_ACTIVITY'))m.push({key:'SERVICE_ACTIVITY',label:'Services and AML-relevant activity'});
 return m;
}

// Items the MLRO should look at first. These are reasons to read the profile, not a rating.
export function attentionReasons({profile,selections,attentionOf}){
 const p=profile||{},out=[];
 if(p.pep_type&&p.pep_type!==PEP_NONE&&(attentionOf?attentionOf('PEP_TYPE',p.pep_type):true))out.push('PEP: '+p.pep_type);
 if(p.screening_status==='Potential match')out.push('Screening: potential match');
 if(p.screening_status==='Confirmed match')out.push('Screening: confirmed match');
 for(const s of selections||[])if(s.attention)out.push(`${s.category==='COUNTRY'?s.context+': ':''}${s.lookup_value}`);
 return out;
}

const today=()=>new Date(Date.now()+3*3600000).toISOString().slice(0,10);
export function profileStatus({profile,missing=[],eddApproved=false,eddNeeded=false,now=today()}){
 if(!profile)return {code:'INFO_NEEDED',label:'Information needed',next:'Start the profile: staff record the client’s facts and refer it to the MLRO.'};
 const p=profile;
 if(p.stage==='Staff review'&&p.edd_required)return {code:'EDD_REQUIRED',label:'EDD required',next:'The MLRO asked for enhanced due diligence. Add the evidence asked for, then refer the profile again.'};
 if(p.stage==='Decided'){
  if(p.decision==='Decline')return {code:'DECLINED',label:'Declined',next:'The MLRO declined this relationship.'};
  if(p.decision==='Restrict')return {code:'RESTRICTED',label:'Restricted',next:'The MLRO restricted this relationship. See the conditions.'};
  if(!p.next_review||String(p.next_review).slice(0,10)<now)return {code:'REVIEW_DUE',label:'Review due',next:'The review date has passed. Staff refresh the profile and refer it to the MLRO.'};
  if(eddNeeded&&!eddApproved)return {code:'EDD_REQUIRED',label:'EDD required',next:'Enhanced due diligence has not been approved yet. The MLRO or an Engagement Partner approves it after the KYC file is verified.'};
  return p.decision==='Accept with conditions'?{code:'APPROVED_COND',label:'Approved with conditions',next:'Approved by the MLRO subject to the conditions recorded.'}:{code:'APPROVED',label:'Approved',next:'Approved by the MLRO.'};
 }
 if(p.stage==='MLRO review')return p.edd_required?{code:'EDD_REQUIRED',label:'EDD required',next:'The MLRO asked for enhanced due diligence. Staff add the evidence and the MLRO decides.'}:{code:'MLRO_REVIEW',label:'MLRO review',next:'Waiting for the MLRO.'};
 return missing.length?{code:'INFO_NEEDED',label:'Information needed',next:`${missing.length} item${missing.length===1?'':'s'} still needed before the profile can go to the MLRO.`}:{code:'STAFF_REVIEW',label:'Staff review',next:'Everything is filled. Check it, then refer it to the MLRO.'};
}

// The MLRO's decision. Rating and reasons are always required; conditions for a conditional or restricted outcome; a review date for an acceptance.
export function cleanDecision(input,{needsEdd=false,now=today()}={}){
 const errors=[],v={};
 if(!DECISIONS.includes(input.decision))errors.push({key:'decision',error:'Choose the decision.'});else v.decision=input.decision;
 if(!RATINGS.includes(input.risk_rating))errors.push({key:'risk_rating',error:'Choose the risk rating.'});else v.risk_rating=input.risk_rating;
 const reasons=clip(input.risk_reasons,2000);if(!reasons||reasons.length<10)errors.push({key:'risk_reasons',error:'Record the reasons for the rating (at least 10 characters).'});else v.risk_reasons=reasons;
 for(const [k,max] of [['mitigating_controls',2000],['risk_override_reason',1000],['decision_reason',1000],['review_reason',500]]){const s=clip(input[k]||'',max);if(s===null)errors.push({key:k,error:'Too long.'});else v[k]=s||null;}
 const cond=clip(input.decision_conditions||'',2000);
 if((v.decision==='Accept with conditions'||v.decision==='Restrict')&&(!cond||cond.length<10))errors.push({key:'decision_conditions',error:'State the conditions or restrictions (at least 10 characters).'});else v.decision_conditions=cond||null;
 if((v.decision==='Restrict'||v.decision==='Decline')&&!v.decision_reason)errors.push({key:'decision_reason',error:'Say why.'});
 const nr=isoDate(input.next_review);
 if(v.decision==='Accept'||v.decision==='Accept with conditions'){if(!nr||nr<=now)errors.push({key:'next_review',error:'Choose a future review date.'});else v.next_review=nr;}else v.next_review=nr||null;
 const edd=clip(input.edd_note||'',2000);if(edd===null)errors.push({key:'edd_note',error:'Too long.'});else v.edd_note=edd||null;
 if(needsEdd&&(v.decision==='Accept'||v.decision==='Accept with conditions')&&(!edd||edd.length<20))errors.push({key:'edd_note',error:'Record the enhanced due diligence you carried out (at least 20 characters).'});
 return {ok:!errors.length,value:v,errors};
}

// Who and what the MLRO sees first.
export function queueOrder(item){
 const rank={EDD_REQUIRED:0,MLRO_REVIEW:1,REVIEW_DUE:2};return (rank[item.status_code]??9)*10+(item.attention&&item.attention.length?0:5);
}

// Build 2856: the MLRO's rule for one service. The MLRO chooses whether AML questions or an MLRO referral apply and which AML-relevant activities
// (from the MLRO's own activity list) the service usually involves. Nothing is assumed for a service the MLRO has not decided.
export const APPLICABILITY=['Not relevant','Ask AML questions','Refer to the MLRO'];
export function cleanServiceRule(input,{activityValues=[]}={}){
 const errors=[],v={};
 if(!APPLICABILITY.includes(input?.applicability))errors.push({key:'applicability',error:'Choose whether AML applies to this service.'});else v.applicability=input.applicability;
 const reason=clip(input?.reason,500);if(!reason||reason.length<5)errors.push({key:'reason',error:'Record the reason (at least 5 characters).'});else v.reason=reason;
 const source=clip(input?.source,300);if(!source||source.length<3)errors.push({key:'source',error:'Say where this comes from (a source or reference).'});else v.source=source;
 const eff=isoDate(input?.effective_from);if(eff===null)errors.push({key:'effective_from',error:'The effective date is not a valid date.'});else v.effective_from=eff||null;
 const want=Array.isArray(input?.activities)?input.activities:[];const have=new Map(activityValues.map(x=>[String(x).toLowerCase(),x]));const acts=[];
 for(const a of want){const hit=have.get(String(a||'').trim().toLowerCase());if(!hit){errors.push({key:'activities',error:`${String(a||'').slice(0,60)||'This value'} is not on the MLRO's current services and activity list.`});continue;}if(!acts.includes(hit))acts.push(hit);}
 v.activities=acts;
 if(v.applicability==='Not relevant'&&acts.length)errors.push({key:'activities',error:'A service marked Not relevant cannot list AML-relevant activities.'});
 return {ok:!errors.length,value:v,errors};
}
// What staff see when they set a service up. A service with no rule says the MLRO has not decided; it is never read as "not relevant".
export function serviceScope(rule,{profileCode=null}={}){
 if(!rule)return {code:'UNDECIDED',needs_flag:false,line:'The MLRO has not decided whether POCAMLA applies to this service. It is not treated as exempt.'};
 if(rule.applicability==='Not relevant')return {code:'NOT_RELEVANT',needs_flag:false,line:'The MLRO has marked this service as not relevant to POCAMLA.'};
 const cleared=['APPROVED','APPROVED_COND'].includes(profileCode);
 const base=rule.applicability==='Refer to the MLRO'?'The MLRO has asked to be told when this service is set up.':'The MLRO asks the AML questions for this service.';
 return {code:rule.applicability==='Refer to the MLRO'?'REFER':'ASK',needs_flag:true,cleared,line:base+(cleared?' The client’s AML profile is already approved.':' The client’s AML profile is not approved yet, so this set-up goes to the MLRO queue.')};
}

// Build 2866: suggestions for the client's AML profile, drawn only from facts the firm already holds. A suggestion is never saved by itself: staff read the basis,
// accept it, and save the draft, so the profile stays a record staff attest to. Nothing is suggested for source of funds, source of wealth, risk indicators,
// PEP status, screening or counterparties: nothing we hold answers those.
const sameText=(a,b)=>String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();
const longDate=iso=>{const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));return m?`${Number(m[3])} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2])-1]} ${m[1]}`:'';};
const joinNames=n=>n.length<=1?n.join(''):n.slice(0,-1).join(', ')+' and '+n[n.length-1];
export function amlSuggestions({clientName='',facts=[],services=[],lookups=[],profile=null,selections=[],engagementDate=null}={}){
 const out={text:[],picks:[]};
 const live=facts.filter(f=>f&&f.status!=='Superseded');
 const fact=k=>live.find(f=>f.field_key===k&&String(f.value||'').trim());
 const lookup=(cat,v)=>lookups.find(l=>l.category===cat&&l.status!=='Ended'&&sameText(l.value,v));
 const have=(cat,ctx,v)=>selections.some(s=>s.category===cat&&String(s.context||'')===String(ctx||'')&&sameText(s.lookup_value??s.value,v));
 // Purpose of the relationship: the services set up, and the engagement date when a scope is recorded.
 const names=[...new Set(services.map(s=>String(s.service_name||'').trim()).filter(Boolean))];
 if(!String(profile?.purpose_of_relationship||'').trim()&&names.length){
  const since=engagementDate?` from ${longDate(engagementDate)}`:'';
  out.text.push({key:'purpose_of_relationship',value:`To provide ${joinNames(names)} to ${String(clientName).trim()||'the client'}${since}.`,
   basis:`Built from the services set up for this client${engagementDate?' and the engagement date on record':''}. Edit it so it says why the client is with the firm.`});
 }
 // Services and AML-relevant activity: the activities the MLRO attached to the rule of each service this client has.
 for(const s of services){
  if(!['Ask AML questions','Refer to the MLRO'].includes(s.applicability))continue;
  for(const act of s.activities||[]){
   const hit=lookup('SERVICE_ACTIVITY',act);if(!hit||have('SERVICE_ACTIVITY','',hit.value)||out.picks.some(p=>p.category==='SERVICE_ACTIVITY'&&sameText(p.value,hit.value)))continue;
   out.picks.push({category:'SERVICE_ACTIVITY',context:'',value:hit.value,doc_ref:'',basis:`The MLRO’s rule for ${s.service_name} lists this activity.`});
  }
 }
 // Geography. A registration number or a county is not proof of the country, so each is offered as a suggestion with its basis and its document.
 const kenya=lookup('COUNTRY','Kenya');
 if(kenya){
  const reg=fact('registration_number'),county=fact('county');
  if(reg&&!have('COUNTRY','Incorporation or residence',kenya.value))out.picks.push({category:'COUNTRY',context:'Incorporation or residence',value:kenya.value,doc_ref:reg.doc_ref||'',basis:`A registration number is recorded (${reg.value}). Confirm the country of registration on the certificate.`});
  if(county&&!have('COUNTRY','Business operations',kenya.value))out.picks.push({category:'COUNTRY',context:'Business operations',value:kenya.value,doc_ref:county.doc_ref||'',basis:`A Kenyan county is recorded for the client’s premises (${county.value}).`});
 }
 return out;
}
