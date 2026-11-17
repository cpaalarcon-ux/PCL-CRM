// Build 2867: "Understanding the Client". Pure rules. The narrative is a fixed set of sections written in the firm's own words.
// Nothing here is drawn from a register or guessed: staff write each section, a different Manager or Partner approves it, and the Permanent File PDF only repeats what was recorded.
export const SECTIONS=[
 {key:'nature_of_business',label:'Nature of the business',hint:'What the client does, how it earns income, where it operates and since when.',required:true},
 {key:'ownership_governance',label:'Ownership and governance',hint:'Who owns and controls the client, who the directors, partners or officers are, and who gives the firm instructions.',required:true},
 {key:'operating_environment',label:'Regulators, licences and operating environment',hint:'Licences held, the regulators the client answers to, and anything about its industry that affects the work.',required:true},
 {key:'customers_suppliers',label:'Customers, suppliers and banking',hint:'Main customers and suppliers, how it is paid and pays, and the banks it uses.',required:true},
 {key:'records_systems',label:'Records and systems',hint:'How the books are kept, what software or eTIMS set-up is used, who prepares the source records and how they reach the firm.',required:true},
 {key:'matters_to_know',label:'Matters the team should know',hint:'Anything else a new team member should know before touching this file. Optional.',required:false}
];
export const MIN_CHARS=20,MAX_CHARS=4000;
export const SECTION_KEYS=SECTIONS.map(s=>s.key);
// A saved draft may be incomplete; submitting needs every required section.
export function cleanSections(raw){
 const out={},bad=[];
 for(const s of SECTIONS){
  const v=String((raw||{})[s.key]??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
  if(v.length>MAX_CHARS)bad.push(`"${s.label}" is longer than ${MAX_CHARS} characters.`);
  if(v)out[s.key]=v;
 }
 return {sections:out,problems:bad};
}
export function missingSections(sections){
 return SECTIONS.filter(s=>s.required&&String((sections||{})[s.key]||'').trim().length<MIN_CHARS).map(s=>s.label);
}
// Who may do what. Preparing needs a Supervisor, Manager or Partner; review needs a Manager or Partner who did not prepare or submit it, unless they are the sole active Partner.
export const canPrepare=cat=>['SUPERVISOR','MANAGER','PARTNER'].includes(cat);
export const canFile=cat=>['MANAGER','PARTNER'].includes(cat);
export function reviewProblem({row,staffId,category,soleActivePartner}){
 if(!row||row.status!=='Submitted')return 'Only a submitted version is reviewed.';
 if(!['MANAGER','PARTNER'].includes(category))return 'A Manager or Partner reviews the understanding of the client.';
 const same=row.prepared_by===staffId||row.submitted_by===staffId;
 if(same&&!(category==='PARTNER'&&soleActivePartner))return 'A different Manager or Partner reviews this. The preparer cannot approve their own work.';
 return null;
}
// What the screen shows: the version that counts, the draft in progress, and whether the Permanent File on record still matches.
export function understandingState({rows,issues,digest}){
 const approved=rows.find(r=>r.status==='Approved')||null,open=rows.find(r=>['Draft','Submitted'].includes(r.status))||null;
 const last=issues[0]||null;
 let file='none';
 if(last){file=(last.facts_digest===digest&&approved&&last.understanding_id===approved.understanding_id)?'current':'out_of_date';}
 return {approved,open,last_issue:last,file,can_file:!!approved};
}
// The fingerprint covers exactly what the PDF repeats about the facts: the live KYC facts, the approved narrative version and the AML profile stage and decision.
export function digestInput({facts,understanding,aml}){
 return JSON.stringify({f:[...facts].map(x=>[x.field_key,x.value,x.status,x.source_kind,x.source_reference||''] ).sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0),u:understanding?[understanding.understanding_id,understanding.version]:null,a:aml?[aml.stage||'',aml.decision||'',aml.risk_rating||'',aml.next_review||'']:null});
}
export const prettyKey=k=>String(k||'').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
// Lines of the PDF's facts section, grouped by what the fact came from.
export function factRows(facts,fieldFor){
 return [...facts].map(f=>({key:f.field_key,label:(fieldFor(f.field_key)?.label)||prettyKey(f.field_key),value:f.value,status:f.status,source:f.source_kind+(f.doc_ref?` (${f.doc_ref})`:f.source_reference?` (${f.source_reference})`:''),verified_by:f.verified_by_name||null,verified_on:f.verified_at?String(f.verified_at).slice(0,10):null}))
  .sort((a,b)=>a.label.localeCompare(b.label));
}
