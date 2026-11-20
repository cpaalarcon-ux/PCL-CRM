// Build 2835: Continue Setup (what is done, what is next, for a client already started) and the year rollover (what carries into a new draft year and what does not).
// Pure rules; the facts are read by client-year-rollover-actions.ts.
import {nextPeriod} from './engagement-rollover-rules.mjs';
export const REQUIRED_SECTIONS=['identity','registration','tax','ownership','activities','year_end','contacts'];
export const SECTION_LABEL={identity:'Identity',registration:'Registration',tax:'Tax',ownership:'Ownership',activities:'Activities',year_end:'Year-end',contacts:'Contacts'};
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
// The year the work is in: the one that contains today, otherwise the latest one that has ended, otherwise the earliest that has not started.
export function currentYear(periods,today){
 const ps=(periods||[]).map(p=>({...p,starts_on:day(p.starts_on),ends_on:day(p.ends_on)})).sort((a,b)=>a.starts_on.localeCompare(b.starts_on));
 return ps.find(p=>p.starts_on<=today&&p.ends_on>=today)||[...ps].reverse().find(p=>p.ends_on<today)||ps[0]||null;
}
// The five things that must be true before accounting entries can be relied on. Each failing check says what to do next and where.
export function readinessChecks(f){
 const today=f.today,year=currentYear(f.periods,today),checks=[];
 const approved=new Set((f.sections||[]).filter(s=>s.status==='Approved').map(s=>s.section_code)),missing=REQUIRED_SECTIONS.filter(c=>!approved.has(c));
 checks.push({key:'profile',label:'Client profile approved',ok:!missing.length,detail:missing.length?`Not yet approved: ${missing.map(c=>SECTION_LABEL[c]).join(', ')}.`:'Every required section is approved.',step:'Review the client profile sections'});
 checks.push({key:'year',label:'Accounting year opened',ok:!!year,detail:year?`${year.starts_on} to ${year.ends_on} (${year.status}).`:'No accounting year has been opened for this client.',step:'Open the accounting year'});
 const at=year?year.starts_on:today,chart=(f.charts||[]).filter(c=>c.status==='Approved'&&day(c.effective_from)<=at).sort((a,b)=>day(b.effective_from).localeCompare(day(a.effective_from)))[0];
 checks.push({key:'chart',label:'Chart of accounts approved',ok:!!chart,detail:chart?`Version effective ${day(chart.effective_from)}.`:'No approved chart version covers the start of the year.',step:'Propose and approve the client chart'});
 const maps=(f.mappings||[]).filter(m=>m.status==='Active'&&day(m.effective_from)<=at&&(!m.effective_to||day(m.effective_to)>=at));
 checks.push({key:'mappings',label:'Account mappings approved',ok:maps.length>0,detail:maps.length?`${maps.length} approved mapping${maps.length===1?'':'s'} in force.`:'No approved mapping is in force at the start of the year.',step:'Map the client accounts and approve the mappings'});
 const none=f.opening?.status==='No opening balances',posted=!!f.opening?.posted;
 checks.push({key:'opening',label:'Opening balances reviewed and posted',ok:none||posted,detail:none?'The client has no opening balances (confirmed with a note).':posted?'The opening trial balance for the year is posted.':'The opening trial balance for the year is not posted yet.',step:'Review and post the opening trial balance'});
 const done=checks.filter(c=>c.ok).length,next=checks.find(c=>!c.ok)||null;
 return {checks,done,total:checks.length,ready:done===checks.length,next_step:next?{key:next.key,step:next.step,detail:next.detail}:null,year};
}
// Project access follows the assignment. Accounting activation follows the checks above. Neither is a reason to hold the other back.
export function accessSummary(assignments){return {projects:(assignments||[]).length,people:new Set((assignments||[]).map(a=>a.staff_id)).size};}
const dayAfter=d=>{const x=new Date(d+'T00:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10);};
export function nextYear(source){const n=nextPeriod(day(source.starts_on),day(source.ends_on));return n?{starts_on:n.start,ends_on:n.end}:null;}
// Approved mappings still in force on the last day of the source year carry into the new year as drafts. Ended, draft and inactive ones do not.
export function carriedMappings(rows,sourceEnd){return (rows||[]).filter(m=>m.status==='Active'&&day(m.effective_from)<=sourceEnd&&(!m.effective_to||day(m.effective_to)>=sourceEnd));}
// What the person reviewing the rollover is shown. Nothing here is a guess: each line is a fact about the two years.
export function rolloverChanges({client,source,next,chart,mappings,carried}){
 const out=[];
 if(source.entity_type&&client.legal_entity_type&&source.entity_type!==client.legal_entity_type)out.push({kind:'change',text:`The legal entity type was ${source.entity_type} in the source year and is now ${client.legal_entity_type}. Check the chart and the mappings.`});
 if(client.year_end_month&&client.year_end_day){const m=String(client.year_end_month).padStart(2,'0'),d=String(client.year_end_day).padStart(2,'0');if(next.ends_on.slice(5)!==`${m}-${d}`)out.push({kind:'change',text:`The new year ends on ${next.ends_on}, but the client's year-end is ${m}-${d}. Confirm the dates before reviewing.`});}
 out.push({kind:'carried',text:`Chart of accounts: ${chart.accounts.length} account${chart.accounts.length===1?'':'s'} copied from the version effective ${day(chart.effective_from)} into a draft starting ${next.starts_on}. A different Manager or Partner approves it.`});
 const skipped=(mappings||[]).filter(m=>!carried.some(c=>c.mapping_id===m.mapping_id)).length;
 out.push({kind:'carried',text:`Mappings: ${carried.length} approved mapping${carried.length===1?'':'s'} copied as drafts starting ${next.starts_on}${skipped?`; ${skipped} ended, draft or inactive mapping${skipped===1?'':'s'} left out`:''}. Each is approved again.`});
 out.push({kind:'unchanged',text:`The source year (${day(source.starts_on)} to ${day(source.ends_on)}), its journals and its approved chart and mappings are not changed.`});
 out.push({kind:'not_done',text:'Opening balances are not posted by this step. They come from the closed source year, are reviewed, and are posted separately.'});
 return out;
}
export function rolloverIssues({source,existing,draftChartExists,next}){
 const blockers=[],warnings=[];
 if(!next)blockers.push('The next year could not be worked out from the source year.');
 if(existing)blockers.push(`A rollover for the year starting ${next?.starts_on||''} is already ${existing.status.toLowerCase()}. Continue that one.`);
 if(draftChartExists)blockers.push('A chart version is already waiting for review. Approve or return it first, because only one draft chart can exist for a client.');
 if(source&&source.status==='Open')warnings.push('The source year is still open. You can prepare the rollover now, but it can be reviewed only after that year is closed or its year-end trial balance is recorded.');
 return {blockers,warnings};
}
export {dayAfter};
