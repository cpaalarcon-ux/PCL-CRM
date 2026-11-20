// Client master (build 2807). Pure rules. Each key fact about a client is recorded with its source and then verified by a different person.
// Only exceptions need a person's attention: a missing fact, a fact waiting for verification, a fact backed only by the client's own statement,
// or a verified fact that no longer matches the client record. Nothing is guessed or copied in silently.
import {canonicalCounty,canonicalConstituency,locationProblem} from './kenya-locations.mjs';
export const SOURCE_KINDS=['Document','Online register','Prior record','Import','Client statement'];
const COMPANY=['Limited company','Non-profit organisation','Foreign branch','Co-operative society'];
const REGISTERED=[...COMPANY,'Partnership','Other legal entity'];
// A real calendar date written as YYYY-MM-DD.
const isoDate=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;const d=new Date(v+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v&&v>='1900-01-01';};
// Which facts the firm's set-up checklist asks for. The list is the firm's choice, kept here in one place; it asserts no legal requirement.
export const FIELDS=[
 {key:'company_name',label:'Registered name',entities:null,check:v=>v.length>=2,hint:'As on the registration or identity document.',master:'company_name'},
 {key:'kra_pin',label:'KRA PIN',entities:null,check:v=>/^[A-Z][0-9]{9}[A-Z]$/.test(v),hint:'One letter, nine digits, one letter.',master:'kra_pin',upper:true},
 {key:'registration_number',label:'Registration number',entities:REGISTERED,check:v=>v.length>=3,hint:'Company, society or business registration number.'},
 {key:'national_id',label:'ID or passport number',entities:['Sole proprietor'],check:v=>v.length>=5,hint:'Of the owner.'},
 {key:'incorporation_date',label:'Date of incorporation or registration',entities:COMPANY,check:v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v)),hint:'YYYY-MM-DD'},
 {key:'registered_address',label:'Registered address',entities:null,check:v=>v.length>=5,hint:'Physical or postal address of record.'},
 {key:'contact_person',label:'Main contact',entities:null,check:v=>v.length>=2,hint:'Who the firm deals with day to day.'},
 {key:'contact_phone',label:'Contact phone',entities:null,check:v=>/^\+?\d{9,13}$/.test(v.replace(/[\s-]/g,'')),hint:'Digits only, 9 to 13.'},
 {key:'contact_email',label:'Contact email',entities:null,check:v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),hint:'name@example.com'},
 {key:'year_end',label:'Financial year end',entities:null,check:v=>/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v),hint:'MM-DD, for example 12-31.'},
 // Facts asked for by the client-type templates (build 2810). entities:[] means the older entity-type list never asks for them; only a template does.
 {key:'business_name',label:'Business name',entities:[],check:v=>v.length>=2,hint:'The registered business name, if the business trades under one.'},
 {key:'business_details',label:'Business details',entities:[],check:v=>v.length>=5,hint:'What the business does and where.'},
 {key:'authority_basis',label:'Authority to act',entities:[],check:v=>v.length>=5,hint:'Who may sign for the client and on what authority (deed clause, resolution or letter of authority).'},
 {key:'registration_category',label:'Registration category',entities:[],check:v=>v.length>=2,hint:'For example NGO, CBO, PBO, trust or society, as registered.'},
 {key:'funder_regulatory_details',label:'Funder or regulatory details',entities:[],check:v=>v.length>=3,hint:'Main funders, or the regulator the entity reports to.'},
 {key:'regulator',label:'Regulator',entities:[],check:v=>v.length>=2,hint:'The authority that registers or supervises this entity.'},
 {key:'regulator_registration_number',label:'Regulator registration or licence number',entities:[],check:v=>v.length>=2,hint:'As issued by the regulator.'},
 // Facts asked for by the public sector, association, estate and other-entity templates (build 2812). Entered by hand and verified separately.
 {key:'establishing_instrument',label:'Establishing instrument',entities:[],check:v=>v.length>=5,hint:'The Act, charter, gazette notice or order that set the entity up, with its number or date.'},
 {key:'subtype_basis',label:'Basis for the subtype',entities:[],check:v=>v.length>=10,hint:'The provision of the establishing instrument that supports the subtype (for example public institution or state corporation). If neither fits, use Other registered entity and a Partner classifies it.'},
 {key:'mandate',label:'Mandate',entities:[],check:v=>v.length>=10,hint:'What the entity is set up to do, from its establishing instrument.'},
 {key:'accounting_officer',label:'Accounting officer',entities:[],check:v=>v.length>=3,hint:'Name and title of the accounting officer or head of the entity.'},
 {key:'authorised_signatories',label:'Authorised signatories',entities:[],check:v=>v.length>=3,hint:'Names and capacity of the people who may sign for the client.'},
 {key:'registration_status',label:'Registration status',entities:[],check:v=>/^(Unregistered|Registered (as|with) .{3,})/i.test(v),hint:'Start with "Unregistered", or "Registered as" or "Registered with", then the registrar, form and number.'},
 {key:'officials',label:'Officials',entities:[],check:v=>v.length>=5,hint:'Chairperson, secretary and treasurer, with ID numbers.'},
 {key:'deceased_name',label:'Name of the deceased',entities:[],check:v=>v.length>=3,hint:'As on the death certificate and the grant.'},
 {key:'deceased_id',label:'ID or passport number of the deceased',entities:[],check:v=>v.length>=5,hint:'As on the death certificate.'},
 {key:'date_of_death',label:'Date of death',entities:[],check:v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&v>='1900-01-01'&&v<=new Date().toISOString().slice(0,10),hint:'YYYY-MM-DD'},
 {key:'executor_name',label:'Executor or administrator',entities:[],check:v=>v.length>=3,hint:'The person the court appointed, as named in the grant.'},
 {key:'grant_details',label:'Grant or court order',entities:[],check:v=>v.length>=5,hint:'Type, number, court and date of the grant of probate, letters of administration or other court order.'},
 {key:'specific_legal_form',label:'Specific legal form',entities:[],check:v=>v.length>=3&&!/^(unknown|unidentified|not sure|n\/?a|tbc|tbd)$/i.test(v),hint:'The exact legal form as the documents show it. If it cannot be identified, leave this open: a Partner classifies it.'},
 {key:'registration_authority',label:'Registration authority',entities:[],check:v=>v.length>=3,hint:'Who registered the entity, for example a registrar, board or regulator.'},
 {key:'responsible_officers',label:'Responsible officers',entities:[],check:v=>v.length>=5,hint:'The people responsible for the entity, with their roles and ID numbers.'},
 // Facts on the KRA iTax taxpayer profile (build 2854). The set-up grid follows that page. entities:[] means only a client-type template asks for them.
 // Dates are stored as YYYY-MM-DD; the grid shows and accepts dd/mm/yyyy, as iTax does. A phone or email here is a fact about the client, never a login.
 {key:'commencement_date',label:'Business commencement date',entities:[],check:v=>isoDate(v),hint:'The date the business started trading, from the iTax profile or the registration papers.'},
 {key:'trading_name',label:'Trading or business name, if different from the registered name',entities:[],check:v=>v.length>=2,hint:'Leave empty when the business trades under its registered name.'},
 {key:'epz_effective_date',label:'EPZ effective date',entities:[],check:v=>isoDate(v),hint:'Only for an Export Processing Zone enterprise.'},
 {key:'sez_effective_date',label:'SEZ effective date',entities:[],check:v=>isoDate(v),hint:'Only for a Special Economic Zone enterprise.'},
 {key:'has_branches',label:'Does the business have any branches?',entities:[],check:v=>/^(Yes|No)$/.test(v),hint:'Yes or No, as on the iTax profile.'},
 {key:'legal_rep_declared',label:'Does the business declare a legal representative?',entities:[],check:v=>/^(Yes|No)$/.test(v),hint:'Yes or No, as on the iTax profile.'},
 {key:'legal_rep_pin',label:'Legal representative PIN',entities:[],check:v=>/^[A-Z][0-9]{9}[A-Z]$/.test(v),hint:'One letter, nine digits, one letter.',upper:true},
 {key:'nssf_number',label:'NSSF number',entities:[],check:v=>/^[A-Za-z0-9/-]{3,20}$/.test(v),hint:'Letters, digits, / and - only.'},
 {key:'lr_number',label:'LR number',entities:[],check:v=>v.length>=2,hint:'Land reference number of the premises, when there is one.'},
 {key:'building',label:'Building',entities:[],check:v=>v.length>=2,hint:'Building or estate name.'},
 {key:'street_road',label:'Street or road',entities:[],check:v=>v.length>=2,hint:'For example Mumias Road.'},
 {key:'city_town',label:'City or town',entities:[],check:v=>v.length>=2,hint:'For example Bungoma.'},
 {key:'county',label:'County',entities:[],check:v=>!!canonicalCounty(v),hint:'One of the 47 counties on the IEBC list.'},
 {key:'district',label:'Constituency (sub-county)',entities:[],check:v=>v.length>=2,hint:'A constituency of the county, from the IEBC list. The iTax profile calls it the district.'},
 {key:'locality',label:'Tax area or locality',entities:[],check:v=>v.length>=2,hint:'As on the iTax profile.'},
 {key:'descriptive_address',label:'Descriptive address',entities:[],check:v=>v.length>=2,hint:'A line that helps someone find the premises.'},
 {key:'postal_code',label:'Postal code',entities:[],check:v=>/^\d{3,6}$/.test(v),hint:'Digits only, for example 50200.'},
 {key:'po_box',label:'P.O. Box',entities:[],check:v=>/^[A-Za-z0-9 /.-]{1,30}$/.test(v),hint:'The box number, or None when the client has no box.'},
 {key:'postal_town',label:'Postal town',entities:[],check:v=>v.length>=2,hint:'Town of the post office.'},
 {key:'telephone',label:'Telephone number',entities:[],check:v=>/^\+?\d{9,13}$/.test(v.replace(/[\s-]/g,'')),hint:'Digits only, 9 to 13.'},
 {key:'mobile_2',label:'Mobile number (2)',entities:[],check:v=>/^\+?\d{9,13}$/.test(v.replace(/[\s-]/g,'')),hint:'Digits only, 9 to 13.'},
 {key:'mobile_3',label:'Mobile number (3)',entities:[],check:v=>/^\+?\d{9,13}$/.test(v.replace(/[\s-]/g,'')),hint:'Digits only, 9 to 13.'},
 {key:'secondary_email',label:'Secondary email address',entities:[],check:v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),hint:'name@example.com'},
 {key:'website',label:'Website',entities:[],check:v=>/^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(v),hint:'For example www.example.co.ke'},
];
export const fieldFor=key=>FIELDS.find(f=>f.key===key)||null;
export const requiredFor=entityType=>FIELDS.filter(f=>!f.entities||f.entities.includes(entityType));

