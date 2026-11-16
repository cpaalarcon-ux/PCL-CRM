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
