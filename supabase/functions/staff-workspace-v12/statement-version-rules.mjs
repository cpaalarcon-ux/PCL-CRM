// Statement versions (builds 2825 and 2826). Pure functions. The three kinds, the order they are built in, and what changed between two snapshots.
// The figures are the ones the annual statements produced when the version was captured; nothing here recalculates them.
export const KINDS=['Draft','Audit/Review Adjusted','Final Signed'];
export const LINK_KINDS=['Audit file','Adjustment journal','KRA notice','Review engagement'];
export const previousKind=k=>({'Audit/Review Adjusted':'Draft','Final Signed':'Audit/Review Adjusted'}[k]||null);
export function canonical(v){
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(v&&typeof v==='object')return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 return JSON.stringify(v===undefined?null:v);
}
export const digestOf=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))).map(n=>n.toString(16).padStart(2,'0')).join('');
const SECTIONS=[['profit_or_loss','Profit or loss'],['financial_position','Financial position'],['cash_flow','Cash flows']];
// Every figure line of a snapshot, keyed by statement and label, so two snapshots can be compared line by line.
export function flatten(snapshot){
 const out=new Map();
 for(const [key,title] of SECTIONS){
  const blk=snapshot?.statements?.[key];if(!blk?.rows)continue;
  for(const r of blk.rows){if(r.kind==='heading')continue;const k=`${title}|${r.label}`;if(!out.has(k))out.set(k,{statement:title,label:r.label,amount:r.current??null});}
 }
 return out;
}
// Lines whose figure differs, appears or disappears between an earlier and a later snapshot.
export function diffSnapshots(before,after){
 const a=flatten(before),b=flatten(after),rows=[];
 for(const [k,x] of b){const y=a.get(k);if(!y)rows.push({statement:x.statement,label:x.label,before:null,after:x.amount,change:'Added'});else if(Number(y.amount)!==Number(x.amount))rows.push({statement:x.statement,label:x.label,before:y.amount,after:x.amount,change:'Changed',difference:Math.round((Number(x.amount)-Number(y.amount))*100)/100});}
 for(const [k,y] of a)if(!b.has(k))rows.push({statement:y.statement,label:y.label,before:y.amount,after:null,change:'Removed'});
 return rows;
}
// Which versions are current, and which were built on something that has since been replaced.
export function describe(versions){
 const latest={};for(const v of versions)if(!latest[v.kind]||v.seq>latest[v.kind].seq)latest[v.kind]=v;
 const byId=new Map(versions.map(v=>[v.version_id,v]));
 return versions.map(v=>{
  const superseded=latest[v.kind].version_id!==v.version_id;
  const base=v.based_on_version_id?byId.get(v.based_on_version_id):null,baseLatest=base?latest[base.kind]:null;
  const stale=!superseded&&!!base&&baseLatest.version_id!==base.version_id;
  return {...v,current:!superseded,superseded,stale,state:superseded?'Superseded':stale?'Out of date: built on a version that was replaced':v.status};
 });
}
// What can be started next, from the current locked versions. Nothing is offered that the database would refuse.
export function nextSteps(versions){
 const d=describe(versions).filter(v=>v.current),cur=k=>d.find(v=>v.kind===k);
 const steps=[];
 const draft=cur('Draft'),adj=cur('Audit/Review Adjusted'),fin=cur('Final Signed');
 steps.push({kind:'Draft',allowed:true,note:draft?'Prepare a corrected draft (replaces the current one).':'Prepare the draft from the ledger.'});
 steps.push({kind:'Audit/Review Adjusted',allowed:draft?.status==='Locked'&&!draft.stale,note:!draft?'Needs a draft first.':draft.status!=='Locked'?'The draft must be locked first.':adj?'Prepare a corrected adjusted version.':'Prepare after the audit or review adjustments are posted.'});
 steps.push({kind:'Final Signed',allowed:adj?.status==='Locked'&&!adj.stale,note:!adj?'Needs the adjusted version first.':adj.status!=='Locked'?'The adjusted version must be locked first.':adj.stale?'The adjusted version is out of date.':'Prepare when the report is signed.'});
 return steps;
}