// Clean a typed value and say what is wrong with it. Never "fixes" a value into something the person did not type, except trimming and upper-casing a PIN.
// ctx.county: the county this client has (recorded or in the same save). A constituency is accepted only when it belongs to that county; both are stored under
// their listed names, so the same place is never written two ways.
export function cleanValue(key,raw,ctx={}){
 const f=fieldFor(key);if(!f)return {ok:false,error:'This is not a field on the client master checklist.'};
 let v=String(raw??'').replace(/\s+/g,' ').trim();if(f.upper)v=v.toUpperCase();
 if(!v)return {ok:false,error:f.label+' is empty.'};
 if(v.length>500)return {ok:false,error:f.label+' is too long.'};
 if(!f.check(v))return {ok:false,error:'Check '+f.label.toLowerCase()+'. '+f.hint};
 if(key==='county')return {ok:true,value:canonicalCounty(v)};
 if(key==='district'){const bad=locationProblem(ctx?.county,v);if(bad)return {ok:false,error:bad};return {ok:true,value:canonicalConstituency(ctx.county,v)};}
 return {ok:true,value:v};
}
// A source is complete when it names something a reviewer can open or look up.
export function sourceProblem({source_kind,document_id,source_reference}){
 if(!SOURCE_KINDS.includes(source_kind))return 'Choose where this came from.';
 if(source_kind==='Document'&&!document_id)return 'Choose the uploaded document this came from.';
 if(['Online register','Prior record','Import'].includes(source_kind)&&!String(source_reference||'').trim())return 'Say which register, record or import file this came from.';
 return null;
}
export const canVerify=(fact,me)=>!!fact&&!!me&&fact.status==='Recorded'&&['PARTNER','MANAGER','SUPERVISOR'].includes(me.category_code)&&fact.recorded_by!==me.staff_id&&fact.source_kind!=='Client statement';
export const canRecord=me=>!!me&&!['INTERN','ADMIN'].includes(me.category_code);

