// Client-type templates (build 2810). Pure rules. A template decides which facts, evidence, people and regulator details a client file asks for.
// It never decides a service. Nothing here confirms anything: a fact is confirmed only by its own verification, evidence only on a verified KYC file,
// and a person or licence only when it is on record. A missing template is shown as missing, never guessed.
import {readiness,fieldFor} from './client-master-rules.mjs';

// Which template a legal structure belongs to. A named subtype wins over '*'.
export function templateFor(structure,subtype,mapRows){
 if(!structure)return null;
 const rows=(mapRows||[]).filter(r=>r.structure===structure);
 const hit=rows.find(r=>subtype&&r.subtype===subtype)||rows.find(r=>r.subtype==='*');
 return hit?hit.template_code:null;
}
const today=()=>new Date().toISOString().slice(0,10);
const live=(e,on)=>!e.expires_on||String(e.expires_on).slice(0,10)>=on;

// requirements: legal_structure_requirements rows for this structure ('*' rows and named-subtype rows; the named row wins per rule_code).
export function evidenceRequirements(subtype,rows){
 const by=new Map();
 for(const r of rows||[]){if(r.subtype==='*'&&!by.has(r.rule_code))by.set(r.rule_code,r);}
 for(const r of rows||[]){if(subtype&&r.subtype===subtype)by.set(r.rule_code,r);}
 return [...by.values()].sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)||String(a.rule_code).localeCompare(String(b.rule_code)));
}

// Everything one client's file asks for under its template, with the state of each line. ready is true only when every Required line is confirmed.
export function templateChecklist({template,fields,facts,master,requirements,ruleLabels,evidence,kycVerified,parties,partyRules,licenceExpectations,licences,restricted,on}){
 const now=on||today();
 const reqDefs=(fields||[]).filter(f=>f.requirement==='Required').map(f=>fieldFor(f.field_key)).filter(Boolean);
 const optional=(fields||[]).filter(f=>f.requirement!=='Required');
 const base=readiness({entityType:null,facts,master,required:reqDefs,templateKnown:!!template});
 // If applicable facts are listed with their state but never count.
 for(const f of optional){const def=fieldFor(f.field_key);if(!def)continue;
  const fact=(facts||[]).find(x=>x.field_key===f.field_key&&x.status!=='Superseded');
  const i=base.rows.findIndex(r=>r.key===f.field_key);
  if(i>=0){base.rows[i].optional=true;base.rows[i].extra=false;if(base.rows[i].issue&&/Not required/.test(base.rows[i].issue))base.rows[i].issue=null;}
  else base.rows.push({key:f.field_key,label:def.label,hint:def.hint,state:fact?fact.status:'Missing',optional:true,issue:null,fact:fact?{fact_id:fact.fact_id,value:fact.value,source_kind:fact.source_kind,status:fact.status,revision:fact.revision}:null});}
 const exceptions=[...base.exceptions];
 // The KYC file (evidence, people, licences) is kept for Managers and Partners. Others see the lines but not their state, and cannot call the file ready.
 const evRows=[];
 if(restricted){
  const hide=(key,label,requirement,note)=>({key,label,requirement,note:note||'',state:'Not visible',restricted:true,issue:'Kept by Managers and Partners.'});
  return {facts:base.rows,evidence:(requirements||[]).map(r=>hide(r.rule_code,ruleLabels?.[r.rule_code]||r.rule_code,r.requirement,r.note)),
   parties:(partyRules||[]).map(r=>hide('party:'+r.role,r.label,r.requirement)),licences:(licenceExpectations||[]).map(e=>hide('licence:'+e.type_code,e.label||e.type_code,'Required')),
   exceptions,facts_ready:base.ready,ready:false,restricted:true,counts:{facts:{required:base.required,verified:base.verified},evidence:{required:0,verified:0}}};
 }
 for(const r of requirements||[]){
  const items=(evidence||[]).filter(e=>e.document_type===r.rule_code&&live(e,now));
  const present=items.length>0;
  let state=!present?'Missing':kycVerified?'Verified':'Recorded';
  const issue=!present?(r.requirement==='Required'?'No evidence on the KYC file yet.':null):!kycVerified?'Recorded, but the KYC file has not been verified by a Manager or Partner.':null;
  evRows.push({key:r.rule_code,label:ruleLabels?.[r.rule_code]||r.rule_code,requirement:r.requirement,note:r.note||'',state,issue});
  if(r.requirement==='Required'&&state!=='Verified')exceptions.push({key:'evidence:'+r.rule_code,label:ruleLabels?.[r.rule_code]||r.rule_code,state,issue});
 }
 // People.
 const partyRows=[];
 for(const rule of partyRules||[]){
  const people=(parties||[]).filter(p=>p.role===rule.role&&!p.ceased_on);
  const have=people.length;
  let state=have<rule.min_count?'Missing':kycVerified?'Verified':'Recorded';
  let issue=have<rule.min_count?'Record at least '+rule.min_count+' on the KYC file.':!kycVerified?'Recorded, but the KYC file has not been verified.':null;
  if(rule.role==='Shareholder'&&have){const total=people.reduce((n,p)=>n+Number(p.shareholding_percentage||0),0);
   if(Math.abs(total-100)>0.0001){state='Differs';issue='Holdings add up to '+Math.round(total*10000)/10000+'%, not 100%.';}}
  partyRows.push({key:'party:'+rule.role,label:rule.label,requirement:rule.requirement,count:have,state,issue});
  if(rule.requirement==='Required'&&state!=='Verified')exceptions.push({key:'party:'+rule.role,label:rule.label,state,issue});
 }
 // Regulatory overlay: licences expected for this legal structure that are not on record.
 const licRows=[];
 for(const e of licenceExpectations||[]){
  const held=(licences||[]).some(l=>l.licence_type===e.type_code&&!l.ended_on&&String(l.expires_on).slice(0,10)>=now);
  licRows.push({key:'licence:'+e.type_code,label:e.label||e.type_code,state:held?'Recorded':'Missing',issue:held?null:'No current licence on record.'});
  if(!held)exceptions.push({key:'licence:'+e.type_code,label:e.label||e.type_code,state:'Missing',issue:'No current licence on record.'});
 }
 const facts_ready=base.ready;
 return {facts:base.rows,evidence:evRows,parties:partyRows,licences:licRows,exceptions,facts_ready,
  ready:!!template&&facts_ready&&exceptions.length===0,
  counts:{facts:{required:base.required,verified:base.verified},evidence:{required:evRows.filter(r=>r.requirement==='Required').length,verified:evRows.filter(r=>r.requirement==='Required'&&r.state==='Verified').length}}};
}
