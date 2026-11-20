// Upload safety (build 2903). Pure rules, no database.
// 1. A retried upload: the same person sends the same file to the same place again within a few minutes, usually because the first
//    reply was lost. The ERP hands back the file it already holds instead of storing a second copy.
// 2. Removing a bank statement upload: allowed only while nothing from it has been matched, mapped, reviewed, posted or locked.
export const RETRY_WINDOW_MINUTES=15;

export function retriedUpload(candidates,{staff_id,sha256,client_id,project_id,task_id,category,now=Date.now()}){
 for(const d of candidates||[]){
  if(d.archived_at||d.deleted_at)continue;
  if(d.sha256!==sha256||d.uploaded_by!==staff_id||d.client_id!==client_id||(d.project_id??null)!==(project_id??null)||(d.task_id??null)!==(task_id??null)||d.category!==category)continue;
  const at=new Date(d.uploaded_at).getTime();
  if(!Number.isFinite(at)||now-at<0||now-at>RETRY_WINDOW_MINUTES*60000)continue;
  return d;
 }
 return null;
}

const plural=(n,one,many)=>`${n} ${n===1?one:many}`;
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);

// facts: {statements:[{sheet_name,period_start,period_end,rows}], file_name, matched_rows, receipt_allocations, closed_periods, journals}
export function bankRemoval(facts){
 const f=facts||{},statements=f.statements||[];
 const rows=statements.reduce((n,s)=>n+(Number(s.rows)||0),0);
 const starts=statements.map(s=>day(s.period_start)).filter(Boolean).sort(),ends=statements.map(s=>day(s.period_end)).filter(Boolean).sort();
 const summary={file_name:f.file_name||'',period_start:starts[0]||null,period_end:ends.at(-1)||null,rows,statements:statements.length};
 const reasons=[];
 if(Number(f.matched_rows)>0)reasons.push(`${plural(Number(f.matched_rows),'line has','lines have')} been mapped, reviewed or posted.`);
 if(Number(f.receipt_allocations)>0)reasons.push(`${plural(Number(f.receipt_allocations),'line is','lines are')} matched to customer receipts.`);
 if(Number(f.journals)>0)reasons.push(`An accounting entry was prepared from it.`);
 if(Number(f.closed_periods)>0)reasons.push('Its period is submitted or locked.');
 const allowed=reasons.length===0;
 const instead=allowed?[]:['Do not remove it. Reverse or correct the affected entries instead: return the tax case or reverse the posted journal through the approved reversal, undo the receipt matches, then upload the corrected statement. A statement that is already in use stays in the history.'];
 return {allowed,reasons,instead,summary};
}

export function bankRemovalMessage(d){
 if(d.allowed)return '';
 return `This bank statement cannot be removed because ${d.reasons.join(' ')} ${d.instead.join(' ')}`;
}
