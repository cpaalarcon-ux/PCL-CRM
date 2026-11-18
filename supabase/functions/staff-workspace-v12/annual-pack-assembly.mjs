// The assembled annual pack (build 2885). Pure: no database, no file reading. One model feeds the PDF and the workbook so the two always agree.
// Order: cover, entity information, report, statement of responsibilities, key figures, the auditor's report, the statements, then one numbered note sequence.
// Nothing is invented: a page or note that is not ready is shown as "Not ready" with the reason, never filled in. The status word and the watermark follow the rules below, and
// "Audited" is used only when the audit lock is live, still matches the figures and notes, and every other check passes.
// No imports: this module is loaded by code that annual-pack-rules also loads.
export const STATUS_WORDS=['Draft','Management draft','Subject to audit','Audited'];
export const ASSEMBLY_VERSION='pack-assembly-v1';
// gate: annualGate() result ({ready,ready_for_review,checks}). audit: auditState() result ({locked,stale,required,status}).
// Draft: the pack is not ready for review. Management draft: ready for review and no audit is required for the year. Subject to audit: ready for review, an audit is required and not locked.
// Audited: every check passes and the audit lock is live and current.
export function statusWord({gate,audit}){
 if(gate&&gate.ready&&audit&&audit.locked&&!audit.stale)return 'Audited';
 if(!gate||!gate.ready_for_review)return 'Draft';
 if(audit&&audit.required&&!audit.locked)return 'Subject to audit';
 return 'Management draft';
}
export const watermarkFor=word=>word==='Audited'?null:word.toUpperCase();
// The open checks, named, so a reader of a draft sees why it is a draft.
export const openChecks=gate=>((gate&&gate.checks)||[]).filter(c=>!c.ok).map(c=>c.label);

const LEAD=[['General information','General information'],['Basis of preparation','Basis of preparation'],['Accounting policies','Significant accounting policies']];
// The note sequence. System notes keep the numbers a Partner approved and are shifted by one number for each leading wording note, so a single sequence runs through the pack:
// leading wording notes (1..k), the system notes (k+1..k+n), then each other disclosure. The shift is shown, never hidden.
export function buildNoteSequence({wordingSections=[],systemNotes=[]}){
 const items=[],lead=[];
 for(const [group,title] of LEAD){
  const sec=wordingSections.filter(s=>s.group===group);
  if(sec.length)lead.push({title,sections:sec});
 }
 const offset=lead.length;
 lead.forEach((n,i)=>items.push({number:i+1,kind:'wording',title:n.title,sections:n.sections.map(s=>({key:s.key,title:s.title,text:s.text}))}));
 for(const n of systemNotes)items.push({number:n.number+offset,system_number:n.number,kind:'system',title:n.title,note:n});
 let next=offset+systemNotes.length+1;
 for(const s of wordingSections.filter(x=>x.group==='Other disclosures'))items.push({number:next++,kind:'disclosure',title:s.title,sections:[{key:s.key,title:null,text:s.text}]});
 const stray=wordingSections.filter(s=>!['General information','Basis of preparation','Accounting policies','Other disclosures'].includes(s.group));
 return {items,offset,problems:stray.length?[`Wording sections with no place in the notes: ${stray.map(s=>s.title).join(', ')}.`]:[]};
}
const money=(v,unit)=>v===null||v===undefined?'Not available':(v<0?'('+Math.abs(v).toLocaleString('en-KE',{maximumFractionDigits:0})+')':Number(v).toLocaleString('en-KE',{maximumFractionDigits:0}));
const day=d=>String(d||'').slice(0,10);
const notReady=(title,problems)=>({title,blocks:[{type:'text',text:'Not ready. '+(problems&&problems.length?problems.join(' '):'See the open checks.')}],ready:false});

