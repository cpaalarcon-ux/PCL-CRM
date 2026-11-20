// The My Approvals filters, kept in one pure file so the browser and the tests run the same code (build 2839). The server's copy is settings-owner-rules.mjs.
export const STATE_FILTERS=Object.freeze(['Draft','In Review','Approved','Active','Suspended','Retired']);
// Filters run in the browser on what the server sent; this is the same function so the tests cover it. f: {mine,state,owner,scope,from,to,q}
export function filterApprovals(items,f={}){
 const q=String(f.q||'').trim().toLowerCase();
 return (items||[]).filter(i=>{
  if(f.mine&&!i.needs_my_action)return false;
  if(f.state&&i.state!==f.state)return false;
  if(f.owner&&(i.owner_role||'')!==f.owner)return false;
  if(f.scope==='firm'&&i.scope!=='Firm-wide')return false;
  if(f.scope&&f.scope!=='firm'&&f.scope!=='all'&&i.scope!==f.scope)return false;
  if(f.from&&!(i.effective_from&&i.effective_from>=f.from))return false;
  if(f.to&&!(i.effective_from&&i.effective_from<=f.to))return false;
  if(q&&![i.label,i.area_label,i.scope,i.prepared_by].join(' ').toLowerCase().includes(q))return false;
  return true;
 });
}

// Records shown: Draft and In Review by default (what waits); any other filter widens the list to every state.
export const visibleRecords=(records,f)=>filterApprovals((records||[]).filter(r=>f.state||['Draft','In Review'].includes(r.state)||f.from||f.to||f.owner||f.scope||f.q),f);
