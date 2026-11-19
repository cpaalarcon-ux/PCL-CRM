// Build 2903: rules for resumable form drafts. Build 2904 adds the opening-balance grid, the purchase and expenditure mapping forms and time entry. Pure functions, shared by the server action and its tests.
// A draft is a person's own unfinished form. It is never an approval, task or ledger record. Secrets are never kept.
export const FORM_KINDS=Object.freeze({
 ledger_journal:'Journal entry',
 client_edit:'Client set-up form',
 client_activity:'Client activities form',
 opening_balance:'Opening balances (T-structure)',
 purchase_mapping:'Purchase and expenditure mapping',
 time_entry:'Time entry',
});
export const MAX_DRAFTS_PER_PERSON=50;
export const MAX_PAYLOAD_CHARS=60000;
export const MAX_DEPTH=5;
// A field or key whose name looks like a password, token or key is never stored.
export const SECRET_NAME=/(passw|passcode|secret|token|api[_-]?key|authori[sz]ation|credential|\botp\b)/i;
export const SUBJECT_KEY=/^[A-Za-z0-9:_.\-]{1,200}$/;
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const kindLabel=kind=>FORM_KINDS[kind]||'';

function walk(value,depth,problems,path){
 if(depth>MAX_DEPTH){problems.push('The draft is nested too deeply.');return;}
 if(Array.isArray(value)){if(value.length>500)problems.push('The draft holds too many rows.');value.slice(0,500).forEach((v,i)=>walk(v,depth+1,problems,path+'['+i+']'));return;}
 if(value&&typeof value==='object'){
  for(const [k,v] of Object.entries(value)){
   if(SECRET_NAME.test(k))problems.push(`The field "${k}" looks like a password or secret and is never kept in a draft.`);
   walk(v,depth+1,problems,path+'.'+k);
  }
  return;
 }
 if(typeof value==='string'&&value.length>20000)problems.push('A value in the draft is too long.');
}
// Returns {ok,problems,payload}. payload is a plain JSON object (functions, undefined and non-JSON values are dropped).
export function cleanPayload(raw){
 const problems=[];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return {ok:false,problems:['The draft must be an object of field values.'],payload:null};
 let payload;
 try{payload=JSON.parse(JSON.stringify(raw));}catch{return {ok:false,problems:['The draft could not be read.'],payload:null};}
 walk(payload,0,problems,'');
 if(JSON.stringify(payload).length>MAX_PAYLOAD_CHARS)problems.push('The draft is too large to keep. Save the form instead.');
 return {ok:!problems.length,problems:[...new Set(problems)],payload:problems.length?null:payload};
}
export function draftTitle(kind,title){
 const t=String(title??'').replace(/\s+/g,' ').trim().slice(0,200);
 return t||kindLabel(kind);
}
// What the audit log keeps: that a draft was made, saved, resumed or discarded. Never the contents.
export function auditShape(kind,subject,title,payload){
 return {form_kind:kind,subject_key:subject,title,size_chars:payload?JSON.stringify(payload).length:0};
}
export function draftIssues({kind,subject_key,title}){
 const out=[];
 if(!FORM_KINDS[kind])out.push('This form cannot be saved as a draft.');
 if(!SUBJECT_KEY.test(String(subject_key||'')))out.push('The draft needs a valid subject key.');
 if(!String(title??'').trim())out.push('The draft needs a title.');
 return out;
}
// A draft whose journal has since been submitted or posted is stale and is not offered again.
export const ledgerSubject=(projectId,periodId,journalId,kind)=>`ledger:${projectId}:${periodId}:${journalId||'new-'+String(kind||'Adjustment').toLowerCase()}`;
