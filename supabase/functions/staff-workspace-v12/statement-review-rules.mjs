// Grouped review of statement-line mappings (build 2839). Pure. A Partner used to approve the seeded mappings in one click with no breakdown.
// This sorts every Draft mapping into: a group that is consistent (one group per statement line, approved together), mappings already approved on the same line
// (nothing to approve), and exceptions that each need a person's decision with a reason. It reads only what the database holds; it never guesses a statement for an account.
// An account's own statement type decides what is consistent: a profit or loss account belongs on a profit or loss line, and a financial position account on a financial position line.
export const STATEMENT_OF={'Statement of financial position':'Financial position','Profit or loss':'Profit or loss'};
export const MAX_BATCH=500;
export const REASONS={
 account_draft:{blocks:true,text:'The account is still a draft in the chart of accounts. Activate the account first.'},
 several_drafts:{blocks:true,text:'This account has more than one change waiting. Reject all but one.'},
 legacy:{blocks:false,text:'Legacy account. A balance left on it blocks the annual pack until the balance is moved.'},
 statement_mismatch:{blocks:false,text:'The account belongs to a different statement than this line.'},
 statement_unknown:{blocks:false,text:'The account has no recognised statement type, so its line cannot be checked.'},
 replaces_open:{blocks:false,text:'Approving ends the account\'s current approved line.'}
};
const iso=v=>v==null?'':(v instanceof Date?v.toISOString():String(v)).slice(0,10);
export function reasonsFor(r){
 const out=[];
 if(r.account_status!=='Active')out.push('account_draft');
 if(Number(r.drafts||1)>1)out.push('several_drafts');
 if(r.is_legacy)out.push('legacy');
 const want=STATEMENT_OF[r.account_statement];
 if(!r.is_legacy){
  if(!r.account_statement||!want)out.push('statement_unknown');
  else if(want!==r.line_statement)out.push('statement_mismatch');
 }
 if(r.open_line_code&&r.open_line_code!==r.line_code)out.push('replaces_open');
 return out;
}
export const kindOf=r=>r.open_line_code&&r.open_line_code===r.line_code?'unchanged':reasonsFor(r).length?'exception':'consistent';
export function classify(r){
 const reasons=reasonsFor(r),kind=kindOf(r);
 return {map_id:r.map_id,account_code:r.account_code,account_name:r.account_name,line_code:r.line_code,line_label:r.line_label,line_statement:r.line_statement,effective_from:iso(r.effective_from),
  seeded:!r.proposed_by,proposed_by:r.proposed_by_name||null,proposed_by_id:r.proposed_by||null,revision:r.account_revision??null,reason:r.reason||null,kind,
  reasons:kind==='unchanged'?[]:reasons.map(c=>({code:c,text:REASONS[c].text,blocks:REASONS[c].blocks})),
  replaces:r.open_line_code?{line_code:r.open_line_code,from:iso(r.open_from)}:null,blocked:reasons.some(c=>REASONS[c].blocks)};
}
export function buildReview(rows){
 const items=(rows||[]).map(classify),groups=new Map();
 for(const i of items){if(i.kind!=='consistent')continue;if(!groups.has(i.line_code))groups.set(i.line_code,{line_code:i.line_code,label:i.line_label,statement:i.line_statement,accounts:[]});groups.get(i.line_code).accounts.push({map_id:i.map_id,account_code:i.account_code,account_name:i.account_name,effective_from:i.effective_from,seeded:i.seeded,proposed_by:i.proposed_by,proposed_by_id:i.proposed_by_id,revision:i.revision});}
 const g=[...groups.values()].map(x=>({...x,count:x.accounts.length}));
 const ex=items.filter(i=>i.kind==='exception'),un=items.filter(i=>i.kind==='unchanged');
 return {summary:{total:items.length,consistent:items.filter(i=>i.kind==='consistent').length,unchanged:un.length,exceptions:ex.length,blocked:ex.filter(i=>i.blocked).length},groups:g,unchanged:un,exceptions:ex,max_batch:MAX_BATCH};
}
// The ids a group approval may cover: every id must be a Draft that is consistent right now. Anything else stops the whole approval, so the Partner never approves what they did not see.
export function checkGroupIds(ids,rows){
 const by=new Map((rows||[]).map(r=>[r.map_id,r]));
 if(!Array.isArray(ids)||!ids.length)return {ok:false,message:'Choose at least one group to approve.'};
 if(ids.length>MAX_BATCH)return {ok:false,message:`Approve at most ${MAX_BATCH} mappings at a time.`};
 if(new Set(ids).size!==ids.length)return {ok:false,message:'A mapping was selected more than once. Refresh and try again.'};
 for(const id of ids){const r=by.get(id);if(!r)return {ok:false,id,message:'A selected mapping is no longer waiting. Refresh the review.'};if(kindOf(r)!=='consistent')return {ok:false,id,message:`Account ${r.account_code} is no longer in the consistent group. Refresh the review and decide it on its own.`};}
 return {ok:true};
}
// One exception: a reason is always required, and a blocking reason cannot be approved at all.
export function checkException(row,note){
 if(!row)return {ok:false,message:'That mapping is no longer waiting. Refresh the review.'};
 const reasons=reasonsFor(row),block=reasons.find(c=>REASONS[c].blocks);
 if(block)return {ok:false,message:REASONS[block].text};
 if(kindOf(row)==='consistent')return {ok:true};
 if(String(note||'').trim().length<10)return {ok:false,message:'Say why you accept this exception (at least 10 characters).'};
 return {ok:true};
}