function statementBlock(blk,{offset,hasPriorLabel='Prior year',yearLabel}){
 const rows=(blk.rows||[]).map(r=>({kind:r.kind,label:r.label,note:r.note?r.note+offset:null,current:r.kind==='heading'?null:r.current??null,prior:r.kind==='heading'?null:(blk.has_prior?(r.prior??null):null)}));
 return {type:'statement',columns:[yearLabel,...(blk.has_prior?[hasPriorLabel]:[])],has_prior:!!blk.has_prior,rows};
}
// input: {client,reporting,statements (built, with .notes),wording ({sections,problems}),pages (buildClientPages result),gate,audit,lock,asOf,attachment}
//  lock: the live audit lock view or null. attachment: {document_id,file_name,sha256,verified:boolean}|null for an external auditor's report.
export function assemblePack({client,reporting,statements,wording,pages,gate,audit,lock,asOf,attachment=null}){
 const S=statements||{},problems=[];
 // An external audit counts as audited only when the signed report could be attached exactly as the lock recorded it.
 const unattached=!!(lock&&lock.mode==='External audit'&&!(attachment&&attachment.verified));
 const word=statusWord({gate,audit:unattached&&audit?{...audit,locked:false}:audit});
 const yearEnd=S.period?.ends_on||asOf,yearLabel=`Year ended ${yearEnd}`,unit=S.presentation?.unit_label||'KES';
 const seq=buildNoteSequence({wordingSections:wording?.sections||[],systemNotes:S.notes?.items||[]});problems.push(...seq.problems);
 const sections=[];
 // front pages
 const byCode=new Map(((pages&&pages.pages)||[]).map(p=>[p.code,p]));
 for(const code of ['COVER','ENTITY_INFO','REPORT','RESPONSIBILITIES','STATISTICS']){
  const p=byCode.get(code);
  if(!p){sections.push({code,...notReady(code,['This page has not been built.'])});problems.push(`${code} has not been built.`);continue;}
  if(p.state==='Not ready'){sections.push({code,...notReady(p.title,p.problems)});problems.push(...p.problems.map(m=>`${p.title}: ${m}`));continue;}
  sections.push({code,title:p.title,ready:true,blocks:p.blocks});
 }
 // the auditor's report
 if(lock){
  const b=[{type:'lines',lines:[['Audit',lock.mode],['Report reference',lock.report_reference],['Report date',day(lock.report_date)],['Opinion',lock.opinion],...(lock.auditor_name?[['Auditor',lock.auditor_name]]:[]),['Locked by',lock.locked_name||''],['Locked on',day(lock.locked_at)]]}];
  if(lock.mode==='External audit'){
   if(attachment&&attachment.verified)b.push({type:'text',text:`The signed report of the auditor (${attachment.file_name}) follows this page, exactly as signed.`});
   else{b.push({type:'text',text:'The signed report of the auditor could not be attached: '+(attachment&&attachment.reason||'the file is missing or does not match the fingerprint recorded when the pack was locked.')});problems.push('The signed auditor’s report could not be attached.');}
  }else b.push({type:'text',text:'The in-house audit is recorded in the audit file for this year. The signed report is held with that file; its reference, date and opinion are shown above.'});
  sections.push({code:'AUDITOR',title:'Report of the independent auditor',ready:true,blocks:b,attachment:lock.mode==='External audit'&&attachment&&attachment.verified?attachment:null});
 }else if(audit&&audit.required)sections.push({code:'AUDITOR',title:'Report of the independent auditor',ready:false,blocks:[{type:'text',text:'Not available. The audit is not complete and the pack is not locked: '+(audit.label||'')+'.'}]});
 // statements
 if(S.profit_or_loss)sections.push({code:'PL',title:S.profit_or_loss.title,ready:true,blocks:[statementBlock(S.profit_or_loss,{offset:seq.offset,yearLabel})]});
 if(S.financial_position)sections.push({code:'SFP',title:S.financial_position.title,ready:true,blocks:[statementBlock(S.financial_position,{offset:seq.offset,yearLabel})]});
 if(S.changes_in_equity){
  const blocks=[];
  for(const [label,blk] of [[yearLabel,S.changes_in_equity.current],['Prior year',S.changes_in_equity.prior]])if(blk)blocks.push({type:'heading',text:label},{type:'matrix',columns:[...blk.columns.map(c=>c.label),'Total'],rows:blk.rows.map(r=>({label:r.label,cells:[...blk.columns.map(c=>r.cells[c.code]??0),r.total]}))});
  sections.push({code:'SCE',title:S.changes_in_equity.title,ready:true,blocks});
 }
 if(S.cash_flow)sections.push({code:'SCF',title:S.cash_flow.title,ready:true,blocks:[statementBlock(S.cash_flow,{offset:seq.offset,yearLabel})]});
 if(S.partner_allocation){const A=S.partner_allocation;sections.push({code:'ALLOC',title:A.title,ready:true,blocks:[{type:'matrix',columns:['Share of profit and loss',`Amount (${A.unit_label})`],rows:[...A.rows.map(r=>({label:r.partner_name,cells:[`${r.percent}%`,r.amount]})),{label:'Profit for the year',cells:['100%',A.total]}]}]});}
 // notes: one numbered sequence
 const nb=[];
 for(const n of seq.items){
  nb.push({type:'heading',text:`${n.number}. ${n.title}`});
  if(n.kind==='system'){
   for(const sec of n.note.sections){
    nb.push({type:'matrix',columns:[`Year ended ${yearEnd}`,...(sec.prior!==null&&sec.prior!==undefined?['Prior year']:[])],caption:sec.label,rows:[...sec.accounts.map(a=>({label:`${a.code} ${a.name}`,cells:[a.amount,...(sec.prior!==null&&sec.prior!==undefined?['']:[])]})),...(sec.rounding?[{label:'Rounding',cells:[sec.rounding,...(sec.prior!==null&&sec.prior!==undefined?['']:[])]}]:[]),{label:'Total '+String(sec.label).toLowerCase(),cells:[sec.total,...(sec.prior!==null&&sec.prior!==undefined?[sec.prior]:[])],total:true}]});
   }
   if(n.note.schedule&&n.note.schedule.classes)nb.push({type:'schedule',schedule:n.note.schedule});
   // Supporting schedule (build 2886): printed only when a Manager or Partner has approved it; it is tied to the same trial balance figures as the note above it.
   if(n.note.support){const su=n.note.support;nb.push({type:'matrix',columns:[`Year ended ${yearEnd}`],caption:`Supporting schedule: ${su.title}`,rows:[...su.categories.flatMap(c=>[{label:c.category,cells:['']},...c.lines.map(l=>({label:`  ${l.description}${l.reference?' ('+l.reference+')':''}`,cells:[l.amount]})),...(c.rounding?[{label:'  Rounding',cells:[c.rounding]}]:[]),{label:`Total ${c.category.toLowerCase()}`,cells:[c.total],total:true}]),{label:'Total supporting schedule',cells:[su.total],total:true}]});}
  }else for(const s of n.sections){
   if(s.title)nb.push({type:'heading',text:s.title,minor:true});
   nb.push({type:'text',text:s.text===null||s.text===undefined?'Not ready. This wording is not approved.':s.text});
  }
 }
 if(nb.length)sections.push({code:'NOTES',title:S.notes?.title||'Notes to the financial statements',ready:true,blocks:nb});
 const checks=[...openChecks(gate),...(unattached?['The signed auditor\u2019s report could not be attached']:[])];
 return {version:ASSEMBLY_VERSION,client:{name:client?.name||'',kra_pin:client?.kra_pin||'',legal_form:client?.legal_form||null},reporting:reporting||{},as_of:asOf,year_end:yearEnd,unit,
  status:{word,watermark:watermarkFor(word),open_checks:checks,banner:word==='Audited'?'':`${word.toUpperCase()}. ${checks.length?'Open checks: '+checks.join('; ')+'.':'All checks pass except the audit.'}`},
  numbering:{leading_notes:seq.offset,system_notes:(S.notes?.items||[]).length,total_notes:seq.items.length,shift:seq.offset,note:seq.offset?`System note numbers are shifted by ${seq.offset} so the leading wording notes come first. The Partner’s approval is of the figures, which do not change.`:''},
  sections,note_index:seq.items.map(n=>({number:n.number,kind:n.kind,title:n.title,system_number:n.system_number??null})),attachments:sections.filter(s=>s.attachment).map(s=>s.attachment),problems:[...new Set(problems)],
  complete:sections.every(s=>s.ready)&&!problems.length};
}
export {money as formatMoney};