// One row per required fact, plus any extra live fact. master: values already on the client record, for the comparison.
// required: optional list of field definitions (from a client-type template). Without it the older entity-type list applies.
export function readiness({entityType,facts,master,required:requiredFields,templateKnown,unknownIssue}){
 const live=new Map((facts||[]).filter(f=>f.status!=='Superseded').map(f=>[f.field_key,f]));
 const rows=[],exceptions=[];
 for(const f of (requiredFields||requiredFor(entityType))){
  const fact=live.get(f.key)||null;let state='Missing',issue=null;
  if(fact){
   state=fact.status;
   const m=f.master?String(master?.[f.master]??'').trim():'';
   if(f.master&&m&&m.toLowerCase()!==String(fact.value).toLowerCase()){state='Differs';issue='The client record says "'+m+'", the '+(fact.status==='Verified'?'verified':'recorded')+' fact says "'+fact.value+'". Correct one of them.';}
   else if(fact.status==='Recorded'&&fact.source_kind==='Client statement')issue='Only the client\'s own statement. Get a document or register check, then record it again with that source.';
   else if(fact.status==='Recorded')issue='Waiting for a different Supervisor, Manager or Partner to verify it against its source.';
  }else issue='Not recorded yet.';
  const row={key:f.key,label:f.label,hint:f.hint,state,issue,fact:fact?{fact_id:fact.fact_id,value:fact.value,source_kind:fact.source_kind,document_id:fact.document_id,source_reference:fact.source_reference,status:fact.status,recorded_by:fact.recorded_by,recorded_at:fact.recorded_at,verified_by:fact.verified_by,verified_at:fact.verified_at,revision:fact.revision}:null};
  rows.push(row);if(state!=='Verified')exceptions.push({key:f.key,label:f.label,state,issue});
 }
 const verified=rows.filter(r=>r.state==='Verified').length,required=rows.length;
 // Facts recorded for something the checklist does not require for this entity type (for example imported ones) are still shown, but never count.
 for(const [k,fact] of live){if(rows.some(r=>r.key===k))continue;const f=fieldFor(k);if(!f)continue;
  rows.push({key:k,label:f.label,hint:f.hint,state:fact.status,extra:true,issue:fact.status==='Recorded'?'Not required for this entity type. Kept for reference.':null,fact:{fact_id:fact.fact_id,value:fact.value,source_kind:fact.source_kind,document_id:fact.document_id,source_reference:fact.source_reference,status:fact.status,recorded_by:fact.recorded_by,recorded_at:fact.recorded_at,verified_by:fact.verified_by,verified_at:fact.verified_at,revision:fact.revision}});}
 // Without a legal entity type the entity-specific facts are unknown, so the client cannot be called ready.
 const known=templateKnown!==undefined?!!templateKnown:!!entityType;
 if(!known)exceptions.unshift({key:'legal_entity_type',label:'Legal entity type',state:'Missing',issue:unknownIssue||'Set the legal structure first; it decides which other facts are required.'});
 return {rows,exceptions,required,verified,ready:known&&required>0&&verified===required,percent:required?Math.round(verified*100/required):0};
}
// Elapsed time between two moments, in whole minutes. This is elapsed time, not effort: it includes waiting for the client and for the verifier.
export function elapsedMinutes(from,to){const a=Date.parse(from),b=Date.parse(to);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?Math.round((b-a)/60000):null;}
// rows: [{client_id,started_at,ready_at}] baseline: minutes the firm used to take (optional). Returns averages and the reduction against the baseline.
export function setupReport(rows,baseline){
 const done=(rows||[]).map(r=>({...r,minutes:r.ready_at?elapsedMinutes(r.started_at,r.ready_at):null})).filter(r=>r.minutes!==null);
 const avg=done.length?Math.round(done.reduce((n,r)=>n+r.minutes,0)/done.length):null,b=Number(baseline);
 return {clients_started:(rows||[]).length,clients_ready:done.length,average_minutes:avg,baseline_minutes:Number.isFinite(b)&&b>0?b:null,reduction_percent:avg!==null&&Number.isFinite(b)&&b>0?Math.round((b-avg)*100/b):null,note:'Elapsed time from the first recorded fact to the last verification. It includes waiting for the client and the verifier, so compare it with the same measure taken the old way.'};
}
