// Build 2843: how many practitioners the firm has, and who may put forward and approve firm-wide service categories (service templates). Pure rules, no database, no clock.
// One practitioner: the Partner may put a template forward and approve it alone (recorded as a sole-Partner approval).
// Two or more: one person puts it forward (a Manager or a Partner) and a different Partner or Manager approves it.
// A declaration can only tighten the rule. It never makes someone the sole Partner while another active Partner has access to the firm; the database checks the real Partners too.
export const MAX_PRACTITIONERS=500;
const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function declarationFields(p){
 if(!UUID.test(String(p?.firm_id||'')))return {problem:'Choose the firm.'};
 const raw=String(p?.practitioners??'').trim();
 if(!/^\d{1,3}$/.test(raw))return {problem:`Enter the number of practitioners, a whole number from 1 to ${MAX_PRACTITIONERS}.`};
 const n=Number(raw);if(n<1||n>MAX_PRACTITIONERS)return {problem:`Enter a number from 1 to ${MAX_PRACTITIONERS}.`};
 const reason=clean(p?.reason);if(reason.length<10||reason.length>500)return {problem:'Say why in 10 to 500 characters, for example "Sole practitioner, no other Partner".'};
 return {values:{firm_id:p.firm_id,practitioners:n,reason}};
}
// What a firm is, from its latest declaration and the number of active Partners with access. Without a declaration the real Partners decide, as before.
export function practiceMode(declared,activePartners){
 const d=declared==null?null:Number(declared),p=Number(activePartners||0);
 if(d===null)return p<=1?{mode:'SOLE',declared:false,label:'One active Partner (not declared)'}:{mode:'TEAM',declared:false,label:`${p} active Partners (not declared)`};
 if(d===1&&p<=1)return {mode:'SOLE',declared:true,label:'Sole practitioner'};
 return {mode:'TEAM',declared:true,label:`${Math.max(d,p)} practitioners`};
}
// Whether one person may put a Draft template forward or approve it. `sole` is the server's answer (a Partner, and the only practitioner).
// t: {status, proposed_by, submitted_by}; me: {staff_id, category_code}
export function templateGate(kind,t,me,sole){
 const leader=['PARTNER','MANAGER'].includes(me.category_code);
 if(!leader)return {ok:false,problem:'A Partner or a Manager does this.'};
 if(t.status!=='Draft')return {ok:false,problem:t.status==='Approved'?'It is already approved.':'It is retired.'};
 if(kind==='submit'){
  if(t.proposed_by)return {ok:false,problem:'It was proposed as a new version, so it is already waiting for approval.'};
  if(t.submitted_by)return {ok:false,problem:'It has already been put forward.'};
  return {ok:true};
 }
 const mine=t.proposed_by===me.staff_id||t.submitted_by===me.staff_id;
 if(mine&&!sole)return {ok:false,problem:'You put this one forward. A different Partner or Manager approves it, unless you are the firm\'s only practitioner.'};
 return {ok:true,sole_approval:mine&&sole};
}
export const GROUP_ORDER=Object.freeze(['Tax Compliance','Accounting and Bookkeeping','Payroll','Audit and Assurance','Advisory and Other']);

// Build 2844: bulk retire and bulk "propose a new version" of service categories.
// Retire: a Partner, one reason (5 to 500 characters) for every ticked category. Propose: a Manager or Partner, one set of changes applied wherever the task exists.
export const MAX_BATCH=50;
const KEY=/^[a-z][a-z0-9_]{1,39}$/;
export function retireFields(p){
 const reason=clean(p?.reason);
 if(reason.length<5||reason.length>500)return {problem:'Say why they are retired, in 5 to 500 characters. The same reason is recorded on each.'};
 return {values:{reason}};
}
// The common changes for a new version. Task keys are the template's own lower-case keys. A key a category does not have is left alone for that category and said so.
export function versionChanges(p){
 const drop=Array.isArray(p?.drop_task_keys)?[...new Set(p.drop_task_keys.map(x=>clean(x)).filter(Boolean))]:[];
 const days=p?.due_days&&typeof p.due_days==='object'&&!Array.isArray(p.due_days)?p.due_days:{};
 const must=p?.mandatory&&typeof p.mandatory==='object'&&!Array.isArray(p.mandatory)?p.mandatory:{};
 const due={},mandatory={};
 for(const k of drop)if(!KEY.test(k))return {problem:`"${k}" is not a task key. Task keys are lower-case words joined by underscores.`};
 for(const [k,v] of Object.entries(days)){
  if(!KEY.test(k))return {problem:`"${k}" is not a task key. Task keys are lower-case words joined by underscores.`};
  const n=Number(v);if(!Number.isInteger(n)||n<0||n>366)return {problem:`Due days for "${k}" run from 0 to 366.`};due[k]=n;
 }
 for(const [k,v] of Object.entries(must)){
  if(!KEY.test(k))return {problem:`"${k}" is not a task key. Task keys are lower-case words joined by underscores.`};
  if(typeof v!=='boolean')return {problem:`Say whether "${k}" is required or optional.`};mandatory[k]=v;
 }
 for(const k of drop)if(k in due||k in mandatory)return {problem:`"${k}" is both removed and changed. Choose one.`};
 if(drop.length+Object.keys(due).length+Object.keys(mandatory).length>MAX_BATCH)return {problem:`Change up to ${MAX_BATCH} tasks at a time.`};
 const suffix=clean(p?.name_suffix);if(suffix.length>60)return {problem:'The name addition runs to 60 characters.'};
 if(!drop.length&&!Object.keys(due).length&&!Object.keys(mandatory).length&&!suffix)return {problem:'Say what changes in the new version: tasks to remove, due days, required or optional, or an addition to the name.'};
 return {changes:{drop,due,mandatory,suffix}};
}
// What one category would get. `keys` are the task keys it has now and `name` its name. Nothing changes where no change applies.
export function planVersion(keys,name,changes){
 const has=new Set(keys),drop=changes.drop.filter(k=>has.has(k)),due={},mandatory={},left=[];
 for(const [k,v] of Object.entries(changes.due))has.has(k)?due[k]=v:left.push(k);
 for(const [k,v] of Object.entries(changes.mandatory))has.has(k)?mandatory[k]=v:left.push(k);
 for(const k of changes.drop)if(!has.has(k))left.push(k);
 const suffix=changes.suffix&&!String(name).endsWith(changes.suffix)?changes.suffix:'';
 const applies=drop.length+Object.keys(due).length+Object.keys(mandatory).length+(suffix?1:0);
 if(!applies)return {problem:'None of the changes applies to this category.',left};
 return {drop,due,mandatory,name:suffix?clean(name+' '+suffix):null,left:[...new Set(left)],applies};
}
// Retire needs a Partner; a draft or an approved category may be retired. Propose needs a Manager or Partner and an approved category with no draft already waiting.
export function retireGate(t,me){
 if(me.category_code!=='PARTNER')return {ok:false,problem:'A Partner retires a service category.'};
 if(t.status==='Retired')return {ok:false,problem:'It is already retired.'};
 return {ok:true};
}
export function proposeGate(t,me,openDraft){
 if(!['PARTNER','MANAGER'].includes(me.category_code))return {ok:false,problem:'A Partner or a Manager proposes a new version.'};
 if(t.status==='Draft')return {ok:false,problem:'It is a draft already. Approve or retire it; a new version comes from an approved category.'};
 if(t.status!=='Approved')return {ok:false,problem:'It is retired.'};
 if(openDraft)return {ok:false,problem:'A draft of this category is already waiting for approval. Approve or retire it first.'};
 return {ok:true};
}
