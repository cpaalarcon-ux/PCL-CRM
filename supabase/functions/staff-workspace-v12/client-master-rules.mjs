// Client master (build 2807). Pure rules. Each key fact about a client is recorded with its source and then verified by a different person.
// Only exceptions need a person's attention: a missing fact, a fact waiting for verification, a fact backed only by the client's own statement,
// or a verified fact that no longer matches the client record. Nothing is guessed or copied in silently.
export const SOURCE_KINDS=['Document','Online register','Prior record','Import','Client statement'];
const COMPANY=['Limited company','Non-profit organisation','Foreign branch','Co-operative society'];
const REGISTERED=[...COMPANY,'Partnership','Other legal entity'];
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
];
export const fieldFor=key=>FIELDS.find(f=>f.key===key)||null;
export const requiredFor=entityType=>FIELDS.filter(f=>!f.entities||f.entities.includes(entityType));

// Clean a typed value and say what is wrong with it. Never "fixes" a value into something the person did not type, except trimming and upper-casing a PIN.
export function cleanValue(key,raw){
 const f=fieldFor(key);if(!f)return {ok:false,error:'This is not a field on the client master checklist.'};
 let v=String(raw??'').replace(/\s+/g,' ').trim();if(f.upper)v=v.toUpperCase();
 if(!v)return {ok:false,error:f.label+' is empty.'};
 if(v.length>500)return {ok:false,error:f.label+' is too long.'};
 if(!f.check(v))return {ok:false,error:'Check '+f.label.toLowerCase()+'. '+f.hint};
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
export function readiness({entityType,facts,master}){
 const live=new Map((facts||[]).filter(f=>f.status!=='Superseded').map(f=>[f.field_key,f]));
 const rows=[],exceptions=[];
 for(const f of requiredFor(entityType)){
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
 const known=!!entityType;
 if(!known)exceptions.unshift({key:'legal_entity_type',label:'Legal entity type',state:'Missing',issue:'Set the legal structure first; it decides which other facts are required.'});
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
